import { Pool, PoolClient, types } from "pg";

// DATE columns stay as YYYY-MM-DD strings; NUMERIC stays as exact strings (pg default).
types.setTypeParser(1082, (v) => v);
import { dbConfig } from "./env";
import { conflict, invalid, notFound } from "./errors";
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

/** A deadlock or serialization failure rolls the whole transaction back, so it is safe to run it again (CONC-02). */
const RETRYABLE = new Set(["40P01", "40001"]);
const MAX_ATTEMPTS = 4;

async function run<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runOnce(setup, fn);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code && RETRYABLE.has(code)) {
        if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 40 * attempt)); continue; }
        throw conflict("The system was busy with other postings and nothing was saved. Please try again.");
      }
      // Two requests raced for the same unique number or key; this one was rolled back in full.
      if (code === "23505") throw conflict("This was saved by another request at the same moment and nothing was saved here. Reload the page to see it.");
      throw e;
    }
  }
}

async function runOnce<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await setup(c);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    // A malformed record id in a URL (for example /stock/transfers/abc) is a missing record, not a crash.
    if ((e as { code?: string }).code === "22P02" && /type uuid/.test((e as Error).message)) throw notFound("Record");
    // Business rules enforced in the database (for example a closed accounting period) come back as plain messages.
    if ((e as { code?: string }).code === "P0001" && /period .* is closed|is archived and is read only/i.test((e as Error).message)) throw invalid((e as Error).message);
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
