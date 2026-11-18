import type { PoolClient } from "pg";
import { roleAt, type Ctx } from "../access";

/** Appends to the audit log (FSD 3.6). `changes` holds old/new values for changed fields. */
export async function audit(c: PoolClient, ctx: Ctx | null, entity: string, entityId: string | null, action: string, changes?: unknown, branchId?: string | null) {
  const b = branchId ?? ctx?.currentBranchId ?? null;
  const role = ctx ? (roleAt(ctx, b) ?? ctx.grants[0])?.roleName ?? null : null;
  await c.query(
    "INSERT INTO audit_log (user_id, branch_id, entity, entity_id, action, changes, ip, device, role_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [ctx?.userId ?? null, b, entity, entityId, action, changes === undefined ? null : JSON.stringify(changes), ctx?.ip ?? null, ctx?.device ?? null, role],
  );
}

export type HistoryRow = { at: string; user: string; role: string | null; action: string; detail: unknown; source: "audit" | "approval" | "record" };
/**
 * Everything that happened to one transaction and who did it (FSD 3.6): audit entries for the record
 * and its parts, approval actions, and the creating and posting users stamped on the record itself.
 */
export async function recordHistory(c: PoolClient, f: { refs: [string, string | null | undefined][]; approvals?: [string, string][]; stamps?: { action: string; user_id: string | null; at: string | Date | null }[] }) {
  const out: HistoryRow[] = [];
  const refs = f.refs.filter(([, id]) => id) as [string, string][];
  if (refs.length) {
    const r = await c.query(
      `SELECT a.at, a.action, a.changes, a.entity, coalesce(u.full_name, 'System') full_name,
              coalesce(a.role_name, (SELECT r.name FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = a.user_id AND (ubr.branch_id = a.branch_id OR ubr.branch_id IS NULL) ORDER BY ubr.branch_id NULLS LAST LIMIT 1)) role_name
         FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id
         JOIN unnest($1::text[], $2::text[]) AS x(entity, id) ON x.entity = a.entity AND x.id = a.entity_id
        ORDER BY a.at, a.id`, [refs.map((x) => x[0]), refs.map((x) => x[1])]);
    for (const x of r.rows) out.push({ at: x.at, user: x.full_name, role: x.role_name, action: x.entity === refs[0][0] ? x.action : `${x.entity.replace(/_/g, " ")}: ${x.action}`, detail: x.changes, source: "audit" });
  }
  for (const [docType, docId] of f.approvals ?? []) {
    const r = await c.query(
      `SELECT a.at, a.action, a.comment, a.channel, coalesce(u.full_name,'System') full_name, t.step_name,
              (SELECT r.name FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = a.user_id AND (ubr.branch_id = q.branch_id OR ubr.branch_id IS NULL) ORDER BY ubr.branch_id NULLS LAST LIMIT 1) role_name
         FROM approval_action a JOIN approval_request q ON q.id = a.request_id LEFT JOIN app_user u ON u.id = a.user_id LEFT JOIN approval_task t ON t.id = a.task_id
        WHERE q.doc_type = $1 AND q.doc_id = $2 ORDER BY a.at, a.id`, [docType, docId]);
    for (const x of r.rows) out.push({ at: x.at, user: x.full_name, role: x.role_name, action: `approval ${x.action.replace(/_/g, " ")}${x.step_name ? ` (${x.step_name})` : ""}`, detail: x.comment ? { note: x.comment } : null, source: "approval" });
  }
  for (const s of f.stamps ?? []) {
    if (!s.user_id || !s.at) continue;
    if (out.some((o) => o.source === "audit" && /^(create|created|post|posted)$/.test(o.action) && s.action.startsWith(o.action.slice(0, 4)))) continue;
    const u = (await c.query("SELECT u.full_name, (SELECT r.name FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = u.id ORDER BY ubr.branch_id NULLS LAST LIMIT 1) role_name FROM app_user u WHERE u.id = $1", [s.user_id])).rows[0];
    out.push({ at: String(s.at instanceof Date ? s.at.toISOString() : s.at), user: u?.full_name ?? "System", role: u?.role_name ?? null, action: s.action, detail: null, source: "record" });
  }
  await namesForIds(c, out);
  return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Shows people, bays, branches and items by name instead of their ids in history details (e.g. technician assignments). */
async function namesForIds(c: PoolClient, rows: HistoryRow[]) {
  const ids = new Set<string>();
  const walk = (v: unknown) => { if (typeof v === "string" && UUID.test(v)) ids.add(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  rows.forEach((r) => walk(r.detail));
  if (!ids.size) return;
  const list = [...ids];
  const names = new Map<string, string>((await c.query(
    `SELECT id::text, full_name n FROM app_user WHERE id = ANY($1::uuid[])
     UNION ALL SELECT id::text, code FROM bay WHERE id = ANY($1::uuid[])
     UNION ALL SELECT id::text, code FROM branch WHERE id = ANY($1::uuid[])
     UNION ALL SELECT id::text, part_no FROM item WHERE id = ANY($1::uuid[])`, [list])).rows.map((x) => [x.id, x.n]));
  const swap = (v: unknown): unknown => typeof v === "string" && UUID.test(v) ? names.get(v) ?? v : Array.isArray(v) ? v.map(swap)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_id$/, ""), swap(x)])) : v;
  for (const r of rows) r.detail = swap(r.detail);
}

/** Old/new pairs for the fields that changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = after[k];
    if (String(a ?? "") !== String(b ?? "")) out[k] = { old: a ?? null, new: b ?? null };
  }
  return out;
}
