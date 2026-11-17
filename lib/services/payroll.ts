import type { PoolClient } from "pg";
import { Ctx, can, canAnywhere, canSee, fieldLevel } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { D, Decimal } from "../money";
import { str, optStr } from "../validate";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { nextDocNo } from "./numbering";
import { postJournal, type PostLine } from "./ledger";
import { submitForApproval, registerHandler } from "./workflow";
import { today, empName, myEmployee, branchDays, applyDueTransfers } from "./hr";
import { leaveBalances } from "./hr-time";
import {
  addDays, monthEnd, daysBetween, serviceYears, gratuity, overtimeAmount, annualLeaveEarned, prorate, paidDays, splitByDays, capDeductions, buildSif, type SifEmployee,
} from "./payroll-calc";

/**
 * M14 payroll and WPS (FSD 4.14, 5.5): salary structures and updates with approval, advances and
 * loans, the monthly run (calculate, check, approve, post, WPS file, paid), payslips, the branch
 * register, accruals and the final settlement. HR prepares; the owner approves; the accountant sees
 * the postings; employees see their own payslips.
 */

const r2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2);
const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const first = (m: string) => `${m}-01`;
const prevMonth = (m: string) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

/** HR / payroll staff: edit HR anywhere and edit salaries. */
const grantBranch = (ctx: Ctx, b: string | null) => b ?? ctx.branchIds[0] ?? null;
export const isPayroll = (ctx: Ctx) => canAnywhere(ctx, "hr", "edit") && ctx.grants.some((g) => can(ctx, "hr", "edit", grantBranch(ctx, g.branchId)) && fieldLevel(ctx, "salary", grantBranch(ctx, g.branchId)) === "edit");
/** Sees payroll figures: HR / payroll and anyone with the salary field visible (the owner). */
export const seesPayroll = (ctx: Ctx) => ctx.grants.some((g) => canSee(ctx, "salary", grantBranch(ctx, g.branchId)));
const assertPayroll = (ctx: Ctx) => { if (!isPayroll(ctx)) throw forbidden("Only HR / payroll can do this."); };
const assertSees = (ctx: Ctx) => { if (!seesPayroll(ctx)) throw forbidden("You cannot see salaries."); };

async function hqBranch(c: PoolClient) {
  const code = String(await getSetting(c, "payroll.approval_branch", null, "HQ"));
  const b = (await c.query("SELECT id FROM branch WHERE code = $1", [code])).rows[0] ?? (await c.query("SELECT id FROM branch ORDER BY code LIMIT 1")).rows[0];
  return b.id as string;
}

// ---------------------------------------------------------------- salary structure (PR-01, PR-08)
type Comp = { code: string; name_en: string; kind: string; fixed: boolean; counts_gratuity: boolean; counts_leave_salary: boolean; counts_overtime: boolean; wps_column: string; account_id: string | null; sort: number };
export async function components(c: PoolClient): Promise<Comp[]> {
  return (await c.query("SELECT * FROM salary_component WHERE active ORDER BY sort, code")).rows;
}

/** Each component's monthly amount on a date (latest effective row on or before it). */
export async function structureAt(c: PoolClient, employeeId: string, asOf: string) {
  const rows = (await c.query(
    `SELECT DISTINCT ON (component) component, amount FROM salary_structure WHERE employee_id = $1 AND effective_from <= $2 ORDER BY component, effective_from DESC`,
    [employeeId, asOf])).rows;
  return Object.fromEntries(rows.filter((r) => D(r.amount).gt(0)).map((r) => [r.component, D(r.amount)])) as Record<string, Decimal>;
}
const sumWhere = (s: Record<string, Decimal>, comps: Comp[], pick: (c: Comp) => boolean) =>
  comps.filter((x) => x.kind === "earning" && pick(x)).reduce((t, x) => t.plus(s[x.code] ?? 0), D(0));

export async function salaryOf(ctx: Ctx, employeeId: string) {
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [employeeId])).rows[0];
    if (!e) throw notFound("Employee");
    const self = e.user_id === ctx.userId;
    if (!self && !canSee(ctx, "salary", e.branch_id)) throw forbidden("You cannot see salaries.");
    const comps = await components(c);
    const now = await structureAt(c, employeeId, today());
    const history = (await c.query(
      `SELECT s.component, s.amount, to_char(s.effective_from,'YYYY-MM-DD') effective_from, r.doc_no, r.reason, u.full_name created_by_name
         FROM salary_structure s LEFT JOIN salary_revision r ON r.id = s.revision_id LEFT JOIN app_user u ON u.id = s.created_by
        WHERE s.employee_id = $1 ORDER BY s.effective_from DESC, s.component`, [employeeId])).rows;
    const pending = (await c.query("SELECT id, doc_no, effective_date, reason, status FROM salary_revision WHERE status = 'pending_approval' AND lines @> $1::jsonb", [JSON.stringify([{ employee_id: employeeId }])])).rows;
    const gross = sumWhere(now, comps, () => true);
    return { comps, now: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v.toFixed(2)])), gross: gross.toFixed(2), history, pending, canEdit: isPayroll(ctx) && !self };
  });
}

/** First salary of a new employee, set by HR without approval. Later changes go through Update salary. */
export async function setOpeningSalary(ctx: Ctx, employeeId: string, amounts: Record<string, string>, effective?: string) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [employeeId])).rows[0];
    if (!e) throw notFound("Employee");
    if ((await c.query("SELECT 1 FROM salary_structure WHERE employee_id = $1", [employeeId])).rowCount)
      throw invalid("This employee already has a salary. Use Update salary, which goes for approval.");
    const comps = await components(c);
    const eff = str(effective) || e.joining_date;
    let n = 0;
    for (const cp of comps) {
      const v = str(amounts[cp.code]);
      if (!v) continue;
      if (!/^\d+(\.\d{1,2})?$/.test(v)) throw invalid(`${cp.name_en} must be an amount, for example 2500.00.`, { field: `amt[${cp.code}]` });
      if (D(v).lte(0)) continue;
      await c.query("INSERT INTO salary_structure (branch_id, employee_id, component, amount, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
        [e.branch_id, e.id, cp.code, v, eff, ctx.userId]);
      n++;
    }
    if (!n) throw invalid("Enter at least the basic salary.", { field: "amt[basic]" });
    if (!(await structureAt(c, e.id, eff)).basic) throw invalid("Basic salary is required.", { field: "amt[basic]" });
    await audit(c, ctx, "employee", e.id, "opening_salary", { effective_from: eff, ...amounts }, e.branch_id);
  });
}

/** Update salary (PR-08): one or many employees, new monthly amounts, effective date, reason; goes for approval. */
export async function requestRevision(ctx: Ctx, f: { effective_date: string; reason: string; lines: { employee_id: string; component: string; amount: string }[] }) {
  assertPayroll(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f.effective_date))) throw invalid("Effective date is required.", { field: "effective_date" });
  if (!str(f.reason)) throw invalid("Reason is required.", { field: "reason" });
  const wanted = f.lines.filter((l) => str(l.employee_id) && str(l.component) && str(l.amount));
  if (!wanted.length) throw invalid("Add at least one employee and the new amount.");
  return withTx(ctx, async (c) => {
    const lines: { employee_id: string; emp_no: string; name: string; component: string; old: string; new: string }[] = [];
    let change = D(0);
    let branchId: string | null = null;
    for (const l of wanted) {
      if (!/^\d+(\.\d{1,2})?$/.test(str(l.amount))) throw invalid("New amount must be an amount, for example 3000.00.");
      const e = (await c.query("SELECT * FROM employee WHERE id = $1 AND status = 'active'", [l.employee_id])).rows[0];
      if (!e) throw invalid("Employee not found or has left.");
      if (!(await c.query("SELECT 1 FROM salary_component WHERE code = $1 AND active", [l.component])).rowCount) throw invalid("Unknown salary component.");
      const old = (await structureAt(c, e.id, f.effective_date))[l.component] ?? D(0);
      if (old.eq(l.amount)) continue;
      lines.push({ employee_id: e.id, emp_no: e.emp_no, name: empName(e), component: l.component, old: old.toFixed(2), new: D(l.amount).toFixed(2) });
      change = change.plus(D(l.amount).minus(old));
      branchId = branchId ?? e.branch_id;
    }
    if (!lines.length) throw invalid("The new amounts are the same as today's.");
    if ((await c.query("SELECT 1 FROM payroll_run WHERE period_month = date_trunc('month', $1::date) AND status <> 'calculated'", [f.effective_date])).rowCount)
      throw invalid("Payroll for that month is already approved. Use the first day of next month, or arrears.", { field: "effective_date" });
    const r = await c.query(
      "INSERT INTO salary_revision (branch_id, effective_date, reason, lines, total_change, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [branchId, f.effective_date, str(f.reason), JSON.stringify(lines), change.toFixed(2), ctx.userId]);
    const id = r.rows[0].id;
    const sub = await submitForApproval(c, ctx, {
      docType: "salary_revision", docId: id, docRef: `Salary update ${lines.length} line(s) from ${f.effective_date}`, branchId: await hqBranch(c), amount: change.abs().toFixed(2),
      summary: { effective: f.effective_date, reason: str(f.reason), lines: lines.map((x) => `${x.emp_no} ${x.name}: ${x.component} ${x.old} → ${x.new}`).join("; ") },
    });
    if (sub.status === "approved") await applyRevision(c, ctx, id);
    return { id, status: sub.status };
  });
}
async function applyRevision(c: PoolClient, ctx: Ctx, id: string) {
  const r = (await c.query("SELECT * FROM salary_revision WHERE id = $1 FOR UPDATE", [id])).rows[0];
  const docNo = await nextDocNo(c, r.branch_id, "salary_revision");
  for (const l of r.lines as { employee_id: string; component: string; new: string }[]) {
    const e = (await c.query("SELECT branch_id FROM employee WHERE id = $1", [l.employee_id])).rows[0];
    await c.query(
      `INSERT INTO salary_structure (branch_id, employee_id, component, amount, effective_from, revision_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (employee_id, component, effective_from) DO UPDATE SET amount = EXCLUDED.amount, revision_id = EXCLUDED.revision_id`,
      [e.branch_id, l.employee_id, l.component, l.new, r.effective_date, id, r.created_by]);
    await audit(c, ctx, "employee", l.employee_id, "salary_revision", { doc_no: docNo, component: l.component, amount: l.new, effective_from: r.effective_date }, e.branch_id);
  }
  await c.query("UPDATE salary_revision SET status = 'approved', doc_no = $2, decided_at = now() WHERE id = $1", [id, docNo]);
}
registerHandler("salary_revision", {
  onApproved: (c, ctx, req) => applyRevision(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE salary_revision SET status = 'rejected', reject_reason = $2, decided_at = now() WHERE id = $1", [req.doc_id, comment]); },
});
export async function listRevisions(ctx: Ctx) {
  assertSees(ctx);
  return withTx(ctx, async (c) => (await c.query(
    `SELECT r.*, to_char(r.effective_date,'YYYY-MM-DD') eff, u.full_name created_by_name FROM salary_revision r LEFT JOIN app_user u ON u.id = r.created_by ORDER BY r.created_at DESC LIMIT 100`)).rows);
}

// ---------------------------------------------------------------- advances and loans (PR-13)
export async function requestLoan(ctx: Ctx, f: { employee_id?: string; kind: string; amount: string; instalments: string; start_month: string; reason: string }) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    const empId = str(f.employee_id) || me?.id;
    if (!empId) throw invalid("Your user is not linked to an employee file. Ask HR.");
    const e = (await c.query("SELECT * FROM employee WHERE id = $1 AND status = 'active'", [empId])).rows[0];
    if (!e) throw notFound("Employee");
    if (e.id !== me?.id && !isPayroll(ctx)) throw forbidden();
    if (!["advance", "loan"].includes(f.kind)) throw invalid("Type: choose advance or loan.", { field: "kind" });
    if (!/^\d+(\.\d{1,2})?$/.test(str(f.amount)) || D(f.amount).lte(0)) throw invalid("Amount must be more than zero, for example 2000.", { field: "amount" });
    const n = Number(f.instalments);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw invalid("Instalments must be a whole number from 1 to 60.", { field: "instalments" });
    if (!isMonth(str(f.start_month))) throw invalid("First deduction month is required.", { field: "start_month" });
    if (first(f.start_month) < today().slice(0, 7) + "-01") throw invalid("First deduction month cannot be in the past.", { field: "start_month" });
    if (!str(f.reason)) throw invalid("Reason is required.", { field: "reason" });
    const maxMonths = Number(await getSetting(c, "payroll.loan_max_salary_months", null, 3));
    const gross = sumWhere(await structureAt(c, e.id, today()), await components(c), () => true);
    if (gross.gt(0) && D(f.amount).gt(gross.times(maxMonths))) throw invalid(`Amount cannot be more than ${maxMonths} months' salary (AED ${gross.times(maxMonths).toFixed(2)}).`, { field: "amount" });
    const open = (await c.query("SELECT count(*)::int n FROM loan WHERE employee_id = $1 AND status IN ('pending_approval','approved')", [e.id])).rows[0].n;
    if (open && f.kind === "loan") throw invalid("There is already an open loan for this employee. It must be repaid or rejected first.");
    const inst = r2(D(f.amount).div(n));
    const r = await c.query(
      `INSERT INTO loan (branch_id, employee_id, kind, amount, instalments, instalment_amount, start_month, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [e.branch_id, e.id, f.kind, D(f.amount).toFixed(2), n, inst.toFixed(2), first(f.start_month), str(f.reason), ctx.userId]);
    const id = r.rows[0].id;
    const sub = await submitForApproval(c, ctx, { docType: "loan", docId: id, docRef: `${f.kind === "loan" ? "Loan" : "Advance"} ${e.emp_no} ${empName(e)}`, branchId: e.branch_id,
      amount: D(f.amount).toFixed(2), subjectEmployeeId: e.id,
      summary: { employee: `${e.emp_no} ${empName(e)}`, amount: D(f.amount).toFixed(2), instalments: `${n} × ${inst.toFixed(2)} from ${f.start_month}`, reason: str(f.reason) } });
    if (sub.status === "approved") await approveLoan(c, ctx, id);
    return { id, status: sub.status };
  });
}
async function approveLoan(c: PoolClient, ctx: Ctx, id: string) {
  const l = (await c.query("SELECT * FROM loan WHERE id = $1 FOR UPDATE", [id])).rows[0];
  const docNo = await nextDocNo(c, l.branch_id, "loan");
  const bank = (await c.query("SELECT ba.id, ba.account_id FROM bank_account ba WHERE ba.active ORDER BY ba.name LIMIT 1")).rows[0];
  // The money goes out of the bank to the employee: staff advances (asset) against the bank.
  const j = await postJournal(c, ctx, { branchId: l.branch_id, date: today(), sourceType: "loan", sourceId: id, narration: `${l.kind === "loan" ? "Loan" : "Salary advance"} ${docNo}`,
    lines: [{ event: "staff_advances", debit: l.amount }, bank ? { accountId: bank.account_id, credit: l.amount } : { event: "bank", credit: l.amount }] });
  await c.query("UPDATE loan SET status = 'approved', doc_no = $2, decided_at = now(), bank_account_id = $3, journal_id = $4 WHERE id = $1", [id, docNo, bank?.id ?? null, j?.id ?? null]);
}
registerHandler("loan", {
  onApproved: (c, ctx, req) => approveLoan(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE loan SET status = 'rejected', reject_reason = $2, decided_at = now() WHERE id = $1", [req.doc_id, comment]); },
});
export async function listLoans(ctx: Ctx, mine = false) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    if (!mine) assertSees(ctx);
    return (await c.query(
      `SELECT l.*, to_char(l.start_month,'YYYY-MM') start_m, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code, (l.amount - l.recovered) balance
         FROM loan l JOIN employee e ON e.id = l.employee_id JOIN branch b ON b.id = l.branch_id
        WHERE ($1::uuid IS NULL OR l.employee_id = $1) ORDER BY l.created_at DESC LIMIT 300`, [mine ? me?.id ?? "00000000-0000-0000-0000-000000000000" : null])).rows;
  });
}

// ---------------------------------------------------------------- the monthly run (PR-01 to PR-04, PR-10, PR-14, PR-15)
type Line = {
  employee_id: string; branch_id: string; start: string; end: string; paid: number; unpaid: number; leave: number; ot: number;
  earnings: Record<string, Decimal>; deductions: Record<string, Decimal>; gross: Decimal; total: Decimal; net: Decimal; fixed: Decimal; variable: Decimal; carried: Decimal;
  accG: Decimal; accL: Decimal; accT: Decimal; liability: Decimal; loanBal: Decimal; flags: string[]; split: Record<string, number>;
};

async function calcEmployee(c: PoolClient, e: Record<string, any>, month: string, comps: Comp[], prev: Record<string, any> | undefined, s: Record<string, unknown>, runId: string): Promise<Line | null> {
  const mStart = first(month), mEnd = monthEnd(month);
  const from = e.joining_date > mStart ? e.joining_date : mStart;
  const to = e.leaving_date && e.leaving_date < mEnd ? e.leaving_date : mEnd;
  if (to < from) return null;
  const flags: string[] = [];
  const struct = await structureAt(c, e.id, to);
  if (!struct.basic) { flags.push("No salary set: left out of the run"); return { ...emptyLine(e, from, to), flags }; }
  // Leave in the month (approved), counted by calendar days inside the month.
  const leaves = (await c.query(
    `SELECT lr.from_date, lr.to_date, lt.paid FROM leave_request lr JOIN leave_type lt ON lt.code = lr.leave_type
      WHERE lr.employee_id = $1 AND lr.status = 'approved' AND lr.from_date <= $3 AND lr.to_date >= $2`, [e.id, from, to])).rows;
  let unpaid = 0, paidLeave = 0;
  for (const l of leaves) {
    const a = l.from_date > from ? l.from_date : from, b = l.to_date < to ? l.to_date : to;
    const n = daysBetween(a, b) + 1;
    if (l.paid) paidLeave += n; else unpaid += n;
  }
  const basis = String(s.basis) === "calendar" ? "calendar" : "30";
  const pd = paidDays(month, from, to, unpaid, basis);
  const earnings: Record<string, Decimal> = {};
  const deductions: Record<string, Decimal> = {};
  for (const cp of comps) {
    const amt = struct[cp.code];
    if (!amt) continue;
    const v = cp.fixed ? prorate(amt, pd.days, pd.divisor) : r2(amt);
    if (v.lte(0)) continue;
    if (cp.kind === "earning") earnings[cp.code] = v; else deductions[cp.code] = v;
  }
  if (from !== mStart) flags.push(`Joined ${from}: pro-rated`);
  if (to !== mEnd) flags.push(`Leaves ${to}: pro-rated`);
  if (unpaid) flags.push(`${unpaid} day(s) unpaid leave`);
  // Approved overtime of the month (PR-14).
  const ots = (await c.query(
    `SELECT id, hours, ot_type, to_char(work_date,'YYYY-MM-DD') d FROM overtime_request WHERE employee_id = $1 AND status = 'approved'
      AND work_date BETWEEN $2 AND $3 AND (payroll_run_id IS NULL OR payroll_run_id = $4)`, [e.id, mStart, mEnd, runId])).rows;
  const otBase = sumWhere(struct, comps, (x) => x.counts_overtime);
  let otPay = D(0), otHours = 0;
  const perDay: Record<string, number> = {};
  for (const o of ots) {
    const mult = Number(s[`ot_${o.ot_type}`] ?? (o.ot_type === "normal" ? 1.25 : 1.5));
    otPay = otPay.plus(overtimeAmount(otBase, o.hours, mult));
    otHours += Number(o.hours);
    perDay[o.d] = (perDay[o.d] ?? 0) + Number(o.hours);
  }
  if (ots.length) await c.query("UPDATE overtime_request SET payroll_run_id = $2 WHERE id = ANY($1)", [ots.map((o) => o.id), runId]);
  if (otPay.gt(0)) earnings.overtime = otPay;
  const longDays = Object.entries(perDay).filter(([, h]) => h > Number(s.ot_flag_hours ?? 2));
  if (longDays.length) flags.push(`Overtime above ${s.ot_flag_hours ?? 2} h on ${longDays.map(([d]) => d).join(", ")}`);
  const gross = Object.values(earnings).reduce((t, v) => t.plus(v), D(0));
  // Deductions: fixed ones, disciplinary deductions for this month, then loan instalments, within the cap (PR-02).
  const items: { key: string; amount: Decimal; carry: boolean }[] = Object.entries(deductions).map(([k, v]) => ({ key: k, amount: v, carry: false }));
  const disc = (await c.query("SELECT id, amount FROM employee_record WHERE employee_id = $1 AND kind = 'disciplinary' AND deduct_month = $2 AND amount > 0 AND status = 'active'", [e.id, mStart])).rows;
  for (const d of disc) items.push({ key: `disciplinary:${d.id}`, amount: D(d.amount), carry: false });
  const loans = (await c.query(
    `SELECT id, doc_no, amount, recovered, instalment_amount, to_char(start_month,'YYYY-MM') start_month FROM loan WHERE employee_id = $1 AND status = 'approved' AND start_month <= $2 AND recovered < amount ORDER BY start_month`,
    [e.id, mStart])).rows;
  // Due this month = instalments due so far less what was recovered, so an instalment moved out of an
  // earlier month (deduction limit) comes back on top of this month's.
  for (const l of loans) {
    const left = D(l.amount).minus(l.recovered);
    const months = (Number(month.slice(0, 4)) - Number(String(l.start_month).slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(String(l.start_month).slice(5, 7)) + 1;
    const due = Decimal.min(left, D(l.instalment_amount).times(months).minus(l.recovered));
    if (due.gt(0)) items.push({ key: `loan:${l.id}`, amount: due, carry: true });
  }
  const cap = capDeductions(gross, Number(s.deduction_cap_pct ?? 50), items);
  const taken: Record<string, Decimal> = {};
  for (const [k, v] of Object.entries(cap.taken)) taken[k] = v;
  if (cap.carried.gt(0)) flags.push(`AED ${cap.carried.toFixed(2)} of loan instalments moved to next month (${Number(s.deduction_cap_pct ?? 50)}% limit)`);
  const total = Object.values(taken).reduce((t, v) => t.plus(v), D(0));
  const net = gross.minus(total);
  // WPS columns: fixed components in the fixed column, overtime and variable ones in the variable column; net after deductions.
  const fixedEarn = comps.filter((x) => x.kind === "earning" && x.wps_column === "fixed").reduce((t, x) => t.plus(earnings[x.code] ?? 0), D(0));
  let fixed = Decimal.min(fixedEarn, net), variable = net.minus(fixed);
  if (variable.lt(0)) { variable = D(0); fixed = net; }
  // Accruals (PR-10): gratuity liability as if leaving at month end, leave salary on days earned, air ticket per month of cycle.
  const unpaidAll = Number((await c.query(
    `SELECT coalesce(sum(lr.days),0) n FROM leave_request lr JOIN leave_type lt ON lt.code = lr.leave_type WHERE lr.employee_id = $1 AND lr.status = 'approved' AND NOT lt.paid AND lr.from_date <= $2`,
    [e.id, to])).rows[0].n);
  const yrs = serviceYears(e.joining_date, to, unpaidAll);
  const gBasic = sumWhere(struct, comps, (x) => x.counts_gratuity);
  const liability = gratuity(gBasic, yrs, { divisor: 30, capMonths: Number(s.gratuity_cap_months ?? 24) });
  const prevLiab = D(prev?.gratuity_liability ?? (await openingLiability(c, e, month, gBasic, s)));
  const accG = liability.minus(prevLiab);
  const earnedNow = annualLeaveEarned(e.joining_date, to), earnedBefore = annualLeaveEarned(e.joining_date, addDays(mStart, -1));
  const lsBase = sumWhere(struct, comps, (x) => x.counts_leave_salary);
  const accL = r2(earnedNow.minus(earnedBefore).times(lsBase).div(30));
  const ticket = (await c.query("SELECT data FROM employee_record WHERE employee_id = $1 AND kind = 'air_ticket' AND status = 'active' ORDER BY created_at DESC LIMIT 1", [e.id])).rows[0]?.data;
  const accT = ticket ? r2(D(ticket.ticket_amount || 0).div(Number(ticket.cycle_years || 1) * 12)) : D(0);
  const loanBal = loans.reduce((t, l) => t.plus(D(l.amount).minus(l.recovered)), D(0)).minus(Object.entries(taken).filter(([k]) => k.startsWith("loan:")).reduce((t, [, v]) => t.plus(v), D(0)));
  if (!e.iban && !e.wps_card_no) flags.push("No IBAN or WPS card: cannot be paid by WPS");
  if (!e.mohre_person_code) flags.push("No MOHRE person code: needed for the WPS file");
  if (prev && !D(prev.net).eq(net)) {
    const diff = net.minus(prev.net);
    flags.push(`Net ${diff.gt(0) ? "up" : "down"} AED ${diff.abs().toFixed(2)} from last month (${D(prev.net).toFixed(2)})`);
  } else if (!prev) flags.push("First payroll for this employee");
  const split = await branchDays(c, e.id, e.branch_id, from, to);
  return {
    employee_id: e.id, branch_id: e.branch_id, start: from, end: to, paid: pd.days, unpaid, leave: paidLeave, ot: otHours,
    earnings, deductions: taken, gross, total, net, fixed, variable, carried: cap.carried, accG, accL, accT, liability, loanBal, flags, split,
  };
}
function emptyLine(e: Record<string, any>, from: string, to: string): Line {
  const z = D(0);
  return { employee_id: e.id, branch_id: e.branch_id, start: from, end: to, paid: 0, unpaid: 0, leave: 0, ot: 0, earnings: {}, deductions: {}, gross: z, total: z, net: z, fixed: z, variable: z,
    carried: z, accG: z, accL: z, accT: z, liability: z, loanBal: z, flags: [], split: {} };
}
/** Liability before the first run (employees moved from Tally): as if they had left at the end of last month. */
async function openingLiability(c: PoolClient, e: Record<string, any>, month: string, gBasic: Decimal, s: Record<string, unknown>) {
  const prevEnd = addDays(first(month), -1);
  if (prevEnd < e.joining_date) return D(0);
  return gratuity(gBasic, serviceYears(e.joining_date, prevEnd, 0), { divisor: 30, capMonths: Number(s.gratuity_cap_months ?? 24) });
}

async function settingsFor(c: PoolClient) {
  const g = async <T>(k: string, f: T) => getSetting<T>(c, k, null, f);
  return {
    basis: await g("payroll.proration_basis", "30"), deduction_cap_pct: await g("payroll.deduction_cap_pct", 50), gratuity_cap_months: await g("payroll.gratuity_cap_months", 24),
    ot_normal: await g("payroll.ot_normal", 1.25), ot_night: await g("payroll.ot_night", 1.5), ot_rest_day: await g("payroll.ot_rest_day", 1.5), ot_holiday: await g("payroll.ot_holiday", 1.5),
    ot_flag_hours: await g("payroll.ot_flag_hours", 2),
  } as Record<string, unknown>;
}

/** Calculate (or recalculate) the month. Only while it is not yet sent for approval. */
export async function calculateRun(ctx: Ctx, month: string) {
  assertPayroll(ctx);
  if (!isMonth(month)) throw invalid("Choose the month.", { field: "month" });
  if (month > today().slice(0, 7)) throw invalid("Payroll cannot be calculated for a future month.", { field: "month" });
  return withTx(ctx, async (c) => {
    await applyDueTransfers(c, ctx);
    let run = (await c.query("SELECT * FROM payroll_run WHERE period_month = $1 FOR UPDATE", [first(month)])).rows[0];
    if (run && run.status !== "calculated") throw invalid("This month's payroll is approved and locked. Corrections go into next month, or the owner reopens it.");
    const prevOpen = (await c.query("SELECT 1 FROM payroll_run WHERE period_month < $1 AND status IN ('calculated','pending_approval')", [first(month)])).rowCount;
    if (prevOpen) throw invalid("An earlier month's payroll is still open. Finish it first.");
    if ((await c.query("SELECT 1 FROM payroll_run WHERE period_month < $1 AND status = 'approved'", [first(month)])).rowCount)
      throw invalid("Post last month's approved payroll first, so its loan recoveries count.");
    if (!run) run = (await c.query("INSERT INTO payroll_run (period_month) VALUES ($1) RETURNING *", [first(month)])).rows[0];
    await c.query("UPDATE overtime_request SET payroll_run_id = NULL WHERE payroll_run_id = $1", [run.id]);
    await c.query("DELETE FROM payroll_employee WHERE run_id = $1", [run.id]);
    await c.query("DELETE FROM payroll_branch_split WHERE run_id = $1", [run.id]);
    const comps = await components(c);
    const s = await settingsFor(c);
    const emps = (await c.query(
      `SELECT * FROM employee WHERE joining_date <= $2 AND (status = 'active' OR leaving_date >= $1) ORDER BY emp_no`, [first(month), monthEnd(month)])).rows;
    const prevRun = (await c.query("SELECT id FROM payroll_run WHERE period_month = $1", [first(prevMonth(month))])).rows[0];
    const prevRows = prevRun ? Object.fromEntries((await c.query("SELECT * FROM payroll_employee WHERE run_id = $1", [prevRun.id])).rows.map((r) => [r.employee_id, r])) : {};
    let gross = D(0), ded = D(0), net = D(0), n = 0;
    for (const e of emps) {
      const settled = (await c.query("SELECT 1 FROM final_settlement WHERE employee_id = $1 AND status IN ('approved','paid') AND last_day < $2", [e.id, first(month)])).rowCount;
      if (settled) continue;
      const l = await calcEmployee(c, e, month, comps, prevRows[e.id], s, run.id);
      if (!l || l.gross.lte(0)) continue;
      await c.query(
        `INSERT INTO payroll_employee (run_id, branch_id, employee_id, period_start, period_end, paid_days, unpaid_days, leave_days, ot_hours, earnings, deductions, gross, total_deductions, net,
                                       wps_fixed, wps_variable, carried_forward, accrual_gratuity, accrual_leave, accrual_ticket, gratuity_liability, loan_balance, flags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [run.id, l.branch_id, l.employee_id, l.start, l.end, l.paid, l.unpaid, l.leave, l.ot, JSON.stringify(toFixed(l.earnings)), JSON.stringify(toFixed(l.deductions)),
          l.gross.toFixed(2), l.total.toFixed(2), l.net.toFixed(2), l.fixed.toFixed(2), l.variable.toFixed(2), l.carried.toFixed(2), l.accG.toFixed(2), l.accL.toFixed(2), l.accT.toFixed(2),
          l.liability.toFixed(2), l.loanBal.toFixed(2), JSON.stringify(l.flags)]);
      const total = Object.values(l.split).reduce((a, b) => a + b, 0);
      for (const [b, days] of Object.entries(l.split)) {
        await c.query("INSERT INTO payroll_branch_split (run_id, branch_id, employee_id, days, share) VALUES ($1,$2,$3,$4,$5)", [run.id, b, l.employee_id, days, (days / total).toFixed(6)]);
      }
      gross = gross.plus(l.gross); ded = ded.plus(l.total); net = net.plus(l.net); n++;
    }
    await c.query("UPDATE payroll_run SET employees = $2, gross = $3, deductions = $4, net = $5, calculated_by = $6, calculated_at = now() WHERE id = $1",
      [run.id, n, gross.toFixed(2), ded.toFixed(2), net.toFixed(2), ctx.userId]);
    await audit(c, ctx, "payroll_run", run.id, "calculate", { month, employees: n, net: net.toFixed(2) }, null);
    return { id: run.id as string, employees: n, net: net.toFixed(2) };
  });
}
const toFixed = (o: Record<string, Decimal>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toFixed(2)]));

async function lockRun(c: PoolClient, id: string) {
  const r = (await c.query("SELECT *, to_char(period_month,'YYYY-MM') AS month FROM payroll_run WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!r) throw notFound("Payroll run");
  return r;
}

/** Check done: send to the owner for approval. */
export async function submitRun(ctx: Ctx, id: string) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    const r = await lockRun(c, id);
    if (r.status !== "calculated") throw invalid("Only a calculated payroll can be sent for approval.");
    if (!r.employees) throw invalid("There is nobody in this payroll.");
    await c.query("UPDATE payroll_run SET status = 'pending_approval' WHERE id = $1", [id]);
    const sub = await submitForApproval(c, ctx, { docType: "payroll_run", docId: id, docRef: `Payroll ${r.month}`, branchId: await hqBranch(c), amount: r.net,
      summary: { month: r.month, employees: String(r.employees), gross: r.gross, deductions: r.deductions, net: r.net } });
    if (sub.status === "approved") await c.query("UPDATE payroll_run SET status = 'approved', approved_at = now() WHERE id = $1", [id]);
    await audit(c, ctx, "payroll_run", id, "submit", { month: r.month }, null);
    return sub.status;
  });
}
registerHandler("payroll_run", {
  onApproved: async (c, _ctx, req) => { await c.query("UPDATE payroll_run SET status = 'approved', approved_at = now() WHERE id = $1", [req.doc_id]); },
  onRejected: async (c, _ctx, req) => { await c.query("UPDATE payroll_run SET status = 'calculated' WHERE id = $1", [req.doc_id]); },
  onSentBack: async (c, _ctx, req) => { await c.query("UPDATE payroll_run SET status = 'calculated' WHERE id = $1", [req.doc_id]); },
});

/** Posts the approved payroll: cost per branch by working days, net payable, loan recoveries, deductions and accruals (PR-04, PR-10). */
export async function postRun(ctx: Ctx, id: string) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    const r = await lockRun(c, id);
    if (r.status !== "approved") throw invalid("Only an approved payroll can be posted.");
    const comps = Object.fromEntries((await components(c)).map((x) => [x.code, x]));
    const rows = (await c.query("SELECT * FROM payroll_employee WHERE run_id = $1", [id])).rows;
    const splits = (await c.query("SELECT * FROM payroll_branch_split WHERE run_id = $1", [id])).rows;
    const date = monthEnd(r.month) < today() ? monthEnd(r.month) : today();
    const byBranch: Record<string, PostLine[]> = {};
    const add = (b: string, l: PostLine) => { (byBranch[b] ??= []).push(l); };
    for (const pe of rows) {
      const parts = splits.filter((x) => x.employee_id === pe.employee_id).map((x) => ({ key: x.branch_id as string, days: Number(x.days) }));
      if (!parts.length) parts.push({ key: pe.branch_id, days: 1 });
      const share = (amt: Decimal.Value) => splitByDays(amt, parts);
      // Earnings are cost of the branches where the days were worked.
      for (const [code, amt] of Object.entries(pe.earnings as Record<string, string>)) {
        const acc = comps[code]?.account_id;
        for (const [b, v] of Object.entries(share(amt))) add(b, acc ? { accountId: acc, debit: v } : { event: code === "overtime" ? "overtime_expense" : "salary_expense", debit: v });
      }
      // Net to salaries payable, at the employee's branch (one payslip, one WPS line).
      add(pe.branch_id, { event: "salaries_payable", credit: pe.net, narration: `Net pay ${r.month}` });
      for (const [key, amt] of Object.entries(pe.deductions as Record<string, string>)) {
        if (key.startsWith("loan:")) {
          const loanId = key.slice(5);
          add(pe.branch_id, { event: "staff_advances", credit: amt, narration: "Loan recovery" });
          await c.query("INSERT INTO loan_recovery (branch_id, loan_id, run_id, amount) VALUES ($1,$2,$3,$4)", [pe.branch_id, loanId, id, amt]);
          await c.query("UPDATE loan SET recovered = recovered + $2, status = CASE WHEN recovered + $2 >= amount THEN 'closed' ELSE status END WHERE id = $1", [loanId, amt]);
        } else {
          // Fixed and disciplinary deductions reduce the salary cost.
          const acc = comps[key]?.account_id;
          add(pe.branch_id, acc ? { accountId: acc, credit: amt } : { event: "salary_expense", credit: amt, narration: "Salary deductions" });
        }
      }
      // Accruals, split like the cost.
      for (const [ev, prov, amt] of [["gratuity_expense", "gratuity_provision", pe.accrual_gratuity], ["leave_salary_expense", "leave_salary_provision", pe.accrual_leave], ["air_ticket_expense", "air_ticket_provision", pe.accrual_ticket]] as const) {
        const v = D(amt);
        if (v.isZero()) continue;
        for (const [b, x] of Object.entries(share(v.abs()))) {
          if (v.gt(0)) { add(b, { event: ev, debit: x }); add(b, { event: prov, credit: x }); }
          else { add(b, { event: prov, debit: x }); add(b, { event: ev, credit: x }); }
        }
      }
    }
    const ids: string[] = [];
    for (const [b, lines] of Object.entries(byBranch)) {
      // Cost and payable can sit in different branches when someone moved: the difference goes through inter-branch clearing.
      const dr = lines.reduce((t, l) => t.plus(l.debit ?? 0), D(0)), cr = lines.reduce((t, l) => t.plus(l.credit ?? 0), D(0));
      const diff = dr.minus(cr);
      if (!diff.isZero()) lines.push(diff.gt(0) ? { event: "interbranch", credit: diff } : { event: "interbranch", debit: diff.abs() });
      const j = await postJournal(c, ctx, { branchId: b, date, sourceType: "payroll_run", sourceId: id, narration: `Payroll ${r.month}`, lines: mergeLines(lines) });
      if (j) ids.push(j.id);
    }
    await c.query("UPDATE payroll_run SET status = 'posted', posted_by = $2, posted_at = now(), journal_ids = $3 WHERE id = $1", [id, ctx.userId, ids]);
    await audit(c, ctx, "payroll_run", id, "post", { month: r.month, journals: ids.length }, null);
  });
}
function mergeLines(lines: PostLine[]) {
  const m = new Map<string, PostLine & { debit: Decimal; credit: Decimal }>();
  for (const l of lines) {
    const k = `${l.event ?? ""}|${l.accountId ?? ""}`;
    const cur = m.get(k) ?? { ...l, debit: D(0), credit: D(0) };
    cur.debit = cur.debit.plus(l.debit ?? 0); cur.credit = cur.credit.plus(l.credit ?? 0);
    m.set(k, cur);
  }
  return [...m.values()].map((l) => { const net = l.debit.minus(l.credit); return { ...l, debit: net.gt(0) ? net : D(0), credit: net.lt(0) ? net.abs() : D(0) }; });
}

/** WPS salary file per agent (PR-03). */
export async function createWps(ctx: Ctx, id: string) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    const r = await lockRun(c, id);
    if (!["posted", "wps_created"].includes(r.status)) throw invalid("Post the payroll before creating the WPS file.");
    const est = String(await getSetting(c, "payroll.mohre_establishment_id", null, ""));
    if (!/^\d{13}$/.test(est)) throw invalid("Set the 13-digit MOHRE establishment ID under Settings (payroll.mohre_establishment_id) first.");
    const ref = String(await getSetting(c, "payroll.employer_reference", null, "SUPERFIX"));
    const rows = (await c.query(
      `SELECT pe.*, to_char(pe.period_start,'YYYY-MM-DD') ps, to_char(pe.period_end,'YYYY-MM-DD') pe2, e.mohre_person_code, e.iban, e.wps_card_no, e.pay_method, e.wps_agent_id, e.emp_no
         FROM payroll_employee pe JOIN employee e ON e.id = pe.employee_id WHERE pe.run_id = $1 AND pe.net > 0`, [id])).rows;
    const problems = rows.filter((x) => !x.mohre_person_code || !x.wps_agent_id || !(x.pay_method === "iban" ? x.iban : x.wps_card_no));
    if (problems.length) throw invalid(`Fix these employees first (person code, WPS agent and IBAN or card): ${problems.map((p) => p.emp_no).join(", ")}.`);
    const agents = [...new Set(rows.map((x) => x.wps_agent_id as string))];
    await c.query("DELETE FROM wps_file WHERE run_id = $1", [id]);
    const out = [];
    for (const a of agents) {
      const ag = (await c.query("SELECT * FROM wps_agent WHERE id = $1", [a])).rows[0];
      const emps: SifEmployee[] = rows.filter((x) => x.wps_agent_id === a).map((x) => ({
        personCode: x.mohre_person_code, routing: ag.routing_code, account: x.pay_method === "iban" ? x.iban : x.wps_card_no, start: x.ps, end: x.pe2,
        days: Math.round(Number(x.paid_days)), fixed: D(x.wps_fixed).toFixed(2), variable: D(x.wps_variable).toFixed(2), leaveDays: Math.round(Number(x.leave_days)),
      }));
      const sif = buildSif({ establishmentId: est, routing: ag.routing_code, month: r.month, employerRef: ref, at: new Date(), employees: emps });
      const f = await c.query("INSERT INTO wps_file (run_id, agent_id, file_name, content, records, total, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [id, a, sif.fileName, sif.content, emps.length, sif.total, ctx.userId]);
      out.push({ id: f.rows[0].id, fileName: sif.fileName, agent: ag.name, records: emps.length, total: sif.total });
    }
    await c.query("UPDATE payroll_run SET status = 'wps_created' WHERE id = $1", [id]);
    await audit(c, ctx, "payroll_run", id, "wps_file", { files: out.map((x) => x.fileName) }, null);
    return out;
  });
}
export async function wpsFile(ctx: Ctx, fileId: string) {
  assertSees(ctx);
  return withTx(ctx, async (c) => {
    const f = (await c.query("SELECT * FROM wps_file WHERE id = $1", [fileId])).rows[0];
    if (!f) throw notFound("WPS file");
    await audit(c, ctx, "payroll_run", f.run_id, "wps_download", { file: f.file_name }, null);
    return f as { file_name: string; content: string };
  });
}

/** Salaries paid by the bank: clears salaries payable against the bank account. */
export async function markPaid(ctx: Ctx, id: string, bankAccountId: string) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    const r = await lockRun(c, id);
    if (r.status !== "wps_created") throw invalid("Create the WPS file before marking the payroll paid.");
    const bank = (await c.query("SELECT * FROM bank_account WHERE id = $1 AND active", [bankAccountId])).rows[0];
    if (!bank) throw invalid("Bank account: choose the account the salaries were paid from.", { field: "bank_account_id" });
    const per = (await c.query("SELECT branch_id, sum(net) net FROM payroll_employee WHERE run_id = $1 GROUP BY branch_id", [id])).rows;
    const date = today();
    for (const p of per) {
      await postJournal(c, ctx, { branchId: p.branch_id, date, sourceType: "payroll_payment", sourceId: id, narration: `Salaries paid ${r.month}`,
        lines: [{ event: "salaries_payable", debit: p.net }, { accountId: bank.account_id, credit: p.net }] });
    }
    await c.query("UPDATE payroll_run SET status = 'paid', paid_by = $2, paid_at = now(), bank_account_id = $3 WHERE id = $1", [id, ctx.userId, bank.id]);
    await audit(c, ctx, "payroll_run", id, "paid", { bank: bank.name }, null);
  });
}

/** Owner only: reopens an approved or posted payroll before the WPS file goes; posted journals are reversed. */
export async function reopenRun(ctx: Ctx, id: string, reason: string) {
  if (!ctx.grants.some((g) => g.roleCode === "owner")) throw forbidden("Only the owner can reopen an approved payroll.");
  if (!str(reason)) throw invalid("Reason is required.", { field: "reason" });
  return withTx(ctx, async (c) => {
    const r = await lockRun(c, id);
    if (!["approved", "posted"].includes(r.status)) throw invalid("Only an approved or posted payroll can be reopened, before the WPS file is created.");
    if (r.status === "posted") {
      const js = (await c.query("SELECT j.id, j.branch_id FROM journal j WHERE j.source_type = 'payroll_run' AND j.source_id = $1", [id])).rows;
      for (const j of js) {
        const lines = (await c.query("SELECT account_id, debit, credit, branch_id FROM journal_line WHERE journal_id = $1", [j.id])).rows;
        await postJournal(c, ctx, { branchId: j.branch_id, date: today(), sourceType: "payroll_reversal", sourceId: id, narration: `Reversal: payroll ${r.month} reopened`,
          lines: lines.map((l) => ({ accountId: l.account_id, debit: l.credit, credit: l.debit, branchId: l.branch_id })) });
      }
      const rec = (await c.query("SELECT loan_id, amount FROM loan_recovery WHERE run_id = $1", [id])).rows;
      for (const x of rec) await c.query("UPDATE loan SET recovered = recovered - $2, status = 'approved' WHERE id = $1", [x.loan_id, x.amount]);
      await c.query("DELETE FROM loan_recovery WHERE run_id = $1", [id]);
    }
    await c.query("UPDATE payroll_run SET status = 'calculated', approved_at = NULL, posted_at = NULL, posted_by = NULL, journal_ids = NULL, reopened_by = $2, reopened_at = now(), reopen_reason = $3 WHERE id = $1",
      [id, ctx.userId, str(reason)]);
    await audit(c, ctx, "payroll_run", id, "reopen", { month: r.month, reason: str(reason), was: r.status }, null);
  });
}

export async function listRuns(ctx: Ctx) {
  assertSees(ctx);
  return withTx(ctx, async (c) => (await c.query("SELECT *, to_char(period_month,'YYYY-MM') AS month FROM payroll_run ORDER BY period_month DESC LIMIT 36")).rows);
}

/** The run with every employee, the change from last month (PR-15), branch splits and WPS files. */
export async function getRun(ctx: Ctx, month: string) {
  assertSees(ctx);
  if (!isMonth(month)) throw invalid("Choose the month.");
  return withTx(ctx, async (c) => {
    const run = (await c.query("SELECT *, to_char(period_month,'YYYY-MM') AS month FROM payroll_run WHERE period_month = $1", [first(month)])).rows[0] ?? null;
    if (!run) return { run: null, rows: [], comps: await components(c), files: [], branches: [] };
    const rows = (await c.query(
      `SELECT pe.*, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code, g.name_en designation,
              (SELECT p.net FROM payroll_employee p JOIN payroll_run pr ON pr.id = p.run_id WHERE p.employee_id = pe.employee_id AND pr.period_month = $2) prev_net,
              (SELECT string_agg(bb.code || ' ' || s.days, ', ' ORDER BY bb.code) FROM payroll_branch_split s JOIN branch bb ON bb.id = s.branch_id WHERE s.run_id = pe.run_id AND s.employee_id = pe.employee_id) split
         FROM payroll_employee pe JOIN employee e ON e.id = pe.employee_id JOIN branch b ON b.id = pe.branch_id LEFT JOIN designation g ON g.id = e.designation_id
        WHERE pe.run_id = $1 ORDER BY b.code, e.emp_no`, [run.id, first(prevMonth(month))])).rows;
    const files = (await c.query("SELECT f.id, f.file_name, f.records, f.total, f.created_at, a.name agent FROM wps_file f JOIN wps_agent a ON a.id = f.agent_id WHERE f.run_id = $1", [run.id])).rows;
    const banks = (await c.query("SELECT id, name FROM bank_account WHERE active ORDER BY name")).rows;
    return { run, rows, comps: await components(c), files, banks };
  });
}

/** Branch payroll register (PR-11): one column per component, branch subtotals. */
export async function register(ctx: Ctx, month: string) {
  const g = await getRun(ctx, month);
  if (!g.run) return { ...g, cols: [] as string[], groups: [] as { branch: string; rows: any[]; total: Record<string, number> }[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const used = new Set<string>();
  for (const r of g.rows) { Object.keys(r.earnings).forEach((k) => used.add(k)); Object.keys(r.deductions).forEach((k) => used.add(k.startsWith("loan:") ? "loans" : k.startsWith("disciplinary:") ? "disciplinary" : k)); }
  const order = [...g.comps.map((x) => x.code), "overtime", "disciplinary", "loans"];
  const cols = order.filter((k) => used.has(k));
  const val = (r: Record<string, any>, k: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (k === "loans") return Object.entries(r.deductions).filter(([x]) => x.startsWith("loan:")).reduce((t, [, v]) => t + Number(v), 0);
    if (k === "disciplinary") return Object.entries(r.deductions).filter(([x]) => x.startsWith("disciplinary:")).reduce((t, [, v]) => t + Number(v), 0);
    return Number(r.earnings[k] ?? r.deductions[k] ?? 0);
  };
  const groups: { branch: string; rows: any[]; total: Record<string, number> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const r of g.rows) {
    let gr = groups.find((x) => x.branch === r.branch_code);
    if (!gr) { gr = { branch: r.branch_code, rows: [], total: {} }; groups.push(gr); }
    const line = { ...r, cells: Object.fromEntries(cols.map((k) => [k, val(r, k)])) };
    gr.rows.push(line);
    for (const k of [...cols, "gross", "total_deductions", "net"]) gr.total[k] = (gr.total[k] ?? 0) + (k in line.cells ? line.cells[k] : Number(r[k]));
  }
  return { ...g, cols, groups };
}
export async function registerCsv(ctx: Ctx, month: string) {
  const r = await register(ctx, month);
  const names = Object.fromEntries(r.comps.map((x) => [x.code, x.name_en]));
  const head = ["Branch", "Emp no", "Name", "Paid days", ...r.cols.map((k) => names[k] ?? (k === "overtime" ? "Overtime" : k === "loans" ? "Loan recovery" : "Disciplinary")), "Gross", "Deductions", "Net"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const out = [head.map(q).join(",")];
  for (const g of r.groups) {
    for (const x of g.rows) out.push([g.branch, x.emp_no, x.full_name, x.paid_days, ...r.cols.map((k) => x.cells[k].toFixed(2)), x.gross, x.total_deductions, x.net].map(q).join(","));
    out.push([g.branch, "", "Branch total", "", ...r.cols.map((k) => g.total[k].toFixed(2)), g.total.gross.toFixed(2), g.total.total_deductions.toFixed(2), g.total.net.toFixed(2)].map(q).join(","));
  }
  await withTx(ctx, (c) => audit(c, ctx, "payroll_run", r.run?.id ?? null, "export_register", { month }, null));
  return out.join("\r\n");
}

/** Payslip (PR-07): the employee sees their own; HR and the owner see everyone's. */
export async function payslip(ctx: Ctx, month: string, employeeId?: string) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    const empId = employeeId || me?.id;
    if (!empId) throw invalid("Your user is not linked to an employee file.");
    const self = me?.id === empId;
    const row = (await c.query(
      `SELECT pe.*, pr.status run_status, to_char(pr.period_month,'YYYY-MM') AS month, e.emp_no, e.first_name || ' ' || e.last_name full_name, e.name_ar, e.iban, e.joining_date,
              b.name_en branch_name, g.name_en designation, d.name_en department
         FROM payroll_employee pe JOIN payroll_run pr ON pr.id = pe.run_id JOIN employee e ON e.id = pe.employee_id JOIN branch b ON b.id = pe.branch_id
         LEFT JOIN designation g ON g.id = e.designation_id LEFT JOIN department d ON d.id = e.department_id
        WHERE pr.period_month = $1 AND pe.employee_id = $2`, [first(month), empId])).rows[0];
    if (!row) throw notFound("Payslip");
    if (!self && !canSee(ctx, "salary", row.branch_id)) throw forbidden();
    // Employees see a payslip once the payroll is approved.
    if (self && !canSee(ctx, "salary", row.branch_id) && ["calculated", "pending_approval"].includes(row.run_status)) throw notFound("Payslip");
    const names = Object.fromEntries((await components(c)).map((x) => [x.code, { en: x.name_en, ar: (x as unknown as { name_ar: string }).name_ar }]));
    const loanNames = Object.fromEntries((await c.query("SELECT id, doc_no, kind FROM loan WHERE employee_id = $1", [empId])).rows.map((l) => [`loan:${l.id}`, `${l.kind === "loan" ? "Loan" : "Advance"} ${l.doc_no ?? ""}`]));
    const label = (k: string) => names[k]?.en ?? loanNames[k] ?? (k === "overtime" ? "Overtime" : k.startsWith("disciplinary:") ? "Disciplinary deduction" : k);
    const labelAr = (k: string) => names[k]?.ar ?? (k === "overtime" ? "العمل الإضافي" : k.startsWith("loan:") ? "قرض / سلفة" : k.startsWith("disciplinary:") ? "خصم تأديبي" : "");
    const balances = await leaveBalances(c, empId, monthEnd(month));
    if (!self) await audit(c, ctx, "employee", empId, "view_payslip", { month }, row.branch_id);
    return {
      slip: row,
      earnings: Object.entries(row.earnings as Record<string, string>).map(([k, v]) => ({ key: k, label: label(k), label_ar: labelAr(k), amount: v })),
      deductions: Object.entries(row.deductions as Record<string, string>).map(([k, v]) => ({ key: k, label: label(k), label_ar: labelAr(k), amount: v })),
      annual: balances.find((b) => b.accrual === "labour_law_annual")?.balance ?? null,
    };
  });
}
export async function myPayslips(ctx: Ctx) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    if (!me) return [];
    return (await c.query(
      `SELECT to_char(pr.period_month,'YYYY-MM') AS month, pe.net, pr.status FROM payroll_employee pe JOIN payroll_run pr ON pr.id = pe.run_id
        WHERE pe.employee_id = $1 AND pr.status IN ('approved','posted','wps_created','paid') ORDER BY pr.period_month DESC`, [me.id])).rows;
  });
}

// ---------------------------------------------------------------- final settlement (PR-05, PR-12)
export type SettlementInput = { employee_id: string; last_day: string; reason: string; notice_days?: string; other_deductions?: string; deduction_note?: string };
async function computeSettlement(c: PoolClient, f: SettlementInput) {
  const e = (await c.query("SELECT * FROM employee WHERE id = $1", [f.employee_id])).rows[0];
  if (!e) throw notFound("Employee");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f.last_day))) throw invalid("Last working day is required.", { field: "last_day" });
  if (f.last_day < e.joining_date) throw invalid("Last working day is before the joining date.", { field: "last_day" });
  if (!["resignation", "termination", "end_of_contract", "retirement", "death", "other"].includes(f.reason)) throw invalid("Reason for leaving: choose one.", { field: "reason" });
  const comps = await components(c);
  const s = await settingsFor(c);
  const struct = await structureAt(c, e.id, f.last_day);
  if (!struct.basic) throw invalid("This employee has no salary set.");
  const unpaidAll = Number((await c.query(
    `SELECT coalesce(sum(lr.days),0) n FROM leave_request lr JOIN leave_type lt ON lt.code = lr.leave_type WHERE lr.employee_id = $1 AND lr.status = 'approved' AND NOT lt.paid AND lr.from_date <= $2`,
    [e.id, f.last_day])).rows[0].n);
  const yrs = serviceYears(e.joining_date, f.last_day, unpaidAll);
  const basic = sumWhere(struct, comps, (x) => x.counts_gratuity);
  const grat = gratuity(basic, yrs, { divisor: 30, capMonths: Number(s.gratuity_cap_months ?? 24) });
  const bal = (await leaveBalances(c, e.id, f.last_day)).find((b) => b.accrual === "labour_law_annual");
  const unused = Decimal.max(D(bal?.balance ?? 0), D(0));
  const lsBase = sumWhere(struct, comps, (x) => x.counts_leave_salary);
  const leaveSalary = r2(unused.times(lsBase).div(30));
  // Salary for days of the last month not covered by an approved payroll.
  const lastMonth = f.last_day.slice(0, 7);
  const coveredRun = (await c.query("SELECT 1 FROM payroll_employee pe JOIN payroll_run pr ON pr.id = pe.run_id WHERE pe.employee_id = $1 AND pr.period_month = $2 AND pr.status <> 'calculated'", [e.id, first(lastMonth)])).rowCount;
  const gross = sumWhere(struct, comps, () => true);
  const from = e.joining_date > first(lastMonth) ? e.joining_date : first(lastMonth);
  const unpaidDays = coveredRun ? 0 : Math.min(30, daysBetween(from, f.last_day) + 1);
  const unpaidSalary = r2(gross.times(unpaidDays).div(30));
  const ticket = (await c.query("SELECT data FROM employee_record WHERE employee_id = $1 AND kind = 'air_ticket' AND status = 'active' ORDER BY created_at DESC LIMIT 1", [e.id])).rows[0]?.data;
  let air = D(0);
  if (ticket) {
    const cycle = Number(ticket.cycle_years || 1);
    const lastUsed = ticket.last_used || e.joining_date;
    if (serviceYears(lastUsed, f.last_day).gte(cycle)) air = D(ticket.ticket_amount || 0);
  }
  const notice = Math.max(0, Math.round(Number(str(f.notice_days) || 0)));
  if (notice > 90) throw invalid("Notice days cannot be more than 90.", { field: "notice_days" });
  const noticePay = r2(gross.times(notice).div(30));
  const loans = D((await c.query("SELECT coalesce(sum(amount - recovered),0) s FROM loan WHERE employee_id = $1 AND status = 'approved'", [e.id])).rows[0].s);
  let other = D(0);
  if (str(f.other_deductions)) {
    if (!/^\d+(\.\d{1,2})?$/.test(str(f.other_deductions))) throw invalid("Other deductions must be an amount.", { field: "other_deductions" });
    other = D(f.other_deductions!);
    if (other.gt(0) && !str(f.deduction_note)) throw invalid("Say what the other deductions are for.", { field: "deduction_note" });
  }
  const net = grat.plus(leaveSalary).plus(unpaidSalary).plus(air).plus(noticePay).minus(loans).minus(other);
  return { e, yrs, basic, grat, unused, leaveSalary, unpaidDays, unpaidSalary, air, notice, noticePay, loans, other, net };
}
export async function previewSettlement(ctx: Ctx, f: SettlementInput) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    const x = await computeSettlement(c, f);
    return { years: x.yrs.toFixed(4), basic: x.basic.toFixed(2), gratuity: x.grat.toFixed(2), unused: x.unused.toFixed(2), leaveSalary: x.leaveSalary.toFixed(2), unpaidDays: x.unpaidDays,
      unpaidSalary: x.unpaidSalary.toFixed(2), air: x.air.toFixed(2), notice: x.notice, noticePay: x.noticePay.toFixed(2), loans: x.loans.toFixed(2), other: x.other.toFixed(2), net: x.net.toFixed(2) };
  });
}
export async function createSettlement(ctx: Ctx, f: SettlementInput) {
  assertPayroll(ctx);
  return withTx(ctx, async (c) => {
    if ((await c.query("SELECT 1 FROM final_settlement WHERE employee_id = $1 AND status IN ('pending_approval','approved','paid')", [f.employee_id])).rowCount)
      throw invalid("A final settlement already exists for this employee.");
    const x = await computeSettlement(c, f);
    if (x.net.lt(0)) throw invalid(`Deductions are more than what is due (net AED ${x.net.toFixed(2)}). Reduce other deductions or recover the rest separately.`, { field: "other_deductions" });
    const r = await c.query(
      `INSERT INTO final_settlement (branch_id, employee_id, last_day, reason, contract_type, service_years, basic, gratuity, unused_leave_days, leave_salary, unpaid_days, unpaid_salary,
                                     air_ticket, notice_days, notice_pay, loans, other_deductions, deduction_note, net, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [x.e.branch_id, x.e.id, f.last_day, f.reason, x.e.contract_type, x.yrs.toFixed(4), x.basic.toFixed(2), x.grat.toFixed(2), x.unused.toFixed(2), x.leaveSalary.toFixed(2), x.unpaidDays,
        x.unpaidSalary.toFixed(2), x.air.toFixed(2), x.notice, x.noticePay.toFixed(2), x.loans.toFixed(2), x.other.toFixed(2), optStr(f.deduction_note), x.net.toFixed(2), ctx.userId]);
    const id = r.rows[0].id;
    const sub = await submitForApproval(c, ctx, { docType: "final_settlement", docId: id, docRef: `Final settlement ${x.e.emp_no} ${empName(x.e)}`, branchId: x.e.branch_id,
      amount: x.net.toFixed(2), subjectEmployeeId: x.e.id,
      summary: { employee: `${x.e.emp_no} ${empName(x.e)}`, last_day: f.last_day, gratuity: x.grat.toFixed(2), leave_salary: x.leaveSalary.toFixed(2), net: x.net.toFixed(2) } });
    if (sub.status === "approved") await approveSettlement(c, ctx, id);
    await audit(c, ctx, "employee", x.e.id, "final_settlement", { net: x.net.toFixed(2), last_day: f.last_day }, x.e.branch_id);
    return { id, status: sub.status };
  });
}
async function approveSettlement(c: PoolClient, ctx: Ctx, id: string) {
  const s = (await c.query("SELECT * FROM final_settlement WHERE id = $1 FOR UPDATE", [id])).rows[0];
  const docNo = await nextDocNo(c, s.branch_id, "final_settlement");
  // Loans still open are recovered from the settlement.
  const loans = (await c.query("SELECT id, amount - recovered left FROM loan WHERE employee_id = $1 AND status = 'approved' AND recovered < amount", [s.employee_id])).rows;
  for (const l of loans) {
    await c.query("INSERT INTO loan_recovery (branch_id, loan_id, settlement_id, amount) VALUES ($1,$2,$3,$4)", [s.branch_id, l.id, id, l.left]);
    await c.query("UPDATE loan SET recovered = amount, status = 'closed' WHERE id = $1", [l.id]);
  }
  const j = await postJournal(c, ctx, { branchId: s.branch_id, date: today(), sourceType: "final_settlement", sourceId: id, narration: `Final settlement ${docNo}`,
    lines: mergeLines([
      { event: "gratuity_provision", debit: s.gratuity }, { event: "leave_salary_provision", debit: s.leave_salary }, { event: "air_ticket_provision", debit: s.air_ticket },
      { event: "salary_expense", debit: D(s.unpaid_salary).plus(s.notice_pay) }, { event: "salary_expense", credit: s.other_deductions },
      { event: "staff_advances", credit: s.loans }, { event: "salaries_payable", credit: s.net },
    ]) });
  await c.query("UPDATE final_settlement SET status = 'approved', doc_no = $2, decided_at = now(), journal_id = $3 WHERE id = $1", [id, docNo, j?.id ?? null]);
  await c.query("UPDATE employee SET status = 'left', leaving_date = $2, leaving_reason = coalesce(leaving_reason, $3), updated_at = now(), version = version + 1 WHERE id = $1",
    [s.employee_id, s.last_day, s.reason]);
}
registerHandler("final_settlement", {
  onApproved: (c, ctx, req) => approveSettlement(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE final_settlement SET status = 'rejected', reject_reason = $2, decided_at = now() WHERE id = $1", [req.doc_id, comment]); },
});
export async function listSettlements(ctx: Ctx) {
  assertSees(ctx);
  return withTx(ctx, async (c) => (await c.query(
    `SELECT s.*, to_char(s.last_day,'YYYY-MM-DD') last_d, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code
       FROM final_settlement s JOIN employee e ON e.id = s.employee_id JOIN branch b ON b.id = s.branch_id ORDER BY s.created_at DESC`)).rows);
}
export async function getSettlement(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const s = (await c.query(
      `SELECT s.*, to_char(s.last_day,'YYYY-MM-DD') last_d, e.emp_no, e.first_name || ' ' || e.last_name full_name, e.name_ar, to_char(e.joining_date,'YYYY-MM-DD') joining_d,
              b.name_en branch_name, g.name_en designation
         FROM final_settlement s JOIN employee e ON e.id = s.employee_id JOIN branch b ON b.id = s.branch_id LEFT JOIN designation g ON g.id = e.designation_id WHERE s.id = $1`, [id])).rows[0];
    if (!s) throw notFound("Final settlement");
    if (!canSee(ctx, "salary", s.branch_id)) throw forbidden();
    return s;
  });
}

/** Liabilities for the reports (gratuity, leave salary, loans), from the latest run and open loans. */
export async function liabilities(ctx: Ctx) {
  assertSees(ctx);
  return withTx(ctx, async (c) => {
    const run = (await c.query("SELECT id, to_char(period_month,'YYYY-MM') AS month FROM payroll_run WHERE status IN ('approved','posted','wps_created','paid') ORDER BY period_month DESC LIMIT 1")).rows[0];
    const grat = run ? (await c.query("SELECT b.code, sum(pe.gratuity_liability) v FROM payroll_employee pe JOIN branch b ON b.id = pe.branch_id WHERE pe.run_id = $1 GROUP BY b.code ORDER BY b.code", [run.id])).rows : [];
    const loans = (await c.query("SELECT b.code, sum(l.amount - l.recovered) v FROM loan l JOIN branch b ON b.id = l.branch_id WHERE l.status = 'approved' GROUP BY b.code ORDER BY b.code")).rows;
    return { month: run?.month ?? null, gratuity: grat, loans };
  });
}
