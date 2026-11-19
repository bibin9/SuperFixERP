import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { invoiceDraft } from "@/lib/services/billing";
import { postInvoiceAction, saveInvoiceLinesAction } from "@/app/actions-billing";
import { masters } from "@/lib/services/masters";
import { fieldLevel } from "@/lib/access";
import { Flash, Link, Money, PageHead, label } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { D } from "@/lib/money";

export default async function InvoiceDraft({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const d = await invoiceDraft(ctx, id);
  const m = await masters(ctx);
  const priceEdit = fieldLevel(ctx, "selling_price", d.job.branch_id) === "edit";
  const discEdit = fieldLevel(ctx, "discount", d.job.branch_id) === "edit";
  const ready = d.checks.filter((c) => !c.text.startsWith("There are approved")).every((c) => c.ok);
  const kindName = d.kind === "simplified" ? "Simplified tax invoice" : "Tax invoice";
  const held = d.advances.filter((a) => a.job_card_id === id).reduce((s, a) => s.plus(a.open), D(0));
  return (
    <>
      <PageHead title={`Invoice · ${d.job.doc_no}`} sub="Change a quantity, price or discount in the lines, or add a line, then Save changes. Tick the lines to bill now; the rest can be billed separately.">
        <Link className="btn ghost" href={`/jobs/${id}`}>Back to job</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="card"><h2>Checks</h2>
        <ul className="checks">{d.checks.map((c) => <li key={c.text} className={c.ok ? "ok" : "no"}>{c.text}</li>)}</ul>
      </div>
      {!d.lines.length ? (
        <div className="card"><p className="muted">Everything approved on this job is already billed. <Link href={`/jobs/${id}`}>Back to the job card</Link> to see its invoices.</p></div>
      ) : (
        <form action={postInvoiceAction} className="card">
          <input type="hidden" name="job_id" value={id} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
          <table className="invlines">
            <thead><tr><th>Bill</th><th>Line</th><th>Type</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Taxable</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.job_line_id}><td><input type="checkbox" name="line_id" value={l.job_line_id} defaultChecked aria-label={`Bill ${l.description}`} /></td>
                <td>{l.description}</td><td>{label(l.line_type)}</td>
                <td className="num"><input name={`qty.${l.job_line_id}`} defaultValue={D(l.qty).toString()} inputMode="decimal" className="numin" aria-label={`Quantity of ${l.description}`} /></td>
                <td className="num"><input name={`price.${l.job_line_id}`} defaultValue={D(l.unit_price).toFixed(2)} inputMode="decimal" className="numin" readOnly={!priceEdit} title={priceEdit ? undefined : "You cannot change the selling price"} aria-label={`Unit price of ${l.description}`} /></td>
                <td className="num"><input name={`disc.${l.job_line_id}`} defaultValue={D(l.line_discount).plus(l.doc_discount_share).toFixed(2)} inputMode="decimal" className="numin" readOnly={!discEdit} title={discEdit ? undefined : "You cannot give a discount"} aria-label={`Discount on ${l.description}`} /></td>
                <td className="num"><Money v={l.taxable_amount} /></td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td></tr>
            ))}
              <tr className="addline"><td></td>
                <td colSpan={2}>
                  <select name="new_line_type" defaultValue="" aria-label="New line type"><option value="">+ Add a line…</option><option value="labour">Labour (service)</option><option value="part">Part</option><option value="consumable">Consumable</option><option value="outside">Outside work</option></select>
                  <select name="new_service_id" defaultValue="" aria-label="Service"><option value="">Service (for labour)</option>{m.services.map((x) => <option key={x.id} value={x.id}>{x.name_en}</option>)}</select>
                  <select name="new_item_id" defaultValue="" aria-label="Part"><option value="">Part (for parts)</option>{m.items.map((x) => <option key={x.id} value={x.id}>{x.part_no} · {x.description}</option>)}</select>
                  <input name="new_description" placeholder="Description (needed for outside work)" aria-label="New line description" />
                </td>
                <td className="num"><input name="new_qty" placeholder="1" inputMode="decimal" className="numin" aria-label="New line quantity" /></td>
                <td className="num"><input name="new_unit_price" placeholder="List price" inputMode="decimal" className="numin" aria-label="New line price" /></td>
                <td className="num"><input name="new_discount_amount" placeholder="0.00" inputMode="decimal" className="numin" readOnly={!discEdit} aria-label="New line discount" /></td>
                <td colSpan={3} className="small muted">Totals update when you save.</td></tr>
            </tbody>
            <tfoot><tr><td colSpan={6}>All lines (AED)</td><td className="num"><Money v={d.taxable} /></td><td className="num"><Money v={d.vat} /></td><td className="num"><Money v={d.total} /></td></tr></tfoot>
          </table>
          <div style={{ marginTop: 8 }}><button className="btn" formAction={saveInvoiceLinesAction}>Save changes</button>
            <span className="small muted"> Changes are recorded as approved by you at the counter. Parts added are taken from the store.</span></div>
          <h3 style={{ marginTop: 16 }}>Bill to</h3>
          <div className="grid2">
            <div>
              <label className="check"><input type="radio" name="bill_to" value="customer" defaultChecked /> The customer: <b>{d.billToDefault}</b>{d.customer.trn && <> · TRN {d.customer.trn}</>}</label>
              <label className="check"><input type="radio" name="bill_to" value="fleet" /> A fleet or company account</label>
              <div className="field" style={{ marginLeft: 24 }}><select name="fleet_customer_id" defaultValue="" aria-label="Fleet account"><option value="">Choose the company</option>
                {d.fleets.map((f) => <option key={f.id} value={f.id}>{f.company_name}{Number(f.payment_terms_days) > 0 ? ` · ${f.payment_terms_days} days` : ""}</option>)}</select></div>
              <label className="check"><input type="radio" name="bill_to" value="warranty" /> Warranty claim (no tax invoice; the parts cost goes to warranty)</label>
              <div className="field" style={{ marginLeft: 24 }}><input name="claim_ref" placeholder="Maker's or supplier's claim reference" aria-label="Claim reference" /></div>
            </div>
            <div>
              <div className="field"><label>Note printed on the invoice</label><input name="notes" placeholder="Optional" /></div>
              <p className="small">Printed as: <b>{kindName}</b>. {d.kind === "simplified" ? "Allowed because the buyer has no TRN or the invoice is within the simplified limit." : "Full tax invoice with the buyer's details."}</p>
              {d.job.lpo_no && <p className="small">LPO {d.job.lpo_no} is printed on the invoice.</p>}
              {held.gt(0) && <p className="small">AED {held.toFixed(2)} paid in advance on this job is applied to the customer's invoice automatically.</p>}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <ConfirmButton className="btn green" disabled={!ready} message="Post this invoice? It gets the next number and cannot be edited or deleted afterwards.">Post invoice</ConfirmButton>
            <span className="small muted"> Posting gives the next invoice number for this branch and cannot be undone; corrections are made with a credit note.</span>
          </div>
        </form>
      )}
    </>
  );
}
