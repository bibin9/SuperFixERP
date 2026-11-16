// Applies db/migrations/*.sql in order, each inside its own transaction, then re-applies grants.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";
import { dbConfig } from "../lib/env";

export async function migrate(adminUrl: string, log = console.log) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const done = new Map((await c.query("SELECT name, checksum FROM schema_migrations")).rows.map((r) => [r.name, r.checksum]));
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      const sum = crypto.createHash("sha256").update(sql).digest("hex");
      if (done.has(f)) {
        if (done.get(f) !== sum) throw new Error(`Migration ${f} changed after it was applied. Add a new migration instead.`);
        continue;
      }
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [f, sum]);
        await c.query("COMMIT");
        log(`applied ${f}`);
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    }
    await c.query(fs.readFileSync(path.join(process.cwd(), "db", "grants.sql"), "utf8"));
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  migrate(dbConfig().adminUrl).then(() => console.log("migrations up to date")).catch((e) => { console.error(e.message); process.exit(1); });
}
