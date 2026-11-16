import type { PoolClient } from "pg";

/** Reads a setting: branch value first, then the company default, then the code fallback. */
export async function getSetting<T = unknown>(c: PoolClient, key: string, branchId: string | null, fallback: T): Promise<T> {
  const r = await c.query(
    "SELECT value FROM setting WHERE key = $1 AND (branch_id = $2 OR branch_id IS NULL) ORDER BY branch_id NULLS LAST LIMIT 1",
    [key, branchId],
  );
  return r.rowCount ? (r.rows[0].value as T) : fallback;
}
