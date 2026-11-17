import { requireCtx } from "@/lib/session";
import { listRuns, isPayroll } from "@/lib/services/payroll";
import { today } from "@/lib/services/hr";
import { calculateRunAction } from "@/app/actions-hr";
import { Flash, Link, Money, PageHead, Status, dt } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Payroll({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const runs = await listRuns(ctx);
  const t = today();
  const last = (() => { const x = new Date(`${t.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() - 1); return x.toISOString().slice(0, 7); })();
  return (
    <>
      <PageHead title="Payroll" sub="Calculate, check, owner approves, post to the accounts, WPS salary file, paid. An approved month is locked." />
      <HrTabs group="payroll" at="/payroll" />
      <Flash sp={sp} />
      {isPayroll(ctx) && (
        <form className="card row" style={{ alignItems: "end" }} action={calculateRunAction}>
          <div className="field"><label htmlFor="pm">Month</label><input id="pm" type="month" name="month" defaultValue={runs.some((r) => r.month === last) ? t.slice(0, 7) : last} max={t.slice(0, 7)} required /></div>
          <button className="btn shrink">Calculate</button>
          <p className="small muted" style={{ flexBasis: "100%" }}>Uses each employee&apos;s salary, approved leave, approved overtime, loan instalments and disciplinary deductions. You can recalculate until it is sent for approval.</p>
        </form>
      )}
      <div className="card">
        <table><thead><tr><th>Month</th><th>Employees</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th><th>Calculated</th></tr></thead>
          <tbody>{runs.map((r) => <tr key={r.id}><td><Link href={`/payroll/${r.month}`}>{r.month}</Link></td><td className="num">{r.employees}</td><td className="num"><Money v={r.gross} /></td><td className="num"><Money v={r.deductions} /></td><td className="num"><b><Money v={r.net} /></b></td><td><Status s={r.status} /></td><td className="small">{dt(r.calculated_at)}</td></tr>)}</tbody></table>
        {!runs.length && <p className="muted small">No payroll yet.</p>}
      </div>
    </>
  );
}
