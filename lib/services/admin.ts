import { Ctx, assertCan, ACTIONS, SCREENS } from "../access";
import { withTx } from "../db";
import { invalid, notFound, conflict } from "../errors";
import { audit, diff } from "./audit";
import { hashPassword } from "./auth";
import { optStr, required, str } from "../validate";
import { csvCell } from "../csv";

/** M01 administration: branches, users, roles, permissions, field permissions, numbering, settings, audit. */

// ---------- branches ----------
export async function listBranches(ctx: Ctx) {
  assertCan(ctx, "admin", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT * FROM branch ORDER BY code")).rows);
}

export async function saveBranch(ctx: Ctx, f: Record<string, unknown>) {
  assertCan(ctx, "admin", f.id ? "edit" : "create");
  return withTx(ctx, async (c) => {
    const row = {
      code: required(f.code, "Code").toUpperCase(), name_en: required(f.name_en, "Name"), name_ar: optStr(f.name_ar),
      branch_type: str(f.branch_type) || "workshop", emirate: required(f.emirate, "Emirate"), address: optStr(f.address), phone: optStr(f.phone),
      whatsapp_number: optStr(f.whatsapp_number), whatsapp_mode: "manual", opening_hours: optStr(f.opening_hours), cost_centre: optStr(f.cost_centre),
    };
    if (!/^[A-Z0-9]{2,6}$/.test(row.code)) throw invalid("Code must be 2 to 6 capital letters or digits.");
    if (f.id) {
      const cur = await c.query("SELECT * FROM branch WHERE id = $1 FOR UPDATE", [f.id]);
      if (!cur.rowCount) throw notFound("Branch");
      if (Number(f.version) !== cur.rows[0].version) throw conflict();
      if (cur.rows[0].code !== row.code) throw invalid("The branch code is used in document numbers and cannot be changed.");
      const cols = Object.keys(row);
      await c.query(`UPDATE branch SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now(), updated_by = $${cols.length + 2}, version = version + 1 WHERE id = $1`,
        [f.id, ...cols.map((k) => (row as Record<string, unknown>)[k]), ctx.userId]);
      await audit(c, ctx, "branch", String(f.id), "update", diff(cur.rows[0], row));
      return { id: String(f.id) };
    }
    const r = await c.query(
      `INSERT INTO branch (code, name_en, name_ar, branch_type, emirate, address, phone, whatsapp_number, whatsapp_mode, opening_hours, cost_centre, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
      [row.code, row.name_en, row.name_ar, row.branch_type, row.emirate, row.address, row.phone, row.whatsapp_number, row.whatsapp_mode, row.opening_hours, row.cost_centre, ctx.userId],
    ).catch((e) => { if (e.code === "23505") throw invalid("That branch code is already used."); throw e; });
    const id = r.rows[0].id;
    // Document series for the new branch (FSD 3.4): every document type another branch numbers, with
    // the new branch code in the prefix (so modules added later work at new branches too).
    const series: [string, string, number, boolean][] = [
      ["job_card", `${row.code}-`, 4, false], ["enquiry", `${row.code}-ENQ-`, 5, true], ["invoice", `${row.code}-INV-`, 6, true],
      ["receipt", `${row.code}-RC-`, 6, true], ["credit_note", `${row.code}-CN-`, 6, true], ["journal", `${row.code}-JV-`, 6, true],
    ];
    for (const [t, p, pad, y] of series) await c.query("INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part) VALUES ($1,$2,$3,1,$4,$5)", [id, t, p, pad, y]);
    await c.query(
      `INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
       SELECT DISTINCT ON (s.doc_type) $1::uuid, s.doc_type, $2 || substr(s.prefix, length(b.code) + 1), 1, s.padding, s.year_part
         FROM doc_series s JOIN branch b ON b.id = s.branch_id WHERE s.prefix LIKE b.code || '%' ORDER BY s.doc_type, b.code
       ON CONFLICT (branch_id, doc_type) DO NOTHING`, [id, row.code]);
    await audit(c, ctx, "branch", id, "create", row);
    return { id };
  });
}

/** M01 rule 1: a branch cannot be deactivated while it has open jobs, stock on hand or unposted documents. */
export async function setBranchActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "admin", "edit");
  return withTx(ctx, async (c) => {
    if (!active) {
      const open = await c.query("SELECT count(*) n FROM job_card WHERE branch_id = $1 AND status NOT IN ('closed','cancelled')", [id]);
      const stock = await c.query("SELECT count(*) n FROM stock_balance WHERE branch_id = $1 AND on_hand > 0", [id]);
      const users = await c.query("SELECT count(*) n FROM user_branch_role WHERE branch_id = $1", [id]);
      const msgs = [];
      if (Number(open.rows[0].n)) msgs.push(`${open.rows[0].n} open job cards`);
      if (Number(stock.rows[0].n)) msgs.push(`${stock.rows[0].n} items in stock`);
      if (Number(users.rows[0].n)) msgs.push(`${users.rows[0].n} users assigned`);
      if (msgs.length) throw invalid(`This branch still has ${msgs.join(", ")}.`);
    }
    await c.query("UPDATE branch SET active = $2, version = version + 1, updated_at = now() WHERE id = $1", [id, active]);
    await audit(c, ctx, "branch", id, active ? "activate" : "deactivate");
  });
}

// ---------- users ----------
export async function listUsers(ctx: Ctx) {
  assertCan(ctx, "admin", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT u.id, u.username, u.full_name, u.mobile, u.email, u.status, u.language, u.locked_until, db.code default_branch,
            coalesce(json_agg(json_build_object('branch', coalesce(b.code,'ALL'), 'branch_id', ubr.branch_id, 'role', r.name, 'role_id', r.id) ORDER BY b.code) FILTER (WHERE r.id IS NOT NULL), '[]') grants
       FROM app_user u LEFT JOIN user_branch_role ubr ON ubr.user_id = u.id LEFT JOIN role r ON r.id = ubr.role_id
       LEFT JOIN branch b ON b.id = ubr.branch_id LEFT JOIN branch db ON db.id = u.default_branch_id
      GROUP BY u.id, db.code ORDER BY u.status, u.full_name`)).rows);
}

export async function createUser(ctx: Ctx, f: Record<string, unknown>) {
  assertCan(ctx, "admin", "create");
  const pw = required(f.password, "Password");
  if (pw.length < 8) throw invalid("Password must be at least 8 characters.");
  return withTx(ctx, async (c) => {
    const r = await c.query(
      "INSERT INTO app_user (username, full_name, mobile, email, password_hash, language, default_branch_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id",
      [required(f.username, "User name").toLowerCase(), required(f.full_name, "Name"), optStr(f.mobile), optStr(f.email), hashPassword(pw), str(f.language) || "en", optStr(f.default_branch_id), ctx.userId],
    ).catch((e) => { if (e.code === "23505") throw invalid("That user name is taken."); throw e; });
    await audit(c, ctx, "app_user", r.rows[0].id, "create", { username: f.username });
    return { id: r.rows[0].id };
  });
}

/** One role per branch per user; branch "ALL" gives the all-branches grant (owner / head office). */
export async function setUserBranchRole(ctx: Ctx, userId: string, branchId: string | null, roleId: string | null) {
  assertCan(ctx, "admin", "edit");
  return withTx(ctx, async (c) => {
    const before = await c.query("SELECT role_id FROM user_branch_role WHERE user_id = $1 AND branch_id IS NOT DISTINCT FROM $2", [userId, branchId]);
    await c.query("DELETE FROM user_branch_role WHERE user_id = $1 AND branch_id IS NOT DISTINCT FROM $2", [userId, branchId]);
    if (roleId) await c.query("INSERT INTO user_branch_role (user_id, branch_id, role_id) VALUES ($1,$2,$3)", [userId, branchId, roleId]);
    await audit(c, ctx, "user_branch_role", userId, "permission", { branch_id: branchId, role_id: { old: before.rows[0]?.role_id ?? null, new: roleId } });
  });
}

export async function resetPassword(ctx: Ctx, userId: string, password: string) {
  assertCan(ctx, "admin", "edit");
  if (password.length < 8) throw invalid("Password must be at least 8 characters.");
  return withTx(ctx, async (c) => {
    await c.query("UPDATE app_user SET password_hash = $2, failed_attempts = 0, locked_until = NULL, version = version + 1 WHERE id = $1", [userId, hashPassword(password)]);
    await c.query("UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await audit(c, ctx, "app_user", userId, "password_reset");
  });
}

// ---------- roles and permissions ----------
export async function listRoles(ctx: Ctx) {
  assertCan(ctx, "admin", "view");
  return withTx(ctx, async (c) => {
    const roles = (await c.query("SELECT r.*, (SELECT count(*) FROM user_branch_role WHERE role_id = r.id) holders FROM role r ORDER BY r.name")).rows;
    const perms = (await c.query("SELECT * FROM permission")).rows;
    const fields = (await c.query("SELECT * FROM field_permission")).rows;
    const groups = (await c.query("SELECT * FROM field_group ORDER BY code")).rows;
    return { roles, perms, fields, groups };
  });
}

export async function createRole(ctx: Ctx, f: Record<string, unknown>) {
  assertCan(ctx, "admin", "create");
  return withTx(ctx, async (c) => {
    const code = required(f.code, "Code").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const r = await c.query("INSERT INTO role (code, name, home_screen) VALUES ($1,$2,$3) RETURNING id", [code, required(f.name, "Name"), str(f.home_screen) || "home"])
      .catch((e) => { if (e.code === "23505") throw invalid("That role code exists."); throw e; });
    // FP-07: sensitive fields are hidden by default for a new role.
    await c.query("INSERT INTO field_permission (role_id, field_group, level) SELECT $1, code, 'hidden' FROM field_group", [r.rows[0].id]);
    await audit(c, ctx, "role", r.rows[0].id, "create", { code });
    return { id: r.rows[0].id };
  });
}

/** Replaces a role's screen x action matrix; logs old and new grants (FP-06, WF-09). */
export async function saveRoleMatrix(ctx: Ctx, roleId: string, granted: string[], fieldLevels: Record<string, string>) {
  assertCan(ctx, "admin", "edit");
  const valid = new Set(SCREENS.flatMap(([s]) => ACTIONS.map((a) => `${s}:${a}`)));
  for (const g of granted) if (!valid.has(g)) throw invalid(`Unknown permission ${g}.`);
  return withTx(ctx, async (c) => {
    const role = await c.query("SELECT * FROM role WHERE id = $1 FOR UPDATE", [roleId]);
    if (!role.rowCount) throw notFound("Role");
    const before = (await c.query("SELECT screen || ':' || action p FROM permission WHERE role_id = $1", [roleId])).rows.map((r) => r.p);
    await c.query("DELETE FROM permission WHERE role_id = $1", [roleId]);
    for (const g of granted) {
      const [s, a] = g.split(":");
      await c.query("INSERT INTO permission (role_id, screen, action) VALUES ($1,$2,$3)", [roleId, s, a]);
    }
    const fBefore = Object.fromEntries((await c.query("SELECT field_group, level FROM field_permission WHERE role_id = $1", [roleId])).rows.map((r) => [r.field_group, r.level]));
    for (const [grp, lvl] of Object.entries(fieldLevels)) {
      if (!["hidden", "view", "edit"].includes(lvl)) throw invalid("Field level must be hidden, view or edit.");
      await c.query("INSERT INTO field_permission (role_id, field_group, level) VALUES ($1,$2,$3) ON CONFLICT (role_id, field_group) DO UPDATE SET level = EXCLUDED.level", [roleId, grp, lvl]);
    }
    await c.query("UPDATE role SET version = version + 1 WHERE id = $1", [roleId]);
    const added = granted.filter((g) => !before.includes(g));
    const removed = before.filter((g) => !granted.includes(g));
    const fieldChanges = Object.fromEntries(Object.entries(fieldLevels).filter(([g, l]) => fBefore[g] !== l).map(([g, l]) => [g, { old: fBefore[g] ?? null, new: l }]));
    await audit(c, ctx, "role", roleId, "permission", { role: role.rows[0].code, added, removed, fields: fieldChanges });
  });
}

/** M01 rule 2: a role cannot be deleted while users hold it (it is deactivated instead). */
export async function deactivateRole(ctx: Ctx, roleId: string) {
  assertCan(ctx, "admin", "edit");
  return withTx(ctx, async (c) => {
    const n = await c.query("SELECT count(*) n FROM user_branch_role WHERE role_id = $1", [roleId]);
    if (Number(n.rows[0].n) > 0) throw invalid("Users still hold this role.");
    await c.query("UPDATE role SET active = false, version = version + 1 WHERE id = $1", [roleId]);
    await audit(c, ctx, "role", roleId, "deactivate");
  });
}

// ---------- numbering, settings, audit, workflows ----------
export async function listSeries(ctx: Ctx) {
  assertCan(ctx, "settings", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT s.*, b.code FROM doc_series s JOIN branch b ON b.id = s.branch_id ORDER BY b.code, s.doc_type")).rows);
}

export async function updateSeries(ctx: Ctx, branchId: string, docType: string, f: Record<string, unknown>) {
  assertCan(ctx, "settings", "edit");
  return withTx(ctx, async (c) => {
    const cur = await c.query("SELECT * FROM doc_series WHERE branch_id = $1 AND doc_type = $2 FOR UPDATE", [branchId, docType]);
    if (!cur.rowCount) throw notFound("Series");
    const next = Number(str(f.next_number));
    if (!Number.isInteger(next) || next < cur.rows[0].next_number) throw invalid("The next number can only move forward, so numbers are never reused.");
    const row = { prefix: required(f.prefix, "Prefix"), next_number: next, padding: Number(str(f.padding) || cur.rows[0].padding), year_part: f.year_part === "on" };
    await c.query("UPDATE doc_series SET prefix = $3, next_number = $4, padding = $5, year_part = $6, updated_at = now() WHERE branch_id = $1 AND doc_type = $2",
      [branchId, docType, row.prefix, row.next_number, row.padding, row.year_part]);
    await audit(c, ctx, "doc_series", `${branchId}:${docType}`, "update", diff(cur.rows[0], row), branchId);
  });
}

export async function listSettings(ctx: Ctx) {
  assertCan(ctx, "settings", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT s.*, b.code branch_code FROM setting s LEFT JOIN branch b ON b.id = s.branch_id ORDER BY s.grp, s.key, b.code NULLS FIRST")).rows);
}

export async function updateSetting(ctx: Ctx, id: string, raw: string) {
  assertCan(ctx, "settings", "edit");
  return withTx(ctx, async (c) => {
    const cur = await c.query("SELECT * FROM setting WHERE id = $1 FOR UPDATE", [id]);
    if (!cur.rowCount) throw notFound("Setting");
    let value: unknown;
    if (typeof cur.rows[0].value === "string") value = raw.trim().replace(/^"(.*)"$/, "$1"); // text settings are typed as plain text
    else { try { value = JSON.parse(raw); } catch { throw invalid("Value must be a number, true/false, or a list."); } }
    await c.query("UPDATE setting SET value = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [id, JSON.stringify(value), ctx.userId]);
    await audit(c, ctx, "setting", cur.rows[0].key, "update", { value: { old: cur.rows[0].value, new: value }, branch_id: cur.rows[0].branch_id }, cur.rows[0].branch_id);
  });
}

export type AuditFilter = { entity?: string; user?: string; action?: string; record?: string; from?: string; to?: string };
/**
 * Audit log (FSD 3.6, 3.12): search by user, record, date and action. Its own permission (Audit log)
 * in the role matrix; users who do not have all branches see their branches' entries only.
 */
export async function auditLog(ctx: Ctx, f: AuditFilter, limit = 300) {
  assertCan(ctx, "audit", "view");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(f.from)) ? str(f.from) : "", to = /^\d{4}-\d{2}-\d{2}$/.test(str(f.to)) ? str(f.to) : "";
  return withTx(ctx, async (c) => (await c.query(
    `SELECT a.*, u.full_name, u.username, b.code branch_code,
            coalesce(a.role_name, (SELECT r.name FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = a.user_id AND (ubr.branch_id = a.branch_id OR ubr.branch_id IS NULL) ORDER BY ubr.branch_id NULLS LAST LIMIT 1)) role
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id LEFT JOIN branch b ON b.id = a.branch_id
      WHERE ($1 = '' OR a.entity ILIKE '%' || $1 || '%') AND ($2 = '' OR u.username = $2) AND ($3 = '' OR a.action ILIKE '%' || $3 || '%')
        AND ($4 = '' OR a.entity_id::text = $4 OR a.changes::text ILIKE '%' || $4 || '%')
        AND ($5 = '' OR (a.at AT TIME ZONE 'Asia/Dubai')::date >= $5::date) AND ($6 = '' OR (a.at AT TIME ZONE 'Asia/Dubai')::date <= $6::date)
        AND ($7 OR a.branch_id IS NULL OR a.branch_id = ANY($8::uuid[]))
      ORDER BY a.id DESC LIMIT ${Math.min(limit, 50000)}`,
    [str(f.entity), str(f.user), str(f.action), str(f.record), from, to, ctx.allBranches, ctx.branchIds])).rows);
}

/** Audit log as CSV for the owner (export permission); the export itself is audited. */
export async function auditCsv(ctx: Ctx, f: AuditFilter) {
  assertCan(ctx, "audit", "export");
  const rows = await auditLog(ctx, f, 50000);
  const q = (v: unknown) => csvCell(v, true);
  const lines = ["When,User,Name,Role,Branch,Record,Record id,Action,Changes", ...rows.map((r) => [new Date(r.at).toISOString(), r.username ?? "system", r.full_name ?? "", r.role ?? "", r.branch_code ?? "", r.entity, r.entity_id ?? "", r.action, JSON.stringify(r.changes ?? {})].map(q).join(","))];
  await withTx(ctx, (c) => audit(c, ctx, "audit_log", null, "export", { rows: rows.length, filter: f }));
  return lines.join("\r\n") + "\r\n";
}

export async function auditUsers(ctx: Ctx) {
  assertCan(ctx, "audit", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT username, full_name FROM app_user ORDER BY full_name")).rows);
}

export async function loginEvents(ctx: Ctx) {
  assertCan(ctx, "audit", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT e.*, b.code branch_code FROM login_event e LEFT JOIN branch b ON b.id = e.branch_id WHERE $1 OR e.branch_id IS NULL OR e.branch_id = ANY($2::uuid[]) ORDER BY e.id DESC LIMIT 200", [ctx.allBranches, ctx.branchIds])).rows);
}

export async function listWorkflows(ctx: Ctx) {
  assertCan(ctx, "settings", "view");
  return withTx(ctx, async (c) => {
    const wfs = (await c.query("SELECT * FROM workflow ORDER BY doc_type")).rows;
    const steps = (await c.query(
      `SELECT s.*, r.name role_name, u.full_name user_name, bu.full_name backup_name, b.code branch_code FROM workflow_step s
         LEFT JOIN role r ON r.id = s.approver_role_id LEFT JOIN app_user u ON u.id = s.approver_user_id LEFT JOIN app_user bu ON bu.id = s.backup_user_id
         LEFT JOIN branch b ON b.id = s.cond_branch_id ORDER BY s.seq`)).rows;
    return wfs.map((w) => ({ ...w, steps: steps.filter((s) => s.workflow_id === w.id) }));
  });
}

export async function toggleWorkflow(ctx: Ctx, id: string, enabled: boolean) {
  assertCan(ctx, "settings", "edit");
  return withTx(ctx, async (c) => {
    const cur = await c.query("SELECT * FROM workflow WHERE id = $1 FOR UPDATE", [id]);
    if (!cur.rowCount) throw notFound("Workflow");
    await c.query("UPDATE workflow SET enabled = $2, version = version + 1 WHERE id = $1", [id, enabled]);
    await audit(c, ctx, "workflow", id, "update", { doc_type: cur.rows[0].doc_type, enabled: { old: cur.rows[0].enabled, new: enabled } });
  });
}

export async function saveStepLimits(ctx: Ctx, stepId: string, f: Record<string, unknown>) {
  assertCan(ctx, "settings", "edit");
  const num = (v: unknown) => (str(v) === "" ? null : str(v));
  return withTx(ctx, async (c) => {
    const cur = await c.query("SELECT * FROM workflow_step WHERE id = $1 FOR UPDATE", [stepId]);
    if (!cur.rowCount) throw notFound("Step");
    const row = { cond_min_amount: num(f.cond_min_amount), cond_max_amount: num(f.cond_max_amount), cond_min_discount_pct: num(f.cond_min_discount_pct), enabled: f.enabled === "on" };
    for (const k of ["cond_min_amount", "cond_max_amount", "cond_min_discount_pct"] as const) if (row[k] !== null && !/^\d+(\.\d{1,4})?$/.test(row[k]!)) throw invalid("Limits must be numbers.");
    await c.query("UPDATE workflow_step SET cond_min_amount = $2, cond_max_amount = $3, cond_min_discount_pct = $4, enabled = $5 WHERE id = $1",
      [stepId, row.cond_min_amount, row.cond_max_amount, row.cond_min_discount_pct, row.enabled]);
    await audit(c, ctx, "workflow_step", stepId, "update", diff(cur.rows[0], row));
  });
}
