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
import { D } from "@/lib/money";
import { withTx } from "@/lib/db";
import { Popup } from "@/components/Popup";
import { quickSpec } from "@/lib/services/quick-add";

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
  // Approved labour lines nobody is assigned to yet: assigning them is the first step on a new job.
  const unassignedIds: string[] = ["approved", "awaiting_parts"].includes(job.status) ? await withTx(ctx, async (c) => (await c.query(
    `SELECT l.id FROM job_line l WHERE l.job_card_id = $1 AND NOT l.removed AND l.approval_status = 'approved' AND l.line_type IN ('labour','outside')
        AND l.technician_id IS NULL AND NOT EXISTS (SELECT 1 FROM job_assignment a WHERE a.job_line_id = l.id) ORDER BY l.line_no`, [id])).rows.map((r) => r.id)) : [];
  const unassigned = unassignedIds.length;
  const quick = { items: await quickSpec(ctx, "items"), services: await quickSpec(ctx, "services") };
  const canAssignTech = can(ctx, "workshop", "edit", b) || canEdit;
  // Other finished job cards of the same customer at this branch: they can go on one combined invoice.
  const otherJobs = ["ready", "delivered", "invoiced"].includes(job.status) && unbilled > 0 && can(ctx, "invoices", "create", b)
    ? await withTx(ctx, async (c) => Number((await c.query(
      `SELECT count(*) n FROM job_card j WHERE j.customer_id = $1 AND j.branch_id = $2 AND j.id <> $3 AND j.status IN ('ready','delivered','invoiced')
          AND EXISTS (SELECT 1 FROM job_line l WHERE l.job_card_id = j.id AND NOT l.removed AND l.approval_status = 'approved' AND l.warranty_claim_id IS NULL
                        AND NOT EXISTS (SELECT 1 FROM sales_invoice_line sil WHERE sil.job_line_id = l.id))`, [job.customer_id, b, id])).rows[0].n)) : 0;
  return (
    <>
      <PageHead title={`Job card ${job.doc_no}`} sub={`${plate(job)} · ${job.make} ${job.model} ${job.model_year ?? ""} · ${custName(job)} · ${job.mobile} · ${job.branch_name}`}>
        <Status s={job.status} />{late && <span className="pill red">Late</span>}
        <Link className="btn ghost sm" href={`/vehicles/${job.vehicle_id}`}>Vehicle page</Link>
      </PageHead>
      <Flash sp={sp} />
      <ManualMessage ctx={ctx} id={sp.msg} back={`${back}?msg=${sp.msg ?? ""}`} />
      <p className="small muted">Created from enquiry <Link href={`/enquiries/${job.enquiry_id}`}>{job.enquiry_no}</Link> after the customer approved the quotation.</p>

      {(() => {
        // One clear next step for the stage the job is at; everything else stays below or under "More".
        const openInv = invoices.find((i) => D(i.paid_amount).plus(i.credited_amount).lt(i.grand_total));
        const canInvoice = canSeePrices && can(ctx, "invoices", "create", b);
        const delivered = !!job.delivered_at;
        const rank = ({ approved: 0, awaiting_parts: 0, in_progress: 1, quality_check: 2, ready: 3, delivered: 3, invoiced: 3, closed: 9 } as Record<string, number>)[job.status] ?? -1;
        const steps: [string, boolean][] = [
          ["Approved", rank >= 0], ["Work", rank >= 2], ["Quality check", rank >= 3], ["Ready", rank >= 3],
          ["Invoiced", invoices.length > 0 && unbilled === 0], ["Paid", invoices.length > 0 && !openInv], ["Handed over", delivered],
        ];
        const current = steps.findIndex(([, done]) => !done);
        let title = "", hint = "", primary: React.ReactNode = null, primaryTo = "";
        const go = (href: string, text: string) => <Link className="btn green" href={href}>{text}</Link>;
        if (job.status === "cancelled") { title = "This job was cancelled"; }
        else if (job.status === "closed") { title = "Job finished"; hint = "Paid and handed over. Nothing left to do."; }
        else if ((job.status === "approved" || job.status === "awaiting_parts") && unassigned > 0 && canAssignTech) {
          title = "Assign technicians"; hint = `${unassigned} work line${unassigned > 1 ? "s have" : " has"} no technician yet. Choose who does each job, then start the work.`;
          primary = <a className="btn green" href={`#assign-${unassignedIds[0]}`}>Assign technicians</a>;
        } else if (job.status === "approved" || job.status === "awaiting_parts") {
          title = job.status === "awaiting_parts" ? "Waiting for parts" : "Start the work";
          hint = job.status === "awaiting_parts" ? "Start once the parts arrive. Part requests are under Workshop below." : "Technicians are assigned. Start the job when the car is in the bay.";
          primaryTo = "in_progress";
        } else if (job.status === "in_progress") {
          const toIssue = lines.filter((l) => !l.removed && l.approval_status === "approved" && ["part", "consumable"].includes(l.line_type) && D(l.issued_qty).lt(l.qty));
          if (toIssue.length) { title = "Issue the parts"; hint = `The store still has to issue ${toIssue.map((l) => l.description).join(", ")}. Then send the job to quality check.`; primary = go("#lines", "See the parts"); }
          else { title = "Send to quality check"; hint = "When the technicians have finished all the work."; primaryTo = "quality_check"; }
        }
        else if (job.status === "quality_check") {
          title = "Record the quality check"; hint = "A pass makes the car Ready.";
          if (can(ctx, "workshop", "edit", b)) primary = <a className="btn green" href="#qc-form">Record the quality check</a>; else hint = "Waiting for the supervisor's quality check.";
        } else if (unbilled > 0) {
          title = job.status === "invoiced" ? "Invoice the rest" : "Prepare the invoice"; hint = "Check the lines, change them if needed, then post.";
          if (canInvoice) primary = <>{go(`/jobs/${id}/invoice`, title)}{otherJobs > 0 && <> <Link className="btn ghost" href={`/invoices/combined?customer=${job.customer_id}`}>One invoice with {otherJobs} other car{otherJobs > 1 ? "s" : ""}</Link></>}</>;
          else hint = "Waiting for someone who can invoice.";
          if (canInvoice && otherJobs > 0) hint += ` This customer has ${otherJobs} other finished job card${otherJobs > 1 ? "s" : ""} waiting: you can bill them together on one invoice.`;
        } else if (openInv) {
          title = "Take payment"; hint = `Invoice ${openInv.doc_no} still has money owing.`;
          if (canInvoice) primary = go(`/invoices/${openInv.id}`, "Take payment");
        } else if (!delivered) { title = "Hand the car over"; hint = "Fill in the delivery checklist below."; if (canEdit) primary = go("#delivery", "Open delivery"); }
        else { title = "Waiting to close"; hint = "The job closes by itself once every invoice is paid."; }
        const others = canEdit ? manual.filter((s) => s !== primaryTo) : [];
        const canCancel = can(ctx, "jobs", "cancel", b) && nextStatuses(job.status).includes("cancelled");
        return (
          <div className="card nextstep" id="move">
            <div className="steps" aria-label="Job stages">{steps.map(([n, done], k) => <span key={n} className={done ? "done" : k === current ? "on" : ""}>{done ? "✓ " : ""}{n}</span>)}</div>
            <div className="nextrow">
              <div><div className="small muted">Next step</div><h2 style={{ margin: "2px 0" }}>{title}</h2>{hint && <div className="small muted">{hint}</div>}</div>
              <div className="shrink">
                {primaryTo && canEdit ? (
                  <form action={statusAction} className="row" style={{ alignItems: "flex-end" }}>
                    <input type="hidden" name="job_id" value={id} /><input type="hidden" name="version" value={job.version} />
                    {late && !job.delay_reason && <div className="field"><label>Delay reason (job is late)</label><select name="delay_reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{delayReasons.map((r) => <option key={r.code}>{r.name_en}</option>)}</select></div>}
                    <button name="to" value={primaryTo} className="btn green shrink">{STATUS_LABEL[primaryTo] === "In progress" ? "Start work" : "Send to quality check"}</button>
                  </form>
                ) : primary}
              </div>
            </div>
            {(others.length > 0 || canCancel) && (
              <details className="more"><summary className="small">More: other moves{canCancel ? " or cancel" : ""}</summary>
                {others.length > 0 && <form action={statusAction} className="row" style={{ marginTop: 8 }}>
                  <input type="hidden" name="job_id" value={id} /><input type="hidden" name="version" value={job.version} />
                  {late && !job.delay_reason && <div className="field"><label>Delay reason</label><select name="delay_reason" required defaultValue=""><option value="" disabled>Choose</option>{delayReasons.map((r) => <option key={r.code}>{r.name_en}</option>)}</select></div>}
                  {others.map((s) => <button key={s} name="to" value={s} className="btn ghost sm shrink">Move to {STATUS_LABEL[s]}</button>)}
                </form>}
                {canCancel && <div style={{ marginTop: 10 }}><Popup id="cancel-job" title="Cancel this job card" label="Cancel job" className="btn ghost sm red-text">
                  <form action={statusAction}>
                    <input type="hidden" name="job_id" value={id} /><input type="hidden" name="to" value="cancelled" />
                    <p className="small muted">Committed parts are released back to stock. This cannot be undone.</p>
                    <div className="field"><label>Reason for cancelling</label><input name="reason" required /></div>
                    <ConfirmButton className="btn red" message="Cancel this job card? Committed parts are released.">Cancel the job</ConfirmButton>
                  </form>
                </Popup></div>}
              </details>
            )}
          </div>
        );
      })()}

      <div className="grid2">
        <div className="card"><h2>Check-in</h2>
          <div className="small">Odometer <b>{job.odometer_in?.toLocaleString() ?? "—"} km</b> · fuel <b>{job.fuel_level ?? "—"}/8</b></div>
          <div className="small">Promised <b>{dt(job.promised_at) || "—"}</b> · advisor {job.advisor_name}</div>
          {job.lpo_no && <div className="small">LPO {job.lpo_no}</div>}
          <p className="small"><b>Complaints:</b> {job.complaints || "—"}</p>
          {job.delay_reason && <p className="small"><b>Delay reason:</b> {job.delay_reason} {job.delay_note}</p>}
          {canEdit && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status) && (
            <div className="popbtns"><Popup id="newtime" title={late ? "Running late: send the customer a new time" : "Change the promised time"} label={late ? "Running late: send a new time" : "Change the promised time"} className={late ? "btn amber sm" : "btn ghost sm"}>
              <form action={newTimeAction}>
                <input type="hidden" name="job_id" value={id} /><input type="hidden" name="$back" value={back} />
                <div className="field"><label>New promised time</label><input type="datetime-local" name="promised_at" required /></div>
                <div className="field"><label>Delay reason</label><select name="delay_reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{delayReasons.map((r) => <option key={r.code}>{r.name_en}</option>)}</select></div>
                <div className="field"><label>Note (not sent)</label><input name="delay_note" /></div>
                <button className="btn wa">Send new time</button>
              </form>
            </Popup></div>
          )}
        </div>
        <div className="card"><h2>Customer and invoices</h2>
          {invoices.map((i) => <div key={i.id} className="small">Invoice <Link href={`/invoices/${i.id}`}>{i.doc_no}</Link> · {i.bill_to_name} · <Money v={i.grand_total} /> · paid <Money v={i.paid_amount} />{Number(i.credited_amount) > 0 && <> · credited <Money v={i.credited_amount} /></>}</div>)}
          {warranty.map((w) => <div key={w.id} className="small">Warranty claim {w.doc_no}{w.claim_ref ? ` · ${w.claim_ref}` : ""}</div>)}
          {!invoices.length && !warranty.length && <p className="small muted">No invoice yet.</p>}
          {msgs.slice(0, 3).map((x) => <div key={x.id} className="small">{x.event.replace(/_/g, " ")} <Status s={x.status} /> <span className="muted">{dt(x.at)}</span></div>)}
          {canEdit && <details className="more" style={{ marginTop: 8 }}><summary className="small">Message the customer, ask for a rating or take a deposit</summary>
            <form action={whatsappAction} style={{ marginTop: 8 }}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="$back" value={back} />
              <div className="row"><div className="field"><label>Message</label><select name="event"><option value="approved">Work approved</option><option value="car_ready">Car ready</option></select></div><button className="btn wa sm shrink">Prepare WhatsApp</button></div></form>
            {["delivered", "invoiced", "closed"].includes(job.status) && <form action={askFeedbackAction} style={{ marginTop: 8 }}><input type="hidden" name="job_id" value={id} /><button className="btn ghost sm">Ask for a rating</button></form>}
            {!["closed", "cancelled"].includes(job.status) && can(ctx, "invoices", "create", b) && <p><Link className="btn ghost sm" href={`/billing/advances?job=${id}`}>Take deposit</Link></p>}
          </details>}
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

      <WorkLines quick={quick} owner={{ kind: "job", id }} back={back} lines={lines} m={m} canEdit={canEdit} canSeePrices={canSeePrices} canIssue={canIssue}
        discountEdit={discountEdit} priceEdit={fieldLevel(ctx, "selling_price", b) === "edit"} open={open} />
      <div id="parts"><WorkshopPanel ctx={ctx} job={job} lines={lines} m={m} back={back} quick={quick} /></div>
      <QuotationPanel enquiryId={job.enquiry_id} back={back} origin={origin} quotations={quotations} quotationLines={quotationLines} lines={lines}
        canEdit={canEdit && open} canSeePrices={canSeePrices} discountEdit={discountEdit} open={open} isJob />

      <details className="card history no-print"><summary><h2>Approval and status history <span className="small muted">({approvals.length + statusHistory.length})</span></h2></summary>
        <div className="grid2">
          <div><h3>Approvals</h3>
            <table><tbody>{approvals.map((a) => <tr key={a.id}><td>{a.action.replace("_", " ")}</td><td>{a.step_name ?? ""}</td><td>{a.full_name}</td><td className="small muted">{dt(a.at)}</td><td className="small">{a.comment}</td></tr>)}</tbody></table>
            {!approvals.length && <p className="muted small">None.</p>}
          </div>
          <div><h3>Status changes</h3>
            <table><tbody>{statusHistory.map((s) => <tr key={s.id}><td><Status s={s.to_status} /></td><td className="small">{s.reason}</td><td className="small">{s.full_name ?? "system / customer"}</td><td className="small muted">{dt(s.at)}</td></tr>)}</tbody></table>
          </div>
        </div>
      </details>
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
              <div className="popbtns"><Popup id="schedule-run" wide title="Schedule a pickup, drop-off or recovery" label="Schedule a run" className="btn sm ghost">
                <RunForm back={jb} drivers={drivers} jobId={id} canCharge={canSeePrices} defaults={{ type: "drop_off", from: job.branch_name ?? "" }}
                  chargeTarget={["approved", "awaiting_parts", "in_progress", "quality_check"].includes(job.status) ? "job" : null} /></Popup></div>
            )}
          </div>
        );
      })()}
      <RecordHistory rows={await docHistory(ctx, "job_card", id)} />
    </>
  );
}
