import { requireCtx } from "@/lib/session";
import { receiptPrint } from "@/lib/services/print";
import { displayName } from "@/lib/services/customers";
import { amountInWords } from "@/lib/services/billing-more";
import { Bi, PrintHead, PrintPage, PrintSign, PrintTerms } from "@/components/PrintDoc";
import { PrintButton } from "@/components/PrintButton";
import { Money, d } from "@/components/ui";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** OT-08: the receipt voucher for a customer payment, in English, Arabic or both. */
export default async function ReceiptPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { r, allocations, setup: s } = await receiptPrint(ctx, id);
  const L = s.lang;
  return (
    <>
      <div className="no-print row" style={{ marginBottom: 10 }}><PrintButton label="Print or save as PDF" /></div>
      <PrintPage lang={L}>
        <PrintHead s={s} title={r.kind === "advance" ? "advanceReceipt" : "receipt"} meta={<>
          <div><b>{r.doc_no}</b></div>
          <div className="small"><Bi k="date" lang={L} inline /> {day(r.doc_date)}</div>
        </>} />
        <div className="printgrid">
          <div><span className="k"><Bi k="receivedFrom" lang={L} /></span><span>{displayName(r)}{r.customer_name_ar && L !== "en" && <div dir="rtl" lang="ar">{r.customer_name_ar}</div>}{r.customer_trn && <div className="small"><Bi k="trn" lang={L} inline /> {r.customer_trn}</div>}</span></div>
          <div><span className="k"><Bi k="mobile" lang={L} /></span><span>{r.mobile}</span></div>
          <div><span className="k"><Bi k="method" lang={L} /></span><span>{r.method_name ?? r.method}{r.cheque_no && <> · <Bi k="cheque" lang={L} inline /> {r.cheque_no}{r.cheque_bank ? `, ${r.cheque_bank}` : ""}{r.cheque_date ? `, ${day(r.cheque_date)}` : ""}</>}</span></div>
          {r.reference && <div><span className="k"><Bi k="reference" lang={L} /></span><span>{r.reference}</span></div>}
          {r.job_no && <div><span className="k"><Bi k="jobNo" lang={L} /></span><span>{r.job_no}</span></div>}
        </div>
        <p style={{ fontSize: 20, marginTop: 14 }}><Bi k="amount" lang={L} inline />: <b><Money v={r.amount} /></b></p>
        {L !== "ar" && <p className="small"><b><Bi k="amountInWords" lang={L} inline />:</b> {amountInWords(r.amount)}</p>}
        {Number(r.vat_amount) > 0 && <p className="small"><Bi k="vat" lang={L} inline />: <Money v={r.vat_amount} /></p>}
        {allocations.length > 0 && <table style={{ marginTop: 8 }}>
          <thead><tr><th><Bi k="against" lang={L} /></th><th className="num"><Bi k="amount" lang={L} /></th></tr></thead>
          <tbody>{allocations.map((a, k) => <tr key={k}><td><Bi k="invoice" lang={L} inline /> {a.doc_no}{a.reversed ? " (reversed)" : ""}</td><td className="num"><Money v={a.amount} /></td></tr>)}</tbody>
        </table>}
        <PrintTerms s={s} />
        <PrintSign lang={L} left="receivedBy" right="forCompany" />
      </PrintPage>
    </>
  );
}
