import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { getCustomer, listCustomers } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { quickSetup } from "@/lib/services/billing-quick";
import { quickJobAction } from "@/app/actions-billing";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, Link, PageHead, custName, plate } from "@/components/ui";

const ROWS = 6;

/** Quick job (OT-02): a small job recorded, invoiced and paid on one screen. */
export default async function QuickJob({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const { limit } = await quickSetup(ctx);
  const sub = `For small jobs done while the customer waits, up to AED ${limit}. One step makes the job card, the invoice and the receipt.`;
  if (!sp.customer) {
    const customers = await listCustomers(ctx, sp.q ?? "");
    return (
      <>
        <PageHead title="Quick job · choose the customer" sub={sub} />
        <Flash sp={sp} />
        <div className="card">
          <form className="row" style={{ marginBottom: 10 }}><div className="field"><label htmlFor="q">Find the customer</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name, mobile or plate" /></div><button className="btn ghost shrink">Find</button><Link className="btn ghost shrink" href="/customers/new">New customer</Link></form>
          <table className="no-pager"><tbody>{customers.slice(0, 30).map((c) => <tr key={c.id}><td><Link href={`/billing/quick?customer=${c.id}`}>{custName(c)}</Link></td><td>{c.mobile}</td><td className="muted">{c.vehicles} vehicles</td></tr>)}</tbody></table>
        </div>
      </>
    );
  }
  const [{ customer, vehicles }, m] = await Promise.all([getCustomer(ctx, sp.customer), masters(ctx)]);
  const services = [...m.services].sort((a, b) => Number(b.is_quick) - Number(a.is_quick) || a.name_en.localeCompare(b.name_en));
  return (
    <>
      <PageHead title="Quick job" sub={`${custName(customer)} · ${customer.mobile} · up to AED ${limit}`}>
        <Link className="btn ghost sm" href="/billing/quick">Other customer</Link>
      </PageHead>
      <Flash sp={sp} />
      {!vehicles.length ? <div className="flash warn">This customer has no car yet. <Link href={`/customers/${customer.id}`}>Add one</Link> first.</div> : (
        <form action={quickJobAction} className="card quickjob">
          <input type="hidden" name="$back" value={`/billing/quick?customer=${customer.id}`} />
          <input type="hidden" name="customer_id" value={customer.id} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
          <div className="row">
            <div className="field"><label>Car</label><select name="vehicle_id" required defaultValue={vehicles.length === 1 ? vehicles[0].id : ""}><option value="" disabled>Choose the car</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{plate(v)} · {v.make} {v.model}</option>)}</select></div>
            <div className="field"><label>Odometer (km)</label><input name="odometer_in" inputMode="numeric" required /></div>
            <div className="field"><label>Note (printed on the invoice)</label><input name="notes" /></div>
          </div>
          <h3>Work and parts</h3>
          <table className="no-pager quicklines">
            <thead><tr><th>Type</th><th>Service or part</th><th>Description</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Discount</th></tr></thead>
            <tbody>{Array.from({ length: ROWS }, (_, i) => (
              <tr key={i}>
                <td><select name={`l${i}_line_type`} defaultValue={i === 0 ? "labour" : ""} aria-label={`Line ${i + 1} type`}><option value="">—</option><option value="labour">Labour</option><option value="part">Part</option><option value="consumable">Consumable</option><option value="outside">Outside work</option></select></td>
                <td><select name={`l${i}_service_id`} defaultValue="" aria-label={`Line ${i + 1} service`}><option value="">Service (labour)</option>{services.map((x) => <option key={x.id} value={x.id}>{x.is_quick ? "★ " : ""}{x.name_en}</option>)}</select>
                  <select name={`l${i}_item_id`} defaultValue="" aria-label={`Line ${i + 1} part`}><option value="">Part</option>{m.items.map((x) => <option key={x.id} value={x.id}>{x.part_no} · {x.description}</option>)}</select></td>
                <td><input name={`l${i}_description`} placeholder="Optional; needed for outside work" aria-label={`Line ${i + 1} description`} /></td>
                <td className="num"><input name={`l${i}_qty`} placeholder="1" inputMode="decimal" className="numin" aria-label={`Line ${i + 1} quantity`} /></td>
                <td className="num"><input name={`l${i}_unit_price`} placeholder="List" inputMode="decimal" className="numin" aria-label={`Line ${i + 1} price`} /></td>
                <td className="num"><input name={`l${i}_discount_amount`} placeholder="0.00" inputMode="decimal" className="numin" aria-label={`Line ${i + 1} discount`} /></td>
              </tr>))}</tbody>
          </table>
          <p className="small muted">★ marks quick services. Price left blank uses the list price. Parts are taken from the store when you post.</p>
          <h3>Payment</h3>
          <div className="row">
            <div className="field"><label>Payment</label><select name="pay" defaultValue="full"><option value="full">Paid in full now</option><option value="part">Part payment (amount below)</option><option value="later">Pay later (on account)</option></select></div>
            <div className="field"><label>Method</label><select name="method">{m.paymentMethods.map((pm) => <option key={pm.code} value={pm.code}>{pm.name}</option>)}</select></div>
            <div className="field"><label>Amount (part payment only)</label><input name="amount" inputMode="decimal" /></div>
            <div className="field"><label>Reference</label><input name="reference" placeholder="Card slip or transfer" /></div>
          </div>
          <label className="check"><input type="checkbox" name="handed_over" defaultChecked /> The customer takes the car now (recorded as handed over when paid in full)</label>
          <div style={{ marginTop: 12 }}>
            <ConfirmButton className="btn green" message="Post this quick job? It makes the job card and the invoice, and the invoice cannot be edited afterwards.">Post invoice</ConfirmButton>
            <span className="small muted"> Use a normal enquiry and job card for bigger work or when the customer must approve a quotation first.</span>
          </div>
        </form>
      )}
    </>
  );
}
