import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { addEnquiryLine } from "../lib/services/jobs";
import { setAssignments } from "../lib/services/workshop";
import { createEnquiry, createJobCard } from "../lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff } from "../lib/services/quotations";
import * as bk from "../lib/services/bookings";
import * as rn from "../lib/services/runs";
import { nextServiceDue, vehicleView } from "../lib/services/vehicle-view";
import { withTx } from "../lib/db";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const dubai = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + days * 86400000));
const D2 = dubai(2);
let YAS: string, cust: string, veh: string, svc: Record<string, string>, ramesh: string, arjun: string, bays: Record<string, string>;

before(async () => {
  await resetTestDb(true);
  YAS = await branchId("YAS");
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  veh = await id("vehicle", "plate_number = $1", ["77120"]);
  svc = Object.fromEntries((await adminQuery("SELECT code, id FROM service")).map((r) => [r.code, r.id]));
  ramesh = await id("app_user", "username = $1", ["ramesh"]); arjun = await id("app_user", "username = $1", ["arjun"]);
  bays = Object.fromEntries((await adminQuery("SELECT code, id FROM bay WHERE branch_id = $1", [YAS])).map((r) => [r.code, r.id]));
});
after(async () => { await closePool(); });

const newEnq = async () => (await createEnquiry(await ctxFor("priya", "YAS"), { customer_id: cust, vehicle_id: veh, service_asked: "booking test", source: "phone" })).id;

test("booking: hours default to the enquiry's labour, status becomes booked, load counts it", async () => {
  const priya = await ctxFor("priya", "YAS");
  const e = await newEnq();
  await addEnquiryLine(priya, e, { line_type: "labour", service_id: svc["BRK-FR"] });
  const lab = Number((await adminQuery("SELECT sum(qty) h FROM job_line WHERE enquiry_id = $1", [e]))[0].h);
  const r = await bk.bookEnquiry(priya, e, { booked_for: `${D2}T10:00`, bay_id: bays.B2, technician_id: arjun });
  assert.equal(r.hours, lab);
  const row = (await adminQuery("SELECT status, booking_status, to_char(booked_for AT TIME ZONE 'Asia/Dubai','HH24:MI') t FROM enquiry WHERE id = $1", [e]))[0];
  assert.deepEqual([row.status, row.booking_status, row.t], ["booked", "booked", "10:00"]);
  const load = await bk.loadFor(priya, D2, null);
  assert.equal(load.bays.find((b) => b.id === bays.B2)!.booked, lab);
  assert.equal(load.techs.find((t) => t.id === arjun)!.booked, lab);
});

test("booking: over capacity needs a reason under the warn policy, and is refused under block", async () => {
  const priya = await ctxFor("priya", "YAS");
  const a = await newEnq(), b = await newEnq();
  await bk.bookEnquiry(priya, a, { booked_for: `${D2}T08:00`, bay_id: bays.B3, technician_id: ramesh, hours: "7" });
  await rejects(bk.bookEnquiry(priya, b, { booked_for: `${D2}T13:00`, technician_id: ramesh, hours: "2" }), "validation", /Ramesh K\. has 7 of 8 hours/);
  await adminQuery("UPDATE setting SET value = '\"block\"' WHERE key = 'workshop.overbook_policy'");
  await rejects(bk.bookEnquiry(priya, b, { booked_for: `${D2}T13:00`, technician_id: ramesh, hours: "2", override_reason: "VIP" }), "validation", /not allowed/);
  await adminQuery("UPDATE setting SET value = '\"warn\"' WHERE key = 'workshop.overbook_policy'");
  await bk.bookEnquiry(priya, b, { booked_for: `${D2}T13:00`, technician_id: ramesh, hours: "2", override_reason: "VIP" });
  assert.equal((await adminQuery("SELECT booking_override_reason r FROM enquiry WHERE id = $1", [b]))[0].r, "VIP");
  // Moving the same booking does not count itself twice.
  await bk.bookEnquiry(priya, a, { booked_for: `${D2}T08:30`, bay_id: bays.B3, technician_id: arjun, hours: "7" });
});

test("booking: past time, unknown bay, another branch's user and closed enquiry are refused", async () => {
  const priya = await ctxFor("priya", "YAS");
  const e = await newEnq();
  await rejects(bk.bookEnquiry(priya, e, { booked_for: `${dubai(-1)}T10:00` }), "validation", /already passed/);
  const qusBay = await id("bay", "branch_id = $1 AND code = 'B1'", [await branchId("QUS")]);
  await rejects(bk.bookEnquiry(priya, e, { booked_for: `${D2}T10:00`, bay_id: qusBay }), "validation", /bay of this branch/);
  await rejects(bk.bookEnquiry(priya, e, { booked_for: `${dubai(400)}T10:00` }), "validation", /days ahead/);
  const omar = await ctxFor("omar", "QUS");
  await rejects(bk.bookEnquiry(omar, e, { booked_for: `${D2}T10:00` }), "not_found");
  await rejects(bk.bookEnquiry(await ctxFor("ramesh", "YAS"), e, { booked_for: `${D2}T10:00` }), "forbidden");
});

test("booking: job card from a booked enquiry checks the booking in and takes its bay; planned job work counts on the day", async () => {
  const priya = await ctxFor("priya", "YAS");
  const e = await newEnq();
  await addEnquiryLine(priya, e, { line_type: "labour", service_id: svc["BRK-FR"] });
  const D3 = dubai(3);
  await bk.bookEnquiry(priya, e, { booked_for: `${D3}T09:00`, bay_id: bays.B4, technician_id: arjun, hours: "1" });
  const qt = await saveQuotation(priya, e, {}); await sendQuotation(priya, qt.id);
  const ql = await adminQuery("SELECT id FROM quotation_line WHERE quotation_id = $1", [qt.id]);
  await recordDecisionsByStaff(priya, qt.id, Object.fromEntries(ql.map((l) => [l.id, "approved"])), "in_person", null);
  const j = await createJobCard(priya, e, { odometer_in: "300000" });
  const row = (await adminQuery("SELECT e.booking_status, j.bay_id FROM enquiry e JOIN job_card j ON j.id = e.converted_job_id WHERE e.id = $1", [e]))[0];
  assert.deepEqual([row.booking_status, row.bay_id], ["checked_in", bays.B4]);
  const line = (await adminQuery("SELECT id, qty FROM job_line WHERE job_card_id = $1 AND line_type = 'labour'", [j.id]))[0];
  const before = await withTx(priya, (c) => bk.dayLoad(c, YAS, dubai(0)));
  await setAssignments(await ctxFor("khalid", "YAS"), line.id, [arjun]);
  // Assigned and not finished: counts today until a start day is planned.
  const now = await withTx(priya, (c) => bk.dayLoad(c, YAS, dubai(0)));
  assert.equal(now.techs.find((t) => t.id === arjun)!.planned - before.techs.find((t) => t.id === arjun)!.planned, Number(line.qty));
  await adminQuery("UPDATE job_assignment SET planned_start = $2::timestamp AT TIME ZONE 'Asia/Dubai' WHERE job_line_id = $1", [line.id, `${D3}T09:00`]);
  const load = await withTx(priya, (c) => bk.dayLoad(c, YAS, D3));
  assert.equal(load.techs.find((t) => t.id === arjun)!.planned, Number(line.qty));
});

test("booking: cancel needs a reason, did-not-come keeps the enquiry open", async () => {
  const priya = await ctxFor("priya", "YAS");
  const e = await newEnq();
  await bk.bookEnquiry(priya, e, { booked_for: `${D2}T15:00`, hours: "1" });
  await rejects(bk.closeBooking(priya, e, "cancelled", ""), "validation", /Reason/);
  await bk.closeBooking(priya, e, "no_show", null);
  const row = (await adminQuery("SELECT status, booking_status FROM enquiry WHERE id = $1", [e]))[0];
  assert.deepEqual([row.status, row.booking_status], ["open", "no_show"]);
  await rejects(bk.closeBooking(priya, e, "no_show", null), "validation", /no open booking/);
});

test("runs: driver required, numbered per branch, steps, cancel needs a reason, branch isolation, charge on the quotation", async () => {
  const priya = await ctxFor("priya", "YAS");
  const e = await newEnq();
  const base = { enquiry_id: e, run_type: "pickup", from_location: "Al Raha", to_location: "Superfix Yas", scheduled_at: `${D2}T08:00` };
  await rejects(rn.addRun(priya, base), "validation", /Driver/);
  await rejects(rn.addRun(priya, { ...base, driver_name: "X", run_type: "taxi" }), "validation", /Run type/);
  const r = await rn.addRun(priya, { ...base, driver_name: "Rashid", charge: "80", add_charge: "1" });
  assert.match(r.docNo, /^YAS-RUN-\d{2}-\d{5}$/); assert.equal(r.chargeAdded, true);
  assert.equal((await adminQuery("SELECT count(*)::int n FROM job_line WHERE enquiry_id = $1 AND line_type = 'outside' AND unit_price = 80", [e]))[0].n, 1);
  await rn.runStep(priya, r.id, "start");
  await rejects(rn.runStep(priya, r.id, "start"), "validation");
  await rn.runStep(priya, r.id, "complete", { distance_km: "12.4" });
  const row = (await adminQuery("SELECT status, distance_km, started_at IS NOT NULL s FROM vehicle_run WHERE id = $1", [r.id]))[0];
  assert.deepEqual([row.status, Number(row.distance_km), row.s], ["completed", 12.4, true]);
  const r2 = await rn.addRun(priya, { ...base, run_type: "drop_off", driver_user_id: await id("app_user", "username = $1", ["yousef"]) });
  await rejects(rn.runStep(priya, r2.id, "cancel", {}), "validation", /Reason/);
  await rejects(rn.runStep(await ctxFor("omar", "QUS"), r2.id, "cancel", { reason: "x" }), "not_found");
  // A QUS user cannot be a YAS driver.
  await rejects(rn.addRun(priya, { ...base, driver_user_id: await id("app_user", "username = $1", ["sara"]) }), "validation", /works at this branch/);
  const list = await rn.listRuns(priya, { driver: "Rashid", status: "" });
  assert.equal(list.rows.length, 1);
  const tech = await ctxFor("ramesh", "YAS");
  await rejects(rn.addRun(tech, { ...base, driver_name: "Y" }), "forbidden");
});

test("vehicle view: next service due by date or km, whichever first; open job lines carry technician and estimate", async () => {
  const due = nextServiceDue({ date: "2026-05-10", km: 40000 }, 10000, 6, 49500, "2026-11-01");
  assert.deepEqual([due!.dueDate, due!.dueKm, due!.overdue, due!.soon], ["2026-11-10", 50000, false, true]);
  assert.equal(nextServiceDue({ date: "2026-05-10", km: 40000 }, 10000, 6, 50100, "2026-06-01")!.overdue, true);
  assert.equal(nextServiceDue(null, 10000, 6, 1, "2026-06-01"), null);
  const v = await vehicleView(await ctxFor("priya", "YAS"), veh);
  const job = v.openJobs[0]; assert.ok(job, "an open job");
  assert.ok(job.lines.some((l: { est_hours: number | null }) => l.est_hours !== null));
  const tv = await vehicleView(await ctxFor("ramesh", "YAS"), veh).catch((e) => e);
  assert.ok(tv instanceof AppError || tv.prices === false);
});
