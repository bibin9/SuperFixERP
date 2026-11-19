import Link from "next/link";
import { CHUNK } from "@/lib/paging";

/** Links under a long list to the older and newer blocks of rows the server holds (see lib/paging.ts). */
export function OlderRows({ rows, base, sp }: { rows: { more: boolean; offset: number; length: number }; base: string; sp: Record<string, string | string[] | undefined> }) {
  if (!rows.more && !rows.offset) return null;
  const block = rows.offset / CHUNK;
  const href = (b: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "older" && typeof v === "string" && v) u.set(k, v);
    if (b > 0) u.set("older", String(b));
    const s = u.toString(); return s ? `${base}?${s}` : base;
  };
  return (
    <div className="olderrows no-print">
      <span>Rows {(rows.offset + 1).toLocaleString("en-GB")}–{(rows.offset + rows.length).toLocaleString("en-GB")}{rows.more ? ", older rows exist" : ""}</span>
      <span className="olr-nav">
        {block > 0 && <Link className="btn ghost sm" href={href(block - 1)}>‹ Newer {CHUNK}</Link>}
        {rows.more && <Link className="btn ghost sm" href={href(block + 1)}>Older {CHUNK} ›</Link>}
      </span>
    </div>
  );
}
