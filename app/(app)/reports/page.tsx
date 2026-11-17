import { requireCtx } from "@/lib/session";
import { AppError, forbidden } from "@/lib/errors";
import { ownerDashboard, canOpenReport, visibleReports } from "@/lib/services/reports";
import { myWidgets } from "@/lib/services/report-saved";
import { Flash, Link, Money, PageHead } from "@/components/ui";
import { ReportTable, ChartFor, qs } from "@/components/ReportView";
import { unpinReportAction } from "@/app/actions-reports";
import { PrintButton } from "@/components/PrintButton";

type Dash = Awaited<ReturnType<typeof ownerDashboard>>;

export default async function ReportsHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!visibleReports(ctx).length) throw forbidden();
  let dash: Dash | null = null, err: string | null = null;
  if (canOpenReport(ctx, { module: "jobs" })) {
    try { dash = await ownerDashboard(ctx, sp); } catch (e) { if (e instanceof AppError && e.code === "validation") err = e.message; else throw e; }
  }
  const widgets = await myWidgets(ctx);
  const q = qs(sp, ["from", "to"]);
  const drill = (code: string, b: string, extra = "") => `/reports/run/${code}?branches=${b}${dash ? `&from=${dash.from}&to=${dash.to}` : ""}${extra}`;
  return (
    <>
      <PageHead title="Reports dashboard" sub="Today and the period chosen, by branch. Click a branch figure to open the report behind it.">
        <Link className="btn ghost sm" href="/reports/all">All reports</Link>
        <Link className="btn ghost sm" href="/reports/builder">New report</Link>
      </PageHead>
      <Flash sp={sp as Record<string, string>} />
      {err && <div className="flash err">{err}</div>}
      {dash && (<>
        <div className="card no-print">
          <form className="row" style={{ alignItems: "flex-end" }}>
            {dash.branches.length > 1 && <div className="field"><label>Branches</label>
              <details className="pick"><summary>{dash.chosen.length === dash.branches.length ? "All my branches" : dash.chosen.map((b) => b.code).join(", ")}</summary>
                <div className="pickbox">{dash.branches.map((b) => <label key={b.id} className="small"><input type="checkbox" name="branches" value={b.id} defaultChecked={dash!.chosen.length !== dash!.branches.length && dash!.chosen.some((c) => c.id === b.id)} /> {b.code} · {b.name_en}</label>)}</div></details></div>}
            <div className="field"><label htmlFor="from">Period from</label><input id="from" type="date" name="from" defaultValue={dash.from} /></div>
            <div className="field"><label htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={dash.to} /></div>
            <div className="shrink"><button className="btn">Show</button></div>
            <div className="shrink"><PrintButton label="Print or PDF" /></div>
          </form>
        </div>
        <div className="grid4" data-testid="kpis">
          <div className="kpi"><div className="v">{dash.showMoney ? <Money v={String(dash.totals.sales_today)} /> : "—"}</div><div className="l">Sales today (net)</div></div>
          <div className="kpi"><div className="v">{Number(dash.totals.cars_in_today)} / {Number(dash.totals.cars_out_today)}</div><div className="l">Cars in / out today</div></div>
          <div className="kpi"><div className="v">{Number(dash.totals.on_site)}</div><div className="l">Cars on site now</div></div>
          <div className="kpi"><div className="v" style={{ color: Number(dash.totals.late) ? "var(--late)" : undefined }}>{Number(dash.totals.late)}</div><div className="l">Late jobs now</div></div>
          <div className="kpi"><div className="v">{dash.showMoney ? <Money v={String(dash.totals.cash_today)} /> : "—"}</div><div className="l">Cash collected today</div></div>
          <div className="kpi"><div className="v">{dash.showMoney ? <Money v={String(dash.totals.receivables)} /> : "—"}</div><div className="l">Receivables open</div></div>
          <div className="kpi"><div className="v">{dash.totals.on_time_pct === null ? "—" : `${dash.totals.on_time_pct}%`}</div><div className="l">On time in the period</div></div>
          <div className="kpi"><div className="v">{Number(dash.totals.enquiries_today)}</div><div className="l">Enquiries today</div></div>
        </div>
        <div className="card" style={{ marginTop: 16 }} data-testid="funnel">
          <h2>Enquiry to invoice, {dash.from.split("-").reverse().join("/")} to {dash.to.split("-").reverse().join("/")}</h2>
          <div className="funnel">
            {([["enquiries", "Enquiries"], ["quoted", "Quoted"], ["approved", "Approved by customer"], ["job_cards", "Job cards"], ["invoiced", "Invoiced"]] as const).map(([k, l]) => {
              const v = dash!.funnelTotal[k] ?? 0, top = dash!.funnelTotal.enquiries || 1;
              return <div className="step" key={k} data-testid={`funnel-${k}`}><div className="v">{v}</div><div className="l">{l}{k !== "enquiries" ? ` · ${Math.round((v / top) * 100)}%` : ""}</div><div className="bar" style={{ width: `${Math.max(4, (v / top) * 100)}%` }} /></div>;
            })}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>{dash.funnelTotal.lost ?? 0} enquiries were lost in the period. <Link href={`/reports/run/enquiry_conversion?from=${dash.from}&to=${dash.to}${q ? `&${q}` : ""}`}>Enquiry conversion by source</Link></p>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h2>By branch</h2>
          <div className="tablewrap"><table className="report" data-testid="by-branch"><thead><tr><th>Branch</th>{dash.showMoney && <><th className="num">Sales today</th><th className="num">Sales in period</th></>}<th className="num">Cars in (period)</th><th className="num">Cars out (period)</th><th className="num">On site</th><th className="num">Late</th>{dash.showMoney && <><th className="num">Cash (period)</th><th className="num">Receivables</th></>}<th className="num">On time %</th><th className="num">Enquiries (period)</th></tr></thead>
            <tbody>{dash.per.map((b) => <tr key={String(b.id)}>
              <td><b>{String(b.code)}</b></td>
              {dash!.showMoney && <><td className="num"><Money v={String(b.sales_today)} /></td><td className="num"><Link href={drill("sales_register", String(b.id), "&by=day")}><Money v={String(b.sales_period)} /></Link></td></>}
              <td className="num"><Link href={drill("job_list", String(b.id))}>{Number(b.cars_in_period)}</Link></td>
              <td className="num"><Link href={drill("job_list", String(b.id), "&status=delivered")}>{Number(b.cars_out_period)}</Link></td>
              <td className="num">{Number(b.on_site)}</td>
              <td className="num"><Link href={drill("job_list", String(b.id), "&status=late")}>{Number(b.late)}</Link></td>
              {dash!.showMoney && <><td className="num"><Link href={drill("receipts_by_method", String(b.id))}><Money v={String(b.cash_period)} /></Link></td><td className="num"><Link href={`/reports/run/branch_outstanding?branches=${b.id}`}><Money v={String(b.receivables)} /></Link></td></>}
              <td className="num"><Link href={drill("turnaround", String(b.id))}>{b.on_time_pct === null ? "—" : `${b.on_time_pct}%`}</Link></td>
              <td className="num"><Link href={drill("enquiry_conversion", String(b.id))}>{Number(b.enquiries_period)}</Link></td>
            </tr>)}</tbody></table></div>
          {!dash.showMoney && <p className="small muted">Sales and money figures are hidden: your role does not see selling prices.</p>}
        </div>
      </>)}
      <h2 style={{ marginTop: 20 }}>My pinned reports</h2>
      {!widgets.length && <p className="muted" data-testid="no-widgets">Nothing pinned yet. Open any report and use “Pin to my reports dashboard”.</p>}
      <div className="grid2" data-testid="widgets">
        {widgets.map((w) => (
          <div className="card" key={w.id}>
            <div className="row" style={{ alignItems: "center" }}><h3 style={{ margin: 0 }}>{w.title}</h3>
              <div className="shrink"><Link className="btn ghost sm" href={w.ref.startsWith("std:") ? `/reports/run/${w.ref.slice(4)}` : `/reports/saved/${w.ref.slice(4)}`}>Open</Link></div>
              <form action={unpinReportAction} className="shrink no-print"><input type="hidden" name="id" value={w.id} /><button className="btn ghost sm">Unpin</button></form></div>
            {w.error && <p className="flash err">{w.error}</p>}
            {w.result && (w.chart !== "table" && w.result.columns.length > 1
              ? <ChartFor chart={{ type: w.chart as "bar", x: w.result.chart?.x ?? w.result.columns[0].key, y: w.result.chart?.y ?? w.result.columns.filter((c) => ["money", "num", "int", "pct", "hours"].includes(c.type ?? "")).at(-1)?.key ?? w.result.columns[1].key }} columns={w.result.columns} rows={w.result.rows} title={w.title} />
              : <ReportTable columns={w.result.columns.slice(0, 6)} rows={w.result.rows.slice(0, 10)} totals={{}} />)}
          </div>
        ))}
      </div>
    </>
  );
}
