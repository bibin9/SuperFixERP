import { RecordHistory } from "@/components/RecordHistory";
import { docHistory } from "@/lib/services/history";
import { requireCtx } from "@/lib/session";
import { getCreditNote, amountInWords } from "@/lib/services/billing-more";
import { Flash, Link, Money, Status, d, label } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { D } from "@/lib/money";

export default async function CreditNotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { cn, lines } = await getCreditNote(ctx, id);
  return (
    <>
      <Flash sp={sp} />
      <div className="row no-print" style={{ marginBottom: 10 }}>
        {cn.status === "posted" && <PrintButton label="Print or save as PDF" />}
        <Link className="btn ghost shrink" href={`/invoices/${cn.invoice_id}`}>Back to invoice</Link>
        {cn.status === "pending_approval" && <Link className="btn ghost shrink" href="/approvals">Approvals</Link>}
      </div>
      <div className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sflogo.png" alt="Superfix" width={86} height={46} />
            <div><b>{cn.legal_name_en}</b></div><div className="small">{cn.branch_name} branch · TRN {cn.company_trn}</div>
          </div>
          <div className="right">
            <h1 style={{ margin: 0 }}>Tax Credit Note</h1><div className="small" dir="rtl">إشعار دائن ضريبي</div>
            <div><b>{cn.doc_no ?? "Not numbered until approved"}</b> <Status s={cn.status} /></div>
            <div className="small">{cn.doc_date ? `Date ${d(cn.doc_date)} · ` : ""}against invoice {cn.invoice_no} of {d(cn.invoice_date)}</div>
          </div>
        </div>
        <p><b>Customer:</b> {cn.bill_to_name}{cn.customer_trn && <> · TRN {cn.customer_trn}</>} · <b>Reason:</b> {cn.reason_name}{cn.note && <> · {cn.note}</>}</p>
        <table>
          <thead><tr><th>Invoice line</th><th className="num">Qty</th><th className="num">Taxable</th><th className="num">VAT %</th><th className="num">VAT</th><th className="num">Total AED</th><th>Goods</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.line_no}. {l.description}</td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.taxable_amount} /></td>
            <td className="num">{D(l.vat_rate).mul(100).toFixed(0)}%</td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td><td className="small">{l.stock_action === "none" ? "" : label(l.stock_action)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>Totals (AED)</td><td className="num"><Money v={cn.taxable_total} /></td><td></td><td className="num"><Money v={cn.vat_total} /></td><td className="num"><Money v={cn.grand_total} /></td><td></td></tr></tfoot>
        </table>
        <p className="small"><b>Amount in words:</b> {amountInWords(cn.grand_total)}</p>
        <p className="small muted">Made by {cn.created_by_name}.</p>
      </div>
      <RecordHistory rows={await docHistory(ctx, "credit_note", id)} />
    </>
  );
}
