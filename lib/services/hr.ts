import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canAnywhere, canSee, fieldLevel, roleAt } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { str, optStr } from "../validate";
import { audit, diff } from "./audit";
import { getSetting } from "./settings";
import { nextDocNo } from "./numbering";
import { submitForApproval, registerHandler, history } from "./workflow";
import { RECORD_KINDS, recordKind } from "./hr-records";
import { saveAttachment, type Upload } from "./purchasing";
import { addDays, daysBetween } from "./payroll-calc";

/** M13 HR (FSD 4.13): employee file, custom fields, records, checklists, transfers, organisation, letters, recruitment, dashboard. */

export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const optDate = (v: unknown, label: string, field?: string) => { const s = str(v); if (!s) return null; if (!isDate(s)) throw invalid(`${label} is not a valid date.`, { field }); return s; };
const reqDate = (v: unknown, label: string, field?: string) => { const s = optDate(v, label, field); if (!s) throw invalid(`${label} is required.`, { field }); return s; };
export const empName = (e: { first_name?: string; last_name?: string } | Record<string, any>) => `${e.first_name} ${e.last_name}`.trim();

/** HR staff: create and edit employee files. Branch managers see their own branches' staff without salaries. */
export const isHr = (ctx: Ctx, b?: string | null) => can(ctx, "hr", "edit", b);

export async function myEmployee(c: PoolClient, ctx: Ctx) {
  return (await c.query(
    `SELECT e.*, b.code branch_code, b.name_en branch_name, d.name_en department, g.name_en designation, lm.first_name || ' ' || lm.last_name line_manager
       FROM employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN department d ON d.id = e.department_id
       LEFT JOIN designation g ON g.id = e.designation_id LEFT JOIN employee lm ON lm.id = e.line_manager_id
      WHERE e.user_id = $1`, [ctx.userId])).rows[0] ?? null;
}

/** Applies transfers whose effective date has arrived (HR-05). Runs whenever HR or payroll screens load. */
export async function applyDueTransfers(c: PoolClient, ctx: Ctx | null) {
  const due = (await c.query("SELECT * FROM staff_transfer WHERE NOT applied AND effective_date <= $1 ORDER BY effective_date", [today()])).rows;
  for (const t of due) {
    await c.query("UPDATE employee SET branch_id = $2, updated_at = now(), version = version + 1 WHERE id = $1", [t.employee_id, t.to_branch_id]);
    await c.query("UPDATE staff_transfer SET applied = true WHERE id = $1", [t.id]);
    await audit(c, ctx, "employee", t.employee_id, "transferred", { from_branch_id: t.from_branch_id, to_branch_id: t.to_branch_id, effective_date: t.effective_date }, t.to_branch_id);
  }
}

// ---------------------------------------------------------------- custom fields (HR-06)
export type CustomField = { id: string; code: string; label: string; field_type: string; options: string | null; required: boolean; tab: string; hidden_roles: string; sort: number };
export async function customFields(c: PoolClient) {
  return (await c.query("SELECT * FROM custom_field WHERE active ORDER BY tab, sort, label")).rows as CustomField[];
}
/** A custom field is hidden from the roles listed on it (role codes, comma separated). */
export function cfVisible(ctx: Ctx, f: CustomField, branchId?: string | null) {
  const role = roleAt(ctx, branchId)?.roleCode ?? "";
  return !f.hidden_roles.split(",").map((s) => s.trim()).filter(Boolean).includes(role);
}
function cfValue(f: CustomField, raw: unknown) {
  const s = str(raw);
  if (!s) { if (f.required) throw invalid(`${f.label} is required.`, { field: `cf_${f.code}` }); return null; }
  switch (f.field_type) {
    case "number": if (!/^-?\d+(\.\d+)?$/.test(s)) throw invalid(`${f.label} must be a number.`, { field: `cf_${f.code}` }); return s;
    case "date": if (!isDate(s)) throw invalid(`${f.label} is not a valid date.`, { field: `cf_${f.code}` }); return s;
    case "dropdown": { const opts = (f.options ?? "").split(",").map((x) => x.trim()).filter(Boolean); if (!opts.includes(s)) throw invalid(`${f.label}: choose one of ${opts.join(", ")}.`, { field: `cf_${f.code}` }); return s; }
    case "yes_no": if (!["yes", "no"].includes(s)) throw invalid(`${f.label}: choose yes or no.`, { field: `cf_${f.code}` }); return s;
    default: return s.slice(0, 500);
  }
}

// ---------------------------------------------------------------- employees (HR-01)
export type EmployeeFilter = { q?: string; branch?: string; department?: string; status?: string; cf?: string; cfv?: string };
export async function listEmployees(ctx: Ctx, f: EmployeeFilter = {}) {
  assertCan(ctx, "hr", "view", undefined);
  return withTx(ctx, async (c) => {
    await applyDueTransfers(c, ctx);
    const where = ["true"], p: unknown[] = [];
    if (f.q) { p.push(`%${f.q}%`); where.push(`(e.first_name || ' ' || e.last_name ILIKE $${p.length} OR e.emp_no ILIKE $${p.length} OR coalesce(e.mobile,'') ILIKE $${p.length})`); }
    if (f.branch) { p.push(f.branch); where.push(`e.branch_id = $${p.length}`); }
    if (f.department) { p.push(f.department); where.push(`e.department_id = $${p.length}`); }
    p.push(f.status || "active"); where.push(`e.status = $${p.length}`);
    // Filter by a custom field (HR-06: custom fields are usable in filters).
    if (f.cf && f.cfv) {
      const field = (await customFields(c)).find((x) => x.code === f.cf && cfVisible(ctx, x));
      if (field) { p.push(field.code, f.cfv); where.push(`e.custom ->> $${p.length - 1} ILIKE '%' || $${p.length} || '%'`); }
    }
    return (await c.query(
      `SELECT e.id, e.emp_no, e.first_name, e.last_name, e.nationality, e.joining_date, e.status, e.custom, e.user_id, e.probation_end, e.contract_end,
              b.code branch_code, d.name_en department, g.name_en designation, lm.first_name || ' ' || lm.last_name line_manager
         FROM employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN department d ON d.id = e.department_id
         LEFT JOIN designation g ON g.id = e.designation_id LEFT JOIN employee lm ON lm.id = e.line_manager_id
        WHERE ${where.join(" AND ")} ORDER BY b.code, e.emp_no LIMIT 500`, p)).rows;
  });
}

export async function employeeOptions(c: PoolClient) {
  return (await c.query(`SELECT e.id, e.emp_no, e.first_name || ' ' || e.last_name full_name, e.branch_id, b.code branch_code FROM employee e JOIN branch b ON b.id = e.branch_id WHERE e.status = 'active' ORDER BY e.emp_no`)).rows;
}

export async function hrLookups(ctx: Ctx) {
  return withTx(ctx, async (c) => {
    const q = async (sql: string) => (await c.query(sql)).rows;
    return {
      departments: await q("SELECT id, name_en FROM department WHERE active ORDER BY name_en"),
      designations: await q("SELECT id, name_en FROM designation WHERE active ORDER BY name_en"),
      agents: await q("SELECT id, name FROM wps_agent WHERE active ORDER BY name"),
      shifts: await q("SELECT id, code, name, to_char(start_time,'HH24:MI') start_time, to_char(end_time,'HH24:MI') end_time FROM shift WHERE active ORDER BY code"),
      countries: await q("SELECT code, name FROM country WHERE active ORDER BY name"),
      grades: await q("SELECT code, name_en FROM lookup_value WHERE list = 'grade' AND active ORDER BY sort"),
      branches: (await c.query("SELECT id, code, name_en FROM branch WHERE active AND id = ANY($1) ORDER BY code", [ctx.branchIds])).rows,
      managers: await employeeOptions(c),
      users: await q("SELECT u.id, u.username, u.full_name FROM app_user u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.user_id = u.id) ORDER BY u.username"),
      leaveTypes: await q("SELECT * FROM leave_type WHERE active ORDER BY sort"),
      letterTemplates: await q("SELECT code, name_en, shows_salary FROM letter_template WHERE active ORDER BY name_en"),
      customFields: (await customFields(c)).filter((f) => cfVisible(ctx, f)),
    };
  });
}

const EMP_FIELDS = ["first_name", "last_name", "name_ar", "nationality", "date_of_birth", "gender", "marital_status", "mobile", "email", "emergency_contact",
  "department_id", "designation_id", "grade", "line_manager_id", "joining_date", "contract_type", "contract_end", "probation_end", "mohre_person_code",
  "labour_card_no", "wps_agent_id", "pay_method", "iban", "wps_card_no", "shift_id", "weekly_off", "user_id"] as const;

/** `fromHire`: a hired applicant or an imported employee starts as a partial file that HR completes; the full-file checks apply on the next save. */
function cleanEmployee(f: Record<string, unknown>, fromHire = false) {
  const o: Record<string, unknown> = {};
  o.first_name = str(f.first_name); o.last_name = str(f.last_name);
  if (!o.first_name) throw invalid("First name is required.", { field: "first_name" });
  if (!o.last_name) throw invalid("Last name is required.", { field: "last_name" });
  o.name_ar = optStr(f.name_ar);
  o.nationality = str(f.nationality); if (!o.nationality) throw invalid("Nationality is required.", { field: "nationality" });
  o.date_of_birth = fromHire ? optDate(f.date_of_birth, "Date of birth", "date_of_birth") : reqDate(f.date_of_birth, "Date of birth", "date_of_birth");
  o.gender = optStr(f.gender); if (!fromHire && !o.gender) throw invalid("Gender is required.", { field: "gender" });
  o.marital_status = optStr(f.marital_status);
  o.mobile = optStr(f.mobile); if (!fromHire && !o.mobile) throw invalid("Mobile is required.", { field: "mobile" });
  o.email = optStr(f.email); o.emergency_contact = optStr(f.emergency_contact);
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(o.email))) throw invalid("Email is not valid.", { field: "email" });
  o.department_id = optStr(f.department_id); o.designation_id = optStr(f.designation_id);
  if (!fromHire && !o.department_id) throw invalid("Department is required.", { field: "department_id" });
  if (!fromHire && !o.designation_id) throw invalid("Designation is required.", { field: "designation_id" }); o.grade = optStr(f.grade);
  o.line_manager_id = optStr(f.line_manager_id);
  o.joining_date = reqDate(f.joining_date, "Joining date", "joining_date");
  o.contract_type = str(f.contract_type) || "limited";
  o.contract_end = optDate(f.contract_end, "Contract end", "contract_end");
  o.probation_end = optDate(f.probation_end, "Probation end", "probation_end");
  if (o.contract_end && String(o.contract_end) < String(o.joining_date)) throw invalid("Contract end cannot be before the joining date.", { field: "contract_end" });
  if (o.probation_end && String(o.probation_end) < String(o.joining_date)) throw invalid("Probation end cannot be before the joining date.", { field: "probation_end" });
  if (o.probation_end && daysBetween(String(o.joining_date), String(o.probation_end)) > 183) throw invalid("Probation can be at most six months (UAE Labour Law).", { field: "probation_end" });
  o.mohre_person_code = optStr(f.mohre_person_code);
  if (o.mohre_person_code && !/^\d{14}$/.test(String(o.mohre_person_code))) throw invalid("MOHRE person code must be 14 digits.", { field: "mohre_person_code" });
  o.labour_card_no = optStr(f.labour_card_no);
  o.wps_agent_id = optStr(f.wps_agent_id);
  if (o.wps_agent_id && !o.mohre_person_code) throw invalid("MOHRE person code is required for WPS.", { field: "mohre_person_code" });
  if (o.wps_agent_id && !o.labour_card_no) throw invalid("Labour card no. is required for WPS.", { field: "labour_card_no" });
  o.pay_method = str(f.pay_method) || "iban";
  o.iban = optStr(String(f.iban ?? "").replace(/\s/g, "").toUpperCase());
  if (o.iban && !/^AE\d{21}$/.test(String(o.iban))) throw invalid("IBAN must be AE followed by 21 digits.", { field: "iban" });
  o.wps_card_no = optStr(f.wps_card_no);
  if (o.pay_method === "iban" && !o.iban && o.wps_agent_id) throw invalid("Enter the IBAN, or choose payment by WPS card.", { field: "iban" });
  if (o.pay_method === "wps_card" && !o.wps_card_no) throw invalid("Enter the WPS card number.", { field: "wps_card_no" });
  o.shift_id = optStr(f.shift_id);
  o.weekly_off = str(f.weekly_off) === "" ? 5 : Number(f.weekly_off);
  o.user_id = optStr(f.user_id);
  return o;
}

async function readCustom(c: PoolClient, ctx: Ctx, f: Record<string, unknown>, branchId: string, before: Record<string, unknown>, files: Record<string, Upload | undefined>) {
  const out: Record<string, unknown> = { ...before };
  for (const cf of await customFields(c)) {
    if (!cfVisible(ctx, cf, branchId)) continue;          // hidden from this role: keep the stored value
    if (cf.field_type === "attachment") {
      const file = files[`cf_${cf.code}`];
      if (file && file.bytes.length) out[cf.code] = await saveAttachment(c, ctx, branchId, "employee_custom", null, file);
      else if (cf.required && !out[cf.code]) throw invalid(`${cf.label} is required.`);
      continue;
    }
    out[cf.code] = cfValue(cf, f[`cf_${cf.code}`]);
  }
  return out;
}

export async function createEmployee(ctx: Ctx, f: Record<string, unknown>, files: Record<string, Upload | undefined> = {}, fromHire = false) {
  const branchId = str(f.branch_id);
  if (!branchId) throw invalid("Choose the branch.", { field: "branch_id" });
  assertCan(ctx, "hr", "create", branchId);
  const o = cleanEmployee(f, fromHire);
  return withTx(ctx, async (c) => {
    const custom = await readCustom(c, ctx, f, branchId, {}, files);
    const empNo = str(f.emp_no) || `SF-${(await c.query("SELECT nextval('employee_no_seq') n")).rows[0].n}`;
    const cols = [...EMP_FIELDS], vals = cols.map((k) => o[k]);
    const r = await c.query(
      `INSERT INTO employee (branch_id, emp_no, custom, created_by, updated_by, ${cols.join(",")}) VALUES ($1,$2,$3,$4,$4,${cols.map((_, i) => `$${i + 5}`).join(",")}) RETURNING id`,
      [branchId, empNo, JSON.stringify(custom), ctx.userId, ...vals],
    ).catch((e) => { if (e.code === "23505") throw invalid(/emp_no/.test(e.detail ?? e.message) ? "That employee number is already used." : "That user is already linked to another employee."); throw e; });
    const id = r.rows[0].id;
    // Joining checklist from the template (HR-15).
    await c.query(`INSERT INTO employee_checklist (branch_id, employee_id, kind, item, sort) SELECT $1, $2, 'joining', item, sort FROM checklist_template WHERE kind = 'joining' AND active`, [branchId, id]);
    await audit(c, ctx, "employee", id, "created", { emp_no: empNo, ...o }, branchId);
    return { id, empNo };
  });
}

export async function updateEmployee(ctx: Ctx, id: string, f: Record<string, unknown>, files: Record<string, Upload | undefined> = {}) {
  return withTx(ctx, async (c) => {
    const before = (await c.query("SELECT * FROM employee WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!before) throw notFound("Employee");
    if (!isHr(ctx, before.branch_id)) throw forbidden("Only HR can change the employee file.");
    if (Number(f.version) && Number(f.version) !== before.version) throw invalid("Someone else changed this employee. Reload to see their change.");
    // Bank details are not on the form for roles that cannot see them: keep what is stored.
    const o = cleanEmployee({ ...f, iban: f.iban ?? before.iban, wps_card_no: f.wps_card_no ?? before.wps_card_no });
    if (o.line_manager_id === id) throw invalid("An employee cannot report to themselves.", { field: "line_manager_id" });
    if (o.line_manager_id) {
      // No loops in the reporting line.
      const loop = (await c.query(`WITH RECURSIVE up AS (SELECT id, line_manager_id FROM employee WHERE id = $1 UNION SELECT e.id, e.line_manager_id FROM employee e JOIN up ON e.id = up.line_manager_id) SELECT 1 FROM up WHERE id = $2`, [o.line_manager_id, id])).rowCount;
      if (loop) throw invalid("That line manager reports to this employee; choose someone else.", { field: "line_manager_id" });
    }
    const custom = await readCustom(c, ctx, f, before.branch_id, before.custom ?? {}, files);
    const cols = [...EMP_FIELDS];
    await c.query(`UPDATE employee SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, custom = $${cols.length + 2}, updated_by = $${cols.length + 3}, updated_at = now(), version = version + 1 WHERE id = $1`,
      [id, ...cols.map((k) => o[k]), JSON.stringify(custom), ctx.userId])
      .catch((e) => { if (e.code === "23505") throw invalid("That user is already linked to another employee."); throw e; });
    const ch = diff(before, { ...before, ...o, custom });
    if (Object.keys(ch).length) await audit(c, ctx, "employee", id, "updated", ch, before.branch_id);
  });
}

export async function getEmployee(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    await applyDueTransfers(c, ctx);
    const e = (await c.query(
      `SELECT e.*, b.code branch_code, b.name_en branch_name, d.name_en department, g.name_en designation, w.name wps_agent,
              lm.first_name || ' ' || lm.last_name line_manager, s.name shift_name, u.username, co.name nationality_name
         FROM employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN department d ON d.id = e.department_id
         LEFT JOIN designation g ON g.id = e.designation_id LEFT JOIN employee lm ON lm.id = e.line_manager_id
         LEFT JOIN wps_agent w ON w.id = e.wps_agent_id LEFT JOIN shift s ON s.id = e.shift_id LEFT JOIN app_user u ON u.id = e.user_id
         LEFT JOIN country co ON co.code = e.nationality
        WHERE e.id = $1`, [id])).rows[0];
    if (!e) throw notFound("Employee");
    const self = e.user_id === ctx.userId;
    if (!self) assertCan(ctx, "hr", "view", e.branch_id);
    const cfs = (await customFields(c)).filter((f) => cfVisible(ctx, f, e.branch_id));
    const custom: Record<string, unknown> = {};
    for (const f of cfs) custom[f.code] = e.custom?.[f.code] ?? null;
    const records = (await c.query(
      `SELECT r.*, u.full_name created_by_name FROM employee_record r LEFT JOIN app_user u ON u.id = r.created_by WHERE r.employee_id = $1 ORDER BY r.kind, r.status, r.created_at DESC`, [id])).rows;
    const lookups = (await c.query("SELECT list, code, name_en FROM lookup_value WHERE list IN ('hr_document_type','insurance_category','hr_asset_type')")).rows;
    for (const r of records) {
      const k = recordKind(r.kind);
      for (const fd of k?.fields ?? []) {
        if (fd.lookup) r.data[`${fd.name}_label`] = lookups.find((l) => l.list === fd.lookup && l.code === r.data[fd.name])?.name_en ?? r.data[fd.name];
        if (fd.options) r.data[`${fd.name}_label`] = fd.options.find((o) => o[0] === r.data[fd.name])?.[1] ?? r.data[fd.name];
      }
    }
    const checklist = (await c.query("SELECT ch.*, u.full_name done_by_name FROM employee_checklist ch LEFT JOIN app_user u ON u.id = ch.done_by WHERE ch.employee_id = $1 ORDER BY kind, sort, item", [id])).rows;
    const transfers = (await c.query(`SELECT t.*, fb.code from_code, tb.code to_code FROM staff_transfer t JOIN branch fb ON fb.id = t.from_branch_id JOIN branch tb ON tb.id = t.to_branch_id WHERE t.employee_id = $1 ORDER BY effective_date DESC`, [id])).rows;
    const hist = (await c.query(`SELECT a.at, a.action, a.changes, u.full_name FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id WHERE a.entity = 'employee' AND a.entity_id = $1 ORDER BY a.at DESC LIMIT 50`, [id])).rows;
    const team = (await c.query("SELECT id, emp_no, first_name, last_name FROM employee WHERE line_manager_id = $1 AND status = 'active' ORDER BY emp_no", [id])).rows;
    const lists = lookups;
    const salaryVisible = self || canSee(ctx, "salary", e.branch_id);
    // Salary changes in the history follow the salary field permission too.
    if (!salaryVisible) for (const h of hist) if (["opening_salary", "salary_revision", "final_settlement", "view_payslip"].includes(h.action)) h.changes = null;
      else if (h.changes) { delete h.changes.iban; delete h.changes.wps_card_no; }
    const { custom: _raw, ...rest } = e;
    void _raw;
    // Bank details are salary-sensitive: shown to HR, the owner and the employee only.
    if (!salaryVisible) { rest.iban = null; rest.wps_card_no = null; }
    return { employee: rest, custom, customFields: cfs, records, checklist, transfers, history: hist, team, lists, self, salaryVisible, canEdit: isHr(ctx, e.branch_id) };
  });
}

// ---------------------------------------------------------------- records on the file
export async function saveRecord(ctx: Ctx, employeeId: string, kind: string, f: Record<string, unknown>, file?: Upload) {
  const k = recordKind(kind);
  if (!k) throw invalid("Choose what to record.");
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT id, branch_id FROM employee WHERE id = $1", [employeeId])).rows[0];
    if (!e) throw notFound("Employee");
    const managerReview = kind === "review" && can(ctx, "hr", "approve", e.branch_id);
    if (!can(ctx, "hr", "create", e.branch_id) && !managerReview) throw forbidden("Only HR can add this to the employee file.");
    const data: Record<string, string> = {}; let expiry: string | null = null, amount: string | null = null, month: string | null = null;
    for (const fd of k.fields) {
      let v = str(f[fd.name]);
      if (!v) { if (fd.required) throw invalid(`${fd.label} is required.`, { field: fd.name }); continue; }
      if (fd.type === "date" && !isDate(v)) throw invalid(`${fd.label} is not a valid date.`, { field: fd.name });
      if (fd.type === "month") { if (!/^\d{4}-\d{2}$/.test(v)) throw invalid(`${fd.label} is not a valid month.`, { field: fd.name }); v = `${v}-01`; }
      if (fd.type === "number") { if (!/^\d+(\.\d{1,2})?$/.test(v)) throw invalid(`${fd.label} must be an amount.`, { field: fd.name }); }
      if (fd.options && !fd.options.some((o) => o[0] === v)) throw invalid(`${fd.label}: choose from the list.`, { field: fd.name });
      data[fd.name] = v;
      if (fd.role === "expiry") expiry = v;
      if (fd.role === "amount") amount = v;
      if (fd.role === "month") month = v;
    }
    if (kind === "disciplinary" && amount && Number(amount) > 0 && !month) throw invalid("Choose the month to deduct in.", { field: "deduct_month" });
    if (kind === "insurance" && expiry && data.start_date && expiry < data.start_date) throw invalid("Expiry is before the start date.", { field: "expiry_date" });
    if (kind === "air_ticket") await c.query("UPDATE employee_record SET status = 'closed', updated_at = now() WHERE employee_id = $1 AND kind = 'air_ticket' AND status = 'active'", [employeeId]);
    const att = file && file.bytes.length ? await saveAttachment(c, ctx, e.branch_id, `employee_${kind}`, employeeId, file) : null;
    const r = await c.query(
      `INSERT INTO employee_record (branch_id, employee_id, kind, data, expiry_date, amount, deduct_month, attachment_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
      [e.branch_id, employeeId, kind, JSON.stringify(data), expiry, amount, month, att, ctx.userId]);
    await audit(c, ctx, "employee", employeeId, `${kind}_added`, data, e.branch_id);
    return r.rows[0].id as string;
  });
}

export async function closeRecord(ctx: Ctx, recordId: string, note: string) {
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT * FROM employee_record WHERE id = $1 FOR UPDATE", [recordId])).rows[0];
    if (!r) throw notFound("Record");
    assertCan(ctx, "hr", "edit", r.branch_id);
    if (r.status !== "active") throw invalid("This record is already closed.");
    const data = { ...r.data, closed_note: str(note), closed_on: today() };
    await c.query("UPDATE employee_record SET status = 'closed', data = $2, updated_by = $3, updated_at = now() WHERE id = $1", [recordId, JSON.stringify(data), ctx.userId]);
    await audit(c, ctx, "employee", r.employee_id, `${r.kind}_closed`, { note: str(note) }, r.branch_id);
  });
}

export async function tickChecklist(ctx: Ctx, itemId: string, done: boolean, note: string) {
  return withTx(ctx, async (c) => {
    const it = (await c.query("SELECT * FROM employee_checklist WHERE id = $1", [itemId])).rows[0];
    if (!it) throw notFound("Checklist item");
    assertCan(ctx, "hr", "edit", it.branch_id);
    await c.query("UPDATE employee_checklist SET done = $2, done_by = CASE WHEN $2 THEN $3::uuid END, done_at = CASE WHEN $2 THEN now() END, note = $4 WHERE id = $1", [itemId, done, ctx.userId, optStr(note)]);
  });
}

/** Starts the leaving checklist; unreturned company assets are listed on it (HR-15, HR-17). */
export async function startLeaving(ctx: Ctx, employeeId: string) {
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [employeeId])).rows[0];
    if (!e) throw notFound("Employee");
    assertCan(ctx, "hr", "edit", e.branch_id);
    if ((await c.query("SELECT 1 FROM employee_checklist WHERE employee_id = $1 AND kind = 'leaving'", [employeeId])).rowCount) throw invalid("The leaving checklist is already started.");
    await c.query(`INSERT INTO employee_checklist (branch_id, employee_id, kind, item, sort) SELECT $1, $2, 'leaving', item, sort FROM checklist_template WHERE kind = 'leaving' AND active`, [e.branch_id, employeeId]);
    const assets = (await c.query("SELECT data FROM employee_record WHERE employee_id = $1 AND kind = 'asset' AND status = 'active'", [employeeId])).rows;
    for (const [i, a] of assets.entries()) await c.query("INSERT INTO employee_checklist (branch_id, employee_id, kind, item, sort) VALUES ($1,$2,'leaving',$3,$4)", [e.branch_id, employeeId, `Return ${a.data.asset_name}${a.data.serial ? ` (${a.data.serial})` : ""}`, 100 + i]);
  });
}

// ---------------------------------------------------------------- transfers (HR-05)
export async function transferEmployee(ctx: Ctx, f: { employee_id: string; to_branch_id: string; effective_date: string; reason: string }) {
  const eff = reqDate(f.effective_date, "Effective date", "effective_date");
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [f.employee_id])).rows[0];
    if (!e) throw notFound("Employee");
    assertCan(ctx, "hr", "edit", e.branch_id);
    assertCan(ctx, "hr", "edit", f.to_branch_id);
    if (e.status !== "active") throw invalid("Only an active employee can be transferred.");
    // The branch the employee is at on the effective date (a later transfer may already be planned).
    const last = (await c.query("SELECT to_branch_id FROM staff_transfer WHERE employee_id = $1 AND effective_date < $2 ORDER BY effective_date DESC LIMIT 1", [e.id, eff])).rows[0];
    const from = last?.to_branch_id ?? ((await c.query("SELECT from_branch_id FROM staff_transfer WHERE employee_id = $1 ORDER BY effective_date LIMIT 1", [e.id])).rows[0]?.from_branch_id ?? e.branch_id);
    if (from === f.to_branch_id) throw invalid("The employee is already at that branch on that date.", { field: "to_branch_id" });
    if (eff < String(e.joining_date)) throw invalid("The transfer cannot be before the joining date.");
    if ((await c.query("SELECT 1 FROM payroll_employee pe JOIN payroll_run r ON r.id = pe.run_id WHERE pe.employee_id = $1 AND r.status <> 'calculated' AND pe.period_end >= $2", [e.id, eff])).rowCount)
      throw invalid("Payroll for that month is already approved. Use a date in an open payroll month.");
    await c.query("INSERT INTO staff_transfer (branch_id, employee_id, from_branch_id, to_branch_id, effective_date, reason, created_by) VALUES ($1,$2,$3,$1,$4,$5,$6)",
      [f.to_branch_id, e.id, from, eff, optStr(f.reason), ctx.userId]).catch((er) => { if (er.code === "23505") throw invalid("There is already a transfer on that date."); throw er; });
    await audit(c, ctx, "employee", e.id, "transfer_planned", { from_branch_id: from, to_branch_id: f.to_branch_id, effective_date: eff }, e.branch_id);
    await applyDueTransfers(c, ctx);
  });
}

export async function listTransfers(ctx: Ctx) {
  assertCan(ctx, "hr", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT t.*, e.emp_no, e.first_name || ' ' || e.last_name full_name, fb.code from_code, tb.code to_code, u.full_name created_by_name
       FROM staff_transfer t JOIN employee e ON e.id = t.employee_id JOIN branch fb ON fb.id = t.from_branch_id JOIN branch tb ON tb.id = t.to_branch_id
       LEFT JOIN app_user u ON u.id = t.created_by ORDER BY t.effective_date DESC LIMIT 200`)).rows);
}

/** Branch on each day of a period from the transfer history (PR-04). */
export async function branchDays(c: PoolClient, employeeId: string, currentBranch: string, from: string, to: string) {
  const ts = (await c.query("SELECT from_branch_id, to_branch_id, to_char(effective_date,'YYYY-MM-DD') eff FROM staff_transfer WHERE employee_id = $1 ORDER BY effective_date", [employeeId])).rows;
  const days: Record<string, number> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let b = ts.length ? ts[0].from_branch_id : currentBranch;
    for (const t of ts) if (t.eff <= d) b = t.to_branch_id;
    days[b] = (days[b] ?? 0) + 1;
  }
  return days;
}

// ---------------------------------------------------------------- organisation (HR-14)
export async function orgChart(ctx: Ctx) {
  assertCan(ctx, "hr", "view");
  return withTx(ctx, async (c) => {
    const emps = (await c.query(
      `SELECT e.id, e.emp_no, e.first_name || ' ' || e.last_name full_name, e.line_manager_id, b.code branch_code, d.name_en department, g.name_en designation
         FROM employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN department d ON d.id = e.department_id LEFT JOIN designation g ON g.id = e.designation_id
        WHERE e.status = 'active' ORDER BY e.emp_no`)).rows;
    const depts = (await c.query(`SELECT d.name_en, count(e.id)::int n, h.first_name || ' ' || h.last_name head FROM department d LEFT JOIN employee e ON e.department_id = d.id AND e.status = 'active' LEFT JOIN employee h ON h.id = d.head_employee_id WHERE d.active GROUP BY d.id, h.id ORDER BY d.name_en`)).rows;
    return { emps, depts };
  });
}

// ---------------------------------------------------------------- alerts and dashboard (HR-02, HR-07, HR-15, HR-22)
export async function hrAlerts(c: PoolClient) {
  const days = await getSetting<number[]>(c, "hr.document_alert_days", null, [60, 30, 7]);
  const maxDays = Math.max(...days, 0);
  const contractDays = await getSetting<number>(c, "hr.contract_alert_days", null, 30);
  const t = today();
  const docs = (await c.query(
    `SELECT r.id, r.kind, r.data, to_char(r.expiry_date,'YYYY-MM-DD') expiry_date, (r.expiry_date - $1::date) days_left, e.id employee_id, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code,
            lv.name_en doc_label
       FROM employee_record r JOIN employee e ON e.id = r.employee_id JOIN branch b ON b.id = e.branch_id
       LEFT JOIN lookup_value lv ON lv.list = 'hr_document_type' AND lv.code = r.data->>'doc_type'
      WHERE r.status = 'active' AND e.status = 'active' AND r.expiry_date IS NOT NULL AND r.expiry_date <= $1::date + $2::int
      ORDER BY r.expiry_date`, [t, maxDays])).rows.map((r) => {
    const left = Number(r.days_left);
    const band = left < 0 ? "Expired" : `Within ${[...days].sort((a, b) => a - b).find((d) => left <= d)} days`;
    const what = r.kind === "document" ? r.doc_label ?? r.data.doc_type : (RECORD_KINDS.find((k) => k.kind === r.kind)?.title ?? r.kind);
    return { ...r, what, band };
  });
  const people = (await c.query(
    `SELECT e.id employee_id, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code,
            CASE WHEN e.probation_end BETWEEN $1::date AND $1::date + $2::int THEN 'Probation ends' ELSE 'Contract ends' END what,
            to_char(CASE WHEN e.probation_end BETWEEN $1::date AND $1::date + $2::int THEN e.probation_end ELSE e.contract_end END,'YYYY-MM-DD') on_date
       FROM employee e JOIN branch b ON b.id = e.branch_id
      WHERE e.status = 'active' AND (e.probation_end BETWEEN $1::date AND $1::date + $2::int OR e.contract_end BETWEEN $1::date AND $1::date + $2::int)
      ORDER BY 6`, [t, contractDays])).rows;
  return { docs, people };
}

export async function hrDashboard(ctx: Ctx) {
  assertCan(ctx, "hr", "view");
  return withTx(ctx, async (c) => {
    await applyDueTransfers(c, ctx);
    const t = today(), yearStart = `${t.slice(0, 4)}-01-01`, monthStart = `${t.slice(0, 7)}-01`;
    const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
    const byBranch = await q(`SELECT b.code, b.name_en, count(*)::int n FROM employee e JOIN branch b ON b.id = e.branch_id WHERE e.status = 'active' GROUP BY b.id ORDER BY b.code`);
    const byNationality = await q(`SELECT co.name, count(*)::int n FROM employee e JOIN country co ON co.code = e.nationality WHERE e.status = 'active' GROUP BY co.name ORDER BY 2 DESC, 1`);
    const headcount = byBranch.reduce((s, r) => s + r.n, 0);
    const joiners = await q(`SELECT e.id, e.emp_no, e.first_name || ' ' || e.last_name full_name, to_char(e.joining_date,'YYYY-MM-DD') on_date, b.code branch_code FROM employee e JOIN branch b ON b.id = e.branch_id WHERE e.joining_date >= $1 ORDER BY e.joining_date DESC`, [yearStart]);
    const leavers = await q(`SELECT e.id, e.emp_no, e.first_name || ' ' || e.last_name full_name, to_char(e.leaving_date,'YYYY-MM-DD') on_date, e.leaving_reason, b.code branch_code FROM employee e JOIN branch b ON b.id = e.branch_id WHERE e.status = 'left' AND e.leaving_date >= $1 ORDER BY e.leaving_date DESC`, [yearStart]);
    // Turnover = leavers this year / average of headcount at the start of the year and now.
    const atStart = Number((await q(`SELECT count(*) n FROM employee WHERE joining_date < $1 AND (leaving_date IS NULL OR leaving_date >= $1)`, [yearStart]))[0].n);
    const avg = (atStart + headcount) / 2;
    const turnover = avg ? Math.round((leavers.length / avg) * 1000) / 10 : 0;
    const overtime = await q(`SELECT b.code, coalesce(sum(o.hours),0) hours FROM overtime_request o JOIN branch b ON b.id = o.branch_id WHERE o.status = 'approved' AND o.work_date >= $1 GROUP BY b.code ORDER BY b.code`, [monthStart]);
    const onLeave = await q(`SELECT e.id, e.emp_no, e.first_name || ' ' || e.last_name full_name, lt.name_en leave_type, to_char(l.to_date,'YYYY-MM-DD') to_date, b.code branch_code FROM leave_request l JOIN employee e ON e.id = l.employee_id JOIN leave_type lt ON lt.code = l.leave_type JOIN branch b ON b.id = e.branch_id WHERE l.status = 'approved' AND $1::date BETWEEN l.from_date AND l.to_date ORDER BY b.code`, [t]);
    const pending = await q(`SELECT (SELECT count(*) FROM leave_request WHERE status = 'pending_approval')::int leave, (SELECT count(*) FROM overtime_request WHERE status = 'pending_approval')::int overtime, (SELECT count(*) FROM hr_letter WHERE status = 'pending_approval')::int letters, (SELECT count(*) FROM loan WHERE status = 'pending_approval')::int loans`);
    return { headcount, byBranch, byNationality, joiners, leavers, turnover, overtime, onLeave, pending: pending[0], alerts: await hrAlerts(c) };
  });
}

// ---------------------------------------------------------------- HR letters (HR-10)
export async function requestLetter(ctx: Ctx, f: { employee_id?: string; template_code: string; language: string; addressed_to: string }) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    const empId = str(f.employee_id) || me?.id;
    if (!empId) throw invalid("Choose the employee.");
    const e = (await c.query("SELECT * FROM employee WHERE id = $1", [empId])).rows[0];
    if (!e) throw notFound("Employee");
    if (e.id !== me?.id) assertCan(ctx, "hr", "create", e.branch_id);
    const tpl = (await c.query("SELECT * FROM letter_template WHERE code = $1 AND active", [f.template_code])).rows[0];
    if (!tpl) throw invalid("Choose the letter.", { field: "template_code" });
    const lang = f.language === "ar" ? "ar" : "en";
    if (lang === "ar" && !tpl.body_ar) throw invalid("This letter has no Arabic version yet. Ask the admin to add it to the letter template.");
    const r = await c.query("INSERT INTO hr_letter (branch_id, employee_id, template_code, language, addressed_to, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [e.branch_id, e.id, tpl.code, lang, optStr(f.addressed_to) ?? "To whom it may concern", ctx.userId]);
    const id = r.rows[0].id;
    const sub = await submitForApproval(c, ctx, { docType: "hr_letter", docId: id, docRef: `${tpl.name_en} · ${empName(e)}`, branchId: e.branch_id, subjectEmployeeId: e.id,
      summary: { employee: `${e.emp_no} ${empName(e)}`, letter: tpl.name_en, language: lang === "ar" ? "Arabic" : "English" } });
    if (sub.status === "approved") await approveLetter(c, ctx, id);
    return { id, status: sub.status };
  });
}

async function letterValues(c: PoolClient, e: Record<string, any>) {
  const comp = (await c.query(
    `SELECT DISTINCT ON (s.component) s.component, s.amount, sc.name_en, sc.kind FROM salary_structure s JOIN salary_component sc ON sc.code = s.component
      WHERE s.employee_id = $1 AND s.effective_from <= $2 ORDER BY s.component, s.effective_from DESC`, [e.id, today()])).rows;
  const total = comp.filter((x) => x.kind === "earning").reduce((s, x) => s + Number(x.amount), 0);
  const basic = comp.find((x) => x.component === "basic")?.amount ?? "0.00";
  const passport = (await c.query("SELECT data->>'number' n FROM employee_record WHERE employee_id = $1 AND kind = 'document' AND data->>'doc_type' = 'passport' AND status = 'active' ORDER BY created_at DESC LIMIT 1", [e.id])).rows[0]?.n ?? "";
  const meta = (await c.query(`SELECT g.name_en designation, b.name_en branch, co.name nationality, bk.name bank FROM employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN designation g ON g.id = e.designation_id LEFT JOIN country co ON co.code = e.nationality LEFT JOIN wps_agent bk ON bk.id = e.wps_agent_id WHERE e.id = $1`, [e.id])).rows[0];
  const fmt = (n: number | string) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    name: empName(e), name_ar: e.name_ar ?? empName(e), emp_no: e.emp_no, designation: meta.designation ?? "", branch: meta.branch, nationality: meta.nationality ?? "",
    joining_date: String(e.joining_date).split("-").reverse().join("/"),
    passport_no: passport, salary_total: fmt(total), basic: fmt(basic), bank: meta.bank ?? "", iban: e.iban ?? "", date: today().split("-").reverse().join("/"),
    leaving_date: e.leaving_date ? String(e.leaving_date).split("-").reverse().join("/") : "",
  };
}

async function approveLetter(c: PoolClient, ctx: Ctx, id: string) {
  const l = (await c.query("SELECT * FROM hr_letter WHERE id = $1 FOR UPDATE", [id])).rows[0];
  const e = (await c.query("SELECT * FROM employee WHERE id = $1", [l.employee_id])).rows[0];
  const tpl = (await c.query("SELECT * FROM letter_template WHERE code = $1", [l.template_code])).rows[0];
  const v: Record<string, string> = { ...(await letterValues(c, e)), addressed_to: l.addressed_to ?? "" };
  const body = String(l.language === "ar" ? tpl.body_ar : tpl.body_en).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const ref = await nextDocNo(c, l.branch_id, "hr_letter");
  await c.query("UPDATE hr_letter SET status = 'approved', ref_no = $2, body = $3, approved_at = now() WHERE id = $1", [id, ref, body]);
}

registerHandler("hr_letter", {
  onApproved: async (c, ctx, req) => approveLetter(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE hr_letter SET status = 'rejected', reject_reason = $2 WHERE id = $1", [req.doc_id, comment]); },
});

export async function listLetters(ctx: Ctx, mine = false) {
  return withTx(ctx, async (c) => {
    const me = await myEmployee(c, ctx);
    if (!mine) assertCan(ctx, "hr", "view");
    return (await c.query(
      `SELECT l.id, l.ref_no, l.status, l.language, l.addressed_to, l.created_at, l.reject_reason, t.name_en template, e.emp_no, e.first_name || ' ' || e.last_name full_name, b.code branch_code
         FROM hr_letter l JOIN letter_template t ON t.code = l.template_code JOIN employee e ON e.id = l.employee_id JOIN branch b ON b.id = l.branch_id
        WHERE ($1::uuid IS NULL OR l.employee_id = $1) ORDER BY l.created_at DESC LIMIT 200`, [mine ? me?.id ?? "00000000-0000-0000-0000-000000000000" : null])).rows;
  });
}

export async function getLetter(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const l = (await c.query(
      `SELECT l.*, t.name_en template, t.shows_salary, e.emp_no, e.user_id, e.first_name || ' ' || e.last_name full_name, b.name_en branch_name, b.address, b.phone
         FROM hr_letter l JOIN letter_template t ON t.code = l.template_code JOIN employee e ON e.id = l.employee_id JOIN branch b ON b.id = l.branch_id WHERE l.id = $1`, [id])).rows[0];
    if (!l) throw notFound("Letter");
    if (l.user_id !== ctx.userId) {
      assertCan(ctx, "hr", "view", l.branch_id);
      // A letter that states the salary follows the salary field permission.
      if (l.shows_salary && !canSee(ctx, "salary", l.branch_id)) throw forbidden("This letter shows the salary, which your role cannot see.");
    }
    return { letter: l, history: await history(c, "hr_letter", id) };
  });
}

// ---------------------------------------------------------------- recruitment (HR-21)
export async function recruitment(ctx: Ctx) {
  assertCan(ctx, "hr", "view");
  return withTx(ctx, async (c) => ({
    openings: (await c.query(`SELECT o.*, b.code branch_code, (SELECT count(*) FROM applicant a WHERE a.opening_id = o.id)::int applicants, (SELECT count(*) FROM applicant a WHERE a.opening_id = o.id AND a.stage = 'hired')::int hired FROM job_opening o JOIN branch b ON b.id = o.branch_id ORDER BY o.status DESC, o.created_at DESC`)).rows,
    applicants: (await c.query(`SELECT a.*, o.title, b.code branch_code, e.emp_no FROM applicant a JOIN job_opening o ON o.id = a.opening_id JOIN branch b ON b.id = a.branch_id LEFT JOIN employee e ON e.id = a.employee_id ORDER BY a.created_at DESC`)).rows,
  }));
}
export async function addOpening(ctx: Ctx, f: Record<string, string>) {
  assertCan(ctx, "hr", "create", f.branch_id);
  if (!str(f.title)) throw invalid("Job title is required.", { field: "title" });
  return withTx(ctx, async (c) => {
    await c.query("INSERT INTO job_opening (branch_id, title, department_id, designation_id, positions, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [f.branch_id, str(f.title), optStr(f.department_id), optStr(f.designation_id), Math.max(1, Number(f.positions) || 1), ctx.userId]);
  });
}
export async function addApplicant(ctx: Ctx, f: Record<string, string>) {
  return withTx(ctx, async (c) => {
    const o = (await c.query("SELECT * FROM job_opening WHERE id = $1", [f.opening_id])).rows[0];
    if (!o) throw notFound("Opening");
    assertCan(ctx, "hr", "create", o.branch_id);
    if (o.status !== "open") throw invalid("This opening is closed.");
    if (!str(f.full_name)) throw invalid("Applicant name is required.", { field: "full_name" });
    await c.query("INSERT INTO applicant (branch_id, opening_id, full_name, mobile, email, nationality, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [o.branch_id, o.id, str(f.full_name), optStr(f.mobile), optStr(f.email), optStr(f.nationality), ctx.userId]);
  });
}
export async function moveApplicant(ctx: Ctx, id: string, f: Record<string, string>) {
  return withTx(ctx, async (c) => {
    const a = (await c.query("SELECT * FROM applicant WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!a) throw notFound("Applicant");
    assertCan(ctx, "hr", "edit", a.branch_id);
    if (a.stage === "hired") throw invalid("This applicant is already an employee.");
    const stage = str(f.stage);
    if (!["applied", "interview", "offer", "rejected"].includes(stage)) throw invalid("Choose the stage.");
    if (stage === "offer" && !str(f.offer_salary)) throw invalid("Enter the offered salary for the offer letter.", { field: "offer_salary" });
    await c.query("UPDATE applicant SET stage = $2, interview_notes = coalesce($3, interview_notes), offer_salary = coalesce($4::numeric, offer_salary), offer_date = CASE WHEN $2 = 'offer' THEN $5::date ELSE offer_date END WHERE id = $1",
      [id, stage, optStr(f.interview_notes), optStr(f.offer_salary), today()]);
  });
}
/** A hired applicant becomes an employee record (HR-21); HR completes the file on the employee page. */
export async function hireApplicant(ctx: Ctx, id: string, f: Record<string, string>) {
  const a = await withTx(ctx, async (c) => (await c.query("SELECT a.*, o.department_id, o.designation_id FROM applicant a JOIN job_opening o ON o.id = a.opening_id WHERE a.id = $1", [id])).rows[0]);
  if (!a) throw notFound("Applicant");
  if (a.stage !== "offer") throw invalid("Make the offer first.");
  const [first, ...rest] = String(a.full_name).split(" ");
  const r = await createEmployee(ctx, { branch_id: a.branch_id, first_name: first, last_name: rest.join(" ") || "-", nationality: a.nationality ?? f.nationality ?? "AE", mobile: a.mobile, email: a.email,
    department_id: a.department_id, designation_id: a.designation_id, joining_date: f.joining_date, contract_type: "limited" }, {}, true);
  await withTx(ctx, async (c) => { await c.query("UPDATE applicant SET stage = 'hired', employee_id = $2 WHERE id = $1", [id, r.id]); });
  return r;
}

export const HR_SCREENS_ANYWHERE = (ctx: Ctx) => canAnywhere(ctx, "hr", "view");
export const salaryLevel = (ctx: Ctx, b?: string | null) => fieldLevel(ctx, "salary", b);

// ---------------------------------------------------------------- renewing an expiring document or visa
/** HR starts the renewal (the PRO takes it from here); the bell stops reminding while it is in progress. */
export async function startRenewal(ctx: Ctx, recordId: string, note: string) {
  const n = str(note).slice(0, 300);
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT id, branch_id, employee_id, data, expiry_date FROM employee_record WHERE id = $1 AND status = 'active' FOR UPDATE", [recordId])).rows[0];
    if (!r || !r.expiry_date) throw notFound("Document");
    if (!can(ctx, "hr", "edit", r.branch_id)) throw forbidden("Only HR can start a renewal.");
    if (r.data.renewal_started) throw invalid("The renewal has already been started.");
    const data = { ...r.data, renewal_started: new Date().toISOString().slice(0, 10), renewal_by: ctx.fullName, renewal_note: n || undefined };
    await c.query("UPDATE employee_record SET data = $2, updated_by = $3, updated_at = now() WHERE id = $1", [recordId, JSON.stringify(data), ctx.userId]);
    await audit(c, ctx, "employee", r.employee_id, "renewal_started", { record: recordId, note: n }, r.branch_id);
  });
}

/** The new document is in hand: the new expiry date replaces the old one and the renewal is finished. */
export async function markRenewed(ctx: Ctx, recordId: string, newExpiry: string) {
  const v = str(newExpiry);
  if (!isDate(v)) throw invalid("New expiry date is required.", { field: "new_expiry" });
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT id, branch_id, employee_id, data, to_char(expiry_date,'YYYY-MM-DD') expiry FROM employee_record WHERE id = $1 AND status = 'active' FOR UPDATE", [recordId])).rows[0];
    if (!r || !r.expiry) throw notFound("Document");
    if (!can(ctx, "hr", "edit", r.branch_id)) throw forbidden("Only HR can record a renewal.");
    if (v <= r.expiry) throw invalid("The new expiry date must be after the old one.", { field: "new_expiry" });
    const { renewal_started: _s, renewal_by: _b, renewal_note: _n, ...rest } = r.data;
    const data = { ...rest, expiry_date: v };
    await c.query("UPDATE employee_record SET data = $2, expiry_date = $3, updated_by = $4, updated_at = now() WHERE id = $1", [recordId, JSON.stringify(data), v, ctx.userId]);
    await audit(c, ctx, "employee", r.employee_id, "renewed", { record: recordId, from: r.expiry, to: v }, r.branch_id);
  });
}
