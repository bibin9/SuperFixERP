import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { getJob, nextStatuses, STATUS_LABEL } from "@/lib/services/jobs";
import { masters } from "@/lib/services/masters";
import { can, fieldLevel } from "@/lib/access";
import {
  addLineAction, removeLineAction, assignTechAction, statusAction, saveQuotationAction, sendQuotationAction,
  staffDecisionAction, issueAction, whatsappAction,
} from "@/app/actions";
import { Flash, Link, Money, PageHead, Status, custName, plate, dt } from "@/components/ui";
import { D } from "@/lib/money";

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
  const q = quotations[0];
  const late = job.promised_at && new Date(job.promised_at) < new Date() && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
  const manual = nextStatuses(job.status).filter((s) => !["approved", "invoiced", "cancelled", "closed"].includes(s));
  const delayReasons = m.lookups.filter((l) => l.list === "delay_reason");
  return (
    <>
      <PageHead title={`Job card ${job.doc_no}`} sub={`${plate(job)} · ${job.make} ${job.model} ${job.model_year ?? ""} · ${custName(job)} · ${job.mobile} · ${job.branch_name}`}>
        <Status s={job.status} />{late && <span className="pill red">Late</span>}
      </PageHead>
      <Flash sp={sp} />
      {sp.wa && <div className="flash ok">WhatsApp message ready. <a className="btn wa sm" href={sp.wa} target="_blank" rel="noreferrer">Open WhatsApp</a> <span className="small muted">Manual mode: delivery cannot be confirmed (WA-02).</span></div>}

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
          {canEdit && <form action={whatsappAction}><input type="hidden" name="job_id" value={id} />
            <div className="row"><select name="event"><option value="approved">Work approved</option><option value="car_ready">Car ready</option></select><button className="btn wa sm shrink">WhatsApp</button></div></form>}
          {canSeePrices && ["ready", "delivered"].includes(job.status) && can(ctx, "invoices", "create", b) && <p><Link className="btn green" href={`/jobs/${id}/invoice`}>Prepare tax invoice</Link></p>}
          {invoices.map((i) => <div key={i.id} className="small">Invoice <Link href={`/invoices/${i.id}`}>{i.doc_no}</Link> · <Money v={i.grand_total} /> · paid <Money v={i.paid_amount} /></div>)}
        </div>
      </div>

      <div className="card">
        <h2>Job lines</h2>
        <table>
          <thead><tr><th>#</th><th>Work or part</th><th className="num">Qty / hrs</th>{canSeePrices && <th className="num">Unit price</th>}{canSeePrices && <th className="num">Discount</th>}<th>Customer</th><th>Parts</th><th>Technician</th><th></th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{l.line_no}</td>
              <td>{l.description}<div className="small muted">{l.line_type}{l.extra_work ? " · extra work found" : ""}{l.standard_hours ? ` · std ${D(l.standard_hours).toFixed(2)} h` : ""}</div>
                {l.below_margin && <span className="pill red">Needs manager approval: price below allowed level</span>}</td>
              <td className="num">{D(l.qty).toString()}</td>
              {canSeePrices && <td className="num"><Money v={l.unit_price} /></td>}
              {canSeePrices && <td className="num">{"discount_amount" in l ? <Money v={l.discount_amount} /> : "—"}</td>}
              <td><Status s={l.approval_status} /></td>
              <td className="small">{l.item_id ? <>
                {l.committed_qty !== null && l.committed_qty !== undefined && <div>committed {D(l.committed_qty).toString()}{D(l.back_ordered ?? 0).gt(0) && <span className="pill amber"> back-ordered {D(l.back_ordered).toString()}</span>}</div>}
                <div>issued {D(l.issued_qty).toString()} of {D(l.qty).toString()}</div>
                {canIssue && l.approval_status === "approved" && D(l.issued_qty).lt(l.qty) && (
                  <form action={issueAction} className="row" style={{ marginTop: 4 }}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                    <input name="qty" defaultValue={D(l.qty).minus(l.issued_qty).toString()} style={{ width: 70, minWidth: 60 }} /><button className="btn sm shrink">Issue</button></form>
                )}</> : <span className="muted">—</span>}</td>
              <td className="small">{canEdit && l.line_type === "labour" ? (
                <form action={assignTechAction} className="row"><input type="hidden" name="job_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                  <select name="technician_id" defaultValue={l.technician_id ?? ""} style={{ minHeight: 32 }}><option value="">—</option>{m.technicians.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select>
                  <button className="btn ghost sm shrink">Set</button></form>) : l.technician_name ?? ""}</td>
              <td>{canEdit && l.approval_status === "pending" && <form action={removeLineAction}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="line_id" value={l.id} /><button className="btn ghost sm">Remove</button></form>}</td>
            </tr>
          ))}</tbody>
        </table>
        {canEdit && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status) && (
          <div className="grid3" style={{ marginTop: 14 }}>
            <form action={addLineAction}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="line_type" value="labour" />
              <h3>Add labour</h3>
              <div className="field"><select name="service_id">{m.services.map((s) => <option key={s.id} value={s.id}>{s.name_en} · {D(s.standard_hours).toString()} h{s.is_quick ? " · quick" : ""}</option>)}</select></div>
              {discountEdit && <div className="field"><input name="discount_amount" placeholder="Discount AED (optional)" /></div>}
              <button className="btn sm">Add labour</button></form>
            <form action={addLineAction}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="line_type" value="part" />
              <h3>Add part</h3>
              <div className="field"><select name="item_id">{m.items.map((i) => <option key={i.id} value={i.id}>{i.part_no} · {i.description}{canSeePrices ? ` · AED ${i.list_price}` : ""}</option>)}</select></div>
              <div className="row"><input name="qty" defaultValue="1" placeholder="Qty" />{discountEdit && <input name="discount_amount" placeholder="Discount AED" />}</div>
              {fieldLevel(ctx, "selling_price", b) === "edit" && <div className="field" style={{ marginTop: 6 }}><input name="unit_price" placeholder="Override unit price (manager)" /></div>}
              <button className="btn sm" style={{ marginTop: 6 }}>Add part</button></form>
            <form action={addLineAction}><input type="hidden" name="job_id" value={id} /><input type="hidden" name="line_type" value="outside" />
              <h3>Add outside work</h3>
              <div className="field"><input name="description" placeholder="Description" required /></div>
              <div className="row"><input name="unit_price" placeholder="Price AED" required />{discountEdit && <input name="discount_amount" placeholder="Discount AED" />}</div>
              <button className="btn sm" style={{ marginTop: 6 }}>Add outside work</button></form>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Quotation</h2>
        {q ? (
          <>
            <div className="row" style={{ alignItems: "center" }}>
              <div><b>{q.doc_no}</b> <Status s={q.status} /> <span className="muted small">valid until {q.valid_until.split("-").reverse().join("/")}</span></div>
              {canSeePrices && <div className="right">Taxable <Money v={q.taxable_total} /> · VAT <Money v={q.vat_total} /> · <b>Total AED <Money v={q.grand_total} /></b> · approved <Money v={q.approved_total} /></div>}
            </div>
            {q.internal_approval_reason && <div className="flash warn" style={{ marginTop: 8 }}>{q.internal_approval_reason}</div>}
            {canSeePrices && (
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>#</th><th>Line</th><th className="num">Qty</th><th className="num">Amount</th><th className="num">Discount</th><th className="num">Taxable</th><th className="num">VAT</th><th className="num">Total</th><th>Customer</th></tr></thead>
                <tbody>{quotationLines.map((l) => (
                  <tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.gross_amount} /></td>
                    <td className="num">{"line_discount" in l ? <Money v={D(l.line_discount).plus(l.doc_discount_share).toFixed(2)} /> : "—"}</td>
                    <td className="num"><Money v={l.taxable_amount} /></td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td>
                    <td><Status s={l.decision} /> <span className="small muted">{l.decision_channel?.replace("_", " ")}</span></td></tr>
                ))}</tbody>
              </table>
            )}
            {canEdit && ["ready_to_send", "sent"].includes(q.status) && (
              <form action={sendQuotationAction} style={{ marginTop: 10 }}>
                <input type="hidden" name="quotation_id" value={q.id} /><input type="hidden" name="job_id" value={id} /><input type="hidden" name="$origin" value={origin} />
                <input type="hidden" name="doc_no" value={q.doc_no} /><input type="hidden" name="amount" value={q.grand_total} />
                <button className="btn wa">{q.status === "sent" ? "Send the approval link again" : "Send quotation for approval"}</button>
                {q.public_token && <span className="small muted"> Customer link: <a href={`/q/${q.public_token}`} target="_blank">/q/…{q.public_token.slice(-6)}</a></span>}
              </form>
            )}
            {canEdit && q.status === "sent" && (
              <form action={staffDecisionAction} style={{ marginTop: 12 }}>
                <h3>Record the customer&apos;s answer given in person, by phone or by email</h3>
                <input type="hidden" name="quotation_id" value={q.id} /><input type="hidden" name="job_id" value={id} />
                <table><tbody>{quotationLines.filter((l) => l.decision === "pending").map((l) => (
                  <tr key={l.id}><td>{l.description}</td><td style={{ whiteSpace: "nowrap" }}>
                    <label className="inline"><input type="radio" name={`d_${l.id}`} value="approved" defaultChecked /> Approve</label>{"  "}
                    <label className="inline"><input type="radio" name={`d_${l.id}`} value="declined" /> Decline</label></td></tr>
                ))}</tbody></table>
                <div className="row"><select name="channel"><option value="in_person">In person</option><option value="phone">Phone</option><option value="email">Email</option></select>
                  <input name="note" placeholder="Note (required for phone)" /><button className="btn green shrink">Record answer</button></div>
              </form>
            )}
          </>
        ) : <p className="muted">No quotation yet.</p>}
        {canEdit && lines.some((l) => l.approval_status === "pending") && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status) && (
          <form action={saveQuotationAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="job_id" value={id} />
            <div className="row">
              {discountEdit && <div className="field"><label>Overall discount (AED)</label><input name="doc_discount" placeholder="0.00" /></div>}
              <div className="field"><label>Valid for (days)</label><input name="valid_days" placeholder="7" /></div>
              <div className="shrink"><button className="btn">{q ? "Save new revision" : "Save quotation and reserve parts"}</button></div>
            </div>
            <p className="small muted">Saving reserves the parts at this branch (first come, first served). A discount above your limit, or a price below the minimum margin, goes to the branch manager before it can be sent.</p>
          </form>
        )}
      </div>

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
