/**
 * Simple per-address limit for public forms (PEN-07): at most `max` uses per `windowMs` from one network address.
 * Kept in memory on the server, so it resets when the app restarts; enough to stop one phone or script flooding a form.
 */
const hits = new Map<string, number[]>();
export function allow(bucket: string, ip: string, max: number, windowMs: number): boolean {
  const now = Date.now(), key = `${bucket}:${ip}`;
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now); hits.set(key, list);
  if (hits.size > 50_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
