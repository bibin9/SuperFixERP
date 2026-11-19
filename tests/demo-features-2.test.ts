// Demo features, part 2: alerts bell, visa and document renewal, quick PIN sign-in on bay tablets.
import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { alertsFor } from "../lib/services/home";
import { startRenewal, markRenewed } from "../lib/services/hr";
import * as tablets from "../lib/services/tablets";
import { sessionCtx } from "../lib/services/auth";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("bell: each role sees only its own alerts; a started renewal leaves the bell", async () => {
  const emp = (await adminQuery("SELECT id, branch_id FROM employee WHERE status = 'active' ORDER BY emp_no LIMIT 1"))[0];
  const rec = (await adminQuery(
    `INSERT INTO employee_record (branch_id, employee_id, kind, data, expiry_date) VALUES ($1,$2,'visa','{"visa_no":"V-1"}', current_date + 10) RETURNING id`, [emp.branch_id, emp.id]))[0].id;
  const hr = await ctxFor("fatima.hr", "YAS");
  const a = await alertsFor(hr);
  assert.ok(a.some((x) => x.group === "Staff documents expiring" && /Visa/.test(x.text)));
  const tech = await alertsFor(await ctxFor("ramesh", "YAS"));
  assert.ok(!tech.some((x) => x.group === "Staff documents expiring" || x.group === "Stock running low"));
  assert.ok((await alertsFor(await ctxFor("anil", "YAS"))).some((x) => x.group === "Stock running low"));

  await rejects(startRenewal(await ctxFor("priya", "YAS"), rec, ""), "forbidden");
  await startRenewal(hr, rec, "PRO has the passport");
  await rejects(startRenewal(hr, rec, ""), "validation", /already/);
  assert.ok(!(await alertsFor(hr)).some((x) => x.group === "Staff documents expiring" && /Visa/.test(x.text)));
  await rejects(markRenewed(hr, rec, "2001-01-01"), "validation", /after the old one/);
  await rejects(markRenewed(hr, rec, ""), "validation");
  await markRenewed(hr, rec, "2029-06-30");
  const r = (await adminQuery("SELECT to_char(expiry_date,'YYYY-MM-DD') e, data FROM employee_record WHERE id = $1", [rec]))[0];
  assert.equal(r.e, "2029-06-30");
  assert.equal(r.data.renewal_started, undefined);
});

test("quick PIN: registered tablet only, technicians only, technician screens only, and removal ends it", async () => {
  const khalid = await ctxFor("khalid", "YAS");
  const ramesh = await ctxFor("ramesh", "YAS");
  await rejects(tablets.addTablet(await ctxFor("priya", "YAS"), "Bay 1"), "forbidden");
  await rejects(tablets.addTablet(khalid, ""), "validation");
  const { id: tabId, token } = await tablets.addTablet(khalid, "Bay 1 tablet");
  assert.equal((await adminQuery("SELECT count(*)::int n FROM bay_tablet WHERE token_hash = $1", [token]))[0].n, 0, "secret is not stored in clear");

  await rejects(tablets.setPin(ramesh, "1234", "1234"), "validation", /easy/);
  await rejects(tablets.setPin(ramesh, "12a4", "12a4"), "validation");
  await rejects(tablets.setPin(ramesh, "4826", "4827"), "validation", /same/);
  await tablets.setPin(ramesh, "4826", "4826");
  const rid = ramesh.userId;
  const t = (await tablets.tabletByToken(token))!;
  assert.deepEqual((await tablets.tabletPeople(t)).map((p) => p.id), [rid]);

  await rejects(tablets.pinLogin("y".repeat(43), rid, "4826", {}), "forbidden");
  const priya = await ctxFor("priya", "YAS");
  await rejects(tablets.pinLogin(token, priya.userId, "4826", {}), "validation");
  await rejects(tablets.pinLogin(token, rid, "0000", {}), "unauthenticated");
  const { token: sess } = await tablets.pinLogin(token, rid, "4826", {});
  const ctx = (await sessionCtx(sess))!;
  assert.equal(ctx.pinOnly, true);
  assert.deepEqual(ctx.branchIds, [t.branch_id]);
  assert.ok(ctx.grants.every((g) => g.roleCode === "technician"));
  await rejects(tablets.setPin(ctx, "5937", "5937"), "forbidden");

  await tablets.removeTablet(khalid, tabId);
  assert.equal(await sessionCtx(sess), null);
  assert.equal(await tablets.tabletByToken(token), null);
  await tablets.clearPin(khalid, rid);
  assert.equal((await adminQuery("SELECT pin_hash FROM app_user WHERE id = $1", [rid]))[0].pin_hash, null);
});

test("punching machines: only a machine's own key can send; repeats skipped; missing punch is fixed by hand", async () => {
  const pd = await import("../lib/services/punch-devices");
  const hr = await ctxFor("fatima.hr", "YAS");
  const yas = (await adminQuery("SELECT id FROM branch WHERE code = 'YAS'"))[0].id;
  await rejects(pd.addDevice(await ctxFor("priya", "YAS"), { branch_id: yas, code: "YAS-ZK9", name: "Back door" }), "forbidden");
  await rejects(pd.addDevice(hr, { branch_id: yas, code: "bad code!", name: "x" }), "validation");
  const dev = await pd.addDevice(hr, { branch_id: yas, code: "yas-zk9", name: "Back door", model: "ZKTeco" });
  assert.equal(await pd.syncPunches("pk_wrongwrongwrongwrongwrong", []), null);
  const key = await pd.newDeviceKey(hr, dev);
  const emp = (await adminQuery("SELECT id, emp_no FROM employee WHERE status = 'active' ORDER BY emp_no LIMIT 1"))[0];
  const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const r = await pd.syncPunches(key, [{ emp_no: emp.emp_no, at: `${day} 07:55` }, { emp_no: "NOPE", at: `${day} 08:00` }, { emp_no: emp.emp_no, at: "yesterday" }]);
  assert.deepEqual([r!.added, r!.skipped, r!.errors.length], [1, 0, 2]);
  assert.equal((await pd.syncPunches(key, [{ emp_no: emp.emp_no, at: `${day} 07:55` }]))!.skipped, 1);
  const list = await pd.listDevices(hr);
  assert.ok(list.find((d) => d.code === "YAS-ZK9")!.online);
  assert.ok((await pd.missingPunches(hr)).some((m) => m.employee_id === emp.id && m.date === day));
  assert.deepEqual(await pd.missingPunches(await ctxFor("ramesh", "YAS")), []);
  const { manualPunch } = await import("../lib/services/hr-time");
  await manualPunch(hr, { employee_id: emp.id, date: day, time: "17:05", note: "Forgot to punch out" });
  assert.ok(!(await pd.missingPunches(hr)).some((m) => m.employee_id === emp.id && m.date === day));
  await pd.setDeviceActive(hr, dev, false);
  assert.equal(await pd.syncPunches(key, []), null);
});

test("key drop: public form needs the box code and a signature; check-in starts the enquiry once", async () => {
  const kd = await import("../lib/services/keydrop");
  const yas = (await adminQuery("SELECT id, keydrop_code FROM branch WHERE code = 'YAS'"))[0];
  const sig = "data:image/png;base64,iVBORw0KGgo=";
  const f = { name: "Hamad Al Ketbi", mobile: "050 777 3021", registered_in: "AUH", plate_code: "5", plate_number: "22019", service_asked: "Brakes", agree: "1", signature: sig, odometer: "84,210" };
  await rejects(kd.submitKeyDrop("z".repeat(64), f, []), "not_found");
  await rejects(kd.submitKeyDrop(yas.keydrop_code, { ...f, signature: "" }, []), "validation", /sign/);
  await rejects(kd.submitKeyDrop(yas.keydrop_code, { ...f, agree: "" }, []), "validation");
  await rejects(kd.submitKeyDrop(yas.keydrop_code, { ...f, mobile: "12" }, []), "validation", /Mobile/);
  const r = await kd.submitKeyDrop(yas.keydrop_code, f, []);
  assert.match(r.docNo, /^KD-YAS-\d{4}$/);
  const priya = await ctxFor("priya", "YAS");
  const list = await kd.listKeyDrops(priya);
  const k = list.find((x) => x.doc_no === r.docNo)!;
  assert.equal(k.status, "waiting");
  await rejects(kd.listKeyDrops(await ctxFor("ramesh", "YAS")), "forbidden");
  const cust = (await adminQuery("SELECT id FROM customer WHERE first_name = 'Fatima' LIMIT 1"))[0].id;
  const veh = (await adminQuery("SELECT id FROM vehicle WHERE owner_customer_id = $1 LIMIT 1", [cust]))[0].id;
  await rejects(kd.completeKeyDrop(priya, k.id, { customer_id: "", vehicle_id: veh }), "validation");
  const e = await kd.completeKeyDrop(priya, k.id, { customer_id: cust, vehicle_id: veh });
  const enq = (await adminQuery("SELECT service_asked, odometer_in, notes FROM enquiry WHERE id = $1", [e.id]))[0];
  assert.equal(enq.service_asked, "Brakes"); assert.equal(Number(enq.odometer_in), 84210); assert.match(enq.notes, /KD-YAS/);
  await rejects(kd.completeKeyDrop(priya, k.id, { customer_id: cust, vehicle_id: veh }), "validation", /already/);
});
