import { requireCtx } from "@/lib/session";
import { getCustomer, listCustomers } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { complaintList } from "@/lib/services/bundles";
import { ComplaintPicker } from "@/components/ComplaintPicker";
import { createEnquiryAction } from "@/app/actions";
import { Flash, Link, PageHead, custName, plate } from "@/components/ui";

export default async function NewEnquiry({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [m, complaints] = await Promise.all([masters(ctx), complaintList(ctx)]);
  const src = m.lookups.filter((l) => l.list === "enquiry_source");
  const details = (
    <>
      <div className="row">
        <div className="field"><label>Service asked about</label><input name="service_asked" required /></div>
        <div className="field"><label>Source</label><select name="source" required>{src.map((s) => <option key={s.code} value={s.code}>{s.name_en}</option>)}</select></div>
        <div className="field"><label>Follow up at</label><input type="datetime-local" name="follow_up_at" required /></div>
      </div>
      <div className="field"><label>Notes</label><textarea name="notes" /></div>
    </>
  );
  if (!sp.customer) {
    const customers = await listCustomers(ctx, sp.q ?? "");
    return (
      <>
        <PageHead title="New enquiry · step 1: customer" sub="Find the customer, add a new one, or note a contact for a quick phone enquiry." />
        <Flash sp={sp} />
        <div className="card">
          <form className="row" style={{ marginBottom: 10 }}><div className="field"><label htmlFor="q">Find the customer</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name or mobile" /></div><button className="btn ghost shrink">Find</button><Link className="btn shrink" href="/customers/new">New customer</Link></form>
          <table><tbody>{customers.map((c) => <tr key={c.id}><td><Link href={`/enquiries/new?customer=${c.id}`}>{custName(c)}</Link></td><td>{c.mobile}</td><td className="muted">{c.vehicles} vehicles</td></tr>)}</tbody></table>
        </div>
        <div className="card"><h2>Contact only (no customer record yet)</h2>
          <form action={createEnquiryAction}><input type="hidden" name="$back" value="/enquiries/new" />
            <div className="row"><div className="field"><label>Contact name</label><input name="contact_name" required /></div><div className="field"><label>Contact mobile</label><input name="contact_mobile" required /></div></div>
            {details}
            <button className="btn">Save enquiry</button>
            <p className="small muted">Before a quotation can be made, pick or add the customer and the vehicle on the enquiry.</p>
          </form>
        </div>
      </>
    );
  }
  const { customer, vehicles } = await getCustomer(ctx, sp.customer);
  return (
    <>
      <PageHead title="New enquiry · step 2: vehicle and request" sub={`${custName(customer)} · ${customer.mobile}`} />
      <Flash sp={sp} />
      {!vehicles.length && <div className="flash warn">This customer has no vehicle yet. <Link href={`/customers/${customer.id}`}>Add one</Link> to quote for it.</div>}
      <div className="card">
        <form action={createEnquiryAction}>
          <input type="hidden" name="$back" value={`/enquiries/new?customer=${customer.id}`} /><input type="hidden" name="customer_id" value={customer.id} />
          <div className="field"><label>Vehicle</label><select name="vehicle_id" defaultValue={sp.vehicle}><option value="">Not known yet</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{plate(v)} · {v.make} {v.model}</option>)}</select></div>
          {details}
          <h3>Vehicle received (optional now, needed before the job card)</h3>
          <div className="row">
            <div className="field"><label>Odometer (km)</label><input name="odometer_in" inputMode="numeric" /></div>
            <div className="field"><label>Fuel level (0 to 8 eighths)</label><input name="fuel_level" type="number" min={0} max={8} /></div>
          </div>
          <div className="row">
            <div className="field"><label>Customer complaints</label><ComplaintPicker list={complaints} /></div>
            <div className="field"><label>Valuables in the car</label><textarea name="valuables" /></div>
          </div>
          <button className="btn">Save enquiry</button>
        </form>
      </div>
    </>
  );
}
