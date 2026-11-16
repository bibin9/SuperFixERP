import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, appQueryAs, branchId, id } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { login, sessionCtx, disableUser, switchBranch } from "../lib/services/auth";
import { getJob, listJobs, createJobCard, addJobLine } from "../lib/services/jobs";
import { getVehicle, createCustomer, createVehicle } from "../lib/services/customers";
import { stockList } from "../lib/services/stock";
import { saveRoleMatrix } from "../lib/services/admin";
import { AppError } from "../lib/errors";

const PW = "Superfix@2026";
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("sign-in works with the right password and locks after 5 failures", async () => {
  const ok = await login("priya", PW, { ip: "127.0.0.1" });
  const ctx = await sessionCtx(ok.token);
  assert.equal(ctx?.username, "priya");
  for (let i = 0; i < 5; i++) await rejects(login("khalid", "wrong-password"), "unauthenticated");
  await rejects(login("khalid", PW), "unauthenticated"); // locked even with the right password
  const ev = await adminQuery("SELECT event FROM login_event WHERE username = 'khalid' ORDER BY id");
  assert.equal(ev.filter((e) => e.event === "login_failed").length, 6);
  assert.ok(ev.some((e) => e.event === "locked"));
});

test("branch switcher only allows the user's own branches (BR-07)", async () => {
  const { token } = await login("priya", PW);
  const ctx = (await sessionCtx(token))!;
  await switchBranch(ctx, await branchId("YSS"));
  assert.equal((await sessionCtx(token))!.currentBranchId, await branchId("YSS"));
  await rejects(switchBranch(ctx, await branchId("QUS")), "forbidden");
});

test("disable user ends sessions and removes every branch at once; the last admin cannot be disabled (BR-08)", async () => {
  const { token } = await login("arjun", PW);
  const admin = await ctxFor("admin", "HQ");
  await disableUser(admin, await id("app_user", "username = $1", ["arjun"]));
  assert.equal(await sessionCtx(token), null);
  assert.equal((await adminQuery("SELECT count(*) n FROM user_branch_role ubr JOIN app_user u ON u.id = ubr.user_id WHERE u.username = 'arjun'"))[0].n, "0");
  await rejects(login("arjun", PW), "unauthenticated");
  const owner = await ctxFor("saeed", "HQ");
  await rejects(disableUser(owner, await id("app_user", "username = $1", ["admin"])), "forbidden"); // owner has admin view only
  const admin2 = await ctxFor("admin", "HQ");
  await rejects(disableUser(admin2, admin2.userId), "validation");
});

test("branch separation: Al Qusais advisor cannot read a Yas job card, through the service or the database", async () => {
  const sara = await ctxFor("sara", "QUS");
  const yasJob = await id("job_card", "doc_no = $1", ["YAS-1483"]);
  await rejects(getJob(sara, yasJob), "not_found");
  const jobs = await listJobs(sara);
  assert.ok(jobs.length > 0, "allowed case: sara sees her own branch's jobs");
  assert.ok(jobs.every((j) => j.branch_code === "QUS"));
  // database layer: the app role with QUS scope sees no YAS rows in any transaction table
  const qus = await branchId("QUS");
  for (const t of ["job_card", "job_line", "quotation", "quotation_line", "stock_move", "journal_line"]) {
    const rows = await appQueryAs([qus], `SELECT count(*) n FROM ${t} WHERE branch_id <> $1`, [qus]);
    assert.equal(rows[0].n, "0", `${t} leaked rows`);
  }
  // writes into another branch are refused by row security too
  await assert.rejects(appQueryAs([qus], "UPDATE job_card SET complaints = 'x' WHERE doc_no = 'YAS-1483' RETURNING id").then((r) => { if (r.length === 0) throw new Error("no rows"); }));
  assert.notEqual((await adminQuery("SELECT complaints FROM job_card WHERE doc_no = 'YAS-1483'"))[0].complaints, "x");
  // owner sees all branches
  const owner = await ctxFor("saeed", "HQ");
  const all = await listJobs(owner);
  assert.ok(all.some((j) => j.branch_code === "QUS") && all.some((j) => j.branch_code === "YAS"));
});

test("shared vehicles: another branch sees the service history but not the prices (BR-04)", async () => {
  const sara = await ctxFor("sara", "QUS");
  const lc = await id("vehicle", "plate_number = $1", ["48213"]);
  const v = await getVehicle(sara, lc);
  assert.ok(v.history.length >= 1);
  assert.ok(v.history.every((h) => h.amount === null && h.can_open === false));
  const priya = await ctxFor("priya", "YAS");
  const own = await getVehicle(priya, lc);
  assert.ok(own.history.every((h) => h.can_open === true));
});

test("technicians see only their own jobs and never prices (FP-01..FP-03)", async () => {
  const ramesh = await ctxFor("ramesh", "YAS");
  assert.equal((await listJobs(ramesh)).length, 0);
  const job = await id("job_card", "doc_no = $1", ["YAS-1484"]);
  await rejects(getJob(ramesh, job), "not_found");
  await adminQuery("UPDATE job_line SET technician_id = (SELECT id FROM app_user WHERE username = 'ramesh') WHERE job_card_id = $1 AND line_no = 1", [job]);
  const j = await getJob(ramesh, job);
  assert.equal(j.canSeePrices, false);
  for (const l of j.lines) {
    assert.ok(!("unit_price" in l) && !("discount_amount" in l) && !("avg_cost" in l), "price or cost leaked to technician");
  }
  for (const q of j.quotations) assert.ok(!("grand_total" in q));
  for (const l of j.quotationLines) assert.ok(!("line_total" in l) && !("unit_price" in l));
  assert.equal(JSON.stringify(j).includes("432.60"), false);
  await rejects(createJobCard(ramesh, { customer_id: j.job.customer_id, vehicle_id: j.job.vehicle_id }), "forbidden");
});

test("advisors see selling prices but not purchase cost; stock keepers see cost only for their own branch (BR-03)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const j = await getJob(priya, await id("job_card", "doc_no = $1", ["YAS-1483"]));
  assert.ok(j.lines.every((l) => "unit_price" in l && !("avg_cost" in l)));
  const sl = await stockList(priya);
  assert.ok(sl.some((r) => r.branch_code === "QUS"), "quantities at other branches are visible");
  assert.ok(sl.every((r) => !("avg_cost" in r) && !("stock_value" in r)));
  const anil = await ctxFor("anil", "YAS");
  const sk = await stockList(anil);
  assert.ok(sk.filter((r) => r.branch_code === "YAS").every((r) => "avg_cost" in r));
  assert.ok(sk.filter((r) => r.branch_code === "QUS").every((r) => !("avg_cost" in r)));
});

test("an advisor cannot add lines to another branch's job, nor change the list price", async () => {
  const priya = await ctxFor("priya", "YAS");
  const qusJob = await id("job_card", "doc_no = $1", ["QUS-0731"]);
  const before = (await adminQuery("SELECT count(*) n FROM job_line WHERE job_card_id = $1", [qusJob]))[0].n;
  await assert.rejects(addJobLine(priya, qusJob, { line_type: "outside", description: "x", unit_price: "10" }));
  assert.equal((await adminQuery("SELECT count(*) n FROM job_line WHERE job_card_id = $1", [qusJob]))[0].n, before);
  const yasJob = await id("job_card", "doc_no = $1", ["YAS-1483"]);
  const item = await id("item", "part_no = $1", ["BRK-PAD-FR-LC"]);
  await rejects(addJobLine(priya, yasJob, { line_type: "part", item_id: item, unit_price: "100.00" }), "forbidden");
});

test("permission matrix changes are logged with old and new values (FP-06)", async () => {
  const admin = await ctxFor("admin", "HQ");
  const role = await id("role", "code = $1", ["foreman"]);
  await saveRoleMatrix(admin, role, ["customers:view", "jobs:view", "jobs:edit", "workshop:view", "workshop:edit", "stock:view", "approvals:view", "reports:view"], { selling_price: "hidden" });
  const log = await adminQuery("SELECT changes FROM audit_log WHERE entity = 'role' AND entity_id = $1 ORDER BY id DESC LIMIT 1", [role]);
  assert.deepEqual(log[0].changes.added, ["reports:view"]);
  assert.deepEqual(log[0].changes.fields.selling_price, { old: "view", new: "hidden" });
});

test("customer duplicate checks: duplicate VIN is blocked; mobile match needs a reason (CV-08)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const r1 = await createCustomer(priya, { customer_type: "individual", title: "Mr", first_name: "Copy", country_code: "SA", mobile: "+966558321109" });
  assert.equal(r1.id, undefined);
  assert.equal(r1.duplicates?.[0].kind, "mobile");
  const r2 = await createCustomer(priya, { customer_type: "individual", title: "Mr", first_name: "Brother", country_code: "SA", mobile: "+966558321109", duplicate_reason: "Family phone" });
  assert.ok(r2.id);
  const v = await createVehicle(priya, { owner_customer_id: r2.id, registered_in: "DXB", plate_code: "A", plate_number: "1", vin: "JTMHV05J904123456", make: "Toyota", model: "LC", duplicate_reason: "anything" });
  assert.equal(v.id, undefined);
  assert.equal(v.duplicates?.[0].kind, "vin");
  await rejects(createVehicle(priya, { owner_customer_id: r2.id, registered_in: "DXB", plate_code: "A", plate_number: "2", vin: "JTMHV05J9O4123456", make: "Toyota", model: "LC" }), "validation"); // letter O
  await rejects(createCustomer(priya, { customer_type: "individual", first_name: "No title", country_code: "AE", mobile: "0501234567" }), "validation");
});

test("audit log and ledgers are append-only for the application role", async () => {
  const yas = await branchId("YAS");
  await assert.rejects(appQueryAs([yas], "UPDATE audit_log SET action = 'x'"));
  await assert.rejects(appQueryAs([yas], "DELETE FROM stock_move"));
  await assert.rejects(appQueryAs([yas], "UPDATE journal_line SET debit = 0"));
});

test("document numbers stay unique and sequential under concurrent saves", async () => {
  const priya = await ctxFor("priya", "YAS");
  const lc = await id("vehicle", "plate_number = $1", ["48213"]);
  const cust = await id("customer", "first_name = $1", ["Faisal"]);
  const made = await Promise.all(Array.from({ length: 8 }, () => createJobCard(priya, { customer_id: cust, vehicle_id: lc })));
  const nums = made.map((m) => Number(m.docNo.split("-")[1])).sort((a, b) => a - b);
  assert.equal(new Set(nums).size, 8);
  assert.equal(nums[7] - nums[0], 7);
});
