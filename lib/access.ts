import type { PoolClient } from "pg";
import { forbidden } from "./errors";

export type Action = "view" | "create" | "edit" | "approve" | "cancel" | "export";
export type FieldLevel = "hidden" | "view" | "edit";

export const SCREENS = [
  ["customers", "Customers, vehicles, enquiries"],
  ["jobs", "Job cards, quotations"],
  ["workshop", "Workshop board, clocking"],
  ["stock", "Stock, transfers, counts"],
  ["purchasing", "Purchasing"],
  ["invoices", "Invoices, payments, cash"],
  ["accounting", "Accounting, VAT"],
  ["hr", "HR, payroll"],
  ["settings", "Settings, master forms"],
  ["admin", "Users, roles, permissions"],
  ["approvals", "Approvals inbox"],
  ["reports", "Reports, dashboards"],
] as const;
export type Screen = (typeof SCREENS)[number][0];
export const ACTIONS: Action[] = ["view", "create", "edit", "approve", "cancel", "export"];

export type RoleGrant = { branchId: string | null; roleId: string; roleCode: string; roleName: string; isAdmin: boolean; homeScreen: string };

export type Ctx = {
  userId: string;
  username: string;
  fullName: string;
  language: string;
  grants: RoleGrant[];
  allBranches: boolean;
  branchIds: string[];
  currentBranchId: string | null;
  perms: Map<string, Set<string>>; // roleId -> "screen:action"
  fields: Map<string, Map<string, FieldLevel>>; // roleId -> field group -> level
  sessionId?: string;
  ip?: string;
  device?: string;
};

/** Loads the user's branch-role grants, permission matrix and field permissions from the database. */
export async function loadCtx(c: PoolClient, userId: string, currentBranchId: string | null, extra?: Partial<Ctx>): Promise<Ctx | null> {
  const u = await c.query("SELECT id, username, full_name, language, status FROM app_user WHERE id = $1", [userId]);
  if (!u.rowCount || u.rows[0].status !== "active") return null;
  const g = await c.query(
    `SELECT ubr.branch_id, r.id role_id, r.code, r.name, r.is_admin, r.home_screen
       FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id
       LEFT JOIN branch b ON b.id = ubr.branch_id
      WHERE ubr.user_id = $1 AND r.active AND (ubr.branch_id IS NULL OR b.active)`,
    [userId],
  );
  const grants: RoleGrant[] = g.rows.map((r) => ({ branchId: r.branch_id, roleId: r.role_id, roleCode: r.code, roleName: r.name, isAdmin: r.is_admin, homeScreen: r.home_screen }));
  const allBranches = grants.some((x) => x.branchId === null);
  let branchIds: string[];
  if (allBranches) {
    branchIds = (await c.query("SELECT id FROM branch WHERE active ORDER BY code")).rows.map((r) => r.id);
  } else {
    branchIds = grants.map((x) => x.branchId!) ;
  }
  const roleIds = [...new Set(grants.map((x) => x.roleId))];
  const perms = new Map<string, Set<string>>();
  const fields = new Map<string, Map<string, FieldLevel>>();
  if (roleIds.length) {
    for (const r of (await c.query("SELECT role_id, screen, action FROM permission WHERE role_id = ANY($1)", [roleIds])).rows) {
      if (!perms.has(r.role_id)) perms.set(r.role_id, new Set());
      perms.get(r.role_id)!.add(`${r.screen}:${r.action}`);
    }
    for (const r of (await c.query("SELECT role_id, field_group, level FROM field_permission WHERE role_id = ANY($1)", [roleIds])).rows) {
      if (!fields.has(r.role_id)) fields.set(r.role_id, new Map());
      fields.get(r.role_id)!.set(r.field_group, r.level);
    }
  }
  const cur = currentBranchId && branchIds.includes(currentBranchId) ? currentBranchId : branchIds[0] ?? null;
  return {
    userId, username: u.rows[0].username, fullName: u.rows[0].full_name, language: u.rows[0].language,
    grants, allBranches, branchIds, currentBranchId: cur, perms, fields, ...extra,
  };
}

/** The role that applies at a branch: the branch-specific grant, else the all-branches grant. */
export function roleAt(ctx: Ctx, branchId: string | null | undefined): RoleGrant | undefined {
  const b = branchId ?? ctx.currentBranchId;
  if (b && !ctx.branchIds.includes(b)) return undefined;
  return ctx.grants.find((g) => g.branchId === b) ?? ctx.grants.find((g) => g.branchId === null);
}

export function can(ctx: Ctx, screen: Screen, action: Action, branchId?: string | null): boolean {
  const r = roleAt(ctx, branchId);
  if (!r) return false;
  return r.isAdmin || !!ctx.perms.get(r.roleId)?.has(`${screen}:${action}`);
}

/** True when the user holds the permission at any of their branches (used for menus and "all my branches" lists). */
export function canAnywhere(ctx: Ctx, screen: Screen, action: Action): boolean {
  return ctx.grants.some((g) => g.isAdmin || ctx.perms.get(g.roleId)?.has(`${screen}:${action}`));
}

export function assertCan(ctx: Ctx, screen: Screen, action: Action, branchId?: string | null) {
  if (!can(ctx, screen, action, branchId)) throw forbidden();
}

export function assertBranch(ctx: Ctx, branchId: string) {
  if (!ctx.branchIds.includes(branchId)) throw forbidden("You do not have access to that branch.");
}

/**
 * Field level for a sensitive field group (FSD 3.3). Unknown or unset groups are hidden for
 * everyone except admins (FP-07: new sensitive fields are hidden by default).
 */
export function fieldLevel(ctx: Ctx, group: string, branchId?: string | null): FieldLevel {
  const r = roleAt(ctx, branchId);
  if (!r) return "hidden";
  const lvl = ctx.fields.get(r.roleId)?.get(group);
  if (lvl) return lvl;
  return r.isAdmin ? "edit" : "hidden";
}

export const canSee = (ctx: Ctx, group: string, branchId?: string | null) => fieldLevel(ctx, group, branchId) !== "hidden";

/**
 * Removes hidden fields from data before it leaves the server (FP-02, FP-03). `map` lists
 * field name -> field group; derived figures (FP-04) are listed under the group they derive from.
 */
export function redact<T extends Record<string, unknown>>(ctx: Ctx, rows: T[], map: Record<string, string>, branchOf?: (row: T) => string | null): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [field, group] of Object.entries(map)) {
      if (field in out && !canSee(ctx, group, branchOf ? branchOf(row) : undefined)) delete out[field];
    }
    return out as T;
  });
}
export const redactOne = <T extends Record<string, unknown>>(ctx: Ctx, row: T, map: Record<string, string>, branchId?: string | null) =>
  redact(ctx, [row], map, () => branchId ?? null)[0];
