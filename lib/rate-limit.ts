import { withAnonTx } from "./db";

/**
 * Per-address limit for public forms (PEN-07): at most `max` uses per `windowMs` from one network address.
 * SEC-05: counted in the database (rate_hit), so the limit survives restarts and is shared by every app server.
 */
export async function allow(bucket: string, ip: string, max: number, windowMs: number): Promise<boolean> {
  return withAnonTx(async (c) => {
    // One writer at a time per address and form, so a burst of parallel posts cannot slip past the count.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${bucket}:${ip}`]);
    await c.query("DELETE FROM rate_hit WHERE bucket = $1 AND key = $2 AND at <= now() - make_interval(secs => $3)", [bucket, ip, windowMs / 1000]);
    const n = Number((await c.query("SELECT count(*) n FROM rate_hit WHERE bucket = $1 AND key = $2", [bucket, ip])).rows[0].n);
    if (n >= max) return false;
    await c.query("INSERT INTO rate_hit (bucket, key) VALUES ($1, $2)", [bucket, ip]);
    return true;
  });
}
