import "./env";
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
import * as so from "../lib/services/stock-ops";
import * as pu from "../lib/services/purchasing";
import * as ws from "../lib/services/workshop";

const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);
let items: Record<string, string>, svc: Record<string, string>, YAS: string, QUS: string, cust: string, veh: string;
const bal = async (part: string, br: string) => (await adminQuery("SELECT on_hand, committed, reserved, avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [items[part], br]))[0];
const approveAll = async (user: string, br: string, docType: string) => {
  const ctx = await ctxFor(user, br);
  const mine = (await inbox(ctx)).filter((t) => t.doc_type === docType);
  for (const t of mine) await act(ctx, t.task_id, "approved");
  return mine.length;
};
const balanced = async (sourceId: string) => {
  const r = (await adminQuery("SELECT j.branch_id, sum(l.debit) d, sum(l.credit) c FROM journal j JOIN journal_line l ON l.journal_id = j.id WHERE j.source_id = $1 GROUP BY j.branch_id", [sourceId]));
  for (const x of r) assert.equal(Number(x.d), Number(x.c));
  return r;
};

before(async () => {
  await resetTestDb(true);
  items = Object.fromEntries((await adminQuery("SELECT part_no, id FROM item")).map((r) => [r.part_no, r.id]));
  svc = Object.fromEntries((await adminQuery("SELECT code, id FROM service")).map((r) => [r.code, r.id]));
  YAS = await branchId("YAS"); QUS = await branchId("QUS");
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  veh = await id("vehicle", "plate_number = $1", ["77120"]);
});
after(async () => { await closePool(); });

let odo = 200000;
/** A job card at YAS with the given part lines approved by the customer. */
async function jobWith(parts: [string, string][], labour = true) {
  const priya = await ctxFor("priya", "YAS");
  const e = await createEnquiry(priya, { customer_id: cust, vehicle_id: veh, service_asked: "test", source: "walk_in" });
  if (labour) await addEnquiryLine(priya, e.id, { line_type: "labour", service_id: svc["BRK-FR"] });
  for (const [p, q] of parts) await addEnquiryLine(priya, e.id, { line_type: "part", item_id: items[p], qty: q });
  const qt = await saveQuotation(priya, e.id, {});
  await sendQuotation(priya, qt.id);
  const ql = await adminQuery("SELECT id FROM quotation_line WHERE quotation_id = $1", [qt.id]);
  await recordDecisionsByStaff(priya, qt.id, Object.fromEntries(ql.map((l) => [l.id, "approved"])), "in_person", null);
  odo += 10;
  const j = await createJobCard(priya, e.id, { odometer_in: String(odo) });
  const lines = await adminQuery("SELECT id, line_type, item_id FROM job_line WHERE job_card_id = $1 ORDER BY line_no", [j.id]);
  return { jobId: j.id, lines };
}

test("transfer: request, supplying manager approves (reserved), dispatch into transit, receive with a short quantity (ST-01 to ST-05)", async () => {
  const anil = await ctxFor("anil", "YAS");
  const before = await bal("FLT-AIR-17801", QUS);
  const t = await so.requestTransfer(anil, { from_branch_id: QUS, note: "test", lines: [{ item_id: items["FLT-AIR-17801"], qty: "4" }] });
  assert.equal(t.status, "requested");
  assert.equal((await bal("FLT-AIR-17801", QUS)).reserved, before.reserved, "nothing moves before approval");
  // The YAS manager is not the approver: the supplying branch's manager is.
  assert.equal(await approveAll("yousef", "YAS", "stock_transfer"), 0);
  assert.equal(await approveAll("omar", "QUS", "stock_transfer"), 1);
  assert.equal(Number((await bal("FLT-AIR-17801", QUS)).reserved), Number(before.reserved) + 4);
  // The requesting branch cannot dispatch; the supplying branch can.
  await rejects(so.dispatchTransfer(anil, t.id), "forbidden");
  const omar = await ctxFor("omar", "QUS");
  await so.dispatchTransfer(omar, t.id);
  const afterOut = await bal("FLT-AIR-17801", QUS);
  assert.equal(Number(afterOut.on_hand), Number(before.on_hand) - 4);
  assert.equal(Number(afterOut.reserved), Number(before.reserved));
  const yasBefore = await bal("FLT-AIR-17801", YAS);
  const tl = (await adminQuery("SELECT id FROM transfer_line WHERE transfer_id = $1", [t.id]))[0];
  await rejects(so.receiveTransfer(anil, t.id, { [tl.id]: "3" }), "validation"); // short needs a reason
  await so.receiveTransfer(anil, t.id, { [tl.id]: "3" }, { [tl.id]: "One box crushed" });
  assert.equal(Number((await bal("FLT-AIR-17801", YAS)).on_hand), Number(yasBefore.on_hand) + 3);
  const line = (await adminQuery("SELECT short_qty, short_reason FROM transfer_line WHERE id = $1", [tl.id]))[0];
  assert.equal(Number(line.short_qty), 1);
  // No sale, no VAT: each side's journal balances on its own; in transit = 1 unit still open.
  const j = await balanced(t.id);
  assert.equal(j.length, 2);
  const transit = await adminQuery("SELECT sum(l.debit - l.credit) v FROM journal_line l JOIN account a ON a.id = l.account_id JOIN journal j ON j.id = l.journal_id WHERE a.code = '1320' AND j.source_id = $1", [t.id]);
  assert.equal(Number(transit[0].v), 38);
});

test("transfer: cancelling after approval gives the reservation back; rejection needs a reason", async () => {
  const anil = await ctxFor("anil", "YAS");
  const before = await bal("TYR-2656517", QUS);
  const t = await so.requestTransfer(anil, { from_branch_id: QUS, lines: [{ item_id: items["TYR-2656517"], qty: "1" }] });
  await approveAll("omar", "QUS", "stock_transfer");
  const omar = await ctxFor("omar", "QUS");
  await so.cancelTransfer(omar, t.id, "Needed here after all");
  assert.equal((await bal("TYR-2656517", QUS)).reserved, before.reserved);
  const t2 = await so.requestTransfer(anil, { from_branch_id: QUS, lines: [{ item_id: items["TYR-2656517"], qty: "1" }] });
  const task = (await inbox(omar)).find((x) => x.doc_id === t2.id)!;
  await assert.rejects(act(omar, task.task_id, "rejected", ""));
  await act(omar, task.task_id, "rejected", "No spare battery");
  assert.equal((await adminQuery("SELECT status FROM transfer WHERE id = $1", [t2.id]))[0].status, "rejected");
});

test("back order: planning shows other branches' free stock; 'Request from branch' is linked to the job and fills it first on receipt (PC-05, PC-06, PC-08)", async () => {
  // YAS has 2 brake pad sets; a job needing 3 is short 1.
  const first = await jobWith([["BRK-PAD-FR-LC", "3"]]);
  const sc = (await adminQuery("SELECT * FROM stock_commitment WHERE job_line_id = $1", [first.lines[1].id]))[0];
  assert.equal(Number(sc.back_ordered), 1);
  const anil = await ctxFor("anil", "YAS");
  const plan = await so.planning(anil);
  const row = plan.find((r) => r.id === sc.id)!;
  assert.ok(row.elsewhere.some((e: { branch_id: string }) => e.branch_id === QUS), "QUS free stock shown");
  // A second job waits for the same part, created earlier than the transfer.
  const second = await jobWith([["BRK-PAD-FR-LC", "1"]], false);
  const t = await so.requestFromBranch(anil, sc.id, QUS);
  assert.equal((await adminQuery("SELECT source_ref FROM stock_commitment WHERE id = $1", [sc.id]))[0].source_ref, t.docNo);
  await rejects(so.requestFromBranch(anil, sc.id, QUS), "validation"); // already being sourced
  await approveAll("omar", "QUS", "stock_transfer");
  await so.dispatchTransfer(await ctxFor("omar", "QUS"), t.id);
  await so.receiveTransfer(anil, t.id, {});
  const after1 = (await adminQuery("SELECT qty, back_ordered, source_ref FROM stock_commitment WHERE id = $1", [sc.id]))[0];
  assert.equal(Number(after1.back_ordered), 0, "the job the transfer was raised for is filled");
  assert.equal(after1.source_ref, null);
  const sc2 = (await adminQuery("SELECT back_ordered FROM stock_commitment WHERE job_line_id = $1", [second.lines[0].id]))[0];
  assert.equal(Number(sc2.back_ordered), 1, "the other job still waits");
});

test("adjustment: goes to the branch manager; damage posts to write-off at average cost; nothing posts before approval (IN-09)", async () => {
  const anil = await ctxFor("anil", "YAS");
  const b0 = await bal("WPR-24", YAS);
  const a = await so.createAdjustment(anil, { reason: "damage", note: "Torn", lines: [{ item_id: items["WPR-24"], qty_change: "-2" }] });
  assert.equal(a.status, "pending");
  assert.equal((await bal("WPR-24", YAS)).on_hand, b0.on_hand);
  await approveAll("yousef", "YAS", "stock_adjustment");
  assert.equal(Number((await bal("WPR-24", YAS)).on_hand), Number(b0.on_hand) - 2);
  const j = await adminQuery("SELECT a.code, l.debit, l.credit FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id WHERE j.source_id = $1 ORDER BY a.code", [a.id]);
  assert.deepEqual(j.map((x) => [x.code, Number(x.debit), Number(x.credit)]), [["1300", 0, 42], ["5200", 42, 0]]);
  // Committed stock cannot be adjusted away.
  await rejects(so.createAdjustment(anil, { reason: "damage", lines: [{ item_id: items["WPR-24"], qty_change: "-500" }] }), "validation");
});

test("count: blind for the counter; differences become an adjustment for approval (IN-07)", async () => {
  const anil = await ctxFor("anil", "YAS");
  const cnt = await so.startCount(anil, "batteries");
  const view = await so.getCount(anil, cnt.id);
  assert.equal(view.lines[0].system_qty, undefined, "book quantity hidden while counting");
  const b0 = await bal("BAT-70AH", YAS);
  await rejects(so.saveCountLines(anil, cnt.id, {}, true), "validation"); // every line must be counted
  const r = await so.saveCountLines(anil, cnt.id, { [view.lines[0].id]: String(Number(b0.on_hand) + 1) }, true);
  assert.equal(r.status, "submitted");
  const yousef = await ctxFor("yousef", "YAS");
  assert.ok((await so.getCount(yousef, cnt.id)).showBook);
  await approveAll("yousef", "YAS", "stock_adjustment");
  assert.equal(Number((await bal("BAT-70AH", YAS)).on_hand), Number(b0.on_hand) + 1);
  assert.equal((await adminQuery("SELECT status FROM stock_count WHERE id = $1", [cnt.id]))[0].status, "approved");
});

test("purchase order: approval by amount; GRN at weighted average cost; matched bill posts, a mismatch waits for the accountant (PU-02, PU-04, PU-05)", async () => {
  const anil = await ctxFor("anil", "YAS");
  const supplier = await id("supplier", "code = $1", ["AGMC"]);
  // AED 5,000 or less needs no approval (BRD 7.10 example bands).
  const small = await pu.createPo(anil, { supplier_id: supplier });
  await pu.addPoLine(anil, small.id, { item_id: items["FLT-OIL-90915"], qty: "20", unit_price: "21" });
  assert.equal(await pu.submitPo(anil, small.id), "approved");
  const big = await pu.createPo(anil, { supplier_id: supplier });
  await pu.addPoLine(anil, big.id, { item_id: items["BRK-PAD-FR-LC"], qty: "30", unit_price: "200" });
  assert.equal(await pu.submitPo(anil, big.id), "pending");
  await rejects(pu.receiveGoods(anil, big.id, { qty: {} }), "validation");
  await approveAll("yousef", "YAS", "purchase_order");
  const b0 = await bal("FLT-OIL-90915", YAS);
  const pl = (await adminQuery("SELECT id FROM po_line WHERE po_id = $1", [small.id]))[0];
  await rejects(pu.receiveGoods(anil, small.id, { qty: { [pl.id]: "21" } }), "validation"); // more than ordered
  const g = await pu.receiveGoods(anil, small.id, { qty: { [pl.id]: "10" } });
  const b1 = await bal("FLT-OIL-90915", YAS);
  const expectAvg = (Number(b0.on_hand) * Number(b0.avg_cost) + 10 * 21) / (Number(b0.on_hand) + 10);
  assert.equal(Number(b1.avg_cost).toFixed(4), expectAvg.toFixed(4));
  assert.equal((await adminQuery("SELECT status FROM purchase_order WHERE id = $1", [small.id]))[0].status, "partly_received");
  await balanced(g.id);
  const gl = (await adminQuery("SELECT gl.id FROM grn_line gl WHERE grn_id = $1", [g.id]))[0];
  const maryam = await ctxFor("maryam", "YAS");
  const ok = await pu.createBill(maryam, { supplier_id: supplier, supplier_invoice_no: "INV-1", invoice_date: "2026-11-17", lines: [{ grn_line_id: gl.id, qty: "10", unit_price: "21.10" }] });
  assert.equal(ok.match, "matched"); // AED 1 over on 210 is inside the AED 5 tolerance
  const j = await adminQuery("SELECT a.code, l.debit, l.credit FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id WHERE j.source_id = $1 ORDER BY a.code", [ok.id]);
  assert.deepEqual(j.map((x) => [x.code, Number(x.debit), Number(x.credit)]), [["2000", 0, 221.55], ["2100", 210, 0], ["2210", 10.55, 0], ["5110", 1, 0]]);
  await rejects(pu.createBill(maryam, { supplier_id: supplier, supplier_invoice_no: "INV-1", invoice_date: "2026-11-17", lines: [{ description: "x", expense_type: "other", qty: "1", unit_price: "1" }] }), "validation");
  // A second receipt billed at a price far above the order goes to approval and posts nothing yet.
  const g2 = await pu.receiveGoods(anil, small.id, { qty: { [pl.id]: "10" } });
  const gl2 = (await adminQuery("SELECT id FROM grn_line WHERE grn_id = $1", [g2.id]))[0];
  const bad = await pu.createBill(await ctxFor("saeed", "YAS"), { supplier_id: supplier, supplier_invoice_no: "INV-2", invoice_date: "2026-11-17", lines: [{ grn_line_id: gl2.id, qty: "10", unit_price: "25" }] });
  assert.equal(bad.match, "mismatch");
  assert.equal((await adminQuery("SELECT count(*) n FROM journal WHERE source_id = $1", [bad.id]))[0].n, "0");
  await approveAll("maryam", "HQ", "supplier_bill");
  assert.equal((await adminQuery("SELECT status FROM supplier_bill WHERE id = $1", [bad.id]))[0].status, "posted");
  await balanced(bad.id);
});

test("purchase order linked to a back-ordered job line commits the received parts to that job (PC-06, PU-03)", async () => {
  const job = await jobWith([["TYR-2656517", "20"]], false);
  const sc = (await adminQuery("SELECT * FROM stock_commitment WHERE job_line_id = $1", [job.lines[0].id]))[0];
  assert.equal(Number(sc.back_ordered), 4);
  const anil = await ctxFor("anil", "YAS");
  const po = await pu.raisePoForBackOrder(anil, sc.id);
  await adminQuery("UPDATE po_line SET unit_price = 280, net_amount = 1120, vat_amount = 56, line_total = 1176 WHERE po_id = $1", [po.id]);
  await pu.submitPo(anil, po.id);
  const pl = (await adminQuery("SELECT id, job_line_id FROM po_line WHERE po_id = $1", [po.id]))[0];
  assert.equal(pl.job_line_id, job.lines[0].id);
  await pu.receiveGoods(anil, po.id, { qty: { [pl.id]: "4" } });
  assert.equal(Number((await adminQuery("SELECT back_ordered FROM stock_commitment WHERE id = $1", [sc.id]))[0].back_ordered), 0);
});

test("petty cash: receipt photo required, VAT only with a TRN, cannot spend more than the box holds (PU-06)", async () => {
  const anil = await ctxFor("anil", "YAS");
  const photo = { name: "r.jpg", type: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) };
  await rejects(pu.pettyCashTopUp(anil, "500", ""), "forbidden");
  await pu.pettyCashTopUp(await ctxFor("yousef", "YAS"), "300", "Weekly float");
  await rejects(pu.pettyCashSpend(anil, { supplier_name: "ADNOC", expense_type: "fuel", net_amount: "100", vat_amount: "5" }, null), "validation");
  await rejects(pu.pettyCashSpend(anil, { supplier_name: "ADNOC", expense_type: "fuel", net_amount: "100", vat_amount: "5" }, photo), "validation");
  await pu.pettyCashSpend(anil, { supplier_name: "ADNOC", supplier_trn: "100000000000003", expense_type: "fuel", net_amount: "100", vat_amount: "5" }, photo);
  await rejects(pu.pettyCashSpend(anil, { supplier_name: "Shop", expense_type: "other", net_amount: "500" }, photo), "validation");
  assert.equal((await pu.pettyCash(anil)).balance, "195.00");
});

test("clocking: only assigned technicians; one job at a time with a confirmed switch; pause needs a reason (WS-02, WS-04)", async () => {
  const a = await jobWith([], true);
  const b = await jobWith([], true);
  const khalid = await ctxFor("khalid", "YAS");
  const ramesh = await ctxFor("ramesh", "YAS");
  const arjun = await ctxFor("arjun", "YAS");
  await ws.setAssignments(khalid, a.lines[0].id, [ramesh.userId, arjun.userId]);
  await ws.setAssignments(khalid, b.lines[0].id, [ramesh.userId]);
  await rejects(ws.setAssignments(khalid, a.lines[0].id, [khalid.userId]), "validation");
  await rejects(ws.clock(arjun, b.lines[0].id, "clock_in"), "forbidden");
  await ws.clock(ramesh, a.lines[0].id, "clock_in");
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [a.jobId]))[0].status, "in_progress");
  await rejects(ws.clock(ramesh, b.lines[0].id, "clock_in"), "conflict");
  await ws.clock(ramesh, b.lines[0].id, "clock_in", { confirmSwitch: true });
  const lastA = (await adminQuery("SELECT kind, reason FROM time_event WHERE job_line_id = $1 AND technician_id = $2 ORDER BY at DESC, created_at DESC LIMIT 1", [a.lines[0].id, ramesh.userId]))[0];
  assert.deepEqual([lastA.kind, lastA.reason], ["pause", "switched"]);
  await rejects(ws.clock(ramesh, b.lines[0].id, "pause"), "validation");
  await ws.clock(ramesh, b.lines[0].id, "pause", { reason: "parts" });
  await ws.clock(ramesh, b.lines[0].id, "resume");
  await ws.clock(ramesh, b.lines[0].id, "clock_out");
  const mine = await ws.myJobs(ramesh);
  assert.equal(mine.find((x) => x.line_id === b.lines[0].id)!.state, "done");
  assert.equal(mine.find((x) => x.line_id === a.lines[0].id)!.state, "paused");
  // WS-07: a supervisor corrects an event; not the technician himself.
  const ev = (await adminQuery("SELECT id, at FROM time_event WHERE job_line_id = $1 AND kind = 'clock_out'", [b.lines[0].id]))[0];
  await rejects(ws.correctEvent(ramesh, ev.id, new Date().toISOString(), "forgot"), "forbidden");
  await ws.correctEvent(khalid, ev.id, new Date(Date.now() - 60_000).toISOString(), "Forgot to clock out");
  const fixed = (await adminQuery("SELECT corrected, original_at FROM time_event WHERE id = $1", [ev.id]))[0];
  assert.equal(fixed.corrected, true);
  assert.ok(fixed.original_at);
});

test("clocked time, line colour and efficiency follow FSD 5.4 (2 h 30 m standard, 2 h 55 m clocked = 85.7%)", () => {
  const t0 = new Date("2026-11-17T08:00:00+04:00").getTime();
  const at = (m: number) => new Date(t0 + m * 60000);
  const ev = [{ kind: "clock_in", at: at(0) }, { kind: "pause", at: at(60), reason: "break" }, { kind: "resume", at: at(90) }, { kind: "clock_out", at: at(205) }];
  const r = ws.clockedMinutes(ev);
  assert.equal(r.minutes, 175);
  assert.equal(Math.round(r.pauses.break), 30);
  assert.equal((2.5 / (175 / 60) * 100).toFixed(1), "85.7");
  assert.equal(ws.lineColour(175, 2.5, 85), "red");
  assert.equal(ws.lineColour(130, 2.5, 85), "amber");
  assert.equal(ws.lineColour(60, 2.5, 85), "green");
  assert.equal(ws.jobColour(new Date(Date.now() + 10 * 60000), 30), "amber");
  assert.equal(ws.jobColour(new Date(Date.now() - 60000), 30), "red");
});

test("quality check: a failure sends the job back with the failed items; a pass makes it Ready; delivery needs the walkthrough and a valid odometer (WS-09, WS-10)", async () => {
  const j = await jobWith([], true);
  const priya = await ctxFor("priya", "YAS");
  const khalid = await ctxFor("khalid", "YAS");
  await rejects(changeStatus(priya, j.jobId, "ready"), "validation");
  await changeStatus(priya, j.jobId, "in_progress");
  await changeStatus(priya, j.jobId, "quality_check");
  const codes = (await adminQuery("SELECT code FROM lookup_value WHERE list = 'qc_checklist'")).map((r) => r.code);
  const all = (v: string) => Object.fromEntries(codes.map((c) => [c, v]));
  await rejects(ws.recordQc(priya, j.jobId, all("done"), {}), "forbidden");
  await rejects(ws.recordQc(khalid, j.jobId, { ...all("done"), road_test: "failed" }, {}), "validation"); // failure needs a note
  assert.equal(await ws.recordQc(khalid, j.jobId, { ...all("done"), road_test: "failed" }, { road_test: "Pulls left" }), false);
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [j.jobId]))[0].status, "in_progress");
  await changeStatus(priya, j.jobId, "quality_check");
  assert.equal(await ws.recordQc(khalid, j.jobId, all("done"), {}), true);
  const job = (await adminQuery("SELECT status, ready_at, odometer_in FROM job_card WHERE id = $1", [j.jobId]))[0];
  assert.equal(job.status, "ready");
  assert.ok(job.ready_at);
  const chk = Object.fromEntries((await adminQuery("SELECT code FROM lookup_value WHERE list = 'delivery_checklist'")).map((r) => [`chk_${r.code}`, "on"]));
  await rejects(ws.deliver(priya, j.jobId, { old_parts: "returned", received_by_name: "Fatima", odometer_out: String(job.odometer_in + 2) }), "validation");
  await rejects(ws.deliver(priya, j.jobId, { ...chk, old_parts: "returned", received_by_name: "Fatima", odometer_out: String(job.odometer_in - 1) }), "validation");
  await ws.deliver(priya, j.jobId, { ...chk, old_parts: "returned", received_by_name: "Fatima", odometer_out: String(job.odometer_in + 2) });
  assert.equal((await adminQuery("SELECT status FROM job_card WHERE id = $1", [j.jobId]))[0].status, "delivered");
});

test("store queue: a technician's request for a part already approved on the job goes to the store; a new part needs a quote first (WS-08)", async () => {
  const j = await jobWith([["CLT-L", "2"]], true);
  const khalid = await ctxFor("khalid", "YAS");
  const ramesh = await ctxFor("ramesh", "YAS");
  await ws.setAssignments(khalid, j.lines[0].id, [ramesh.userId]);
  assert.equal(await ws.requestPart(ramesh, j.jobId, { item_id: items["CLT-L"], qty: "2" }), "open");
  assert.equal(await ws.requestPart(ramesh, j.jobId, { item_id: items["BAT-70AH"], qty: "1", note: "Battery weak" }), "needs_quote");
  const anil = await ctxFor("anil", "YAS");
  const q = await so.storeQueue(anil);
  assert.ok(q.requests.some((r) => r.job_card_id === j.jobId && r.status === "open"));
  await issueToJobLine(anil, j.lines[1].id, "2");
  assert.ok(!(await so.storeQueue(anil)).toIssue.some((r) => r.job_line_id === j.lines[1].id));
});

test("workshop board: the wall-screen link works without signing in, only for its own branch, and shows no prices", async () => {
  const token = (await adminQuery("SELECT board_token FROM branch WHERE code = 'YAS'"))[0].board_token;
  const b = await ws.publicBoard(token);
  assert.ok(b && b.jobs.length > 0);
  assert.ok(b!.jobs.every((x) => !("grand_total" in x) && !("unit_price" in x)));
  assert.equal(await ws.publicBoard("0".repeat(24)), null);
  assert.equal(await ws.publicBoard("not-a-token"), null);
});
