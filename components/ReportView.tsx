import Link from "next/link";
import { fmtAED } from "@/lib/money";
import type { Col, Row } from "@/lib/services/reports";
import { Status, d } from "./ui";
import { ReportChart } from "./ReportChart";
import { PrintButton } from "./PrintButton";

const num = (v: unknown, dp = 2) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

export function cell(col: Col, v: unknown) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && v.startsWith("Subtotal")) return <b>{v}</b>;
  switch (col.type) {
    case "money": return fmtAED(v as string);
    case "num": return num(v, Number.isInteger(Number(v)) ? 0 : 2);
    case "hours": return num(v, 2);
    case "int": return num(v, 0);
    case "pct": return `${num(v, 1)}%`;
    case "date": return d(String(v));
    case "status": return <Status s={String(v)} />;
    default: return String(v);
  }
}
const right = (c: Col) => ["money", "num", "int", "pct", "hours"].includes(c.type ?? "");

export function ReportTable({ columns, rows, totals, rowAction }: { columns: Col[]; rows: Row[]; totals: Row; rowAction?: (r: Row) => React.ReactNode }) {
  const hasTotals = Object.keys(totals).length > 0 && rows.length > 1;
  return (
    <div className="tablewrap">
      <table className="report" data-testid="report-table">
        <thead><tr>{rowAction && <th className="no-print" />}{columns.map((c) => <th key={c.key} className={right(c) ? "num" : ""}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.$subtotal ? "subtotal" : ""}>
              {rowAction && <td className="no-print">{rowAction(r)}</td>}
              {columns.map((c, j) => (
                <td key={c.key} className={right(c) ? "num" : ""}>
                  {j === 0 && typeof r.$link === "string" ? <Link href={r.$link}>{cell(c, r[c.key]) || "open"}</Link> : cell(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length + (rowAction ? 1 : 0)} className="muted">Nothing for these filters.</td></tr>}
        </tbody>
        {hasTotals && (
          <tfoot><tr>{rowAction && <th className="no-print" />}{columns.map((c, i) => <th key={c.key} className={right(c) ? "num" : ""}>{i === 0 && totals[c.key] === undefined ? "Total" : totals[c.key] === undefined ? "" : cell(c, totals[c.key])}</th>)}</tr></tfoot>
        )}
      </table>
    </div>
  );
}

export function ChartFor({ chart, columns, rows, title }: { chart: { type: "bar" | "line" | "pie"; x: string; y: string } | null | undefined; columns: Col[]; rows: Row[]; title: string }) {
  if (!chart) return null;
  const xc = columns.find((c) => c.key === chart.x), yc = columns.find((c) => c.key === chart.y);
  if (!xc || !yc) return null;
  const pts = rows.filter((r) => !r.$subtotal).map((r) => ({ label: xc.type === "date" ? d(String(r[xc.key] ?? "")) : String(r[xc.key] ?? ""), value: Number(r[yc.key]) }));
  return <div className="card chartcard"><ReportChart type={chart.type} points={pts} title={title} valueLabel={yc.label} /></div>;
}

type Opt = { id: string; code?: string; name_en?: string; full_name?: string };
/** The shared filter bar: branches, dates, people, the report's own choices and the data source (GET form). */
export function ReportFilters({ all, chosen, dates, dateLabel, from, to, people, advisor, technician, advisors, technicians, extra, x, archive, source, runs, exportHref, canExport, children }: {
  all: Opt[]; chosen: Opt[]; dates: boolean; dateLabel?: string; from?: string; to?: string; people?: string[]; advisor?: string; technician?: string; advisors?: Opt[]; technicians?: Opt[];
  extra?: { key: string; label: string; options: [string, string][] }[]; x?: Record<string, string>; archive?: boolean; source?: string; runs?: { id: string; run_no: number; cutoff: string }[];
  exportHref?: string; canExport?: boolean; children?: React.ReactNode;
}) {
  const sel = new Set(chosen.length === all.length ? [] : chosen.map((b) => b.id));
  return (
    <div className="card no-print">
      <form className="row" style={{ alignItems: "flex-end" }} data-testid="report-filters">
        {all.length > 1 && (
          <div className="field">
            <label>Branches</label>
            <details className="pick"><summary>{sel.size ? chosen.map((b) => b.code).join(", ") : "All my branches"}</summary>
              <div className="pickbox">{all.map((b) => <label key={b.id} className="small"><input type="checkbox" name="branches" value={b.id} defaultChecked={sel.has(b.id)} /> {b.code} · {b.name_en}</label>)}</div>
            </details>
          </div>)}
        {dates && (<>
          <div className="field"><label htmlFor="from">{dateLabel ?? "From"}</label><input id="from" type="date" name="from" defaultValue={from} /></div>
          <div className="field"><label htmlFor="to">{dateLabel ? "and" : "To"}</label><input id="to" type="date" name="to" defaultValue={to} /></div>
        </>)}
        {people?.includes("advisor") && (
          <div className="field"><label htmlFor="advisor">Advisor</label><select id="advisor" name="advisor" defaultValue={advisor}><option value="">Any advisor</option>{advisors?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>)}
        {people?.includes("technician") && (
          <div className="field"><label htmlFor="technician">Technician</label><select id="technician" name="technician" defaultValue={technician}><option value="">Any technician</option>{technicians?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>)}
        {extra?.map((e) => (
          <div className="field" key={e.key}><label htmlFor={`x_${e.key}`}>{e.label}</label><select id={`x_${e.key}`} name={e.key} defaultValue={x?.[e.key]}>{e.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>))}
        {archive && (
          <div className="field"><label htmlFor="source">Data</label><select id="source" name="source" defaultValue={source || "live"} data-testid="data-source">
            <option value="live">Live</option><option value="archived">Archived</option>
            {runs?.map((r) => <option key={r.id} value={r.id}>Archive run {r.run_no} (before {r.cutoff})</option>)}
          </select></div>)}
        {children}
        <div className="shrink"><button className="btn">Show</button></div>
        {exportHref && canExport && (<>
          <div className="shrink"><a className="btn ghost" href={`${exportHref}&format=xlsx`} data-testid="export-xlsx">Excel</a></div>
          <div className="shrink"><a className="btn ghost" href={`${exportHref}&format=csv`} data-testid="export-csv">CSV</a></div>
        </>)}
        <div className="shrink"><PrintButton label="Print or PDF" /></div>
      </form>
    </div>
  );
}

/** Builds a query string from the current search params (for export links and copies). */
export function qs(sp: Record<string, string | string[] | undefined>, drop: string[] = []) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (drop.includes(k) || k === "ok" || k === "err" || k === "errf" || k === "msg" || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
  }
  return u.toString();
}

/** Letterhead for printed reports (RB-09). */
export function PrintHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="print-only letterhead">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sflogo.png" alt="" width={74} height={40} />
      <div><b>Super Fix Auto Centers</b><br /><span className="small">{title} · {sub}</span></div>
    </div>
  );
}
