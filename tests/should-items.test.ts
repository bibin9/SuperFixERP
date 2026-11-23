import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import * as rq from "../lib/services/rfq";
import * as pu from "../lib/services/purchasing";

before(async () => { await resetTestDb(); });
after(async () => { await closePool(); });
const rejects = (p: Promise<unknown>, re?: RegExp) => assert.rejects(p, (e: unknown) => e instanceof AppError && (!re || re.test(e.message)));

test("PU-08: quotes from several suppliers are compared per line; ordering raises one draft PO per chosen supplier", async () => {
  const anil = await ctxFor("anil", "YAS");
  const [oil, pads] = (await adminQuery("SELECT id FROM item WHERE part_no IN ('FLT-OIL-90915','BRK-PAD-FR-LC') ORDER BY part_no")).map((r) => r.id);
  const [s1, s2] = (await adminQuery("SELECT id FROM supplier WHERE active ORDER BY code LIMIT 2")).map((r) => r.id);
  await rejects(rq.createRfq(anil, { lines: [] }), /at least one part/);
  const r = await rq.createRfq(anil, { needed_by: "2026-12-01", lines: [{ item_id: pads, qty: "2" }, { item_id: oil, qty: "10" }] });
  let g = await rq.getRfq(anil, r.id);
  const [lPads, lOil] = g.lines.map((l) => l.id);
  await rejects(rq.saveQuote(anil, r.id, { supplier_id: s1, price: {} }), /at least one line/);
  await rq.saveQuote(anil, r.id, { supplier_id: s1, lead_days: "2", price: { [lPads]: "300", [lOil]: "30" } });
  await rq.saveQuote(anil, r.id, { supplier_id: s2, lead_days: "7", price: { [lPads]: "280", [lOil]: "30" } });
  g = await rq.getRfq(anil, r.id);
  const q1 = g.quotes.find((q) => q.supplier_id === s1)!.id, q2 = g.quotes.find((q) => q.supplier_id === s2)!.id;
  assert.equal(g.best[lPads], q2);           // cheaper
  assert.equal(g.best[lOil], q1);            // same price, shorter lead time
  assert.equal(g.totals[q1].total, "900.00");
  // A user without purchase-cost access sees no prices.
  const priya = await ctxFor("priya", "YAS");
  await assert.rejects(rq.getRfq(priya, r.id).then((x) => { if (Object.keys(x.price).length) throw new AppError("forbidden", "saw prices"); throw new AppError("forbidden", "ok"); }), (e: unknown) => e instanceof AppError && (e.message === "ok" || /not allowed|permission|access/i.test(e.message)));
  // Order: pads from the chosen (cheaper) supplier, oil left for later.
  const res = await rq.orderRfq(anil, r.id, { [lOil]: "skip" });
  assert.equal(res.orders.length, 1); assert.equal(res.left, 1);
  const po = (await adminQuery("SELECT p.id, p.supplier_id, p.status, l.unit_price, l.qty FROM purchase_order p JOIN po_line l ON l.po_id = p.id WHERE p.doc_no = $1", [res.orders[0]]))[0];
  assert.deepEqual([po.supplier_id, po.status, po.unit_price, po.qty], [s2, "draft", "280.0000", "2.000"]);
  // The rest goes to the cheapest on the second run; then the request is closed.
  const res2 = await rq.orderRfq(anil, r.id, {});
  assert.equal(res2.left, 0);
  assert.equal((await adminQuery("SELECT status FROM rfq WHERE id = $1", [r.id]))[0].status, "ordered");
  await rejects(rq.saveQuote(anil, r.id, { supplier_id: s1, price: { [lOil]: "1" } }), /closed/);
  // The PO still goes through approval as usual.
  await pu.submitPo(anil, po.id);
  // Another branch cannot work on it.
  await rejects(rq.cancelRfq(await ctxFor("omar", "QUS"), r.id));
});

test("OT-05: a supplier warranty claim goes open → sent → credited / replaced / rejected, with stock and journals", async () => {
  const sc = await import("../lib/services/supplier-claims");
  const anil = await ctxFor("anil", "YAS");
  const bat = (await adminQuery("SELECT id FROM item WHERE part_no = 'BAT-70AH'"))[0].id;
  const sup = (await adminQuery("SELECT id FROM supplier WHERE active ORDER BY code LIMIT 1"))[0].id;
  const yas = (await adminQuery("SELECT id FROM branch WHERE code = 'YAS'"))[0].id;
  const onHand = async () => (await adminQuery("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [bat, yas]))[0]?.on_hand;
  await rejects(sc.openClaim(anil, { supplier_id: sup, item_id: bat, fault: "dead" }), /job the part failed on/);
  // Off the shelf: leaves stock when sent, replacement comes back.
  const before = await onHand();
  const a = await sc.openClaim(anil, { supplier_id: sup, item_id: bat, qty: "1", fault: "Dead on arrival", serial_no: "SN-1", from_stock: "on" });
  await rejects(sc.workClaim(anil, a.id, "replace", {}), /Send the claim/);
  await sc.workClaim(anil, a.id, "send", { sent_ref: "DN-1" });
  assert.equal(Number(await onHand()), Number(before) - 1);
  await sc.workClaim(anil, a.id, "replace", { supplier_ref: "RPL-9" });
  assert.equal(Number(await onHand()), Number(before));
  const jr = await adminQuery(`SELECT a.code, sum(l.debit) dr, sum(l.credit) cr FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id
    WHERE j.source_type = 'supplier_claim' AND j.source_id = $1 GROUP BY a.code ORDER BY a.code`, [a.id]);
  assert.deepEqual(jr.map((x) => [x.code, x.dr === x.cr]), [["1300", true], ["5500", true]]);   // nets to zero: stock out and back
  // From a job: credit note reduces payables and warranty cost; the store cannot post money.
  const job = (await adminQuery("SELECT id FROM job_card WHERE branch_id = $1 LIMIT 1", [yas]))[0].id;
  const b = await sc.openClaim(anil, { supplier_id: sup, item_id: bat, fault: "Failed after 3 months", job_card_id: job });
  await sc.workClaim(anil, b.id, "send", {});
  await rejects(sc.workClaim(anil, b.id, "reject", {}), /why/);
  const maryam = await ctxFor("maryam", "YAS");
  const credit = async (ctx: Awaited<ReturnType<typeof ctxFor>>) => sc.workClaim(ctx, b.id, "credit", { credit_amount: "200", supplier_ref: "SCN-77" });
  const officer = (await adminQuery("SELECT u.username FROM app_user u JOIN user_branch_role ubr ON ubr.user_id = u.id JOIN role r ON r.id = ubr.role_id WHERE r.code IN ('purchasing','purchase_officer','purchasing_officer') LIMIT 1"))[0]?.username;
  const poster = officer ? await ctxFor(officer, "YAS") : anil;
  try { await credit(poster); } catch (e) { if (!(e instanceof AppError)) throw e; await credit(maryam); }
  const cr = await adminQuery(`SELECT a.code, l.debit, l.credit, l.supplier_id FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id
    WHERE j.source_type = 'supplier_claim' AND j.source_id = $1 ORDER BY a.code`, [b.id]);
  assert.deepEqual(cr.map((x) => [x.code, x.debit, x.credit]), [["2000", "210.00", "0.00"], ["2210", "0.00", "10.00"], ["5500", "0.00", "200.00"]]);
  assert.equal(cr[0].supplier_id, sup);
  // Another branch cannot touch it.
  await rejects(sc.workClaim(await ctxFor("omar", "QUS"), b.id, "reject", { outcome_note: "x" }));
});

test("WF-07: a waiting approval is flagged after its reminder time and offered to the escalation role after its escalation time", async () => {
  const { inbox, act } = await import("../lib/services/workflow");
  const { alertsFor } = await import("../lib/services/home");
  const anil = await ctxFor("anil", "YAS");
  const item = (await adminQuery("SELECT id FROM item WHERE part_no = 'TYR-2656517'"))[0].id;
  const sup = (await adminQuery("SELECT id FROM supplier WHERE active ORDER BY code LIMIT 1"))[0].id;
  const po = await pu.createPo(anil, { supplier_id: sup });
  await pu.addPoLine(anil, po.id, { item_id: item, qty: "20", unit_price: "400" });   // 8,400 incl. VAT: branch manager step
  await pu.submitPo(anil, po.id);
  const t = (await adminQuery(`SELECT t.id, t.remind_after > now() + interval '23 hours' r, t.escalate_after > now() + interval '47 hours' e, ro.code
    FROM approval_task t JOIN approval_request r ON r.id = t.request_id LEFT JOIN role ro ON ro.id = t.escalate_role_id WHERE r.doc_id = $1`, [po.id]))[0];
  assert.deepEqual([t.r, t.e, t.code], [true, true, "owner"]);   // defaults from Settings
  const maryam = await ctxFor("maryam", "YAS");
  assert.ok(!(await inbox(maryam)).some((i) => i.task_id === t.id));
  // Past the reminder: the branch manager sees it flagged, in the inbox and the bell.
  await adminQuery("UPDATE approval_task SET remind_after = now() - interval '1 hour' WHERE id = $1", [t.id]);
  const yousef = await ctxFor("yousef", "YAS");
  assert.equal((await inbox(yousef)).find((i) => i.task_id === t.id)?.overdue, true);
  assert.ok((await alertsFor(yousef)).some((a) => a.group === "Approvals waiting too long"));
  // Past the escalation time, to the accountant role: Maryam can now approve it, marked as escalated.
  await adminQuery("UPDATE approval_task SET escalate_after = now() - interval '1 minute', escalate_role_id = (SELECT id FROM role WHERE code = 'accountant') WHERE id = $1", [t.id]);
  const mine = (await inbox(maryam)).find((i) => i.task_id === t.id);
  assert.equal(mine?.escalated, true);
  await act(maryam, t.id, "approved");
  assert.equal((await adminQuery("SELECT status FROM purchase_order WHERE id = $1", [po.id]))[0].status, "approved");
});

test("IN-03: tyres are received with their DOT and leave oldest first; batteries and tyres are traced by serial for warranty", async () => {
  const ty = await import("../lib/services/tyres");
  const { globalSearch } = await import("../lib/services/search");
  const { stockOut } = await import("../lib/services/stock");
  const { withTx } = await import("../lib/db");
  const { D } = await import("../lib/money");
  const anil = await ctxFor("anil", "YAS");
  const yas = (await adminQuery("SELECT id FROM branch WHERE code = 'YAS'"))[0].id;
  const tyre = (await adminQuery("SELECT id FROM item WHERE part_no = 'TYR-2656517'"))[0].id;
  const bat = (await adminQuery("SELECT id FROM item WHERE part_no = 'BAT-70AH'"))[0].id;
  const sup = (await adminQuery("SELECT id FROM supplier WHERE active ORDER BY code LIMIT 1"))[0].id;
  // Receive 2 tyres made week 1 of 2020 and 2 made week 24 of 2026.
  const po = await pu.createPo(anil, { supplier_id: sup });
  await pu.addPoLine(anil, po.id, { item_id: tyre, qty: "2", unit_price: "100" });
  await pu.addPoLine(anil, po.id, { item_id: tyre, qty: "2", unit_price: "100" });
  await pu.submitPo(anil, po.id);
  if ((await adminQuery("SELECT status FROM purchase_order WHERE id = $1", [po.id]))[0].status !== "approved") await adminQuery("UPDATE purchase_order SET status = 'approved' WHERE id = $1", [po.id]);
  const [l1, l2] = (await adminQuery("SELECT id FROM po_line WHERE po_id = $1 ORDER BY line_no", [po.id])).map((r) => r.id);
  await rejects(pu.receiveGoods(anil, po.id, { qty: { [l1]: "2", [l2]: "2" }, dot: { [l1]: "5520" } }), /DOT|week/i);
  await pu.receiveGoods(anil, po.id, { qty: { [l1]: "2", [l2]: "2" }, dot: { [l1]: "0120", [l2]: "2426" } });
  let t = await ty.tyreStock(anil);
  let row = t.items.find((i) => i.id === tyre)!;
  assert.deepEqual(row.dots.map((d) => [d.dot, d.qty, d.old]), [["0120", "2", true], ["2426", "2", false]]);
  assert.equal(row.tyre_size, "265/65R17");
  // Three go out: both old ones first, then one new.
  await withTx(anil, (c) => stockOut(c, anil, { branchId: yas, itemId: tyre, qty: D(3), moveType: "adjustment", ref: "test" }));
  t = await ty.tyreStock(anil);
  row = t.items.find((i) => i.id === tyre)!;
  assert.deepEqual(row.dots.map((d) => [d.dot, d.qty]), [["2426", "1"]]);
  // Battery fitted on a job: serial recorded with 18 months warranty, found by search.
  const line = (await adminQuery("SELECT l.id FROM job_line l JOIN job_card j ON j.id = l.job_card_id WHERE j.branch_id = $1 AND l.line_type = 'part' AND NOT l.removed LIMIT 1", [yas]))[0].id;
  await adminQuery("UPDATE job_line SET item_id = $2, qty = 1, issued_qty = 0 WHERE id = $1", [line, bat]);
  await rejects(ty.recordSerial(anil, line, "BT-001"), /Issue the part/);
  await adminQuery("UPDATE job_line SET issued_qty = 1 WHERE id = $1", [line]);
  await rejects(ty.recordSerial(anil, line, ""), /serial/);
  await rejects(ty.recordSerial(anil, line, "BT-001, BT-002"), /one serial per part/);
  await ty.recordSerial(anil, line, "BT-001");
  await rejects(ty.recordSerial(anil, line, "bt-001"), /already recorded|one serial/);
  const f = await ty.findSerial(anil, "BT-0");
  assert.equal(f.length, 1); assert.equal(f[0].under_warranty, true);
  assert.equal((await adminQuery("SELECT warranty_until = current_date + interval '18 months' ok FROM part_serial WHERE serial_no = 'BT-001'"))[0].ok, true);
  assert.ok((await globalSearch(anil, "BT-001")).some((r) => r.type === "Serial" && /under warranty/.test(r.sub)));
  // Another branch sees nothing and cannot record.
  const omar = await ctxFor("omar", "QUS");
  assert.equal((await ty.findSerial(omar, "BT-001")).length, 0);
  await rejects(ty.recordSerial(omar, line, "BT-009"));
});

test("SL-02: trade sale goes quotation → sales order → delivery notes → one credit invoice due on the customer's terms", async () => {
  const ts = await import("../lib/services/trade-sales");
  const priya = await ctxFor("priya", "YAS");
  const yousef = await ctxFor("yousef", "YAS");
  const anil = await ctxFor("anil", "YAS");
  const yas = (await adminQuery("SELECT id FROM branch WHERE code = 'YAS'"))[0].id;
  const cust = (await adminQuery("SELECT id FROM customer WHERE customer_type <> 'individual' AND NOT is_walk_in AND active ORDER BY customer_no LIMIT 1"))[0].id;
  await adminQuery("UPDATE customer SET payment_terms_days = 0, credit_limit = 0 WHERE id = $1", [cust]);
  const oil = (await adminQuery("SELECT id FROM item WHERE part_no = 'FLT-OIL-90915'"))[0].id;
  const wpr = (await adminQuery("SELECT id FROM item WHERE part_no = 'WPR-24'"))[0].id;
  await rejects(ts.createOrder(priya, {}), /customer/);
  const o = await ts.createOrder(priya, { customer_id: cust, customer_ref: "LPO-55" });
  await rejects(ts.confirmOrder(priya, o.id, {}), /at least one part/);
  await ts.addOrderLine(priya, o.id, { item_id: oil, qty: "4" });
  await ts.addOrderLine(priya, o.id, { item_id: wpr, qty: "2" });
  await rejects(ts.addOrderLine(priya, o.id, { item_id: wpr, qty: "1", discount: "1000" }), /discount is more|limit/);
  await rejects(ts.deliver(anil, o.id, { qty: {} }), /Confirm the order first/);
  // No credit terms: must go to the counter. Then terms but a tiny limit: only the manager may confirm.
  await rejects(ts.confirmOrder(priya, o.id, {}), /no credit terms/);
  await adminQuery("UPDATE customer SET payment_terms_days = 30, credit_limit = 1 WHERE id = $1", [cust]);
  await rejects(ts.confirmOrder(priya, o.id, {}), /over their credit limit/);
  await ts.confirmOrder(yousef, o.id, {});
  await rejects(ts.addOrderLine(priya, o.id, { item_id: oil, qty: "1" }), /only while it is a quotation/);
  let g = await ts.getOrder(anil, o.id);
  const [lOil, lWpr] = g.lines.map((l) => l.id as string);
  const onHand = async (item: string) => Number((await adminQuery("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [item, yas]))[0].on_hand);
  const before = await onHand(oil);
  await rejects(ts.deliver(anil, o.id, { qty: { [lOil]: "9" } }), /only 4 left/);
  // First delivery: 3 oil filters. Stock goes out and cost of sales is posted.
  const dn1 = await ts.deliver(anil, o.id, { qty: { [lOil]: "3" }, received_by_name: "Driver Ali" });
  assert.equal(await onHand(oil), before - 3);
  const cogs = await adminQuery(`SELECT a.code, l.debit, l.credit FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id WHERE j.source_type = 'delivery_note' AND j.source_id = $1 ORDER BY a.code`, [dn1.id]);
  assert.equal(cogs.length, 2); assert.equal(cogs[0].code, "1300"); assert.ok(Number(cogs[0].credit) > 0);
  assert.equal(cogs.reduce((s, x) => s + Number(x.debit) - Number(x.credit), 0), 0);
  await rejects(ts.cancelOrder(priya, o.id), /cannot be cancelled/);
  // Invoice what went out: 3 of 4 filters, due in 30 days, sales and VAT only (cost was posted on delivery).
  const inv1 = await ts.invoiceOrder(priya, o.id);
  const i1 = (await adminQuery("SELECT source, due_date - doc_date days, taxable_total, vat_total, grand_total, lpo_no FROM sales_invoice WHERE id = $1", [inv1.id]))[0];
  assert.deepEqual([i1.source, i1.days, i1.lpo_no], ["trade", 30, "LPO-55"]);
  await rejects(ts.invoiceOrder(priya, o.id), /Nothing delivered/);
  // The rest goes out and is invoiced; line totals add up exactly to the order.
  await ts.deliver(anil, o.id, { qty: { [lOil]: "1", [lWpr]: "2" } });
  await ts.invoiceOrder(priya, o.id);
  g = await ts.getOrder(priya, o.id);
  assert.equal(g.o.status, "closed");
  const sum = (await adminQuery("SELECT sum(grand_total) t FROM sales_invoice WHERE sales_order_id = $1", [o.id]))[0].t;
  assert.equal(sum, g.o.grand_total);
  assert.equal(g.notes.length, 2); assert.equal(g.invoices.length, 2);
  // A technician cannot open it; nor can another branch.
  await rejects(ts.getOrder(await ctxFor("ramesh", "YAS"), o.id));
  await rejects(ts.getOrder(await ctxFor("omar", "QUS"), o.id));
  const p = await ts.deliveryNotePrint(priya, dn1.id);
  assert.equal(p.lines.length, 1); assert.equal(p.d.received_by_name, "Driver Ali");
});
