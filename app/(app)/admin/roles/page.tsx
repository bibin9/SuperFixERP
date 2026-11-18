import { requireCtx } from "@/lib/session";
import { listRoles } from "@/lib/services/admin";
import { SCREENS, ACTIONS } from "@/lib/access";
import { saveMatrixAction, createRoleAction } from "@/app/actions";
import { Flash, Link, PageHead } from "@/components/ui";

export default async function Roles({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const { roles, perms, fields, groups } = await listRoles(ctx);
  const role = roles.find((r) => r.id === sp.role) ?? roles.find((r) => r.code === "advisor")!;
  const granted = new Set(perms.filter((p) => p.role_id === role.id).map((p) => `${p.screen}:${p.action}`));
  const lvl = Object.fromEntries(fields.filter((f) => f.role_id === role.id).map((f) => [f.field_group, f.level]));
  return (
    <>
      <PageHead title="Roles and permissions" sub="Roles are records, not code. Every change is logged with old and new values." />
      <Flash sp={sp} />
      <div className="tabs">{roles.map((r) => <Link key={r.id} className={r.id === role.id ? "on" : ""} href={`/admin/roles?role=${r.id}`}>{r.name} ({r.holders})</Link>)}</div>
      <form action={saveMatrixAction}>
        <input type="hidden" name="role_id" value={role.id} />
        <div className="grid2">
          <div className="card"><h2>{role.name}: screens and actions</h2>
            {role.is_admin && <div className="flash warn">Administrator has every permission.</div>}
            <table className="matrix">
              <thead><tr><th>Screen</th>{ACTIONS.map((a) => <th key={a}>{a}</th>)}</tr></thead>
              <tbody>{SCREENS.map(([s, label]) => (
                <tr key={s}><td>{label}</td>{ACTIONS.map((a) => <td key={a}><input type="checkbox" name={`p:${s}:${a}`} defaultChecked={granted.has(`${s}:${a}`)} aria-label={`${label} ${a}`} /></td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <div className="card"><h2>Field permissions (who sees prices and costs)</h2>
            <p className="small muted">Hidden fields are removed on the server before anything reaches the browser, on screens, prints, exports and approvals.</p>
            <table>
              <thead><tr><th>Field group</th><th>Level</th></tr></thead>
              <tbody>{groups.map((g) => (
                <tr key={g.code}><td><b>{g.name}</b><div className="small muted">{g.fields}{g.derived ? `. Also hides: ${g.derived}` : ""}</div></td>
                  <td><select style={{ minWidth: 96 }} name={`f:${g.code}`} defaultValue={lvl[g.code] ?? "hidden"}><option value="hidden">Hidden</option><option value="view">View</option><option value="edit">Edit</option></select></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <button className="btn">Save {role.name}</button>
      </form>
      <div className="card" style={{ marginTop: 16 }}><h2>Add role</h2>
        <form action={createRoleAction} className="row"><div className="field"><label>Role code</label><input name="code" placeholder="e.g. cashier" required /></div><div className="field"><label>Role name</label><input name="name" required /></div><button className="btn shrink">Add role</button></form>
        <p className="small muted">New roles start with no screens and every sensitive field hidden.</p>
      </div>
    </>
  );
}
