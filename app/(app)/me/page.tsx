import { requireCtx } from "@/lib/session";
import { selfService, listLeave } from "@/lib/services/hr-time";
import { listLetters } from "@/lib/services/hr";
import { listLoans, myPayslips } from "@/lib/services/payroll";
import { checkInAction, requestLeaveAction, cancelLeaveAction, requestLetterAction, requestLoanAction } from "@/app/actions-hr";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { GpsCheckIn } from "@/components/GpsCheckIn";
import { ConfirmButton } from "@/components/ConfirmButton";

/** Employee self-service: check-in, my week, leave, letters, advances and payslips. */
export default async function Me({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const x = await selfService(ctx);
  if (!x) return (<><PageHead title="My HR" /><div className="card"><p>Your sign-in is not linked to an employee file yet. Ask HR to link it.</p></div></>);
  const [leave, letters, loans, slips] = await Promise.all([listLeave(ctx, { mine: true }), listLetters(ctx, true), listLoans(ctx, true), myPayslips(ctx)]);
  const me = x.me;
  const nextMonth = (() => { const t = new Date(); t.setUTCMonth(t.getUTCMonth() + 1); return t.toISOString().slice(0, 7); })();
  return (
    <>
      <PageHead title={`My HR · ${me.first_name} ${me.last_name}`} sub={`${me.emp_no} · ${me.designation ?? ""} · ${me.branch_name}${me.line_manager ? ` · reports to ${me.line_manager}` : ""}`} />
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card"><h2>Today</h2>
          <p>{x.punches.length ? `Punches today: ${x.punches.map((p) => `${p.t} (${p.source === "gps" ? "location" : p.source === "qr" ? "QR" : p.source})`).join(", ")}` : "No punch yet today."}</p>
          <GpsCheckIn action={checkInAction} back="/me" />
          <p className="small muted">Works within the distance set by HR from your branch. If location is not available, scan the QR code on the branch screen.</p>
          <h3>My week</h3>
          <table><tbody>{x.week.map((w) => <tr key={w.d}><td>{d(w.d)}</td><td>{w.label}</td></tr>)}</tbody></table>
        </div>
        <div className="card"><h2>Leave balances</h2>
          <table><thead><tr><th>Leave</th><th>Taken</th><th>Waiting</th><th>Left</th></tr></thead><tbody>{x.balances.map((b) => <tr key={b.code}><td>{b.name}</td><td className="num">{b.taken}</td><td className="num">{b.pending}</td><td className="num"><b>{b.balance ?? "As needed"}</b></td></tr>)}</tbody></table>
          <h3>Apply for leave</h3>
          <form action={requestLeaveAction}><input type="hidden" name="$back" value="/me" />
            <div className="row"><div className="field"><label htmlFor="lt">Leave</label><select id="lt" name="leave_type" required>{x.leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
              <div className="field"><label htmlFor="lf">From</label><input id="lf" type="date" name="from_date" required /></div><div className="field"><label htmlFor="lto">To</label><input id="lto" type="date" name="to_date" required /></div>
              <div className="field" style={{ flexBasis: "100%" }}><label htmlFor="lr">Reason (optional)</label><input id="lr" name="reason" /></div></div>
            <button className="btn sm">Send to my manager</button></form>
        </div>
      </div>
      <div className="card"><h2>My leave requests</h2>
        <table><thead><tr><th>No.</th><th>Leave</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{leave.map((r) => <tr key={r.id}><td>{r.doc_no}</td><td>{r.leave_name}</td><td>{d(r.from_d)}</td><td>{d(r.to_d)}</td><td className="num">{r.days}</td><td><Status s={r.status} />{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td>
            <td>{(r.status === "pending_approval" || (r.status === "approved" && r.from_d > new Date().toISOString().slice(0, 10))) && <form action={cancelLeaveAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="$back" value="/me" /><ConfirmButton className="btn ghost sm" message="Cancel this leave request?">Cancel</ConfirmButton></form>}</td></tr>)}</tbody></table>
        {!leave.length && <p className="muted small">None yet.</p>}
      </div>
      <div className="grid2">
        <div className="card"><h2>My payslips</h2>
          <table><tbody>{slips.map((s) => <tr key={s.month}><td><Link href={`/me/payslip/${s.month}`}>{s.month}</Link></td><td className="num"><Money v={s.net} /></td></tr>)}</tbody></table>
          {!slips.length && <p className="muted small">Your payslip shows here once the month&apos;s payroll is approved.</p>}
        </div>
        <div className="card"><h2>Letters</h2>
          <table><tbody>{letters.map((l) => <tr key={l.id}><td>{l.status === "approved" ? <Link href={`/hr/letters/${l.id}`}>{l.template}</Link> : l.template}</td><td>{l.language === "ar" ? "Arabic" : "English"}</td><td><Status s={l.status} /></td></tr>)}</tbody></table>
          <form action={requestLetterAction}><input type="hidden" name="$back" value="/me" />
            <div className="row"><div className="field"><label htmlFor="tc">Letter</label><select id="tc" name="template_code" required>{x.letterTemplates.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
              <div className="field"><label htmlFor="lg">Language</label><select id="lg" name="language"><option value="en">English</option><option value="ar">Arabic</option></select></div>
              <div className="field"><label htmlFor="at">Addressed to (optional)</label><input id="at" name="addressed_to" placeholder="For example: Emirates NBD" /></div></div>
            <button className="btn sm">Ask HR</button></form>
        </div>
      </div>
      <div className="grid2">
        <div className="card"><h2>Salary advance or loan</h2>
          <table><tbody>{loans.map((l) => <tr key={l.id}><td>{l.kind === "loan" ? "Loan" : "Advance"} {l.doc_no ?? ""}</td><td className="num"><Money v={l.amount} /></td><td className="small">{l.instalments} × <Money v={l.instalment_amount} /> from {l.start_m}</td><td><Status s={l.status} />{l.status === "approved" && <div className="small">left <Money v={l.balance} /></div>}</td></tr>)}</tbody></table>
          <form action={requestLoanAction}><input type="hidden" name="$back" value="/me" />
            <div className="row"><div className="field"><label htmlFor="lk">Type</label><select id="lk" name="kind"><option value="advance">Salary advance</option><option value="loan">Loan</option></select></div>
              <div className="field"><label htmlFor="la">Amount (AED)</label><input id="la" name="amount" inputMode="decimal" required /></div>
              <div className="field"><label htmlFor="li">Months to repay</label><input id="li" name="instalments" inputMode="numeric" defaultValue="1" required /></div>
              <div className="field"><label htmlFor="ls">First deduction</label><input id="ls" type="month" name="start_month" defaultValue={nextMonth} required /></div>
              <div className="field" style={{ flexBasis: "100%" }}><label htmlFor="lre">Reason</label><input id="lre" name="reason" required /></div></div>
            <button className="btn sm">Send to my manager</button></form>
        </div>
        <div className="card"><h2>My documents</h2>
          <table><tbody>{x.docs.map((r, i) => <tr key={i}><td>{r.kind === "document" ? String(r.data.doc_type).replace(/_/g, " ") : `Insurance ${r.data.provider}`}</td><td>{r.data.number ?? r.data.policy_no}</td><td>{r.expiry ? `expires ${d(r.expiry)}` : ""}</td></tr>)}</tbody></table>
          {!x.docs.length && <p className="muted small">None on file.</p>}
          {x.overtime.length > 0 && <><h3>My overtime</h3><table><tbody>{x.overtime.map((o) => <tr key={o.id}><td>{d(o.work_d)}</td><td className="num">{o.hours} h</td><td>{String(o.ot_type).replace("_", " ")}</td><td><Status s={o.status} /></td></tr>)}</tbody></table></>}
        </div>
      </div>
    </>
  );
}
