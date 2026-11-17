import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { counterSaleSetup } from "@/lib/services/billing-more";
import { listCustomers } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { counterSaleAction } from "@/app/actions-billing";
import { Flash, Link, PageHead, custName } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { CounterLines } from "@/components/CounterLines";
import { D } from "@/lib/money";

export default async function CounterSale({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const customerId = /^[0-9a-f-]{36}$/.test(sp.customer ?? "") ? sp.customer : null;
  const s = await counterSaleSetup(ctx, customerId);
  const found = sp.q && sp.q.trim().length >= 2 ? (await listCustomers(ctx, sp.q)).filter((c) => !c.is_walk_in).slice(0, 8) : [];
  const m = await masters(ctx);
  const items = s.items.map((i) => ({ id: i.id, part_no: i.part_no, description: i.description, free: String(i.free),
    gross: (s.inclusive ? D(i.net).mul(D(1).plus(i.rate)) : D(i.net)).toFixed(2) }));
  return (
    <>
      <PageHead title="Counter sale" sub="Parts sold over the counter from this branch's free stock. Prices include VAT; the invoice posts at once." />
      <BillingTabs at="/billing/counter-sale" />
      <Flash sp={sp} />
      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div><b>Customer:</b> {s.billTo} {s.customer.trn && <span className="small">· TRN {s.customer.trn}</span>} <span className="small muted">· price level {s.customer.price_level}{Number(s.customer.payment_terms_days) > 0 ? ` · ${s.customer.payment_terms_days} days credit` : " · pays now"}</span>
            {customerId && <> · <Link href="/billing/counter-sale">Walk-in instead</Link></>}</div>
          <form className="row shrink"><input name="q" defaultValue={sp.q ?? ""} placeholder="Find a customer by mobile or name" aria-label="Find customer" /><button className="btn sm shrink">Find</button></form>
        </div>
        {found.length > 0 && <div className="small" style={{ marginTop: 6 }}>{found.map((c) => <span key={c.id} style={{ marginRight: 12 }}><Link href={`/billing/counter-sale?customer=${c.id}`}>{custName(c)}</Link> {c.mobile}</span>)}</div>}
        {sp.q && !found.length && <p className="small muted">No customer found.</p>}
      </div>
      <form action={counterSaleAction} className="card">
        <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
        {customerId && <input type="hidden" name="customer_id" value={customerId} />}
        {!customerId && <div className="field" style={{ maxWidth: 320 }}><label>Name on the invoice (optional)</label><input name="bill_to_name" placeholder="Walk-in customer" /></div>}
        <CounterLines items={items} />
        <h3 style={{ marginTop: 14 }}>Payment</h3>
        <label className="check"><input type="checkbox" name="pay_now" defaultChecked /> Take payment now{customerId && Number(s.customer.payment_terms_days) > 0 ? " (untick to put it on the account)" : ""}</label>
        <div className="row">
          <div className="field"><label>Method</label><select name="method">{m.paymentMethods.map((pm) => <option key={pm.code} value={pm.code}>{pm.name}</option>)}</select></div>
          <div className="field"><label>Amount (blank = the whole sale)</label><input name="amount" inputMode="decimal" /></div>
          <div className="field"><label>Reference</label><input name="reference" placeholder="Card slip or transfer reference" /></div>
        </div>
        <details><summary className="small">Cheque details</summary><div className="row">
          <div className="field"><label>Cheque number</label><input name="cheque_no" /></div><div className="field"><label>Bank</label><input name="cheque_bank" /></div>
          <div className="field"><label>Cheque date</label><input name="cheque_date" type="date" /></div></div></details>
        <button className="btn green" style={{ marginTop: 10 }}>Post sale</button>
        <span className="small muted"> Discounts above your limit, prices below the minimum or below cost need the branch manager.</span>
      </form>
    </>
  );
}
