/**
 * Server paging for long lists. The server sends the list in blocks of CHUNK rows (newest first); the screen pages
 * inside a block (ListPager) and the "Older" / "Newer" links under the list move between blocks. A block is fetched
 * with one extra row to know whether older rows exist, so no count query is needed.
 */
export const CHUNK = 300;
export type Chunk<T> = T[] & { more: boolean; offset: number };

/** Row offset from the address (?older=N blocks back). Always a whole number, so it is safe in SQL. */
export function offsetOf(sp?: { older?: string | string[] } | null): number {
  const v = Number(Array.isArray(sp?.older) ? sp?.older[0] : sp?.older);
  return Number.isInteger(v) && v > 0 && v < 100000 ? v * CHUNK : 0;
}
/** SQL tail for one block: LIMIT and OFFSET from a checked whole number. */
export const blockSql = (offset: number) => `LIMIT ${CHUNK + 1} OFFSET ${Math.max(0, Math.floor(offset))}`;
export function toChunk<T>(rows: T[], offset: number): Chunk<T> {
  const r = rows.slice(0, CHUNK) as Chunk<T>;
  r.more = rows.length > CHUNK; r.offset = offset;
  return r;
}
