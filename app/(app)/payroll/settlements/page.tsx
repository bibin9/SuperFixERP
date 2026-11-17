import { requireCtx } from "@/lib/session";
import { listSettlements, isPayroll } from "@/lib/services/payroll";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Settlements({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listSettlements(ctx);
  return (
    <>
      <PageHead title="Final settlements" sub="End of service: gratuity, unused leave, salary to the last day, air ticket and notice, less loans">
        {isPayroll(ctx) && <Link className="btn sm" href="/payroll/settlements/new">New settlement</Link>}
      </PageHead>
      <HrTabs group="payroll" at="/payroll/settlements" />
      <Flash sp={sp} />
      <div className="card"><table><thead><tr><th>No.</th><th>Employee</th><th>Last day</th><th>Reason</th><th>Gratuity</th><th>Net</th><th>Status</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={`/payroll/settlements/${r.id}`}>{r.doc_no ?? "Draft"}</Link></td><td>{r.emp_no} {r.full_name} <span className="small muted">{r.branch_code}</span></td><td>{d(r.last_d)}</td><td>{String(r.reason).replace(/_/g, " ")}</td>
          <td className="num"><Money v={r.gratuity} /></td><td className="num"><b><Money v={r.net} /></b></td><td><Status s={r.status} /></td></tr>)}</tbody></table>
        {!rows.length && <p className="muted small">None yet.</p>}
      </div>
    </>
  );
}
