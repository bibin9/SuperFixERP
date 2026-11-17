import { requireCtx } from "@/lib/session";
import { listLeave } from "@/lib/services/hr-time";
import { hrLookups } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { requestLeaveAction, cancelLeaveAction } from "@/app/actions-hr";
import { Flash, Link, PageHead, Status, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function Leave({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listLeave(ctx, { status: sp.status, employeeId: sp.employee });
  const l = await hrLookups(ctx);
  const back = `/hr/leave${sp.status ? `?status=${sp.status}` : ""}`;
  return (
    <>
      <PageHead title="Leave" sub="Requests go to the line manager, then HR. Balances are on each employee's Leave tab." />
      <HrTabs group="hr" at="/hr/leave" />
      <Flash sp={sp} />
      <form className="card row" style={{ alignItems: "end" }}>
        <div className="field"><label htmlFor="ls">Status</label><AutoSubmitSelect id="ls" name="status" defaultValue={sp.status ?? ""}><option value="">All</option><option value="pending_approval">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></AutoSubmitSelect></div>
        <div className="field"><label htmlFor="le">Employee</label><AutoSubmitSelect id="le" name="employee" defaultValue={sp.employee ?? ""}><option value="">Everyone</option>{l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)}</AutoSubmitSelect></div>
      </form>
      <div className="card"><h2>{rows.length} request{rows.length === 1 ? "" : "s"}</h2>
        <table><thead><tr><th>No.</th><th>Employee</th><th>Leave</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.doc_no}</td><td><Link href={`/hr/employees/${r.employee_id}?tab=leave`}>{r.emp_no} {r.full_name}</Link> <span className="small muted">{r.branch_code}</span></td><td>{r.leave_name}</td>
              <td>{d(r.from_d)}</td><td>{d(r.to_d)}</td><td className="num">{r.days}</td><td><Status s={r.status} />{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td>
              <td>{["pending_approval", "approved"].includes(r.status) && canAnywhere(ctx, "hr", "edit") && <form action={cancelLeaveAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="$back" value={back} /><ConfirmButton className="btn ghost sm" message="Cancel this leave?">Cancel</ConfirmButton></form>}</td></tr>))}
          </tbody></table>
        {!rows.length && <p className="muted small">None.</p>}
      </div>
      {canAnywhere(ctx, "hr", "create") && (
        <div className="card"><h2>Apply for leave for an employee</h2>
          <form action={requestLeaveAction}><input type="hidden" name="$back" value={back} />
            <div className="row"><div className="field"><label>Employee</label><select name="employee_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)]}</select></div>
              <div className="field"><label>Leave</label><select name="leave_type" required>{l.leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
              <div className="field"><label>From</label><input type="date" name="from_date" required /></div><div className="field"><label>To</label><input type="date" name="to_date" required /></div>
              <div className="field"><label>Reason (optional)</label><input name="reason" /></div></div>
            <button className="btn sm">Send for approval</button></form>
        </div>
      )}
    </>
  );
}
