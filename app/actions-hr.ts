"use server";
import { requireCtx } from "@/lib/session";
import { obj, run, withQ, keyed } from "@/lib/action-run";
import type { Upload } from "@/lib/services/purchasing";
import * as hr from "@/lib/services/hr";
import * as tm from "@/lib/services/hr-time";
import * as pay from "@/lib/services/payroll";
import * as pd from "@/lib/services/punch-devices";
import { AppError } from "@/lib/errors";

/** Server actions for Phase 5: HR (employee file, time, leave, letters, recruitment), self-service and payroll. */

const back = (fd: FormData, fallback: string) => String(fd.get("$back") || fallback);
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
async function upload(fd: FormData, k: string): Promise<Upload | undefined> {
  const f = fd.get(k);
  return f instanceof File && f.size ? { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) } : undefined;
}
async function uploads(fd: FormData) {
  const out: Record<string, Upload | undefined> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("cf_") && v instanceof File) out[k] = await upload(fd, k);
  return out;
}

// ---------------------------------------------------------------- employee file
export async function createEmployeeAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/employees/new", async () => {
    const r = await hr.createEmployee(ctx, obj(fd), await uploads(fd));
    return withQ(`/hr/employees/${r.id}?tab=salary`, "ok", `Employee ${r.empNo} added. Enter the salary next.`);
  });
}
export async function updateEmployeeAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "id");
  const files = await uploads(fd);
  await run(`/hr/employees/${id}?tab=details`, () => hr.updateEmployee(ctx, id, obj(fd), files), "Employee file saved");
}

export async function saveRecordAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "employee_id"), kind = s(fd, "kind");
  const file = await upload(fd, "file");
  await run(back(fd, `/hr/employees/${id}?tab=records`), () => hr.saveRecord(ctx, id, kind, obj(fd), file).then(() => undefined), "Saved to the employee file");
}
export async function closeRecordAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr"), () => hr.closeRecord(ctx, s(fd, "record_id"), s(fd, "note")), "Closed");
}
export async function tickChecklistAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr"), () => hr.tickChecklist(ctx, s(fd, "item_id"), s(fd, "done") === "true", s(fd, "note")), "Checklist updated");
}
export async function startLeavingAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "employee_id");
  await run(`/hr/employees/${id}?tab=checklist`, () => hr.startLeaving(ctx, id), "Leaving checklist started");
}
export async function transferAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr/transfers"), () => hr.transferEmployee(ctx, obj(fd) as never), "Transfer saved");
}

// ---------------------------------------------------------------- time and attendance
export async function manualPunchAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr/attendance"), () => tm.manualPunch(ctx, obj(fd) as never), "Punch added");
}
export async function importPunchesAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = fd.get("file");
  const text = f instanceof File && f.size ? await f.text() : s(fd, "text");
  await run("/hr/attendance", async () => {
    const r = await tm.importPunches(ctx, text, s(fd, "device_ref"));
    return withQ("/hr/attendance", r.errors.length ? "err" : "ok", `${r.added} punch(es) imported, ${r.skipped} already there${r.errors.length ? `. Not imported: ${r.errors.slice(0, 5).join("; ")}${r.errors.length > 5 ? ` and ${r.errors.length - 5} more` : ""}` : ""}`);
  });
}
export async function saveRosterAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr/roster"), async () => { await tm.saveRoster(ctx, s(fd, "branch_id"), keyed(fd, "cell")); }, "Roster saved");
}
export async function checkInAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/me"), async () => {
    const r = await tm.checkIn(ctx, obj(fd));
    return withQ(back(fd, "/me"), "ok", `Checked ${r.inOut} by ${r.source === "qr" ? "branch QR code" : `location (${r.distance} m from the branch)`}`);
  });
}

// ---------------------------------------------------------------- leave and overtime
export async function requestLeaveAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/me"), async () => {
    const r = await tm.requestLeave(ctx, obj(fd) as never);
    return withQ(back(fd, "/me"), "ok", `Leave ${r.docNo} for ${r.days} day(s) ${r.status === "approved" ? "approved" : "sent for approval"}`);
  });
}
export async function cancelLeaveAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/me"), () => tm.cancelLeave(ctx, s(fd, "id")), "Leave cancelled");
}
export async function adjustLeaveAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr/leave"), () => tm.adjustLeave(ctx, obj(fd) as never), "Leave balance adjusted");
}
export async function requestOvertimeAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr/overtime"), async () => {
    const r = await tm.requestOvertime(ctx, obj(fd) as never);
    return withQ(back(fd, "/hr/overtime"), "ok", r.status === "approved" ? "Overtime approved" : "Overtime sent for approval");
  });
}

// ---------------------------------------------------------------- letters and recruitment
export async function requestLetterAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/me"), async () => {
    const r = await hr.requestLetter(ctx, obj(fd) as never);
    return r.status === "approved" ? `/hr/letters/${r.id}?ok=Letter ready` : withQ(back(fd, "/me"), "ok", "Letter request sent for approval");
  });
}
export async function addOpeningAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/recruitment", () => hr.addOpening(ctx, obj(fd)), "Opening added");
}
export async function addApplicantAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/recruitment", () => hr.addApplicant(ctx, obj(fd)), "Applicant added");
}
export async function moveApplicantAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/recruitment", () => hr.moveApplicant(ctx, s(fd, "id"), obj(fd)), "Applicant updated");
}
export async function hireApplicantAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/recruitment", async () => {
    const r = await hr.hireApplicant(ctx, s(fd, "id"), obj(fd));
    return withQ(`/hr/employees/${r.id}?tab=details`, "ok", `Hired as ${r.empNo}. Complete the employee file.`);
  });
}

// ---------------------------------------------------------------- salary and loans
export async function openingSalaryAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "employee_id");
  await run(`/hr/employees/${id}?tab=salary`, () => pay.setOpeningSalary(ctx, id, keyed(fd, "amt"), s(fd, "effective_from")), "Salary saved");
}
export async function salaryRevisionAction(fd: FormData) {
  const ctx = await requireCtx();
  const emp = fd.getAll("l_employee").map(String), comp = fd.getAll("l_component").map(String), amt = fd.getAll("l_amount").map(String);
  const lines = emp.map((e, i) => ({ employee_id: e, component: comp[i] ?? "", amount: amt[i] ?? "" }));
  await run(back(fd, "/payroll/revisions"), async () => {
    const r = await pay.requestRevision(ctx, { effective_date: s(fd, "effective_date"), reason: s(fd, "reason"), lines });
    return withQ(back(fd, "/payroll/revisions"), "ok", r.status === "approved" ? "Salary updated" : "Salary update sent to the owner for approval");
  });
}
export async function requestLoanAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/payroll/loans"), async () => {
    const r = await pay.requestLoan(ctx, obj(fd) as never);
    return withQ(back(fd, "/payroll/loans"), "ok", r.status === "approved" ? "Approved and paid out" : "Sent for approval");
  });
}

// ---------------------------------------------------------------- the payroll run
export async function calculateRunAction(fd: FormData) {
  const ctx = await requireCtx();
  const month = s(fd, "month");
  await run(back(fd, "/payroll"), async () => {
    const r = await pay.calculateRun(ctx, month);
    return withQ(`/payroll/${month}`, "ok", `Calculated: ${r.employees} employees, net AED ${Number(r.net).toLocaleString("en-US", { minimumFractionDigits: 2 })}. Check the flagged lines, then send for approval.`);
  });
}
export async function runStepPayAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "id"), month = s(fd, "month"), step = s(fd, "step");
  const to = `/payroll/${month}`;
  await run(to, async () => {
    if (step === "submit") { const st = await pay.submitRun(ctx, id); return withQ(to, "ok", st === "approved" ? "Approved" : "Sent to the owner for approval"); }
    if (step === "post") { await pay.postRun(ctx, id); return withQ(to, "ok", "Posted to the accounts by branch"); }
    if (step === "wps") { const f = await pay.createWps(ctx, id); return withQ(to, "ok", `${f.length} WPS salary file(s) created. Download and upload them to each bank or exchange house.`); }
    if (step === "paid") { await pay.markPaid(ctx, id, s(fd, "bank_account_id")); return withQ(to, "ok", "Marked paid; salaries payable cleared against the bank"); }
    if (step === "reopen") { await pay.reopenRun(ctx, id, s(fd, "reason")); return withQ(to, "ok", "Reopened. Recalculate, check and send for approval again."); }
    throw new Error("unknown step");
  });
}
export async function settlementAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd) as unknown as pay.SettlementInput;
  const q = new URLSearchParams(Object.entries(obj(fd))).toString();
  if (s(fd, "$preview")) {
    await run(`/payroll/settlements/new?${q}`, async () => { await pay.previewSettlement(ctx, f); return `/payroll/settlements/new?${q}&preview=1`; });
  }
  await run(`/payroll/settlements/new?${q}`, async () => {
    const r = await pay.createSettlement(ctx, f);
    return withQ(`/payroll/settlements/${r.id}`, "ok", r.status === "approved" ? "Final settlement approved" : "Final settlement sent to the owner for approval");
  });
}

export async function startRenewalAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr"), () => hr.startRenewal(ctx, s(fd, "record_id"), s(fd, "note")), "Renewal started");
}

export async function renewedAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr"), () => hr.markRenewed(ctx, s(fd, "record_id"), s(fd, "new_expiry")), "Renewal recorded");
}

// ---------- punching machines (biometric sync) ----------

export async function addDeviceAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/machines", () => pd.addDevice(ctx, obj(fd) as never).then(() => undefined), "Machine added. Press New key and enter the key in the machine's sync settings.");
}
export async function deviceActiveAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/hr/machines", () => pd.setDeviceActive(ctx, s(fd, "device_id"), s(fd, "active") === "1"), "Saved");
}
/** Returns the new key to the page (shown once, never put in the address bar). */
export async function deviceKeyAction(_prev: { key?: string; err?: string; id?: string }, fd: FormData): Promise<{ key?: string; err?: string; id?: string }> {
  const ctx = await requireCtx();
  try { return { key: await pd.newDeviceKey(ctx, s(fd, "device_id")), id: s(fd, "device_id") }; }
  catch (e) { if (e instanceof AppError) return { err: e.message, id: s(fd, "device_id") }; throw e; }
}
export async function fixPunchAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/hr/attendance"), () => tm.manualPunch(ctx, { employee_id: s(fd, "employee_id"), date: s(fd, "date"), time: s(fd, "time"), note: s(fd, "note") || "Missing punch fixed by the manager" }), "Missing punch fixed");
}
