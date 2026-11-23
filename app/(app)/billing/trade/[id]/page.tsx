import { requireCtx } from "@/lib/session";
import { getOrder } from "@/lib/services/trade-sales";
import { docHistory } from "@/lib/services/history";
import { tradeStepAction } from "@/app/actions-ops";
import { Flash, Link, Money, PageHead, Status, d, dt } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { RecordHistory } from "@/components/RecordHistory";
import { ScanBox } from "@/components/ScanBox";
import { D } from "@/lib/money";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

export default async function TradeOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const g = await getOrder(ctx, id);
  const { o, lines } = g;
  const quote = o.status === "quote";
  const deliverable = ["confirmed", "partly_delivered"].includes(o.status) && g.canDeliver;
  const toInvoice = lines.some((l) => D(l.delivered_qty).gt(l.invoiced_qty));
  const hidden = <><input type="hidden" name="id" value={id} /></>;
  return (
    <>
      <PageHead title={`${quote ? "Trade quotation" : "Sales order"} ${o.doc_no}`} sub={`${o.customer_name} · ${o.customer_no} · price level ${o.price_level} · ${Number(o.payment_terms_days) > 0 ? `${o.payment_terms_days} days credit` : "no credit terms"}`}>
        <Link className="btn ghost sm" href="/billing/trade">All trade orders</Link>
      </PageHead>
      <BillingTabs at="/billing/trade" />
      <Flash sp={sp} />
      <div className="card">
        <div className="row" style={{ gap: 24 }}>
          <div><span className="muted small">Status</span><div><Status s={quote ? "quotation" : o.status} /></div></div>
          <div><span className="muted small">Customer&apos;s LPO</span><div>{o.customer_ref || "—"}</div></div>
          {quote && <div><span className="muted small">Valid until</span><div>{day(o.valid_until)}</div></div>}
          {g.showPrices && <div><span className="muted small">Total incl. VAT</span><div><b><Money v={o.grand_total} /></b></div></div>}
          {g.showPrices && Number(o.credit_limit) > 0 && <div><span className="muted small">Credit limit</span><div><Money v={o.credit_limit} /></div></div>}
          <div><span className="muted small">Created by</span><div>{o.created_by_name} · {dt(o.created_at)}</div></div>
        </div>
        {o.notes && <p className="small" style={{ marginTop: 8 }}>{o.notes}</p>}
      </div>

      <div className="card">
        <h2>Parts</h2>
        <table>
          <thead><tr><th>#</th><th>Part</th><th className="num">Qty</th>{g.showPrices && <th className="num">Unit price</th>}{g.showPrices && <th className="num">Discount</th>}{g.showPrices && <th className="num">Total incl. VAT</th>}<th className="num">Free here</th><th className="num">Delivered</th><th className="num">Invoiced</th>{quote && g.canEdit && <th><span className="vh">Remove</span></th>}</tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td>
              {g.showPrices && <td className="num"><Money v={l.unit_price} /></td>}{g.showPrices && <td className="num">{Number(l.discount_amount) ? <Money v={l.discount_amount} /> : ""}</td>}{g.showPrices && <td className="num"><Money v={l.line_total} /></td>}
              <td className="num">{D(l.free).lt(D(l.qty).minus(l.delivered_qty)) ? <span className="pill amber">{D(l.free).toString()}</span> : D(l.free).toString()}</td>
              <td className="num">{D(l.delivered_qty).toString()}</td><td className="num">{D(l.invoiced_qty).toString()}</td>
              {quote && g.canEdit && <td><form action={tradeStepAction}>{hidden}<input type="hidden" name="line_id" value={l.id} /><button className="btn ghost sm" name="step" value="remove">Remove</button></form></td>}</tr>
          ))}
          {!lines.length && <tr><td colSpan={10} className="muted">No parts yet.</td></tr>}</tbody>
        </table>
        {quote && g.canEdit && (
          <form action={tradeStepAction} className="row" data-scan-scope style={{ marginTop: 12, alignItems: "flex-end" }}>{hidden}
            <ScanBox />
            <div className="field" style={{ minWidth: 260 }}><label htmlFor="item_id">Part</label><select id="item_id" name="item_id" required>{g.items.map((i) => <option key={i.id} value={i.id} data-codes={i.codes}>{i.part_no} · {i.description}</option>)}</select></div>
            <div className="field" style={{ maxWidth: 110 }}><label htmlFor="qty">Qty</label><input id="qty" name="qty" defaultValue="1" inputMode="decimal" required /></div>
            <div className="field" style={{ maxWidth: 150 }}><label htmlFor="price">Unit price (blank = price list)</label><input id="price" name="price" inputMode="decimal" /></div>
            <div className="field" style={{ maxWidth: 130 }}><label htmlFor="discount">Discount AED</label><input id="discount" name="discount" inputMode="decimal" placeholder="0.00" /></div>
            <div className="shrink"><button className="btn" name="step" value="add">Add part</button></div>
          </form>
        )}
        {quote && g.canEdit && (
          <div className="row" style={{ marginTop: 14 }}>
            <form action={tradeStepAction} className="row shrink">{hidden}
              <div className="field"><label htmlFor="cref">Customer&apos;s LPO (when they confirm)</label><input id="cref" name="customer_ref" defaultValue={o.customer_ref ?? ""} /></div>
              <div className="shrink"><button className="btn green" name="step" value="confirm">Customer confirmed: make it a sales order</button></div></form>
            <form action={tradeStepAction} className="shrink">{hidden}<ConfirmButton name="step" value="cancel" className="btn ghost red-text" message="Cancel this quotation?">Cancel</ConfirmButton></form>
          </div>
        )}
        {o.status === "confirmed" && g.canEdit && <form action={tradeStepAction} style={{ marginTop: 10 }}>{hidden}<ConfirmButton name="step" value="cancel" className="btn ghost red-text sm" message="Cancel this sales order? Nothing has been delivered yet.">Cancel order</ConfirmButton></form>}
        {quote && <p className="small muted" style={{ marginTop: 8 }}>Confirming checks the customer&apos;s credit terms and limit. Over the limit, only the branch manager can confirm.</p>}
      </div>

      {deliverable && (
        <form action={tradeStepAction} className="card">{hidden}
          <h2>Deliver goods</h2>
          <table><thead><tr><th>Part</th><th className="num">Left to deliver</th><th>Going out now</th></tr></thead>
            <tbody>{lines.filter((l) => D(l.delivered_qty).lt(l.qty)).map((l) => (
              <tr key={l.id}><td>{l.description}</td><td className="num">{D(l.qty).minus(l.delivered_qty).toString()}</td>
                <td><input name={`dq[${l.id}]`} defaultValue={Decimal_min(D(l.qty).minus(l.delivered_qty), D(l.free))} inputMode="decimal" style={{ width: 90, minWidth: 70 }} aria-label={`Qty going out for line ${l.line_no}`} /></td></tr>
            ))}</tbody></table>
          <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <div className="field"><label htmlFor="rb">Received by</label><input id="rb" name="received_by_name" placeholder="Driver or customer's staff" /></div>
            <div className="field"><label htmlFor="vr">Vehicle or driver reference</label><input id="vr" name="vehicle_ref" /></div>
            <div className="shrink"><button className="btn green" name="step" value="deliver">Post delivery note</button></div>
          </div>
          <p className="small muted">Stock leaves the store now. Print the delivery note for the customer to sign.</p>
        </form>
      )}

      {(g.notes.length > 0 || g.invoices.length > 0) && (
        <div className="card">
          <h2>Delivery notes and invoices</h2>
          <table><thead><tr><th>Delivery note</th><th>When</th><th>By</th><th>Received by</th><th>Invoice</th><th><span className="vh">Print</span></th></tr></thead>
            <tbody>{g.notes.map((n) => (
              <tr key={n.id}><td>{n.doc_no}</td><td className="small">{dt(n.delivered_at)}</td><td className="small">{n.full_name}</td><td className="small">{n.received_by_name}</td>
                <td>{n.invoice_no ? n.invoice_no : <span className="pill amber">Not invoiced</span>}</td><td><Link className="btn ghost sm" href={`/print/delivery-note/${n.id}`}>Print</Link></td></tr>
            ))}</tbody></table>
          {g.invoices.length > 0 && <p className="small" style={{ marginTop: 8 }}>Invoices: {g.invoices.map((i) => <span key={i.id} style={{ marginRight: 12 }}><Link href={`/invoices/${i.id}`}>{i.doc_no}</Link> <Money v={i.grand_total} /> due {day(i.due_date)}</span>)}</p>}
          {toInvoice && g.canEdit && g.showPrices && (
            <form action={tradeStepAction} style={{ marginTop: 10 }}>{hidden}<ConfirmButton name="step" value="invoice" className="btn green" message="Post one tax invoice for everything delivered and not yet invoiced?">Invoice what was delivered</ConfirmButton></form>
          )}
        </div>
      )}
      <RecordHistory rows={await docHistory(ctx, "sales_order", id)} />
    </>
  );
}

function Decimal_min(a: ReturnType<typeof D>, b: ReturnType<typeof D>) {
  const m = a.lt(b) ? a : b;
  return m.gt(0) ? m.toString() : "0";
}
