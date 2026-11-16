import type { PoolClient } from "pg";
import type { Ctx } from "../access";

/** Appends to the audit log (FSD 3.6). `changes` holds old/new values for changed fields. */
export async function audit(c: PoolClient, ctx: Ctx | null, entity: string, entityId: string | null, action: string, changes?: unknown, branchId?: string | null) {
  await c.query(
    "INSERT INTO audit_log (user_id, branch_id, entity, entity_id, action, changes, ip, device) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [ctx?.userId ?? null, branchId ?? ctx?.currentBranchId ?? null, entity, entityId, action, changes === undefined ? null : JSON.stringify(changes), ctx?.ip ?? null, ctx?.device ?? null],
  );
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
