import { requireCtx } from "@/lib/session";
import { listUsers, listBranches, listRoles } from "@/lib/services/admin";
import { createUserAction, userRoleAction, disableUserAction, resetPasswordAction } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, PageHead } from "@/components/ui";

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [users, branches, { roles }] = await Promise.all([listUsers(ctx), listBranches(ctx), listRoles(ctx)]);
  return (
    <>
      <PageHead title="Users and access" sub="Each user holds one role per branch. ALL gives every branch (owner, head office). Disable user removes all access at once." />
      <Flash sp={sp} />
      <div className="card"><h2>New user</h2>
        <form action={createUserAction} className="row">
          <div className="field"><label>User name</label><input name="username" required /></div>
          <div className="field"><label>Full name</label><input name="full_name" required /></div>
          <div className="field"><label>Mobile</label><input name="mobile" /></div>
          <div className="field"><label>Default branch</label><select name="default_branch_id">{branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
          <div className="field"><label>Password (8+)</label><input name="password" type="password" required /></div>
          <div className="shrink"><button className="btn">Create</button></div>
        </form>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>User</th><th>Access (branch: role)</th><th>Give or change access</th><th>Status</th><th></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td><b>{u.full_name}</b><div className="small muted">{u.username}{u.locked_until && new Date(u.locked_until) > new Date() ? " · locked" : ""}</div></td>
              <td className="small">{u.grants.map((g: { branch: string; role: string }) => <div key={g.branch}>{g.branch}: {g.role}</div>)}</td>
              <td>{u.status === "active" && (
                <form action={userRoleAction} className="row"><input type="hidden" name="user_id" value={u.id} />
                  <select name="branch_id" style={{ minHeight: 32 }}><option value="ALL">ALL branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>
                  <select name="role_id" style={{ minHeight: 32 }}><option value="">(remove)</option>{roles.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                  <button className="btn ghost sm shrink">Set</button></form>)}</td>
              <td>{u.status}</td>
              <td>{u.status === "active" && <>
                <form action={disableUserAction}><input type="hidden" name="user_id" value={u.id} /><ConfirmButton className="btn ghost red-text sm" message={`Disable ${u.full_name}? This ends their sessions and removes access at every branch.`}>Disable user</ConfirmButton></form>
                <form action={resetPasswordAction} className="row" style={{ marginTop: 4 }}><input type="hidden" name="user_id" value={u.id} /><input name="password" type="password" placeholder="New password" style={{ minHeight: 32 }} /><button className="btn ghost sm shrink">Reset</button></form>
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
