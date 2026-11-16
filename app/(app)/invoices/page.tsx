import { requireCtx } from "@/lib/session";
import { listInvoices } from "@/lib/services/billing";
import { Link, Money, PageHead, d } from "@/components/ui";
import { canAnywhere } from "@/lib/access";
import { forbidden } from "@/lib/errors";

export default async function Invoices() {
  const ctx = await requireCtx();
  if (!canAnywhere(ctx, "invoices", "view")) throw forbidden();
  const rows = await listInvoices(ctx);
  return (
    <>
      <PageHead title="Tax invoices" sub="Posted invoices in your branches. Posted invoices are never edited or deleted (IV-05)." />
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Branch</th><th>Bill to</th><th className="num">Total</th><th className="num">Open</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={`/invoices/${r.id}`}>{r.doc_no}</Link></td><td>{d(r.doc_date)}</td><td>{r.branch_code}</td><td>{r.bill_to_name}</td><td className="num"><Money v={r.grand_total} /></td><td className="num"><Money v={r.open_amount} /></td></tr>)}</tbody>
        </table>
        {!rows.length && <p className="muted">No invoices yet.</p>}
      </div>
    </>
  );
}
