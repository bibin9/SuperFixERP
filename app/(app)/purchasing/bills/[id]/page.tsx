import { requireCtx } from "@/lib/session";
import { getBill } from "@/lib/services/purchasing";
import { Flash, Money, PageHead, Status, d, label } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { D } from "@/lib/money";

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { bill, lines } = await getBill(ctx, id);
  const cost = "grand_total" in bill;
  return (
    <>
      <PageHead title={`Supplier bill ${bill.doc_no}`} sub={`${bill.supplier_name} · invoice ${bill.supplier_invoice_no} of ${d(new Date(bill.invoice_date).toISOString().slice(0, 10))}`}>
        <Status s={bill.match_status} /><Status s={bill.status} /></PageHead>
      <PurchTabs at="/purchasing/bills" />
      <Flash sp={sp} />
      {bill.status === "pending_approval" && <div className="flash warn">Does not match the order or receipt. Waiting for the accountant; nothing is posted yet.</div>}
      <div className="card">
        <table>
          <thead><tr><th>Line</th><th className="num">Qty</th>{cost && <th className="num">Unit price</th>}{cost && <th className="num">Net</th>}{cost && <th className="num">Received value</th>}{cost && <th className="num">VAT</th>}<th>Match</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.description}{l.expense_type && <div className="small muted">{label(l.expense_type)}</div>}</td><td className="num">{D(l.qty).toString()}</td>
              {cost && <td className="num"><Money v={l.unit_price} /></td>}{cost && <td className="num"><Money v={l.net_amount} /></td>}
              {cost && <td className="num">{l.received_value ? <Money v={l.received_value} /> : "—"}</td>}{cost && <td className="num"><Money v={l.vat_amount} /></td>}
              <td className="small">{l.match_note ? <span className="pill amber">{l.match_note}</span> : l.grn_line_id ? <span className="pill green">Matched</span> : "No order"}</td></tr>
          ))}</tbody>
          {cost && <tfoot><tr><td colSpan={3}>Total</td><td className="num"><Money v={bill.net_total} /></td><td></td><td className="num"><Money v={bill.vat_total} /></td><td className="num"><Money v={bill.grand_total} /></td></tr></tfoot>}
        </table>
      </div>
    </>
  );
}
