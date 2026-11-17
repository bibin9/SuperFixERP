import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { addEnquiryLine, changeStatus } from "../lib/services/jobs";
import { createEnquiry, createJobCard } from "../lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff } from "../lib/services/quotations";
import { inbox, act } from "../lib/services/workflow";
import { issueToJobLine } from "../lib/services/stock";
import * as ws from "../lib/services/workshop";
import * as bl from "../lib/services/billing";
import * as bm from "../lib/services/billing-more";
import "../lib/services/workflow-handlers";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const key = () => crypto.randomUUID();
let items: Record<string, string>, svc: Record<string, string>, YAS: string, cust: string, veh: string, fleet: string, walkIn: string;
const one = async (sql: string, p: unknown[] = []) => (await adminQuery(sql, p))[0];
const balancedEverywhere = async () => assert.equal((await adminQuery("SELECT journal_id FROM journal_line GROUP BY journal_id, branch_id HAVING sum(debit) <> sum(credit)")).length, 0);
const accountMove = async (event: string, journalWhere = "true", p: unknown[] = []) =>
  Number((await one(`SELECT coalesce(sum(jl.debit - jl.credit),0) n FROM journal_line jl JOIN account_mapping m ON m.account_id = jl.account_id JOIN journal j ON j.id = jl.journal_id
                     WHERE m.event_key = $1 AND ${journalWhere}`, [event, ...p])).n);

before(async () => {
  await resetTestDb(true);
  items = Object.fromEntries((await adminQuery("SELECT part_no, id FROM item")).map((r) => [r.part_no, r.id]));
  svc = Object.fromEntries((await adminQuery("SELECT code, id FROM service")).map((r) => [r.code, r.id]));
  YAS = await branchId("YAS");
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  veh = await id("vehicle", "plate_number = $1", ["77120"]);
  fleet = await id("customer", "company_name = $1", ["Emirates Fleet Services LLC"]);
  walkIn = await id("customer", "is_walk_in", []);
});
after(async () => { await closePool(); });

let odo = 300000;
/** A job at YAS: brake labour plus the given parts, approved, parts issued, QC passed, Ready. */
async function readyJob(parts: [string, string][]) {
  const priya = await ctxFor("priya", "YAS");
  const e = await createEnquiry(priya, { customer_id: cust, vehicle_id: veh, service_asked: "test", source: "walk_in" });
  await addEnquiryLine(priya, e.id, { line_type: "labour", service_id: svc["BRK-FR"] });
  for (const [p, q] of parts) await addEnquiryLine(priya, e.id, { line_type: "part", item_id: items[p], qty: q });
  const qt = await saveQuotation(priya, e.id, {});
  await sendQuotation(priya, qt.id);
  const ql = await adminQuery("SELECT id FROM quotation_line WHERE quotation_id = $1", [qt.id]);
  await recordDecisionsByStaff(priya, qt.id, Object.fromEntries(ql.map((l) => [l.id, "approved"])), "in_person", null);
  odo += 10;
  const j = await createJobCard(priya, e.id, { odometer_in: String(odo) });
  const lines = await adminQuery("SELECT id, line_type, item_id, qty FROM job_line WHERE job_card_id = $1 ORDER BY line_no", [j.id]);
  const anil = await ctxFor("anil", "YAS");
  for (const l of lines.filter((x) => x.line_type === "part")) await issueToJobLine(anil, l.id, l.qty);
  await changeStatus(priya, j.id, "in_progress");
  await changeStatus(priya, j.id, "quality_check");
  const codes = (await adminQuery("SELECT code FROM lookup_value WHERE list = 'qc_checklist'")).map((r) => r.code);
  await ws.recordQc(await ctxFor("khalid", "YAS"), j.id, Object.fromEntries(codes.map((c) => [c, "done"])), {});
  return { jobId: j.id as string, lines };
}
const deliveryForm = async (jobId: string) => ({
  ...Object.fromEntries((await adminQuery("SELECT code FROM lookup_value WHERE list = 'delivery_checklist'")).map((r) => [`chk_${r.code}`, "on"])),
  old_parts: "none", received_by_name: "Fatima", odometer_out: String((await one("SELECT odometer_in FROM job_card WHERE id = $1", [jobId])).odometer_in),
});
const status = async (jobId: string) => (await one("SELECT status FROM job_card WHERE id = $1", [jobId])).status;

test("split billing: labour to the customer, parts to a fleet company with an LPO; the job is fully billed only when both are posted (IV-04)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { jobId, lines } = await readyJob([["FLT-OIL-90915", "1"]]);
  const labour = lines.find((l) => l.line_type === "labour")!.id;
  const part = lines.find((l) => l.line_type === "part")!.id;
  const a = await bl.postInvoice(priya, jobId, key(), { lineIds: [labour] });
  assert.equal(await status(jobId), "invoiced");
  await rejects(bl.postInvoice(priya, jobId, key(), { lineIds: [part], billTo: "fleet", fleetCustomerId: cust }), "validation"); // an individual is not a fleet
  await rejects(bl.postInvoice(priya, jobId, key(), { lineIds: [part], billTo: "fleet", fleetCustomerId: fleet }), "validation", /LPO/);
  await adminQuery("UPDATE job_card SET lpo_no = 'EFS-7781' WHERE id = $1", [jobId]);
  const b = await bl.postInvoice(priya, jobId, key(), { lineIds: [part], billTo: "fleet", fleetCustomerId: fleet });
  const inv = await adminQuery("SELECT id, customer_id, bill_to_type, lpo_no, due_date - doc_date terms FROM sales_invoice WHERE id = ANY($1) ORDER BY doc_no", [[a.id, b.id]]);
  assert.equal(inv[0].customer_id, cust);
  assert.equal(inv[1].customer_id, fleet);
  assert.equal(inv[1].bill_to_type, "fleet");
  assert.equal(inv[1].lpo_no, "EFS-7781");
  assert.equal(Number(inv[1].terms), 30);
  await rejects(bl.postInvoice(priya, jobId, key()), "validation"); // nothing left to bill
  await balancedEverywhere();
});

test("warranty lines become an internal claim at cost, never a tax invoice; the rest is invoiced normally (JC-08)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { jobId, lines } = await readyJob([["FLT-AIR-17801", "1"]]);
  const part = lines.find((l) => l.line_type === "part")!.id;
  const issued = Number((await one("SELECT sum(value) v FROM stock_move WHERE job_line_id = $1 AND move_type = 'issue'", [part])).v);
  const w = await bl.postInvoice(priya, jobId, key(), { lineIds: [part], billTo: "warranty", claimRef: "TOY-WC-55" });
  assert.equal(w.kind, "warranty");
  const claim = await one("SELECT * FROM warranty_claim WHERE id = $1", [w.id]);
  assert.match(claim.doc_no, /-WC-/);
  assert.equal(Number(claim.cost_value), issued);
  assert.equal(await accountMove("warranty_expense", "j.source_type = 'warranty_claim' AND j.source_id = $2", [jobId]), issued);
  assert.equal((await adminQuery("SELECT 1 FROM sales_invoice WHERE job_card_id = $1", [jobId])).length, 0, "no tax invoice for warranty");
  const inv = await bl.postInvoice(priya, jobId, key());
  const lineCount = (await adminQuery("SELECT 1 FROM sales_invoice_line WHERE invoice_id = $1", [inv.id])).length;
  assert.equal(lineCount, 1, "only the labour is invoiced");
  await balancedEverywhere();
});

test("advance with VAT: VAT is due when the deposit is taken and reversed when it is applied, so total VAT equals the invoice VAT (PY-02)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { jobId } = await readyJob([]);
  const adv = await bl.recordAdvance(priya, { customer_id: cust, job_card_id: jobId, method: "card", amount: "105.00", reference: "SLIP-A1", idempotency_key: key() });
  assert.equal(adv.vat, "5.00");
  const advRc = await one("SELECT doc_no, kind, vat_amount FROM receipt WHERE id = $1", [adv.id]);
  assert.equal(advRc.kind, "advance");
  // the deposit counts toward the release balance
  const rel = await bl.jobRelease(priya, jobId);
  assert.equal(Number(rel.held), 105);
  const inv = await bl.postInvoice(priya, jobId, key());
  const i = await one("SELECT grand_total, vat_total, paid_amount FROM sales_invoice WHERE id = $1", [inv.id]);
  assert.equal(Number(i.paid_amount), Math.min(105, Number(i.grand_total)), "the job's advance is applied automatically");
  const advanceVat = await accountMove("vat_output", "j.source_type IN ('advance','advance_application') AND (j.source_id = $2 OR j.source_id = $3)", [cust, inv.id]);
  assert.equal(advanceVat, 0, "VAT on the advance is reversed when applied");
  const invVat = -(await accountMove("vat_output", "j.source_type = 'sales_invoice' AND j.source_id = $2", [jobId]));
  assert.equal(invVat, Number(i.vat_total));
  // an advance cannot be applied at another branch, nor beyond what is left
  await rejects(bl.applyAdvance(priya, inv.id, (await one("SELECT id FROM customer_advance WHERE source_id = $1", [adv.id])).id, "1.00"), "validation");
  await balancedEverywhere();
});

test("cheques: the cheque details are required, a post-dated cheque cannot be cleared early, and a returned cheque opens the invoice again (AC-17)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const yousef = await ctxFor("yousef", "YAS");
  const { jobId } = await readyJob([]);
  const inv = await bl.postInvoice(priya, jobId, key());
  const total = (await one("SELECT grand_total FROM sales_invoice WHERE id = $1", [inv.id])).grand_total;
  await rejects(bl.recordReceipt(priya, { invoice_id: inv.id, method: "cheque", amount: total, idempotency_key: key() }), "validation");
  const later = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const r = await bl.recordReceipt(priya, { invoice_id: inv.id, method: "cheque", amount: total, cheque_no: "004512", cheque_bank: "ADCB", cheque_date: later, idempotency_key: key() });
  assert.equal((await one("SELECT cheque_status FROM receipt WHERE id = $1", [r.id])).cheque_status, "held");
  await rejects(bl.clearCheque(yousef, r.id), "validation", /cannot be deposited/);
  await ws.deliver(priya, jobId, await deliveryForm(jobId));
  assert.equal(await status(jobId), "closed");
  await rejects(bl.bounceCheque(yousef, r.id, ""), "validation");
  await bl.bounceCheque(yousef, r.id, "Insufficient funds");
  assert.equal(Number((await one("SELECT paid_amount FROM sales_invoice WHERE id = $1", [inv.id])).paid_amount), 0);
  assert.equal(await status(jobId), "invoiced", "the closed job opens again");
  assert.equal(await accountMove("pdc_received", "(j.source_id = $2 OR j.source_id = $3)", [r.id, inv.id]), 0, "cheques on hand back to nil");
  await rejects(bl.bounceCheque(yousef, r.id, "again"), "validation");
  await balancedEverywhere();
});

test("credit note: needs the branch manager, gets its number at posting, restocks at the original cost and reverses VAT (IV-05)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const yousef = await ctxFor("yousef", "YAS");
  const { jobId } = await readyJob([["WPR-24", "2"]]);
  const inv = await bl.postInvoice(priya, jobId, key());
  const total = (await one("SELECT grand_total FROM sales_invoice WHERE id = $1", [inv.id])).grand_total;
  await bl.recordReceipt(priya, { invoice_id: inv.id, method: "card", amount: total, reference: "SLIP-CN", idempotency_key: key() });
  const wiper = await one("SELECT * FROM sales_invoice_line WHERE invoice_id = $1 AND item_id IS NOT NULL", [inv.id]);
  const onHand = async () => Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [items["WPR-24"], YAS])).on_hand);
  const before = await onHand();
  await rejects(bm.createCreditNote(priya, inv.id, { reason: "goods_returned", lines: [{ invoice_line_id: wiper.id, qty: "3", stock_action: "restock" }] }), "validation"); // more than sold
  await rejects(bm.createCreditNote(priya, inv.id, { reason: "other", lines: [{ invoice_line_id: wiper.id, qty: "1" }] }), "validation"); // "other" needs a note
  const cn = await bm.createCreditNote(priya, inv.id, { reason: "goods_returned", lines: [{ invoice_line_id: wiper.id, qty: "1", stock_action: "restock" }] });
  assert.equal(cn.status, "pending_approval");
  assert.equal((await one("SELECT doc_no FROM credit_note WHERE id = $1", [cn.id])).doc_no, null, "no number before posting");
  assert.equal(await onHand(), before, "nothing moves before approval");
  await rejects(bm.createCreditNote(priya, inv.id, { reason: "goods_returned", lines: [{ invoice_line_id: wiper.id, qty: "1" }] }), "validation"); // one at a time
  const task = (await inbox(yousef)).find((t) => t.doc_id === cn.id)!;
  await act(yousef, task.task_id, "approved");
  const posted = await one("SELECT * FROM credit_note WHERE id = $1", [cn.id]);
  assert.equal(posted.status, "posted");
  assert.match(posted.doc_no, /^YAS-CN-\d{2}-\d{6}$/);
  assert.equal(Number(posted.taxable_total), 60);
  assert.equal(Number(posted.vat_total), 3);
  assert.equal(await onHand(), before + 1);
  const unitCost = Number(wiper.cost_value) / 2;
  assert.equal(Number((await one("SELECT value FROM stock_move WHERE doc_ref = $1 AND move_type = 'return'", [posted.doc_no])).value), unitCost);
  // the invoice was paid, so the credit is held for the customer
  const adv = await one("SELECT amount FROM customer_advance WHERE source = 'credit_note' AND source_id = $1", [cn.id]);
  assert.equal(Number(adv.amount), 63);
  assert.equal(await accountMove("vat_output", "j.source_type = 'credit_note' AND j.source_id = $2", [cn.id]), 3);
  // the second wiper can still be credited, not more
  await rejects(bm.createCreditNote(priya, inv.id, { reason: "goods_returned", lines: [{ invoice_line_id: wiper.id, qty: "2" }] }), "validation");
  await balancedEverywhere();
});

test("counter sale: VAT-inclusive price, discount limit by role, below-cost needs the manager, walk-in pays in full, simplified invoice (SL-01)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const yousef = await ctxFor("yousef", "YAS");
  const setup = await bm.counterSaleSetup(priya, null);
  assert.equal(setup.customer.id, walkIn);
  assert.equal(setup.inclusive, true);
  const oil = items["OIL-5W30-L"];
  await rejects(bm.postCounterSale(priya, { lines: [{ item_id: oil, qty: "2", discount: "10.00" }], payment: { method: "cash", amount: "57.20", idempotency_key: "" }, idempotency_key: key() }), "validation", /above your limit/);
  await rejects(bm.postCounterSale(priya, { lines: [{ item_id: oil, qty: "2", price: "5.00" }], payment: { method: "cash", amount: "10.00", idempotency_key: "" }, idempotency_key: key() }), "validation", /limit|below cost/);
  await rejects(bm.postCounterSale(priya, { lines: [{ item_id: oil, qty: "2" }], payment: null, idempotency_key: key() }), "validation", /paid now/);
  await rejects(bm.postCounterSale(priya, { lines: [{ item_id: oil, qty: "2" }], payment: { method: "cash", amount: "50.00", idempotency_key: "" }, idempotency_key: key() }), "validation", /in full/);
  const before = Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [oil, YAS])).on_hand);
  const k = key();
  const s = await bm.postCounterSale(priya, { bill_to_name: "Ali", lines: [{ item_id: oil, qty: "2" }], payment: { method: "cash", amount: "67.20", idempotency_key: "" }, idempotency_key: k });
  const inv = await one("SELECT * FROM sales_invoice WHERE id = $1", [s.id]);
  assert.equal(inv.taxable_total, "64.00");
  assert.equal(inv.vat_total, "3.20");
  assert.equal(inv.grand_total, "67.20");
  assert.equal(inv.paid_amount, "67.20");
  assert.equal(inv.invoice_kind, "simplified");
  assert.equal(inv.source, "counter");
  assert.equal(inv.bill_to_name, "Ali");
  assert.equal(Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [oil, YAS])).on_hand), before - 2);
  assert.equal((await bm.postCounterSale(priya, { lines: [{ item_id: oil, qty: "2" }], payment: { method: "cash", amount: "67.20", idempotency_key: "" }, idempotency_key: k })).duplicate, true);
  // the manager may go above the advisor's limit
  const m = await bm.postCounterSale(yousef, { lines: [{ item_id: oil, qty: "2", discount: "10.00" }], payment: { method: "card", amount: "57.20", reference: "SLIP-M", idempotency_key: "" }, idempotency_key: key() });
  assert.equal((await one("SELECT grand_total FROM sales_invoice WHERE id = $1", [m.id])).grand_total, "57.20");
  // no credit terms means pay now; a registered company below AED 10,000 may get a simplified invoice (FSD 5.1)
  await rejects(bm.postCounterSale(priya, { customer_id: cust, lines: [{ item_id: oil, qty: "1" }], payment: null, idempotency_key: key() }), "validation", /credit terms/);
  const f = await bm.postCounterSale(priya, { customer_id: fleet, lines: [{ item_id: oil, qty: "1" }], payment: null, idempotency_key: key() });
  assert.equal((await one("SELECT invoice_kind FROM sales_invoice WHERE id = $1", [f.id])).invoice_kind, "simplified");
  await balancedEverywhere();
});

test("VAT 201: sales by emirate, credit notes and advances net off, and the return agrees with the VAT accounts in the ledger (VT-01)", async () => {
  const saeed = await ctxFor("saeed", "HQ");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const r = await bm.vat201(saeed, day, day, null);
  // Box 1a is Abu Dhabi (every test sale is at YAS); output VAT less input VAT agrees with the ledger.
  const salesVat = (await one(
    `SELECT coalesce(sum(vat_total),0) v FROM sales_invoice WHERE doc_date = $1`, [day])).v;
  const cnVat = (await one("SELECT coalesce(sum(vat_total),0) v FROM credit_note WHERE status = 'posted' AND doc_date = $1", [day])).v;
  assert.equal(Number(r.boxes["1a"].vat), Number(salesVat) - Number(cnVat));
  assert.equal(Number(r.boxes["8"].vat), Number(r.boxes["12"].vat));
  assert.equal(Number(r.boxes["12"].vat).toFixed(2), r.ledgerOutput, "output VAT agrees with the ledger");
  assert.equal(Number(r.boxes["13"].vat).toFixed(2), r.ledgerInput, "input VAT agrees with the ledger");
  assert.equal(Number(r.boxes["14"].vat), Number(r.boxes["12"].vat) - Number(r.boxes["13"].vat));
  assert.ok(r.lines.every((l) => l.link === null || l.link.startsWith("/")), "every line drills down to its document");
  await rejects(bm.vat201(await ctxFor("priya", "YAS"), day, day, null), "forbidden");
  const faf = await bm.ftaAuditFile(saeed, day, day);
  assert.match(faf, /Supply/);
  assert.match(faf, /-INV-/);
  const any = await one("SELECT id, doc_no, grand_total FROM sales_invoice ORDER BY posted_at LIMIT 1");
  const e = await bm.einvoiceData(saeed, any.id);
  assert.equal(e.ID, any.doc_no);
  assert.equal(e.LegalMonetaryTotal.TaxInclusiveAmount, any.grand_total);
  assert.equal(bm.amountInWords("1234.50"), "One thousand two hundred and thirty-four dirhams and fifty fils only");
});

test("customer invoice link: the right token shows that invoice only; a wrong or short token shows nothing", async () => {
  const inv = await one("SELECT id, doc_no, share_token FROM sales_invoice WHERE source = 'job' ORDER BY posted_at LIMIT 1");
  const r = await bl.publicInvoice(inv.share_token);
  assert.equal(r?.invoice.doc_no, inv.doc_no);
  assert.equal(await bl.publicInvoice("0".repeat(32)), null);
  assert.equal(await bl.publicInvoice("abc"), null);
});

test("daily cash closing: the count is checked against cash taken, a difference needs a note, the manager signs off and the difference is booked; no more cash that day (PY-03)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const yousef = await ctxFor("yousef", "YAS");
  const t = await bm.cashToday(priya);
  assert.ok(Number(t.cash) > 0, "priya took cash today");
  // count the drawer: the float (topped up to a round total) plus the cash taken, but 20 short
  const float = (200 + Math.ceil(Number(t.cash)) - Number(t.cash)).toFixed(2);
  const target = Math.round((Number(float) + Number(t.cash) - 20) * 100);
  const counts: Record<string, string> = {};
  let left = target;
  for (const d of t.denoms) { const n = Math.floor(left / Math.round(d * 100)); if (n) { counts[String(d)] = String(n); left -= n * Math.round(d * 100); } }
  assert.equal(left, 0);
  await rejects(bm.submitCashClose(priya, { opening_float: float, counts }), "validation", /short/);
  const s = await bm.submitCashClose(priya, { opening_float: float, counts, note: "Gave change twice" });
  assert.equal(s.variance, "-20.00");
  await rejects(bm.submitCashClose(priya, { opening_float: float, counts, note: "again" }), "validation");
  await rejects(bm.signOffCash(priya, s.id), "forbidden");
  await bm.signOffCash(yousef, s.id, "Checked");
  assert.equal(await accountMove("cash_over_short", "j.source_type = 'cash_session' AND j.source_id = $2", [s.id]), 20);
  await rejects(bm.signOffCash(yousef, s.id), "validation");
  // the day is closed for this cashier: no more cash receipts
  await rejects(bm.postCounterSale(priya, { lines: [{ item_id: items["OIL-5W30-L"], qty: "1" }], payment: { method: "cash", amount: "33.60", idempotency_key: "" }, idempotency_key: key() }), "validation");
  await balancedEverywhere();
});
