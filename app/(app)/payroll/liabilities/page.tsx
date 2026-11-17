import { requireCtx } from "@/lib/session";
import { liabilities } from "@/lib/services/payroll";
import { Money, PageHead } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Liabilities() {
  const ctx = await requireCtx();
  const x = await liabilities(ctx);
  const tg = x.gratuity.reduce((s, r) => s + Number(r.v), 0), tl = x.loans.reduce((s, r) => s + Number(r.v), 0);
  return (
    <>
      <PageHead title="Gratuity and staff liabilities" sub={x.month ? `End-of-service gratuity as at the ${x.month} payroll, and loans still to recover` : "Shown after the first approved payroll"} />
      <HrTabs group="payroll" at="/payroll/liabilities" />
      <div className="grid2">
        <div className="card"><h2>Gratuity liability by branch</h2><table><tbody>{x.gratuity.map((r) => <tr key={r.code}><td>{r.code}</td><td className="num"><Money v={r.v} /></td></tr>)}<tr><td><b>Total</b></td><td className="num"><b><Money v={tg} /></b></td></tr></tbody></table></div>
        <div className="card"><h2>Advances and loans to recover</h2><table><tbody>{x.loans.map((r) => <tr key={r.code}><td>{r.code}</td><td className="num"><Money v={r.v} /></td></tr>)}<tr><td><b>Total</b></td><td className="num"><b><Money v={tl} /></b></td></tr></tbody></table></div>
      </div>
    </>
  );
}
