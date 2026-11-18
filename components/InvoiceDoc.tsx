import QRCode from "qrcode";
import { Money, d } from "@/components/ui";
import { amountInWords } from "@/lib/services/billing-more";
import { D } from "@/lib/money";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The printable invoice (IV-02): used by the staff page and the customer's share link. */
export async function InvoiceDoc({ i, lines, link }: { i: Row; lines: Row[]; link: string }) {
  const simplified = i.invoice_kind === "simplified";
  const qr = await QRCode.toDataURL(
    [`Seller: ${i.legal_name_en}`, `TRN: ${i.company_trn}`, `Invoice: ${i.doc_no}`, `Date: ${i.doc_date instanceof Date ? i.doc_date.toISOString().slice(0, 10) : i.doc_date}`,
      `Total AED: ${i.grand_total}`, `VAT AED: ${i.vat_total}`, link].join("\n"), { margin: 1, width: 132 });
  return (
    <div className="card invoice-doc">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sflogo.png" alt="Superfix" width={86} height={46} />
          <div><b>{i.legal_name_en}</b> · <span dir="rtl">{i.legal_name_ar}</span></div>
          <div className="small">{i.branch_name} branch{i.branch_address ? `, ${i.branch_address}` : ""}, {i.emirate}</div>
          <div className="small">TRN {i.company_trn}</div>
        </div>
        <div className="right">
          <h1 style={{ margin: 0 }}>{simplified ? "Simplified Tax Invoice" : "Tax Invoice"}</h1>
          <div className="small" dir="rtl">{simplified ? "فاتورة ضريبية مبسطة" : "فاتورة ضريبية"}</div>
          <div><b>{i.doc_no}</b></div>
          <div className="small">Date {d(typeof i.doc_date === "string" ? i.doc_date : i.doc_date?.toISOString?.().slice(0, 10))}{i.due_date && <> · due {d(typeof i.due_date === "string" ? i.due_date : i.due_date?.toISOString?.().slice(0, 10))}</>}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
        <div><b>Bill to:</b> {i.bill_to_name}{i.customer_trn && <> · TRN {i.customer_trn}</>}
          {i.bill_to_address && <div className="small">{i.bill_to_address}</div>}
          {i.mobile && !i.is_walk_in && <div className="small">{i.mobile}</div>}</div>
        <div className="right small">
          {i.job_no ? <>Job {i.job_no} · {i.registered_in} {i.plate_code} {i.plate_number} · {i.make} {i.model}</> : "Counter sale"}
          {i.lpo_no && <div>LPO {i.lpo_no}</div>}
        </div>
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
      <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
        <div>
          <div className="small"><b>Amount in words:</b> {amountInWords(i.grand_total)}</div>
          <div className="small">Paid <Money v={i.paid_amount} />{Number(i.credited_amount) > 0 && <> · credited <Money v={i.credited_amount} /></>} · open <Money v={i.open_amount} /></div>
          {i.notes && <div className="small">{i.notes}</div>}
          <div className="small muted" style={{ marginTop: 6 }}>Goods once fitted are covered by the maker&apos;s warranty only. Please check your vehicle before leaving the branch.</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Invoice QR code" width={132} height={132} className="shrink" />
      </div>
    </div>
  );
}
