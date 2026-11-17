import { requireCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { runReport, reportDef, type ReportResult } from "@/lib/services/reports";
import { Flash, Link, PageHead } from "@/components/ui";
import { ReportFilters, ReportTable, ChartFor, PrintHead, qs } from "@/components/ReportView";
import { ReportActions } from "@/components/ReportActions";
import { ManualMessage } from "@/components/ManualMessage";
import { saveCopyAction, serviceReminderAction } from "@/app/actions-reports";

export default async function RunReport({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const { code } = await params;
  const sp = await searchParams;
  const base = reportDef(code);
  let r: ReportResult | null = null, err: string | null = null;
  try { r = await runReport(ctx, code, sp); }
  catch (e) { if (e instanceof AppError && e.code === "validation") err = e.message; else throw e; }
  const query = qs(sp);
  const back = `/reports/run/${code}${query ? `?${query}` : ""}`;
  if (!r) return (<>
    <PageHead title={base?.name ?? "Report"}><Link className="btn ghost sm" href="/reports/all">All reports</Link></PageHead>
    <div className="flash err" data-testid="report-error">{err}</div>
    <Link className="btn ghost" href={`/reports/run/${code}`}>Reset the filters</Link>
  </>);
  const f = r.filters;
  const defaults: Record<string, string> = { ...f.x, ...(f.advisor ? { advisor: f.advisor } : {}), ...(f.technician ? { technician: f.technician } : {}), ...(f.source !== "live" ? { source: f.source } : {}),
    ...(r.chosen.length !== r.branches.length ? { branches: f.branches.join(",") } : {}) };
  const sub = [r.def.dates === "range" ? `${f.from.split("-").reverse().join("/")} to ${f.to.split("-").reverse().join("/")}` : "As on today", `Branches: ${r.chosen.map((b) => b.code).join(", ")}`, f.source !== "live" ? "Archived data" : ""].filter(Boolean).join(" · ");
  const cols = r.columns;
  return (
    <>
      <PrintHead title={r.def.name} sub={sub} />
      <PageHead title={r.def.name} sub={`${r.def.trace ? `${r.def.trace} · ` : ""}${r.def.desc}`}>
        <Link className="btn ghost sm no-print" href="/reports/all">All reports</Link>
      </PageHead>
      <Flash sp={sp as Record<string, string>} />
      <ManualMessage ctx={ctx} id={typeof sp.msg === "string" ? sp.msg : undefined} back={back} />
      <ReportFilters all={r.branches} chosen={r.chosen} dates={r.def.dates === "range"} dateLabel={r.def.dateLabel} from={f.from} to={f.to}
        people={r.def.people} advisor={f.advisor} technician={f.technician} advisors={r.people.advisors} technicians={r.people.technicians}
        extra={r.def.extra} x={f.x} archive={!!r.def.archive} source={f.source} runs={r.runs}
        exportHref={`/api/reports/export?ref=std:${code}${query ? `&${query}` : ""}`} canExport={r.canExport} />
      <p className="small muted no-print" data-testid="report-sub">{sub} · {r.rows.length} row(s){r.truncated ? `, first ${r.max} shown` : ""}</p>
      <ChartFor chart={r.def.chart} columns={cols} rows={r.rows} title={r.def.name} />
      <div className="card">
        <ReportTable columns={cols} rows={r.rows} totals={r.totals}
          rowAction={r.def.rowAction === "service_due" ? (row) => (
            <form action={serviceReminderAction}><input type="hidden" name="job_id" value={String(row.id)} /><input type="hidden" name="$back" value={back} />
              <button className="btn wa sm" data-testid="prepare-reminder">Prepare WhatsApp</button></form>) : undefined} />
      </div>
      <details className="card no-print" style={{ marginTop: 16 }} data-testid="copy-box"><summary><b>Save a copy of this report</b> <span className="small muted">choose, rename and order the columns; the filters shown now become its defaults</span></summary>
        <form action={saveCopyAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="base_code" value={code} /><input type="hidden" name="$back" value={back} />
          {Object.entries({ ...defaults, ...(r.def.dates === "range" ? { from: f.from, to: f.to } : {}) }).map(([k, v]) => <input key={k} type="hidden" name={`d_${k}`} value={v} />)}
          <div className="field"><label htmlFor="copy_name">Name</label><input id="copy_name" name="name" defaultValue={`${r.def.name} (my copy)`} maxLength={120} /></div>
          <table><thead><tr><th>Keep</th><th>Column</th><th>Show as</th><th>Order</th></tr></thead><tbody>
            {cols.map((c, i) => <tr key={c.key}><td><input type="checkbox" name="col_keep" value={c.key} defaultChecked aria-label={`Keep ${c.label}`} /></td><td>{c.label}<input type="hidden" name="col_key" value={c.key} /></td>
              <td><input name="col_label" defaultValue={c.label} maxLength={60} aria-label={`Label for ${c.label}`} /></td><td><input name="col_order" type="number" defaultValue={i + 1} style={{ width: 70 }} aria-label={`Order of ${c.label}`} /></td></tr>)}
          </tbody></table>
          <button className="btn" style={{ marginTop: 8 }}>Save copy</button>
        </form>
      </details>
      <ReportActions refId={`std:${code}`} title={r.def.name} back={back} defaults={defaults} chart={r.def.chart?.type} canExport={r.canExport} />
    </>
  );
}
