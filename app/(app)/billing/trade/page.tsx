import { requireCtx } from "@/lib/session";
import { listOrders, tradeSetup } from "@/lib/services/trade-sales";
import { can } from "@/lib/access";
import { createTradeOrderAction } from "@/app/actions-ops";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** SL-02: trade customers on credit: quotation, sales order, delivery notes, credit invoice. */
export default async function TradeOrders({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const b = ctx.currentBranchId;
  const show = sp.show === "all" ? "all" : "open";
  const canCreate = !!b && can(ctx, "invoices", "create", b);
  const [rows, setup] = await Promise.all([listOrders(ctx, show), canCreate ? tradeSetup(ctx) : Promise.resolve(null)]);
  return (
    <>
      <PageHead title="Trade orders" sub="Parts sold to garages and fleets on credit: a quotation, confirmed as a sales order, delivered on delivery notes, then invoiced on the customer's credit terms.">
        <Link className="btn ghost sm" href={show === "all" ? "/billing/trade" : "/billing/trade?show=all"}>{show === "all" ? "Open orders only" : "Show all"}</Link>
      </PageHead>
      <BillingTabs at="/billing/trade" />
      <Flash sp={sp} />
      {setup && (
        <details className="card" open={!rows.length}><summary><b>New trade quotation</b></summary>
          <form action={createTradeOrderAction} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <div className="field"><label htmlFor="customer_id">Customer</label>
              <select id="customer_id" name="customer_id" required defaultValue=""><option value="" disabled>Choose…</option>
                {setup.customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.customer_no}{Number(c.payment_terms_days) > 0 ? ` · ${c.payment_terms_days} days` : " · no credit terms"}</option>)}</select></div>
            <div className="field"><label htmlFor="customer_ref">Customer&apos;s LPO or reference</label><input id="customer_ref" name="customer_ref" /></div>
            <div className="field"><label htmlFor="valid_until">Valid until</label><input id="valid_until" type="date" name="valid_until" /></div>
            <div className="shrink"><button className="btn">Create quotation</button></div>
          </form>
          <p className="small muted">Only business customers and customers with credit terms are listed. Walk-in sales go through Counter sale.</p>
        </details>
      )}
      <div className="card">
        <table>
          <thead><tr><th>No.</th><th>Customer</th><th>Status</th><th>LPO</th><th className="num">Total</th><th className="num">To deliver</th><th className="num">To invoice</th><th>Created</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link href={`/billing/trade/${r.id}`}>{r.doc_no}</Link></td><td>{r.customer_name}</td><td><Status s={r.status === "quote" ? "quotation" : r.status} /></td>
              <td className="small">{r.customer_ref}</td><td className="num">{r.grand_total != null ? <Money v={r.grand_total} /> : "—"}</td>
              <td className="num">{Number(r.to_deliver) || ""}</td><td className="num">{Number(r.to_invoice) || ""}</td><td className="small muted">{day(r.created_at)}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="muted">No trade orders {show === "all" ? "yet" : "open"}.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
