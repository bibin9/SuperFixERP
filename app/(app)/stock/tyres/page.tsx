import { requireCtx } from "@/lib/session";
import { tyreStock, findSerial } from "@/lib/services/tyres";
import { Flash, Link, PageHead } from "@/components/ui";
import { StockTabs } from "@/components/StockTabs";

const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");

export default async function Tyres({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const serial = (sp.serial ?? "").trim();
  const [t, found] = await Promise.all([tyreStock(ctx), serial ? findSerial(ctx, serial) : Promise.resolve([])]);
  const oldCount = t.items.filter((i) => i.old).length;
  return (
    <>
      <PageHead title="Tyres and batteries" sub="Tyre stock by size and DOT (week and year made), oldest first. Look up a fitted battery or tyre by its serial number to check warranty." />
      <StockTabs at="/stock/tyres" />
      <Flash sp={sp} />
      <div className="card">
        <h2>Warranty check by serial</h2>
        <form className="row" method="get"><div className="field"><label htmlFor="serial">Serial number</label><input id="serial" name="serial" defaultValue={serial} placeholder="At least 3 characters" /></div>
          <div className="shrink"><button className="btn">Check</button></div></form>
        {serial && (found.length ? (
          <table style={{ marginTop: 10 }}><thead><tr><th>Serial</th><th>Part</th><th>Fitted</th><th>Vehicle and customer</th><th>Warranty</th></tr></thead>
            <tbody>{found.map((r) => (
              <tr key={r.serial_no + r.part_no}><td><b>{r.serial_no}</b></td><td>{r.part_no}<div className="small muted">{r.description}</div></td>
                <td>{day(r.fitted_on)}{r.job_id && <div className="small"><Link href={`/jobs/${r.job_id}`}>{r.job_no}</Link></div>}</td>
                <td className="small">{[r.plate_code, r.plate_number].filter(Boolean).join(" ")} {r.make} {r.model}<div className="muted">{r.customer_name}</div></td>
                <td>{r.warranty_until ? (r.under_warranty ? <span className="pill green">Under warranty to {day(r.warranty_until)}</span> : <span className="pill red">Ended {day(r.warranty_until)}</span>) : <span className="muted">No warranty</span>}</td></tr>
            ))}</tbody></table>
        ) : <p className="muted small" style={{ marginTop: 8 }}>No battery or tyre with serial starting “{serial}”.</p>)}
      </div>
      {oldCount > 0 && <div className="callout warn"><b>{oldCount} tyre size{oldCount === 1 ? "" : "s"} have stock older than {t.maxYears} years.</b> Sell or return these first.</div>}
      <div className="card">
        <h2>Tyre stock by DOT</h2>
        <table><thead><tr><th>Tyre</th><th>Size</th><th>Load / speed</th><th className="num">On hand</th><th>By DOT (oldest first)</th></tr></thead>
          <tbody>{t.items.map((i) => (
            <tr key={i.id}><td><b>{i.part_no}</b><div className="small muted">{i.brand ? `${i.brand} · ` : ""}{i.description}</div></td>
              <td>{i.tyre_size ?? <span className="muted">—</span>}</td><td>{[i.load_index, i.speed_index].filter(Boolean).join(" ") || <span className="muted">—</span>}</td>
              <td className="num">{Number(i.on_hand)}</td>
              <td className="small">{i.dots.map((d) => <span key={d.dot} className={`pill ${d.old ? "red" : ""}`} style={{ marginRight: 4 }} title={d.old ? `Older than ${t.maxYears} years` : undefined}>{d.dot} × {Number(d.qty)}</span>)}
                {Number(i.untracked) > 0 && <span className="muted">{Number(i.untracked)} with no DOT recorded</span>}
                {!i.dots.length && Number(i.untracked) <= 0 && <span className="muted">—</span>}</td></tr>
          ))}
          {!t.items.length && <tr><td colSpan={5} className="muted">No tyres in the parts list. Set a part&apos;s category to Tyres.</td></tr>}</tbody></table>
        <p className="small muted">The DOT is entered when tyres are received on a purchase order. Tyres leave stock oldest DOT first.</p>
      </div>
    </>
  );
}
