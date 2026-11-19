import { OlderRows } from "@/components/OlderRows";
import { offsetOf } from "@/lib/paging";
import { requireCtx } from "@/lib/session";
import { listCreditNotes } from "@/lib/services/billing-more";
import { Link, Money, PageHead, Status, dt } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";

export default async function CreditNotes({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const rows = await listCreditNotes(ctx, offsetOf(sp));
  return (
    <>
      <PageHead title="Credit notes" sub="Made from an invoice (open the invoice and choose Credit note). Each one needs the branch manager's approval." />
      <BillingTabs at="/billing/credit-notes" />
      <div className="card">
        <table>
          <thead><tr><th>Credit note</th><th>Invoice</th><th>Branch</th><th>Customer</th><th>Reason</th><th className="num">Total</th><th>Status</th><th>Made</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={`/billing/credit-notes/${r.id}`}>{r.doc_no ?? "Not numbered yet"}</Link></td><td><Link href={`/invoices/${r.invoice_id}`}>{r.invoice_no}</Link></td>
            <td>{r.branch_code}</td><td>{r.bill_to_name}</td><td>{r.reason_name}</td><td className="num"><Money v={r.grand_total} /></td><td><Status s={r.status} /></td><td className="small">{dt(r.created_at)}</td></tr>)}</tbody>
        </table>
        {!rows.length && <p className="muted">No credit notes yet.</p>}
      </div>
      <OlderRows rows={rows} base="/billing/credit-notes" sp={sp} />
    </>
  );
}
