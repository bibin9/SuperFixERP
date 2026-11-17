import { requireCtx } from "@/lib/session";
import { getSettlement } from "@/lib/services/payroll";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export default async function Settlement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSettlement(ctx, id);
  const row = (l: string, v: string, minus = false) => Number(v) ? <tr><td>{l}</td><td className="num">{minus ? "− " : ""}<Money v={v} /></td></tr> : null;
  return (
    <>
      <div className="no-print"><PageHead title={`Final settlement ${s.doc_no ?? ""}`} sub={`${s.emp_no} ${s.full_name}`}><Status s={s.status} /><PrintButton /><Link className="btn ghost sm" href="/payroll/settlements">Final settlements</Link></PageHead><Flash sp={sp} /></div>
      <div className="card doc" style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sflogo.png" alt="Superfix" style={{ height: 48 }} />
        <h2>End of service settlement <span className="small muted" dir="rtl">تسوية نهاية الخدمة</span></h2>
        <table><tbody>
          <tr><td className="muted">Employee</td><td>{s.emp_no} · {s.full_name}{s.name_ar ? ` · ${s.name_ar}` : ""}</td></tr>
          <tr><td className="muted">Designation, branch</td><td>{s.designation ?? ""} · {s.branch_name}</td></tr>
          <tr><td className="muted">Joined, last day</td><td>{d(s.joining_d)} to {d(s.last_d)} ({Number(s.service_years).toFixed(2)} years)</td></tr>
          <tr><td className="muted">Reason</td><td>{String(s.reason).replace(/_/g, " ")} · {String(s.contract_type).replace(/_/g, " ")} contract</td></tr>
        </tbody></table>
        <table style={{ marginTop: 12 }}><tbody>
          {row(`Gratuity on basic AED ${s.basic}`, s.gratuity)}{row(`Unused annual leave (${s.unused_leave_days} days)`, s.leave_salary)}{row(`Salary for ${s.unpaid_days} days not yet paid`, s.unpaid_salary)}
          {row("Air ticket", s.air_ticket)}{row(`Notice pay (${s.notice_days} days)`, s.notice_pay)}{row("Loans and advances recovered", s.loans, true)}{row(`Other deductions${s.deduction_note ? `: ${s.deduction_note}` : ""}`, s.other_deductions, true)}
          <tr><td><b>Net payable</b></td><td className="num"><b><Money v={s.net} /></b></td></tr>
        </tbody></table>
        {s.reject_reason && <p className="small">Rejected: {s.reject_reason}</p>}
        <p style={{ marginTop: 40 }} className="small">Employee signature ____________________ &nbsp; &nbsp; HR ____________________ &nbsp; &nbsp; Approved ____________________</p>
      </div>
    </>
  );
}
