import { withAnonTx } from "./db";
import { loadCtx, Ctx } from "./access";

/** Builds a context for a user without a web session (seed script, tests). */
export async function ctxFor(username: string, branchCode?: string): Promise<Ctx> {
  return withAnonTx(async (c) => {
    const u = await c.query("SELECT id FROM app_user WHERE username = $1", [username]);
    if (!u.rowCount) throw new Error(`no user ${username}`);
    const b = branchCode ? (await c.query("SELECT id FROM branch WHERE code = $1", [branchCode])).rows[0]?.id : null;
    const ctx = await loadCtx(c, u.rows[0].id, b ?? null);
    if (!ctx) throw new Error(`user ${username} disabled`);
    return ctx;
  });
}
