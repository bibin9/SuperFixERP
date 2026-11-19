import crypto from "node:crypto";
import { Ctx, can, canAnywhere } from "../access";
import { withTx, withAnonTx, withBranchSystemTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { str, optStr } from "../validate";
import { audit } from "./audit";
import { attendanceDays } from "./hr-time";
import { addDays } from "./payroll-calc";
import { today } from "./hr";

/**
 * Punching machines per branch. Each machine (or the sync program beside it) sends its punches to
 * /api/punch with its own key; a machine that has not sent anything for 30 minutes shows as offline.
 */
const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const OFFLINE_MIN = 30;

export async function listDevices(ctx: Ctx) {
  if (!canAnywhere(ctx, "hr", "view")) throw forbidden();
  return withTx(ctx, async (c) => (await c.query(
    `SELECT d.id, d.code, d.name, d.model, d.active, d.key_hash IS NOT NULL has_key, b.code branch_code, d.branch_id,
            to_char(d.last_sync_at AT TIME ZONE 'Asia/Dubai', 'DD Mon HH24:MI') last_sync, d.last_sync_count,
            coalesce(d.last_sync_at > now() - make_interval(mins => $1), false) online,
            (SELECT count(*)::int FROM punch p WHERE p.device_ref = d.code AND (p.at AT TIME ZONE 'Asia/Dubai')::date = (now() AT TIME ZONE 'Asia/Dubai')::date) today
       FROM punch_device d JOIN branch b ON b.id = d.branch_id ORDER BY d.active DESC, b.code, d.code`, [OFFLINE_MIN])).rows.map((r) => ({ ...r, manage: can(ctx, "hr", "edit", r.branch_id) })));
}

export async function addDevice(ctx: Ctx, f: { branch_id: string; code: string; name: string; model?: string }) {
  if (!can(ctx, "hr", "edit", f.branch_id)) throw forbidden("Only HR can add a punching machine.");
  const code = str(f.code).toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw invalid("Machine code: 2 to 20 letters, numbers or dashes, for example YAS-ZK2.", { field: "code" });
  if (!str(f.name)) throw invalid("Machine name is required.", { field: "name" });
  return withTx(ctx, async (c) => {
    const id = (await c.query("INSERT INTO punch_device (branch_id, code, name, model, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [f.branch_id, code, str(f.name).slice(0, 80), optStr(f.model), ctx.userId]).catch((e) => { if (e.code === "23505") throw invalid("A machine with this code already exists.", { field: "code" }); throw e; })).rows[0].id;
    await audit(c, ctx, "punch_device", id, "added", { code }, f.branch_id);
    return id as string;
  });
}

/** A new sync key for the machine; the old key stops working. The key is shown once. */
export async function newDeviceKey(ctx: Ctx, id: string) {
  const key = `pk_${crypto.randomBytes(24).toString("base64url")}`;
  await withTx(ctx, async (c) => {
    const d = (await c.query("SELECT id, branch_id, code FROM punch_device WHERE id = $1 AND active FOR UPDATE", [id])).rows[0];
    if (!d) throw notFound("Machine");
    if (!can(ctx, "hr", "edit", d.branch_id)) throw forbidden();
    await c.query("UPDATE punch_device SET key_hash = $2 WHERE id = $1", [id, hash(key)]);
    await audit(c, ctx, "punch_device", id, "key_issued", { code: d.code }, d.branch_id);
  });
  return key;
}

export async function setDeviceActive(ctx: Ctx, id: string, active: boolean) {
  await withTx(ctx, async (c) => {
    const d = (await c.query("SELECT id, branch_id, code FROM punch_device WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!d) throw notFound("Machine");
    if (!can(ctx, "hr", "edit", d.branch_id)) throw forbidden();
    await c.query("UPDATE punch_device SET active = $2, key_hash = CASE WHEN $2 THEN key_hash ELSE NULL END WHERE id = $1", [id, active]);
    await audit(c, ctx, "punch_device", id, active ? "activated" : "deactivated", { code: d.code }, d.branch_id);
  });
}

type SyncPunch = { emp_no: string; at: string };
/** Punches sent by a machine: "Employee no" and "Date time" (Dubai time). Repeats are skipped, so a machine can resend. */
export async function syncPunches(key: string | null | undefined, punches: SyncPunch[]) {
  if (!key || key.length < 20) return null;
  const d = await withAnonTx(async (c) => (await c.query("SELECT * FROM punch_device_by_key_hash($1)", [hash(key)])).rows[0] as { id: string; branch_id: string; code: string } | undefined);
  if (!d) return null;
  if (punches.length > 5000) throw invalid("Send at most 5,000 punches at a time.");
  // Staff of any branch can punch on this machine (visiting technicians); each punch stays with the employee's own branch.
  const nos = [...new Set(punches.map((p) => str(p.emp_no)))];
  const emps = await withAnonTx(async (c) => {
    const m = new Map<string, { id: string; branch_id: string }>();
    for (const n of nos) { const e = (await c.query("SELECT * FROM employee_for_punch($1)", [n])).rows[0]; if (e) m.set(n, e); }
    return m;
  });
  let added = 0, skipped = 0; const errors: string[] = [];
  for (const [i, p] of punches.entries()) {
    const e = emps.get(str(p.emp_no));
    let at = str(p.at).replace("T", " ");
    const m = at.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.*)$/);
    if (m) at = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${m[4]}`;
    if (!e) { errors.push(`#${i + 1}: employee ${str(p.emp_no)} not found`); continue; }
    if (!/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2})?$/.test(at)) { errors.push(`#${i + 1}: time "${at}" not understood`); continue; }
    const r = await withBranchSystemTx(e.branch_id, (c) => c.query(
      `INSERT INTO punch (branch_id, employee_id, at, source, device_ref) SELECT $1, $2, ($3::timestamp AT TIME ZONE 'Asia/Dubai'), 'device', $4
        WHERE ($3::timestamp AT TIME ZONE 'Asia/Dubai') <= now() + interval '5 minutes' ON CONFLICT (employee_id, at) DO NOTHING`, [e.branch_id, e.id, at, d.code]));
    if (r.rowCount) added++; else skipped++;
  }
  await withBranchSystemTx(d.branch_id, (c) => c.query("UPDATE punch_device SET last_sync_at = now(), last_sync_count = $2 WHERE id = $1", [d.id, added]));
  return { device: d.code, added, skipped, errors: errors.slice(0, 50) };
}

/** Days in the last week where someone punched in but not out: the branch manager or HR adds the missing punch. */
export async function missingPunches(ctx: Ctx) {
  if (!canAnywhere(ctx, "hr", "edit") && !canAnywhere(ctx, "hr", "approve")) return [];
  const t = today();
  return withTx(ctx, async (c) => {
    const branches = new Map((await c.query("SELECT id, code FROM branch")).rows.map((b) => [b.code, b.id]));
    const rows = await attendanceDays(c, { from: addDays(t, -7), to: addDays(t, -1) });
    return rows.filter((r) => r.status === "missing_out" && (can(ctx, "hr", "edit", branches.get(r.branch_code)) || can(ctx, "hr", "approve", branches.get(r.branch_code))));
  });
}
