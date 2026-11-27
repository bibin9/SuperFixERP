// Fixes from the security, load and controls test of 27 Nov 2026 (SEC-02 to SEC-07).
import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery } from "./helpers";
import { closePool } from "../lib/db";
import { login, sessionCtx } from "../lib/services/auth";
import { allow } from "../lib/rate-limit";
import { AppError } from "../lib/errors";

const PW = "Superfix@2026";
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("SEC-03: wrong passwords lock the user on that network only; the account locks after many from everywhere", async () => {
  for (let i = 0; i < 5; i++) await rejects(login("sara", "wrong", { ip: "198.51.100.7" }), "unauthenticated");
  // The guessing network is locked out, even with the right password.
  await rejects(login("sara", PW, { ip: "198.51.100.7" }), "unauthenticated");
  // Sara at her own branch still signs in.
  const ok = await login("sara", PW, { ip: "10.1.1.20" });
  assert.ok(ok.token);
  // Guessing spread over many networks still locks the whole account.
  await adminQuery("UPDATE setting SET value = '6' WHERE key = 'security.max_failed_logins_all_networks' AND branch_id IS NULL");
  for (let i = 0; i < 6; i++) await rejects(login("omar", "wrong", { ip: `203.0.113.${i}` }), "unauthenticated");
  await rejects(login("omar", PW, { ip: "10.1.1.30" }), "unauthenticated");
  const [u] = await adminQuery("SELECT locked_until > now() locked FROM app_user WHERE username = 'omar'");
  assert.equal(u.locked, true);
});

test("SEC-07: a session ends a fixed time after sign-in, even when in use", async () => {
  const { token } = await login("priya", PW, { ip: "10.1.1.40" });
  assert.ok(await sessionCtx(token));
  await adminQuery("UPDATE session SET created_at = now() - interval '13 hours' WHERE user_id = (SELECT id FROM app_user WHERE username = 'priya')");
  assert.equal(await sessionCtx(token), null);
});

test("SEC-05: public form limits are kept in the database and hold under parallel posts", async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => allow("test", "192.0.2.50", 5, 60_000)));
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(await allow("test", "192.0.2.51", 5, 60_000), true); // another address is not affected
});

test("SEC-04: refusals carry the HTTP status Next.js answers with", () => {
  assert.equal(new AppError("forbidden", "x").digest, "NEXT_HTTP_ERROR_FALLBACK;403");
  assert.equal(new AppError("not_found", "x").digest, "NEXT_HTTP_ERROR_FALLBACK;404");
  assert.equal(new AppError("validation", "x").digest, undefined);
});
