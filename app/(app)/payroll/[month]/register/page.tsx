import { requireCtx } from "@/lib/session";
import { register } from "@/lib/services/payroll";
import { Link, PageHead } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

const f = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function Register({ params }: { params: Promise<{ month: string }> }) {
  const ctx = await requireCtx();
  const { month } = await params;
  const r = await register(ctx, month);
  const names = Object.fromEntries(r.comps.map((x) => [x.code, x.name_en]));
  const col = (k: string) => names[k] ?? (k === "overtime" ? "Overtime" : k === "loans" ? "Loan recovery" : "Disciplinary");
  return (
    <>
      <div className="no-print"><PageHead title={`Payroll register ${month}`} sub="One column per salary component, with branch totals">
        <a className="btn ghost sm" href={`/api/payroll/register/${month}`}>Download CSV</a><PrintButton /><Link className="btn ghost sm" href={`/payroll/${month}`}>Payroll {month}</Link></PageHead></div>
      {r.groups.map((g) => (
        <div className="card" key={g.branch}><h2>{g.branch}</h2>
          <table><thead><tr><th>Employee</th><th>Days</th>{r.cols.map((k) => <th key={k} className="num">{col(k)}</th>)}<th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th></tr></thead>
            <tbody>{g.rows.map((x) => <tr key={x.id}><td>{x.emp_no} {x.full_name}</td><td className="num">{Number(x.paid_days)}</td>{r.cols.map((k) => <td key={k} className="num">{f(x.cells[k])}</td>)}<td className="num">{f(Number(x.gross))}</td><td className="num">{f(Number(x.total_deductions))}</td><td className="num"><b>{f(Number(x.net))}</b></td></tr>)}
              <tr><td><b>{g.branch} total</b></td><td></td>{r.cols.map((k) => <td key={k} className="num"><b>{f(g.total[k])}</b></td>)}<td className="num"><b>{f(g.total.gross)}</b></td><td className="num"><b>{f(g.total.total_deductions)}</b></td><td className="num"><b>{f(g.total.net)}</b></td></tr></tbody></table>
        </div>
      ))}
      {!r.groups.length && <div className="card"><p className="muted">Not calculated yet.</p></div>}
    </>
  );
}
