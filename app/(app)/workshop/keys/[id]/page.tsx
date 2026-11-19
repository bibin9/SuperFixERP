import { requireCtx } from "@/lib/session";
import { getKeyDrop } from "@/lib/services/keydrop";
import { completeKeyDropAction, cancelKeyDropAction } from "@/app/actions-front";
import { can } from "@/lib/access";
import { Flash, Link, PageHead } from "@/components/ui";

/** One key drop: what the customer wrote and signed, then the check-in that starts the enquiry. */
export default async function KeyDrop({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { k, photos, customers, vehicles } = await getKeyDrop(ctx, id);
  const edit = can(ctx, "customers", "create", k.branch_id);
  const plate = [k.registered_in, k.plate_code, k.plate_number].filter(Boolean).join(" ");
  const [first, ...rest] = String(k.name).split(/\s+/);
  const newCust = `/customers/new?${new URLSearchParams({ form: JSON.stringify({ customer_type: "individual", title: k.title ?? "", first_name: first, last_name: rest.join(" "), country_code: "AE", mobile: k.mobile }) })}`;
  return (
    <>
      <PageHead title={`Key drop ${k.doc_no}`} sub={`Dropped ${k.at}${k.key_slot ? ` · key in slot ${k.key_slot}` : ""}`}>
        <Link className="btn ghost sm" href="/workshop/keys">All key drops</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card">
          <h2>What the customer wrote</h2>
          <dl className="dl">
            <dt>Name</dt><dd>{k.title ? `${k.title} ` : ""}{k.name}</dd>
            <dt>Mobile</dt><dd>{k.mobile}</dd>
            <dt>Car</dt><dd>{plate}{k.make_model ? ` · ${k.make_model}` : ""}</dd>
            <dt>Odometer</dt><dd>{k.odometer != null ? `${Number(k.odometer).toLocaleString("en-GB")} km` : "Not given"}</dd>
            <dt>Service</dt><dd>{k.service_asked}</dd>
            {k.complaints && <><dt>Problem</dt><dd>{k.complaints}</dd></>}
            <dt>Valuables</dt><dd>{k.valuables || "None"}</dd>
          </dl>
          {photos.length > 0 && <div className="photos" style={{ marginTop: 10 }}>{photos.map((p: { id: string; file_name: string }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={p.id} href={`/api/attachments/${p.id}`} target="_blank"><img src={`/api/attachments/${p.id}`} alt={p.file_name} /></a>))}</div>}
          <h3>Signed on the phone</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {k.signature && <img src={k.signature} alt={`Signature of ${k.name}`} style={{ maxWidth: 320, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }} />}
        </div>
        <div className="card">
          {k.status === "checked_in" ? <><h2>Checked in</h2><p>By {k.done_by_name}. Enquiry <Link href={`/enquiries/${k.enquiry_id}`}>{k.enquiry_no}</Link>.</p></>
            : k.status === "cancelled" ? <><h2>Cancelled</h2><p>{k.cancel_reason}</p></>
            : edit ? <>
              <h2>Check in</h2>
              <p className="small">Choose the customer and the car. They are found by the mobile number and the plate; if they are new, add them first and come back here.</p>
              <form action={completeKeyDropAction}>
                <input type="hidden" name="id" value={k.id} />
                <div className="field"><label htmlFor="kc">Customer</label>
                  <select id="kc" name="customer_id" required defaultValue={customers[0]?.id ?? ""}><option value="">Choose</option>{customers.map((c: { id: string; customer_no: string; name: string }) => <option key={c.id} value={c.id}>{c.customer_no} · {c.name}</option>)}</select>
                  {!customers.length && <p className="small muted">No customer with {k.mobile}. <Link href={newCust}>Add the customer</Link>.</p>}</div>
                <div className="field"><label htmlFor="kv">Car</label>
                  <select id="kv" name="vehicle_id" required defaultValue={vehicles[0]?.id ?? ""}><option value="">Choose</option>{vehicles.map((v: { id: string; make: string; model: string; model_year: number; registered_in: string; plate_code: string; plate_number: string }) => <option key={v.id} value={v.id}>{v.registered_in} {v.plate_code} {v.plate_number} · {v.make} {v.model} {v.model_year ?? ""}</option>)}</select>
                  {!vehicles.length && <p className="small muted">No car with plate {plate}. Add it on the customer&apos;s page first.</p>}</div>
                <button className="btn">Complete check-in and start the enquiry</button>
              </form>
              <details style={{ marginTop: 14 }}><summary className="small">Cancel this key drop</summary>
                <form action={cancelKeyDropAction} className="row" style={{ marginTop: 8 }}><input type="hidden" name="id" value={k.id} />
                  <input name="reason" required placeholder="For example: customer collected the key" aria-label="Why cancelled" /><button className="btn ghost sm shrink">Cancel key drop</button></form>
              </details>
            </> : <p className="muted">Waiting for an advisor to check it in.</p>}
        </div>
      </div>
    </>
  );
}
