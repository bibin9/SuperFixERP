import { requireCtx } from "@/lib/session";
import { AppError, forbidden } from "@/lib/errors";
import { builderSources, previewSpec, OPS, AGGS, CALC_OPS } from "@/lib/services/report-builder";
import { getSaved } from "@/lib/services/report-saved";
import { specFromForm, specToParams, BUILDER_COLS, BUILDER_FILTERS, BUILDER_CALCS } from "@/lib/report-spec";
import { Flash, Link, PageHead } from "@/components/ui";
import { ReportTable, ChartFor } from "@/components/ReportView";
import { saveBuilderAction } from "@/app/actions-reports";

export default async function Builder({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const raw = await searchParams;
  const sources = await builderSources(ctx);
  if (!sources.length) throw forbidden();
  let sp: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v ?? ""]));
  let name = sp.name ?? "";
  if (sp.id && !sp.source) {
    const rep = await getSaved(ctx, sp.id);
    if (!rep.mine || rep.kind !== "builder") throw forbidden("Only the person who saved this report can change it.");
    sp = { ...sp, source: rep.source!, ...specToParams(rep.spec) };
    name = rep.name;
  }
  const src = sources.find((s) => s.key === sp.source);
  const g = (k: string) => sp[k] ?? "";
  let preview: Awaited<ReturnType<typeof previewSpec>> | null = null, err: string | null = null;
  if (src && g("col_field_0")) {
    try { preview = await previewSpec(ctx, src.key, specFromForm((k) => sp[k]), raw); }
    catch (e) { if (e instanceof AppError) err = e.message; else throw e; }
  }
  const fieldOpts = (blank = "—") => [<option key="" value="">{blank}</option>, ...(src?.fields ?? []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)];
  const colRefs = [...Array.from({ length: BUILDER_COLS }, (_, i) => [`c${i}`, `Column ${i + 1}${g(`col_field_${i}`) ? ` (${src?.fields.find((f) => f.key === g(`col_field_${i}`))?.label ?? ""})` : ""}`]),
    ...Array.from({ length: BUILDER_CALCS }, (_, i) => [`k${i}`, `Calculation ${i + 1}${g(`k_label_${i}`) ? ` (${g(`k_label_${i}`)})` : ""}`])];
  const refOpts = (blank: string, onlyCols = false) => [<option key="" value="">{blank}</option>, ...colRefs.filter(([k]) => !onlyCols || k.startsWith("c")).map(([k, l]) => <option key={k} value={k}>{l}</option>)];
  return (
    <>
      <PageHead title={sp.id ? `Edit report: ${name}` : "Report builder"} sub="Pick a data source, the columns and filters. Only the fields your role may see are offered, and the report always runs on your own branches.">
        <Link className="btn ghost sm" href="/reports/all">All reports</Link>
      </PageHead>
      <Flash sp={sp} />
      <form className="card" data-testid="builder">
        {sp.id && <input type="hidden" name="id" value={sp.id} />}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field"><label htmlFor="source">Data source</label>
            <select id="source" name="source" defaultValue={src?.key ?? ""}><option value="">Choose…</option>{sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
          {!src && <div className="shrink"><button className="btn">Next</button></div>}
          {src?.date && <div className="field"><label htmlFor="use_dates">Date filter</label><select id="use_dates" name="use_dates" defaultValue={g("use_dates") || "1"}><option value="1">Ask for dates ({src.dateLabel ?? "date"})</option><option value="0">No date filter</option></select></div>}
          {src?.date && g("use_dates") !== "0" && (<>
            <div className="field"><label htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={g("from")} /></div>
            <div className="field"><label htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={g("to")} /></div></>)}
        </div>
        {src && (<>
          <h2>Columns <span className="small muted">(RB-02: rename, order top to bottom, total, count or average)</span></h2>
          {Array.from({ length: BUILDER_COLS }, (_, i) => (
            <div className="bld-row" key={i}>
              <span className="small muted" style={{ width: 70 }}>Column {i + 1}</span>
              <select name={`col_field_${i}`} defaultValue={g(`col_field_${i}`)} aria-label={`Column ${i + 1} field`}>{fieldOpts()}</select>
              <input name={`col_label_${i}`} defaultValue={g(`col_label_${i}`)} placeholder="Heading (optional)" aria-label={`Column ${i + 1} heading`} />
              <select name={`col_agg_${i}`} defaultValue={g(`col_agg_${i}`)} aria-label={`Column ${i + 1} summary`}>{AGGS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
            </div>))}
          <p className="small muted">When any column is a total, count or average, the other columns become the groups (RB-04).</p>
          <h2>Filters <span className="small muted">(RB-03: tick “ask when run” to enter the value each time)</span></h2>
          {Array.from({ length: BUILDER_FILTERS }, (_, i) => (
            <div className="bld-row" key={i}>
              <select name={`f_field_${i}`} defaultValue={g(`f_field_${i}`)} aria-label={`Filter ${i + 1} field`}>{fieldOpts("No filter")}</select>
              <select name={`f_op_${i}`} defaultValue={g(`f_op_${i}`) || "eq"} aria-label={`Filter ${i + 1} condition`}>{OPS.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
              <input name={`f_value_${i}`} defaultValue={g(`f_value_${i}`)} placeholder="Value" aria-label={`Filter ${i + 1} value`} />
              <label className="small"><input type="checkbox" name={`f_prompt_${i}`} value="1" defaultChecked={g(`f_prompt_${i}`) === "1"} /> ask when run</label>
            </div>))}
          <div className="grid2">
            <div>
              <h2>Sort and subtotals</h2>
              <div className="bld-row"><select name="sort_col" defaultValue={g("sort_col")} aria-label="Sort by">{refOpts("Sort by the first column")}</select>
                <select name="sort_dir" defaultValue={g("sort_dir")} aria-label="Sort direction"><option value="asc">Lowest first</option><option value="desc">Highest first</option></select></div>
              <div className="bld-row"><select name="subtotal" defaultValue={g("subtotal")} aria-label="Subtotal by">{refOpts("No subtotals", true)}</select></div>
              <h2>Calculated columns <span className="small muted">(RB-05)</span></h2>
              {Array.from({ length: BUILDER_CALCS }, (_, i) => (
                <div className="bld-row" key={i}>
                  <input name={`k_label_${i}`} defaultValue={g(`k_label_${i}`)} placeholder={`Calculation ${i + 1} heading`} aria-label={`Calculation ${i + 1} heading`} />
                  <select name={`k_op_${i}`} defaultValue={g(`k_op_${i}`)} aria-label={`Calculation ${i + 1}`}><option value="">None</option>{CALC_OPS.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
                  <select name={`k_a_${i}`} defaultValue={g(`k_a_${i}`)} aria-label={`Calculation ${i + 1} A`}>{refOpts("A", true)}</select>
                  <select name={`k_b_${i}`} defaultValue={g(`k_b_${i}`)} aria-label={`Calculation ${i + 1} B`}>{refOpts("B", true)}</select>
                  <input name={`k_rate_${i}`} defaultValue={g(`k_rate_${i}`)} placeholder="Rate" style={{ width: 80, minWidth: 80 }} aria-label={`Calculation ${i + 1} rate`} />
                </div>))}
            </div>
            <div>
              <h2>Pivot <span className="small muted">(RB-04: rows against columns)</span></h2>
              <div className="bld-row"><select name="pv_row" defaultValue={g("pv_row")} aria-label="Pivot rows">{fieldOpts("No pivot")}</select>
                <select name="pv_col" defaultValue={g("pv_col")} aria-label="Pivot columns">{fieldOpts("Across")}</select></div>
              <div className="bld-row"><select name="pv_value" defaultValue={g("pv_value")} aria-label="Pivot value">{fieldOpts("Value")}</select>
                <select name="pv_agg" defaultValue={g("pv_agg") || "sum"} aria-label="Pivot summary">{AGGS.filter(([a]) => a).map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select></div>
              <h2>Chart <span className="small muted">(RB-06)</span></h2>
              <div className="bld-row"><select name="chart_type" defaultValue={g("chart_type")} aria-label="Chart type"><option value="">No chart</option><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option></select>
                <select name="chart_x" defaultValue={g("chart_x")} aria-label="Chart labels">{refOpts("Labels from")}</select>
                <select name="chart_y" defaultValue={g("chart_y")} aria-label="Chart values">{refOpts("Values from")}</select></div>
            </div>
          </div>
          <div className="row" style={{ alignItems: "flex-end", marginTop: 12 }}>
            <div className="shrink"><button className="btn ghost" data-testid="preview">Preview</button></div>
            <div className="field"><label htmlFor="name">Report name</label><input id="name" name="name" defaultValue={name} maxLength={120} placeholder="Name to save it under" /></div>
            <div className="shrink"><button className="btn" formAction={saveBuilderAction} formMethod="post" data-testid="save-report">{sp.id ? "Save changes" : "Save report"}</button></div>
          </div>
        </>)}
      </form>
      {err && <div className="flash err" data-testid="builder-error">{err}</div>}
      {preview && (<>
        <h2 style={{ marginTop: 16 }}>Preview</h2>
        <ChartFor chart={preview.chart} columns={preview.columns} rows={preview.rows} title={name || "Preview"} />
        <div className="card" data-testid="preview-table"><ReportTable columns={preview.columns} rows={preview.rows.slice(0, 200)} totals={preview.totals} /></div>
      </>)}
    </>
  );
}
