import { requireCtx } from "@/lib/session";
import { previewSettlement, isPayroll } from "@/lib/services/payroll";
import { hrLookups } from "@/lib/services/hr";
import { forbidden, AppError } from "@/lib/errors";
import { settlementAction } from "@/app/actions-hr";
import { Flash, Money, PageHead, Link } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

const REASONS: [string, string][] = [["resignation", "Resignation"], ["termination", "Termination"], ["end_of_contract", "End of contract"], ["retirement", "Retirement"], ["death", "Death"], ["other", "Other"]];

export default async function NewSettlement({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  if (!isPayroll(ctx)) throw forbidden();
  const sp = await searchParams;
  const l = await hrLookups(ctx);
  let p: Awaited<ReturnType<typeof previewSettlement>> | null = null;
  if (sp.preview && sp.employee_id) {
    try { p = await previewSettlement(ctx, sp as never); } catch (e) { if (!(e instanceof AppError)) throw e; }
  }
  const v = (k: string) => sp[k] ?? "";
  const line = (label: string, amt: string, note?: string, minus?: boolean) => <tr><td>{label}{note && <div className="small muted">{note}</div>}</td><td className="num">{minus ? "− " : ""}<Money v={amt} /></td></tr>;
  return (
    <>
      <PageHead title="New final settlement" sub="Check the figures first; the owner approves it. On approval the employee is marked as left and open loans are closed."><Link className="btn ghost sm" href="/payroll/settlements">Final settlements</Link></PageHead>
      <HrTabs group="payroll" at="/payroll/settlements" />
      <Flash sp={sp} />
      <form className="card" action={settlementAction}>
        <div className="row">
          <div className="field"><label htmlFor="se">Employee</label><select id="se" name="employee_id" required defaultValue={v("employee_id")}><option value="">Choose</option>{l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name} ({m.branch_code})</option>)}</select></div>
          <div className="field"><label htmlFor="sl">Last working day</label><input id="sl" type="date" name="last_day" required defaultValue={v("last_day")} /></div>
          <div className="field"><label htmlFor="sr">Reason</label><select id="sr" name="reason" required defaultValue={v("reason")}><option value="">Choose</option>{REASONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="sn">Notice pay in lieu (days, optional)</label><input id="sn" name="notice_days" inputMode="numeric" defaultValue={v("notice_days")} /></div>
          <div className="field"><label htmlFor="so">Other deductions (AED, optional)</label><input id="so" name="other_deductions" inputMode="decimal" defaultValue={v("other_deductions")} /></div>
          <div className="field"><label htmlFor="sd">For what</label><input id="sd" name="deduction_note" defaultValue={v("deduction_note")} placeholder="For example: damaged tools" /></div>
        </div>
        <button className="btn ghost" name="$preview" value="1">Show the figures</button>{" "}
        {p && <button className="btn">Send to owner for approval</button>}
      </form>
      {p && (
        <div className="card"><h2>Settlement statement</h2>
          <table><tbody>
            {line("Gratuity", p.gratuity, `${Number(p.years).toFixed(2)} years of service on basic AED ${p.basic}: 21 days a year for the first 5 years, 30 days after, at most 2 years' pay`)}
            {line("Unused annual leave", p.leaveSalary, `${p.unused} days`)}
            {line("Salary not yet paid", p.unpaidSalary, `${p.unpaidDays} days of the last month`)}
            {Number(p.air) > 0 && line("Air ticket due", p.air)}
            {Number(p.noticePay) > 0 && line("Notice pay", p.noticePay, `${p.notice} days`)}
            {Number(p.loans) > 0 && line("Loans and advances still open", p.loans, undefined, true)}
            {Number(p.other) > 0 && line("Other deductions", p.other, v("deduction_note"), true)}
            <tr><td><b>Net payable</b></td><td className="num"><b><Money v={p.net} /></b></td></tr>
          </tbody></table>
        </div>
      )}
    </>
  );
}
