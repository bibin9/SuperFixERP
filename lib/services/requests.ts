import crypto from "node:crypto";
import type { PoolClient } from "pg";
import type { Ctx } from "../access";
import { conflict, invalid } from "../errors";

/**
 * One posting, once (CONC-01, CONC-03, CONC-04). Call first thing inside the posting transaction.
 * Returns null when this request owns the key and should post; returns the first result when the
 * same request was already posted (marked duplicate). A concurrent request with the same key waits
 * on the first one's claim, so it never sees a half-done posting or a raw unique-key error.
 */
export async function claimRequest<T extends object>(c: PoolClient, ctx: Ctx, key: unknown, kind: string, payload: unknown): Promise<(T & { duplicate: true }) | null> {
  const k = typeof key === "string" ? key.trim() : "";
  if (k.length < 16 || k.length > 100) throw invalid("This form is out of date. Reload the page and try again.");
  const hash = crypto.createHash("sha256").update(JSON.stringify([kind, ctx.userId, payload])).digest("hex");
  const won = await c.query(
    "INSERT INTO post_request (request_key, kind, request_hash, user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (request_key) DO NOTHING RETURNING request_key",
    [k, kind, hash, ctx.userId]);
  if (won.rowCount) return null;
  const prior = (await c.query("SELECT kind, request_hash, result FROM post_request WHERE request_key = $1", [k])).rows[0];
  if (!prior || prior.kind !== kind || prior.request_hash !== hash)
    throw conflict("This form was already used for a different request. Reload the page and enter it again.");
  if (!prior.result) throw conflict("This request is still being saved. Wait a moment and reload the page.");
  return { ...(prior.result as T), duplicate: true };
}

/** Stores what the posting returned, so a replay of the same key gets the same answer. */
export async function finishRequest<T>(c: PoolClient, key: unknown, result: T): Promise<T> {
  await c.query("UPDATE post_request SET result = $2 WHERE request_key = $1", [String(key).trim(), JSON.stringify(result)]);
  return result;
}

/** Locks the job card first, so every posting path takes job, then invoice, then number series (CONC-02). */
export async function lockJobFirst(c: PoolClient, jobId: string | null | undefined) {
  if (jobId) await c.query("SELECT id FROM job_card WHERE id = $1 FOR UPDATE", [jobId]);
}
