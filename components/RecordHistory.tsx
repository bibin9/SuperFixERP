import type { HistoryRow } from "@/lib/services/audit";
import { dt, label } from "@/components/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
const show = (v: any): string => (v === null || v === undefined || (Array.isArray(v) && !v.length) ? "—" : Array.isArray(v) ? v.map(show).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
function Detail({ d }: { d: any }) {
  if (!d || typeof d !== "object") return null;
  return <>{Object.entries(d).slice(0, 8).map(([k, v]: [string, any]) => (
    <div key={k}><span className="muted">{k.replace(/_/g, " ")}:</span>{" "}
      {v && typeof v === "object" && ("old" in v || "new" in v) ? <><s className="muted">{show(v.old)}</s> → <b>{show(v.new)}</b></> : show(v)}</div>))}</>;
}

/** Who did what on this transaction, in time order (audit trail, FSD 3.6). Closed until the user opens it. */
export function RecordHistory({ rows, title = "History: who did what" }: { rows: HistoryRow[]; title?: string }) {
  return (
    <details className="card history no-print"><summary><h2>{title} <span className="small muted">({rows.length})</span></h2></summary>
      <table><thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td className="small">{dt(r.at)}</td><td><b>{r.user}</b></td><td className="small">{r.role ?? ""}</td><td>{label(r.action.replace(/ /g, "_")) === r.action.replace(/ /g, "_") ? r.action : label(r.action.replace(/ /g, "_"))}</td>
            <td className="small" style={{ maxWidth: 380, wordBreak: "break-word" }}><Detail d={r.detail} /></td></tr>))}
          {!rows.length && <tr><td colSpan={5} className="muted">Nothing recorded yet.</td></tr>}</tbody></table>
    </details>);
}
