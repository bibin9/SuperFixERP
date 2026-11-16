import { requireCtx } from "@/lib/session";
import { getCustomer, listCustomers } from "@/lib/services/customers";
import { createJobAction } from "@/app/actions";
import { Flash, Link, PageHead, custName, plate } from "@/components/ui";

export default async function NewJob({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!sp.customer) {
    const customers = await listCustomers(ctx, sp.q ?? "");
    return (
      <>
        <PageHead title="Check-in · step 1: customer" sub="Find the customer, or add a new one first." />
        <div className="card">
          <form className="row" style={{ marginBottom: 10 }}><input name="q" defaultValue={sp.q} placeholder="Name or mobile" /><button className="btn ghost shrink">Find</button><Link className="btn shrink" href="/customers/new">New customer</Link></form>
          <table><tbody>{customers.map((c) => <tr key={c.id}><td><Link href={`/jobs/new?customer=${c.id}`}>{custName(c)}</Link></td><td>{c.mobile}</td><td className="muted">{c.vehicles} vehicles</td></tr>)}</tbody></table>
        </div>
      </>
    );
  }
  const { customer, vehicles } = await getCustomer(ctx, sp.customer);
  const back = `/jobs/new?customer=${sp.customer}${sp.enquiry ? `&enquiry=${sp.enquiry}` : ""}`;
  return (
    <>
      <PageHead title="Check-in · steps 2 and 3: vehicle and check-in" sub={`${custName(customer)} · ${customer.mobile}`} />
      <Flash sp={sp} />
      {!vehicles.length && <div className="flash warn">This customer has no vehicle yet. <Link href={`/customers/${customer.id}`}>Add one</Link>.</div>}
      <div className="card">
        <form action={createJobAction}>
          <input type="hidden" name="$back" value={back} /><input type="hidden" name="customer_id" value={customer.id} />
          {sp.enquiry && <input type="hidden" name="enquiry_id" value={sp.enquiry} />}
          <div className="row">
            <div className="field"><label>Vehicle</label><select name="vehicle_id" defaultValue={sp.vehicle} required>{vehicles.map((v) => <option key={v.id} value={v.id}>{plate(v)} · {v.make} {v.model}</option>)}</select></div>
            <div className="field"><label>Job type</label><select name="job_type"><option value="service">Service</option><option value="repair">Repair</option><option value="warranty_comeback">Warranty comeback</option><option value="internal">Internal</option></select></div>
            <div className="field"><label>Original job no. (comebacks)</label><input name="original_job_no" placeholder="YAS-1402" /></div>
          </div>
          <div className="row">
            <div className="field"><label>Odometer (km)</label><input name="odometer_in" inputMode="numeric" required /></div>
            <div className="field"><label>Fuel level (0 to 8 eighths)</label><input name="fuel_level" type="number" min={0} max={8} defaultValue={4} /></div>
            <div className="field"><label>Promised delivery</label><input type="datetime-local" name="promised_at" /></div>
            <div className="field"><label>Customer LPO no. (fleet)</label><input name="lpo_no" /></div>
          </div>
          <div className="row">
            <div className="field"><label>Customer complaints</label><textarea name="complaints" /></div>
            <div className="field"><label>Valuables in the car</label><textarea name="valuables" /></div>
          </div>
          <button className="btn">Save check-in and create job card</button>
          <p className="muted small">The job number is given from this branch&apos;s series when you save (JC-04). Damage marks, photos and signature capture are next on the list.</p>
        </form>
      </div>
    </>
  );
}
