import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { getJob, nextStatuses, STATUS_LABEL } from "@/lib/services/jobs";
import { masters } from "@/lib/services/masters";
import { can, fieldLevel } from "@/lib/access";
import { statusAction, whatsappAction } from "@/app/actions";
import { WorkLines, QuotationPanel } from "@/components/WorkPanel";
import { ManualMessage } from "@/components/ManualMessage";
import { messagesFor } from "@/lib/services/messaging";
import { Flash, Link, Money, PageHead, Status, custName, plate, dt } from "@/components/ui";

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { job, lines, quotations, quotationLines, statusHistory, invoices, approvals, canSeePrices } = await getJob(ctx, id);
  const m = await masters(ctx);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const b = job.branch_id;
  const canEdit = can(ctx, "jobs", "edit", b);
  const canIssue = can(ctx, "stock", "edit", b);
  const discountEdit = fieldLevel(ctx, "discount", b) === "edit";
  const back = `/jobs/${id}`;
  const open = !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
  const msgs = canEdit ? await messagesFor(ctx, { jobId: id }) : [];
  const late = job.promised_at && new Date(job.promised_at) < new Date() && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
  const manual = nextStatuses(job.status).filter((s) => !["approved", "invoiced", "cancelled", "closed"].includes(s));
  const delayReasons = m.lookups.filter((l) => l.list === "delay_reason");
  return (
    <>
      <PageHead title={`Job card ${job.doc_no}`} sub={`${plate(job)} · ${job.make} ${job.model} ${job.model_year ?? ""} · ${custName(job)} · ${job.mobile} · ${job.branch_name}`}>
        <Status s={job.status} />{late && <span className="pill red">Late</span>}
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
        </div>
        <div className="card"><h2>Move job</h2>
          {canEdit && manual.length > 0 ? (
            <form action={statusAction}>
              <input type="hidden" name="job_id" value={id} /><input type="hidden" name="version" value={job.version} />
              {late && <div className="field"><label>Delay reason (required, DL-02)</label><select name="delay_reason">{delayReasons.map((r) => <option key={r.code}>{r.name_en}</option>)}</select><input name="delay_note" placeholder="Note" style={{ marginTop: 6 }} /></div>}
              <div className="row">{manual.map((s) => <button key={s} name="to" value={s} className="btn sm shrink">{STATUS_LABEL[s]}</button>)}</div>
            </form>
          ) : <p className="muted small">Status moves automatically from here (quotation answer, invoice, payment).</p>}
          {can(ctx, "jobs", "cancel", b) && nextStatuses(job.status).includes("cancelled") && (
            <form action={statusAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="job_id" value={id} /><input type="hidden" name="to" value="cancelled" />
              <div className="row"><input name="reason" placeholder="Reason for cancelling" required /><button className="btn red sm shrink">Cancel job</button></div>
            </form>
          )}
        </div>
        <div className="card"><h2>Customer messages</h2>
          {canEdit && <form action={whatsappAction}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="$back" value={back} />
            <div className="row"><select name="event"><option value="approved">Work approved</option><option value="car_ready">Car ready</option></select><button className="btn wa sm shrink">Prepare WhatsApp</button></div></form>}
          {msgs.slice(0, 4).map((x) => <div key={x.id} className="small">{x.event.replace(/_/g, " ")} <Status s={x.status} /> <span className="muted">{dt(x.at)}</span></div>)}
          {canSeePrices && ["ready", "delivered"].includes(job.status) && can(ctx, "invoices", "create", b) && <p><Link className="btn green" href={`/jobs/${id}/invoice`}>Prepare tax invoice</Link></p>}
          {invoices.map((i) => <div key={i.id} className="small">Invoice <Link href={`/invoices/${i.id}`}>{i.doc_no}</Link> · <Money v={i.grand_total} /> · paid <Money v={i.paid_amount} /></div>)}
        </div>
      </div>

      <WorkLines owner={{ kind: "job", id }} back={back} lines={lines} m={m} canEdit={canEdit} canSeePrices={canSeePrices} canIssue={canIssue}
        discountEdit={discountEdit} priceEdit={fieldLevel(ctx, "selling_price", b) === "edit"} open={open} />
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
    </>
  );
}
