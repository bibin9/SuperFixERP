import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canSee } from "../access";
import { withTx, withAnonTx, withBranchSystemTx } from "../db";
import { invalid, notFound, conflict, forbidden } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal, type PostLine } from "./ledger";
import { setStatus } from "./jobs";
import { getSetting } from "./settings";
import { D, Decimal, parseDec, r2 } from "../money";
import { today, addDaysLocal } from "./stock";
import { optStr, str } from "../validate";
import { claimRequest, finishRequest, lockJobFirst } from "./requests";
import { lockSeries } from "./numbering";

/**
 * M11 billing (FSD 4.11): tax invoices from job cards with split billing by line, warranty claims,
 * receipts and cheques, advances and deposits, applying advances, and car release (PY-04).
 * Credit notes, cash closing, counter sales and VAT are in billing-more.ts.
 */

type Check = { ok: boolean; text: string };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const billToName = (cust: Row) =>
  cust.is_walk_in ? "Walk-in customer" : cust.customer_type === "individual" ? [cust.title, cust.first_name, cust.last_name].filter(Boolean).join(" ") : `M/s. ${cust.company_name}`;

/** E-invoicing (PINT AE): a business buyer on a full tax invoice needs its Peppol ID, trade licence and address (setting). */
export function missingBuyerDetails(cust: Row) {
  if (cust.customer_type === "individual" || !cust.trn) return [];
  return ([["peppol_id", "Peppol ID"], ["trade_licence_no", "trade licence number"], ["city", "city"], ["emirate", "emirate"]] as const).filter(([k]) => !cust[k]).map(([, l]) => l);
}
export async function assertBuyerEinvoiceDetails(c: PoolClient, cust: Row, branchId: string) {
  if (!(await getSetting<boolean>(c, "einvoice.require_buyer_details", branchId, true))) return;
  const miss = missingBuyerDetails(cust);
  if (miss.length) throw invalid(`${cust.company_name ?? "This customer"} needs its e-invoicing details before a tax invoice: ${miss.join(", ")}. Add them on the customer record.`);
}

/** IV-03 / FSD 5.1: simplified tax invoice when the buyer has no TRN, or has one and the invoice is within the limit. */
export async function invoiceKindFor(c: PoolClient, cust: Row, total: Decimal, branchId: string): Promise<"tax" | "simplified"> {
  const on = await getSetting<unknown>(c, "billing.simplified_invoice", branchId, true);
  if (!on || on === "false") return "tax";
  if (!cust.trn) return "simplified";
  const limit = D(await getSetting(c, "billing.simplified_limit", branchId, 10000));
  return total.lte(limit) ? "simplified" : "tax";
}

// =====================================================================================
// Invoice basis: what can still be billed on a job
// =====================================================================================

const BILLABLE_STATUS = ["ready", "delivered", "invoiced"];

/** SQL: invoice alias `a` is for job `p`, on its own or as part of a combined invoice (028). */
export const invOfJob = (a: string, p: string) => `(${a}.job_card_id = ${p} OR EXISTS (SELECT 1 FROM sales_invoice_job x WHERE x.invoice_id = ${a}.id AND x.job_card_id = ${p}))`;
/** The job cards an invoice is for: its own job, or every job on a combined invoice. */
export async function jobsOfInvoice(c: PoolClient, inv: { id: string; job_card_id: string | null }): Promise<string[]> {
  if (inv.job_card_id) return [inv.job_card_id];
  return (await c.query("SELECT job_card_id FROM sales_invoice_job WHERE invoice_id = $1 ORDER BY job_card_id", [inv.id])).rows.map((r) => r.job_card_id as string);
}

async function invoiceBasis(c: PoolClient, jobId: string, lineIds?: string[] | null) {
  const j = await c.query("SELECT * FROM job_card WHERE id = $1", [jobId]);
  if (!j.rowCount) throw notFound("Job card");
  const job = j.rows[0];
  // Lines come only from approved job lines (IV-01), priced as on the latest approved quotation line.
  const all = (await c.query(
    `SELECT l.id job_line_id, l.line_no, l.line_type, l.description, l.qty, l.issued_qty, l.item_id, ql.unit_price, ql.line_discount, ql.doc_discount_share,
            ql.taxable_amount, ql.vat_code, ql.vat_rate, ql.vat_amount, ql.line_total, ql.quotation_id
       FROM job_line l
       JOIN LATERAL (SELECT ql.* FROM quotation_line ql JOIN quotation q ON q.id = ql.quotation_id
                      WHERE ql.job_line_id = l.id AND ql.decision = 'approved' ORDER BY q.revision DESC LIMIT 1) ql ON true
      WHERE l.job_card_id = $1 AND NOT l.removed AND l.approval_status = 'approved' AND l.warranty_claim_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM sales_invoice_line sil WHERE sil.job_line_id = l.id)
      ORDER BY l.line_no`, [jobId])).rows;
  const lines = lineIds && lineIds.length ? all.filter((l) => lineIds.includes(l.job_line_id)) : all;
  if (lineIds && lineIds.length && lines.length !== new Set(lineIds).size) throw invalid("A chosen line is already billed or not approved.");
  const latestApproved = (await c.query(
    "SELECT * FROM quotation WHERE job_card_id = $1 AND status IN ('approved','partly_approved') ORDER BY revision DESC LIMIT 1", [jobId])).rows[0];
  const invoicedBefore = D((await c.query("SELECT coalesce(sum(sil.line_total),0) t FROM sales_invoice_line sil JOIN job_line l ON l.id = sil.job_line_id WHERE l.job_card_id = $1", [jobId])).rows[0].t);
  const taxable = lines.reduce((s, l) => s.plus(l.taxable_amount), D(0));
  const vat = lines.reduce((s, l) => s.plus(l.vat_amount), D(0));
  const total = taxable.plus(vat);
  const notIssued = lines.filter((l) => ["part", "consumable"].includes(l.line_type) && D(l.issued_qty).lt(l.qty));
  // IV-01: every part issued to the job must be on an approved line.
  const strayIssue = (await c.query(
    `SELECT DISTINCT i.part_no FROM stock_move m JOIN job_line l ON l.id = m.job_line_id JOIN item i ON i.id = m.item_id
      WHERE l.job_card_id = $1 AND m.move_type = 'issue' AND (l.removed OR l.approval_status <> 'approved')`, [jobId])).rows.map((r) => r.part_no);
  const late = job.promised_at && new Date(job.promised_at) < new Date(job.ready_at ?? Date.now()) && !job.delay_reason;
  const checks: Check[] = [
    { ok: BILLABLE_STATUS.includes(job.status), text: "Job is Ready, Delivered or already part-invoiced" },
    { ok: lines.length > 0, text: "There are approved lines not yet invoiced" },
    { ok: notIssued.length === 0, text: notIssued.length ? `Parts not issued from the store: ${notIssued.map((l) => l.description).join(", ")}` : "All approved parts on these lines are issued to the job" },
    { ok: strayIssue.length === 0, text: strayIssue.length ? `Parts issued to the job but not on an approved line: ${strayIssue.join(", ")}` : "Every part issued to the job is on an approved line" },
    { ok: !!latestApproved && invoicedBefore.plus(total).lte(latestApproved.approved_total), text: "Not above the approved quotation (QT-07)" },
    { ok: !late, text: late ? "Job was late and has no delay reason" : "Delay reason recorded if the job was late" },
  ];
  return { job, lines, allLines: all, taxable, vat, total, checks, latestApproved };
}

/** Advances held for this customer at this branch (job-linked first). */
async function openAdvances(c: PoolClient, customerId: string, branchId: string, jobId?: string | null) {
  return (await c.query(
    `SELECT a.*, a.amount - a.used_amount open FROM customer_advance a WHERE a.customer_id = $1 AND a.branch_id = $2 AND a.used_amount < a.amount
      ORDER BY (a.job_card_id IS NOT DISTINCT FROM $3) DESC, a.created_at`, [customerId, branchId, jobId ?? null])).rows;
}

export async function invoiceDraft(ctx: Ctx, jobId: string) {
  return withTx(ctx, async (c) => {
    const b = await invoiceBasis(c, jobId);
    assertCan(ctx, "invoices", "view", b.job.branch_id);
    if (!canSee(ctx, "selling_price", b.job.branch_id)) throw invalid("You cannot see prices.");
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [b.job.customer_id])).rows[0];
    const fleets = (await c.query("SELECT id, company_name, trn, credit_limit, payment_terms_days FROM customer WHERE customer_type <> 'individual' AND active ORDER BY company_name")).rows;
    const advances = await openAdvances(c, b.job.customer_id, b.job.branch_id, jobId);
    const kind = await invoiceKindFor(c, cust, b.total, b.job.branch_id);
    return { ...b, taxable: b.taxable.toFixed(2), vat: b.vat.toFixed(2), total: b.total.toFixed(2), customer: cust, billToDefault: billToName(cust), fleets, advances, kind };
  });
}

// =====================================================================================
// Posting a tax invoice from a job (IV-01, IV-02, IV-04)
// =====================================================================================

export type InvoiceOptions = { lineIds?: string[] | null; billTo?: "customer" | "fleet" | "warranty"; fleetCustomerId?: string | null; claimRef?: string | null; notes?: string | null };

/**
 * Posts the tax invoice for the chosen job lines (all unbilled lines by default). Split billing
 * (IV-04): lines can go to the customer, to a fleet company, or to warranty (an internal claim,
 * not a tax invoice). The number is given at posting in the same transaction (no gaps), the date
 * is the server date, and the issued parts' cost moves from work in progress to cost of sales.
 * Advances held for the customer on this job are applied automatically. Idempotent by key.
 */

export async function postInvoice(ctx: Ctx, jobId: string, idempotencyKey: string, opts: InvoiceOptions = {}) {
  if (!idempotencyKey || idempotencyKey.length < 16) throw invalid("Missing idempotency key.");
  if (opts.billTo === "warranty") return postWarrantyClaim(ctx, jobId, opts);
  type Out = { id: string; docNo: string; duplicate: boolean; kind: "invoice" };
  return withTx(ctx, async (c) => {
    // The key is bound to the job, the chosen lines and the bill-to: the same key for anything else is refused (CONC-04).
    const replay = await claimRequest<Out>(c, ctx, idempotencyKey, "invoice", {
      jobId, lines: [...(opts.lineIds ?? [])].sort(), billTo: opts.billTo ?? "customer", fleet: opts.fleetCustomerId ?? null, notes: optStr(opts.notes) ?? null });
    if (replay) return replay;
    const prior = await c.query("SELECT id, job_card_id, doc_no FROM sales_invoice WHERE idempotency_key = $1", [idempotencyKey]);
    if (prior.rowCount) {
      if (prior.rows[0].job_card_id !== jobId) throw conflict("This request key was already used for another invoice.");
      return finishRequest<Out>(c, idempotencyKey, { id: prior.rows[0].id as string, docNo: prior.rows[0].doc_no as string, duplicate: true, kind: "invoice" as const });
    }
    const lock = await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId]);
    if (!lock.rowCount) throw notFound("Job card");
    assertCan(ctx, "invoices", "create", lock.rows[0].branch_id);
    await lockSeries(c, lock.rows[0].branch_id, ["invoice", "journal"]);
    const b = await invoiceBasis(c, jobId, opts.lineIds);
    const failed = b.checks.filter((x) => !x.ok);
    if (failed.length) throw invalid(`Cannot post the invoice: ${failed.map((x) => x.text).join("; ")}.`);
    const job = b.job;
    let cust = (await c.query("SELECT * FROM customer WHERE id = $1", [job.customer_id])).rows[0];
    let billToType: "customer" | "fleet" = "customer";
    if (opts.billTo === "fleet") {
      const f = opts.fleetCustomerId ? (await c.query("SELECT * FROM customer WHERE id = $1 AND active", [opts.fleetCustomerId])).rows[0] : null;
      if (!f || f.customer_type === "individual") throw invalid("Choose the fleet or company to bill.");
      cust = f; billToType = "fleet";
    }
    if (cust.lpo_required && !job.lpo_no) throw invalid(`${billToName(cust)} needs an LPO number on the job card before invoicing.`);
    const docNo = await nextDocNo(c, job.branch_id, "invoice");
    const date = today();
    const due = addDaysLocal(Number(cust.payment_terms_days));
    const kind = await invoiceKindFor(c, cust, b.total, job.branch_id);
    if (kind === "tax") await assertBuyerEinvoiceDetails(c, cust, job.branch_id);
    const labour = b.lines.filter((l) => l.line_type === "labour" || l.line_type === "outside").reduce((s, l) => s.plus(l.taxable_amount), D(0));
    const other = b.taxable.minus(labour);
    const costs = await issuedCostByLine(c, b.lines.map((l) => l.job_line_id));
    const issuedCost = Object.values(costs).reduce((s, v) => s.plus(v), D(0));
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
    if (!jr) throw invalid("Nothing to invoice.");
    const inv = await c.query(
      `INSERT INTO sales_invoice (branch_id, doc_no, doc_date, job_card_id, quotation_id, customer_id, bill_to_name, customer_trn, lpo_no, taxable_total, vat_total, grand_total,
                                  due_date, idempotency_key, journal_id, posted_by, invoice_kind, source, bill_to_type, bill_to_address, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'job',$18,$19,$20) RETURNING id`,
      [job.branch_id, docNo, date, job.id, b.latestApproved.id, cust.id, billToName(cust), cust.trn, job.lpo_no, b.taxable.toFixed(2), b.vat.toFixed(2), b.total.toFixed(2),
        due, idempotencyKey, jr.id, ctx.userId, kind, billToType, optStr(cust.address), optStr(opts.notes)]);
    const invId = inv.rows[0].id as string;
    for (const [i, l] of b.lines.entries()) {
      await c.query(
        `INSERT INTO sales_invoice_line (invoice_id, branch_id, job_line_id, line_no, line_type, description, qty, unit_price, discount_amount, taxable_amount, vat_code, vat_rate, vat_amount, line_total, item_id, cost_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [invId, job.branch_id, l.job_line_id, i + 1, l.line_type, l.description, l.qty, l.unit_price, D(l.line_discount).plus(l.doc_discount_share).toFixed(2),
          l.taxable_amount, l.vat_code, l.vat_rate, l.vat_amount, l.line_total, l.item_id, (costs[l.job_line_id] ?? D(0)).toFixed(2)]);
    }
    const fresh = (await c.query("SELECT * FROM job_card WHERE id = $1", [job.id])).rows[0];
    if (fresh.status !== "invoiced") await setStatus(c, ctx, fresh, "invoiced", `Invoice ${docNo}`);
    await audit(c, ctx, "sales_invoice", invId, "post", { doc_no: docNo, total: b.total.toFixed(2), vat: b.vat.toFixed(2), bill_to: billToType, kind }, job.branch_id);
    // Advances held for this customer on this job are applied straight away (FSD 4.11 rule 5).
    if (billToType === "customer") {
      for (const a of (await openAdvances(c, cust.id, job.branch_id, job.id)).filter((x) => x.job_card_id === job.id)) {
        const invNow = (await c.query("SELECT * FROM sales_invoice WHERE id = $1 FOR UPDATE", [invId])).rows[0];
        const open = D(invNow.grand_total).minus(invNow.paid_amount).minus(invNow.credited_amount);
        if (open.lte(0)) break;
        await applyAdvanceTx(c, ctx, a.id, invId, Decimal.min(open, D(a.open)));
      }
    }
    await maybeCloseJob(c, ctx, job.id);
    return finishRequest<Out>(c, idempotencyKey, { id: invId, docNo, duplicate: false, kind: "invoice" as const });
  });
}

async function issuedCostByLine(c: PoolClient, lineIds: string[]) {
  const out: Record<string, Decimal> = {};
  if (!lineIds.length) return out;
  for (const r of (await c.query(
    `SELECT job_line_id, coalesce(sum(CASE WHEN move_type = 'issue' THEN value ELSE -value END),0) v FROM stock_move
      WHERE job_line_id = ANY($1) AND move_type IN ('issue','return') GROUP BY job_line_id`, [lineIds])).rows) out[r.job_line_id] = D(r.v);
  // Parts bought for the job (021) are in work in progress at cost too.
  for (const r of (await c.query("SELECT id, direct_cost FROM job_line WHERE id = ANY($1) AND direct_cost > 0", [lineIds])).rows)
    out[r.id] = (out[r.id] ?? D(0)).plus(r.direct_cost);
  return out;
}

/** JC-08: warranty lines become an internal claim; their parts' cost goes to warranty expense, not to sales. */
async function postWarrantyClaim(ctx: Ctx, jobId: string, opts: InvoiceOptions) {
  if (!opts.lineIds || !opts.lineIds.length) throw invalid("Choose the lines covered by warranty.");
  return withTx(ctx, async (c) => {
    const lock = await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId]);
    if (!lock.rowCount) throw notFound("Job card");
    const job = lock.rows[0];
    assertCan(ctx, "invoices", "create", job.branch_id);
    const b = await invoiceBasis(c, jobId, opts.lineIds);
    const failed = b.checks.filter((x) => !x.ok && !x.text.startsWith("Not above"));
    if (failed.length) throw invalid(`Cannot post the warranty claim: ${failed.map((x) => x.text).join("; ")}.`);
    const docNo = await nextDocNo(c, job.branch_id, "warranty_claim");
    const costs = await issuedCostByLine(c, b.lines.map((l) => l.job_line_id));
    const cost = Object.values(costs).reduce((s, v) => s.plus(v), D(0));
    const jr = await postJournal(c, ctx, {
      branchId: job.branch_id, date: today(), sourceType: "warranty_claim", sourceId: job.id, narration: `Warranty claim ${docNo} for ${job.doc_no}`,
      lines: [{ event: "warranty_expense", debit: cost }, { event: "work_in_progress", credit: cost }],
    });
    const w = await c.query(
      "INSERT INTO warranty_claim (branch_id, doc_no, doc_date, job_card_id, claim_ref, value_at_price, cost_value, journal_id, posted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [job.branch_id, docNo, today(), jobId, optStr(opts.claimRef), b.total.toFixed(2), cost.toFixed(2), jr?.id ?? null, ctx.userId]);
    await c.query("UPDATE job_line SET warranty_claim_id = $2, version = version + 1 WHERE id = ANY($1)", [b.lines.map((l) => l.job_line_id), w.rows[0].id]);
    await audit(c, ctx, "warranty_claim", w.rows[0].id, "post", { doc_no: docNo, lines: b.lines.length, cost: cost.toFixed(2) }, job.branch_id);
    const rest = await invoiceBasis(c, jobId);
    const fresh = (await c.query("SELECT * FROM job_card WHERE id = $1", [jobId])).rows[0];
    if (!rest.allLines.length && fresh.status !== "invoiced") await setStatus(c, ctx, fresh, "invoiced", `Warranty claim ${docNo}`);
    await maybeCloseJob(c, ctx, jobId);
    return { id: w.rows[0].id as string, docNo, duplicate: false, kind: "warranty" as const };
  });
}

/** A job closes when it is invoiced, handed over, nothing is left to bill and every invoice is settled. */
export async function maybeCloseJob(c: PoolClient, ctx: Ctx, jobId: string) {
  const job = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
  if (!job || job.status !== "invoiced" || !job.delivered_at) return false;
  const rest = await invoiceBasis(c, jobId);
  if (rest.allLines.length) return false;
  const open = (await c.query(`SELECT count(*) n FROM sales_invoice i WHERE ${invOfJob("i", "$1")} AND i.paid_amount + i.credited_amount < i.grand_total`, [jobId])).rows[0].n;
  if (Number(open)) return false;
  await setStatus(c, ctx, job, "closed", "Paid and delivered");
  return true;
}

// =====================================================================================
// Reading invoices
// =====================================================================================

export async function getInvoice(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await c.query(
      `SELECT i.*, b.code branch_code, b.name_en branch_name, b.address branch_address, b.emirate, co.legal_name_en, co.legal_name_ar, co.trn company_trn,
              j.doc_no job_no, v.make, v.model, v.plate_code, v.plate_number, v.registered_in, c.mobile, c.is_walk_in, c.customer_type,
              i.grand_total - i.paid_amount - i.credited_amount open_amount, u.full_name posted_by_name
         FROM sales_invoice i JOIN branch b ON b.id = i.branch_id CROSS JOIN LATERAL (SELECT * FROM company LIMIT 1) co
         LEFT JOIN job_card j ON j.id = i.job_card_id LEFT JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = i.customer_id
         LEFT JOIN app_user u ON u.id = i.posted_by WHERE i.id = $1`, [id]);
    if (!r.rowCount) throw notFound("Invoice");
    assertCan(ctx, "invoices", "view", r.rows[0].branch_id);
    const jobs = r.rows[0].job_card_id ? [] : (await c.query(
      `SELECT x.job_card_id id, j.doc_no, v.plate_code, v.plate_number, v.make, v.model, x.taxable_total, x.vat_total, x.grand_total
         FROM sales_invoice_job x JOIN job_card j ON j.id = x.job_card_id JOIN vehicle v ON v.id = j.vehicle_id WHERE x.invoice_id = $1 ORDER BY j.doc_no`, [id])).rows;
    return { ...(await invoiceParts(c, r.rows[0])), jobs, advances: await openAdvances(c, r.rows[0].customer_id, r.rows[0].branch_id, r.rows[0].job_card_id) };
  });
}

async function invoiceParts(c: PoolClient, invoice: Row) {
  const id = invoice.id;
  const lines = (await c.query("SELECT * FROM sales_invoice_line WHERE invoice_id = $1 ORDER BY line_no", [id])).rows;
  const receipts = (await c.query(
    `SELECT r.id, r.doc_no, r.method, ra.amount, r.doc_date, ra.reversed, r.cheque_no, r.cheque_status, pm.name method_name
       FROM receipt_allocation ra JOIN receipt r ON r.id = ra.receipt_id LEFT JOIN payment_method pm ON pm.code = r.method WHERE ra.invoice_id = $1 ORDER BY ra.at`, [id])).rows;
  const applied = (await c.query(
    `SELECT ap.amount, ap.applied_at, a.source, a.source_no FROM advance_application ap JOIN customer_advance a ON a.id = ap.advance_id WHERE ap.invoice_id = $1 ORDER BY ap.applied_at`, [id])).rows;
  const credits = (await c.query("SELECT id, doc_no, status, grand_total, reason, created_at, doc_date FROM credit_note WHERE invoice_id = $1 ORDER BY created_at", [id])).rows;
  return { invoice, lines, receipts, applied, credits };
}

/** Customer view of a posted invoice through its share link (sent by staff themselves on WhatsApp). */
export async function publicInvoice(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const head = await withAnonTx(async (c) => (await c.query("SELECT id, branch_id FROM invoice_by_token($1)", [token])).rows[0]);
  if (!head) return null;
  return withBranchSystemTx(head.branch_id, async (c) => {
    const r = await c.query(
      `SELECT i.*, b.code branch_code, b.name_en branch_name, b.address branch_address, b.emirate, co.legal_name_en, co.legal_name_ar, co.trn company_trn,
              j.doc_no job_no, v.make, v.model, v.plate_code, v.plate_number, v.registered_in, i.grand_total - i.paid_amount - i.credited_amount open_amount
         FROM sales_invoice i JOIN branch b ON b.id = i.branch_id CROSS JOIN LATERAL (SELECT * FROM company LIMIT 1) co
         LEFT JOIN job_card j ON j.id = i.job_card_id LEFT JOIN vehicle v ON v.id = j.vehicle_id WHERE i.id = $1`, [head.id]);
    const p = await invoiceParts(c, r.rows[0]);
    return { invoice: p.invoice, lines: p.lines };
  });
}

export async function listInvoices(ctx: Ctx, filter: { status?: string; q?: string } = {}) {
  assertCan(ctx, "invoices", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT i.id, i.doc_no, i.doc_date, i.bill_to_name, i.grand_total, i.paid_amount, i.credited_amount, i.invoice_kind, i.source, i.bill_to_type,
            i.grand_total - i.paid_amount - i.credited_amount open_amount, i.due_date, b.code branch_code, j.doc_no job_no
       FROM sales_invoice i JOIN branch b ON b.id = i.branch_id LEFT JOIN job_card j ON j.id = i.job_card_id
      WHERE ($1 = '' OR ($1 = 'open' AND i.paid_amount + i.credited_amount < i.grand_total) OR ($1 = 'settled' AND i.paid_amount + i.credited_amount >= i.grand_total)
             OR ($1 = 'overdue' AND i.paid_amount + i.credited_amount < i.grand_total AND i.due_date < (now() AT TIME ZONE 'Asia/Dubai')::date))
        AND ($2 = '' OR i.doc_no ILIKE '%' || $2 || '%' OR i.bill_to_name ILIKE '%' || $2 || '%' OR j.doc_no ILIKE '%' || $2 || '%')
      ORDER BY i.posted_at DESC LIMIT 300`, [filter.status ?? "", str(filter.q)])).rows);
}

// =====================================================================================
// Receipts, cheques and advances (PY-01, PY-02, AC-17)
// =====================================================================================

export type PayIn = { method: string; amount: unknown; reference?: string; cheque_no?: string; cheque_bank?: string; cheque_date?: string; idempotency_key: string };

export async function paymentMethod(c: PoolClient, f: PayIn) {
  const pm = (await c.query("SELECT * FROM payment_method WHERE code = $1 AND active", [f.method])).rows[0];
  if (!pm) throw invalid("Choose a payment method.");
  const isCheque = pm.posting_event === "pdc_received";
  if (isCheque) {
    if (!str(f.cheque_no)) throw invalid("Enter the cheque number.");
    if (!str(f.cheque_bank)) throw invalid("Enter the bank of the cheque.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f.cheque_date))) throw invalid("Enter the cheque date.");
  } else if (pm.needs_reference && !str(f.reference)) throw invalid(`${pm.name} needs a reference.`);
  return { pm, isCheque };
}

/** PY-03: once a cashier's day is closed, no more cash can be taken under that day. */
export async function assertCashOpen(c: PoolClient, ctx: Ctx, branchId: string, pm: Row) {
  if (pm.posting_event !== "cash_drawer") return;
  const s = await c.query("SELECT status FROM cash_session WHERE branch_id = $1 AND cashier_id = $2 AND session_date = $3", [branchId, ctx.userId, today()]);
  if (s.rowCount) throw invalid("Your cash for today is already closed. Ask another cashier to take this cash payment, or take it tomorrow.");
}

/**
 * Receipt against an invoice, allocated bill by bill (AC-13). Any excess is held for the customer as
 * an advance. Idempotent: the same key and request return the first receipt; the same key with a
 * different request is refused.
 */
export async function recordReceipt(ctx: Ctx, f: PayIn & { invoice_id: string }) {
  return withTx(ctx, async (c) => receiptTx(c, ctx, f));
}

export async function receiptTx(c: PoolClient, ctx: Ctx, f: PayIn & { invoice_id: string }) {
  const amount = parseDec(f.amount, "Amount", { min: "0.01", dp: 2 });
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  const hash = crypto.createHash("sha256").update(JSON.stringify([f.invoice_id, f.method, amount.toFixed(2), str(f.reference), str(f.cheque_no), str(f.cheque_bank), str(f.cheque_date)])).digest("hex");
  type Out = { id: string; docNo: string; duplicate: boolean; onAccount: string };
  const replay = await claimRequest<Out>(c, ctx, f.idempotency_key, "receipt", hash);
  if (replay) return replay;
  const prior = await c.query("SELECT id, doc_no, request_hash FROM receipt WHERE idempotency_key = $1", [f.idempotency_key]);
  if (prior.rowCount) {
    if (prior.rows[0].request_hash !== hash) throw conflict("This request key was already used for a different payment.");
    return finishRequest<Out>(c, f.idempotency_key, { id: prior.rows[0].id as string, docNo: prior.rows[0].doc_no as string, duplicate: true, onAccount: "0.00" });
  }
  const { pm, isCheque } = await paymentMethod(c, f);
  // Same lock order as invoicing: job card, then invoice, then number series (CONC-02).
  const head = (await c.query("SELECT id, job_card_id FROM sales_invoice WHERE id = $1", [f.invoice_id])).rows[0];
  const invJobs = head ? await jobsOfInvoice(c, head) : [];
  for (const j of invJobs) await lockJobFirst(c, j);
  const inv = await c.query("SELECT * FROM sales_invoice WHERE id = $1 FOR UPDATE", [f.invoice_id]);
  if (!inv.rowCount) throw notFound("Invoice");
  const invoice = inv.rows[0];
  assertCan(ctx, "invoices", "create", invoice.branch_id);
  await lockSeries(c, invoice.branch_id, ["receipt", "journal"]);
  await assertCashOpen(c, ctx, invoice.branch_id, pm);
  const open = D(invoice.grand_total).minus(invoice.paid_amount).minus(invoice.credited_amount);
  const alloc = amount.lt(open) ? amount : Decimal.max(open, 0);
  const onAccount = amount.minus(alloc);
  const docNo = await nextDocNo(c, invoice.branch_id, "receipt");
  const date = today();
  const jr = await postJournal(c, ctx, {
    branchId: invoice.branch_id, date, sourceType: "receipt", sourceId: invoice.id, narration: `Receipt ${docNo} against ${invoice.doc_no}`,
    lines: [
      { event: pm.posting_event, debit: amount },
      { event: "trade_receivable", credit: alloc, customerId: invoice.customer_id },
      { event: "customer_advances", credit: onAccount, customerId: invoice.customer_id },
    ],
  });
  const r = await c.query(
    `INSERT INTO receipt (branch_id, doc_no, doc_date, customer_id, method, amount, reference, idempotency_key, request_hash, journal_id, posted_by, kind, job_card_id,
                          cheque_no, cheque_bank, cheque_date, cheque_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'invoice',$12,$13,$14,$15,$16) RETURNING id`,
    [invoice.branch_id, docNo, date, invoice.customer_id, f.method, amount.toFixed(2), optStr(f.reference), f.idempotency_key, hash, jr!.id, ctx.userId, invoice.job_card_id,
      isCheque ? str(f.cheque_no) : null, isCheque ? str(f.cheque_bank) : null, isCheque ? f.cheque_date : null, isCheque ? "held" : null]);
  const rid = r.rows[0].id as string;
  if (alloc.gt(0)) {
    await c.query("INSERT INTO receipt_allocation (receipt_id, invoice_id, branch_id, amount) VALUES ($1,$2,$3,$4)", [rid, invoice.id, invoice.branch_id, alloc.toFixed(2)]);
    await c.query("UPDATE sales_invoice SET paid_amount = paid_amount + $2 WHERE id = $1", [invoice.id, alloc.toFixed(2)]);
  }
  if (onAccount.gt(0)) {
    await c.query("INSERT INTO customer_advance (branch_id, customer_id, job_card_id, source, source_id, source_no, amount) VALUES ($1,$2,$3,'overpayment',$4,$5,$6)",
      [invoice.branch_id, invoice.customer_id, invoice.job_card_id, rid, docNo, onAccount.toFixed(2)]);
  }
  for (const j of invJobs) await maybeCloseJob(c, ctx, j);
  await audit(c, ctx, "receipt", rid, "post", { doc_no: docNo, amount: amount.toFixed(2), allocated: alloc.toFixed(2), on_account: onAccount.toFixed(2), method: f.method }, invoice.branch_id);
  return finishRequest<Out>(c, f.idempotency_key, { id: rid, docNo, duplicate: false, onAccount: onAccount.toFixed(2) });
}

/**
 * PY-02 deposit or advance before work starts, optionally for a job. With the VAT-on-advances
 * setting on (FTA rule: payment before supply), VAT is accounted on the advance now and reversed
 * when it is applied to the final invoice, so the total VAT equals the invoice VAT.
 */
export async function recordAdvance(ctx: Ctx, f: PayIn & { customer_id: string; job_card_id?: string | null }) {
  const amount = parseDec(f.amount, "Amount", { min: "0.01", dp: 2 });
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  const branchId = ctx.currentBranchId;
  if (!branchId) throw invalid("Choose a branch first.");
  const hash = crypto.createHash("sha256").update(JSON.stringify(["advance", branchId, f.customer_id, f.job_card_id ?? "", f.method, amount.toFixed(2), str(f.reference), str(f.cheque_no), str(f.cheque_bank), str(f.cheque_date)])).digest("hex");
  type Out = { id: string; docNo: string; duplicate: boolean; vat: string };
  return withTx(ctx, async (c) => {
    const replay = await claimRequest<Out>(c, ctx, f.idempotency_key, "advance", hash);
    if (replay) return replay;
    const prior = await c.query("SELECT id, doc_no, request_hash FROM receipt WHERE idempotency_key = $1", [f.idempotency_key]);
    if (prior.rowCount) {
      if (prior.rows[0].request_hash !== hash) throw conflict("This request key was already used for a different payment.");
      return finishRequest<Out>(c, f.idempotency_key, { id: prior.rows[0].id as string, docNo: prior.rows[0].doc_no as string, duplicate: true, vat: "0.00" });
    }
    let bId = branchId;
    if (f.job_card_id) {
      const j = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [f.job_card_id])).rows[0];
      if (!j) throw notFound("Job card");
      if (j.customer_id !== f.customer_id) throw invalid("The job card belongs to another customer.");
      if (["closed", "cancelled"].includes(j.status)) throw invalid("The job is closed.");
      bId = j.branch_id;
    }
    assertCan(ctx, "invoices", "create", bId);
    await lockSeries(c, bId, ["receipt", "journal"]);
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1 AND active", [f.customer_id])).rows[0];
    if (!cust || cust.is_walk_in) throw invalid("Choose the customer.");
    const { pm, isCheque } = await paymentMethod(c, f);
    await assertCashOpen(c, ctx, bId, pm);
    const vatOn = await getSetting<unknown>(c, "billing.vat_on_advances", bId, true);
    const vat = vatOn && vatOn !== "false" ? r2(amount.minus(amount.div(1.05))) : D(0);
    const docNo = await nextDocNo(c, bId, "receipt");
    const jr = await postJournal(c, ctx, {
      branchId: bId, date: today(), sourceType: "advance", sourceId: f.customer_id, narration: `Advance ${docNo}${f.job_card_id ? " for a job" : ""}`,
      lines: [
        { event: pm.posting_event, debit: amount },
        { event: "customer_advances", credit: amount.minus(vat), customerId: f.customer_id },
        { event: "vat_output", credit: vat },
      ],
    });
    const r = await c.query(
      `INSERT INTO receipt (branch_id, doc_no, doc_date, customer_id, method, amount, reference, idempotency_key, request_hash, journal_id, posted_by, kind, job_card_id, vat_amount,
                            cheque_no, cheque_bank, cheque_date, cheque_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'advance',$12,$13,$14,$15,$16,$17) RETURNING id`,
      [bId, docNo, today(), f.customer_id, f.method, amount.toFixed(2), optStr(f.reference), f.idempotency_key, hash, jr!.id, ctx.userId, optStr(f.job_card_id), vat.toFixed(2),
        isCheque ? str(f.cheque_no) : null, isCheque ? str(f.cheque_bank) : null, isCheque ? f.cheque_date : null, isCheque ? "held" : null]);
    await c.query("INSERT INTO customer_advance (branch_id, customer_id, job_card_id, source, source_id, source_no, amount, vat_amount) VALUES ($1,$2,$3,'advance',$4,$5,$6,$7)",
      [bId, f.customer_id, optStr(f.job_card_id), r.rows[0].id, docNo, amount.toFixed(2), vat.toFixed(2)]);
    await audit(c, ctx, "receipt", r.rows[0].id, "advance", { doc_no: docNo, amount: amount.toFixed(2), vat: vat.toFixed(2) }, bId);
    return finishRequest<Out>(c, f.idempotency_key, { id: r.rows[0].id as string, docNo, duplicate: false, vat: vat.toFixed(2) });
  });
}

async function applyAdvanceTx(c: PoolClient, ctx: Ctx, advanceId: string, invoiceId: string, amount: Decimal) {
  const a = (await c.query("SELECT * FROM customer_advance WHERE id = $1 FOR UPDATE", [advanceId])).rows[0];
  if (!a) throw notFound("Advance");
  const inv = (await c.query("SELECT * FROM sales_invoice WHERE id = $1 FOR UPDATE", [invoiceId])).rows[0];
  if (!inv) throw notFound("Invoice");
  if (a.customer_id !== inv.customer_id) throw invalid("The advance belongs to another customer.");
  if (a.branch_id !== inv.branch_id) throw invalid("The advance was taken at another branch. Apply it at that branch.");
  const left = D(a.amount).minus(a.used_amount);
  const open = D(inv.grand_total).minus(inv.paid_amount).minus(inv.credited_amount);
  if (amount.lte(0) || amount.gt(left) || amount.gt(open)) throw invalid(`You can apply up to AED ${Decimal.min(left, open).toFixed(2)}.`);
  // The VAT part of the advance follows the amount used; the last use takes what is left so nothing is stranded.
  const vatUsed = D((await c.query("SELECT coalesce(sum(vat_amount),0) v FROM advance_application WHERE advance_id = $1", [advanceId])).rows[0].v);
  const vatPart = amount.eq(left) ? D(a.vat_amount).minus(vatUsed) : r2(D(a.vat_amount).mul(amount).div(a.amount));
  const lines: PostLine[] = [
    { event: "customer_advances", debit: amount.minus(vatPart), customerId: a.customer_id },
    { event: "vat_output", debit: vatPart },
    { event: "trade_receivable", credit: amount, customerId: a.customer_id },
  ];
  const jr = await postJournal(c, ctx, { branchId: inv.branch_id, date: today(), sourceType: "advance_application", sourceId: inv.id, narration: `${a.source_no} applied to ${inv.doc_no}`, lines });
  await c.query("INSERT INTO advance_application (branch_id, advance_id, invoice_id, amount, vat_amount, journal_id, applied_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [inv.branch_id, advanceId, invoiceId, amount.toFixed(2), vatPart.toFixed(2), jr!.id, ctx.userId]);
  await c.query("UPDATE customer_advance SET used_amount = used_amount + $2 WHERE id = $1", [advanceId, amount.toFixed(2)]);
  await c.query("UPDATE sales_invoice SET paid_amount = paid_amount + $2 WHERE id = $1", [invoiceId, amount.toFixed(2)]);
  await audit(c, ctx, "sales_invoice", invoiceId, "advance_applied", { advance: a.source_no, amount: amount.toFixed(2) }, inv.branch_id);
}

export async function applyAdvance(ctx: Ctx, invoiceId: string, advanceId: string, amount?: unknown) {
  return withTx(ctx, async (c) => {
    const inv = (await c.query("SELECT * FROM sales_invoice WHERE id = $1", [invoiceId])).rows[0];
    if (!inv) throw notFound("Invoice");
    assertCan(ctx, "invoices", "create", inv.branch_id);
    const invJobs = await jobsOfInvoice(c, inv);
    for (const j of invJobs) await lockJobFirst(c, j);
    const a = (await c.query("SELECT * FROM customer_advance WHERE id = $1", [advanceId])).rows[0];
    if (!a) throw notFound("Advance");
    const open = D(inv.grand_total).minus(inv.paid_amount).minus(inv.credited_amount);
    const amt = str(amount) ? parseDec(amount, "Amount", { min: "0.01", dp: 2 }) : Decimal.min(open, D(a.amount).minus(a.used_amount));
    await applyAdvanceTx(c, ctx, advanceId, invoiceId, amt);
    for (const j of invJobs) await maybeCloseJob(c, ctx, j);
  });
}

export async function listAdvances(ctx: Ctx, customerId?: string) {
  assertCan(ctx, "invoices", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT a.*, a.amount - a.used_amount open, b.code branch_code, j.doc_no job_no,
            CASE WHEN cu.customer_type = 'individual' THEN concat_ws(' ', cu.title, cu.first_name, cu.last_name) ELSE 'M/s. ' || cu.company_name END customer_name
       FROM customer_advance a JOIN branch b ON b.id = a.branch_id JOIN customer cu ON cu.id = a.customer_id LEFT JOIN job_card j ON j.id = a.job_card_id
      WHERE ($1::uuid IS NULL OR a.customer_id = $1) ORDER BY (a.used_amount < a.amount) DESC, a.created_at DESC LIMIT 300`, [customerId ?? null])).rows);
}

// ---------- post-dated cheque register (AC-17) ----------

export async function listCheques(ctx: Ctx, status = "held") {
  assertCan(ctx, "invoices", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT r.id, r.doc_no, r.doc_date, r.amount, r.cheque_no, r.cheque_bank, r.cheque_date, r.cheque_status, r.cheque_event_at, r.cheque_note, r.kind, b.code branch_code,
            CASE WHEN cu.customer_type = 'individual' THEN concat_ws(' ', cu.title, cu.first_name, cu.last_name) ELSE 'M/s. ' || cu.company_name END customer_name
       FROM receipt r JOIN branch b ON b.id = r.branch_id JOIN customer cu ON cu.id = r.customer_id
      WHERE r.cheque_status IS NOT NULL AND ($1 = '' OR r.cheque_status = $1) ORDER BY r.cheque_date, r.doc_no`, [status])).rows);
}

/** Cheque deposited and cleared: Dr bank, Cr cheques received. Not before the cheque date. */
export async function clearCheque(ctx: Ctx, receiptId: string) {
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT * FROM receipt WHERE id = $1 FOR UPDATE", [receiptId])).rows[0];
    if (!r) throw notFound("Receipt");
    if (!can(ctx, "invoices", "approve", r.branch_id) && !can(ctx, "invoices", "edit", r.branch_id) && !can(ctx, "accounting", "create", r.branch_id)) throw forbidden("Only a manager or accounts can clear or return a cheque.");
    if (r.cheque_status !== "held") throw invalid("Only a cheque on hand can be cleared.");
    const cd = r.cheque_date instanceof Date ? r.cheque_date.toISOString().slice(0, 10) : String(r.cheque_date);
    if (cd > today()) throw invalid(`This cheque is dated ${cd}. It cannot be deposited before then.`);
    await postJournal(c, ctx, { branchId: r.branch_id, date: today(), sourceType: "cheque_cleared", sourceId: r.id, narration: `Cheque ${r.cheque_no} (${r.doc_no}) cleared`,
      lines: [{ event: "bank", debit: r.amount }, { event: "pdc_received", credit: r.amount }] });
    await c.query("UPDATE receipt SET cheque_status = 'cleared', cheque_event_at = now() WHERE id = $1", [receiptId]);
    await audit(c, ctx, "receipt", receiptId, "cheque_cleared", { cheque_no: r.cheque_no }, r.branch_id);
  });
}

/**
 * A returned cheque reverses the receipt: the invoice opens again (and a closed job goes back to
 * Invoiced), or the advance it created is withdrawn. Refused if that advance was already used.
 */
export async function bounceCheque(ctx: Ctx, receiptId: string, note: string) {
  const why = str(note);
  if (!why) throw invalid("Say why the cheque was returned.");
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT * FROM receipt WHERE id = $1 FOR UPDATE", [receiptId])).rows[0];
    if (!r) throw notFound("Receipt");
    if (!can(ctx, "invoices", "approve", r.branch_id) && !can(ctx, "invoices", "edit", r.branch_id) && !can(ctx, "accounting", "create", r.branch_id)) throw forbidden("Only a manager or accounts can clear or return a cheque.");
    if (!["held", "cleared"].includes(r.cheque_status)) throw invalid("This cheque is not on hand or cleared.");
    const adv = (await c.query("SELECT * FROM customer_advance WHERE source_id = $1 FOR UPDATE", [receiptId])).rows[0];
    if (adv && D(adv.used_amount).gt(0)) throw invalid(`Part of this cheque (${adv.source_no}) was already applied to an invoice. Reverse that first with a credit note.`);
    const allocs = (await c.query("SELECT * FROM receipt_allocation WHERE receipt_id = $1 AND NOT reversed FOR UPDATE", [receiptId])).rows;
    const allocated = allocs.reduce((s, a) => s.plus(a.amount), D(0));
    const advNet = adv ? D(adv.amount).minus(adv.vat_amount) : D(0);
    const lines: PostLine[] = [
      { event: "trade_receivable", debit: allocated, customerId: r.customer_id },
      { event: "customer_advances", debit: advNet, customerId: r.customer_id },
      { event: "vat_output", debit: adv ? D(adv.vat_amount) : D(0) },
      { event: r.cheque_status === "cleared" ? "bank" : "pdc_received", credit: r.amount },
    ];
    await postJournal(c, ctx, { branchId: r.branch_id, date: today(), sourceType: "cheque_returned", sourceId: r.id, narration: `Cheque ${r.cheque_no} (${r.doc_no}) returned: ${why}`, lines });
    for (const a of allocs) {
      await c.query("UPDATE receipt_allocation SET reversed = true WHERE id = $1", [a.id]);
      await c.query("UPDATE sales_invoice SET paid_amount = paid_amount - $2 WHERE id = $1", [a.invoice_id, a.amount]);
      const inv = (await c.query("SELECT id, job_card_id FROM sales_invoice WHERE id = $1", [a.invoice_id])).rows[0];
      for (const jid of inv ? await jobsOfInvoice(c, inv) : []) {
        const job = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jid])).rows[0];
        if (job.status === "closed") await setStatus(c, ctx, job, "invoiced", `Cheque ${r.cheque_no} returned`);
      }
    }
    if (adv) await c.query("UPDATE customer_advance SET used_amount = amount WHERE id = $1", [adv.id]);
    await c.query("UPDATE receipt SET cheque_status = 'bounced', cheque_event_at = now(), cheque_note = $2 WHERE id = $1", [receiptId, why]);
    await audit(c, ctx, "receipt", receiptId, "cheque_returned", { cheque_no: r.cheque_no, reason: why }, r.branch_id);
  });
}

// =====================================================================================
// Car release (PY-04)
// =====================================================================================

/**
 * What the customer still owes on the job: approved work not yet invoiced plus open invoices.
 * The car may go when nothing is owed, the customer is on credit terms within their limit, or an
 * authorised user recorded a credit release for at least the balance.
 */
export async function releaseStatus(c: PoolClient, jobId: string) {
  const b = await invoiceBasis(c, jobId);
  const unbilled = b.allLines.reduce((s, l) => s.plus(l.line_total), D(0));
  const openInv = D((await c.query(`SELECT coalesce(sum(i.grand_total - i.paid_amount - i.credited_amount),0) v FROM sales_invoice i WHERE ${invOfJob("i", "$1")}`, [jobId])).rows[0].v);
  const held = D((await c.query("SELECT coalesce(sum(amount - used_amount),0) v FROM customer_advance WHERE job_card_id = $1", [jobId])).rows[0].v);
  const balance = Decimal.max(unbilled.plus(openInv).minus(held), 0);
  const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [b.job.customer_id])).rows[0];
  const owed = D((await c.query("SELECT coalesce(sum(grand_total - paid_amount - credited_amount),0) v FROM sales_invoice WHERE customer_id = $1", [cust.id])).rows[0].v);
  const creditRoom = D(cust.credit_limit).minus(owed).minus(unbilled);
  const release = (await c.query("SELECT r.*, u.full_name FROM credit_release r JOIN app_user u ON u.id = r.released_by WHERE job_card_id = $1 ORDER BY released_at DESC LIMIT 1", [jobId])).rows[0] ?? null;
  let basis: string | null = null;
  if (balance.lte(0)) basis = "paid";
  else if (Number(cust.payment_terms_days) > 0 && creditRoom.gte(0)) basis = "credit_terms";
  else if (release && D(release.amount).gte(balance)) basis = "credit_release";
  return { balance, unbilled, openInvoices: openInv, held, basis, release, creditTerms: Number(cust.payment_terms_days) > 0, creditRoom };
}

export async function jobRelease(ctx: Ctx, jobId: string) {
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT branch_id FROM job_card WHERE id = $1", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    assertCan(ctx, "jobs", "view", j.branch_id);
    const s = await releaseStatus(c, jobId);
    return { ...s, balance: s.balance.toFixed(2), canRelease: can(ctx, "invoices", "approve", j.branch_id), canSeePrices: canSee(ctx, "selling_price", j.branch_id) };
  });
}

export async function recordCreditRelease(ctx: Ctx, jobId: string, reason: string) {
  const why = str(reason);
  if (why.length < 3) throw invalid("Give the reason for releasing the car unpaid.");
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    if (!can(ctx, "invoices", "approve", j.branch_id)) throw forbidden("Only a manager can release a car with money owing.");
    const s = await releaseStatus(c, jobId);
    if (s.balance.lte(0)) throw invalid("Nothing is owed on this job.");
    await c.query("INSERT INTO credit_release (branch_id, job_card_id, amount, reason, released_by) VALUES ($1,$2,$3,$4,$5)", [j.branch_id, jobId, s.balance.toFixed(2), why, ctx.userId]);
    await audit(c, ctx, "job_card", jobId, "credit_release", { amount: s.balance.toFixed(2), reason: why }, j.branch_id);
  });
}

// =====================================================================================
// Customer statement (open items) used by the invoice and customer pages
// =====================================================================================

export async function customerBalance(ctx: Ctx, customerId: string) {
  return withTx(ctx, async (c) => {
    const inv = (await c.query(
      `SELECT i.id, i.doc_no, i.doc_date, i.due_date, i.grand_total, i.grand_total - i.paid_amount - i.credited_amount open_amount, b.code branch_code
         FROM sales_invoice i JOIN branch b ON b.id = i.branch_id WHERE i.customer_id = $1 AND i.paid_amount + i.credited_amount < i.grand_total ORDER BY i.due_date`, [customerId])).rows;
    const adv = (await c.query("SELECT coalesce(sum(amount - used_amount),0) v FROM customer_advance WHERE customer_id = $1", [customerId])).rows[0].v;
    return { open: inv, advances: String(adv) };
  });
}

/**
 * Pays back money held for a customer (a deposit, an overpayment or credit from a return) in cash, card
 * or transfer. Only a manager (invoices approve) at the branch that holds the money can do it. The VAT
 * part follows the amount, as when an advance is applied. Idempotent like receipts.
 */
export async function refundAdvance(ctx: Ctx, f: { advance_id: string; amount: unknown; method: string; reference?: string; reason: string; idempotency_key: string }) {
  const amount = parseDec(f.amount, "Amount", { min: "0.01", dp: 2 });
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  if (!str(f.reason)) throw invalid("Write why the money is paid back.", { field: "reason" });
  const hash = crypto.createHash("sha256").update(JSON.stringify(["refund", f.advance_id, f.method, amount.toFixed(2), str(f.reference)])).digest("hex");
  type Out = { id: string; docNo: string; duplicate: boolean; vat: string };
  return withTx(ctx, async (c) => {
    const replay = await claimRequest<Out>(c, ctx, f.idempotency_key, "refund", hash);
    if (replay) return replay;
    const prior = await c.query("SELECT id, doc_no, request_hash FROM customer_refund WHERE idempotency_key = $1", [f.idempotency_key]);
    if (prior.rowCount) {
      if (prior.rows[0].request_hash !== hash) throw conflict("This request key was already used for a different refund.");
      return finishRequest<Out>(c, f.idempotency_key, { id: prior.rows[0].id as string, docNo: prior.rows[0].doc_no as string, duplicate: true, vat: "0.00" });
    }
    const a = (await c.query("SELECT * FROM customer_advance WHERE id = $1 FOR UPDATE", [f.advance_id])).rows[0];
    if (!a) throw notFound("Money held");
    if (!can(ctx, "invoices", "approve", a.branch_id)) throw forbidden("Only a manager can pay money back to a customer.");
    if (ctx.currentBranchId !== a.branch_id) throw invalid("This money is held at another branch. Switch to that branch to pay it back.");
    const left = D(a.amount).minus(a.used_amount);
    if (amount.gt(left)) throw invalid(`You can pay back up to AED ${left.toFixed(2)}.`, { field: "amount" });
    const { pm, isCheque } = await paymentMethod(c, { ...f, idempotency_key: f.idempotency_key });
    if (isCheque) throw invalid("Pay a refund in cash, by card or by transfer, not by cheque.", { field: "method" });
    await lockSeries(c, a.branch_id, ["refund", "journal"]);
    await assertCashOpen(c, ctx, a.branch_id, pm);
    const used = D((await c.query(
      `SELECT coalesce((SELECT sum(vat_amount) FROM advance_application WHERE advance_id = $1), 0) + coalesce((SELECT sum(vat_amount) FROM customer_refund WHERE advance_id = $1), 0) v`, [a.id])).rows[0].v);
    const vat = amount.eq(left) ? D(a.vat_amount).minus(used) : r2(D(a.vat_amount).mul(amount).div(a.amount));
    const docNo = await nextDocNo(c, a.branch_id, "refund");
    const jr = await postJournal(c, ctx, {
      branchId: a.branch_id, date: today(), sourceType: "refund", sourceId: a.id, narration: `Refund ${docNo} of ${a.source_no}`,
      lines: [
        { event: "customer_advances", debit: amount.minus(vat), customerId: a.customer_id },
        { event: "vat_output", debit: vat },
        { event: pm.posting_event, credit: amount },
      ],
    });
    const r = await c.query(
      `INSERT INTO customer_refund (branch_id, doc_no, doc_date, customer_id, advance_id, method, amount, vat_amount, reference, reason, idempotency_key, request_hash, journal_id, paid_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [a.branch_id, docNo, today(), a.customer_id, a.id, f.method, amount.toFixed(2), vat.toFixed(2), optStr(f.reference), str(f.reason), f.idempotency_key, hash, jr!.id, ctx.userId]);
    await c.query("UPDATE customer_advance SET used_amount = used_amount + $2 WHERE id = $1", [a.id, amount.toFixed(2)]);
    await audit(c, ctx, "customer_refund", r.rows[0].id, "refund", { doc_no: docNo, advance: a.source_no, amount: amount.toFixed(2), vat: vat.toFixed(2), method: f.method, reason: str(f.reason) }, a.branch_id);
    return finishRequest<Out>(c, f.idempotency_key, { id: r.rows[0].id as string, docNo, duplicate: false, vat: vat.toFixed(2) });
  });
}

// =====================================================================================
// Combined invoice: several finished job cards of one customer on one tax invoice (028)
// =====================================================================================

/** Finished job cards of a customer at this branch with approved work not yet invoiced, for the combined invoice. */
export async function combinableJobs(ctx: Ctx, customerId: string) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "invoices", "create", b);
  if (!canSee(ctx, "selling_price", b)) throw invalid("You cannot see prices.");
  return withTx(ctx, async (c) => {
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [customerId])).rows[0];
    if (!cust) throw notFound("Customer");
    const jobs = (await c.query(
      `SELECT j.id, j.doc_no, j.status, j.lpo_no, to_char(j.ready_at AT TIME ZONE 'Asia/Dubai', 'DD/MM/YYYY') ready_on, v.plate_code, v.plate_number, v.make, v.model
         FROM job_card j JOIN vehicle v ON v.id = j.vehicle_id
        WHERE j.branch_id = $1 AND j.customer_id = $2 AND j.status = ANY($3) ORDER BY j.doc_no`, [b, customerId, BILLABLE_STATUS])).rows;
    const out = [];
    for (const j of jobs) {
      const basis = await invoiceBasis(c, j.id);
      if (!basis.lines.length) continue;
      out.push({ ...j, taxable: basis.taxable.toFixed(2), vat: basis.vat.toFixed(2), total: basis.total.toFixed(2), problems: basis.checks.filter((x) => !x.ok).map((x) => x.text) });
    }
    return { customer: cust, billTo: billToName(cust), jobs: out };
  });
}

/**
 * Posts one tax invoice for several job cards of the same customer at one branch. Each job must pass
 * the same checks as its own invoice; every unbilled approved line of each job goes on it, grouped by job.
 * Every job is marked invoiced with this number and closes when the invoice is paid and the car delivered.
 */
export async function postCombinedInvoice(ctx: Ctx, customerId: string, jobIds: string[], idempotencyKey: string, notes?: string | null) {
  if (!idempotencyKey || idempotencyKey.length < 16) throw invalid("Missing idempotency key.");
  const ids = [...new Set(jobIds)].sort();
  if (ids.length < 2) throw invalid("Tick at least two job cards for a combined invoice.");
  type Out = { id: string; docNo: string; duplicate: boolean; kind: "invoice" };
  return withTx(ctx, async (c) => {
    const replay = await claimRequest<Out>(c, ctx, idempotencyKey, "combined_invoice", { customerId, jobs: ids, notes: optStr(notes) ?? null });
    if (replay) return replay;
    const prior = await c.query("SELECT id, doc_no, customer_id FROM sales_invoice WHERE idempotency_key = $1", [idempotencyKey]);
    if (prior.rowCount) {
      if (prior.rows[0].customer_id !== customerId) throw conflict("This request key was already used for another invoice.");
      return finishRequest<Out>(c, idempotencyKey, { id: prior.rows[0].id as string, docNo: prior.rows[0].doc_no as string, duplicate: true, kind: "invoice" as const });
    }
    // Lock order as everywhere: job cards (sorted), then invoice, then number series (CONC-02).
    const jobs = [];
    for (const id of ids) {
      const j = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!j) throw notFound("Job card");
      jobs.push(j);
    }
    const branchId = jobs[0].branch_id;
    if (jobs.some((j) => j.branch_id !== branchId)) throw invalid("All job cards on one invoice must be from the same branch.");
    if (jobs.some((j) => j.customer_id !== customerId)) throw invalid("All job cards on one invoice must be for the same customer.");
    assertCan(ctx, "invoices", "create", branchId);
    await lockSeries(c, branchId, ["invoice", "journal"]);
    const bases = [];
    for (const j of jobs) {
      const b = await invoiceBasis(c, j.id);
      const failed = b.checks.filter((x) => !x.ok);
      if (failed.length) throw invalid(`${j.doc_no}: ${failed.map((x) => x.text).join("; ")}.`);
      bases.push(b);
    }
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [customerId])).rows[0];
    const lpos = [...new Set(jobs.map((j) => j.lpo_no).filter(Boolean))];
    if (cust.lpo_required && jobs.some((j) => !j.lpo_no)) throw invalid(`${billToName(cust)} needs an LPO number on every job card before invoicing.`);
    const taxable = bases.reduce((s, b) => s.plus(b.taxable), D(0)), vat = bases.reduce((s, b) => s.plus(b.vat), D(0)), total = taxable.plus(vat);
    const lines = bases.flatMap((b) => b.lines);
    const docNo = await nextDocNo(c, branchId, "invoice");
    const date = today();
    const kind = await invoiceKindFor(c, cust, total, branchId);
    if (kind === "tax") await assertBuyerEinvoiceDetails(c, cust, branchId);
    const labour = lines.filter((l) => l.line_type === "labour" || l.line_type === "outside").reduce((s, l) => s.plus(l.taxable_amount), D(0));
    const costs = await issuedCostByLine(c, lines.map((l) => l.job_line_id));
    const issuedCost = Object.values(costs).reduce((s, v) => s.plus(v), D(0));
    const jr = await postJournal(c, ctx, {
      branchId, date, sourceType: "sales_invoice", sourceId: customerId, narration: `Combined tax invoice ${docNo} for ${jobs.map((j) => j.doc_no).join(", ")}`,
      lines: [
        { event: "trade_receivable", debit: total, customerId: cust.id },
        { event: "sales_labour", credit: labour },
        { event: "sales_parts", credit: taxable.minus(labour) },
        { event: "vat_output", credit: vat },
        { event: "cost_of_sales", debit: issuedCost },
        { event: "work_in_progress", credit: issuedCost },
      ],
    });
    if (!jr) throw invalid("Nothing to invoice.");
    const inv = await c.query(
      `INSERT INTO sales_invoice (branch_id, doc_no, doc_date, job_card_id, quotation_id, customer_id, bill_to_name, customer_trn, lpo_no, taxable_total, vat_total, grand_total,
                                  due_date, idempotency_key, journal_id, posted_by, invoice_kind, source, bill_to_type, bill_to_address, notes)
       VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'combined','customer',$16,$17) RETURNING id`,
      [branchId, docNo, date, cust.id, billToName(cust), cust.trn, lpos.join(", ") || null, taxable.toFixed(2), vat.toFixed(2), total.toFixed(2),
        addDaysLocal(Number(cust.payment_terms_days)), idempotencyKey, jr.id, ctx.userId, kind, optStr(cust.address), optStr(notes)]);
    const invId = inv.rows[0].id as string;
    let n = 0;
    for (const [k, j] of jobs.entries()) {
      const b = bases[k];
      await c.query("INSERT INTO sales_invoice_job (invoice_id, job_card_id, branch_id, taxable_total, vat_total, grand_total) VALUES ($1,$2,$3,$4,$5,$6)",
        [invId, j.id, branchId, b.taxable.toFixed(2), b.vat.toFixed(2), b.total.toFixed(2)]);
      for (const l of b.lines) {
        await c.query(
          `INSERT INTO sales_invoice_line (invoice_id, branch_id, job_line_id, line_no, line_type, description, qty, unit_price, discount_amount, taxable_amount, vat_code, vat_rate, vat_amount, line_total, item_id, cost_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [invId, branchId, l.job_line_id, ++n, l.line_type, `${j.doc_no}: ${l.description}`, l.qty, l.unit_price, D(l.line_discount).plus(l.doc_discount_share).toFixed(2),
            l.taxable_amount, l.vat_code, l.vat_rate, l.vat_amount, l.line_total, l.item_id, (costs[l.job_line_id] ?? D(0)).toFixed(2)]);
      }
      const fresh = (await c.query("SELECT * FROM job_card WHERE id = $1", [j.id])).rows[0];
      if (fresh.status !== "invoiced") await setStatus(c, ctx, fresh, "invoiced", `Combined invoice ${docNo}`);
    }
    await audit(c, ctx, "sales_invoice", invId, "post", { doc_no: docNo, total: total.toFixed(2), vat: vat.toFixed(2), combined: jobs.map((j) => j.doc_no), kind }, branchId);
    for (const j of jobs) await maybeCloseJob(c, ctx, j.id);
    return finishRequest<Out>(c, idempotencyKey, { id: invId, docNo, duplicate: false, kind: "invoice" as const });
  });
}
