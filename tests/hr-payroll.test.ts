// Must be imported first: points every test at its own database, never the dev database.
process.env.DB_NAME = process.env.TEST_DB_NAME || "superfix_test";
import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import "../lib/services/workflow-handlers";
import { inbox, act } from "../lib/services/workflow";
import * as calc from "../lib/services/payroll-calc";
import * as pay from "../lib/services/payroll";
import * as hr from "../lib/services/hr";
import * as tm from "../lib/services/hr-time";
import { saveMaster } from "../lib/services/master-forms";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const THIS = today().slice(0, 7);
const LAST = (() => { const d = new Date(`${THIS}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const approve = async (user: string, branch: string, docType: string) => {
  const ctx = await ctxFor(user, branch);
  for (const t of await inbox(ctx)) if (t.doc_type === docType) await act(ctx, t.task_id, "approved");
};
let ramesh: string, rashid: string;

before(async () => {
  await resetTestDb(true);
  ramesh = await id("employee", "first_name = $1", ["Ramesh"]); rashid = await id("employee", "first_name = $1", ["Rashid"]);
});
after(async () => { await closePool(); });

// ------------------------------------------------------------ pure calculations (FSD 5.5)
test("gratuity: 21 days a year for 5 years, 30 after, nothing under a year, capped at 2 years' basic", () => {
  assert.equal(calc.gratuity(2000, calc.serviceYears("2020-01-01", "2026-03-31")).toFixed(2), "9500.00");
  assert.equal(calc.gratuity(3000, 0.99).toFixed(2), "0.00");
  assert.equal(calc.gratuity(3000, 3).toFixed(2), "6300.00");
  assert.equal(calc.gratuity(1000, 60).toFixed(2), "24000.00"); // cap
});
test("overtime: basic x 12 / 365 / 8 per hour times the multiplier", () => {
  assert.equal(calc.overtimeAmount(2000, 10, 1.25).toFixed(2), "102.74");
  assert.equal(calc.overtimeAmount(2000, 6, 1.5).toFixed(2), "73.97");
});
test("annual leave: none in the first six months, 2 days a month to a year, then 2.5 a month", () => {
  assert.equal(calc.annualLeaveEarned("2026-01-01", "2026-06-30").toString(), "12");
  assert.equal(calc.annualLeaveEarned("2026-01-01", "2026-05-31").toString(), "0");
  assert.equal(calc.annualLeaveEarned("2024-01-01", "2025-12-31").toString(), "54");
});
test("pro-rating on a 30-day month and the deduction cap carries loan instalments forward", () => {
  const p = calc.paidDays("2026-02", "2026-02-15", "2026-02-28", 0, "30");
  assert.deepEqual([p.days, p.divisor], [14, 30]);
  assert.equal(calc.prorate(3000, p.days, p.divisor).toFixed(2), "1400.00");
  const full = calc.paidDays("2026-02", "2020-01-01", "2026-12-31", 2, "30");
  assert.equal(full.days, 28);
  const c = calc.capDeductions(1000, 50, [{ key: "loan:a", amount: 400, carry: true }, { key: "fixed", amount: 200, carry: false }]);
  assert.equal(c.taken.fixed.toFixed(2), "200.00"); assert.equal(c.taken["loan:a"].toFixed(2), "300.00"); assert.equal(c.carried.toFixed(2), "100.00");
});
test("branch split by days, the last branch takes the rounding", () => {
  const s = calc.splitByDays(3000, [{ key: "YAS", days: 10 }, { key: "QUS", days: 16 }]);
  assert.equal(s.YAS.toFixed(2), "1153.85"); assert.equal(s.QUS.toFixed(2), "1846.15");
});
test("WPS SIF: an EDR line per employee and the SCR control line with the total", () => {
  const f = calc.buildSif({ establishmentId: "1000000123456", routing: "302620122", month: "2026-10", employerRef: "SF", at: new Date("2026-11-05T08:00:00Z"),
    employees: [{ personCode: "10000000007919", routing: "302620122", account: "AE070331234567890120001", start: "2026-10-01", end: "2026-10-31", days: 31, fixed: "3000.00", variable: "115.07", leaveDays: 0 }] });
  const lines = f.content.trim().split(/\r?\n/);
  assert.match(lines[0], /^EDR,10000000007919,302620122,AE07/); assert.match(lines[1], /^SCR,1000000123456,302620122,/); assert.equal(f.total, "3115.07");
});

// ------------------------------------------------------------ access
test("permissions: technician and branch manager cannot see payroll; HR can; the owner sees but does not calculate", async () => {
  await rejects(pay.listRuns(await ctxFor("ramesh", "YAS")), "forbidden");
  await rejects(pay.listRuns(await ctxFor("yousef", "YAS")), "forbidden");
  await rejects(pay.calculateRun(await ctxFor("yousef", "YAS"), LAST), "forbidden");
  await rejects(pay.calculateRun(await ctxFor("saeed", "YAS"), LAST), "forbidden");
  assert.ok(Array.isArray(await pay.listRuns(await ctxFor("saeed", "YAS"))));
  await rejects(hr.listEmployees(await ctxFor("ramesh", "YAS")), "forbidden");
  await rejects(saveMaster(await ctxFor("ramesh", "YAS"), "departments", { code: "X1", name_en: "X" }), "forbidden");
  await saveMaster(await ctxFor("fatima.hr", "HQ"), "departments", { code: "BODY", name_en: "Body shop" });
});
test("a branch manager gets the employee file without bank details or salary history", async () => {
  const e = await hr.getEmployee(await ctxFor("yousef", "YAS"), ramesh);
  assert.equal(e.employee.iban, null); assert.equal(e.employee.wps_card_no, null); assert.equal(e.salaryVisible, false);
  await rejects(pay.salaryOf(await ctxFor("yousef", "YAS"), ramesh), "forbidden");
  for (const h of e.history) if (h.action === "opening_salary") assert.equal(h.changes, null);
});
test("leave beyond the balance is refused; the request needs the line manager and then HR", async () => {
  const r = await ctxFor("ramesh", "YAS");
  await rejects(tm.requestLeave(r, { leave_type: "annual", from_date: "2027-01-01", to_date: "2027-03-31", reason: "x" }), "validation", /Not enough annual leave/);
  const ok = await tm.requestLeave(r, { leave_type: "annual", from_date: "2027-01-10", to_date: "2027-01-11", reason: "x" });
  assert.equal(ok.status, "pending");
  await approve("khalid", "YAS", "leave_request");
  assert.equal((await adminQuery("SELECT status FROM leave_request WHERE id = $1", [ok.id]))[0].status, "pending_approval");
  await approve("fatima.hr", "HQ", "leave_request");
  assert.equal((await adminQuery("SELECT status FROM leave_request WHERE id = $1", [ok.id]))[0].status, "approved");
});

// ------------------------------------------------------------ the run
test("run: calculate last month, approve, lock, post balanced journals by branch, WPS, paid", async () => {
  const f = await ctxFor("fatima.hr", "HQ");
  const r = await pay.calculateRun(f, LAST);
  assert.equal(r.employees, 11);
  const rm = (await adminQuery("SELECT earnings, net, wps_fixed, wps_variable FROM payroll_employee WHERE run_id = $1 AND employee_id = $2", [r.id, ramesh]))[0];
  assert.equal(rm.earnings.overtime, "115.07"); assert.equal(rm.net, "3415.07"); assert.equal(rm.wps_variable, "115.07");
  await rejects(pay.calculateRun(f, "2099-01"), "validation", /future/);
  await pay.submitRun(f, r.id);
  await approve("saeed", "YAS", "payroll_run");
  await rejects(pay.calculateRun(f, LAST), "validation", /locked/);
  await rejects(pay.payslip(await ctxFor("priya", "YAS"), LAST, ramesh), "forbidden");
  assert.equal((await pay.payslip(await ctxFor("ramesh", "YAS"), LAST)).slip.net, "3415.07");
  await pay.postRun(f, r.id);
  const j = await adminQuery("SELECT j.id, sum(l.debit) d, sum(l.credit) c FROM journal j JOIN journal_line l ON l.journal_id = j.id WHERE j.source_type = 'payroll_run' AND j.source_id = $1 GROUP BY j.id", [r.id]);
  assert.equal(j.length, 3); for (const x of j) assert.equal(x.d, x.c);
  const payable = await adminQuery(`SELECT sum(l.credit - l.debit) v FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id JOIN account_mapping m ON m.account_id = a.id AND m.event_key = 'salaries_payable' WHERE j.source_id = $1`, [r.id]);
  assert.equal(Number(payable[0].v).toFixed(2), "87215.07");
  const files = await pay.createWps(f, r.id);
  assert.equal(files.length, 2); assert.equal(files.reduce((s, x) => s + Number(x.total), 0).toFixed(2), "87215.07");
  const bank = (await adminQuery("SELECT id FROM bank_account WHERE active LIMIT 1"))[0].id;
  await pay.markPaid(f, r.id, bank);
  assert.equal((await adminQuery("SELECT status FROM payroll_run WHERE id = $1", [r.id]))[0].status, "paid");
});
test("loan: instalment deducted this month within the cap; a transfer splits the cost by days", async () => {
  const f = await ctxFor("fatima.hr", "HQ");
  const l = await pay.requestLoan(await ctxFor("ramesh", "YAS"), { kind: "advance", amount: "1000", instalments: "2", start_month: THIS, reason: "x" });
  await approve("khalid", "YAS", "loan"); await approve("saeed", "YAS", "loan");
  assert.equal((await adminQuery("SELECT status FROM loan WHERE id = $1", [l.id]))[0].status, "approved");
  const anil = await id("employee", "first_name = $1", ["Anil"]);
  await hr.transferEmployee(f, { employee_id: anil, to_branch_id: await branchId("QUS"), effective_date: `${THIS}-11`, reason: "cover" });
  const r = await pay.calculateRun(f, THIS);
  const rm = (await adminQuery("SELECT deductions FROM payroll_employee WHERE run_id = $1 AND employee_id = $2", [r.id, ramesh]))[0];
  assert.equal(rm.deductions[`loan:${l.id}`], "500.00");
  const split = await adminQuery("SELECT b.code, s.days FROM payroll_branch_split s JOIN branch b ON b.id = s.branch_id WHERE s.run_id = $1 AND s.employee_id = $2 ORDER BY b.code", [r.id, anil]);
  assert.deepEqual(split.map((x) => `${x.code}:${x.days}`).slice(1), ["YAS:10"]);
});
test("final settlement: gratuity, unused leave and open loans; approval marks the employee as left", async () => {
  const f = await ctxFor("fatima.hr", "HQ");
  const p = await pay.previewSettlement(f, { employee_id: rashid, last_day: today(), reason: "resignation" });
  assert.ok(Number(p.gratuity) > 0); assert.ok(Number(p.net) > 0);
  await rejects(pay.createSettlement(f, { employee_id: rashid, last_day: today(), reason: "resignation", other_deductions: "100" }), "validation", /what the other deductions/);
  const s = await pay.createSettlement(f, { employee_id: rashid, last_day: today(), reason: "resignation" });
  await approve("saeed", "YAS", "final_settlement");
  assert.equal((await adminQuery("SELECT status FROM final_settlement WHERE id = $1", [s.id]))[0].status, "approved");
  assert.equal((await adminQuery("SELECT status FROM employee WHERE id = $1", [rashid]))[0].status, "left");
});
