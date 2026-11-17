import { requireCtx } from "@/lib/session";
import { listLoans, isPayroll } from "@/lib/services/payroll";
import { hrLookups } from "@/lib/services/hr";
import { requestLoanAction } from "@/app/actions-hr";
import { Flash, Money, PageHead, Status } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Loans({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listLoans(ctx);
  const l = await hrLookups(ctx);
  const next = (() => { const t = new Date(); t.setUTCMonth(t.getUTCMonth() + 1); return t.toISOString().slice(0, 7); })();
  const open = rows.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.balance), 0);
  return (
    <>
      <PageHead title="Advances and loans" sub="Approved by the line manager and the owner, paid out from the bank, recovered in monthly instalments through payroll" />
      <HrTabs group="payroll" at="/payroll/loans" />
      <Flash sp={sp} />
      <div className="card"><h2>{rows.length} advance{rows.length === 1 ? "" : "s"} and loans · AED {open.toLocaleString("en-US", { minimumFractionDigits: 2 })} still to recover</h2>
        <table><thead><tr><th>No.</th><th>Employee</th><th>Type</th><th>Amount</th><th>Instalments</th><th>Recovered</th><th>Left</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.doc_no ?? "—"}</td><td>{r.emp_no} {r.full_name} <span className="small muted">{r.branch_code}</span></td><td>{r.kind === "loan" ? "Loan" : "Advance"}</td>
            <td className="num"><Money v={r.amount} /></td><td className="small">{r.instalments} × <Money v={r.instalment_amount} /> from {r.start_m}</td><td className="num"><Money v={r.recovered} /></td><td className="num"><Money v={r.balance} /></td>
            <td><Status s={r.status} />{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="muted small">None yet.</p>}
      </div>
      {isPayroll(ctx) && (
        <div className="card"><h2>New advance or loan for an employee</h2>
          <form action={requestLoanAction}><input type="hidden" name="$back" value="/payroll/loans" />
            <div className="row"><div className="field"><label>Employee</label><select name="employee_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)]}</select></div>
              <div className="field"><label>Type</label><select name="kind"><option value="advance">Salary advance</option><option value="loan">Loan</option></select></div>
              <div className="field"><label>Amount (AED)</label><input name="amount" inputMode="decimal" required /></div>
              <div className="field"><label>Months to repay</label><input name="instalments" inputMode="numeric" defaultValue="1" required /></div>
              <div className="field"><label>First deduction</label><input type="month" name="start_month" defaultValue={next} required /></div>
              <div className="field" style={{ flexBasis: "100%" }}><label>Reason</label><input name="reason" required /></div></div>
            <button className="btn sm">Send for approval</button></form>
        </div>
      )}
    </>
  );
}
