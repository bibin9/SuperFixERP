import { Pool, PoolClient, types } from "pg";

// DATE columns stay as YYYY-MM-DD strings; NUMERIC stays as exact strings (pg default).
types.setTypeParser(1082, (v) => v);
import { dbConfig } from "./env";
import type { Ctx } from "./access";

// The pool connects as superfix_app, which is subject to row-level security.
const g = globalThis as unknown as { __sfPool?: Pool };

export function pool(): Pool {
  if (!g.__sfPool) {
    g.__sfPool = new Pool({ connectionString: process.env.APP_DATABASE_URL || dbConfig().appUrl, max: 10 });
    // An idle connection dropped by the server (restart, db:reset) must not crash the app.
    g.__sfPool.on("error", (e) => console.error("database pool:", e.message));
  }
  return g.__sfPool;
}

export async function closePool() {
  if (g.__sfPool) {
    await g.__sfPool.end();
    g.__sfPool = undefined;
  }
}

export type Tx = PoolClient;

async function run<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await setup(c);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Runs fn in one transaction with the caller's branch scope applied to row-level security. */
export function withTx<T>(ctx: Ctx, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return run(async (c) => {
    await c.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.branch_ids', $2, true), set_config('app.all_branches', $3, true), set_config('TimeZone', 'Asia/Dubai', true)",
      [ctx.userId, ctx.branchIds.join(","), ctx.allBranches ? "on" : "off"],
    );
  }, fn);
}

/** No user context: only shared, non-branch tables are visible (sign-in, sessions). */
export function withAnonTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return run(async (c) => { await c.query("SELECT set_config('TimeZone', 'Asia/Dubai', true)"); }, fn);
}

/**
 * Trusted server-side scope limited to one branch, used where the caller is verified another way
 * (for example the customer approval page, verified by an unguessable token).
 */
export function withBranchSystemTx<T>(branchId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return run(async (c) => {
    await c.query(
      "SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.branch_ids', $1, true), set_config('app.all_branches', 'off', true), set_config('TimeZone', 'Asia/Dubai', true)",
      [branchId],
    );
  }, fn);
}
