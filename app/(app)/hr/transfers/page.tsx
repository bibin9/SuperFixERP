import { requireCtx } from "@/lib/session";
import { listTransfers, orgChart, hrLookups } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { transferAction } from "@/app/actions-hr";
import { Flash, Link, PageHead, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

type E = { id: string; emp_no: string; full_name: string; line_manager_id: string | null; branch_code: string; designation: string | null; department: string | null };
function Tree({ all, under }: { all: E[]; under: string | null }) {
  const kids = all.filter((e) => (under === null ? !e.line_manager_id || !all.some((x) => x.id === e.line_manager_id) : e.line_manager_id === under));
  if (!kids.length) return null;
  return <ul className="org">{kids.map((e) => <li key={e.id}><Link href={`/hr/employees/${e.id}`}>{e.full_name}</Link> <span className="small muted">{e.designation ?? ""} · {e.branch_code}</span><Tree all={all} under={e.id} /></li>)}</ul>;
}

export default async function Transfers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listTransfers(ctx);
  const org = await orgChart(ctx);
  const l = await hrLookups(ctx);
  return (
    <>
      <PageHead title="Transfers and org chart" sub="Who reports to whom, departments, and staff moved between branches" />
      <HrTabs group="hr" at="/hr/transfers" />
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card"><h2>Reporting lines</h2><Tree all={org.emps} under={null} /></div>
        <div className="card"><h2>Departments</h2>
          <table><tbody>{org.depts.map((x) => <tr key={x.name_en}><td>{x.name_en}</td><td className="num">{x.n}</td><td className="small muted">{x.head ? `Head: ${x.head}` : ""}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="card"><h2>Transfers</h2>
        <table><thead><tr><th>Employee</th><th>From</th><th>To</th><th>Effective</th><th>Reason</th><th>By</th><th>Done</th></tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id}><td>{t.emp_no} {t.full_name}</td><td>{t.from_code}</td><td>{t.to_code}</td><td>{d(String(t.effective_date instanceof Date ? t.effective_date.toISOString() : t.effective_date).slice(0, 10))}</td><td>{t.reason}</td><td>{t.created_by_name}</td><td>{t.applied ? "Yes" : "Planned"}</td></tr>)}</tbody></table>
        {!rows.length && <p className="muted small">No transfers yet.</p>}
        {canAnywhere(ctx, "hr", "edit") && (
          <form action={transferAction} style={{ marginTop: 12 }}><input type="hidden" name="$back" value="/hr/transfers" />
            <div className="row"><div className="field"><label>Employee</label><select name="employee_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name} ({m.branch_code})</option>)]}</select></div>
              <div className="field"><label>To branch</label><select name="to_branch_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)]}</select></div>
              <div className="field"><label>From date</label><input type="date" name="effective_date" required /></div><div className="field"><label>Reason (optional)</label><input name="reason" /></div></div>
            <button className="btn sm">Transfer</button></form>
        )}
      </div>
    </>
  );
}
