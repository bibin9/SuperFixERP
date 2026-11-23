import { requireCtx } from "@/lib/session";
import { getCustomer } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { CustomerForm } from "@/components/CustomerForm";
import { addVehicleAction, driverAction } from "@/app/actions";
import { Flash, Link, PageHead, custName, plate, Plate, dt, label } from "@/components/ui";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { customer: c, vehicles, consents, drivers } = await getCustomer(ctx, id);
  const m = await masters(ctx);
  const back = `/customers/${id}`;
  const vdups = sp.vdups ? JSON.parse(sp.vdups) : null;
  const vf = sp.vform ? JSON.parse(sp.vform) : {};
  return (
    <>
      <PageHead title={custName(c)} sub={`${c.customer_no} · ${c.mobile}${c.trn ? ` · TRN ${c.trn}` : ""}`}>
        {can(ctx, "customers", "create") && <Link className="btn" href={`/enquiries/new?customer=${id}`}>New enquiry</Link>}
        {ctx.currentBranchId && can(ctx, "jobs", "edit", ctx.currentBranchId) && <Link className="btn ghost" href={`/complaints/new?customer=${id}`}>Open a complaint</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="card">
        <h2>Vehicles</h2>
        <table>
          <thead><tr><th>Plate</th><th>Vehicle</th><th>VIN</th><th>Odometer</th></tr></thead>
          <tbody>{vehicles.map((v) => <tr key={v.id}><td><Link href={`/vehicles/${v.id}`} aria-label={plate(v)}><Plate v={v} /></Link></td><td>{v.make} {v.model} {v.model_year}</td><td>{v.vin ?? <span className="muted">n/a: {v.vin_missing_reason}</span>}</td><td className="num">{v.odometer?.toLocaleString()}</td></tr>)}</tbody>
        </table>
        {can(ctx, "customers", "create") && (
          <form action={addVehicleAction} style={{ marginTop: 14 }}>
            <h3>Add vehicle</h3>
            {vdups && (
              <div className="flash warn"><b>Matches an existing vehicle:</b>
                <ul>{vdups.map((d: { id: string; kind: string; label: string }) => <li key={d.id}>{d.kind}: <a href={`/vehicles/${d.id}`}>{d.label}</a></li>)}</ul>
                {vdups.some((d: { kind: string }) => d.kind === "vin") ? "A duplicate VIN cannot be saved." : <>Plates can move between cars. To save anyway, give a reason: <input name="duplicate_reason" required /></>}
              </div>
            )}
            <input type="hidden" name="$back" value={back} /><input type="hidden" name="owner_customer_id" value={id} />
            <div className="row">
              <div className="field"><label>Registered in</label><select name="registered_in" required defaultValue={vf.registered_in ?? "AUH"}>{m.plates.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
              <div className="field"><label>Plate code</label><input name="plate_code" defaultValue={vf.plate_code} placeholder="e.g. 5 or K" required /></div>
              <div className="field"><label>Plate number</label><input name="plate_number" defaultValue={vf.plate_number} required /></div>
              <div className="field"><label>VIN (17 characters)</label><input name="vin" defaultValue={vf.vin} /></div>
              <div className="field"><label>If no VIN, reason</label><input name="vin_missing_reason" defaultValue={vf.vin_missing_reason} /></div>
            </div>
            <div className="row">
              <div className="field"><label>Make</label><input name="make" defaultValue={vf.make} required /></div>
              <div className="field"><label>Model</label><input name="model" defaultValue={vf.model} required /></div>
              <div className="field"><label>Year</label><input name="model_year" defaultValue={vf.model_year} inputMode="numeric" required /></div>
              <div className="field"><label>Colour</label><input name="colour" defaultValue={vf.colour} /></div>
              <div className="field"><label>Odometer</label><input name="odometer" defaultValue={vf.odometer} /></div>
              <div className="field"><label>Mulkiya expiry</label><input type="date" name="mulkiya_expiry" defaultValue={vf.mulkiya_expiry} /></div>
              <div className="shrink"><button className="btn">Add vehicle</button></div>
            </div>
          </form>
        )}
      </div>
      {c.customer_type !== "individual" && <div className="card" id="drivers"><h2>Approved drivers</h2>
        <p className="small muted">People this account allows to bring in and collect its cars. Their names are offered at delivery.</p>
        {drivers.length > 0 ? <table><thead><tr><th>Name</th><th>Mobile</th><th>Licence no.</th><th>Status</th>{can(ctx, "customers", "edit") && <th></th>}</tr></thead><tbody>
          {drivers.map((d) => <tr key={d.id} className={d.active ? "" : "muted"}><td>{d.name}</td><td>{d.mobile ?? "—"}</td><td>{d.licence_no ?? "—"}</td><td>{d.active ? "Approved" : "Taken off"}</td>
            {can(ctx, "customers", "edit") && <td><form action={driverAction}><input type="hidden" name="$back" value={`${back}#drivers`} /><input type="hidden" name="driver_id" value={d.id} /><input type="hidden" name="active" value={d.active ? "0" : "1"} /><button className="btn ghost sm">{d.active ? "Take off the list" : "Put back"}</button></form></td>}</tr>)}
        </tbody></table> : <p className="muted small">No approved drivers yet.</p>}
        {can(ctx, "customers", "edit") && <form action={driverAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="$back" value={`${back}#drivers`} /><input type="hidden" name="customer_id" value={id} />
          <div className="row">
            <div className="field"><label>Driver name</label><input name="name" required /></div>
            <div className="field"><label>Mobile</label><input name="mobile" inputMode="tel" /></div>
            <div className="field"><label>Licence no.</label><input name="licence_no" /></div>
            <div className="shrink"><button className="btn">Add driver</button></div>
          </div>
        </form>}
      </div>}
      {can(ctx, "customers", "edit") && <div className="card"><h2>Details</h2><CustomerForm back={back} countries={m.countries} titles={m.titles} lookups={m.lookups} c={c} dups={sp.dups ? JSON.parse(sp.dups) : undefined} /></div>}
      <div className="card"><h2>Consent history (PDPL)</h2>
        <table><tbody>{consents.map((x) => <tr key={x.id}><td>{x.consent ? "Opted in" : "Not opted in"}</td><td>{label(x.channel)}</td><td className="muted">{dt(x.at)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
