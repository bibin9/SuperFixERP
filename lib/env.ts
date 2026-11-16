import fs from "node:fs";
import path from "node:path";

// Minimal .env loader for scripts and tests (Next.js loads .env files itself).
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function dbConfig() {
  loadEnv();
  const admin = process.env.PG_ADMIN_URL || "postgres://postgres:postgres@localhost:5432/postgres";
  const dbName = process.env.DB_NAME || "superfix";
  const appPassword = process.env.APP_DB_PASSWORD || "superfix_app_local";
  const u = new URL(admin);
  const adminDb = new URL(admin);
  adminDb.pathname = "/" + dbName;
  const app = new URL(admin);
  app.username = "superfix_app";
  app.password = appPassword;
  app.pathname = "/" + dbName;
  return { serverUrl: u.toString(), adminUrl: adminDb.toString(), appUrl: app.toString(), dbName, appPassword };
}
