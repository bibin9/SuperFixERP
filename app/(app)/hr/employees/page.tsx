import { requireCtx } from "@/lib/session";
import { listEmployees, hrLookups, isHr } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, PageHead, Status, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

export default async function Employees({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listEmployees(ctx, { q: sp.q, branch: sp.branch, department: sp.department, status: sp.status, cf: sp.cf, cfv: sp.cfv });
  const l = await hrLookups(ctx);
  const filterable = l.customFields.filter((f) => !["attachment"].includes(f.field_type));
  return (
    <>
      <PageHead title="Employees" sub="Every employee file, with filters by branch, department, status and the extra fields">
        {canAnywhere(ctx, "hr", "create") && <Link className="btn sm" href="/hr/employees/new">New employee</Link>}
      </PageHead>
      <HrTabs group="hr" at="/hr/employees" />
      <Flash sp={sp} />
      <form className="card row" style={{ alignItems: "end" }}>
        <div className="field"><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Name, employee no. or mobile" /></div>
        <div className="field"><label htmlFor="br">Branch</label><AutoSubmitSelect id="br" name="branch" defaultValue={sp.branch ?? ""}><option value="">All branches</option>{l.branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</AutoSubmitSelect></div>
        <div className="field"><label htmlFor="dp">Department</label><AutoSubmitSelect id="dp" name="department" defaultValue={sp.department ?? ""}><option value="">All</option>{l.departments.map((x) => <option key={x.id} value={x.id}>{x.name_en}</option>)}</AutoSubmitSelect></div>
        <div className="field"><label htmlFor="st">Status</label><AutoSubmitSelect id="st" name="status" defaultValue={sp.status ?? "active"}><option value="active">Working</option><option value="left">Left</option></AutoSubmitSelect></div>
        {filterable.length > 0 && <>
          <div className="field"><label htmlFor="cf">Extra field</label><select id="cf" name="cf" defaultValue={sp.cf ?? ""}><option value="">—</option>{filterable.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}</select></div>
          <div className="field"><label htmlFor="cfv">Has value</label><input id="cfv" name="cfv" defaultValue={sp.cfv ?? ""} /></div>
        </>}
        <button className="btn sm shrink">Show</button>
      </form>
      <div className="card"><h2>{rows.length} employee{rows.length === 1 ? "" : "s"}</h2>
        <table className="stack"><thead><tr><th>Employee</th><th>Branch</th><th>Department</th><th>Designation</th><th>Line manager</th><th>Joined</th><th>Status</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}><td><Link href={`/hr/employees/${e.id}`}>{e.emp_no} · {e.first_name} {e.last_name}</Link>{!e.user_id && <span className="muted small"> · no sign-in</span>}</td>
              <td>{e.branch_code}</td><td>{e.department ?? ""}</td><td>{e.designation ?? ""}</td><td>{e.line_manager ?? ""}</td>
              <td>{d(e.joining_date)}</td><td><Status s={e.status} /></td></tr>))}
          </tbody></table>
        {!rows.length && <p className="muted small">No employees match.</p>}
        {!isHr(ctx) && <p className="small muted">You see the staff of your branches. Salaries and bank details are kept by HR.</p>}
      </div>
    </>
  );
}
