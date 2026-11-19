import Link from "next/link";
import { Icon } from "@/components/Icon";

type Chip = [key: string, label: string, count?: number];

/** Toolbar over a list: search, List/Cards switch and status chips with counts, all kept in the address. */
export function ListToolbar({ base, sp, chips, placeholder, shown, total, cards = true }: {
  base: string; sp: Record<string, string>; chips: Chip[]; placeholder: string; shown: number; total?: number; cards?: boolean;
}) {
  const status = sp.status ?? "";
  const view = sp.view === "cards" ? "cards" : "list";
  const href = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const all = { status, q: sp.q, view: view === "cards" ? "cards" : undefined, ...p };
    for (const [k, v] of Object.entries(all)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <div className="card toolbar">
      <div className="tb-row">
        <form className="tb-search" action={base} role="search">
          <Icon name="search" size={18} className="sicon" />
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder={placeholder} aria-label={placeholder} />
          {status && <input type="hidden" name="status" value={status} />}
          {view === "cards" && <input type="hidden" name="view" value="cards" />}
        </form>
        {cards && (
          <div className="seg" role="group" aria-label="View">
            <Link href={href({ view: undefined })} className={view === "list" ? "on" : ""} aria-pressed={view === "list"}><Icon name="list" size={16} /> List</Link>
            <Link href={href({ view: "cards" })} className={view === "cards" ? "on" : ""} aria-pressed={view === "cards"}><Icon name="grid" size={16} /> Cards</Link>
          </div>
        )}
      </div>
      <div className="tb-row">
        <div className="tabs chips">
          {chips.map(([k, label, n]) => (
            <Link key={k || "all"} className={status === k ? "on" : ""} href={href({ status: k || undefined })}>{label}{n !== undefined && <> <span className="cnt">{n}</span></>}</Link>
          ))}
        </div>
        <span className="muted small tb-count">{shown}{total !== undefined && total !== shown ? ` of ${total}` : ""} shown</span>
      </div>
    </div>
  );
}
