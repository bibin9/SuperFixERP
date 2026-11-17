import { requireCtx } from "@/lib/session";
import { payslip } from "@/lib/services/payroll";
import { Link, PageHead } from "@/components/ui";
import { Payslip } from "@/components/Payslip";

export default async function StaffPayslip({ params }: { params: Promise<{ month: string; employee: string }> }) {
  const ctx = await requireCtx();
  const { month, employee } = await params;
  const p = await payslip(ctx, month, employee);
  return (<><div className="no-print"><PageHead title={`Payslip ${month} · ${p.slip.full_name}`}><Link className="btn ghost sm" href={`/payroll/${month}`}>Payroll {month}</Link></PageHead></div><Payslip p={p} /></>);
}
