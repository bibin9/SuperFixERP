import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canAnywhere } from "../access";
import { withTx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { str, optStr } from "../validate";
import { D } from "../money";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { nextDocNo } from "./numbering";
import { submitForApproval, registerHandler } from "./workflow";
import { applyDueTransfers, empName, myEmployee, today } from "./hr";
import { addDays, annualLeaveEarned, daysBetween, distanceM, parseDate } from "./payroll-calc";

/** M13 time and leave: punches, mobile check-in, daily attendance, roster, leave and overtime (HR-03, HR-04, HR-11, HR-12, HR-13). */

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dow = (d: string) => parseDate(d).getUTCDay();
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------------------------------------------------------------- check-in (HR-11)
/** Today's code for a branch QR. It changes every day, so a photo of yesterday's code is refused. */
export const qrCode = (secret: string, day = today()) => crypto.createHmac("sha256", secret).update(day).digest("hex").slice(0, 10);

export async function checkIn(ctx: Ctx, f: { lat?: string; lng?: string; branch?: string; code?: string }) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    if (!me || me.status !== "active") throw forbidden("Your user is not linked to an employee file. Ask HR.");
    let source: "gps" | "qr", distance: number | null = null, lat: number | null = null, lng: number | null = null, ref: string | null = null;
    if (str(f.code)) {
      const b = (await c.query("SELECT id, code, qr_secret FROM branch WHERE code = $1 AND active", [str(f.branch)])).rows[0];
      if (!b || qrCode(b.qr_secret) !== str(f.code)) throw invalid("This QR code is not today's code for the branch. Scan the code on the branch screen again.");
      source = "qr"; ref = b.code;
    } else {
      lat = Number(f.lat); lng = Number(f.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !str(f.lat)) throw invalid("Your location is needed for check-in. Allow location in the browser, or scan the branch QR code.");
      const b = (await c.query("SELECT latitude, longitude FROM branch WHERE id = $1", [me.branch_id])).rows[0];
      if (b.latitude == null) throw invalid("The branch location is not set yet, so check in with the branch QR code.");
      const radius = await getSetting<number>(c, "hr.gps_radius_m", me.branch_id, 150);
      distance = distanceM(lat, lng, Number(b.latitude), Number(b.longitude));
      if (distance > radius) throw invalid(`You are not at the branch (${distance} m away; check-in works within ${radius} m).`);
      source = "gps";
    }
    const last = (await c.query("SELECT at FROM punch WHERE employee_id = $1 ORDER BY at DESC LIMIT 1", [me.id])).rows[0];
    if (last && Date.now() - new Date(last.at).getTime() < 60000) throw conflict("You have just checked in or out. Wait a minute before the next one.");
    await c.query("INSERT INTO punch (branch_id, employee_id, at, source, device_ref, latitude, longitude, distance_m, created_by) VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8)",
      [me.branch_id, me.id, source, ref, lat, lng, distance, ctx.userId]);
    const n = Number((await c.query("SELECT count(*) n FROM punch WHERE employee_id = $1 AND (at AT TIME ZONE 'Asia/Dubai')::date = $2", [me.id, today()])).rows[0].n);
    return { source, distance, inOut: n % 2 === 1 ? "in" : "out" };
  });
}

/** Branch screen for the QR code (needs HR or branch manager rights at that branch). */
export async function branchQr(ctx: Ctx, branchId: string) {
  if (!can(ctx, "hr", "approve", branchId) && !can(ctx, "hr", "edit", branchId)) throw forbidden();
  return withTx(ctx, async (c) => {
    const b = (await c.query("SELECT id, code, name_en, qr_secret FROM branch WHERE id = $1", [branchId])).rows[0];
    if (!b) throw notFound("Branch");
    return { code: b.code, name: b.name_en, today: today(), qr: qrCode(b.qr_secret) };
  });
}

// ---------------------------------------------------------------- punches from devices and by hand (HR-03)
/** Imports a biometric device export (ZKTeco and similar): employee no., date and time per line. Repeats are skipped. */
export async function importPunches(ctx: Ctx, text: string, deviceRef: string) {
  assertCan(ctx, "hr", "edit");
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw invalid("The file needs a header row and at least one punch.");
  if (lines.length > 20001) throw invalid("Import at most 20,000 punches at a time.");
  const head = lines[0].toLowerCase().split(/[,;\t]/).map((h) => h.replace(/[^a-z]/g, ""));
  const iEmp = head.findIndex((h) => ["employeeno", "empno", "employee", "userid", "acno", "badge"].includes(h));
  const iDT = head.findIndex((h) => ["datetime", "time", "checktime", "punchtime"].includes(h) && h !== "date");
  const iDate = head.indexOf("date"), iTime = head.indexOf("time");
  if (iEmp < 0 || (iDT < 0 && (iDate < 0 || iTime < 0))) throw invalid('The file needs an "Employee no" column and a "Date time" column (or "Date" and "Time").');
  return withTx(ctx, async (c) => {
    const emps = new Map((await c.query("SELECT id, emp_no, branch_id FROM employee")).rows.map((e) => [e.emp_no, e]));
    let added = 0, skipped = 0; const errors: string[] = [];
    for (const [i, l] of lines.slice(1).entries()) {
      const cells = l.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ""));
      const e = emps.get(cells[iEmp]);
      if (!e) { errors.push(`Line ${i + 2}: employee ${cells[iEmp]} not found`); continue; }
      let dt = iDT >= 0 && iDate < 0 ? cells[iDT] : `${cells[iDate]} ${cells[iTime]}`;
      const m = dt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.*)$/);
      if (m) dt = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${m[4]}`;
      if (!/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(dt)) { errors.push(`Line ${i + 2}: date and time "${dt}" not understood`); continue; }
      const r = await c.query("INSERT INTO punch (branch_id, employee_id, at, source, device_ref, created_by) VALUES ($1,$2,($3::timestamp AT TIME ZONE 'Asia/Dubai'),'device',$4,$5) ON CONFLICT (employee_id, at) DO NOTHING",
        [e.branch_id, e.id, dt.replace("T", " "), optStr(deviceRef), ctx.userId]);
      if (r.rowCount) added++; else skipped++;
    }
    await audit(c, ctx, "punch", null, "imported", { added, skipped, errors: errors.length, device: optStr(deviceRef) });
    return { added, skipped, errors };
  });
}

export async function manualPunch(ctx: Ctx, f: { employee_id: string; date: string; time: string; note: string }) {
  if (!isDate(f.date) || !/^\d{1,2}:\d{2}$/.test(f.time)) throw invalid("Enter the date and time.");
  if (!str(f.note)) throw invalid("Say why the punch is added by hand.");
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT id, branch_id FROM employee WHERE id = $1", [f.employee_id])).rows[0];
    if (!e) throw notFound("Employee");
    if (!can(ctx, "hr", "edit", e.branch_id) && !can(ctx, "hr", "approve", e.branch_id)) throw forbidden();
    if (`${f.date}` > today()) throw invalid("A punch cannot be in the future.");
    await c.query("INSERT INTO punch (branch_id, employee_id, at, source, note, created_by) VALUES ($1,$2,($3::timestamp AT TIME ZONE 'Asia/Dubai'),'manual',$4,$5)",
      [e.branch_id, e.id, `${f.date} ${f.time}`, str(f.note), ctx.userId]).catch((er) => { if (er.code === "23505") throw invalid("There is already a punch at that time."); throw er; });
    await audit(c, ctx, "punch", e.id, "manual", { at: `${f.date} ${f.time}`, note: str(f.note) }, e.branch_id);
  });
}

// ---------------------------------------------------------------- daily attendance
export type DayRow = { employee_id: string; emp_no: string; full_name: string; branch_code: string; date: string; status: string; first_in: string | null; last_out: string | null;
  worked_h: number; late_min: number; early_min: number; shift: string | null; punches: number; note: string };

/**
 * Attendance per employee and day: the shift comes from the roster, else the employee's shift; a
 * day off is the weekly off or a roster day without shift. Late and early are measured against the
 * shift times with its grace minutes; worked hours are first in to last out less the break.
 */
export async function attendanceDays(c: PoolClient, f: { from: string; to: string; branchId?: string | null; employeeId?: string | null }) {
  const p: unknown[] = [f.from, f.to]; const w: string[] = ["e.joining_date <= $2", "(e.leaving_date IS NULL OR e.leaving_date >= $1)"];
  if (f.branchId) { p.push(f.branchId); w.push(`e.branch_id = $${p.length}`); }
  if (f.employeeId) { p.push(f.employeeId); w.push(`e.id = $${p.length}`); }
  const emps = (await c.query(`SELECT e.id, e.emp_no, e.first_name, e.last_name, e.weekly_off, e.shift_id, to_char(e.joining_date,'YYYY-MM-DD') joining_date, to_char(e.leaving_date,'YYYY-MM-DD') leaving_date, b.code branch_code FROM employee e JOIN branch b ON b.id = e.branch_id WHERE ${w.join(" AND ")} ORDER BY b.code, e.emp_no`, p)).rows;
  if (!emps.length) return [] as DayRow[];
  const ids = emps.map((e) => e.id);
  const shifts = new Map((await c.query("SELECT id, code, to_char(start_time,'HH24:MI') st, to_char(end_time,'HH24:MI') et, break_minutes, grace_minutes, night FROM shift")).rows.map((s) => [s.id, s]));
  const defShift = (await c.query("SELECT id FROM shift WHERE active ORDER BY code LIMIT 1")).rows[0]?.id;
  const roster = new Map((await c.query("SELECT employee_id, to_char(work_date,'YYYY-MM-DD') d, shift_id FROM roster_day WHERE employee_id = ANY($1) AND work_date BETWEEN $2 AND $3", [ids, f.from, f.to])).rows.map((r) => [`${r.employee_id}:${r.d}`, r.shift_id]));
  const punches = (await c.query(`SELECT employee_id, to_char(at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') d, to_char(at AT TIME ZONE 'Asia/Dubai','HH24:MI') t FROM punch WHERE employee_id = ANY($1) AND (at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3 ORDER BY at`, [ids, f.from, f.to])).rows;
  const byDay = new Map<string, string[]>();
  for (const pu of punches) { const k = `${pu.employee_id}:${pu.d}`; byDay.set(k, [...(byDay.get(k) ?? []), pu.t]); }
  const leaves = (await c.query(`SELECT l.employee_id, to_char(l.from_date,'YYYY-MM-DD') f, to_char(l.to_date,'YYYY-MM-DD') t, lt.name_en, lt.paid FROM leave_request l JOIN leave_type lt ON lt.code = l.leave_type WHERE l.employee_id = ANY($1) AND l.status = 'approved' AND l.to_date >= $2 AND l.from_date <= $3`, [ids, f.from, f.to])).rows;
  const hols = new Map((await c.query("SELECT to_char(holiday_date,'YYYY-MM-DD') d, name FROM public_holiday WHERE active AND holiday_date BETWEEN $1 AND $2", [f.from, f.to])).rows.map((h) => [h.d, h.name]));
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: DayRow[] = [];
  const last = f.to > today() ? today() : f.to;
  for (const e of emps) {
    for (let d = f.from; d <= last; d = addDays(d, 1)) {
      if (d < e.joining_date || (e.leaving_date && d > e.leaving_date)) continue;
      const k = `${e.id}:${d}`, ps = byDay.get(k) ?? [];
      const rKey = roster.has(k);
      const shiftId = rKey ? roster.get(k) : (dow(d) === e.weekly_off ? null : e.shift_id ?? defShift);
      const sh = shiftId ? shifts.get(shiftId) : null;
      const lv = leaves.find((l) => l.employee_id === e.id && d >= l.f && d <= l.t);
      const row: DayRow = { employee_id: e.id, emp_no: e.emp_no, full_name: empName(e), branch_code: e.branch_code, date: d, status: "", first_in: ps[0] ?? null, last_out: ps.length > 1 ? ps[ps.length - 1] : null,
        worked_h: 0, late_min: 0, early_min: 0, shift: sh?.code ?? null, punches: ps.length, note: "" };
      if (ps.length > 1) row.worked_h = Math.max(0, Math.round(((mins(row.last_out!) - mins(row.first_in!) - (sh?.break_minutes ?? 0)) / 60) * 100) / 100);
      if (lv) { row.status = "leave"; row.note = lv.name_en; }
      else if (hols.has(d)) { row.status = ps.length ? "worked_holiday" : "holiday"; row.note = hols.get(d)!; }
      else if (!sh) { row.status = ps.length ? "worked_off_day" : "off"; }
      else if (!ps.length) { row.status = d === today() ? "not_in_yet" : "absent"; }
      else {
        row.late_min = Math.max(0, mins(row.first_in!) - mins(sh.st) - sh.grace_minutes);
        if (row.last_out && !sh.night) row.early_min = Math.max(0, mins(sh.et) - mins(row.last_out));
        row.status = ps.length === 1 && d !== today() ? "missing_out" : row.late_min ? "late" : row.early_min ? "early_leave" : "present";
      }
      out.push(row);
    }
  }
  return out;
}

export async function attendance(ctx: Ctx, f: { from: string; to: string; branchId?: string; employeeId?: string }) {
  if (!canAnywhere(ctx, "hr", "view")) throw forbidden();
  if (!isDate(f.from) || !isDate(f.to) || f.to < f.from) throw invalid("Choose the dates.");
  if (daysBetween(f.from, f.to) > 62) throw invalid("Show at most two months at a time.");
  return withTx(ctx, async (c) => { await applyDueTransfers(c, ctx); return attendanceDays(c, { from: f.from, to: f.to, branchId: f.branchId || null, employeeId: f.employeeId || null }); });
}

// ---------------------------------------------------------------- roster (HR-12)
export async function rosterWeek(ctx: Ctx, branchId: string, weekStart: string) {
  assertCan(ctx, "hr", "view", branchId);
  return withTx(ctx, async (c) => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const emps = (await c.query("SELECT id, emp_no, first_name, last_name, weekly_off, shift_id FROM employee WHERE branch_id = $1 AND status = 'active' ORDER BY emp_no", [branchId])).rows;
    const rows = (await c.query("SELECT employee_id, to_char(work_date,'YYYY-MM-DD') d, shift_id FROM roster_day WHERE branch_id = $1 AND work_date BETWEEN $2 AND $3", [branchId, days[0], days[6]])).rows;
    const shifts = (await c.query("SELECT id, code, name FROM shift WHERE active ORDER BY code")).rows;
    const hols = (await c.query("SELECT to_char(holiday_date,'YYYY-MM-DD') d, name FROM public_holiday WHERE active AND holiday_date BETWEEN $1 AND $2", [days[0], days[6]])).rows;
    const cell = (e: { id: string; weekly_off: number; shift_id: string | null }, d: string) => {
      const r = rows.find((x) => x.employee_id === e.id && x.d === d);
      if (r) return { value: r.shift_id ?? "off", planned: true };
      return { value: dow(d) === e.weekly_off ? "off" : e.shift_id ?? "", planned: false };
    };
    return { days, shifts, hols, emps: emps.map((e) => ({ ...e, full_name: empName(e), cells: days.map((d) => cell(e, d)) })) };
  });
}

export async function saveRoster(ctx: Ctx, branchId: string, cells: Record<string, string>) {
  if (!can(ctx, "hr", "edit", branchId) && !can(ctx, "hr", "approve", branchId)) throw forbidden("Only HR or the branch manager can plan the roster.");
  return withTx(ctx, async (c) => {
    let n = 0;
    for (const [k, v] of Object.entries(cells)) {
      const [empId, d] = k.split("|");
      if (!isDate(d)) continue;
      const e = (await c.query("SELECT id FROM employee WHERE id = $1 AND branch_id = $2", [empId, branchId])).rows[0];
      if (!e) continue;
      if (v === "") { await c.query("DELETE FROM roster_day WHERE employee_id = $1 AND work_date = $2", [empId, d]); continue; }
      await c.query("INSERT INTO roster_day (branch_id, employee_id, work_date, shift_id) VALUES ($1,$2,$3,$4) ON CONFLICT (employee_id, work_date) DO UPDATE SET shift_id = EXCLUDED.shift_id, branch_id = EXCLUDED.branch_id",
        [branchId, empId, d, v === "off" ? null : v]);
      n++;
    }
    await audit(c, ctx, "roster", null, "saved", { cells: n }, branchId);
    return n;
  });
}

export async function myRoster(c: PoolClient, emp: { id: string; weekly_off: number; shift_id: string | null }) {
  const from = today(), days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const rows = (await c.query("SELECT to_char(r.work_date,'YYYY-MM-DD') d, s.code, s.name, to_char(s.start_time,'HH24:MI') st, to_char(s.end_time,'HH24:MI') et, r.shift_id FROM roster_day r LEFT JOIN shift s ON s.id = r.shift_id WHERE r.employee_id = $1 AND r.work_date BETWEEN $2 AND $3", [emp.id, days[0], days[6]])).rows;
  const def = emp.shift_id ? (await c.query("SELECT code, name, to_char(start_time,'HH24:MI') st, to_char(end_time,'HH24:MI') et FROM shift WHERE id = $1", [emp.shift_id])).rows[0] : null;
  return days.map((d) => {
    const r = rows.find((x) => x.d === d);
    if (r) return { d, label: r.shift_id ? `${r.name} ${r.st}–${r.et}` : "Day off" };
    return { d, label: dow(d) === emp.weekly_off ? "Day off" : def ? `${def.name} ${def.st}–${def.et}` : "Not planned" };
  });
}

// ---------------------------------------------------------------- leave (HR-04)
/** Leave days for a request: calendar days, less public holidays when the setting says so. */
export async function leaveDays(c: PoolClient, from: string, to: string) {
  const all = daysBetween(from, to) + 1;
  const skipHol = await getSetting<boolean>(c, "hr.leave_excludes_holidays", null, true);
  if (!skipHol) return all;
  const h = Number((await c.query("SELECT count(*) n FROM public_holiday WHERE active AND holiday_date BETWEEN $1 AND $2", [from, to])).rows[0].n);
  return all - h;
}

export type Balance = { code: string; name: string; accrual: string; paid: boolean; earned: string; adjusted: string; taken: string; pending: string; balance: string | null };
/** Leave balances: annual leave by FSD 5.5 from the joining date; other types per calendar year; unpaid has no limit. */
export async function leaveBalances(c: PoolClient, employeeId: string, asOf = today()) {
  const e = (await c.query("SELECT id, to_char(joining_date,'YYYY-MM-DD') joining_date FROM employee WHERE id = $1", [employeeId])).rows[0];
  if (!e) throw notFound("Employee");
  const types = (await c.query("SELECT * FROM leave_type WHERE active ORDER BY sort")).rows;
  const yearStart = `${asOf.slice(0, 4)}-01-01`, yearEnd = `${asOf.slice(0, 4)}-12-31`;
  const out: Balance[] = [];
  for (const t of types) {
    const ranged = t.accrual === "yearly";
    const p = ranged ? [employeeId, t.code, yearStart, yearEnd] : [employeeId, t.code, "1900-01-01", "2999-12-31"];
    const taken = D((await c.query("SELECT coalesce(sum(days),0) s FROM leave_request WHERE employee_id = $1 AND leave_type = $2 AND status = 'approved' AND from_date BETWEEN $3 AND $4", p)).rows[0].s);
    const pending = D((await c.query("SELECT coalesce(sum(days),0) s FROM leave_request WHERE employee_id = $1 AND leave_type = $2 AND status = 'pending_approval' AND from_date BETWEEN $3 AND $4", p)).rows[0].s);
    const adjusted = D((await c.query("SELECT coalesce(sum(days),0) s FROM leave_adjustment WHERE employee_id = $1 AND leave_type = $2 AND adj_date BETWEEN $3 AND $4", p)).rows[0].s);
    const earned = t.accrual === "labour_law_annual" ? annualLeaveEarned(e.joining_date, asOf) : D(t.entitlement_days);
    const balance = t.accrual === "none" ? null : earned.plus(adjusted).minus(taken).minus(pending).toFixed(2);
    out.push({ code: t.code, name: t.name_en, accrual: t.accrual, paid: t.paid, earned: earned.toFixed(2), adjusted: adjusted.toFixed(2), taken: taken.toFixed(2), pending: pending.toFixed(2), balance });
  }
  return out;
}

export async function requestLeave(ctx: Ctx, f: { employee_id?: string; leave_type: string; from_date: string; to_date: string; reason: string }) {
  if (!isDate(f.from_date) || !isDate(f.to_date)) throw invalid("Choose the leave dates.");
  if (f.to_date < f.from_date) throw invalid("The leave ends before it starts.");
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    const empId = str(f.employee_id) || me?.id;
    if (!empId) throw invalid("Your user is not linked to an employee file. Ask HR.");
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [empId])).rows[0];
    if (!e) throw notFound("Employee");
    if (e.id !== me?.id) assertCan(ctx, "hr", "create", e.branch_id);
    if (e.status !== "active") throw invalid("This employee has left.");
    const t = (await c.query("SELECT * FROM leave_type WHERE code = $1 AND active", [f.leave_type])).rows[0];
    if (!t) throw invalid("Choose the leave type.");
    if (f.from_date < String(e.joining_date)) throw invalid("Leave cannot start before the joining date.");
    const overlap = (await c.query("SELECT doc_no FROM leave_request WHERE employee_id = $1 AND status IN ('pending_approval','approved') AND from_date <= $3 AND to_date >= $2", [e.id, f.from_date, f.to_date])).rows[0];
    if (overlap) throw conflict(`These dates overlap leave ${overlap.doc_no}.`);
    const days = await leaveDays(c, f.from_date, f.to_date);
    if (days <= 0) throw invalid("These dates are all public holidays.");
    // Balance check (FSD 4.13 rule 4): refused below zero, except unpaid leave or types that allow it.
    if (t.accrual !== "none" && !t.allow_negative) {
      const bal = (await leaveBalances(c, e.id, t.accrual === "yearly" ? f.from_date : f.to_date)).find((b) => b.code === t.code)!;
      if (D(bal.balance!).lt(days)) throw invalid(`Not enough ${t.name_en.toLowerCase()}: ${days} day(s) asked, ${D(bal.balance!).toFixed(1)} available.`);
    }
    if (t.code === "annual" && (await getSetting<boolean>(c, "hr.annual_needs_six_months", null, true)) && annualLeaveEarned(String(e.joining_date), f.from_date).eq(0) && !t.allow_negative)
      throw invalid("Annual leave starts after six months of service.");
    const docNo = await nextDocNo(c, e.branch_id, "leave_request");
    const r = await c.query("INSERT INTO leave_request (branch_id, doc_no, employee_id, leave_type, from_date, to_date, days, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [e.branch_id, docNo, e.id, t.code, f.from_date, f.to_date, days, optStr(f.reason), ctx.userId]);
    const id = r.rows[0].id;
    const sub = await submitForApproval(c, ctx, { docType: "leave_request", docId: id, docRef: docNo, branchId: e.branch_id, subjectEmployeeId: e.id,
      summary: { employee: `${e.emp_no} ${empName(e)}`, leave: t.name_en, from: f.from_date, to: f.to_date, days } });
    if (sub.status === "approved") await c.query("UPDATE leave_request SET status = 'approved', decided_at = now() WHERE id = $1", [id]);
    return { id, docNo, days, status: sub.status };
  });
}

registerHandler("leave_request", {
  onApproved: async (c, _ctx, req) => { await c.query("UPDATE leave_request SET status = 'approved', decided_at = now() WHERE id = $1", [req.doc_id]); },
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE leave_request SET status = 'rejected', reject_reason = $2, decided_at = now() WHERE id = $1", [req.doc_id, comment]); },
});

export async function cancelLeave(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const l = (await c.query("SELECT l.*, e.user_id FROM leave_request l JOIN employee e ON e.id = l.employee_id WHERE l.id = $1 FOR UPDATE", [id])).rows[0];
    if (!l) throw notFound("Leave request");
    if (l.user_id !== ctx.userId) assertCan(ctx, "hr", "edit", l.branch_id);
    if (!["pending_approval", "approved"].includes(l.status)) throw invalid("This leave cannot be cancelled.");
    if (l.status === "approved" && String(l.from_date) <= today() && !can(ctx, "hr", "edit", l.branch_id)) throw invalid("Leave that has started can only be changed by HR.");
    if ((await c.query("SELECT 1 FROM payroll_employee pe JOIN payroll_run r ON r.id = pe.run_id WHERE pe.employee_id = $1 AND r.status <> 'calculated' AND pe.period_end >= $2 AND pe.period_start <= $3", [l.employee_id, l.from_date, l.to_date])).rowCount)
      throw invalid("Payroll for this leave is already approved. Ask HR to correct it in the next payroll.");
    await c.query("UPDATE leave_request SET status = 'cancelled', decided_at = now() WHERE id = $1", [id]);
    await c.query("UPDATE approval_request SET status = 'cancelled', decided_at = now() WHERE doc_type = 'leave_request' AND doc_id = $1 AND status = 'pending'", [id]);
    await audit(c, ctx, "leave_request", id, "cancelled", { doc_no: l.doc_no }, l.branch_id);
  });
}

export async function adjustLeave(ctx: Ctx, f: { employee_id: string; leave_type: string; days: string; reason: string; adj_date?: string }) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(str(f.days)) || Number(f.days) === 0) throw invalid("Enter the days to add (or minus to take off).");
  if (!str(f.reason)) throw invalid("Say why the balance changes (for example: opening balance from Tally).");
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT id, branch_id FROM employee WHERE id = $1", [f.employee_id])).rows[0];
    if (!e) throw notFound("Employee");
    assertCan(ctx, "hr", "edit", e.branch_id);
    await c.query("INSERT INTO leave_adjustment (branch_id, employee_id, leave_type, adj_date, days, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [e.branch_id, e.id, f.leave_type, str(f.adj_date) || today(), f.days, str(f.reason), ctx.userId]);
    await audit(c, ctx, "employee", e.id, "leave_adjusted", { leave_type: f.leave_type, days: f.days, reason: f.reason }, e.branch_id);
  });
}

export async function listLeave(ctx: Ctx, f: { status?: string; employeeId?: string; mine?: boolean }) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    if (!f.mine) assertCan(ctx, "hr", "view");
    const p: unknown[] = []; const w = ["true"];
    if (f.mine) { p.push(me?.id ?? "00000000-0000-0000-0000-000000000000"); w.push(`l.employee_id = $${p.length}`); }
    if (f.employeeId) { p.push(f.employeeId); w.push(`l.employee_id = $${p.length}`); }
    if (f.status) { p.push(f.status); w.push(`l.status = $${p.length}`); }
    return (await c.query(
      `SELECT l.*, to_char(l.from_date,'YYYY-MM-DD') from_d, to_char(l.to_date,'YYYY-MM-DD') to_d, lt.name_en leave_name, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code
         FROM leave_request l JOIN leave_type lt ON lt.code = l.leave_type JOIN employee e ON e.id = l.employee_id JOIN branch b ON b.id = l.branch_id
        WHERE ${w.join(" AND ")} ORDER BY l.from_date DESC LIMIT 300`, p)).rows;
  });
}

// ---------------------------------------------------------------- overtime (HR-13)
export async function requestOvertime(ctx: Ctx, f: { employee_id?: string; work_date: string; hours: string; ot_type: string; reason: string }) {
  if (!isDate(f.work_date)) throw invalid("Choose the date worked.");
  if (!/^\d+(\.\d{1,2})?$/.test(str(f.hours)) || Number(f.hours) <= 0 || Number(f.hours) > 12) throw invalid("Hours must be more than 0 and at most 12.");
  if (!["normal", "night", "rest_day", "holiday"].includes(f.ot_type)) throw invalid("Choose the overtime type.");
  if (!str(f.reason)) throw invalid("Say what the overtime was for.");
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    const empId = str(f.employee_id) || me?.id;
    if (!empId) throw invalid("Your user is not linked to an employee file. Ask HR.");
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [empId])).rows[0];
    if (!e) throw notFound("Employee");
    if (e.id !== me?.id && !can(ctx, "hr", "create", e.branch_id) && !can(ctx, "hr", "approve", e.branch_id)) throw forbidden();
    if (f.work_date > today()) throw invalid("Overtime is requested for a day already worked.");
    if ((await c.query("SELECT 1 FROM payroll_run WHERE period_month = date_trunc('month', $1::date) AND status <> 'calculated'", [f.work_date])).rowCount)
      throw invalid("Payroll for that month is already approved; add it to next month's overtime.");
    const r = await c.query("INSERT INTO overtime_request (branch_id, employee_id, work_date, hours, ot_type, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [e.branch_id, e.id, f.work_date, f.hours, f.ot_type, str(f.reason), ctx.userId]);
    const id = r.rows[0].id;
    const sub = await submitForApproval(c, ctx, { docType: "overtime_request", docId: id, docRef: `OT ${e.emp_no} ${f.work_date}`, branchId: e.branch_id, subjectEmployeeId: e.id,
      summary: { employee: `${e.emp_no} ${empName(e)}`, date: f.work_date, hours: f.hours, type: f.ot_type } });
    if (sub.status === "approved") await c.query("UPDATE overtime_request SET status = 'approved' WHERE id = $1", [id]);
    return { id, status: sub.status };
  });
}
registerHandler("overtime_request", {
  onApproved: async (c, _ctx, req) => { await c.query("UPDATE overtime_request SET status = 'approved' WHERE id = $1", [req.doc_id]); },
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE overtime_request SET status = 'rejected', reject_reason = $2 WHERE id = $1", [req.doc_id, comment]); },
});

export async function listOvertime(ctx: Ctx, f: { mine?: boolean; month?: string }) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    if (!f.mine) assertCan(ctx, "hr", "view");
    const p: unknown[] = []; const w = ["true"];
    if (f.mine) { p.push(me?.id ?? "00000000-0000-0000-0000-000000000000"); w.push(`o.employee_id = $${p.length}`); }
    if (f.month) { p.push(`${f.month}-01`); w.push(`date_trunc('month', o.work_date) = $${p.length}::date`); }
    return (await c.query(
      `SELECT o.*, to_char(o.work_date,'YYYY-MM-DD') work_d, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code
         FROM overtime_request o JOIN employee e ON e.id = o.employee_id JOIN branch b ON b.id = o.branch_id WHERE ${w.join(" AND ")} ORDER BY o.work_date DESC LIMIT 300`, p)).rows;
  });
}
