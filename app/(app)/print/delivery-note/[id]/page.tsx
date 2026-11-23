import { requireCtx } from "@/lib/session";
import { deliveryNotePrint } from "@/lib/services/trade-sales";
import { Bi, BiText, PrintHead, PrintPage, PrintSign, PrintTerms } from "@/components/PrintDoc";
import { PrintButton } from "@/components/PrintButton";
import { d } from "@/components/ui";
import { D } from "@/lib/money";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** SL-02: the delivery note the customer signs when trade goods leave the store. No prices. */
export default async function DeliveryNotePrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { d: n, lines, setup: s } = await deliveryNotePrint(ctx, id);
  const L = s.lang;
  return (
    <>
      <div className="no-print row" style={{ marginBottom: 10 }}><PrintButton label="Print or save as PDF" /></div>
      <PrintPage lang={L}>
        <PrintHead s={s} title="deliveryNote" meta={<>
          <div><b>{n.doc_no}</b></div>
          <div className="small"><Bi k="date" lang={L} inline /> {day(n.delivered_at)}</div>
        </>} />
        <div className="printgrid">
          <div><span className="k"><Bi k="deliverTo" lang={L} /></span><span>{n.customer_name}{n.customer_name_ar && L !== "en" && <div dir="rtl" lang="ar">{n.customer_name_ar}</div>}{n.address && <div className="small">{n.address}</div>}{n.customer_trn && <div className="small"><Bi k="trn" lang={L} inline /> {n.customer_trn}</div>}</span></div>
          <div><span className="k"><Bi k="mobile" lang={L} /></span><span>{n.mobile}</span></div>
          <div><span className="k"><Bi k="salesOrder" lang={L} /></span><span>{n.order_no}</span></div>
          {n.customer_ref && <div><span className="k"><Bi k="lpo" lang={L} /></span><span>{n.customer_ref}</span></div>}
          {n.vehicle_ref && <div><span className="k"><Bi k="vehicleRef" lang={L} /></span><span>{n.vehicle_ref}</span></div>}
        </div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th><Bi k="lineNo" lang={L} /></th><th><Bi k="part" lang={L} /></th><th><Bi k="description" lang={L} /></th><th className="num"><Bi k="qty" lang={L} /></th></tr></thead>
          <tbody>{lines.map((l, k) => <tr key={k}><td>{k + 1}</td><td>{l.part_no}</td><td><BiText en={l.description} ar={l.name_ar} lang={L} /></td><td className="num">{D(l.qty).toString()}</td></tr>)}</tbody>
        </table>
        <p className="small" style={{ marginTop: 14 }}><Bi k="goodsReceived" lang={L} inline />{n.received_by_name ? `: ${n.received_by_name}` : ""}</p>
        <PrintTerms s={s} />
        <PrintSign lang={L} left="receivedBy" right="forCompany" />
      </PrintPage>
    </>
  );
}
