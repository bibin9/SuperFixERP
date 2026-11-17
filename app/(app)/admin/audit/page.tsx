import { requireCtx } from "@/lib/session";
import { auditLog, auditUsers, loginEvents } from "@/lib/services/admin";
import { PageHead, dt, label } from "@/components/ui";
import { can } from "@/lib/access";

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, logins, users] = await Promise.all([auditLog(ctx, sp), loginEvents(ctx), auditUsers(ctx)]);
  return (
    <>
      <PageHead title="Audit log" sub="Append-only: no user, including the admin, can change or delete entries. Who can see and export it is set under Roles & permissions (Audit log)." />
      <div className="card">
        <form className="row" style={{ marginBottom: 8, alignItems: "flex-end" }}>
          <div className="field"><label>Record type</label><input name="entity" defaultValue={sp.entity} placeholder="e.g. quotation, voucher" /></div>
          <div className="field"><label>Record (number or id)</label><input name="record" defaultValue={sp.record} placeholder="e.g. YAS-INV-26-000001" /></div>
          <div className="field"><label>User</label><select name="user" defaultValue={sp.user ?? ""}><option value="">Everyone</option>{users.map((u) => <option key={u.username} value={u.username}>{u.full_name} ({u.username})</option>)}</select></div>
          <div className="field"><label>Action</label><input name="action" defaultValue={sp.action} placeholder="e.g. update" /></div>
          <div className="field"><label>From</label><input type="date" name="from" defaultValue={sp.from} /></div>
          <div className="field"><label>To</label><input type="date" name="to" defaultValue={sp.to} /></div>
          <button className="btn ghost shrink">Filter</button>
          {can(ctx, "audit", "export") && <a className="btn ghost shrink" href={`/api/audit?${new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString()}`}>Export CSV</a>}
        </form>
        <table>
          <thead><tr><th>When</th><th>User</th><th>Role</th><th>Branch</th><th>Record</th><th>Action</th><th>Changes</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{dt(r.at)}</td><td><a href={`?user=${encodeURIComponent(r.username ?? "")}`}><b>{r.full_name ?? "System"}</b></a><div className="small muted">{r.username}</div></td><td className="small">{r.role}</td><td>{r.branch_code}</td><td className="small">{label(r.entity)}</td><td>{label(r.action)}</td>
            <td className="small" style={{ maxWidth: 420, wordBreak: "break-word" }}><Changes c={r.changes} /></td></tr>)}</tbody>
        </table>
      </div>
      <div className="card"><h2>Sign-ins and branch switches</h2>
        <table><tbody>{logins.map((e) => <tr key={e.id}><td className="small">{dt(e.at)}</td><td>{e.username}</td><td>{label(e.event)}</td><td>{e.branch_code}</td><td className="small muted">{e.ip}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const show = (v: any) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : typeof v === "string" ? label(v) : String(v));
/** Audit changes as "field: old → new" lines instead of raw JSON. */
function Changes({ c }: { c: any }) {
  if (!c || typeof c !== "object") return null;
  return <>{Object.entries(c).map(([k, v]: [string, any]) => (
    <div key={k}><span className="muted">{k.replace(/_/g, " ")}:</span>{" "}
      {v && typeof v === "object" && ("old" in v || "new" in v) ? <><s className="muted">{show(v.old)}</s> → <b>{show(v.new)}</b></> : show(v)}</div>
  ))}</>;
}
