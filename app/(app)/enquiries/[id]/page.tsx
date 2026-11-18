import { RecordHistory } from "@/components/RecordHistory";
import { docHistory } from "@/lib/services/history";
import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { getEnquiry } from "@/lib/services/enquiries";
import { listCustomers } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { messagesFor } from "@/lib/services/messaging";
import { can, canSee, fieldLevel } from "@/lib/access";
import { updateEnquiryAction, lostEnquiryAction, createJobAction, whatsappAction } from "@/app/actions";
import { Flash, Link, Money, PageHead, Status, custName, plate, dt, label } from "@/components/ui";
import { WorkLines, QuotationPanel } from "@/components/WorkPanel";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ManualMessage } from "@/components/ManualMessage";
import { BookingCard } from "@/components/BookingCard";
import { RunForm, RunsTable } from "@/components/RunsPanel";
import { bookAction, closeBookingAction } from "@/app/actions-front";
import { bookingOptions } from "@/lib/services/bookings";
import { runOptions, runsFor, canEditRuns } from "@/lib/services/runs";

const STEPS: [string, string[]][] = [
  ["Enquiry", ["open", "booked"]], ["Quotation sent", ["quoted"]], ["Customer approved", ["approved"]], ["Job card", ["converted"]],
];

export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { enquiry: e, vehicles, lines, quotations, quotationLines, approvals, canSeePrices } = await getEnquiry(ctx, id);
  const m = await masters(ctx);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const b = e.branch_id;
  const back = `/enquiries/${id}`;
  const open = ["open", "booked", "quoted", "approved"].includes(e.status);
  const canEditEnq = can(ctx, "customers", "edit", b) && open;
  const canQuote = can(ctx, "jobs", "edit", b);
  const customers = !e.customer_id && canEditEnq ? await listCustomers(ctx) : [];
  const lost = m.lookups.filter((l) => l.list === "lost_reason");
  const stepAt = STEPS.findIndex(([, s]) => s.includes(e.status));
  const q = quotations[0];
  const msgs = e.customer_id && e.vehicle_id ? await messagesFor(ctx, { enquiryId: id }) : [];
  const bk = await bookingOptions(ctx, b);
  const labourHours = lines.filter((l) => l.line_type === "labour" && l.approval_status !== "declined").reduce((a, l) => a + Number(l.qty), 0);
  const runs = await runsFor(ctx, { enquiryId: id });
  const runEdit = canEditRuns(ctx, b);
  const drivers = runEdit ? (await runOptions(ctx, b)).drivers : [];
  const showBooking = open || e.booking_status;
  return (
    <>
      <PageHead title={`Enquiry ${e.doc_no}`} sub={`${e.customer_id ? custName(e) : `${e.contact_name ?? ""} ${e.contact_mobile ?? ""}`}${e.vehicle_id ? ` · ${plate(e)} · ${e.make} ${e.model}` : ""} · ${e.branch_name}`}>
        <Status s={e.status} />
        {e.vehicle_id && <Link className="btn ghost sm" href={`/vehicles/${e.vehicle_id}`}>Vehicle page</Link>}
        {e.converted_job_id && <Link className="btn" href={`/jobs/${e.converted_job_id}`}>Open job card {e.job_no}</Link>}
      </PageHead>
      <div className="steps">{STEPS.map(([label], i) => <span key={label} className={e.status === "lost" ? "" : i < stepAt ? "done" : i === stepAt ? "on" : ""}>{i + 1}. {label}</span>)}{e.status === "lost" && <span className="on">Lost: {e.lost_reason}</span>}</div>
      <Flash sp={sp} />
      <ManualMessage ctx={ctx} id={sp.msg} back={`${back}?msg=${sp.msg ?? ""}`} />

      <div className="grid2">
        <div className="card"><h2>Customer, vehicle and check-in</h2>
          <p className="small">Asked about: <b>{e.service_asked}</b> · source {label(e.source)} · advisor {e.assigned_name ?? "—"} · follow up {dt(e.follow_up_at) || "—"}</p>
          {canEditEnq ? (
            <form action={updateEnquiryAction}>
              <input type="hidden" name="id" value={id} />
              {!e.customer_id && <div className="field"><label>Customer</label><select name="customer_id"><option value="">Pick the customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{custName(c)} · {c.mobile}</option>)}</select>
                <div className="small muted">Not on the list? <Link href="/customers/new">Add the customer</Link> first.</div></div>}
              {e.customer_id && <div className="field"><label>Vehicle</label><select name="vehicle_id" defaultValue={e.vehicle_id ?? ""}><option value="">Pick the vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{plate(v)} · {v.make} {v.model}</option>)}</select>
                {!vehicles.length && <div className="small muted"><Link href={`/customers/${e.customer_id}`}>Add a vehicle</Link> to this customer first.</div>}</div>}
              <div className="row">
                <div className="field"><label>Odometer (km){e.last_odometer ? `, last ${Number(e.last_odometer).toLocaleString()}` : ""}</label><input name="odometer_in" inputMode="numeric" defaultValue={e.odometer_in ?? ""} /></div>
                <div className="field"><label>Fuel (0 to 8)</label><input name="fuel_level" type="number" min={0} max={8} defaultValue={e.fuel_level ?? ""} /></div>
              </div>
              <div className="row">
                <div className="field"><label>Customer complaints</label><textarea name="complaints" defaultValue={e.complaints ?? ""} /></div>
                <div className="field"><label>Valuables</label><textarea name="valuables" defaultValue={e.valuables ?? ""} /></div>
              </div>
              <button className="btn sm">Save</button>
            </form>
          ) : (
            <div className="small">Odometer <b>{e.odometer_in?.toLocaleString() ?? "—"} km</b> · fuel <b>{e.fuel_level ?? "—"}/8</b><p><b>Complaints:</b> {e.complaints || "—"}</p></div>
          )}
        </div>

        <div className="card"><h2>Next step</h2>
          {e.status === "approved" && can(ctx, "jobs", "create", b) ? (
            <form action={createJobAction}>
              <input type="hidden" name="enquiry_id" value={id} />
              <p className="small">The customer approved {q?.doc_no} for {canSeePrices ? <>AED <Money v={q?.approved_total} /></> : "the listed work"}. Create the job card to start the work. Parts for approved lines are committed now.</p>
              <div className="row">
                <div className="field"><label>Job type</label><select name="job_type"><option value="service">Service</option><option value="repair">Repair</option><option value="warranty_comeback">Warranty comeback</option><option value="internal">Internal</option><option value="recovery">Recovery</option></select></div>
                <div className="field"><label>Original job no. (comebacks)</label><input name="original_job_no" placeholder="YAS-1402" /></div>
              </div>
              <div className="row">
                <div className="field"><label>Odometer (km)</label><input name="odometer_in" inputMode="numeric" defaultValue={e.odometer_in ?? ""} required /></div>
                <div className="field"><label>Promised delivery</label><input type="datetime-local" name="promised_at" /></div>
                <div className="field"><label>Customer LPO no. (fleet)</label><input name="lpo_no" /></div>
              </div>
              <button className="btn green">Create job card</button>
            </form>
          ) : e.status === "converted" ? <p>Job card <Link href={`/jobs/${e.converted_job_id}`}>{e.job_no}</Link> was created from the approved quotation.</p>
            : e.status === "quoted" && q?.status === "expired" ? <p className="small"><b>{q?.doc_no} expired</b> without an answer from the customer. Check the work and prices below, then save a new quotation and send it again.</p>
            : e.status === "quoted" ? <p className="small">Waiting for the customer&apos;s answer on {q?.doc_no}. Record it below if they answer in person or by phone. The job card can be created once they approve.</p>
            : e.status === "lost" ? <p className="small">This enquiry is closed.</p>
            : <p className="small">{e.customer_id && e.vehicle_id ? "Add the work below, save the quotation and send it to the customer. The job card is created after the customer approves." : "Pick the customer and the vehicle, then add the work to quote."}</p>}
          {open && canEditEnq && (
            <form action={lostEnquiryAction} style={{ marginTop: 14 }}><input type="hidden" name="id" value={id} /><input type="hidden" name="$back" value={back} />
              <div className="row"><div className="field"><label>Why it was lost</label><select name="reason" required>{lost.map((l) => <option key={l.code} value={l.name_en}>{l.name_en}</option>)}</select></div><ConfirmButton className="btn ghost sm shrink" message="Mark this enquiry as lost? Its open quotation is withdrawn.">Mark lost</ConfirmButton></div></form>
          )}
        </div>
      </div>

      <div className="grid2">
        {showBooking && <BookingCard enquiryId={id} branchId={b} back={back} bays={bk.bays} techs={bk.techs} policy={bk.policy} canEdit={canEditEnq}
          action={bookAction} closeAction={closeBookingAction} defaultHours={String(labourHours || "")}
          booking={{ status: e.booking_status, when: e.booked_for_local, bayId: e.booking_bay_id, techId: e.booking_technician_id, hours: e.booking_hours,
            bayCode: e.booking_bay_code, techName: e.booking_technician_name, reason: e.booking_override_reason }} />}
        <div className="card" id="runs"><h2>Pickup, drop-off and recovery</h2>
          <RunsTable rows={runs} back={`${back}#runs`} canEdit={runEdit} prices={canSeePrices} showRef={false} />
          {runEdit && open && (
            <details style={{ marginTop: 10 }} open={!runs.length && e.source === "recovery"}><summary className="btn sm ghost">Schedule a run</summary>
              <RunForm back={`${back}#runs`} drivers={drivers} enquiryId={id} canCharge={canSee(ctx, "selling_price", b)}
                chargeTarget={e.customer_id && e.vehicle_id ? "quotation" : null} defaults={{ to: e.branch_name }} /></details>
          )}
        </div>
      </div>

      {e.customer_id && e.vehicle_id && (
        <>
          <WorkLines owner={{ kind: "enquiry", id }} back={back} lines={lines} m={m} canEdit={canQuote} canSeePrices={canSeePrices}
            discountEdit={fieldLevel(ctx, "discount", b) === "edit"} priceEdit={fieldLevel(ctx, "selling_price", b) === "edit"} open={open} />
          <QuotationPanel enquiryId={id} back={back} origin={origin} quotations={quotations} quotationLines={quotationLines} lines={lines}
            canEdit={canQuote && open} canSeePrices={canSeePrices} discountEdit={fieldLevel(ctx, "discount", b) === "edit"} open={open} isJob={false} />
        </>
      )}

      <div className="grid2">
        <div className="card"><h2>Approval history</h2>
          <table><tbody>{approvals.map((a) => <tr key={a.id}><td>{label(a.action)}</td><td>{a.step_name ?? ""}</td><td>{a.full_name}</td><td className="small muted">{dt(a.at)}</td><td className="small">{a.comment}</td></tr>)}</tbody></table>
          {!approvals.length && <p className="muted small">None.</p>}
        </div>
        <div className="card"><h2>Customer messages</h2>
          {e.customer_id && e.vehicle_id && canEditEnq && (
            <form action={whatsappAction}><input type="hidden" name="enquiry_id" value={id} /><input type="hidden" name="$back" value={back} />
              <div className="row"><div className="field"><label>Message</label><select name="event"><option value="enquiry_reply">Reply to enquiry</option></select></div><button className="btn wa sm shrink">Prepare WhatsApp</button></div></form>
          )}
          <table><tbody>{msgs.map((x) => <tr key={x.id}><td>{x.event.replace(/_/g, " ")}</td><td><Status s={x.status} /></td><td className="small">{x.full_name}</td><td className="small muted">{dt(x.at)}</td></tr>)}</tbody></table>
          {!msgs.length && <p className="muted small">None yet. Messages are prepared here and sent by you; nothing is sent automatically.</p>}
        </div>
      </div>
      <RecordHistory rows={await docHistory(ctx, "enquiry", id)} />
    </>
  );
}
