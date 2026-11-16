// Creates the application login role and the database. --reset drops the database first.
import { Client } from "pg";
import { dbConfig } from "../lib/env";

async function main() {
  const cfg = dbConfig();
  const reset = process.argv.includes("--reset");
  if (!/^[a-z_][a-z0-9_]*$/.test(cfg.dbName)) throw new Error("DB_NAME must be a simple identifier");
  const c = new Client({ connectionString: cfg.serverUrl });
  await c.connect();
  const role = await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'superfix_app'");
  const pw = cfg.appPassword.replace(/'/g, "''");
  if (role.rowCount === 0) {
    await c.query(`CREATE ROLE superfix_app LOGIN PASSWORD '${pw}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    console.log("created role superfix_app");
  } else {
    await c.query(`ALTER ROLE superfix_app LOGIN PASSWORD '${pw}' NOSUPERUSER NOBYPASSRLS`);
  }
  if (reset) {
    await c.query(`DROP DATABASE IF EXISTS ${cfg.dbName} WITH (FORCE)`);
    console.log(`dropped database ${cfg.dbName}`);
  }
  const db = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [cfg.dbName]);
  if (db.rowCount === 0) {
    await c.query(`CREATE DATABASE ${cfg.dbName}`);
    console.log(`created database ${cfg.dbName}`);
  }
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
