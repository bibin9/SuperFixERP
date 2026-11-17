import { requireCtx } from "@/lib/session";
import { listVouchers, VOUCHER_TYPES } from "@/lib/services/accounting";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";

export default async function Vouchers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listVouchers(ctx);
  return (
    <>
      <PageHead title="Vouchers" sub="Manual journal, payment, receipt, contra, debit and credit note vouchers. Each goes to the owner for approval and gets its number when posted.">
        {canAnywhere(ctx, "accounting", "create") && <Link className="btn" href="/accounts/vouchers/new">New voucher</Link>}
      </PageHead>
      <AccountsTabs group="books" at="/accounts/vouchers" />
      <Flash sp={sp} />
      <div className="card">
        <table>
          <thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Branch</th><th>Narration</th><th>By</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>{rows.map((v) => (
            <tr key={v.id}><td><Link href={`/accounts/vouchers/${v.id}`}>{v.doc_no ?? "Not numbered yet"}</Link></td><td>{VOUCHER_TYPES[v.voucher_type]}</td><td>{d(String(v.voucher_date).slice(0, 10))}</td><td>{v.branch_code}</td>
              <td className="small">{v.narration}</td><td className="small">{v.created_by_name}</td><td className="num"><Money v={v.total} /></td><td><Status s={v.status} /></td></tr>))}
            {!rows.length && <tr><td colSpan={8} className="muted">No vouchers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
