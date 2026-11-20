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
import { listBundles, rankForVehicle, complaintList, suggestedServices } from "@/lib/services/bundles";
import { ComplaintPicker } from "@/components/ComplaintPicker";
import { addSuggestedAction } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ManualMessage } from "@/components/ManualMessage";
import { BookingCard } from "@/components/BookingCard";
import { RunForm, RunsTable } from "@/components/RunsPanel";
import { bookAction, closeBookingAction } from "@/app/actions-front";
import { bookingOptions } from "@/lib/services/bookings";
import { runOptions, runsFor, canEditRuns } from "@/lib/services/runs";
import { Popup } from "@/components/Popup";
import { QuickAdd } from "@/components/QuickAdd";
import { quickSpec } from "@/lib/services/quick-add";

const STEPS: [string, string[]][] = [
  ["Enquiry", ["open", "booked"]], ["Quotation sent", ["quoted"]], ["Customer approved", ["approved"]], ["Job card", ["converted"]],
];

export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { enquiry: e, vehicles, lines, quotations, quotationLines, approvals, canSeePrices } = await getEnquiry(ctx, id);
  const [m0, bundles, complaints] = await Promise.all([masters(ctx), listBundles(ctx), complaintList(ctx)]);
  const suggested = suggestedServices(e.complaints, complaints).filter((s) => !lines.some((l: { service_id?: string; removed?: boolean }) => l.service_id === s.id));
  const car = vehicles.find((v: { id: string }) => v.id === e.vehicle_id) ?? null;
  const m = { ...m0, bundles: rankForVehicle(bundles, car) };
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
  const quick = canEditEnq
    ? { customer: !e.customer_id ? await quickSpec(ctx, "customer") : null, vehicle: await quickSpec(ctx, "vehicle"), items: await quickSpec(ctx, "items"), services: await quickSpec(ctx, "services") }
    : { customer: null, vehicle: null, items: null, services: null };
  return (
    <>
      <PageHead title={`Enquiry ${e.doc_no}`} sub={`${e.customer_id ? custName(e) : `${e.contact_name ?? ""} ${e.contact_mobile ?? ""}`}${e.vehicle_id ? ` · ${plate(e)} · ${e.make} ${e.model}` : ""} · ${e.branch_name}`}>
        <Status s={e.status} />
        {e.vehicle_id && <Link className="btn ghost sm" href={`/vehicles/${e.vehicle_id}`}>Vehicle page</Link>}
        {e.converted_job_id && <Link className="btn" href={`/jobs/${e.converted_job_id}`}>Open job card {e.job_no}</Link>}
      </PageHead>
      <Flash sp={sp} />
      <ManualMessage ctx={ctx} id={sp.msg} back={`${back}?msg=${sp.msg ?? ""}`} />
      {(() => {
        // One clear next step for where the enquiry is; the rest of the page is folded or below.
        const pendingLines = lines.filter((l: { removed?: boolean; approval_status?: string }) => !l.removed && l.approval_status === "pending").length;
        const go = (href: string, text: string) => <Link className="btn green" href={href}>{text}</Link>;
        let title = "", hint = "", action: React.ReactNode = null;
        if (e.status === "lost") { title = "This enquiry is closed"; hint = `Lost: ${e.lost_reason ?? ""}`; }
        else if (e.status === "converted") { title = "Job card created"; hint = "The work continues on the job card."; action = go(`/jobs/${e.converted_job_id}`, `Open job card ${e.job_no}`); }
        else if (!e.customer_id || !e.vehicle_id) { title = "Pick the customer and the car"; hint = "Needed before any work can be quoted."; action = canEditEnq ? <a className="btn green" href="#details-form">Fill in customer and car</a> : null; }
        else if (e.status === "approved") {
          title = "Create the job card"; hint = `The customer approved ${q?.doc_no ?? "the quotation"}. Create the job card to start the work.`;
          if (can(ctx, "jobs", "create", b)) action = <Popup id="create-job" title="Create the job card" label="Create job card" className="btn green">
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
          </Popup>;
        }
        else if (pendingLines === 0 && (!q || ["superseded", "declined", "expired"].includes(q.status))) { title = "Add the work to quote"; hint = "Add services and parts, or tick the suggestions from the complaints."; action = go("#lines", "Add work"); }
        else if (pendingLines > 0 && (!q || !["draft", "pending_internal_approval", "ready_to_send", "sent"].includes(q.status) || q.status === "superseded")) { title = "Save the quotation"; hint = `${pendingLines} line${pendingLines > 1 ? "s" : ""} to quote. Check the prices, then save the quotation.`; action = go("#quote", "Save the quotation"); }
        else if (q?.status === "pending_internal_approval") { title = "Waiting for manager approval"; hint = `${q.doc_no} has a discount or price that needs a manager. It can be sent once approved.`; }
        else if (q?.status === "ready_to_send" || q?.status === "draft") { title = "Send the quotation"; hint = `${q.doc_no} is ready. Send it on WhatsApp, or record the answer if the customer is here.`; action = go("#quote", "Send the quotation"); }
        else if (q?.status === "sent") { title = "Wait for the customer's answer"; hint = `Sent ${q.doc_no}. If they answer in person or by phone, record it.`; action = go("#quote", "Record the answer"); }
        else { title = "Add the work to quote"; action = go("#lines", "Add work"); }
        return (
          <div className="card nextstep">
            <div className="steps" aria-label="Enquiry stages">{STEPS.map(([n], i) => <span key={n} className={e.status === "lost" ? "" : i < stepAt ? "done" : i === stepAt ? "on" : ""}>{i < stepAt && e.status !== "lost" ? "✓ " : ""}{n}</span>)}{e.status === "lost" && <span className="on">Lost</span>}</div>
            <div className="nextrow">
              <div><div className="small muted">Next step</div><h2 style={{ margin: "2px 0" }}>{title}</h2>{hint && <div className="small muted">{hint}</div>}</div>
              <div className="shrink">{action}</div>
            </div>

            {open && canEditEnq && <div className="popbtns"><Popup id="mark-lost" title="Mark the enquiry as lost" label="Customer not going ahead? Mark as lost" className="btn ghost sm">
              <form action={lostEnquiryAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="$back" value={back} />
                <p className="small muted">The open quotation is withdrawn. The enquiry stays on record.</p>
                <div className="field"><label>Why it was lost</label><select name="reason" required>{lost.map((l) => <option key={l.code} value={l.name_en}>{l.name_en}</option>)}</select></div>
                <ConfirmButton className="btn red" message="Mark this enquiry as lost? Its open quotation is withdrawn.">Mark lost</ConfirmButton></form>
            </Popup></div>}
          </div>
        );
      })()}

      <div className="card" id="details">
          <div className="row" style={{ alignItems: "center" }}><h2 style={{ margin: 0 }}>Customer, car and check-in</h2>
            {canEditEnq && <div className="shrink"><Popup id="details-form" wide title="Customer, car and check-in" label={!e.customer_id || !e.vehicle_id ? "Fill in customer and car" : "Edit"} className={!e.customer_id || !e.vehicle_id ? "btn sm" : "btn ghost sm"}>
            <form action={updateEnquiryAction}>
              <input type="hidden" name="id" value={id} />
              {!e.customer_id && <div className="field"><label>Customer</label><div className="picker"><select name="customer_id"><option value="">Pick the customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{custName(c)} · {c.mobile}</option>)}</select>
                {quick.customer && <QuickAdd spec={quick.customer} target="customer_id" label="+ New customer" />}</div></div>}
              <div className="field"><label>Vehicle</label><div className="picker"><select name="vehicle_id" defaultValue={e.vehicle_id ?? ""}><option value="">Pick the vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{plate(v)} · {v.make} {v.model}</option>)}</select>
                {quick.vehicle && <QuickAdd spec={quick.vehicle} target="vehicle_id" label="+ New car" {...(e.customer_id ? { owner: e.customer_id } : { ownerFrom: "customer_id" })} />}</div>
                {!vehicles.length && <div className="small muted">{e.customer_id ? "This customer has no car yet: add it with + New car." : "Pick or add the customer first, then add the car."}</div>}</div>
              <div className="row">
                <div className="field"><label>Odometer (km){e.last_odometer ? `, last ${Number(e.last_odometer).toLocaleString()}` : ""}</label><input name="odometer_in" inputMode="numeric" defaultValue={e.odometer_in ?? ""} /></div>
                <div className="field"><label>Fuel (0 to 8)</label><input name="fuel_level" type="number" min={0} max={8} defaultValue={e.fuel_level ?? ""} /></div>
              </div>
              <div className="row">
                <div className="field"><label>Customer complaints</label><ComplaintPicker list={complaints} defaultValue={e.complaints ?? ""} /></div>
                <div className="field"><label>Valuables</label><textarea name="valuables" defaultValue={e.valuables ?? ""} /></div>
              </div>
              <button className="btn green">Save</button>
            </form>
            </Popup></div>}
          </div>
          <p className="small">Asked about: <b>{e.service_asked}</b> · source {label(e.source)} · advisor {e.assigned_name ?? "—"} · follow up {dt(e.follow_up_at) || "—"}</p>
          <div className="small">Customer <b>{e.customer_id ? custName(e) : <span className="muted">not picked yet</span>}</b> · car <b>{car ? `${plate(car)} · ${car.make} ${car.model}` : <span className="muted">not picked yet</span>}</b></div>
          <div className="small">Odometer <b>{e.odometer_in?.toLocaleString() ?? "—"} km</b> · fuel <b>{e.fuel_level ?? "—"}/8</b> · <b>Complaints:</b> {e.complaints || "—"}{e.valuables ? <> · <b>Valuables:</b> {e.valuables}</> : null}</div>
        </div>

      {showBooking && (
        <details className="card fold" open={!!e.booking_status || (e.source === "recovery" && !runs.length)}><summary><h2>Booking, pickup and drop-off{e.booking_status ? <> · <Status s={e.booking_status} /></> : runs.length ? ` · ${runs.length} run${runs.length > 1 ? "s" : ""}` : ""}</h2></summary>
        <div className="grid2">
        {showBooking && <BookingCard enquiryId={id} branchId={b} back={back} bays={bk.bays} techs={bk.techs} policy={bk.policy} canEdit={canEditEnq}
          action={bookAction} closeAction={closeBookingAction} defaultHours={String(labourHours || "")}
          booking={{ status: e.booking_status, when: e.booked_for_local, bayId: e.booking_bay_id, techId: e.booking_technician_id, hours: e.booking_hours,
            bayCode: e.booking_bay_code, techName: e.booking_technician_name, reason: e.booking_override_reason }} />}
        <div className="card" id="runs"><h2>Pickup, drop-off and recovery</h2>
          <RunsTable rows={runs} back={`${back}#runs`} canEdit={runEdit} prices={canSeePrices} showRef={false} />
          {runEdit && open && (
            <div className="popbtns"><Popup id="schedule-run" wide title="Schedule a pickup, drop-off or recovery" label="Schedule a run" className="btn sm ghost">
              <RunForm back={`${back}#runs`} drivers={drivers} enquiryId={id} canCharge={canSee(ctx, "selling_price", b)}
                chargeTarget={e.customer_id && e.vehicle_id ? "quotation" : null} defaults={{ to: e.branch_name }} /></Popup></div>
          )}
        </div>
      </div>
        </details>
      )}
      {e.customer_id && e.vehicle_id && (
        <>
          {canQuote && open && suggested.length > 0 && (
            <form action={addSuggestedAction} className="callout info">
              <input type="hidden" name="enquiry_id" value={id} /><input type="hidden" name="$back" value={back} />
              <div style={{ flex: 1 }}><b>Suggested from the complaints:</b>{" "}
                {suggested.map((s) => <label key={s.id} className="shrink" style={{ marginRight: 12, whiteSpace: "nowrap" }}><input type="checkbox" name="service_id" value={s.id} defaultChecked /> {s.name}</label>)}</div>
              <button className="btn sm">Add to quotation</button>
            </form>
          )}
          <WorkLines quick={quick} owner={{ kind: "enquiry", id }} back={back} lines={lines} m={m} canEdit={canQuote} canSeePrices={canSeePrices}
            discountEdit={fieldLevel(ctx, "discount", b) === "edit"} priceEdit={fieldLevel(ctx, "selling_price", b) === "edit"} open={open} />
          <QuotationPanel enquiryId={id} back={back} origin={origin} quotations={quotations} quotationLines={quotationLines} lines={lines}
            canEdit={canQuote && open} canSeePrices={canSeePrices} discountEdit={fieldLevel(ctx, "discount", b) === "edit"} open={open} isJob={false} />
        </>
      )}

      <div className="grid2">
        <details className="card history no-print"><summary><h2>Approval history <span className="small muted">({approvals.length})</span></h2></summary>
          <table><tbody>{approvals.map((a) => <tr key={a.id}><td>{label(a.action)}</td><td>{a.step_name ?? ""}</td><td>{a.full_name}</td><td className="small muted">{dt(a.at)}</td><td className="small">{a.comment}</td></tr>)}</tbody></table>
          {!approvals.length && <p className="muted small">None.</p>}
        </details>
        <details className="card fold"><summary><h2>Customer messages <span className="small muted">({msgs.length})</span></h2></summary>
          {e.customer_id && e.vehicle_id && canEditEnq && (
            <form action={whatsappAction}><input type="hidden" name="enquiry_id" value={id} /><input type="hidden" name="$back" value={back} />
              <div className="row"><div className="field"><label>Message</label><select name="event"><option value="enquiry_reply">Reply to enquiry</option></select></div><button className="btn wa sm shrink">Prepare WhatsApp</button></div></form>
          )}
          <table><tbody>{msgs.map((x) => <tr key={x.id}><td>{x.event.replace(/_/g, " ")}</td><td><Status s={x.status} /></td><td className="small">{x.full_name}</td><td className="small muted">{dt(x.at)}</td></tr>)}</tbody></table>
          {!msgs.length && <p className="muted small">None yet. Messages are prepared here and sent by you; nothing is sent automatically.</p>}
        </details>
      </div>
      <RecordHistory rows={await docHistory(ctx, "enquiry", id)} />
    </>
  );
}
