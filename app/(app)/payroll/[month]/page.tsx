/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireCtx } from "@/lib/session";
import { getRun, isPayroll } from "@/lib/services/payroll";
import { runStepPayAction, calculateRunAction } from "@/app/actions-hr";
import { Flash, Link, Money, PageHead, Status, dt } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";
import { ConfirmButton } from "@/components/ConfirmButton";

const STEPS = ["calculated", "pending_approval", "approved", "posted", "wps_created", "paid"];
const STEP_LABEL = ["Calculated", "Waiting for owner", "Approved", "Posted", "WPS file", "Paid"];

export default async function Run({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { month } = await params;
  const sp = await searchParams;
  const g = await getRun(ctx, month);
  const pr = isPayroll(ctx);
  const owner = ctx.grants.some((x) => x.roleCode === "owner");
  const r: any = g.run;
  if (!r) return (<><PageHead title={`Payroll ${month}`} /><HrTabs group="payroll" at="/payroll" /><div className="card"><p>Not calculated yet. <Link href="/payroll">Calculate it</Link>.</p></div></>);
  const at = STEPS.indexOf(r.status);
  const flagged = g.rows.filter((x: any) => (x.flags as string[]).some((f) => !f.startsWith("First payroll")));
  const step = (s: string, label: string, cls = "btn sm", confirm?: string) => (
    <form action={runStepPayAction} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="month" value={month} /><input type="hidden" name="step" value={s} />
      {confirm ? <ConfirmButton className={cls} message={confirm}>{label}</ConfirmButton> : <button className={cls}>{label}</button>}</form>);
  return (
    <>
      <PageHead title={`Payroll ${month}`} sub={`${r.employees} employees · gross AED ${Number(r.gross).toLocaleString("en-US", { minimumFractionDigits: 2 })} · net AED ${Number(r.net).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}>
        <Status s={r.status} /><Link className="btn ghost sm" href={`/payroll/${month}/register`}>Branch register</Link>
      </PageHead>
      <HrTabs group="payroll" at="/payroll" />
      <Flash sp={sp} />
      <div className="card">
        <div className="steps">{STEP_LABEL.map((l, i) => <span key={l} className={i < at ? "done" : i === at ? "on" : ""}>{i < at ? "✓ " : ""}{l}</span>)}</div>
        <div className="row" style={{ marginTop: 10 }}>
          {pr && r.status === "calculated" && <form action={calculateRunAction} className="inline"><input type="hidden" name="month" value={month} /><input type="hidden" name="$back" value={`/payroll/${month}`} /><button className="btn ghost sm">Recalculate</button></form>}
          {pr && r.status === "calculated" && step("submit", "Checked: send to owner for approval", "btn sm", `Send payroll ${month} for approval? ${flagged.length} line(s) have notes; check them first.`)}
          {r.status === "pending_approval" && <span className="small">Waiting in the owner&apos;s <Link href="/approvals">approvals</Link>.</span>}
          {pr && r.status === "approved" && step("post", "Post to the accounts", "btn sm", "Post the payroll? Salary cost goes to each branch by days worked.")}
          {pr && ["posted", "wps_created"].includes(r.status) && step("wps", r.status === "wps_created" ? "Make the WPS files again" : "Create WPS salary files", "btn sm")}
          {pr && r.status === "wps_created" && (
            <form action={runStepPayAction} className="row inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="month" value={month} /><input type="hidden" name="step" value="paid" />
              <select name="bank_account_id" aria-label="Paid from bank" required defaultValue="">{[<option key="" value="">Paid from bank…</option>, ...(g.banks ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)]}</select>
              <ConfirmButton className="btn green sm" message="Mark the salaries as paid by the bank?">Mark paid</ConfirmButton></form>)}
          {owner && ["approved", "posted"].includes(r.status) && (
            <form action={runStepPayAction} className="row inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="month" value={month} /><input type="hidden" name="step" value="reopen" />
              <input name="reason" placeholder="Reason to reopen" required /><ConfirmButton className="btn red sm" message="Reopen this payroll? Posted entries are reversed.">Reopen</ConfirmButton></form>)}
        </div>
        {r.reopen_reason && <p className="small muted">Reopened {dt(r.reopened_at)}: {r.reopen_reason}</p>}
        {g.files.length > 0 && <><h3>WPS salary files</h3><table><tbody>{g.files.map((f: any) => <tr key={f.id}><td><a href={`/api/payroll/wps/${f.id}`}>{f.file_name}</a></td><td>{f.agent}</td><td className="num">{f.records} employees</td><td className="num"><Money v={f.total} /></td></tr>)}</tbody></table>
          <p className="small muted">Upload each file to the bank or exchange house portal yourself; nothing is sent from here.</p></>}
      </div>
      {flagged.length > 0 && (
        <div className="card"><h2>Check these ({flagged.length})</h2>
          <table><tbody>{flagged.map((x: any) => <tr key={x.id}><td>{x.emp_no} {x.full_name}</td><td className="small">{(x.flags as string[]).filter((f) => !f.startsWith("First payroll")).join(" · ")}</td></tr>)}</tbody></table>
        </div>
      )}
      <div className="card"><h2>Employees</h2>
        <table><thead><tr><th>Employee</th><th>Branch</th><th>Days</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Last month</th><th>Days by branch</th></tr></thead>
          <tbody>{g.rows.map((x: any) => (
            <tr key={x.id}><td><Link href={`/payroll/payslip/${month}/${x.employee_id}`}>{x.emp_no} {x.full_name}</Link><div className="small muted">{x.designation ?? ""}</div></td><td>{x.branch_code}</td>
              <td className="num">{Number(x.paid_days)}{Number(x.unpaid_days) ? <div className="small muted">{x.unpaid_days} unpaid</div> : null}</td>
              <td className="num"><Money v={x.gross} />{Number(x.ot_hours) ? <div className="small muted">OT {Number(x.ot_hours)} h</div> : null}</td>
              <td className="num"><Money v={x.total_deductions} /></td><td className="num"><b><Money v={x.net} /></b></td>
              <td className="num">{x.prev_net === null ? <span className="small muted">—</span> : <Money v={x.prev_net} />}</td><td className="small">{x.split ?? ""}</td></tr>))}
          </tbody></table>
      </div>
    </>
  );
}
