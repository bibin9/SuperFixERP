export type LoadRow = { id: string; name: string; capacity: number; booked: number; planned: number; total: number };
const h = (v: number) => (Math.round(v * 100) / 100).toString();

/** Hours taken against capacity, one bar per bay or technician. Red when over, amber from 85%. */
export function LoadBars({ title, rows, selected, adding = 0 }: { title: string; rows: LoadRow[]; selected?: string; adding?: number }) {
  return (
    <div className="loadbars">
      <h3>{title}</h3>
      {!rows.length && <p className="small muted">None set up for this branch.</p>}
      {rows.map((r) => {
        const extra = r.id === selected ? adding : 0;
        const total = r.total + extra;
        const pct = r.capacity ? (total / r.capacity) * 100 : 0;
        const cls = pct > 100 + 1e-9 ? "over" : pct >= 85 ? "near" : "";
        return (
          <div key={r.id} className={`loadrow ${cls} ${r.id === selected ? "sel" : ""}`} data-testid={`load-${r.name}`}>
            <span className="lname">{r.name}</span>
            <span className="lbar" role="img" aria-label={`${h(total)} of ${h(r.capacity)} hours`}>
              <i className="b" style={{ width: `${Math.min(100, (r.booked / (r.capacity || 1)) * 100)}%` }} />
              <i className="p" style={{ width: `${Math.min(100, (r.planned / (r.capacity || 1)) * 100)}%` }} />
              {extra > 0 && <i className="n" style={{ width: `${Math.min(100, (extra / (r.capacity || 1)) * 100)}%` }} />}
            </span>
            <span className="lnum">{h(total)} / {h(r.capacity)} h{cls === "over" && <b> · over by {h(total - r.capacity)}</b>}</span>
          </div>
        );
      })}
    </div>
  );
}
