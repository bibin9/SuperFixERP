import { requireCtx } from "@/lib/session";
import { auditLog, loginEvents } from "@/lib/services/admin";
import { PageHead, dt } from "@/components/ui";

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, logins] = await Promise.all([auditLog(ctx, sp), loginEvents(ctx)]);
  return (
    <>
      <PageHead title="Audit log" sub="Append-only: no user, including the admin, can change or delete entries." />
      <div className="card">
        <form className="row" style={{ marginBottom: 8 }}><input name="entity" defaultValue={sp.entity} placeholder="Record type, e.g. quotation" /><input name="user" defaultValue={sp.user} placeholder="User name" /><input name="action" defaultValue={sp.action} placeholder="Action" /><button className="btn ghost shrink">Filter</button></form>
        <table>
          <thead><tr><th>When</th><th>User</th><th>Branch</th><th>Record</th><th>Action</th><th>Changes</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{dt(r.at)}</td><td>{r.full_name ?? "system"}</td><td>{r.branch_code}</td><td className="small">{r.entity}</td><td>{r.action}</td>
            <td className="small" style={{ maxWidth: 420, wordBreak: "break-word" }}>{r.changes ? JSON.stringify(r.changes) : ""}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card"><h2>Sign-ins and branch switches</h2>
        <table><tbody>{logins.map((e) => <tr key={e.id}><td className="small">{dt(e.at)}</td><td>{e.username}</td><td>{e.event}</td><td>{e.branch_code}</td><td className="small muted">{e.ip}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
