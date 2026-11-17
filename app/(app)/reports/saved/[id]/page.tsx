import { requireCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { getSaved, shareOptions } from "@/lib/services/report-saved";
import { runReport, reportDef, type Col, type Row } from "@/lib/services/reports";
import { previewSpec, sourceDef, type Spec } from "@/lib/services/report-builder";
import { Flash, Link, PageHead } from "@/components/ui";
import { ReportFilters, ReportTable, ChartFor, PrintHead, qs } from "@/components/ReportView";
import { ReportActions } from "@/components/ReportActions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { shareReportAction, deleteReportAction, saveCopyAction } from "@/app/actions-reports";

type View = { columns: Col[]; rows: Row[]; totals: Row; chart: Spec["chart"] | undefined; branches: { id: string; code: string; name_en: string }[]; chosen: { id: string; code: string; name_en: string }[]; canExport: boolean; truncated: boolean };

export default async function SavedReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const rep = await getSaved(ctx, id);
  const query = qs(sp);
  const back = `/reports/saved/${id}${query ? `?${query}` : ""}`;
  let v: View | null = null, err: string | null = null;
  let filt: React.ReactNode = null;
  const exportHref = `/api/reports/export?ref=def:${id}${query ? `&${query}` : ""}`;
  try {
    if (rep.kind === "copy") {
      const spec = rep.spec as { columns: { key: string; label: string }[]; params: Record<string, string> };
      const r = await runReport(ctx, rep.base_code!, { ...spec.params, ...sp });
      const cols = spec.columns.map((x) => { const c = r.columns.find((y) => y.key === x.key); return c ? { ...c, label: x.label || c.label } : null; }).filter(Boolean) as Col[];
      v = { columns: cols, rows: r.rows, totals: r.totals, chart: r.def.chart, branches: r.branches, chosen: r.chosen, canExport: r.canExport, truncated: r.truncated };
      const f = r.filters;
      filt = <ReportFilters all={r.branches} chosen={r.chosen} dates={r.def.dates === "range"} dateLabel={r.def.dateLabel} from={f.from} to={f.to} people={r.def.people} advisor={f.advisor} technician={f.technician}
        advisors={r.people.advisors} technicians={r.people.technicians} extra={r.def.extra} x={f.x} archive={!!r.def.archive} source={f.source} runs={r.runs} exportHref={exportHref} canExport={r.canExport} />;
    } else {
      const src = sourceDef(rep.source!)!;
      const r = await previewSpec(ctx, rep.source!, rep.spec, sp);
      const spec = rep.spec as Spec;
      v = { ...r, chart: r.chart };
      const prompts = spec.filters.map((f, i) => ({ ...f, i })).filter((f) => f.prompt);
      const fl = src.fields;
      filt = <ReportFilters all={r.branches} chosen={r.chosen} dates={!!spec.useDates} dateLabel={src.dateLabel} from={String(sp.from ?? "") || undefined} to={String(sp.to ?? "") || undefined}
        archive={!!src.archive} source={String(sp.source ?? "live")} exportHref={exportHref} canExport={r.canExport}>
        {prompts.map((p) => <div className="field" key={p.i}><label htmlFor={`p${p.i}`}>{fl.find((x) => x.key === p.field)?.label ?? p.field}</label>
          <input id={`p${p.i}`} name={`p${p.i}`} defaultValue={String(sp[`p${p.i}`] ?? p.value ?? "")} placeholder="Any" data-testid={`prompt-${p.i}`} /></div>)}
      </ReportFilters>;
    }
  } catch (e) { if (e instanceof AppError && e.code === "validation") err = e.message; else throw e; }
  const opts = rep.mine ? await shareOptions(ctx) : null;
  const base = rep.base_code ? reportDef(rep.base_code) : null;
  const src = rep.source ? sourceDef(rep.source) : null;
  const sub = `${rep.kind === "copy" ? `Copy of ${base?.name}` : `Built on ${src?.label}`} · ${rep.mine ? (rep.shared ? "yours, shared" : "yours, private") : `shared by ${rep.owner}`}`;
  return (
    <>
      <PrintHead title={rep.name} sub={v ? `Branches: ${v.chosen.map((b) => b.code).join(", ")}` : ""} />
      <PageHead title={rep.name} sub={sub}>
        <Link className="btn ghost sm no-print" href="/reports/all">All reports</Link>
        {rep.mine && rep.kind === "builder" && <Link className="btn ghost sm no-print" href={`/reports/builder?id=${id}`}>Edit</Link>}
      </PageHead>
      <Flash sp={sp as Record<string, string>} />
      {err && <div className="flash err" data-testid="report-error">{err}</div>}
      {filt}
      {v && (<>
        <p className="small muted no-print" data-testid="report-sub">{v.rows.filter((r) => !r.$subtotal).length} row(s){v.truncated ? " (first rows only)" : ""}</p>
        <ChartFor chart={v.chart} columns={v.columns} rows={v.rows} title={rep.name} />
        <div className="card"><ReportTable columns={v.columns} rows={v.rows} totals={v.totals} /></div>
        <ReportActions refId={`def:${id}`} title={rep.name} back={back} defaults={Object.fromEntries(Object.entries(sp).filter(([k, x]) => typeof x === "string" && !["ok", "err", "errf"].includes(k)) as [string, string][])} chart={v.chart?.type} canExport={v.canExport} />
      </>)}
      {rep.mine && rep.kind === "copy" && v && (
        <details className="card no-print" style={{ marginTop: 16 }}><summary><b>Change this copy</b></summary>
          <form action={saveCopyAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="base_code" value={rep.base_code!} /><input type="hidden" name="$back" value={back} />
            {Object.entries((rep.spec as { params: Record<string, string> }).params ?? {}).map(([k, x]) => <input key={k} type="hidden" name={`d_${k}`} value={x} />)}
            <div className="field"><label htmlFor="cname">Name</label><input id="cname" name="name" defaultValue={rep.name} maxLength={120} /></div>
            <table><thead><tr><th>Keep</th><th>Column</th><th>Show as</th><th>Order</th></tr></thead><tbody>
              {(typeof base!.columns === "function" ? v.columns : base!.columns).map((c, i) => { const cur = v!.columns.findIndex((x) => x.key === c.key); return (
                <tr key={c.key}><td><input type="checkbox" name="col_keep" value={c.key} defaultChecked={cur >= 0} aria-label={`Keep ${c.label}`} /></td><td>{c.label}<input type="hidden" name="col_key" value={c.key} /></td>
                  <td><input name="col_label" defaultValue={cur >= 0 ? v!.columns[cur].label : c.label} maxLength={60} /></td><td><input name="col_order" type="number" defaultValue={cur >= 0 ? cur + 1 : 50 + i} style={{ width: 70 }} /></td></tr>); })}
            </tbody></table>
            <button className="btn" style={{ marginTop: 8 }}>Save changes</button>
          </form>
        </details>)}
      {rep.mine && opts && (
        <div className="card no-print" style={{ marginTop: 16 }} data-testid="share-box">
          <h2>Share</h2>
          <p className="small muted">People you share with see it under All reports, and in their Reports menu if you tick that box. They see only their own branches and the fields their role allows.</p>
          <form action={shareReportAction} className="row" style={{ alignItems: "flex-start" }}>
            <input type="hidden" name="id" value={id} />
            <div className="field"><label>Roles</label><div className="pickbox static">{opts.roles.map((r) => <label key={r.id} className="small" style={{ display: "block" }}><input type="checkbox" name="roles" value={r.id} defaultChecked={rep.shares.some((s) => s.role_id === r.id)} /> {r.name}</label>)}</div></div>
            <div className="field"><label>Users</label><div className="pickbox static">{opts.users.map((u) => <label key={u.id} className="small" style={{ display: "block" }}><input type="checkbox" name="users" value={u.id} defaultChecked={rep.shares.some((s) => s.user_id === u.id)} /> {u.full_name}</label>)}</div></div>
            <div className="field"><label className="small"><input type="checkbox" name="in_menu" value="1" defaultChecked={rep.in_menu} /> Show in the Reports menu</label>
              <button className="btn" style={{ marginTop: 10 }}>Save sharing</button></div>
          </form>
          <form action={deleteReportAction} style={{ marginTop: 12 }}><input type="hidden" name="id" value={id} /><ConfirmButton message="Delete this saved report for everyone it is shared with?" className="btn ghost red-text sm">Delete this report</ConfirmButton></form>
        </div>)}
    </>
  );
}
