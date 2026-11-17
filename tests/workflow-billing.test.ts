import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { addEnquiryLine, addJobLine, changeStatus } from "../lib/services/jobs";
import { createEnquiry, createJobCard, updateEnquiry, getEnquiry } from "../lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff, getPublicQuotation, submitPublicDecisions } from "../lib/services/quotations";
import { inbox, act } from "../lib/services/workflow";
import { receiveStock, issueToJobLine } from "../lib/services/stock";
import { postInvoice, recordReceipt, invoiceDraft } from "../lib/services/billing";
import { trialBalance } from "../lib/services/ledger";
import { deliver } from "../lib/services/workshop";
import { AppError } from "../lib/errors";

const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);
const key = () => crypto.randomUUID();
let svc: Record<string, string>, items: Record<string, string>, cust: string, veh: string;

before(async () => {
  await resetTestDb(true);
  svc = Object.fromEntries((await adminQuery("SELECT code, id FROM service")).map((r) => [r.code, r.id]));
  items = Object.fromEntries((await adminQuery("SELECT part_no, id FROM item")).map((r) => [r.part_no, r.id]));
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  veh = await id("vehicle", "plate_number = $1", ["77120"]);
});
after(async () => { await closePool(); });

async function newEnquiry(user = "priya") {
  const ctx = await ctxFor(user, "YAS");
  const e = await createEnquiry(ctx, { customer_id: cust, vehicle_id: veh, service_asked: "test", source: "walk_in" });
  return { ctx, enqId: e.id };
}
let odo = 100000;
/** Sends the quotation, records the customer's answer in person and creates the job card from it. */
async function approveAndConvert(ctx: Awaited<ReturnType<typeof ctxFor>>, enqId: string, qid: string, decline: string[] = []) {
  await sendQuotation(ctx, qid);
  const ls = await qLines(qid);
  await recordDecisionsByStaff(ctx, qid, Object.fromEntries(ls.map((l) => [l.id, decline.includes(l.description) ? "declined" : "approved"])), "in_person", null);
  odo += 100;
  return (await createJobCard(ctx, enqId, { odometer_in: String(odo) })).id;
}
const qLines = (qid: string) => adminQuery("SELECT id, job_line_id, description FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [qid]);

test("discount above the advisor's limit goes to the branch manager and cannot be sent until approved (QT-04, WF)", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["SVC-10K"], discount_amount: "40.50" }); // 15% of 270.00
  const q = await saveQuotation(priya, enqId, {});
  assert.equal(q.status, "pending_internal_approval");
  await rejects(sendQuotation(priya, q.id), "validation");
  assert.equal((await inbox(priya)).length, 0, "requester never sees their own item");
  const omar = await ctxFor("omar", "QUS");
  const task = (await adminQuery("SELECT t.id FROM approval_task t JOIN approval_request r ON r.id = t.request_id WHERE r.doc_id = $1", [q.id]))[0].id;
  await rejects(act(omar, task, "approved"), "not_found"); // another branch's manager cannot even see it
  const yousef = await ctxFor("yousef", "YAS");
  assert.ok((await inbox(yousef)).some((i) => i.doc_id === q.id));
  await rejects(act(yousef, task, "rejected", ""), "validation"); // reason required
  await act(yousef, task, "approved");
  assert.equal((await adminQuery("SELECT status FROM quotation WHERE id = $1", [q.id]))[0].status, "ready_to_send");
  await rejects(act(yousef, task, "approved"), "conflict"); // cannot be approved twice
  const hist = await adminQuery("SELECT action FROM approval_action a JOIN approval_request r ON r.id = a.request_id WHERE r.doc_id = $1 ORDER BY a.id", [q.id]);
  assert.deepEqual(hist.map((h) => h.action), ["submitted", "approved"]);
});

test("discount within the limit needs no approval; the manager's own below-margin price needs someone else", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["SVC-10K"], discount_amount: "27.00" }); // exactly 10%
  assert.equal((await saveQuotation(priya, enqId, {})).status, "ready_to_send");

  const yousef = await ctxFor("yousef", "YAS");
  const e2 = await createEnquiry(yousef, { customer_id: cust, vehicle_id: veh, service_asked: "brakes", source: "phone" });
  const line = await addEnquiryLine(yousef, e2.id, { line_type: "part", item_id: items["BRK-PAD-FR-LC"], unit_price: "220.00" }); // cost 210 -> margin 4.5%
  assert.equal(line.belowMargin, true);
  const q = await saveQuotation(yousef, e2.id, {});
  assert.equal(q.status, "pending_internal_approval");
  assert.match(q.reasons.join(), /below allowed level/);
  const task = (await adminQuery("SELECT t.id FROM approval_task t JOIN approval_request r ON r.id = t.request_id WHERE r.doc_id = $1", [q.id]))[0].id;
  await rejects(act(yousef, task, "approved"), "forbidden"); // never approve your own document
});

test("parts commitment: required 2, free 1 -> committed 1, back-ordered 1; a receipt fills the back order (PC-01, PC-03, PC-08)", async () => {
  const pads = items["BRK-PAD-FR-LC"];
  const bal = async () => (await adminQuery("SELECT on_hand, committed FROM stock_balance WHERE item_id = $1 AND branch_id = (SELECT id FROM branch WHERE code = 'YAS')", [pads]))[0];
  const before = await bal();
  const { ctx: priya, enqId } = await newEnquiry();
  const free = Number(before.on_hand) - Number(before.committed);
  const need = free + 1;
  const l = await addEnquiryLine(priya, enqId, { line_type: "part", item_id: pads, qty: String(need) });
  const q = await saveQuotation(priya, enqId, {});
  assert.equal((await adminQuery("SELECT count(*) n FROM stock_commitment WHERE job_line_id = $1", [l.id]))[0].n, "0", "nothing is committed while quoting");
  const jobId = await approveAndConvert(priya, enqId, q.id);
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [jobId]))[0].status, "awaiting_parts");
  const sc = (await adminQuery("SELECT qty, back_ordered FROM stock_commitment WHERE job_line_id = $1 AND status = 'active'", [l.id]))[0];
  assert.equal(Number(sc.qty), free);
  assert.equal(Number(sc.back_ordered), 1);
  const anil = await ctxFor("anil", "YAS");
  await receiveStock(anil, { item_id: pads, qty: "3", unit_cost: "216.00", kind: "receipt", ref: "GRN test" });
  const sc2 = (await adminQuery("SELECT qty, back_ordered FROM stock_commitment WHERE job_line_id = $1 AND status = 'active'", [l.id]))[0];
  assert.equal(Number(sc2.qty), need);
  assert.equal(Number(sc2.back_ordered), 0);
  // weighted average: (2 x 210 + 3 x 216) / 5 = 213.60
  const avg = (await adminQuery("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = (SELECT id FROM branch WHERE code = 'YAS')", [pads]))[0].avg_cost;
  assert.equal(Number(avg).toFixed(2), "213.60");
});

test("customer approval by link: line by line, declined lines release stock and become deferred work (QT-02, QT-03, PC-04)", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["OIL-QK"] });
  const wiper = await addEnquiryLine(priya, enqId, { line_type: "part", item_id: items["WPR-24"], qty: "2" });
  const q = await saveQuotation(priya, enqId, {});
  const { token } = await sendQuotation(priya, q.id);
  assert.equal(await getPublicQuotation("x".repeat(43)), null);
  const pub = await getPublicQuotation(token);
  assert.ok(pub && pub.lines.length === 2);
  assert.ok(!JSON.stringify(pub).includes("avg_cost"));
  const ls = await qLines(q.id);
  await rejects(submitPublicDecisions(token, { [ls[0].id]: "approved" }), "validation"); // every line needs an answer
  await submitPublicDecisions(token, { [ls[0].id]: "approved", [ls[1].id]: "declined" });
  assert.equal((await adminQuery("SELECT status FROM enquiry WHERE id = $1", [enqId]))[0].status, "approved");
  assert.equal((await adminQuery("SELECT count(*) n FROM job_card WHERE enquiry_id = $1", [enqId]))[0].n, "0", "approval alone does not create the job card");
  assert.equal((await adminQuery("SELECT count(*) n FROM deferred_work WHERE enquiry_id = $1", [enqId]))[0].n, "1");
  const jobId = (await createJobCard(priya, enqId, { odometer_in: String((odo += 100)) })).id;
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [jobId]))[0].status, "approved");
  assert.equal((await adminQuery("SELECT count(*) n FROM stock_commitment WHERE job_line_id = $1", [wiper.id]))[0].n, "0", "declined part never committed");
  assert.equal((await adminQuery("SELECT count(*) n FROM deferred_work WHERE job_card_id = $1", [jobId]))[0].n, "1");
  await rejects(submitPublicDecisions(token, { [ls[0].id]: "approved", [ls[1].id]: "approved" }), "conflict"); // answered already
});

test("phone approval needs a note (QT-02)", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["DIAG"] });
  const q = await saveQuotation(priya, enqId, {});
  await sendQuotation(priya, q.id);
  const ls = await qLines(q.id);
  await rejects(recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "approved" }, "phone", null), "validation");
});

test("a YES typed in WhatsApp is recorded by the advisor as a WhatsApp reply, with the customer's words; staff cannot pose as the link", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["DIAG"] });
  const q = await saveQuotation(priya, enqId, {});
  await sendQuotation(priya, q.id);
  const ls = await qLines(q.id);
  await rejects(recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "approved" }, "whatsapp_reply", null), "validation");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await rejects(recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "approved" }, "whatsapp_link" as any, null), "validation");
  const line = async () => (await adminQuery("SELECT decision, decision_channel, decision_note FROM quotation_line WHERE id = $1", [ls[0].id]))[0];
  assert.equal((await line()).decision, "pending");
  await recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "approved" }, "whatsapp_reply", "YES (16/11 19:30)");
  const l = await line();
  assert.equal(l.decision, "approved");
  assert.equal(l.decision_channel, "whatsapp_reply");
  assert.equal(l.decision_note, "YES (16/11 19:30)");
  assert.equal((await adminQuery("SELECT status FROM enquiry WHERE id = $1", [enqId]))[0].status, "approved");
});

test("full job to invoice to payment: VAT, ceiling, balanced books, idempotency and no double billing", async () => {
  const priya = await ctxFor("priya", "YAS");
  const job = await id("job_card", "doc_no = $1", ["YAS-1483"]); // seeded: approved, parts issued, Ready
  const draft = await invoiceDraft(priya, job);
  assert.ok(draft.checks.every((c) => c.ok), JSON.stringify(draft.checks));
  // AC regas 1.0 h x 160 + oil change 0.5 h x 120 + 6 L oil x 32 = 160 + 60 + 192 = 412.00; VAT 20.60
  assert.equal(draft.taxable, "412.00");
  assert.equal(draft.vat, "20.60");
  assert.equal(draft.total, "432.60");

  const k = key();
  const [a, b] = await Promise.allSettled([postInvoice(priya, job, k), postInvoice(priya, job, key())]);
  const ok = [a, b].filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, "exactly one concurrent post succeeds");
  const invs = await adminQuery("SELECT * FROM sales_invoice WHERE job_card_id = $1", [job]);
  assert.equal(invs.length, 1);
  assert.match(invs[0].doc_no, /^YAS-INV-\d{2}-000001$/);
  assert.equal(invs[0].grand_total, "432.60");
  if ((a as PromiseFulfilledResult<{ id: string }>).value) {
    const again = await postInvoice(priya, job, k);
    assert.equal(again.duplicate, true);
  }
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [job]))[0].status, "invoiced");

  // every journal balances, in total and per branch
  const unbalanced = await adminQuery("SELECT journal_id FROM journal_line GROUP BY journal_id, branch_id HAVING sum(debit) <> sum(credit)");
  assert.equal(unbalanced.length, 0);
  const ar = await adminQuery("SELECT sum(debit) - sum(credit) n FROM journal_line l JOIN account a ON a.id = l.account_id WHERE a.code = '1200'");
  assert.equal(ar[0].n, "432.60");
  const vat = await adminQuery("SELECT sum(credit) n FROM journal_line l JOIN account a ON a.id = l.account_id WHERE a.code = '2200'");
  assert.equal(vat[0].n, "20.60");
  // issued oil cost moved from WIP to cost of sales: 6 L x 8.00 = 48.00
  const wip = await adminQuery("SELECT sum(debit) - sum(credit) n FROM journal_line l JOIN account a ON a.id = l.account_id WHERE a.code = '1310' AND l.journal_id IN (SELECT id FROM journal WHERE source_id = $1)", [job]);
  assert.equal(wip[0].n, "0.00");

  // receipts: idempotent; same key with a different amount is refused; partial then full payment closes the job
  const inv = invs[0].id;
  const k1 = key();
  const r1 = await recordReceipt(priya, { invoice_id: inv, method: "card", amount: "200.00", reference: "SLIP-1", idempotency_key: k1 });
  const r1b = await recordReceipt(priya, { invoice_id: inv, method: "card", amount: "200.00", reference: "SLIP-1", idempotency_key: k1 });
  assert.equal(r1b.id, r1.id);
  await rejects(recordReceipt(priya, { invoice_id: inv, method: "card", amount: "250.00", reference: "SLIP-1", idempotency_key: k1 }), "conflict");
  assert.equal((await adminQuery("SELECT paid_amount FROM sales_invoice WHERE id = $1", [inv]))[0].paid_amount, "200.00");
  const r2 = await recordReceipt(priya, { invoice_id: inv, method: "cash", amount: "300.00", idempotency_key: key() });
  assert.equal(r2.onAccount, "67.40"); // overpayment kept on account, not clamped away
  assert.equal((await adminQuery("SELECT paid_amount FROM sales_invoice WHERE id = $1", [inv]))[0].paid_amount, "432.60");
  // paid but still in the workshop: the job stays Invoiced until the car is handed over, then it closes
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [job]))[0].status, "invoiced");
  const chk = Object.fromEntries((await adminQuery("SELECT code FROM lookup_value WHERE list = 'delivery_checklist'")).map((r) => [`chk_${r.code}`, "on"]));
  await deliver(priya, job, { ...chk, old_parts: "none", received_by_name: "Owner", odometer_out: String((await adminQuery("SELECT odometer_in FROM job_card WHERE id = $1", [job]))[0].odometer_in ?? 0) });
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [job]))[0].status, "closed");
  assert.equal((await adminQuery("SELECT release_basis FROM delivery WHERE job_card_id = $1", [job]))[0].release_basis, "paid");

  // trial balance: debits equal credits; bank/cash lines hidden for a branch manager
  const owner = await ctxFor("saeed", "HQ");
  const tb = await trialBalance(owner, "all");
  assert.equal(tb.totals.debit, tb.totals.credit);
  const yousef = await ctxFor("yousef", "YAS");
  const tbm = await trialBalance(yousef, (await id("branch", "code = $1", ["YAS"])));
  assert.equal(tbm.bankHidden, true);
  assert.ok(tbm.rows.every((r) => !["cash", "bank"].includes(r.sub_type)));
});

test("invoice is blocked while approved parts are not issued, and when the job is not ready (IV-01)", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  const l = await addEnquiryLine(priya, enqId, { line_type: "part", item_id: items["FLT-AIR-17801"], qty: "1" });
  const q = await saveQuotation(priya, enqId, {});
  const jobId = await approveAndConvert(priya, enqId, q.id);
  await rejects(changeStatus(priya, jobId, "invoiced"), "validation");
  await rejects(postInvoice(priya, jobId, key()), "validation");
  assert.equal((await adminQuery("SELECT count(*) n FROM sales_invoice WHERE job_card_id = $1", [jobId]))[0].n, "0");
  const anil = await ctxFor("anil", "YAS");
  await issueToJobLine(anil, l.id, "1");
  await rejects(issueToJobLine(anil, l.id, "1"), "validation"); // more than the line quantity
});

test("a revision keeps the approved lines' amounts; only new lines are priced and need approval", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["SVC-60K"] }); // 450.00
  await addEnquiryLine(priya, enqId, { line_type: "part", item_id: items["FLT-OIL-90915"], qty: "1" }); // 45.00
  const q1 = await saveQuotation(priya, enqId, { doc_discount: "49.50" }); // 10%
  await sendQuotation(priya, q1.id);
  const l1 = await qLines(q1.id);
  await recordDecisionsByStaff(priya, q1.id, Object.fromEntries(l1.map((l) => [l.id, "approved"])), "in_person", null);
  const before = await adminQuery("SELECT approved_total FROM quotation WHERE id = $1", [q1.id]);
  assert.equal(before[0].approved_total, "467.78"); // 405.00 + 20.25 + 40.50 + 2.03
  const jobId = (await createJobCard(priya, enqId, { odometer_in: String((odo += 100)) })).id;
  await rejects(addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["ALIGN"] }), "validation"); // job exists: extra work goes on the job
  await addJobLine(priya, jobId, { line_type: "labour", service_id: svc["ALIGN"] }); // extra work 120.00
  const q2 = await saveQuotation(priya, enqId, {});
  const q2row = (await adminQuery("SELECT * FROM quotation WHERE id = $1", [q2.id]))[0];
  assert.equal(q2row.approved_total, "467.78", "approved lines keep their approved amounts");
  assert.equal(q2row.grand_total, "593.78"); // 467.78 + 126.00
  assert.equal((await adminQuery("SELECT status FROM quotation WHERE id = $1", [q1.id]))[0].status, "approved", "the customer-approved revision stays as the approval record and billing ceiling");
  const pendingLines = await adminQuery("SELECT * FROM quotation_line WHERE quotation_id = $1 AND decision = 'pending'", [q2.id]);
  assert.equal(pendingLines.length, 1);
  assert.equal((await adminQuery("SELECT extra_work FROM job_line WHERE id = $1", [pendingLines[0].job_line_id]))[0].extra_work, true);
  assert.equal(q2row.job_card_id, jobId);
  await sendQuotation(priya, q2.id);
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [jobId]))[0].status, "approved", "sending extra work does not move the job back");
});

test("a job card exists only after enquiry, quotation and customer approval, in the service and in the database (FSD v0.10)", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await rejects(createJobCard(priya, enqId, { odometer_in: "999999" }), "validation"); // no quotation yet
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["DIAG"] });
  const q = await saveQuotation(priya, enqId, {});
  await rejects(createJobCard(priya, enqId, { odometer_in: "999999" }), "validation"); // saved, not approved
  await sendQuotation(priya, q.id);
  assert.equal((await adminQuery("SELECT status FROM enquiry WHERE id = $1", [enqId]))[0].status, "quoted");
  await rejects(createJobCard(priya, enqId, { odometer_in: "999999" }), "validation"); // sent, not approved
  // Database layer: the application role cannot insert a job card around the service either.
  const yas = await id("branch", "code = $1", ["YAS"]);
  const { appQueryAs } = await import("./helpers");
  await assert.rejects(appQueryAs([yas], `INSERT INTO job_card (branch_id, doc_no, customer_id, vehicle_id, enquiry_id, source_quotation_id) VALUES ($1,'YAS-X1',$2,$3,$4,$5)`,
    [yas, cust, veh, enqId, q.id]), /approved/);
  await assert.rejects(appQueryAs([yas], `INSERT INTO job_card (branch_id, doc_no, customer_id, vehicle_id) VALUES ($1,'YAS-X2',$2,$3)`, [yas, cust, veh]), /approved/);
  assert.equal((await adminQuery("SELECT count(*) n FROM job_card WHERE enquiry_id = $1", [enqId]))[0].n, "0");
  // Declining every line closes the enquiry as lost; no job card can follow.
  const ls = await qLines(q.id);
  await recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "declined" }, "in_person", null);
  assert.equal((await adminQuery("SELECT status FROM enquiry WHERE id = $1", [enqId]))[0].status, "lost");
  await rejects(createJobCard(priya, enqId, { odometer_in: "999999" }), "validation");
  // Allowed case: approve, then create; a second job card for the same enquiry is refused.
  const e2 = await newEnquiry();
  await addEnquiryLine(e2.ctx, e2.enqId, { line_type: "labour", service_id: svc["DIAG"] });
  const q2 = await saveQuotation(e2.ctx, e2.enqId, {});
  const jobId = await approveAndConvert(e2.ctx, e2.enqId, q2.id);
  const job = (await adminQuery("SELECT * FROM job_card WHERE id = $1", [jobId]))[0];
  assert.equal(job.source_quotation_id, q2.id);
  assert.equal(job.status, "approved");
  await rejects(createJobCard(e2.ctx, e2.enqId, { odometer_in: "999999" }), "validation");
  const tech = await ctxFor("ramesh", "YAS");
  const e3 = await newEnquiry();
  await rejects(createJobCard(tech, e3.enqId), "forbidden");
});

test("the job card odometer cannot be lower than the reading taken at check-in", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  odo += 1000;
  await updateEnquiry(priya, enqId, { odometer_in: String(odo) });
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["DIAG"] });
  const q = await saveQuotation(priya, enqId, {});
  await sendQuotation(priya, q.id);
  const ls = await qLines(q.id);
  await recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "approved" }, "in_person", null);
  await rejects(createJobCard(priya, enqId, { odometer_in: String(odo - 500) }), "validation");
  assert.ok((await createJobCard(priya, enqId, { odometer_in: String(odo) })).id);
});

test("a sent quotation past its validity shows as Expired to staff and can no longer be approved (QT expiry)", async () => {
  const { ctx: priya, enqId } = await newEnquiry();
  await addEnquiryLine(priya, enqId, { line_type: "labour", service_id: svc["DIAG"] });
  const q = await saveQuotation(priya, enqId, {});
  await sendQuotation(priya, q.id);
  await adminQuery("UPDATE quotation SET valid_until = current_date - 1 WHERE id = $1", [q.id]);
  const view = await getEnquiry(priya, enqId);
  assert.equal(view.quotations[0].status, "expired");
  const ls = await qLines(q.id);
  await rejects(recordDecisionsByStaff(priya, q.id, { [ls[0].id]: "approved" }, "in_person", null), "conflict");
});
