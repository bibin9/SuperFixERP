import "./env";
import { Client } from "pg";
import { execSync } from "node:child_process";
import { dbConfig } from "../lib/env";
import { migrate } from "../scripts/migrate";
import { seed } from "../scripts/seed";

export async function resetTestDb(demoJobs = true) {
  const cfg = dbConfig();
  if (!cfg.dbName.endsWith("_test")) throw new Error("refusing to reset a non-test database");
  execSync("npx tsx scripts/db-setup.ts --reset", { env: { ...process.env, DB_NAME: cfg.dbName }, stdio: "pipe" });
  await migrate(cfg.adminUrl, () => {});
  await seed(cfg.adminUrl, { demoJobs });
}

export async function adminQuery(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: dbConfig().adminUrl });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}

/** Runs SQL as the application role with a given branch scope, to prove the database layer itself. */
export async function appQueryAs(branchIds: string[], sql: string, params: unknown[] = [], allBranches = false) {
  const c = new Client({ connectionString: dbConfig().appUrl });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true), set_config('app.branch_ids', $1, true), set_config('app.all_branches', $2, true)",
      [branchIds.join(","), allBranches ? "on" : "off"]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { await c.end(); }
}

export const id = async (table: string, where: string, params: unknown[]) => (await adminQuery(`SELECT id FROM ${table} WHERE ${where}`, params))[0]?.id as string;
export const branchId = (code: string) => id("branch", "code = $1", [code]);
