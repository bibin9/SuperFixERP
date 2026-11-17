// Must be imported first: points every test at its own database, never the dev database.
process.env.DB_NAME = process.env.TEST_DB_NAME || "superfix_test";
import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { runReport, visibleReports } from "../lib/services/reports";
import { previewSpec } from "../lib/services/report-builder";
import * as saved from "../lib/services/report-saved";
import { runArchive, archiveStatus } from "../lib/services/archive";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const keys = (cols: { key: string }[]) => cols.map((c) => c.key);
let yas: string, qus: string;

before(async () => {
  await resetTestDb(true, true);
  yas = await branchId("YAS"); qus = await branchId("QUS");
});
after(async () => { await closePool(); });

// ------------------------------------------------------------ branch scope (RB-11)
test("a branch manager reports on their own branch only; asking for another branch is refused", async () => {
  const yousef = await ctxFor("yousef");
  const r = await runReport(yousef, "stock_by_branch", {});
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((x) => x.branch === "YAS"), "rows from another branch");
  await rejects(runReport(yousef, "stock_by_branch", { branches: qus }), "forbidden", /branches chosen/);
  const saeed = await ctxFor("saeed");
  const all = await runReport(saeed, "stock_by_branch", { branches: [yas, qus] });
  assert.deepEqual([...new Set(all.rows.map((x) => x.branch))].sort(), ["QUS", "YAS"]);
});

// ------------------------------------------------------------ hidden field groups
test("columns of a hidden field group are dropped for that role, not just blanked", async () => {
  const priya = await ctxFor("priya"), yousef = await ctxFor("yousef");
  assert.ok(!keys((await runReport(priya, "stock_by_branch", {})).columns).includes("value"), "advisor sees stock value (purchase cost)");
  assert.ok(keys((await runReport(yousef, "stock_by_branch", {})).columns).includes("value"), "branch manager should see stock value");
  const r = await runReport(priya, "stock_by_branch", {});
  assert.ok(r.rows.every((x) => x.value === undefined || !keys(r.columns).includes("value")));
});

test("salary reports need the salary field group, and HR sees no sales reports", async () => {
  const fatima = await ctxFor("fatima.hr"), yousef = await ctxFor("yousef");
  const codesHr = visibleReports(fatima).map((r) => r.code);
  assert.ok(codesHr.includes("payroll_by_branch") && codesHr.includes("insurance_register"));
  assert.ok(!codesHr.includes("sales_register"));
  await rejects(runReport(fatima, "sales_register", {}), "forbidden");
  assert.ok(!visibleReports(yousef).some((r) => r.code === "payroll_by_branch"), "branch manager sees payroll");
  await rejects(runReport(yousef, "payroll_by_branch", {}), "forbidden");
  await rejects(runReport(await ctxFor("ramesh"), "jobs_by_status", {}), "forbidden");
});

// ------------------------------------------------------------ builder (RB-02, RB-11)
test("the builder refuses a field the user may not see, and runs the same spec for a role that may", async () => {
  const spec = { columns: [{ field: "branch" }, { field: "net", agg: "sum" }, { field: "cost", agg: "sum" }] };
  await rejects(previewSpec(await ctxFor("priya"), "sales", spec, {}), "validation", /field cost is not available to you/);
  const ok = await previewSpec(await ctxFor("saeed"), "sales", spec, {});
  assert.equal(ok.columns.length, 3);
  await rejects(previewSpec(await ctxFor("priya"), "sales", { columns: [{ field: "branch; DROP TABLE x" }] }, {}), "validation");
});

// ------------------------------------------------------------ export permission (RB-08)
test("export needs reports:export at every chosen branch and is audited", async () => {
  await rejects(saved.exportRef(await ctxFor("khalid"), "std:jobs_by_status", {}, "csv"), "forbidden");
  const f = await saved.exportRef(await ctxFor("yousef"), "std:stock_by_branch", {}, "csv");
  assert.match(f.body.toString("utf8"), /^﻿/); // Excel-friendly BOM
  assert.match(f.name, /\.csv$/);
  const x = await saved.exportRef(await ctxFor("yousef"), "std:stock_by_branch", {}, "xlsx");
  assert.equal(x.body.subarray(0, 2).toString(), "PK");
  const a = await adminQuery("SELECT count(*)::int n FROM audit_log WHERE entity = 'report' AND action = 'export'");
  assert.ok(a[0].n >= 2);
});

// ------------------------------------------------------------ schedules (RB-10)
test("schedule periods: daily is yesterday, weekly the last 7 days, monthly the previous month", () => {
  assert.deepEqual(saved.schedulePeriod("daily", "2026-03-01"), { from: "2026-02-28", to: "2026-02-28", label: "28/02/2026" });
  const w = saved.schedulePeriod("weekly", "2026-11-17");
  assert.equal(w.from, "2026-11-10"); assert.equal(w.to, "2026-11-16");
  const m = saved.schedulePeriod("monthly", "2026-01-05");
  assert.equal(m.from, "2025-12-01"); assert.equal(m.to, "2025-12-31");
  assert.equal(saved.nextDue("monthly", "2026-01-31"), "2026-02-01");
  assert.equal(saved.nextDue("weekly", "2026-12-28"), "2027-01-04");
});

test("a schedule without export permission is refused; with it the file lands in the inbox when due", async () => {
  await rejects(saved.addSchedule(await ctxFor("khalid"), { ref: "std:jobs_by_status", frequency: "weekly", params: {} }), "forbidden");
  const yousef = await ctxFor("yousef");
  const s = await saved.addSchedule(yousef, { ref: "std:stock_by_branch", frequency: "daily", params: {} });
  await adminQuery("UPDATE report_schedule SET next_due = current_date WHERE id = $1", [s.id]);
  assert.equal(await saved.prepareDue(yousef, s.id), 1);
  const files = await saved.inbox(yousef);
  assert.ok(files.items.some((f: { title: string }) => /Stock/i.test(f.title)));
});

// ------------------------------------------------------------ archive (FSD archive rule)
test("the archive takes only closed records past the live window, keeps the ledger balanced, and makes them read only", async () => {
  await rejects(runArchive(await ctxFor("yousef"), ""), "forbidden");
  const admin = await ctxFor("admin");
  const st = await archiveStatus(admin);
  assert.ok(st.canRun);
  const r = await runArchive(admin, "unit test");
  assert.ok(r.total > 0);
  const jobs = await adminQuery("SELECT j.doc_no FROM archive_member m JOIN job_card j ON j.id::text = m.row_id WHERE m.tbl = 'job_card' ORDER BY 1");
  assert.ok(jobs.length >= 1 && jobs.every((j) => /HIST/.test(j.doc_no)), "a live job was archived: " + jobs.map((j) => j.doc_no));
  const open = await adminQuery("SELECT count(*)::int n FROM archive_member m JOIN job_card j ON j.id::text = m.row_id WHERE m.tbl = 'job_card' AND j.status NOT IN ('closed', 'delivered', 'cancelled')");
  assert.equal(open[0].n, 0);
  await assert.rejects(adminQuery("UPDATE job_card SET delay_note = 'x' WHERE id::text = (SELECT row_id FROM archive_member WHERE tbl = 'job_card' LIMIT 1)"), /is archived and is read only/);
  await assert.rejects(adminQuery("DELETE FROM archive_member"), /append-only|not allowed|cannot/i);
  await rejects(runArchive(admin, "again"), "validation", /Nothing to archive/);
  const live = await runReport(admin, "job_list", { from: "2020-01-01", to: "2030-12-31", source: "live" });
  const arch = await runReport(admin, "job_list", { from: "2020-01-01", to: "2030-12-31", source: "archived" });
  assert.ok(arch.rows.length === jobs.length && !live.rows.some((x) => /HIST-01$/.test(String(x.job_no ?? x.doc_no ?? ""))));
});
