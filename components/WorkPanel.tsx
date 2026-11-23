import { ScanBox } from "@/components/ScanBox";
import { addLineAction, addBundleAction, removeLineAction, saveQuotationAction, sendQuotationAction, staffDecisionAction, issueAction } from "@/app/actions";
import { Link, Money, Status } from "./ui";
import { D } from "@/lib/money";
import { Popup } from "./Popup";
import { QuickAdd } from "./QuickAdd";
import type { QuickSpec } from "@/lib/services/quick-add";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Masters = { services: Row[]; items: Row[]; technicians: Row[]; bundles?: Row[] };

/**
 * Work lines and the quotation, shared by the enquiry (before the job card) and the job card
 * (extra work). The owner decides where new lines go; the enquiry id keys the quotation.
 */
export function WorkLines(p: {
  owner: { kind: "enquiry" | "job"; id: string }; back: string; lines: Row[]; m: Masters; canEdit: boolean; canSeePrices: boolean;
  canIssue?: boolean; discountEdit: boolean; priceEdit: boolean; open: boolean; quick?: { items?: QuickSpec | null; services?: QuickSpec | null };
}) {
  const isJob = p.owner.kind === "job";
  const hidden = (<><input type="hidden" name="owner_kind" value={p.owner.kind} /><input type="hidden" name="owner_id" value={p.owner.id} /><input type="hidden" name="$back" value={p.back} /></>);
  return (
    <div className="card" id="lines">
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
                <form action={issueAction} className="row" style={{ marginTop: 4 }}><input type="hidden" name="job_id" value={p.owner.id} /><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="request_key" value={crypto.randomUUID()} />
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
        <div className="popbtns">
          <Popup id="add-labour" title={isJob ? "Add labour (extra work)" : "Add labour"} label="+ Add labour" className="btn sm">
            <form action={addLineAction}>{hidden}<input type="hidden" name="line_type" value="labour" />
              <div className="field"><label>Service or labour</label><div className="picker"><select name="service_id" required>{p.m.services.map((s) => <option key={s.id} value={s.id}>{s.name_en} · {D(s.standard_hours).toString()} h{s.is_quick ? " · quick" : ""}</option>)}</select>
                {p.quick?.services && <QuickAdd spec={p.quick.services} target="service_id" label="+ New service" />}</div></div>
              {p.discountEdit && <div className="field"><label>Discount AED (optional)</label><input name="discount_amount" inputMode="decimal" placeholder="0.00" /></div>}
              <button className="btn green">Add labour</button></form>
          </Popup>
          <Popup id="add-part" title={isJob ? "Add a part (extra work)" : "Add a part"} label="+ Add part" className="btn sm">
            <form action={addLineAction}>{hidden}<input type="hidden" name="line_type" value="part" />
              <ScanBox />
              <div className="field"><label>Part</label><div className="picker"><select name="item_id" required>{p.m.items.map((i) => <option key={i.id} value={i.id} data-codes={i.codes}>{i.part_no} · {i.description}{p.canSeePrices ? ` · AED ${i.list_price}` : ""}</option>)}</select>
                {p.quick?.items && <QuickAdd spec={p.quick.items} target="item_id" label="+ New part" />}</div></div>
              <div className="row"><div className="field"><label>Qty</label><input name="qty" defaultValue="1" inputMode="decimal" required /></div>{p.discountEdit && <div className="field"><label>Discount AED (optional)</label><input name="discount_amount" inputMode="decimal" placeholder="0.00" /></div>}</div>
              {p.priceEdit && <div className="field"><label>Override unit price (manager, optional)</label><input name="unit_price" inputMode="decimal" /></div>}
              <button className="btn green" style={{ marginTop: 6 }}>Add part</button></form>
          </Popup>
          <Popup id="add-outside" title={isJob ? "Add outside work (extra work)" : "Add outside work"} label="+ Add outside work" className="btn sm">
            <form action={addLineAction}>{hidden}<input type="hidden" name="line_type" value="outside" />
              <div className="field"><label>Description</label><input name="description" required /></div>
              <div className="row"><div className="field"><label>Price AED</label><input name="unit_price" inputMode="decimal" required /></div>{p.discountEdit && <div className="field"><label>Discount AED (optional)</label><input name="discount_amount" inputMode="decimal" placeholder="0.00" /></div>}</div>
              <button className="btn green" style={{ marginTop: 6 }}>Add outside work</button></form>
          </Popup>
        </div>
      )}
      {p.canEdit && p.open && !!p.m.bundles?.length && (
        <details className="bundles" open={!isJob}>
          <summary><h3 style={{ display: "inline" }}>{isJob ? "Add a whole service package as extra work" : "Or add a whole service in one tap"}</h3></summary>
          <div className="bundle-grid">
            {p.m.bundles.slice(0, 6).map((b) => (
              <form key={b.id} action={addBundleAction} className={`bundle${b.match ? " match" : ""}`}>{hidden}<input type="hidden" name="bundle_id" value={b.id} />
                <div className="row bh">{b.match ? <span className="pill red">Fits this car</span> : <span className="pill">Bundle</span>}<span className="small muted">{b.labour_lines} labour · {b.part_lines} parts</span></div>
                <b>{b.name_en}</b>
                <div className="small muted">{b.lines.map((l: Row) => l.service_name ?? `${D(l.qty).toString()} × ${l.item_name}`).join(", ")}</div>
                <div className="row bf">{p.canSeePrices ? <b><Money v={b.price} /></b> : <span />}<button className="btn sm">{isJob ? "Add as extra work" : "Add bundle"}</button></div>
              </form>
            ))}
          </div>
        </details>
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
    <div className="card" id="quote">
      <h2>Quotation</h2>
      {q ? (
        <>
          <div className="row" style={{ alignItems: "center" }}>
            <div><b>{q.doc_no}</b> <Status s={q.status} /> <span className="muted small">valid until {q.valid_until.split("-").reverse().join("/")}</span>
              {p.canSeePrices && <> <Link className="btn ghost sm" href={`/print/quotation/${q.id}`}>Print quotation</Link></>}</div>
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
          {p.canEdit && q.status === "sent" && (<div className="popbtns">
            <Popup id="record-answer" wide title="Record the customer's answer" label="Record the customer's answer" className="btn green sm">
            <form action={staffDecisionAction}>
              <p className="small muted">Use this when the customer answered in person, by phone, by email or as a WhatsApp reply.</p>
              <input type="hidden" name="quotation_id" value={q.id} /><input type="hidden" name="$back" value={p.back} />
              <table><tbody>{p.quotationLines.filter((l) => l.decision === "pending").map((l) => (
                <tr key={l.id}><td>{l.description}</td><td style={{ whiteSpace: "nowrap" }}>
                  <label className="inline"><input type="radio" name={`d_${l.id}`} value="approved" defaultChecked /> Approve</label>{"  "}
                  <label className="inline"><input type="radio" name={`d_${l.id}`} value="declined" /> Decline</label></td></tr>
              ))}</tbody></table>
              <div className="row"><div className="field"><label>How they answered</label><select name="channel"><option value="in_person">In person</option><option value="phone">Phone</option><option value="email">Email</option><option value="whatsapp_reply">WhatsApp reply</option></select></div>
                <div className="field"><label>Note (needed for phone or WhatsApp reply)</label><input name="note" /></div><button className="btn green shrink">Record answer</button></div>
              <p className="small muted">If the customer approved through the link, there is nothing to do here: the answer appears on its own. If they replied YES in WhatsApp instead, choose WhatsApp reply and paste what they wrote into the note.</p>
            </form>
            </Popup></div>
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
