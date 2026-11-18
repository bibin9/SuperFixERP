import { requireCtx } from "@/lib/session";
import { hrDashboard } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, PageHead, Status, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function HrHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const x = await hrDashboard(ctx);
  const p = x.pending;
  return (
    <>
      <PageHead title="HR dashboard" sub="Headcount, joiners and leavers, who is on leave, and what needs attention">
        {canAnywhere(ctx, "hr", "create") && <Link className="btn sm" href="/hr/employees/new">New employee</Link>}
      </PageHead>
      <HrTabs group="hr" at="/hr" />
      <Flash sp={sp} />
      <div className="grid4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="kpi"><div className="v">{x.headcount}</div><div className="l">Headcount</div></div>
        <div className="kpi"><div className="v">{x.joiners.length}</div><div className="l">Joined this year</div></div>
        <div className="kpi"><div className="v">{x.leavers.length}</div><div className="l">Left this year</div></div>
        <div className="kpi"><div className="v">{x.turnover}%</div><div className="l">Turnover this year</div></div>
        <div className="kpi"><div className="v">{p.leave + p.overtime + p.letters + p.loans}</div><div className="l">Waiting for approval</div><div className="l">{p.leave} leave · {p.overtime} overtime · {p.letters} letters · {p.loans} loans</div></div>
      </div>
      <div className="grid2">
        <div className="card"><h2>Expiring documents ({x.alerts.docs.length})</h2>
          {x.alerts.docs.length ? <table><thead><tr><th>Employee</th><th>What</th><th>Expires</th><th><span className="vh">Actions</span></th></tr></thead><tbody>
            {x.alerts.docs.map((r) => <tr key={r.id}><td><Link href={`/hr/employees/${r.employee_id}?tab=records`}>{r.emp_no} {r.full_name}</Link> <span className="muted small">{r.branch_code}</span></td><td>{r.what}</td><td>{d(r.expiry_date)}</td>
              <td><span className={`pill ${Number(r.days_left) < 0 ? "red" : Number(r.days_left) <= 30 ? "amber" : ""}`}>{r.band}</span></td></tr>)}
          </tbody></table> : <p className="muted small">Nothing expiring soon.</p>}
          {x.alerts.people.length > 0 && <><h3>Probation and contracts</h3><table><tbody>{x.alerts.people.map((r) => <tr key={r.employee_id + r.what}><td><Link href={`/hr/employees/${r.employee_id}`}>{r.emp_no} {r.full_name}</Link></td><td>{r.what}</td><td>{d(r.on_date)}</td></tr>)}</tbody></table></>}
        </div>
        <div className="card"><h2>On leave today ({x.onLeave.length})</h2>
          {x.onLeave.length ? <table><tbody>{x.onLeave.map((r) => <tr key={r.id}><td>{r.emp_no} {r.full_name}</td><td>{r.branch_code}</td><td>{r.leave_type}</td><td>back after {d(r.to_date)}</td></tr>)}</tbody></table> : <p className="muted small">Nobody is on leave today.</p>}
          <h3>Headcount by branch</h3>
          <table><tbody>{x.byBranch.map((b) => <tr key={b.code}><td>{b.code} · {b.name_en}</td><td className="num">{b.n}</td></tr>)}</tbody></table>
          <h3>Overtime this month (approved hours)</h3>
          {x.overtime.length ? <table><tbody>{x.overtime.map((o) => <tr key={o.code}><td>{o.code}</td><td className="num">{Number(o.hours).toFixed(2)} h</td></tr>)}</tbody></table> : <p className="muted small">None yet.</p>}
        </div>
        <div className="card"><h2>By nationality</h2><table><tbody>{x.byNationality.map((n) => <tr key={n.name}><td>{n.name}</td><td className="num">{n.n}</td></tr>)}</tbody></table></div>
        <div className="card"><h2>Joiners and leavers this year</h2>
          <table><tbody>
            {x.joiners.map((j) => <tr key={j.id}><td><Status s="active" /></td><td><Link href={`/hr/employees/${j.id}`}>{j.emp_no} {j.full_name}</Link></td><td>{j.branch_code}</td><td>joined {d(j.on_date)}</td></tr>)}
            {x.leavers.map((j) => <tr key={j.id}><td><Status s="left" /></td><td><Link href={`/hr/employees/${j.id}`}>{j.emp_no} {j.full_name}</Link></td><td>{j.branch_code}</td><td>left {d(j.on_date)} · {j.leaving_reason}</td></tr>)}
          </tbody></table>
          {!x.joiners.length && !x.leavers.length && <p className="muted small">None this year.</p>}
        </div>
      </div>
    </>
  );
}
