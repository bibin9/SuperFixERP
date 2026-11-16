import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { getInvoice } from "@/lib/services/billing";
import { can } from "@/lib/access";
import { receiptAction } from "@/app/actions";
import { Flash, Link, Money, d } from "@/components/ui";
import { D } from "@/lib/money";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { invoice: i, lines, receipts } = await getInvoice(ctx, id);
  const open = D(i.grand_total).minus(i.paid_amount);
  return (
    <>
      <Flash sp={sp} />
      <div className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sflogo.png" alt="Superfix" style={{ height: 46 }} />
            <div><b>{i.legal_name_en}</b> · <span dir="rtl">{i.legal_name_ar}</span></div>
            <div className="small">{i.branch_name} branch, {i.emirate} · TRN {i.company_trn}</div>
          </div>
          <div className="right">
            <h1>Tax Invoice</h1><div className="small">فاتورة ضريبية</div>
            <div><b>{i.doc_no}</b></div><div className="small">Date {d(i.doc_date)} · due {d(i.due_date)}</div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div><b>Bill to:</b> {i.bill_to_name}{i.customer_trn && <> · TRN {i.customer_trn}</>}<div className="small">{i.mobile}</div></div>
          <div className="right small">Job {i.job_no} · {i.registered_in} {i.plate_code} {i.plate_number} · {i.make} {i.model}{i.lpo_no && <> · LPO {i.lpo_no}</>}</div>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Taxable</th><th className="num">VAT %</th><th className="num">VAT</th><th className="num">Total AED</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.unit_price} /></td><td className="num"><Money v={l.discount_amount} /></td>
              <td className="num"><Money v={l.taxable_amount} /></td><td className="num">{D(l.vat_rate).mul(100).toFixed(0)}%</td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td></tr>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={5}>Totals (AED)</td><td className="num"><Money v={i.taxable_total} /></td><td></td><td className="num"><Money v={i.vat_total} /></td><td className="num"><Money v={i.grand_total} /></td></tr>
          </tfoot>
        </table>
        <p className="small muted">Paid <Money v={i.paid_amount} /> · open <Money v={open.toFixed(2)} />. QR code and Arabic layout are on the list for the print templates.</p>
      </div>
      <div className="card no-print">
        <h2>Payments</h2>
        <table><tbody>{receipts.map((r) => <tr key={r.doc_no}><td>{r.doc_no}</td><td>{r.method}</td><td>{d(r.doc_date)}</td><td className="num"><Money v={r.amount} /></td></tr>)}</tbody></table>
        {can(ctx, "invoices", "create", i.branch_id) && open.gt(0) && (
          <form action={receiptAction} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="invoice_id" value={id} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
            <div className="field"><label>Method</label><select name="method"><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></div>
            <div className="field"><label>Amount (AED)</label><input name="amount" defaultValue={open.toFixed(2)} /></div>
            <div className="field"><label>Reference</label><input name="reference" placeholder="Card slip, transfer ref, cheque no." /></div>
            <div className="shrink"><button className="btn green">Record payment</button></div>
          </form>
        )}
        <p><Link href={`/jobs/${i.job_card_id}`}>Back to job</Link></p>
      </div>
    </>
  );
}
