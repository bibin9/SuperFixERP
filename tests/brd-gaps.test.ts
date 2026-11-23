import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { importMasters } from "../lib/services/migration";
import { addDriver, setDriverActive, getCustomer } from "../lib/services/customers";
import { clearClosedJobPhotos } from "../lib/services/billing";
import * as pu from "../lib/services/purchasing";
import { inbox, act } from "../lib/services/workflow";
import { withTx } from "../lib/db";

const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);
let YAS = "";
before(async () => { await resetTestDb(); YAS = await branchId("YAS"); });
after(async () => { await closePool(); });

test("OT-10: vehicles find their owner by mobile, employees by branch and department codes, opening stock per branch; repeats are skipped", async () => {
  const admin = await ctxFor("admin", "YAS");
  const cust = (await adminQuery("SELECT mobile FROM customer WHERE customer_type = 'corporate' AND active LIMIT 1"))[0];
  const local = "0" + String(cust.mobile).replace(/\D/g, "").slice(-9);
  const v = `Owner mobile,Registered in,Plate code,Plate number,VIN,Make,Model,Year,Mulkiya expiry\n${local},DXB,A,77123,,Nissan,Patrol,2022,31/03/2027\n0509999999,DXB,A,77124,,Nissan,Patrol,2022,\n${local},DXB,A,77123,,Nissan,Patrol,2022,`;
  const rv = await importMasters(admin, "vehicles", v);
  assert.equal(rv.created, 1); assert.equal(rv.skipped, 1); assert.equal(rv.errors.length, 1);
  assert.match(rv.errors[0], /Line 3: No customer with mobile/);
  assert.equal((await adminQuery("SELECT mulkiya_expiry::text d FROM vehicle WHERE plate_number = '77123'"))[0].d, "2027-03-31");

  const e = "Employee no,Branch,First name,Last name,Nationality,Date of birth,Gender,Mobile,Department,Designation,Joining date\nIMP-1,YAS,Imported,Tech,India,14/05/1990,M,0551112222,WORKSHOP,Technician,2020-02-01\nIMP-2,NOPE,X,Y,India,1990-01-01,male,0551112223,WORKSHOP,TECH,2020-02-01\nIMP-1,YAS,Imported,Tech,India,1990-05-14,male,0551112222,WORKSHOP,TECH,2020-02-01";
  const re = await importMasters(await ctxFor("fatima.hr", "YAS"), "employees", e);
  assert.deepEqual([re.created, re.skipped, re.errors.length], [1, 1, 1]);
  assert.equal((await adminQuery("SELECT date_of_birth::text d, gender FROM employee WHERE emp_no = 'IMP-1'"))[0].d, "1990-05-14");

  const item = "IMP-OPEN-1";
  assert.equal((await importMasters(admin, "items", `Part no,Description,Category,Unit,List price,Tax code,Item type\n${item},Imported part,parts,EA,45,SR,stock`)).created, 1);
  const before = (await adminQuery("SELECT coalesce(sum(on_hand),0) q FROM stock_balance sb JOIN item i ON i.id = sb.item_id WHERE i.part_no = $1 AND sb.branch_id = $2", [item, YAS]))[0].q;
  const rs = await importMasters(admin, "opening_stock", `Branch,Part no,Quantity,Unit cost\nYAS,${item},12,10.50\nYAS,${item},5,1\nYAS,NO-SUCH,1,1`);
  assert.deepEqual([rs.created, rs.skipped, rs.errors.length], [1, 1, 1]);
  const after = (await adminQuery("SELECT on_hand FROM stock_balance sb JOIN item i ON i.id = sb.item_id WHERE i.part_no = $1 AND sb.branch_id = $2", [item, YAS]))[0].on_hand;
  assert.equal(Number(after) - Number(before), 12);
  // An advisor cannot load opening stock.
  const adv = await importMasters(await ctxFor("priya", "YAS"), "opening_stock", `Branch,Part no,Quantity,Unit cost\nYAS,${item},1,1`).catch((x) => x);
  assert.ok(adv instanceof AppError || adv.errors.length === 1);
});

test("OT-10: an Excel file is read from its first sheet", async () => {
  const { toXlsx } = await import("../lib/xlsx");
  const { xlsxToCsv } = await import("../lib/xlsx-read");
  const buf = toXlsx("S", ["Branch", "Part no", "Quantity"], [["YAS", "A,B", 3], ["HQ", "X", null]]);
  const csv = xlsxToCsv(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as Uint8Array));
  assert.ok(csv.includes('Branch,Part no,Quantity'), csv);
  assert.ok(csv.includes('YAS,"A,B",3'), csv);
});

test("CV-03: approved drivers on a company account, not on an individual", async () => {
  const priya = await ctxFor("priya", "YAS");
  const corp = await id("customer", "customer_type = 'corporate' AND active ORDER BY created_at LIMIT 1", []);
  const ind = await id("customer", "customer_type = 'individual' AND active ORDER BY created_at LIMIT 1", []);
  const d = await addDriver(priya, corp, { name: "Rashid Ali", mobile: "0501112233", licence_no: "L-778" });
  await rejects(addDriver(priya, corp, { name: "rashid ali" }), "validation");
  await rejects(addDriver(priya, ind, { name: "Someone" }), "validation");
  assert.equal((await getCustomer(priya, corp)).drivers.filter((x) => x.active).length, 1);
  await setDriverActive(priya, d, false);
  assert.equal((await getCustomer(priya, corp)).drivers.filter((x) => x.active).length, 0);
  await rejects(addDriver(await ctxFor("ramesh", "YAS"), corp, { name: "Tech" }), "forbidden");
});

test("JC-10: check-in photos of closed jobs are cleared after the keep period", async () => {
  const job = (await adminQuery("SELECT id, branch_id FROM job_card WHERE branch_id = $1 ORDER BY created_at LIMIT 1", [YAS]))[0];
  await adminQuery("UPDATE job_card SET status = 'closed' WHERE id = $1", [job.id]);
  await adminQuery("INSERT INTO job_status_history (job_card_id, branch_id, from_status, to_status, at) VALUES ($1,$2,'invoiced','closed', now() - interval '10 days')", [job.id, job.branch_id]);
  await adminQuery("INSERT INTO attachment (branch_id, entity, entity_id, file_name, mime, size_bytes, content) VALUES ($1,'job_checkin',$2,'a.jpg','image/jpeg',3,'abc')", [job.branch_id, job.id]);
  await adminQuery("UPDATE setting SET value = '30' WHERE key = 'photos.keep_days_after_close' AND branch_id IS NULL");
  const ctx = await ctxFor("saeed", "YAS");
  assert.equal(await withTx(ctx, (c) => clearClosedJobPhotos(c, ctx, job.branch_id)), 0, "kept for 30 days");
  await adminQuery("UPDATE setting SET value = '7' WHERE key = 'photos.keep_days_after_close' AND branch_id IS NULL");
  assert.equal(await withTx(ctx, (c) => clearClosedJobPhotos(c, ctx, job.branch_id)), 1);
  assert.equal((await adminQuery("SELECT count(*)::int n FROM attachment WHERE entity = 'job_checkin' AND entity_id = $1", [job.id]))[0].n, 0);
});

test("PU-04: received parts go back to the supplier before billing; stock, order and ledger follow", async () => {
  const anil = await ctxFor("anil", "YAS");
  const supplier = await id("supplier", "code = $1", ["AGMC"]);
  const item = await id("item", "part_no = $1", ["FLT-OIL-90915"]);
  const po = await pu.createPo(anil, { supplier_id: supplier });
  await pu.addPoLine(anil, po.id, { item_id: item, qty: "10", unit_price: "20" });
  if ((await pu.submitPo(anil, po.id)) !== "approved") {
    const y = await ctxFor("yousef", "YAS"); for (const t of (await inbox(y)).filter((x) => x.doc_type === "purchase_order")) await act(y, t.task_id, "approved");
  }
  const pl = (await adminQuery("SELECT id FROM po_line WHERE po_id = $1", [po.id]))[0];
  const g = await pu.receiveGoods(anil, po.id, { qty: { [pl.id]: "10" } });
  const gl = (await adminQuery("SELECT id FROM grn_line WHERE grn_id = $1", [g.id]))[0];
  const q0 = Number((await adminQuery("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [item, YAS]))[0].on_hand);
  await rejects(pu.returnToSupplier(anil, g.id, { reason: "", qty: { [gl.id]: "2" } }), "validation");
  await rejects(pu.returnToSupplier(anil, g.id, { reason: "faulty", qty: { [gl.id]: "11" } }), "validation");
  await rejects(pu.returnToSupplier(await ctxFor("priya", "YAS"), g.id, { reason: "faulty", qty: { [gl.id]: "1" } }), "forbidden");
  const r = await pu.returnToSupplier(anil, g.id, { reason: "faulty", qty: { [gl.id]: "3" } });
  assert.equal(Number((await adminQuery("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [item, YAS]))[0].on_hand), q0 - 3);
  assert.equal((await adminQuery("SELECT status FROM purchase_order WHERE id = $1", [po.id]))[0].status, "partly_received");
  const j = await adminQuery("SELECT sum(l.debit) d, sum(l.credit) c FROM journal j JOIN journal_line l ON l.journal_id = j.id WHERE j.source_id = $1", [r.id]);
  assert.equal(Number(j[0].d), Number(j[0].c));
  const open = (await pu.unbilledLines(await ctxFor("maryam", "YAS"), supplier)).find((x) => x.id === gl.id);
  assert.equal(Number(open?.open_qty), 7, "only 7 left to bill");
  const maryam = await ctxFor("maryam", "YAS");
  await rejects(pu.createBill(maryam, { supplier_id: supplier, supplier_invoice_no: "R-1", invoice_date: "2026-11-20", lines: [{ grn_line_id: gl.id, qty: "10", unit_price: "20" }] }).then((b) => { if (b.match === "matched") throw new Error("billed returned parts"); throw new AppError("validation", "mismatch"); }), "validation");
});

test("WF-03: a step can apply only to one supplier, customer or item category", async () => {
  const { saveStepLimits } = await import("../lib/services/admin");
  const admin = await ctxFor("admin", "YAS");
  const anil = await ctxFor("anil", "YAS");
  const step = (await adminQuery("SELECT s.id FROM workflow_step s JOIN workflow w ON w.id = s.workflow_id WHERE w.doc_type = 'purchase_order' AND s.seq = 1"))[0].id;
  const agmc = await id("supplier", "code = $1", ["AGMC"]);
  const other = (await adminQuery("SELECT id FROM supplier WHERE code <> 'AGMC' AND active LIMIT 1"))[0].id;
  const item = await id("item", "part_no = $1", ["FLT-OIL-90915"]);
  const small = async (sup: string) => { const po = await pu.createPo(anil, { supplier_id: sup }); await pu.addPoLine(anil, po.id, { item_id: item, qty: "1", unit_price: "10" }); return pu.submitPo(anil, po.id); };
  // Every order from AGMC needs the branch manager, whatever the amount; others under AED 5,001 do not.
  await saveStepLimits(admin, step, { cond_supplier_id: agmc, enabled: "on" });
  assert.equal(await small(agmc), "pending");
  assert.equal(await small(other), "approved");
  // Category: only orders with a filter (category of FLT-OIL-90915) on them.
  const cat = (await adminQuery("SELECT category FROM item WHERE id = $1", [item]))[0].category;
  await saveStepLimits(admin, step, { cond_item_category: cat === "tyres" ? "batteries" : "tyres", enabled: "on" });
  assert.equal(await small(agmc), "approved");
  await saveStepLimits(admin, step, { cond_item_category: cat, enabled: "on" });
  assert.equal(await small(other), "pending");
  await rejects(saveStepLimits(admin, step, { cond_item_category: "nope", enabled: "on" }), "validation");
  await rejects(saveStepLimits(admin, step, { cond_min_amount: "10", cond_max_amount: "5", enabled: "on" }), "validation");
  await saveStepLimits(admin, step, { cond_min_amount: "5001", enabled: "on" });
});

test("OT-03: complaints register: open from a job or a low rating, act, hand over, close, reopen", async () => {
  const cx = await import("../lib/services/complaints");
  const priya = await ctxFor("priya", "YAS");
  const job = (await adminQuery("SELECT id, customer_id FROM job_card WHERE branch_id = $1 ORDER BY created_at LIMIT 1", [YAS]))[0];
  await rejects(cx.openComplaint(priya, { job_card_id: job.id, description: "" }), "validation");
  await rejects(cx.openComplaint(await ctxFor("ramesh", "YAS"), { job_card_id: job.id, description: "Noise" }), "forbidden");
  const k = await cx.openComplaint(priya, { job_card_id: job.id, description: "Noise from the front after the service", source: "phone" });
  assert.match(k.docNo, /^YAS-CMP-/);
  await rejects(cx.workComplaint(priya, k.id, { step: "close" }), "validation");
  await cx.workComplaint(priya, k.id, { step: "action", note: "Called, booked a re-check" });
  const khalid = (await adminQuery("SELECT id FROM app_user WHERE username = 'khalid'"))[0].id;
  await cx.workComplaint(priya, k.id, { step: "owner", owner_id: khalid });
  await cx.workComplaint(priya, k.id, { step: "close", note: "Loose heat shield fixed free of charge" });
  const got = await cx.getComplaint(priya, k.id);
  assert.equal(got.k.status, "closed"); assert.equal(got.k.owner_id, khalid); assert.equal(got.actions.length, 4);
  await rejects(cx.workComplaint(priya, k.id, { step: "action", note: "x" }), "validation");
  await cx.workComplaint(priya, k.id, { step: "reopen", note: "Noise is back" });
  assert.equal((await cx.getComplaint(priya, k.id)).k.status, "in_progress");
  // Another branch cannot see it.
  await assert.rejects(cx.getComplaint(await ctxFor("sara", "QUS"), k.id), (e: unknown) => e instanceof AppError);
  assert.ok(!(await cx.listComplaints(await ctxFor("sara", "QUS"), "all")).rows.some((r) => r.id === k.id));
  // From a low rating: one case per rating.
  const fb = (await adminQuery("INSERT INTO job_feedback (branch_id, job_card_id, token, rating, comment, answered_at) VALUES ($1,$2,$3,2,'Car not washed', now()) RETURNING id", [YAS, job.id, "t".repeat(40)]))[0].id;
  const k2 = await cx.openComplaint(priya, { feedback_id: fb });
  assert.equal((await cx.getComplaint(priya, k2.id)).k.source, "feedback");
  await rejects(cx.openComplaint(priya, { feedback_id: fb }), "validation");
  assert.ok((await adminQuery("SELECT followed_up_at FROM job_feedback WHERE id = $1", [fb]))[0].followed_up_at);
});

test("OT-10: an employee import row needs only branch, names, nationality and joining date; HR completes the rest later", async () => {
  const admin = await ctxFor("admin", "YAS");
  const r = await importMasters(admin, "employees", "Employee no,Branch,First name,Last name,Nationality,Joining date\nIMP-9,YAS,Light,Row,India,01/03/2021");
  assert.equal(r.created, 1, r.errors.join("; "));
  const e = (await adminQuery("SELECT date_of_birth, mobile, department_id FROM employee WHERE emp_no = 'IMP-9'"))[0];
  assert.deepEqual([e.date_of_birth, e.mobile, e.department_id], [null, null, null]);
});
