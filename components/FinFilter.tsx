import type { Scope } from "@/lib/services/financials";
import { PrintButton } from "./PrintButton";

/** Date and branch filter for the financial reports (GET form, so a report can be bookmarked). */
export function FinFilter({ scope, mode, from, to, asof, side, children }: { scope: Scope; mode: "range" | "asof"; from?: string; to?: string; asof?: string; side?: boolean; children?: React.ReactNode }) {
  const chosen = new Set(scope.branches.length === scope.all.length ? [] : scope.ids);
  return (
    <div className="card no-print">
      <form className="row" style={{ alignItems: "flex-end" }}>
        {mode === "range" ? (<>
          <div className="field"><label>From</label><input type="date" name="from" defaultValue={from} /></div>
          <div className="field"><label>To</label><input type="date" name="to" defaultValue={to} /></div>
        </>) : <div className="field"><label>As on</label><input type="date" name="asof" defaultValue={asof} /></div>}
        {scope.all.length > 1 && (
          <div className="field">
            <label>Branches</label>
            <details className="pick"><summary>{chosen.size ? scope.branches.map((b) => b.code).join(", ") : "All my branches"}</summary>
              <div className="pickbox">{scope.all.map((b) => <label key={b.id} className="small"><input type="checkbox" name="branches" value={b.id} defaultChecked={chosen.has(b.id)} /> {b.code} · {b.name_en}</label>)}</div>
            </details>
          </div>)}
        {side !== undefined && scope.all.length > 1 && <label className="small shrink" style={{ marginBottom: 14 }}><input type="checkbox" name="side" value="1" defaultChecked={side} /> Branches side by side</label>}
        {children}
        <div className="shrink"><button className="btn">Show</button></div>
        <div className="shrink"><PrintButton label="Print or PDF" /></div>
      </form>
    </div>
  );
}
