import type { PoolClient } from "pg";
import { Ctx, assertCan, canSee, fieldLevel, roleAt } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { getSetting } from "./settings";
import { D, Decimal, calcDocument, parseDec, r2 } from "../money";
import { optInt, optStr, str } from "../validate";
import { addLineIn, isBelowMargin, setStatus } from "./jobs";
import { discountPercents, quoteNo } from "./quotations";
import { addDaysLocal, issueToLineIn } from "./stock";
import { createJobCardIn } from "./enquiries";
import { invoiceBasis, maybeCloseJob, postInvoiceIn, receiptTx } from "./billing";
import { claimRequest, finishRequest } from "./requests";

/**
 * Changes made at the till: lines edited or added on the invoice form (before posting), and the quick
 * job (OT-02), where a small job is recorded, approved in person, invoiced and paid on one screen.
 * Both keep the normal order of documents: every change becomes a quotation revision approved in
 * person by the user, so the invoice still comes only from approved lines at the approved price.
 */

const OPEN = ["draft", "pending_internal_approval", "ready_to_send", "sent"];
const BILLABLE = ["ready", "delivered", "invoiced"];

/**
 * Writes a quotation revision for the enquiry, approved in person, from every approved and pending
 * line. Lines in `reprice` (and pending lines) are priced now; the rest keep their approved amounts.
 * Discounts above the user's limit or a below-margin price are refused: those need a manager.
 */
async function approvedRevisionIn(c: PoolClient, ctx: Ctx, enquiryId: string, branchId: string, reprice: Set<string>, note: string) {
  const enq = (await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [enquiryId])).rows[0];
  if (!enq) throw notFound("Enquiry");
  const lines = (await c.query(
    `SELECT l.*, t.rate vat_rate FROM job_line l JOIN tax_code t ON t.code = l.vat_code
      WHERE l.enquiry_id = $1 AND NOT l.removed AND l.approval_status IN ('pending','approved') ORDER BY l.line_no`, [enquiryId])).rows;
  const prev = new Map((await c.query(
    `SELECT DISTINCT ON (ql.job_line_id) ql.* FROM quotation_line ql JOIN quotation qq ON qq.id = ql.quotation_id
      WHERE qq.enquiry_id = $1 AND ql.decision = 'approved' ORDER BY ql.job_line_id, qq.revision DESC`, [enquiryId])).rows.map((r) => [r.job_line_id, r]));
  const fresh = lines.filter((l) => l.approval_status === "pending" || reprice.has(l.id) || !prev.has(l.id));
  if (!fresh.length) throw invalid("Nothing changed.");
  let calcNew;
  try {
    calcNew = calcDocument(fresh.map((l) => ({ key: l.id, qty: l.qty, unitPrice: l.unit_price, lineDiscount: l.discount_amount, vatRate: l.vat_rate })), 0);
  } catch (e) { throw invalid((e as Error).message); }
  const role = roleAt(ctx, branchId);
  const limit = D(await getSetting(c, `discount.max_pct.${role?.roleCode}`, branchId, 0));
  const { maxLinePct } = discountPercents(calcNew.lines, D(0));
  if (maxLinePct.gt(limit)) throw invalid(`Discount ${maxLinePct.toFixed(2)}% is above your limit of ${limit.toFixed(2)}%. Ask a manager to make this change.`);
  const below = fresh.filter((l) => l.below_margin);
  if (below.length) throw invalid(`The price of ${below.map((l) => l.description).join(", ")} is below the allowed level. Ask a manager to approve it on the quotation.`);
  const kept = lines.filter((l) => !fresh.includes(l)).map((l) => {
    const p = prev.get(l.id)!;
    return { key: l.id, gross: D(p.gross_amount), lineDiscount: D(p.line_discount), docDiscountShare: D(p.doc_discount_share), taxable: D(p.taxable_amount), vat: D(p.vat_amount), total: D(p.line_total) };
  });
  const byKey = new Map([...calcNew.lines, ...kept].map((x) => [x.key, x]));
  const all = lines.map((l) => byKey.get(l.id)!);
  const sum = (f: (x: (typeof all)[number]) => Decimal) => all.reduce((s, x) => s.plus(f(x)), D(0));
  const total = sum((x) => x.total);

  await c.query("UPDATE quotation SET status = 'superseded', updated_at = now(), version = version + 1 WHERE enquiry_id = $1 AND status = ANY($2)", [enquiryId, OPEN]);
  await c.query("UPDATE approval_request SET status = 'recalled', decided_at = now() WHERE doc_type = 'discount' AND status = 'pending' AND doc_id IN (SELECT id FROM quotation WHERE enquiry_id = $1)", [enquiryId]);
  const rev = (await c.query("SELECT coalesce(max(revision),0)+1 r FROM quotation WHERE enquiry_id = $1", [enquiryId])).rows[0].r;
  const docNo = quoteNo(enq.doc_no, rev);
  const q = await c.query(
    `INSERT INTO quotation (branch_id, enquiry_id, job_card_id, revision, doc_no, status, valid_until, doc_discount_amount, gross_amount, discount_total, taxable_total, vat_total, grand_total,
                            approved_total, needs_internal_approval, internal_approval_reason, terms, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'approved',$6,0,$7,$8,$9,$10,$11,$11,false,NULL,$12,$13,$13) RETURNING id`,
    [branchId, enquiryId, enq.converted_job_id, rev, docNo, addDaysLocal(0), sum((x) => x.gross).toFixed(2), sum((x) => x.lineDiscount.plus(x.docDiscountShare)).toFixed(2),
      sum((x) => x.taxable).toFixed(2), sum((x) => x.vat).toFixed(2), total.toFixed(2), note, ctx.userId]);
  const qid = q.rows[0].id as string;
  for (const [i, x] of all.entries()) {
    const l = lines[i];
    await c.query(
      `INSERT INTO quotation_line (quotation_id, branch_id, job_line_id, line_no, line_type, description, qty, unit_price, gross_amount, line_discount, doc_discount_share,
                                   taxable_amount, vat_code, vat_rate, vat_amount, line_total, below_margin, decision, decided_at, decision_channel, decided_by, decision_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'approved',now(),'in_person',$18,$19)`,
      [qid, branchId, l.id, l.line_no, l.line_type, l.description, l.qty, l.unit_price, x.gross.toFixed(2), x.lineDiscount.toFixed(2), x.docDiscountShare.toFixed(2),
        x.taxable.toFixed(2), l.vat_code, l.vat_rate, x.vat.toFixed(2), x.total.toFixed(2), l.below_margin, ctx.userId, note]);
  }
  const pending = lines.filter((l) => l.approval_status === "pending").map((l) => l.id);
  if (pending.length) await c.query("UPDATE job_line SET approval_status = 'approved', version = version + 1 WHERE id = ANY($1)", [pending]);
  await audit(c, ctx, "quotation", qid, "approved_in_person", { doc_no: docNo, total: total.toFixed(2), note, lines_priced: fresh.length }, branchId);
  return { id: qid, docNo, total, lineIds: fresh.map((l) => l.id as string) };
}

/** Parts on the given lines leave the store as part of the sale, up to the line quantity. */
async function issueForSale(c: PoolClient, ctx: Ctx, lineIds: string[]) {
  if (!lineIds.length) return;
  const rows = (await c.query("SELECT id, qty, issued_qty FROM job_line WHERE id = ANY($1) AND item_id IS NOT NULL AND line_type IN ('part','consumable') AND NOT removed", [lineIds])).rows;
  for (const l of rows) {
    const need = D(l.qty).minus(l.issued_qty);
    if (need.gt(0)) await issueToLineIn(c, ctx, l.id, need, true);
  }
}

export type LineEdit = { qty?: unknown; price?: unknown; disc?: unknown };
export type NewLine = { line_type?: unknown; service_id?: unknown; item_id?: unknown; description?: unknown; qty?: unknown; unit_price?: unknown; discount_amount?: unknown };

const hasLine = (n?: NewLine | null) => !!n && !!(str(n.service_id) || str(n.item_id) || (str(n.line_type) === "outside" && str(n.description)));

/**
 * Invoice form, before posting: quantity, price and discount of unbilled lines can be changed, and lines
 * added. Price changes need Edit on selling price and discounts Edit on discount, as on the quotation.
 * A part cannot go below what was already issued (return it to the store first); extra parts are issued.
 */
export async function reviseAtBilling(ctx: Ctx, jobId: string, edits: Record<string, LineEdit>, add?: NewLine | null) {
  return withTx(ctx, async (c) => {
    const job = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
    if (!job) throw notFound("Job card");
    assertCan(ctx, "invoices", "create", job.branch_id);
    if (!canSee(ctx, "selling_price", job.branch_id)) throw forbidden("You cannot see prices.");
    if (!BILLABLE.includes(job.status)) throw invalid("Lines can be changed on the invoice once the job is Ready.");
    const priceEdit = fieldLevel(ctx, "selling_price", job.branch_id) === "edit";
    const discEdit = fieldLevel(ctx, "discount", job.branch_id) === "edit";
    const basis = await invoiceBasis(c, jobId);
    const reprice = new Set<string>();
    const changes: Record<string, unknown>[] = [];
    for (const l of basis.allLines) {
      const e = edits[l.job_line_id];
      if (!e) continue;
      const curDisc = D(l.line_discount).plus(l.doc_discount_share);
      const qty = str(e.qty) ? parseDec(e.qty, `Quantity of ${l.description}`, { min: "0.001", dp: 3 }) : D(l.qty);
      const price = str(e.price) ? parseDec(e.price, `Price of ${l.description}`, { min: 0, dp: 2 }) : D(l.unit_price);
      const disc = str(e.disc) ? parseDec(e.disc, `Discount on ${l.description}`, { min: 0, dp: 2 }) : curDisc;
      if (qty.eq(l.qty) && price.eq(l.unit_price) && disc.eq(curDisc)) continue;
      if (!price.eq(l.unit_price) && !priceEdit) throw forbidden("You cannot change the selling price.");
      if (!disc.eq(curDisc) && disc.gt(0) && !discEdit) throw forbidden("You cannot give a discount.");
      if (disc.gt(r2(qty.mul(price)))) throw invalid(`The discount on ${l.description} is more than the line amount.`);
      if (["part", "consumable"].includes(l.line_type) && qty.lt(l.issued_qty)) throw invalid(`${l.description}: ${D(l.issued_qty).toString()} is already issued. Return the extra to the store first.`);
      const below = await isBelowMargin(c, job.branch_id, l.item_id, qty.toString(), price.toFixed(2), disc.toFixed(2));
      await c.query("UPDATE job_line SET qty = $2, unit_price = $3, discount_amount = $4, below_margin = $5, version = version + 1 WHERE id = $1",
        [l.job_line_id, qty.toFixed(3), price.toFixed(2), disc.toFixed(2), below]);
      reprice.add(l.job_line_id);
      changes.push({ line: l.description, qty: { old: D(l.qty).toString(), new: qty.toString() }, price: { old: l.unit_price, new: price.toFixed(2) }, discount: { old: curDisc.toFixed(2), new: disc.toFixed(2) } });
    }
    if (hasLine(add)) {
      const r = await addLineIn(c, ctx, { kind: "job", id: jobId }, add as Record<string, unknown>, true);
      reprice.add(r.id);
      changes.push({ added: str(add!.description) || "line" });
    }
    if (!reprice.size) return { changed: 0 };
    const rev = await approvedRevisionIn(c, ctx, job.enquiry_id, job.branch_id, reprice, "Changed on the invoice form");
    await issueForSale(c, ctx, rev.lineIds);
    await audit(c, ctx, "job_card", jobId, "lines_changed_at_billing", { quotation: rev.docNo, changes }, job.branch_id);
    return { changed: reprice.size, quotation: rev.docNo };
  });
}

/** What the quick job screen needs: the limit and the branch's quick services. */
export async function quickSetup(ctx: Ctx) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "jobs", "create", b);
  assertCan(ctx, "invoices", "create", b);
  return withTx(ctx, async (c) => ({ limit: D(await getSetting(c, "quick_invoice.limit", b, 500)).toFixed(2) }));
}

export type QuickIn = {
  customer_id?: string; vehicle_id?: string; odometer_in?: unknown; notes?: string; lines: NewLine[];
  pay_method?: string; pay_amount?: unknown; pay_full?: boolean; pay_reference?: string; handed_over?: boolean; idempotency_key: string;
};

/**
 * Quick job (OT-02): for a small job done while the customer waits. One screen records the enquiry,
 * the work approved in person, the job card (type Quick), the parts leaving the store, the invoice,
 * the payment and, when paid in full, the hand-over. The total may not exceed quick_invoice.limit.
 */
export async function postQuickInvoice(ctx: Ctx, f: QuickIn) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "jobs", "create", b);
  assertCan(ctx, "invoices", "create", b);
  if (!canSee(ctx, "selling_price", b)) throw forbidden("You cannot see prices.");
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  const lines = (f.lines ?? []).filter(hasLine);
  if (!lines.length) throw invalid("Add at least one line.");
  if (lines.length > 30) throw invalid("A quick job has at most 30 lines.");
  type Out = { invoiceId: string; docNo: string; jobId: string; duplicate: boolean };
  return withTx(ctx, async (c): Promise<Out> => {
    const replay = await claimRequest<Out>(c, ctx, f.idempotency_key, "quick_job", { ...f, idempotency_key: undefined });
    if (replay) return replay;
    const customerId = optStr(f.customer_id), vehicleId = optStr(f.vehicle_id);
    if (!customerId || !vehicleId) throw invalid("Choose the customer and the car.");
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1 AND active", [customerId])).rows[0];
    if (!cust) throw invalid("Customer not found.");
    if (!(await c.query("SELECT 1 FROM vehicle_customer vc JOIN vehicle v ON v.id = vc.vehicle_id WHERE vc.vehicle_id = $1 AND vc.customer_id = $2 AND v.active", [vehicleId, customerId])).rowCount)
      throw invalid("That car is not linked to this customer.");
    const odo = optInt(f.odometer_in, "Odometer", 0, 5_000_000);
    if (odo === null || odo === undefined) throw invalid("Enter the odometer reading.");

    const enqNo = await nextDocNo(c, b, "enquiry");
    const enq = (await c.query(
      `INSERT INTO enquiry (branch_id, doc_no, customer_id, vehicle_id, service_asked, source, assigned_to, follow_up_at, notes, odometer_in, complaints, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'Quick job','walk_in',$5,now(),$6,$7,$6,$5,$5) RETURNING id`, [b, enqNo, customerId, vehicleId, ctx.userId, optStr(f.notes), odo])).rows[0];
    for (const l of lines) await addLineIn(c, ctx, { kind: "enquiry", id: enq.id }, l as Record<string, unknown>);
    const rev = await approvedRevisionIn(c, ctx, enq.id, b, new Set(), "Quick job, approved at the counter");
    const limit = D(await getSetting(c, "quick_invoice.limit", b, 500));
    if (rev.total.gt(limit)) throw invalid(`AED ${rev.total.toFixed(2)} is above the quick job limit of AED ${limit.toFixed(2)}. Use a normal enquiry and job card.`);
    await c.query("UPDATE enquiry SET status = 'approved', approved_at = now(), updated_at = now(), version = version + 1 WHERE id = $1", [enq.id]);

    const job = await createJobCardIn(c, ctx, enq.id, { odometer_in: String(odo) }, true);
    const lineIds = (await c.query("SELECT id FROM job_line WHERE job_card_id = $1 AND NOT removed", [job.id])).rows.map((r) => r.id as string);
    await issueForSale(c, ctx, lineIds);
    const jr = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [job.id])).rows[0];
    await setStatus(c, ctx, jr, "ready", "Quick job: done while the customer waited");
    await c.query("UPDATE job_card SET ready_at = coalesce(ready_at, now()) WHERE id = $1", [job.id]);

    const inv = await postInvoiceIn(c, ctx, job.id, `${f.idempotency_key}:inv`, { notes: optStr(f.notes) });
    // "Paid in full" takes what is still open after any deposit; otherwise the amount typed, if any.
    const open0 = (await c.query("SELECT grand_total - paid_amount - credited_amount o FROM sales_invoice WHERE id = $1", [inv.id])).rows[0].o;
    const payAmt = f.pay_full ? D(open0) : str(f.pay_amount) ? parseDec(f.pay_amount, "Amount paid", { min: 0, dp: 2 }) : D(0);
    if (payAmt.gt(0)) {
      await receiptTx(c, ctx, { invoice_id: inv.id, method: required(f.pay_method), amount: payAmt.toFixed(2), reference: f.pay_reference, idempotency_key: `${f.idempotency_key}:pay` });
    }
    const i = (await c.query("SELECT grand_total, paid_amount, credited_amount FROM sales_invoice WHERE id = $1", [inv.id])).rows[0];
    const owed = D(i.grand_total).minus(i.paid_amount).minus(i.credited_amount);
    if (f.handed_over && owed.lte(0)) {
      await c.query(
        `INSERT INTO delivery (branch_id, job_card_id, checklist, old_parts, received_by_name, odometer_out, delivered_by, balance_at_release, release_basis)
         VALUES ($1,$2,'[]','none',$3,$4,$5,0,'paid')`, [b, job.id, cust.company_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ") || "Customer", odo, ctx.userId]);
      await c.query("UPDATE job_card SET delivered_at = now() WHERE id = $1", [job.id]);
      await maybeCloseJob(c, ctx, job.id);
    }
    await audit(c, ctx, "job_card", job.id, "quick_job", { enquiry: enqNo, quotation: rev.docNo, invoice: inv.docNo, total: rev.total.toFixed(2), handed_over: !!f.handed_over && owed.lte(0) }, b);
    return finishRequest<Out>(c, f.idempotency_key, { invoiceId: inv.id, docNo: inv.docNo, jobId: job.id, duplicate: false });
  });
}

function required(v: unknown) {
  const s = str(v);
  if (!s) throw invalid("Choose how the customer paid.");
  return s;
}
