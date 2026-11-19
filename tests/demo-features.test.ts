// Features from the client demo: service bundles, "Send new time", check-in record, buying a part for a job, list search.
import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { addEnquiryLine, setNewTime, saveCheckin, listJobs, changeStatus } from "../lib/services/jobs";
import { createEnquiry, createJobCard, listEnquiries } from "../lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff } from "../lib/services/quotations";
import { listBundles, addBundle, saveBundle, rankForVehicle } from "../lib/services/bundles";
import { prepareMessage } from "../lib/services/messaging";
import * as pu from "../lib/services/purchasing";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
let svc: Record<string, string>, cust: string, veh: string, YAS: string;
let odo = 300000;

before(async () => {
  await resetTestDb(true);
  svc = Object.fromEntries((await adminQuery("SELECT code, id FROM service")).map((r) => [r.code, r.id]));
  YAS = await branchId("YAS");
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  veh = await id("vehicle", "plate_number = $1", ["77120"]);
});
after(async () => { await closePool(); });

async function approvedJob() {
  const priya = await ctxFor("priya", "YAS");
  const e = await createEnquiry(priya, { follow_up_at: "2026-12-01T10:00", customer_id: cust, vehicle_id: veh, service_asked: "demo test", source: "walk_in" });
  await addEnquiryLine(priya, e.id, { line_type: "labour", service_id: svc["DIAG"] });
  const qt = await saveQuotation(priya, e.id, {});
  await sendQuotation(priya, qt.id);
  const ql = await adminQuery("SELECT id FROM quotation_line WHERE quotation_id = $1", [qt.id]);
  await recordDecisionsByStaff(priya, qt.id, Object.fromEntries(ql.map((l) => [l.id, "approved"])), "in_person", null);
  odo += 10;
  return (await createJobCard(priya, e.id, { odometer_in: String(odo) })).id as string;
}

test("service bundle: one tap adds every labour and part line; labour hours follow the times done; the car's bundles come first", async () => {
  const priya = await ctxFor("priya", "YAS");
  const bundles = await listBundles(priya);
  const tyres = bundles.find((b) => b.code === "B-TYR4")!;
  assert.equal(tyres.lines.length, 3);
  // 4 tyres fitted at 0.25 h + alignment 0.75 h, 4 tyres at 400: 4*0.25*40 + 0.75*160 + 4*400
  assert.equal(Number(tyres.price), 40 + 120 + 1600);
  const ranked = rankForVehicle(bundles, { make: "Toyota", model: "Land Cruiser" });
  assert.ok(ranked[0].match && /Land Cruiser/.test(ranked[0].for_vehicles));
  const e = await createEnquiry(priya, { follow_up_at: "2026-12-01T10:00", customer_id: cust, vehicle_id: veh, service_asked: "tyres", source: "walk_in" });
  const r = await addBundle(priya, { kind: "enquiry", id: e.id }, tyres.id);
  assert.equal(r.count, 3);
  const lines = await adminQuery("SELECT line_type, qty, unit_price FROM job_line WHERE enquiry_id = $1 ORDER BY line_no", [e.id]);
  assert.deepEqual(lines.map((l) => [l.line_type, Number(l.qty)]), [["labour", 1], ["labour", 0.75], ["part", 4]]);
  await rejects(saveBundle(priya, { code: "X", name_en: "X" }, [{ kind: "part", ref: lines[0].id, qty: "1" }]), "forbidden");
  const admin = await ctxFor("admin", "HQ");
  await rejects(saveBundle(admin, { code: "B-EMPTY", name_en: "Empty" }, []), "validation");
  await rejects(saveBundle(admin, { code: "B-TYR4", name_en: "Dup" }, [{ kind: "labour", ref: svc["ALIGN"], qty: "1" }]), "validation", /exists/);
  const nid = await saveBundle(admin, { code: "b-align", name_en: "Alignment only" }, [{ kind: "labour", ref: svc["ALIGN"], qty: "1" }]);
  assert.equal((await adminQuery("SELECT code FROM service_bundle WHERE id = $1", [nid]))[0].code, "B-ALIGN");
});

test("send new time: needs a later time and a reason; the job is updated and the WhatsApp text carries the new time", async () => {
  const priya = await ctxFor("priya", "YAS");
  const jobId = await approvedJob();
  await rejects(setNewTime(priya, jobId, { promised_at: "2020-01-01T10:00", delay_reason: "Parts delayed" }), "validation", /later than now/);
  await rejects(setNewTime(priya, jobId, { promised_at: "2030-01-01T10:00" }), "validation", /Delay reason/);
  const r = await setNewTime(priya, jobId, { promised_at: "2030-01-02T16:30", delay_reason: "Parts delayed" });
  assert.equal(r.label, "Wed 02 Jan, 16:30");
  const j = (await adminQuery("SELECT delay_reason, to_char(promised_at AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD HH24:MI') p FROM job_card WHERE id = $1", [jobId]))[0];
  assert.deepEqual([j.delay_reason, j.p], ["Parts delayed", "2030-01-02 16:30"]);
  const msg = await prepareMessage(priya, { jobId }, "new_time", { promised: r.label, reason: "parts delayed" });
  assert.match(msg.text, /ready by Wed 02 Jan, 16:30/);
  assert.match(msg.url, /^https:\/\/wa\.me\//);
  await rejects(setNewTime(await ctxFor("ramesh", "YAS"), jobId, { promised_at: "2030-01-03T10:00", delay_reason: "x" }), "forbidden");
});

test("check-in record: only known parts and kinds; a real PNG signature; signed once", async () => {
  const priya = await ctxFor("priya", "YAS");
  const jobId = await approvedJob();
  await rejects(saveCheckin(priya, jobId, { damage: JSON.stringify([{ z: "wheel", k: "scratch" }]) }), "validation");
  await rejects(saveCheckin(priya, jobId, { damage: "not json" }), "validation");
  await rejects(saveCheckin(priya, jobId, { damage: "[]", signature: "data:image/png;base64,PHN2Zz48L3N2Zz4=" }), "validation", /signature/);
  const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64");
  await saveCheckin(priya, jobId, { damage: JSON.stringify([{ z: "front", k: "dent" }, { z: "lr", k: "scratch" }]), signature: png, signed_name: "Fatima" });
  const j = (await adminQuery("SELECT damage_marks, checkin_signed_name, checkin_signed_at FROM job_card WHERE id = $1", [jobId]))[0];
  assert.equal(j.damage_marks.length, 2); assert.equal(j.checkin_signed_name, "Fatima"); assert.ok(j.checkin_signed_at);
  await rejects(saveCheckin(priya, jobId, { damage: "[]", signature: png }), "validation", /signed/);
  await saveCheckin(priya, jobId, { damage: JSON.stringify([{ z: "front", k: "broken" }]) }); // marks can still change
  assert.equal((await adminQuery("SELECT damage_marks FROM job_card WHERE id = $1", [jobId]))[0].damage_marks[0].k, "broken");
});

test("buy a part for a job: petty cash pays, cost sits in work in progress on the job line, the job can no longer be cancelled", async () => {
  const anil = await ctxFor("anil", "YAS");
  await pu.pettyCashTopUp(await ctxFor("yousef", "YAS"), "1000", "Float");
  const jobId = await approvedJob();
  const photo = { name: "r.jpg", type: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) };
  const base = { job_id: jobId, job_line_id: "new", description: "AC expansion valve", supplier_name: "Local AC shop", net_amount: "350", vat_amount: "17.50" };
  await rejects(pu.directPurchase(anil, base, photo), "validation", /TRN/);
  await rejects(pu.directPurchase(anil, { ...base, supplier_trn: "100000000000003" }, null), "validation", /photo/);
  await rejects(pu.directPurchase(await ctxFor("priya", "YAS"), { ...base, supplier_trn: "100000000000003" }, photo), "forbidden");
  await rejects(pu.directPurchase(anil, { ...base, supplier_trn: "100000000000003" }, photo), "validation", /advisor or the manager/);
  const r = await pu.directPurchase(await ctxFor("yousef", "YAS"), { ...base, supplier_trn: "100000000000003", unit_price: "450" }, photo);
  const line = (await adminQuery("SELECT l.id, l.line_type, l.unit_price, l.direct_cost, l.extra_work, l.approval_status FROM job_line l WHERE l.job_card_id = $1 AND l.description = 'AC expansion valve'", [jobId]))[0];
  assert.deepEqual([line.line_type, Number(line.unit_price), Number(line.direct_cost), line.extra_work, line.approval_status], ["outside", 450, 350, true, "pending"]);
  const e = (await adminQuery("SELECT id, job_line_id FROM petty_cash_entry WHERE doc_no = $1", [r.docNo]))[0];
  assert.equal(e.job_line_id, line.id);
  const jr = await adminQuery(
    `SELECT m.event_key, sum(l.debit) d, sum(l.credit) c FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account_mapping m ON m.account_id = l.account_id
      WHERE j.source_id = $1 GROUP BY m.event_key ORDER BY m.event_key`, [e.id]);
  const by = Object.fromEntries(jr.map((x) => [x.event_key, [Number(x.d), Number(x.c)]]));
  assert.deepEqual(by.work_in_progress, [350, 0]); assert.deepEqual(by.vat_input, [17.5, 0]); assert.deepEqual(by.petty_cash, [0, 367.5]);
  await rejects(changeStatus(await ctxFor("yousef", "YAS"), jobId, "cancelled", { reason: "test" }), "validation", /cannot be cancelled/);
  // cost on an existing line
  const diag = (await adminQuery("SELECT id FROM job_line WHERE job_card_id = $1 AND line_type = 'labour'", [jobId]))[0].id;
  await pu.directPurchase(anil, { ...base, job_line_id: diag, vat_amount: "0", net_amount: "20", description: "Fuse" }, photo);
  assert.equal(Number((await adminQuery("SELECT direct_cost FROM job_line WHERE id = $1", [diag]))[0].direct_cost), 20);
  assert.equal((await pu.pettyCash(anil)).balance, "612.50");
});

test("list search: job cards and enquiries by plate, name or number; late filter", async () => {
  const priya = await ctxFor("priya", "YAS");
  const byPlate = await listJobs(priya, "", "77120");
  assert.ok(byPlate.length > 0 && byPlate.every((j) => j.plate_number === "77120"));
  assert.ok((await listJobs(priya, "", "zzz-no-such")).length === 0);
  const late = await listJobs(priya, "late");
  assert.ok(late.every((j) => j.late));
  const enq = await listEnquiries(priya, "", "Fatima");
  assert.ok(enq.length > 0 && enq.every((e) => /Fatima/.test(`${e.first_name} ${e.contact_name}`)));
  assert.ok(YAS);
});

test("low stock: parts at or below the reorder level, a draft PO for the suggested quantity, levels set per branch", async () => {
  const anil = await ctxFor("anil", "YAS");
  const so = await import("../lib/services/stock-ops");
  const low = await so.reorderList(anil);
  const pads = low.find((r) => r.part_no === "BRK-PAD-FR-LC")!;
  assert.ok(pads && pads.low);
  assert.equal(pads.suggest, "6");
  assert.ok(!low.some((r) => r.part_no === "OIL-5W30-L"), "oil is above its level");
  await rejects(pu.raiseReorderPo(await ctxFor("priya", "YAS"), pads.item_id, "6"), "forbidden");
  const po = await pu.raiseReorderPo(await ctxFor("yousef", "YAS"), pads.item_id, pads.suggest);
  const pl = (await adminQuery("SELECT p.status, l.qty FROM purchase_order p JOIN po_line l ON l.po_id = p.id WHERE p.id = $1", [po.id]))[0];
  assert.deepEqual([pl.status, Number(pl.qty)], ["draft", 6]);
  assert.equal((await so.reorderList(anil)).find((r) => r.part_no === "BRK-PAD-FR-LC")!.onOrder, "6");
  await rejects(so.setReorder(await ctxFor("priya", "YAS"), pads.item_id, "1", "1"), "forbidden");
  await assert.rejects(so.setReorder(anil, pads.item_id, "-1", "1"), /at least 0/);
  await so.setReorder(anil, pads.item_id, "1", "4");
  assert.ok(!(await so.reorderList(anil)).some((r) => r.part_no === "BRK-PAD-FR-LC"), "2 free is above the new level of 1");
});

test("complaints suggest services; customer rating link: once per job, 1 to 5 only, low ratings need a follow-up note", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { complaintList, suggestedServices, addServices } = await import("../lib/services/bundles");
  const list = await complaintList(priya);
  const s = suggestedServices("A/C not cooling. Squeaking or grinding noise when braking. Noise worse in the morning", list);
  assert.deepEqual(s.map((x) => x.name).sort(), ["AC gas recharge", "Front brake pads replace"]);
  const e = await createEnquiry(priya, { follow_up_at: "2026-12-01T10:00", customer_id: cust, vehicle_id: veh, service_asked: "ac", source: "walk_in" });
  assert.equal(await addServices(priya, { kind: "enquiry", id: e.id }, s.map((x) => x.id)), 2);
  await rejects(addServices(priya, { kind: "enquiry", id: e.id }, []), "validation");

  const fb = await import("../lib/services/feedback");
  const jobId = await approvedJob();
  await rejects(fb.askFeedback(priya, jobId, "https://x"), "validation", /handed over/);
  await adminQuery("UPDATE job_card SET status = 'delivered', delivered_at = now() WHERE id = $1", [jobId]);
  const msg = await fb.askFeedback(priya, jobId, "https://uat.example");
  const token = /\/f\/([A-Za-z0-9_-]+)/.exec(msg.text)![1];
  assert.ok(token.length >= 32);
  assert.equal(await fb.getPublicFeedback("x".repeat(40)), null);
  assert.ok(await fb.getPublicFeedback(token));
  await rejects(fb.submitFeedback(token, "7", ""), "validation");
  await fb.submitFeedback(token, "2", "Car was not washed");
  await rejects(fb.submitFeedback(token, "5", ""), "validation", /already/);
  await rejects(fb.askFeedback(priya, jobId, "https://x"), "validation", /already rated/);
  const { rows, stats } = await fb.listFeedback(priya, "low");
  const row = rows.find((r) => r.job_card_id === jobId)!;
  assert.ok(row && stats.low_open >= 1);
  await rejects(fb.followUpFeedback(priya, row.id, ""), "validation");
  await fb.followUpFeedback(priya, row.id, "Called, free wash offered");
  assert.ok(!(await fb.listFeedback(priya, "low")).rows.some((r) => r.job_card_id === jobId));
  await rejects(fb.listFeedback(await ctxFor("ramesh", "YAS")), "forbidden");
});
