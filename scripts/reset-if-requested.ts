// One-time reset of the UAT database to fresh demo data, asked for by committing db/reset-request.txt.
// Runs only on the UAT host (RAILWAY_PUBLIC_DOMAIN must be the UAT domain), never anywhere else, and only
// once per request token: the token is recorded in the new database after it is seeded.
//   tsx scripts/reset-if-requested.ts          drop the database if this request has not run yet
//   tsx scripts/reset-if-requested.ts --record record the request as done (after migrate and seed)
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { dbConfig } from "../lib/env";

const UAT_DOMAIN = "superfix-uat.up.railway.app";

async function main() {
  const file = path.join(process.cwd(), "db", "reset-request.txt");
  if (!fs.existsSync(file)) return;
  const token = fs.readFileSync(file, "utf8").trim().split(/\s+/)[0];
  if (!/^[a-z0-9-]{8,80}$/.test(token)) throw new Error("db/reset-request.txt: bad token");
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN ?? "";
  if (domain !== UAT_DOMAIN && process.env.ALLOW_LOCAL_RESET !== "yes") { console.log(`reset request ${token} ignored: not the UAT host (${domain || "no domain"})`); return; }
  const cfg = dbConfig();
  if (process.argv.includes("--record")) {
    const c = new Client({ connectionString: cfg.adminUrl });
    await c.connect();
    try {
      await c.query("CREATE TABLE IF NOT EXISTS deploy_reset (token text PRIMARY KEY, done_at timestamptz NOT NULL DEFAULT now())");
      await c.query("INSERT INTO deploy_reset (token) VALUES ($1) ON CONFLICT DO NOTHING", [token]);
    } finally { await c.end(); }
    return;
  }
  const s = new Client({ connectionString: cfg.serverUrl });
  await s.connect();
  const exists = (await s.query("SELECT 1 FROM pg_database WHERE datname = $1", [cfg.dbName])).rowCount;
  await s.end();
  if (exists) {
    const c = new Client({ connectionString: cfg.adminUrl });
    await c.connect();
    let done = false;
    try {
      done = !!(await c.query("SELECT 1 FROM pg_tables WHERE tablename = 'deploy_reset'")).rowCount
        && !!(await c.query("SELECT 1 FROM deploy_reset WHERE token = $1", [token])).rowCount;
    } finally { await c.end(); }
    if (done) { console.log(`reset request ${token} already done`); return; }
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(cfg.dbName)) throw new Error("DB_NAME must be a simple identifier");
  const d = new Client({ connectionString: cfg.serverUrl });
  await d.connect();
  try { await d.query(`DROP DATABASE IF EXISTS ${cfg.dbName} WITH (FORCE)`); } finally { await d.end(); }
  console.log(`reset request ${token}: dropped database ${cfg.dbName}; it is recreated and reseeded next`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
