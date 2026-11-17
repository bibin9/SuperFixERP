import { requireCtx } from "@/lib/session";
import { listOvertime } from "@/lib/services/hr-time";
import { hrLookups, today } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { requestOvertimeAction } from "@/app/actions-hr";
import { Flash, PageHead, Status, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

const OT: [string, string][] = [["normal", "Normal day"], ["night", "Night (10 pm to 4 am)"], ["rest_day", "Rest day"], ["holiday", "Public holiday"]];

export default async function Overtime({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : today().slice(0, 7);
  const rows = await listOvertime(ctx, { month });
  const l = await hrLookups(ctx);
  const total = rows.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.hours), 0);
  const back = `/hr/overtime?month=${month}`;
  return (
    <>
      <PageHead title="Overtime" sub="Approved by the line manager before it is paid. Payroll pays it at the rates in Settings (payroll.ot_*)." />
      <HrTabs group="hr" at="/hr/overtime" />
      <Flash sp={sp} />
      <form className="card row" style={{ alignItems: "end" }}><div className="field"><label htmlFor="om">Month</label><input id="om" type="month" name="month" defaultValue={month} /></div><button className="btn sm shrink">Show</button></form>
      <div className="card"><h2>{rows.length} request{rows.length === 1 ? "" : "s"} · {total.toFixed(2)} approved hours</h2>
        <table><thead><tr><th>Day</th><th>Employee</th><th>Branch</th><th>Hours</th><th>Type</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{d(r.work_d)}</td><td>{r.emp_no} {r.full_name}</td><td>{r.branch_code}</td><td className="num">{r.hours}</td><td>{OT.find((o) => o[0] === r.ot_type)?.[1]}</td><td>{r.reason}</td>
            <td><Status s={r.status} />{r.payroll_run_id && <span className="small muted"> in payroll</span>}{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="muted small">None this month.</p>}
      </div>
      {(canAnywhere(ctx, "hr", "create") || canAnywhere(ctx, "hr", "approve")) && (
        <div className="card"><h2>Record overtime worked</h2>
          <form action={requestOvertimeAction}><input type="hidden" name="$back" value={back} />
            <div className="row"><div className="field"><label>Employee</label><select name="employee_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)]}</select></div>
              <div className="field"><label>Day worked</label><input type="date" name="work_date" required max={today()} /></div>
              <div className="field"><label>Hours</label><input name="hours" inputMode="decimal" required /></div>
              <div className="field"><label>Type</label><select name="ot_type">{OT.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
              <div className="field" style={{ flexBasis: "100%" }}><label>What for</label><input name="reason" required /></div></div>
            <button className="btn sm">Send for approval</button></form>
        </div>
      )}
    </>
  );
}
