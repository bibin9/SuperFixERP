import { requireCtx } from "@/lib/session";
import { ownerOverview, ownerEnquiries, ownerBranchDetails, Range } from "@/lib/services/owner";
import { STATUS_LABEL } from "@/lib/services/jobs";
import { Icon } from "@/components/Icon";
import { Link, Money, PageHead } from "@/components/ui";

type SP = Record<string, string | undefined>;
const RANGES: [Range, string][] = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];
const VIEWS: [string, string][] = [["overview", "Overview"], ["enquiries", "Enquiries by branch"], ["branches", "Branch details"]];
// Categorical order (fixed, never cycled): one colour per job status on site.
const STATUS_ORDER = ["approved", "awaiting_parts", "in_progress", "quality_check", "ready"];
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
const dmy = (d: string) => d.split("-").reverse().join("/");
const mins = (m: number | null) => (m === null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

export default async function OwnerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const range = (RANGES.some(([r]) => r === sp.range) ? sp.range : "today") as Range;
  const view = VIEWS.some(([v]) => v === sp.view) ? sp.view! : "overview";
  const branch = sp.branch && sp.branch !== "all" ? sp.branch : undefined;
  const href = (p: Partial<{ range: string; view: string; branch: string; sort: string }>) => {
    const q = new URLSearchParams();
    const r = p.range ?? range, v = p.view ?? view, b = p.branch === undefined ? branch : p.branch;
    if (r !== "today") q.set("range", r);
    if (v !== "overview") q.set("view", v);
    if (b && b !== "all") q.set("branch", b);
    if (p.sort) q.set("sort", p.sort);
    const s = q.toString();
    return `/owner${s ? `?${s}` : ""}`;
  };
  const head = view === "enquiries" ? await ownerEnquiries(ctx, range, branch) : view === "branches" ? await ownerBranchDetails(ctx, range, branch) : await ownerOverview(ctx, range, branch);
  const scopeName = head.chosen.length === head.all.length && head.all.length > 1 ? "all branches" : head.chosen.map((b) => b.name_en).join(", ");
  const span = range === "today" ? "today" : range === "7d" ? "last 7 days" : "last 30 days";
  return (
    <div className="owner">
      <PageHead title={`Owner dashboard: ${scopeName}`} sub={`Live · ${range === "today" ? dmy(head.to) : `${dmy(head.from)} to ${dmy(head.to)}`} · ${head.chosen.length} branch${head.chosen.length === 1 ? "" : "es"}`}>
        <div className="seg" role="group" aria-label="Period">
          {RANGES.map(([r, l]) => <Link key={r} href={href({ range: r })} className={r === range ? "on" : ""} aria-current={r === range ? "true" : undefined}>{l}</Link>)}
        </div>
        {head.all.length > 1 && (
          <form className="ownerpick" action="/owner">
            {range !== "today" && <input type="hidden" name="range" value={range} />}
            {view !== "overview" && <input type="hidden" name="view" value={view} />}
            <select name="branch" aria-label="Branch" defaultValue={branch ?? "all"}>
              <option value="all">All {head.all.length} branches</option>
              {head.all.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}
            </select>
            <button className="btn ghost sm">Show</button>
          </form>
        )}
      </PageHead>
      <nav className="tabs" aria-label="Dashboard views">
        {VIEWS.map(([v, l]) => <Link key={v} href={href({ view: v })} className={v === view ? "on" : ""} aria-current={v === view ? "page" : undefined}>{l}</Link>)}
      </nav>
      {view === "overview" && <Overview d={head as Awaited<ReturnType<typeof ownerOverview>>} href={href} span={span} cur={ctx.currentBranchId} />}
      {view === "enquiries" && <Enquiries d={head as Awaited<ReturnType<typeof ownerEnquiries>>} href={href} span={span} sort={sp.sort} />}
      {view === "branches" && <Branches d={head as Awaited<ReturnType<typeof ownerBranchDetails>>} href={href} sort={sp.sort} />}
      {!head.showMoney && <p className="small muted" style={{ marginTop: 12 }}>Sales and money figures are hidden: your role does not see selling prices.</p>}
    </div>
  );
}

type Href = (p: Partial<{ range: string; view: string; branch: string; sort: string }>) => string;

function Tile({ label, icon, tone, value, note, noteTone, testid }: { label: string; icon: string; tone: string; value: React.ReactNode; note?: React.ReactNode; noteTone?: string; testid?: string }) {
  return (
    <div className="otile" data-testid={testid}>
      <div className="otile-h"><span>{label}</span><span className={`qi ${tone}`}><Icon name={icon} size={18} /></span></div>
      <div className="otile-v">{value}</div>
      {note !== undefined && <div className={`otile-n ${noteTone ?? ""}`}>{note}</div>}
    </div>
  );
}

/** Vertical bars, one per branch. Single series, so one colour; the user's own branch is marked in red and named below. */
function BranchBars({ rows, value, href, cur, fmt = k }: { rows: { id: string; code: string; name_en: string }[]; value: (id: string) => number; href: (id: string) => string; cur: string | null; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => value(r.id)));
  return (
    <div className="obars" role="list">
      {rows.map((r) => {
        const v = value(r.id);
        return (
          <Link key={r.id} href={href(r.id)} className={`obar${r.id === cur ? " cur" : ""}`} role="listitem" title={`${r.name_en}: ${fmt(v)}`} aria-label={`${r.name_en}: ${fmt(v)}`}>
            <span className="obar-v">{v ? fmt(v) : ""}</span>
            <span className="obar-col"><span style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%` }} /></span>
            <span className="obar-l">{r.code}</span>
          </Link>
        );
      })}
    </div>
  );
}

function HBars({ rows, max, tone }: { rows: { label: string; v: number; text?: string; tone?: string }[]; max?: number; tone?: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="ohbars">
      {rows.map((r) => (
        <div className="ohbar" key={r.label}>
          <span className="ohbar-l">{r.label}</span>
          <span className="ohbar-t"><span className={r.tone ?? tone ?? ""} style={{ width: `${Math.max(2, (r.v / m) * 100)}%` }} /></span>
          <b className="num">{r.text ?? r.v}</b>
        </div>
      ))}
    </div>
  );
}

function Donut({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  const R = 15.9155, C = 100; // circumference 100 so dash lengths are percentages
  let off = 0;
  return (
    <div className="odonut">
      <svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label={`Cars on site: ${total}`}>
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
        {total > 0 && parts.filter((p) => p.n > 0).map((p) => {
          const len = (p.n / total) * C;
          // a 0.6 gap between segments keeps neighbours apart
          const el = <circle key={p.label} cx="21" cy="21" r={R} fill="none" stroke={p.color} strokeWidth="6" strokeDasharray={`${Math.max(0.1, len - 0.6)} ${C - Math.max(0.1, len - 0.6)}`} strokeDashoffset={25 - off}><title>{`${p.label}: ${p.n}`}</title></circle>;
          off += len;
          return el;
        })}
        <text x="21" y="22.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="var(--ink)">{total}</text>
      </svg>
      <ul className="olegend">
        {parts.map((p) => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b className="num">{p.n}</b></li>)}
      </ul>
    </div>
  );
}

function Overview({ d, href, span, cur }: { d: Awaited<ReturnType<typeof ownerOverview>>; href: Href; span: string; cur: string | null }) {
  const t = d.tiles;
  const sales = new Map(d.branches.map((b) => [b.id, Number(b.sales ?? 0)]));
  const cars = new Map(d.branches.map((b) => [b.id, b.cars_in]));
  const onSite = new Map(d.onSite.map((s) => [s.status, s.n]));
  const lastWeek = d.range === "today" ? `last ${d.dow}` : "the week before";
  const top = d.funnel?.enquiries || 0;
  return (
    <>
      <div className="otiles" data-testid="owner-tiles">
        <Tile testid="t-sales" label={`Sales ${span}`} icon="cash" tone="red" value={d.showMoney ? <>AED <Money v={t.sales} /></> : "—"}
          note={t.salesChange === null ? (d.showMoney ? "No sales a week earlier to compare" : undefined) : `${t.salesChange > 0 ? "+" : ""}${t.salesChange}% vs ${lastWeek}`} noteTone={t.salesChange === null ? "" : t.salesChange >= 0 ? "up" : "down"} />
        <Tile testid="t-cars" label="Cars in / out" icon="car" tone="blue" value={`${t.carsIn} / ${t.carsOut}`} note={`${t.onSite} still on site`} />
        <Tile testid="t-ontime" label="On-time delivery" icon="clock" tone="green" value={pct(t.onTime)} note={`Target ${d.target}%`} noteTone={t.onTime !== null && t.onTime < d.target ? "down" : ""} />
        <Tile testid="t-late" label="Late right now" icon="alert" tone="red" value={t.late} note={t.lateNoReason ? `${t.lateNoReason} still need a delay reason` : t.late ? "All have a delay reason" : "Nothing is late"} noteTone={t.lateNoReason ? "down" : ""} />
        <Tile testid="t-cash" label={`Cash collected ${span}`} icon="wallet" tone="violet" value={d.showMoney ? <>AED <Money v={t.cash} /></> : "—"}
          note={t.cashSplit.length ? t.cashSplit.slice(0, 3).map((x) => `${x.method[0].toUpperCase()}${x.method.slice(1).replace(/_/g, " ")} ${x.pct}%`).join(" · ") : d.showMoney ? "Nothing collected yet" : undefined} />
      </div>

      <div className="ogrid2">
        <section className="card" data-testid="sales-by-branch">
          <div className="ocard-h"><h2>{d.showMoney ? "Sales" : "Cars in"} by branch, {span}</h2>{d.chosen.length > 1 && <span className="small muted">Click a bar to open that branch</span>}</div>
          <BranchBars rows={d.chosen} value={(id) => (d.showMoney ? sales.get(id) ?? 0 : cars.get(id) ?? 0)} href={(id) => href({ branch: id })} cur={cur} fmt={d.showMoney ? k : String} />
          <p className="small muted">Hover a bar for the branch name{d.chosen.some((b) => b.id === cur) ? " · red is your current branch" : ""}.</p>
        </section>
        <section className="card" data-testid="on-site">
          <h2>Cars on site by status</h2>
          <Donut parts={STATUS_ORDER.map((s, i) => ({ label: STATUS_LABEL[s] ?? s, n: onSite.get(s) ?? 0, color: SERIES[i] }))} />
        </section>
      </div>

      <div className="ogrid3">
        <section className="card" data-testid="delays">
          <h2>Delays by reason, last 7 days</h2>
          {d.delays.length ? <HBars rows={d.delays.map((x, i) => ({ label: x.reason, v: x.n, tone: i === 0 ? "amber" : "grey" }))} /> : <p className="muted">No delays recorded.</p>}
        </section>
        <section className="card" data-testid="ontime-branches">
          <h2>On-time delivery by branch</h2>
          {d.lowestOnTime.length ? <HBars max={100} rows={d.lowestOnTime.map((b) => ({ label: b.name_en, v: b.on_time!, text: `${b.on_time}%`, tone: b.on_time! < d.target - 5 ? "red" : b.on_time! < d.target ? "amber" : "green" }))} />
            : <p className="muted">No cars finished in this period.</p>}
          {d.chosen.length > 6 && <p className="small muted">Lowest six branches shown</p>}
        </section>
        <section className="card" data-testid="late-jobs">
          <h2>Late jobs now</h2>
          {d.late.length ? <ul className="olate">{d.late.map((j) => (
            <li key={j.id}><Link href={`/jobs/${j.id}`} className="pill red">{j.doc_no}</Link><span className="what">{j.what || "Job"}</span>
              <span className={j.reason ? "small muted" : "small late-t"}>{j.reason ?? "No reason yet"}</span></li>))}</ul>
            : <p className="muted">Nothing is late.</p>}
        </section>
      </div>

      <div className="ogrid2">
        <section className="card" data-testid="funnel">
          <h2>Enquiry to invoice, {span}</h2>
          <div className="funnel">
            {([["enquiries", "Enquiries"], ["quoted", "Quoted"], ["approved", "Approved by customer"], ["job_cards", "Job cards"], ["invoiced", "Invoiced"]] as const).map(([key, l]) => {
              const v = d.funnel?.[key] ?? 0;
              return <div className="step" key={key}><div className="v">{v}</div><div className="l">{l}{key !== "enquiries" && top ? ` · ${Math.round((v / top) * 100)}%` : ""}</div><div className="bar" style={{ width: `${Math.max(4, top ? (v / top) * 100 : 0)}%` }} /></div>;
            })}
          </div>
          <p className="small muted"><Link href={href({ view: "enquiries" })}>Enquiries by branch</Link></p>
        </section>
        <section className="card" data-testid="low-stock">
          <h2>Stock running low</h2>
          {d.low.length ? <div className="tablewrap"><table className="report"><thead><tr><th>Part</th><th>Branch</th><th className="num">Free</th><th className="num" title="Reorder level">Min</th></tr></thead>
            <tbody>{d.low.map((x, i) => <tr key={i}><td>{x.description}</td><td>{x.code}</td><td className="num" style={{ color: Number(x.free) <= 0 ? "var(--late)" : undefined }}>{Number(x.free)}</td><td className="num">{Number(x.reorder_level)}</td></tr>)}</tbody></table></div>
            : <p className="muted">Nothing below its reorder level.</p>}
          <p className="small muted"><Link href="/stock">Open stock</Link></p>
        </section>
      </div>

      <section className="card" data-testid="by-emirate" style={{ marginTop: 16 }}>
        <h2>By emirate</h2>
        <div className="tablewrap"><table className="report"><thead><tr><th>Emirate</th><th className="num">Branches</th>{d.showMoney && <th className="num">Sales {span} (AED)</th>}<th className="num">Cars in</th><th className="num">On time</th></tr></thead>
          <tbody>{d.emirates.map((e) => <tr key={e.emirate ?? "none"}><td><b>{e.emirate ?? "Not set"}</b></td><td className="num">{e.branches}</td>{d.showMoney && <td className="num"><Money v={e.sales} /></td>}<td className="num">{e.cars_in}</td><td className="num">{pct(e.on_time)}</td></tr>)}</tbody></table></div>
      </section>
    </>
  );
}

const SOURCES = [["whatsapp", "WhatsApp"], ["phone", "Phone"], ["walk_in", "Walk-in"], ["website", "Website"], ["other", "Other"]] as const;

function Enquiries({ d, href, span, sort }: { d: Awaited<ReturnType<typeof ownerEnquiries>>; href: Href; span: string; sort?: string }) {
  const sorts: [string, string][] = [["most", "Most enquiries"], ["conv", "Best conversion"], ["lost", "Most lost"], ["reply", "Fastest reply"]];
  const s = sorts.some(([x]) => x === sort) ? sort! : "most";
  const rows = [...d.rows].sort((a, b) => s === "conv" ? (b.conversion ?? -1) - (a.conversion ?? -1) : s === "lost" ? b.lost - a.lost : s === "reply" ? (a.reply_min ?? 1e9) - (b.reply_min ?? 1e9) : b.enquiries - a.enquiries);
  const t = d.totals;
  const one = d.chosen.length === 1;
  return (
    <>
      <div className="otiles" data-testid="enq-tiles">
        <Tile label={`Enquiries ${span}`} icon="chat" tone="blue" value={t.enquiries} />
        <Tile label="Turned into jobs" icon="job" tone="green" value={pct(t.conversion)} note={`${t.converted} jobs · target ${d.target}%`} noteTone={t.conversion !== null && t.conversion < d.target ? "down" : "up"} />
        <Tile label="Lost" icon="undo" tone="red" value={t.lost} />
        <Tile label="First reply, average" icon="clock" tone="violet" value={mins(t.reply_min)} />
        <Tile label="Still open" icon="inbox" tone="amber" value={t.open} note={<Link href="/enquiries">Open enquiries</Link>} />
      </div>
      {!one && (
        <section className="card" style={{ marginTop: 16 }} data-testid="enq-bars">
          <div className="ocard-h"><h2>Enquiries and jobs by branch</h2><span className="small muted"><i className="key grey" /> All enquiries <i className="key green" /> Became a job</span></div>
          <div className="obars two" role="list">
            {d.rows.map((r) => {
              const max = Math.max(1, ...d.rows.map((x) => x.enquiries));
              return (
                <Link key={r.id} href={href({ branch: r.id })} className="obar" role="listitem" title={`${r.name_en}: ${r.enquiries} enquiries, ${r.converted} jobs`}>
                  <span className="obar-v">{r.enquiries || ""}</span>
                  <span className="obar-col"><span className="grey" style={{ height: `${(r.enquiries / max) * 100}%` }} /><span className="green" style={{ height: `${(r.converted / max) * 100}%` }} /></span>
                  <span className="obar-l">{r.code}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <section className="card" style={{ marginTop: 16 }} data-testid="enq-table">
        <div className="ocard-h"><h2>Branch by branch</h2>
          <div className="seg sm">{sorts.map(([x, l]) => <Link key={x} href={href({ sort: x })} className={x === s ? "on" : ""}>{l}</Link>)}</div></div>
        <div className="tablewrap"><table className="report"><thead><tr><th>Branch</th>{SOURCES.map(([, l]) => <th key={l} className="num">{l}</th>)}<th className="num">Enquiries</th><th className="num">Became jobs</th><th className="num">Conversion</th><th className="num">Lost</th><th className="num">First reply</th><th className="num">Open</th>{d.showMoney && <th className="num">Job value (AED)</th>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={href({ branch: r.id })}><b>{r.code}</b> {r.name_en}</Link></td>
            {SOURCES.map(([key]) => <td key={key} className="num">{r[key]}</td>)}
            <td className="num"><b>{r.enquiries}</b></td><td className="num">{r.converted}</td>
            <td className="num" style={{ color: r.conversion !== null && r.conversion < d.target ? "var(--late)" : undefined }}>{pct(r.conversion)}</td>
            <td className="num">{r.lost}</td><td className="num">{mins(r.reply_min)}</td><td className="num">{r.open}</td>
            {d.showMoney && <td className="num"><Money v={r.job_value} /></td>}</tr>)}</tbody></table></div>
      </section>
      <div className="ogrid2">
        <section className="card"><h2>What customers ask for</h2>
          {d.asked.length ? <HBars tone="blue" rows={d.asked.map((a) => ({ label: a.what, v: a.n }))} /> : <p className="muted">No enquiries in this period.</p>}</section>
        <section className="card"><h2>Why enquiries are lost</h2>
          {d.lost.length ? <HBars tone="red" rows={d.lost.map((a) => ({ label: a.reason, v: a.n }))} /> : <p className="muted">None lost in this period.</p>}</section>
      </div>
      {one && (
        <section className="card" style={{ marginTop: 16 }} data-testid="enq-open">
          <div className="ocard-h"><h2>Open enquiries now</h2><Link className="btn ghost sm" href="/enquiries">Go to Enquiries</Link></div>
          {d.openList.length ? <table className="report"><thead><tr><th>No.</th><th>Customer</th><th>Asking for</th><th>Source</th><th>Received</th></tr></thead>
            <tbody>{d.openList.map((e) => <tr key={e.id}><td><Link href={`/enquiries/${e.id}`}>{e.doc_no}</Link></td><td>{e.who}</td><td>{e.what}</td><td>{String(e.source).replace("_", "-")}</td><td>{e.at}</td></tr>)}</tbody></table>
            : <p className="muted">No open enquiries.</p>}
        </section>
      )}
    </>
  );
}

function Branches({ d, href, sort }: { d: Awaited<ReturnType<typeof ownerBranchDetails>>; href: Href; sort?: string }) {
  const sorts: [string, string][] = [["sales", d.showMoney ? "Sales" : "Cars in"], ["bay", "Bay use"], ["spend", "Average spend"], ["ontime", "On time"]].filter(([x]) => d.showMoney || x !== "spend") as [string, string][];
  const s = sorts.some(([x]) => x === sort) ? sort! : "sales";
  const v = (r: (typeof d.rows)[number]) => s === "bay" ? r.bay_use ?? -1 : s === "spend" ? r.avg_spend ?? -1 : s === "ontime" ? r.on_time ?? -1 : d.showMoney ? Number(r.sales ?? 0) : r.cars_in;
  const rows = [...d.rows].sort((a, b) => v(b) - v(a));
  const t = d.totals;
  const one = d.rows.length === 1 ? d.rows[0] : null;
  return (
    <>
      <div className="otiles" data-testid="br-tiles">
        <Tile label="Bays and technicians" icon="build" tone="blue" value={`${t.bays} / ${t.technicians}`} />
        <Tile label="Bay use" icon="clock" tone="green" value={pct(t.bay_use)} note="Clocked hours against bay hours" />
        <Tile label="Active customers" icon="users" tone="violet" value={t.active} note={`${t.new} new · ${pct(t.returning)} returning`} />
        <Tile label="Average spend" icon="cash" tone="red" value={d.showMoney ? <>AED <Money v={t.avg_spend} /></> : "—"} note="Per invoice, before VAT" />
        <Tile label="On time" icon="check" tone="amber" value={pct(t.on_time)} />
      </div>
      {one && (
        <section className="card" style={{ marginTop: 16 }} data-testid="br-one">
          <h2>{one.name_en}</h2>
          <dl className="dl">
            <dt>Emirate</dt><dd>{one.emirate ?? "Not set"}</dd>
            <dt>Opening hours</dt><dd>{one.opening_hours ? String(one.opening_hours) : "Not set"}</dd>
            <dt>Job card series</dt><dd>{one.series ?? "—"}</dd>
          </dl>
        </section>
      )}
      <section className="card" style={{ marginTop: 16 }} data-testid="br-table">
        <div className="ocard-h"><h2>Branch by branch</h2><div className="seg sm">{sorts.map(([x, l]) => <Link key={x} href={href({ sort: x })} className={x === s ? "on" : ""}>{l}</Link>)}</div></div>
        <div className="tablewrap"><table className="report"><thead><tr><th>Branch</th><th className="num">Bays</th><th className="num">Technicians</th>{d.showMoney && <th className="num">Sales (AED)</th>}<th className="num">Cars in</th><th className="num">On time</th><th className="num">Bay use</th><th className="num">Active customers</th><th className="num">New</th><th className="num">Returning</th>{d.showMoney && <th className="num">Average spend (AED)</th>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={href({ branch: r.id })}><b>{r.code}</b> {r.name_en}</Link></td><td className="num">{r.bays}</td><td className="num">{r.technicians}</td>
            {d.showMoney && <td className="num"><Money v={r.sales} /></td>}<td className="num">{r.cars_in}</td><td className="num">{pct(r.on_time)}</td><td className="num">{pct(r.bay_use)}</td>
            <td className="num">{r.active_customers}</td><td className="num">{r.new_customers}</td><td className="num">{pct(r.returning)}</td>{d.showMoney && <td className="num"><Money v={r.avg_spend} /></td>}</tr>)}</tbody></table></div>
      </section>
    </>
  );
}
