import { requireCtx } from "@/lib/session";
import { quotationPrint } from "@/lib/services/print";
import { displayName } from "@/lib/services/customers";
import { Bi, BiText, PrintHead, PrintPage, PrintSign, PrintTerms } from "@/components/PrintDoc";
import { PrintButton } from "@/components/PrintButton";
import { Link, Money, d } from "@/components/ui";
import { D } from "@/lib/money";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** OT-08: the quotation as printed or saved as PDF, in English, Arabic or both. */
export default async function QuotationPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { q, lines, cust, veh, names, setup: s } = await quotationPrint(ctx, id);
  const L = s.lang;
  const back = q.job_card_id ? `/jobs/${q.job_card_id}` : `/enquiries/${q.enquiry_id}`;
  return (
    <>
      <div className="no-print row" style={{ marginBottom: 10 }}><PrintButton label="Print or save as PDF" /><Link className="btn ghost shrink" href={back}>Back</Link></div>
      <PrintPage lang={L}>
        <PrintHead s={s} title="quotation" meta={<>
          <div><b>{q.doc_no}{q.revision > 1 ? ` rev ${q.revision}` : ""}</b></div>
          <div className="small"><Bi k="date" lang={L} inline /> {day(q.doc_date)}{q.valid_until && <> · <Bi k="validUntil" lang={L} inline /> {day(q.valid_until)}</>}</div>
        </>} />
        <div className="printgrid">
          <div><span className="k"><Bi k="customer" lang={L} /></span><span>{displayName(cust)}{cust.name_ar && L !== "en" && <div dir="rtl" lang="ar">{cust.name_ar}</div>}{cust.trn && <div className="small"><Bi k="trn" lang={L} inline /> {cust.trn}</div>}</span></div>
          <div><span className="k"><Bi k="mobile" lang={L} /></span><span>{cust.mobile}</span></div>
          {veh && <div><span className="k"><Bi k="vehicle" lang={L} /></span><span>{veh.make} {veh.model} {veh.model_year ?? ""}</span></div>}
          {veh && <div><span className="k"><Bi k="plate" lang={L} /></span><span>{veh.registered_in} {veh.plate_code} {veh.plate_number}{veh.vin && <div className="small"><Bi k="vin" lang={L} inline /> {veh.vin}</div>}</span></div>}
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th><Bi k="lineNo" lang={L} /></th><th><Bi k="description" lang={L} /></th><th className="num"><Bi k="qty" lang={L} /></th><th className="num"><Bi k="unitPrice" lang={L} /></th><th className="num"><Bi k="discount" lang={L} /></th><th className="num"><Bi k="vat" lang={L} /></th><th className="num"><Bi k="total" lang={L} /></th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.line_no}</td><td><BiText en={l.description} ar={names[l.job_line_id]} lang={L} />{l.decision !== "pending" && <div className="small muted"><Bi k={l.decision === "approved" ? "approved" : "declined"} lang={L} inline /></div>}</td>
              <td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.unit_price} /></td><td className="num">{"line_discount" in l ? <Money v={D(l.line_discount ?? 0).plus(l.doc_discount_share ?? 0).toFixed(2)} /> : "—"}</td>
              <td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td></tr>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={5}><Bi k="taxable" lang={L} inline /></td><td></td><td className="num"><Money v={q.taxable_total} /></td></tr>
            <tr><td colSpan={5}><Bi k="vat" lang={L} inline /></td><td></td><td className="num"><Money v={q.vat_total} /></td></tr>
            <tr><td colSpan={5}><b><Bi k="grandTotal" lang={L} inline /></b></td><td></td><td className="num"><b><Money v={q.grand_total} /></b></td></tr>
          </tfoot>
        </table>
        {q.terms && <p className="small" style={{ marginTop: 8 }}>{q.terms}</p>}
        <PrintTerms s={s} />
        <PrintSign lang={L} />
      </PrintPage>
    </>
  );
}
