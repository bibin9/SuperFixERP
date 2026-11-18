/* eslint-disable @typescript-eslint/no-explicit-any */
import { Money, d } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Payslip in English with Arabic labels (PR-07). */
export function Payslip({ p }: { p: any }) {
  const s = p.slip;
  const mon = `${MONTHS[Number(String(s.month).slice(5, 7)) - 1]} ${String(s.month).slice(0, 4)}`;
  const row = (l: any) => <tr key={l.key}><td>{l.label}</td><td className="small muted" dir="rtl">{l.label_ar}</td><td className="num"><Money v={l.amount} /></td></tr>;
  return (
    <>
      <div className="no-print" style={{ marginBottom: 10 }}><PrintButton /></div>
      <div className="card doc" style={{ maxWidth: 780, margin: "0 auto" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sflogo.png" alt="Superfix" width={89} height={48} />
          <div style={{ textAlign: "right" }}><b>Payslip · {mon}</b><div dir="rtl" className="small">قسيمة الراتب</div></div>
        </div>
        <table style={{ marginTop: 12 }}><tbody>
          <tr><td className="muted">Employee</td><td><b>{s.emp_no} · {s.full_name}</b>{s.name_ar && <span dir="rtl"> · {s.name_ar}</span>}</td><td className="muted">Branch</td><td>{s.branch_name}</td></tr>
          <tr><td className="muted">Designation</td><td>{s.designation ?? ""}</td><td className="muted">Department</td><td>{s.department ?? ""}</td></tr>
          <tr><td className="muted">Period</td><td>{d(String(s.period_start).slice(0, 10))} to {d(String(s.period_end).slice(0, 10))}</td><td className="muted">Paid days</td><td>{Number(s.paid_days)}{Number(s.unpaid_days) ? ` (${s.unpaid_days} unpaid)` : ""}</td></tr>
          <tr><td className="muted">Overtime hours</td><td>{Number(s.ot_hours) || "—"}</td><td className="muted">Annual leave left</td><td>{p.annual ?? "—"} days</td></tr>
        </tbody></table>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div><h3>Earnings <span className="small muted" dir="rtl">المستحقات</span></h3><table><tbody>{p.earnings.map(row)}<tr><td><b>Gross</b></td><td></td><td className="num"><b><Money v={s.gross} /></b></td></tr></tbody></table></div>
          <div><h3>Deductions <span className="small muted" dir="rtl">الاستقطاعات</span></h3><table><tbody>{p.deductions.map(row)}{!p.deductions.length && <tr><td className="muted">None</td><td></td><td></td></tr>}<tr><td><b>Total</b></td><td></td><td className="num"><b><Money v={s.total_deductions} /></b></td></tr></tbody></table></div>
        </div>
        <p style={{ fontSize: 18, marginTop: 14 }}>Net pay <span dir="rtl" className="small muted">صافي الراتب</span>: <b><Money v={s.net} /></b>{s.iban && <span className="small muted"> · paid to {String(s.iban).slice(0, 4)}…{String(s.iban).slice(-4)}</span>}</p>
        {Number(s.carried_forward) > 0 && <p className="small">AED {s.carried_forward} of loan instalments moved to next month (deductions are kept within the legal limit).</p>}
        {Number(s.loan_balance) > 0 && <p className="small">Loan or advance still to repay: <Money v={s.loan_balance} /></p>}
      </div>
    </>
  );
}
