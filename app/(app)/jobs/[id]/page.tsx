import { RecordHistory } from "@/components/RecordHistory";
import { RunForm, RunsTable } from "@/components/RunsPanel";
import { runOptions, runsFor, canEditRuns } from "@/lib/services/runs";
import { docHistory } from "@/lib/services/history";
import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { getJob, nextStatuses, STATUS_LABEL } from "@/lib/services/jobs";
import { masters } from "@/lib/services/masters";
import { can, fieldLevel } from "@/lib/access";
import { statusAction, whatsappAction, newTimeAction, checkinAction, checkinPhotoAction } from "@/app/actions";
import { checkinPhotos } from "@/lib/services/jobs";
import { askFeedbackAction } from "@/app/actions-front";
import { CarDamage } from "@/components/CarDamage";
import { SignaturePad } from "@/components/SignaturePad";
import { PHOTO_LABELS } from "@/lib/checkin";
import { WorkLines, QuotationPanel } from "@/components/WorkPanel";
import { listBundles, rankForVehicle } from "@/lib/services/bundles";
import { ManualMessage } from "@/components/ManualMessage";
import { messagesFor } from "@/lib/services/messaging";
import { ConfirmButton } from "@/components/ConfirmButton";
import { WorkshopPanel } from "@/components/WorkshopPanel";
import { Flash, Link, Money, PageHead, Status, custName, plate, dt } from "@/components/ui";

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { job, lines, quotations, quotationLines, statusHistory, invoices, invoicedLineIds, warranty, approvals, canSeePrices } = await getJob(ctx, id);
  const invoicedLines = new Set(invoicedLineIds);
  const [m0, bundles, photos] = await Promise.all([masters(ctx), listBundles(ctx), checkinPhotos(ctx, id)]);
  const m = { ...m0, bundles: rankForVehicle(bundles, job) };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const b = job.branch_id;
  const canEdit = can(ctx, "jobs", "edit", b);
  const canIssue = can(ctx, "stock", "edit", b);
  const discountEdit = fieldLevel(ctx, "discount", b) === "edit";
  const back = `/jobs/${id}`;
  const unbilled = lines.filter((l) => !l.removed && l.approval_status === "approved" && !l.warranty_claim_id && !invoicedLines.has(l.id)).length;
  const open = !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
  const msgs = canEdit ? await messagesFor(ctx, { jobId: id }) : [];
  const late = job.promised_at && new Date(job.promised_at) < new Date() && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
  const manual = nextStatuses(job.status).filter((s) => !["approved", "ready", "delivered", "invoiced", "cancelled", "closed"].includes(s));
  const delayReasons = m.lookups.filter((l) => l.list === "delay_reason");
  return (
    <>
      <PageHead title={`Job card ${job.doc_no}`} sub={`${plate(job)} · ${job.make} ${job.model} ${job.model_year ?? ""} · ${custName(job)} · ${job.mobile} · ${job.branch_name}`}>
        <Status s={job.status} />{late && <span className="pill red">Late</span>}
        <Link className="btn ghost sm" href={`/vehicles/${job.vehicle_id}`}>Vehicle page</Link>
      </PageHead>
      <Flash sp={sp} />
      <ManualMessage ctx={ctx} id={sp.msg} back={`${back}?msg=${sp.msg ?? ""}`} />
      <p className="small muted">Created from enquiry <Link href={`/enquiries/${job.enquiry_id}`}>{job.enquiry_no}</Link> after the customer approved the quotation.</p>

      <div className="grid3">
        <div className="card"><h2>Check-in</h2>
          <div className="small">Odometer <b>{job.odometer_in?.toLocaleString() ?? "—"} km</b> · fuel <b>{job.fuel_level ?? "—"}/8</b></div>
          <div className="small">Promised <b>{dt(job.promised_at) || "—"}</b> · advisor {job.advisor_name}</div>
          {job.lpo_no && <div className="small">LPO {job.lpo_no}</div>}
          <p className="small"><b>Complaints:</b> {job.complaints || "—"}</p>
          {job.delay_reason && <p className="small"><b>Delay reason:</b> {job.delay_reason} {job.delay_note}</p>}
          {canEdit && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status) && (
            <details id="newtime" className="newtime" open={late}>
              <summary className={late ? "red-text" : ""}>{late ? "Running late: send the customer a new time" : "Change the promised time"}</summary>
              <form action={newTimeAction}>
                <input type="hidden" name="job_id" value={id} /><input type="hidden" name="$back" value={back} />
                <div className="field"><label>New promised time</label><input type="datetime-local" name="promised_at" required /></div>
                <div className="field"><label>Delay reason</label><select name="delay_reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{delayReasons.map((r) => <option key={r.code}>{r.name_en}</option>)}</select></div>
                <div className="field"><label>Note (not sent)</label><input name="delay_note" /></div>
                <button className="btn wa sm">Send new time</button>
              </form>
            </details>
          )}
        </div>
        <div className="card"><h2>Move job</h2>
          {canEdit && manual.length > 0 ? (
            <form action={statusAction}>
              <input type="hidden" name="job_id" value={id} /><input type="hidden" name="version" value={job.version} />
              {late && <div className="field"><label>Delay reason (required)</label><select name="delay_reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{delayReasons.map((r) => <option key={r.code}>{r.name_en}</option>)}</select><input name="delay_note" placeholder="Note" style={{ marginTop: 6 }} /></div>}
              <div className="row">{manual.map((s) => <button key={s} name="to" value={s} className="btn sm shrink">{STATUS_LABEL[s]}</button>)}</div>
            </form>
          ) : <p className="muted small">Status moves automatically from here (quality check, delivery, invoice, payment).</p>}
          {can(ctx, "jobs", "cancel", b) && nextStatuses(job.status).includes("cancelled") && (
            <form action={statusAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="job_id" value={id} /><input type="hidden" name="to" value="cancelled" />
              <div className="row"><div className="field"><label>Reason for cancelling</label><input name="reason" required /></div><ConfirmButton className="btn red sm shrink" message="Cancel this job card? Committed parts are released.">Cancel job</ConfirmButton></div>
            </form>
          )}
        </div>
        <div className="card"><h2>Customer messages</h2>
          {canEdit && <form action={whatsappAction}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="$back" value={back} />
            <div className="row"><div className="field"><label>Message</label><select name="event"><option value="approved">Work approved</option><option value="car_ready">Car ready</option></select></div><button className="btn wa sm shrink">Prepare WhatsApp</button></div></form>}
          {canEdit && ["delivered", "invoiced", "closed"].includes(job.status) && <form action={askFeedbackAction} style={{ marginTop: 8 }}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="$origin" value={origin} /><button className="btn ghost sm">Ask for a rating</button></form>}
          {msgs.slice(0, 4).map((x) => <div key={x.id} className="small">{x.event.replace(/_/g, " ")} <Status s={x.status} /> <span className="muted">{dt(x.at)}</span></div>)}
          {canSeePrices && ["ready", "delivered", "invoiced"].includes(job.status) && can(ctx, "invoices", "create", b) && unbilled > 0 && <p><Link className="btn green" href={`/jobs/${id}/invoice`}>{job.status === "invoiced" ? "Invoice the rest" : "Prepare invoice"}</Link></p>}
          {!["closed", "cancelled"].includes(job.status) && can(ctx, "invoices", "create", b) && <p><Link className="btn ghost sm" href={`/billing/advances?job=${id}`}>Take deposit</Link></p>}
          {invoices.map((i) => <div key={i.id} className="small">Invoice <Link href={`/invoices/${i.id}`}>{i.doc_no}</Link> · {i.bill_to_name} · <Money v={i.grand_total} /> · paid <Money v={i.paid_amount} />{Number(i.credited_amount) > 0 && <> · credited <Money v={i.credited_amount} /></>}</div>)}
          {warranty.map((w) => <div key={w.id} className="small">Warranty claim {w.doc_no}{w.claim_ref ? ` · ${w.claim_ref}` : ""}</div>)}
        </div>
      </div>

      <div className="card" id="checkin">
        <h2>Check-in record</h2>
        <div className="checkin-grid">
          <div>
            <h3>Damage on arrival</h3>
            {canEdit && !["closed", "cancelled"].includes(job.status) ? (
              <form action={checkinAction}>
                <input type="hidden" name="job_id" value={id} />
                <CarDamage initial={job.damage_marks ?? []} />
                {!job.checkin_signature && <>
                  <h3>Customer&apos;s signature</h3>
                  <p className="small muted">The customer agrees the car&apos;s condition, the complaints and the valuables listed.</p>
                  <div className="field"><label>Signed by</label><input name="signed_name" defaultValue={custName(job)} /></div>
                  <SignaturePad />
                </>}
                <button className="btn sm" style={{ marginTop: 10 }}>Save check-in</button>
              </form>
            ) : <CarDamage initial={job.damage_marks ?? []} readOnly />}
            {job.checkin_signature && <div className="sigshow"><div className="small muted">Signed by <b>{job.checkin_signed_name}</b> · {dt(job.checkin_signed_at)}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}<img src={job.checkin_signature} alt={`Signature of ${job.checkin_signed_name ?? "the customer"}`} /></div>}
          </div>
          <div>
            <h3>Photos ({photos.length})</h3>
            <div className="photos">
              {photos.map((p) => <a key={p.id} href={`/api/attachments/${p.id}`} target="_blank" rel="noreferrer" className="photo">{p.mime.startsWith("image/") && p.mime !== "image/heic" ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/attachments/${p.id}`} alt={p.file_name} loading="lazy" /></> : <span>PDF</span>}<span className="plabel">{p.file_name.replace(/\.[a-z0-9]+$/i, "")}</span></a>)}
              {!photos.length && <p className="muted small">No photos yet.</p>}
            </div>
            {canEdit && !["closed", "cancelled"].includes(job.status) && (
              <form action={checkinPhotoAction} className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
                <input type="hidden" name="job_id" value={id} />
                <div className="field"><label>What it shows</label><select name="label">{PHOTO_LABELS.map((l) => <option key={l}>{l}</option>)}</select></div>
                <div className="field"><label>Photo</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" required /></div>
                <button className="btn sm shrink">Add photo</button>
              </form>
            )}
            <p className="small muted">JPG, PNG or HEIC, up to 5 MB each, at most 12 per job card.</p>
          </div>
        </div>
      </div>

      <WorkLines owner={{ kind: "job", id }} back={back} lines={lines} m={m} canEdit={canEdit} canSeePrices={canSeePrices} canIssue={canIssue}
        discountEdit={discountEdit} priceEdit={fieldLevel(ctx, "selling_price", b) === "edit"} open={open} />
      <div id="parts"><WorkshopPanel ctx={ctx} job={job} lines={lines} m={m} back={back} /></div>
      <QuotationPanel enquiryId={job.enquiry_id} back={back} origin={origin} quotations={quotations} quotationLines={quotationLines} lines={lines}
        canEdit={canEdit && open} canSeePrices={canSeePrices} discountEdit={discountEdit} open={open} isJob />

      <div className="grid2">
        <div className="card"><h2>Approval history</h2>
          <table><tbody>{approvals.map((a) => <tr key={a.id}><td>{a.action.replace("_", " ")}</td><td>{a.step_name ?? ""}</td><td>{a.full_name}</td><td className="small muted">{dt(a.at)}</td><td className="small">{a.comment}</td></tr>)}</tbody></table>
          {!approvals.length && <p className="muted small">None.</p>}
        </div>
        <div className="card"><h2>Status history</h2>
          <table><tbody>{statusHistory.map((s) => <tr key={s.id}><td><Status s={s.to_status} /></td><td className="small">{s.reason}</td><td className="small">{s.full_name ?? "system / customer"}</td><td className="small muted">{dt(s.at)}</td></tr>)}</tbody></table>
        </div>
      </div>
      {await (async () => {
        const runs = await runsFor(ctx, { jobId: id, enquiryOfJob: job.enquiry_id });
        const runEdit = canEditRuns(ctx, job.branch_id);
        const closed = ["invoiced", "closed", "cancelled"].includes(job.status);
        if (!runs.length && (!runEdit || closed)) return null;
        const drivers = runEdit ? (await runOptions(ctx, job.branch_id)).drivers : [];
        const jb = `/jobs/${id}#runs`;
        return (
          <div className="card" id="runs"><h2>Pickup, drop-off and recovery</h2>
            <RunsTable rows={runs} back={jb} canEdit={runEdit} prices={canSeePrices} showRef={false} />
            {runEdit && !closed && (
              <details style={{ marginTop: 10 }}><summary className="btn sm ghost">Schedule a run</summary>
                <RunForm back={jb} drivers={drivers} jobId={id} canCharge={canSeePrices} defaults={{ type: "drop_off", from: job.branch_name ?? "" }}
                  chargeTarget={["approved", "awaiting_parts", "in_progress", "quality_check"].includes(job.status) ? "job" : null} /></details>
            )}
          </div>
        );
      })()}
      <RecordHistory rows={await docHistory(ctx, "job_card", id)} />
    </>
  );
}
