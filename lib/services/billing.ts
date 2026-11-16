import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Ctx, assertCan, canSee } from "../access";
import { withTx } from "../db";
import { invalid, notFound, conflict } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal } from "./ledger";
import { setStatus } from "./jobs";
import { D, parseDec } from "../money";
import { today } from "./stock";
import { str } from "../validate";

/** M11 tax invoices from job cards and receipts with bill-by-bill allocation. */

type Check = { ok: boolean; text: string };

async function invoiceBasis(c: PoolClient, jobId: string) {
  const j = await c.query("SELECT * FROM job_card WHERE id = $1", [jobId]);
  if (!j.rowCount) throw notFound("Job card");
  const job = j.rows[0];
  // Lines come only from approved job lines (IV-01), priced as on the latest approved quotation line.
  const lines = (await c.query(
    `SELECT l.id job_line_id, l.line_no, l.line_type, l.description, l.qty, l.issued_qty, l.item_id, ql.unit_price, ql.line_discount, ql.doc_discount_share,
            ql.taxable_amount, ql.vat_code, ql.vat_rate, ql.vat_amount, ql.line_total, ql.quotation_id
       FROM job_line l
       JOIN LATERAL (SELECT ql.* FROM quotation_line ql JOIN quotation q ON q.id = ql.quotation_id
                      WHERE ql.job_line_id = l.id AND ql.decision = 'approved' ORDER BY q.revision DESC LIMIT 1) ql ON true
      WHERE l.job_card_id = $1 AND NOT l.removed AND l.approval_status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM sales_invoice_line sil WHERE sil.job_line_id = l.id)
      ORDER BY l.line_no`, [jobId])).rows;
  const latestApproved = (await c.query(
    "SELECT * FROM quotation WHERE job_card_id = $1 AND status IN ('approved','partly_approved') ORDER BY revision DESC LIMIT 1", [jobId])).rows[0];
  const invoicedBefore = D((await c.query("SELECT coalesce(sum(grand_total),0) t FROM sales_invoice WHERE job_card_id = $1", [jobId])).rows[0].t);
  const taxable = lines.reduce((s, l) => s.plus(l.taxable_amount), D(0));
  const vat = lines.reduce((s, l) => s.plus(l.vat_amount), D(0));
  const total = taxable.plus(vat);
  const notIssued = lines.filter((l) => ["part", "consumable"].includes(l.line_type) && D(l.issued_qty).lt(l.qty));
  const late = job.promised_at && new Date(job.promised_at) < new Date() && !job.delay_reason;
  const checks: Check[] = [
    { ok: ["ready", "delivered"].includes(job.status), text: "Job is Ready or Delivered" },
    { ok: lines.length > 0, text: "There are approved lines not yet invoiced" },
    { ok: notIssued.length === 0, text: notIssued.length ? `Parts not issued from the store: ${notIssued.map((l) => l.description).join(", ")}` : "All approved parts are issued to the job" },
    { ok: !!latestApproved && invoicedBefore.plus(total).lte(latestApproved.approved_total), text: "Not above the approved quotation (QT-07)" },
    { ok: !late, text: late ? "Job is late and has no delay reason" : "Delay reason recorded if the job was late" },
  ];
  return { job, lines, taxable, vat, total, checks, latestApproved };
}

export async function invoiceDraft(ctx: Ctx, jobId: string) {
  return withTx(ctx, async (c) => {
    const b = await invoiceBasis(c, jobId);
    assertCan(ctx, "invoices", "view", b.job.branch_id);
    if (!canSee(ctx, "selling_price", b.job.branch_id)) throw invalid("You cannot see prices.");
    return { ...b, taxable: b.taxable.toFixed(2), vat: b.vat.toFixed(2), total: b.total.toFixed(2) };
  });
}

/**
 * Posts the tax invoice: number given at posting in the same transaction (no gaps, IV-02), posting
 * date is the server date, journal Dr receivable / Cr sales and output VAT, and the issued parts'
 * cost moves from work in progress to cost of sales. Idempotent by key.
 */
export async function postInvoice(ctx: Ctx, jobId: string, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length < 16) throw invalid("Missing idempotency key.");
  return withTx(ctx, async (c) => {
    const prior = await c.query("SELECT id, job_card_id, doc_no FROM sales_invoice WHERE idempotency_key = $1", [idempotencyKey]);
    if (prior.rowCount) {
      if (prior.rows[0].job_card_id !== jobId) throw conflict("This request key was already used for another invoice.");
      return { id: prior.rows[0].id, docNo: prior.rows[0].doc_no, duplicate: true };
    }
    const lock = await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId]);
    if (!lock.rowCount) throw notFound("Job card");
    assertCan(ctx, "invoices", "create", lock.rows[0].branch_id);
    const b = await invoiceBasis(c, jobId);
    const failed = b.checks.filter((x) => !x.ok);
    if (failed.length) throw invalid(`Cannot post the invoice: ${failed.map((x) => x.text).join("; ")}.`);
    const job = b.job;
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [job.customer_id])).rows[0];
    const docNo = await nextDocNo(c, job.branch_id, "invoice");
    const date = today();
    const due = new Date(Date.now() + cust.payment_terms_days * 86400_000).toISOString().slice(0, 10);
    const billTo = cust.customer_type === "individual" ? [cust.title, cust.first_name, cust.last_name].filter(Boolean).join(" ") : `M/s. ${cust.company_name}`;
    const labour = b.lines.filter((l) => l.line_type === "labour").reduce((s, l) => s.plus(l.taxable_amount), D(0));
    const other = b.taxable.minus(labour);
    const issuedCost = D((await c.query(
      "SELECT coalesce(sum(value),0) v FROM stock_move WHERE move_type = 'issue' AND job_line_id = ANY($1)", [b.lines.map((l) => l.job_line_id)])).rows[0].v);
    const jr = await postJournal(c, ctx, {
      branchId: job.branch_id, date, sourceType: "sales_invoice", sourceId: job.id, narration: `Tax invoice ${docNo} for ${job.doc_no}`,
      lines: [
        { event: "trade_receivable", debit: b.total, customerId: cust.id },
        { event: "sales_labour", credit: labour },
        { event: "sales_parts", credit: other },
        { event: "vat_output", credit: b.vat },
        { event: "cost_of_sales", debit: issuedCost },
        { event: "work_in_progress", credit: issuedCost },
      ],
    });
    const inv = await c.query(
      `INSERT INTO sales_invoice (branch_id, doc_no, doc_date, job_card_id, quotation_id, customer_id, bill_to_name, customer_trn, lpo_no, taxable_total, vat_total, grand_total,
                                  due_date, idempotency_key, journal_id, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [job.branch_id, docNo, date, job.id, b.latestApproved.id, cust.id, billTo, cust.trn, job.lpo_no, b.taxable.toFixed(2), b.vat.toFixed(2), b.total.toFixed(2),
        due, idempotencyKey, jr!.id, ctx.userId]);
    const invId = inv.rows[0].id;
    for (const [i, l] of b.lines.entries()) {
      await c.query(
        `INSERT INTO sales_invoice_line (invoice_id, branch_id, job_line_id, line_no, line_type, description, qty, unit_price, discount_amount, taxable_amount, vat_code, vat_rate, vat_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [invId, job.branch_id, l.job_line_id, i + 1, l.line_type, l.description, l.qty, l.unit_price, D(l.line_discount).plus(l.doc_discount_share).toFixed(2),
          l.taxable_amount, l.vat_code, l.vat_rate, l.vat_amount, l.line_total]);
    }
    const fresh = (await c.query("SELECT * FROM job_card WHERE id = $1", [job.id])).rows[0];
    if (fresh.status === "ready") await setStatus(c, ctx, fresh, "delivered", "Delivered at invoicing");
    await setStatus(c, ctx, { ...fresh, status: "delivered" }, "invoiced", `Invoice ${docNo}`);
    await audit(c, ctx, "sales_invoice", invId, "post", { doc_no: docNo, total: b.total.toFixed(2), vat: b.vat.toFixed(2) }, job.branch_id);
    return { id: invId, docNo, duplicate: false };
  });
}

export async function getInvoice(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await c.query(
      `SELECT i.*, b.code branch_code, b.name_en branch_name, b.address branch_address, b.emirate, co.legal_name_en, co.legal_name_ar, co.trn company_trn,
              j.doc_no job_no, v.make, v.model, v.plate_code, v.plate_number, v.registered_in, c.mobile
         FROM sales_invoice i JOIN branch b ON b.id = i.branch_id CROSS JOIN LATERAL (SELECT * FROM company LIMIT 1) co
         LEFT JOIN job_card j ON j.id = i.job_card_id LEFT JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = i.customer_id WHERE i.id = $1`, [id]);
    if (!r.rowCount) throw notFound("Invoice");
    assertCan(ctx, "invoices", "view", r.rows[0].branch_id);
    const lines = (await c.query("SELECT * FROM sales_invoice_line WHERE invoice_id = $1 ORDER BY line_no", [id])).rows;
    const receipts = (await c.query("SELECT r.doc_no, r.method, ra.amount, r.doc_date FROM receipt_allocation ra JOIN receipt r ON r.id = ra.receipt_id WHERE ra.invoice_id = $1", [id])).rows;
    return { invoice: r.rows[0], lines, receipts };
  });
}

export async function listInvoices(ctx: Ctx) {
  return withTx(ctx, async (c) => (await c.query(
    `SELECT i.id, i.doc_no, i.doc_date, i.bill_to_name, i.grand_total, i.paid_amount, i.grand_total - i.paid_amount open_amount, b.code branch_code
       FROM sales_invoice i JOIN branch b ON b.id = i.branch_id ORDER BY i.posted_at DESC LIMIT 200`)).rows);
}

/**
 * Records a receipt and allocates it to an invoice (bill by bill, AC-13). Any excess stays on the
 * customer's account. Idempotent: the same key with the same request returns the first receipt;
 * the same key with a different request is refused.
 */
export async function recordReceipt(ctx: Ctx, f: { invoice_id: string; method: string; amount: unknown; reference?: string; idempotency_key: string }) {
  const amount = parseDec(f.amount, "Amount", { min: "0.01", dp: 2 });
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  const hash = crypto.createHash("sha256").update(JSON.stringify([f.invoice_id, f.method, amount.toFixed(2), str(f.reference)])).digest("hex");
  return withTx(ctx, async (c) => {
    // Payment methods are a master (FSD v0.10): each names the posting event it debits.
    const pm = (await c.query("SELECT * FROM payment_method WHERE code = $1 AND active", [f.method])).rows[0];
    if (!pm) throw invalid("Choose a payment method.");
    if (pm.needs_reference && !str(f.reference)) throw invalid(`${pm.name} needs a reference.`);
    const prior = await c.query("SELECT id, doc_no, request_hash FROM receipt WHERE idempotency_key = $1", [f.idempotency_key]);
    if (prior.rowCount) {
      if (prior.rows[0].request_hash !== hash) throw conflict("This request key was already used for a different payment.");
      return { id: prior.rows[0].id, docNo: prior.rows[0].doc_no, duplicate: true };
    }
    const inv = await c.query("SELECT * FROM sales_invoice WHERE id = $1 FOR UPDATE", [f.invoice_id]);
    if (!inv.rowCount) throw notFound("Invoice");
    const invoice = inv.rows[0];
    assertCan(ctx, "invoices", "create", invoice.branch_id);
    const open = D(invoice.grand_total).minus(invoice.paid_amount);
    const alloc = amount.lt(open) ? amount : open;
    const onAccount = amount.minus(alloc);
    const docNo = await nextDocNo(c, invoice.branch_id, "receipt");
    const date = today();
    const debitEvent = pm.posting_event as string;
    const jr = await postJournal(c, ctx, {
      branchId: invoice.branch_id, date, sourceType: "receipt", sourceId: invoice.id, narration: `Receipt ${docNo} against ${invoice.doc_no}`,
      lines: [
        { event: debitEvent, debit: amount },
        { event: "trade_receivable", credit: alloc, customerId: invoice.customer_id },
        { event: "customer_advances", credit: onAccount, customerId: invoice.customer_id },
      ],
    });
    const r = await c.query(
      `INSERT INTO receipt (branch_id, doc_no, doc_date, customer_id, method, amount, reference, idempotency_key, request_hash, journal_id, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [invoice.branch_id, docNo, date, invoice.customer_id, f.method, amount.toFixed(2), str(f.reference) || null, f.idempotency_key, hash, jr!.id, ctx.userId]);
    if (alloc.gt(0)) {
      await c.query("INSERT INTO receipt_allocation (receipt_id, invoice_id, branch_id, amount) VALUES ($1,$2,$3,$4)", [r.rows[0].id, invoice.id, invoice.branch_id, alloc.toFixed(2)]);
      await c.query("UPDATE sales_invoice SET paid_amount = paid_amount + $2 WHERE id = $1", [invoice.id, alloc.toFixed(2)]);
    }
    if (alloc.eq(open) && invoice.job_card_id) {
      const job = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [invoice.job_card_id])).rows[0];
      if (job.status === "invoiced") await setStatus(c, ctx, job, "closed", `Paid by ${docNo}`);
    }
    await audit(c, ctx, "receipt", r.rows[0].id, "post", { doc_no: docNo, amount: amount.toFixed(2), allocated: alloc.toFixed(2), on_account: onAccount.toFixed(2) }, invoice.branch_id);
    return { id: r.rows[0].id, docNo, duplicate: false, onAccount: onAccount.toFixed(2) };
  });
}

