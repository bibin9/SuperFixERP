import { requireCtx } from "@/lib/session";
import { attendance } from "@/lib/services/hr-time";
import { hrLookups, today } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { manualPunchAction, importPunchesAction } from "@/app/actions-hr";
import { Flash, Link, PageHead, Status, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

export default async function Attendance({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const t = today();
  const from = sp.from || `${t.slice(0, 7)}-01`, to = sp.to || t;
  const rows = await attendance(ctx, { from, to, branchId: sp.branch, employeeId: sp.employee });
  const l = await hrLookups(ctx);
  const sum = (st: string) => rows.filter((r) => r.status === st).length;
  const edit = canAnywhere(ctx, "hr", "edit") || canAnywhere(ctx, "hr", "approve");
  const qs = new URLSearchParams(Object.entries(sp).filter(([k]) => !["ok", "err", "errf"].includes(k))).toString();
  return (
    <>
      <PageHead title="Attendance" sub="From the biometric device, mobile check-in and punches added by hand, against each day's shift">
        {edit && <Link className="btn ghost sm" href="/hr/qr">Branch QR code</Link>}
      </PageHead>
      <HrTabs group="hr" at="/hr/attendance" />
      <Flash sp={sp} />
      <form className="card row" style={{ alignItems: "end" }}>
        <div className="field"><label htmlFor="fb">Branch</label><AutoSubmitSelect id="fb" name="branch" defaultValue={sp.branch ?? ""}><option value="">All branches</option>{l.branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</AutoSubmitSelect></div>
        <div className="field"><label htmlFor="fe">Employee</label><AutoSubmitSelect id="fe" name="employee" defaultValue={sp.employee ?? ""}><option value="">Everyone</option>{l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)}</AutoSubmitSelect></div>
        <div className="field"><label htmlFor="ff">From</label><input id="ff" type="date" name="from" defaultValue={from} /></div>
        <div className="field"><label htmlFor="ft">To</label><input id="ft" type="date" name="to" defaultValue={to} /></div>
        <button className="btn sm shrink">Show</button>
      </form>
      <div className="card"><h2>{sum("present")} present · {sum("late")} late · {sum("early_leave")} left early · {sum("absent")} absent · {sum("missing_out")} without check-out · {sum("leave")} on leave</h2>
        <table><thead><tr><th>Day</th><th>Employee</th><th>Branch</th><th>Shift</th><th>In</th><th>Out</th><th>Hours</th><th>Late</th><th>Status</th></tr></thead>
          <tbody>{rows.slice().reverse().slice(0, 600).map((r) => (
            <tr key={r.employee_id + r.date}><td>{d(r.date)}</td><td>{r.emp_no} {r.full_name}</td><td>{r.branch_code}</td><td>{r.shift ?? ""}</td><td>{r.first_in ?? ""}</td><td>{r.last_out ?? ""}</td>
              <td className="num">{r.worked_h ? r.worked_h.toFixed(2) : ""}</td><td className="num">{r.late_min ? `${r.late_min} min` : r.early_min ? `early ${r.early_min} min` : ""}</td><td><Status s={r.status} />{r.note && <span className="small muted"> {r.note}</span>}</td></tr>))}
          </tbody></table>
        {!rows.length && <p className="muted small">No staff in this selection.</p>}
      </div>
      {edit && (
        <div className="grid2">
          <div className="card"><h2>Add a punch by hand</h2>
            <form action={manualPunchAction}><input type="hidden" name="$back" value={`/hr/attendance${qs ? `?${qs}` : ""}`} />
              <div className="row"><div className="field"><label>Employee</label><select name="employee_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)]}</select></div>
                <div className="field"><label>Date</label><input type="date" name="date" required max={t} /></div><div className="field"><label>Time</label><input type="time" name="time" required /></div>
                <div className="field" style={{ flexBasis: "100%" }}><label>Why by hand</label><input name="note" required placeholder="For example: forgot to punch, device down" /></div></div>
              <button className="btn sm">Add punch</button></form>
          </div>
          {canAnywhere(ctx, "hr", "edit") && <div className="card"><h2>Import from the biometric device</h2>
            <form action={importPunchesAction} encType="multipart/form-data">
              <p className="small muted">A CSV export with an &quot;Employee no&quot; column and a &quot;Date time&quot; column (or &quot;Date&quot; and &quot;Time&quot;). Punches already imported are skipped.</p>
              <div className="row"><div className="field"><label>File</label><input type="file" name="file" accept=".csv,.txt" required /></div><div className="field"><label>Device (optional)</label><input name="device_ref" placeholder="YAS-ZK1" /></div></div>
              <button className="btn sm">Import</button></form>
          </div>}
        </div>
      )}
    </>
  );
}
