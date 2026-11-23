import { RecordHistory } from "@/components/RecordHistory";
import { docHistory } from "@/lib/services/history";
import { requireCtx } from "@/lib/session";
import { getCreditNote, amountInWords } from "@/lib/services/billing-more";
import { Flash, Link, Money, Status, d, label } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { D } from "@/lib/money";
import { invoicePrintSetup } from "@/lib/services/print";
import { Bi, BiText, PrintHead, PrintPage, PrintSign } from "@/components/PrintDoc";

export default async function CreditNotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { cn, lines } = await getCreditNote(ctx, id);
  const { setup: s, names } = await invoicePrintSetup(cn.branch_id, lines, "credit_note");
  const L = s.lang;
  return (
    <>
      <Flash sp={sp} />
      <div className="row no-print" style={{ marginBottom: 10 }}>
        {cn.status === "posted" && <PrintButton label="Print or save as PDF" />}
        <Link className="btn ghost shrink" href={`/invoices/${cn.invoice_id}`}>Back to invoice</Link>
        {cn.status === "pending_approval" && <Link className="btn ghost shrink" href="/approvals">Approvals</Link>}
      </div>
      <PrintPage lang={L}>
        <PrintHead s={s} title="creditNote" meta={<>
          <div><b>{cn.doc_no ?? "Not numbered until approved"}</b> <span className="no-print"><Status s={cn.status} /></span></div>
          <div className="small">{cn.doc_date && <><Bi k="date" lang={L} inline /> {d(cn.doc_date)}</>}</div>
          <div className="small"><Bi k="againstInvoice" lang={L} inline /> {cn.invoice_no} · {d(cn.invoice_date)}</div>
        </>} />
        <div className="printgrid">
          <div><span className="k"><Bi k="customer" lang={L} /></span><span>{cn.bill_to_name}{cn.customer_trn && <div className="small"><Bi k="trn" lang={L} inline /> {cn.customer_trn}</div>}</span></div>
          <div><span className="k"><Bi k="reason" lang={L} /></span><span><BiText en={cn.reason_name ?? cn.reason} ar={cn.reason_name_ar} lang={L} />{cn.note && <div className="small">{cn.note}</div>}</span></div>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th><Bi k="lineNo" lang={L} /></th><th><Bi k="description" lang={L} /></th><th className="num"><Bi k="qty" lang={L} /></th><th className="num"><Bi k="taxable" lang={L} /></th><th className="num"><Bi k="vatPct" lang={L} /></th><th className="num"><Bi k="vat" lang={L} /></th><th className="num"><Bi k="total" lang={L} /></th><th className="no-print">Goods</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.line_no}</td><td><BiText en={l.description} ar={names[l.job_line_id] ?? names[l.item_id]} lang={L} /></td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.taxable_amount} /></td>
            <td className="num">{D(l.vat_rate).mul(100).toFixed(0)}%</td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td><td className="small no-print">{l.stock_action === "none" ? "" : label(l.stock_action)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}><Bi k="totals" lang={L} inline /></td><td className="num"><Money v={cn.taxable_total} /></td><td></td><td className="num"><Money v={cn.vat_total} /></td><td className="num"><Money v={cn.grand_total} /></td><td className="no-print"></td></tr></tfoot>
        </table>
        {L !== "ar" && <p className="small"><b><Bi k="amountInWords" lang={L} inline />:</b> {amountInWords(cn.grand_total)}</p>}
        <p className="small muted no-print">Made by {cn.created_by_name}.</p>
        <PrintSign lang={L} left="receivedBy" />
      </PrintPage>
      <RecordHistory rows={await docHistory(ctx, "credit_note", id)} />
    </>
  );
}
