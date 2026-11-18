import { addLineAction, removeLineAction, saveQuotationAction, sendQuotationAction, staffDecisionAction, issueAction } from "@/app/actions";
import { Money, Status } from "./ui";
import { D } from "@/lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Masters = { services: Row[]; items: Row[]; technicians: Row[] };

/**
 * Work lines and the quotation, shared by the enquiry (before the job card) and the job card
 * (extra work). The owner decides where new lines go; the enquiry id keys the quotation.
 */
export function WorkLines(p: {
  owner: { kind: "enquiry" | "job"; id: string }; back: string; lines: Row[]; m: Masters; canEdit: boolean; canSeePrices: boolean;
  canIssue?: boolean; discountEdit: boolean; priceEdit: boolean; open: boolean;
}) {
  const isJob = p.owner.kind === "job";
  const hidden = (<><input type="hidden" name="owner_kind" value={p.owner.kind} /><input type="hidden" name="owner_id" value={p.owner.id} /><input type="hidden" name="$back" value={p.back} /></>);
  return (
    <div className="card">
      <h2>{isJob ? "Job lines" : "Work to quote"}</h2>
      <table>
        <thead><tr><th>#</th><th>Work or part</th><th className="num">Qty / hrs</th>{p.canSeePrices && <th className="num">Unit price</th>}{p.canSeePrices && <th className="num">Discount</th>}<th>Customer</th><th>Parts</th>{isJob && <th>Technician</th>}<th><span className="vh">Actions</span></th></tr></thead>
        <tbody>{p.lines.map((l) => (
          <tr key={l.id}>
            <td>{l.line_no}</td>
            <td>{l.description}<div className="small muted">{l.line_type}{l.extra_work ? " · extra work found" : ""}{l.standard_hours ? ` · std ${D(l.standard_hours).toFixed(2)} h` : ""}</div>
              {l.below_margin && <span className="pill red">Needs manager approval: price below allowed level</span>}</td>
            <td className="num">{D(l.qty).toString()}</td>
            {p.canSeePrices && <td className="num"><Money v={l.unit_price} /></td>}
            {p.canSeePrices && <td className="num">{"discount_amount" in l ? <Money v={l.discount_amount} /> : "—"}</td>}
            <td><Status s={l.approval_status} /></td>
            <td className="small">{l.item_id && l.approval_status !== "deferred" ? (isJob ? <>
              {l.committed_qty !== null && l.committed_qty !== undefined && <div>committed {D(l.committed_qty).toString()}{D(l.back_ordered ?? 0).gt(0) && <span className="pill amber"> back-ordered {D(l.back_ordered).toString()}</span>}</div>}
              <div>issued {D(l.issued_qty).toString()} of {D(l.qty).toString()}</div>
              {p.canIssue && l.approval_status === "approved" && D(l.issued_qty).lt(l.qty) && (
                <form action={issueAction} className="row" style={{ marginTop: 4 }}><input type="hidden" name="job_id" value={p.owner.id} /><input type="hidden" name="line_id" value={l.id} />
                  <input name="qty" defaultValue={D(l.qty).minus(l.issued_qty).toString()} style={{ width: 70, minWidth: 60 }} /><button className="btn sm shrink">Issue</button></form>
              )}</> : <>{D(l.free_here ?? 0).gte(l.qty) ? <span className="pill green">in stock here</span> : <span className="pill amber">short here</span>}<div className="muted">committed when the job card is created</div></>)
            : <span className="muted">—</span>}</td>
            {isJob && <td className="small">{l.technician_name ?? (l.line_type === "labour" && p.open ? <span className="muted">assign below</span> : "")}</td>}
            <td>{p.canEdit && p.open && l.approval_status === "pending" && <form action={removeLineAction}><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="$back" value={p.back} /><button className="btn ghost sm">Remove</button></form>}</td>
          </tr>
        ))}
        {!p.lines.length && <tr><td colSpan={9} className="muted">No work added yet.</td></tr>}</tbody>
      </table>
      {p.canEdit && p.open && (
        <div className="grid3" style={{ marginTop: 14 }}>
          <form action={addLineAction}>{hidden}<input type="hidden" name="line_type" value="labour" />
            <h3>Add labour{isJob ? " (extra work)" : ""}</h3>
            <div className="field"><select name="service_id">{p.m.services.map((s) => <option key={s.id} value={s.id}>{s.name_en} · {D(s.standard_hours).toString()} h{s.is_quick ? " · quick" : ""}</option>)}</select></div>
            {p.discountEdit && <div className="field"><input name="discount_amount" placeholder="Discount AED (optional)" /></div>}
            <button className="btn sm">Add labour</button></form>
          <form action={addLineAction}>{hidden}<input type="hidden" name="line_type" value="part" />
            <h3>Add part</h3>
            <div className="field"><select name="item_id">{p.m.items.map((i) => <option key={i.id} value={i.id}>{i.part_no} · {i.description}{p.canSeePrices ? ` · AED ${i.list_price}` : ""}</option>)}</select></div>
            <div className="row"><input name="qty" defaultValue="1" placeholder="Qty" />{p.discountEdit && <input name="discount_amount" placeholder="Discount AED" />}</div>
            {p.priceEdit && <div className="field" style={{ marginTop: 6 }}><input name="unit_price" placeholder="Override unit price (manager)" /></div>}
            <button className="btn sm" style={{ marginTop: 6 }}>Add part</button></form>
          <form action={addLineAction}>{hidden}<input type="hidden" name="line_type" value="outside" />
            <h3>Add outside work</h3>
            <div className="field"><input name="description" placeholder="Description" required /></div>
            <div className="row"><input name="unit_price" placeholder="Price AED" required />{p.discountEdit && <input name="discount_amount" placeholder="Discount AED" />}</div>
            <button className="btn sm" style={{ marginTop: 6 }}>Add outside work</button></form>
        </div>
      )}
    </div>
  );
}

export function QuotationPanel(p: {
  enquiryId: string; back: string; origin: string; quotations: Row[]; quotationLines: Row[]; lines: Row[]; canEdit: boolean; canSeePrices: boolean;
  discountEdit: boolean; open: boolean; isJob: boolean;
}) {
  const q = p.quotations[0];
  return (
    <div className="card">
      <h2>Quotation</h2>
      {q ? (
        <>
          <div className="row" style={{ alignItems: "center" }}>
            <div><b>{q.doc_no}</b> <Status s={q.status} /> <span className="muted small">valid until {q.valid_until.split("-").reverse().join("/")}</span></div>
            {p.canSeePrices && <div className="right">Taxable <Money v={q.taxable_total} /> · VAT <Money v={q.vat_total} /> · <b>Total AED <Money v={q.grand_total} /></b> · approved <Money v={q.approved_total} /></div>}
          </div>
          {q.internal_approval_reason && <div className="flash warn" style={{ marginTop: 8 }}>{q.internal_approval_reason}</div>}
          {p.canSeePrices && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>#</th><th>Line</th><th className="num">Qty</th><th className="num">Amount</th><th className="num">Discount</th><th className="num">Taxable</th><th className="num">VAT</th><th className="num">Total</th><th>Customer</th></tr></thead>
              <tbody>{p.quotationLines.map((l) => (
                <tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.gross_amount} /></td>
                  <td className="num">{"line_discount" in l ? <Money v={D(l.line_discount).plus(l.doc_discount_share).toFixed(2)} /> : "—"}</td>
                  <td className="num"><Money v={l.taxable_amount} /></td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td>
                  <td><Status s={l.decision} /> <span className="small muted">{({ whatsapp_link: "customer link", whatsapp_reply: "WhatsApp reply", in_person: "in person" } as Record<string, string>)[l.decision_channel] ?? l.decision_channel ?? ""}</span></td></tr>
              ))}</tbody>
            </table>
          )}
          {p.canEdit && ["ready_to_send", "sent"].includes(q.status) && (
            <form action={sendQuotationAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="quotation_id" value={q.id} /><input type="hidden" name="$back" value={p.back} /><input type="hidden" name="$origin" value={p.origin} />
              <input type="hidden" name="doc_no" value={q.doc_no} /><input type="hidden" name="amount" value={q.grand_total ?? ""} />
              <button className="btn wa">{q.status === "sent" ? "Prepare the approval message again" : "Prepare approval message"}</button>
              {q.public_token && <span className="small muted"> Customer link: <a href={`/q/${q.public_token}`} target="_blank">/q/…{q.public_token.slice(-6)}</a></span>}
              <div className="small muted">You send the message yourself from WhatsApp; nothing is sent automatically.</div>
            </form>
          )}
          {p.canEdit && q.status === "sent" && (
            <form action={staffDecisionAction} style={{ marginTop: 12 }}>
              <h3>Record the customer&apos;s answer given in person, by phone, by email or as a WhatsApp reply</h3>
              <input type="hidden" name="quotation_id" value={q.id} /><input type="hidden" name="$back" value={p.back} />
              <table><tbody>{p.quotationLines.filter((l) => l.decision === "pending").map((l) => (
                <tr key={l.id}><td>{l.description}</td><td style={{ whiteSpace: "nowrap" }}>
                  <label className="inline"><input type="radio" name={`d_${l.id}`} value="approved" defaultChecked /> Approve</label>{"  "}
                  <label className="inline"><input type="radio" name={`d_${l.id}`} value="declined" /> Decline</label></td></tr>
              ))}</tbody></table>
              <div className="row"><select name="channel"><option value="in_person">In person</option><option value="phone">Phone</option><option value="email">Email</option><option value="whatsapp_reply">WhatsApp reply</option></select>
                <input name="note" placeholder="Note (required for phone or WhatsApp reply)" /><button className="btn green shrink">Record answer</button></div>
              <p className="small muted">If the customer approved through the link, there is nothing to do here: the answer appears on its own. If they replied YES in WhatsApp instead, choose WhatsApp reply and paste what they wrote into the note.</p>
            </form>
          )}
        </>
      ) : <p className="muted">No quotation yet.</p>}
      {p.canEdit && p.open && p.lines.some((l) => l.approval_status === "pending") && (
        <form action={saveQuotationAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="enquiry_id" value={p.enquiryId} /><input type="hidden" name="$back" value={p.back} />
          <div className="row">
            {p.discountEdit && <div className="field"><label>Overall discount (AED)</label><input name="doc_discount" placeholder="0.00" /></div>}
            <div className="field"><label>Valid for (days)</label><input name="valid_days" placeholder="from settings" /></div>
            <div className="shrink"><button className="btn">{q ? "Save new revision" : "Save quotation"}</button></div>
          </div>
          <p className="small muted">A discount above your limit, or a price below the minimum margin, goes to the branch manager before it can be sent.
            {p.isJob ? " Parts for extra work are committed when the customer approves it." : " Parts are committed when the job card is created from the approved quotation."}</p>
        </form>
      )}
    </div>
  );
}
