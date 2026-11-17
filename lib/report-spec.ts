/** Builder form fields <-> report spec. The form is a plain GET form (preview) that can also post (save). */
export const BUILDER_COLS = 8, BUILDER_FILTERS = 4, BUILDER_CALCS = 2;

type Get = (k: string) => string | null | undefined;

export function specFromForm(get: Get) {
  const v = (k: string) => String(get(k) ?? "").trim();
  const columns = Array.from({ length: BUILDER_COLS }, (_, i) => ({ field: v(`col_field_${i}`), label: v(`col_label_${i}`), agg: v(`col_agg_${i}`) })).filter((c) => c.field);
  const filters = Array.from({ length: BUILDER_FILTERS }, (_, i) => ({ field: v(`f_field_${i}`), op: v(`f_op_${i}`) || "eq", value: v(`f_value_${i}`), prompt: v(`f_prompt_${i}`) === "1" })).filter((f) => f.field);
  const calcs = Array.from({ length: BUILDER_CALCS }, (_, i) => ({ label: v(`k_label_${i}`), op: v(`k_op_${i}`), a: v(`k_a_${i}`), b: v(`k_b_${i}`), rate: v(`k_rate_${i}`) })).filter((k) => k.op);
  return {
    columns, filters, calcs,
    sort: v("sort_col") ? { col: v("sort_col"), dir: v("sort_dir") === "desc" ? "desc" : "asc" } : null,
    subtotal: v("subtotal") || null,
    pivot: v("pv_row") ? { row: v("pv_row"), col: v("pv_col"), value: v("pv_value"), agg: v("pv_agg") || "sum" } : null,
    chart: v("chart_type") ? { type: v("chart_type"), x: v("chart_x"), y: v("chart_y") } : null,
    useDates: v("use_dates") !== "0",
  };
}

/** A saved spec as form values, to open it in the builder for editing. */
export function specToParams(spec: Record<string, unknown>) {
  const p: Record<string, string> = {};
  const sp = spec as { columns?: { field: string; label?: string; agg?: string }[]; filters?: { field: string; op: string; value?: string; prompt?: boolean }[];
    calcs?: { label: string; op: string; a: string; b: string; rate?: string }[]; sort?: { col: string; dir: string } | null; subtotal?: string | null;
    pivot?: { row: string; col: string; value: string; agg: string } | null; chart?: { type: string; x: string; y: string } | null; useDates?: boolean };
  (sp.columns ?? []).forEach((c, i) => { p[`col_field_${i}`] = c.field; p[`col_label_${i}`] = c.label ?? ""; p[`col_agg_${i}`] = c.agg ?? ""; });
  (sp.filters ?? []).forEach((f, i) => { p[`f_field_${i}`] = f.field; p[`f_op_${i}`] = f.op; p[`f_value_${i}`] = f.value ?? ""; if (f.prompt) p[`f_prompt_${i}`] = "1"; });
  (sp.calcs ?? []).forEach((k, i) => { p[`k_label_${i}`] = k.label; p[`k_op_${i}`] = k.op; p[`k_a_${i}`] = k.a; p[`k_b_${i}`] = k.b; p[`k_rate_${i}`] = k.rate ?? ""; });
  if (sp.sort) { p.sort_col = sp.sort.col; p.sort_dir = sp.sort.dir; }
  if (sp.subtotal) p.subtotal = sp.subtotal;
  if (sp.pivot) { p.pv_row = sp.pivot.row; p.pv_col = sp.pivot.col; p.pv_value = sp.pivot.value; p.pv_agg = sp.pivot.agg; }
  if (sp.chart) { p.chart_type = sp.chart.type; p.chart_x = sp.chart.x; p.chart_y = sp.chart.y; }
  p.use_dates = sp.useDates === false ? "0" : "1";
  return p;
}
