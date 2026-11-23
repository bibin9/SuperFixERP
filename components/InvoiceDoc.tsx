import QRCode from "qrcode";
import { Money, d } from "@/components/ui";
import { amountInWords } from "@/lib/services/billing-more";
import { invoicePrintSetup } from "@/lib/services/print";
import { Bi, BiText, PrintHead, PrintPage, PrintSign, PrintTerms } from "@/components/PrintDoc";
import { D } from "@/lib/money";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** The printable invoice (IV-02, OT-08): used by the staff page and the customer's share link. */
export async function InvoiceDoc({ i, lines, link }: { i: Row; lines: Row[]; link: string }) {
  const simplified = i.invoice_kind === "simplified";
  const { setup: s, names } = await invoicePrintSetup(i.branch_id, lines);
  const L = s.lang;
  const qr = await QRCode.toDataURL(
    [`Seller: ${i.legal_name_en}`, `TRN: ${i.company_trn}`, `Invoice: ${i.doc_no}`, `Date: ${i.doc_date instanceof Date ? i.doc_date.toISOString().slice(0, 10) : i.doc_date}`,
      `Total AED: ${i.grand_total}`, `VAT AED: ${i.vat_total}`, link].join("\n"), { margin: 1, width: 132 });
  return (
    <PrintPage lang={L} className="invoice-doc">
      <PrintHead s={s} title={simplified ? "simplifiedTaxInvoice" : "taxInvoice"} meta={<>
        <div><b>{i.doc_no}</b></div>
        <div className="small"><Bi k="date" lang={L} inline /> {day(i.doc_date)}{i.due_date && <> · <Bi k="due" lang={L} inline /> {day(i.due_date)}</>}</div>
      </>} />
      <div className="printgrid">
        <div><span className="k"><Bi k="billTo" lang={L} /></span><span>{i.bill_to_name}{i.customer_trn && <> · <Bi k="trn" lang={L} inline /> {i.customer_trn}</>}
          {i.bill_to_address && <div className="small">{i.bill_to_address}</div>}
          {i.mobile && !i.is_walk_in && <div className="small">{i.mobile}</div>}</span></div>
        <div><span className="k"><Bi k={i.job_no ? "jobNo" : "counterSale"} lang={L} /></span><span>{i.job_no ? <>{i.job_no} · {i.registered_in} {i.plate_code} {i.plate_number} · {i.make} {i.model}</> : ""}
          {i.lpo_no && <div className="small"><Bi k="lpo" lang={L} inline /> {i.lpo_no}</div>}</span></div>
      </div>
      <table style={{ marginTop: 12 }}>
        <thead><tr><th><Bi k="lineNo" lang={L} /></th><th><Bi k="description" lang={L} /></th><th className="num"><Bi k="qty" lang={L} /></th><th className="num"><Bi k="unitPrice" lang={L} /></th><th className="num"><Bi k="discount" lang={L} /></th><th className="num"><Bi k="taxable" lang={L} /></th><th className="num"><Bi k="vatPct" lang={L} /></th><th className="num"><Bi k="vat" lang={L} /></th><th className="num"><Bi k="total" lang={L} /></th></tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.id}><td>{l.line_no}</td><td><BiText en={l.description} ar={names[l.job_line_id] ?? names[l.item_id]} lang={L} /></td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.unit_price} /></td><td className="num"><Money v={l.discount_amount} /></td>
            <td className="num"><Money v={l.taxable_amount} /></td><td className="num">{D(l.vat_rate).mul(100).toFixed(0)}%</td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td></tr>
        ))}</tbody>
        <tfoot>
          <tr><td colSpan={5}><Bi k="totals" lang={L} inline /></td><td className="num"><Money v={i.taxable_total} /></td><td></td><td className="num"><Money v={i.vat_total} /></td><td className="num"><Money v={i.grand_total} /></td></tr>
        </tfoot>
      </table>
      <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
        <div>
          {L !== "ar" && <div className="small"><b><Bi k="amountInWords" lang={L} inline />:</b> {amountInWords(i.grand_total)}</div>}
          <div className="small"><Bi k="paid" lang={L} inline /> <Money v={i.paid_amount} />{Number(i.credited_amount) > 0 && <> · credited <Money v={i.credited_amount} /></>} · <Bi k="open" lang={L} inline /> <Money v={i.open_amount} /></div>
          {i.notes && <div className="small">{i.notes}</div>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Invoice QR code" width={132} height={132} className="shrink" />
      </div>
      <PrintTerms s={s} />
      <PrintSign lang={L} left="receivedBy" />
    </PrintPage>
  );
}
