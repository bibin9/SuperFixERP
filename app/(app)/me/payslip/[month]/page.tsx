import { requireCtx } from "@/lib/session";
import { payslip } from "@/lib/services/payroll";
import { Link, PageHead } from "@/components/ui";
import { Payslip } from "@/components/Payslip";

export default async function MyPayslip({ params }: { params: Promise<{ month: string }> }) {
  const ctx = await requireCtx();
  const { month } = await params;
  const p = await payslip(ctx, month);
  return (<><div className="no-print"><PageHead title={`My payslip ${month}`}><Link className="btn ghost sm" href="/me">My HR</Link></PageHead></div><Payslip p={p} /></>);
}
