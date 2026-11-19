import { RecordHistory } from "@/components/RecordHistory";
import { docHistory } from "@/lib/services/history";
import crypto from "node:crypto";
import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { getInvoice } from "@/lib/services/billing";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { receiptAction, applyAdvanceAction, invoiceWhatsappAction } from "@/app/actions-billing";
import { Flash, Link, Money, Status, d, dt } from "@/components/ui";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { ManualMessage } from "@/components/ManualMessage";
import { PrintButton } from "@/components/PrintButton";
import { D } from "@/lib/money";

const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { invoice: i, lines, receipts, applied, credits, advances, jobs } = await getInvoice(ctx, id);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") === "https" ? "https" : "http"}://${h.get("host") ?? "localhost:3000"}`;
  const open = D(i.open_amount);
  const m = await masters(ctx);
  const canTake = can(ctx, "invoices", "create", i.branch_id);
  const back = `/invoices/${id}`;
  return (
    <>
      <Flash sp={sp} />
      <ManualMessage ctx={ctx} id={sp.msg} back={`${back}?msg=${sp.msg ?? ""}`} />
      <div className="row no-print" style={{ marginBottom: 10 }}>
        <PrintButton label="Print or save as PDF" />
        {i.job_card_id && can(ctx, "jobs", "edit", i.branch_id) && (
          <form action={invoiceWhatsappAction} className="shrink"><input type="hidden" name="invoice_id" value={id} /><button className="btn wa">Prepare WhatsApp</button></form>)}
        {canTake && D(i.grand_total).gt(i.credited_amount) && <Link className="btn ghost shrink" href={`/invoices/${id}/credit-note`}>Credit note</Link>}
        {can(ctx, "invoices", "export", i.branch_id) && <a className="btn ghost shrink" href={`/api/einvoice/${id}`}>E-invoice data (JSON)</a>}
        {i.job_card_id && <Link className="btn ghost shrink" href={`/jobs/${i.job_card_id}`}>Back to job</Link>}
      </div>
      <InvoiceDoc i={i} lines={lines} link={`${origin}/i/${i.share_token}`} />
      {jobs.length > 0 && (
        <div className="card" data-testid="combined-jobs"><h2>Job cards on this combined invoice</h2>
          <table><thead><tr><th>Job card</th><th>Car</th><th className="num">Before VAT</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.id}><td><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></td><td>{[j.plate_code, j.plate_number].filter(Boolean).join(" ")} {j.make} {j.model}</td>
              <td className="num"><Money v={j.taxable_total} /></td><td className="num"><Money v={j.vat_total} /></td><td className="num"><Money v={j.grand_total} /></td></tr>)}</tbody></table>
        </div>
      )}

      <div className="grid2 no-print">
        <div className="card">
          <h2>Payments</h2>
          {!receipts.length && !applied.length && <p className="small muted">No payments yet.</p>}
          <table><tbody>
            {receipts.map((r) => (
              <tr key={r.doc_no + r.reversed}><td>{r.doc_no}</td><td>{r.method_name ?? r.method}{r.cheque_no && <> · cheque {r.cheque_no} <Status s={r.cheque_status} /></>}</td><td>{d(ymd(r.doc_date))}</td>
                <td className="num">{r.reversed ? <s><Money v={r.amount} /></s> : <Money v={r.amount} />}</td></tr>))}
            {applied.map((a, k) => <tr key={`ap${k}`}><td>{a.source_no}</td><td>{a.source === "credit_note" ? "Credit held for the customer" : "Advance applied"}</td><td>{dt(a.applied_at)}</td><td className="num"><Money v={a.amount} /></td></tr>)}
          </tbody></table>
          {canTake && open.gt(0) && (
            <form action={receiptAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="invoice_id" value={id} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
              <div className="row">
                <div className="field"><label>Method</label><select name="method">{m.paymentMethods.map((pm) => <option key={pm.code} value={pm.code}>{pm.name}{pm.needs_reference ? " (reference needed)" : ""}</option>)}</select></div>
                <div className="field"><label>Amount (AED)</label><input name="amount" defaultValue={open.toFixed(2)} inputMode="decimal" /></div>
                <div className="field"><label>Reference</label><input name="reference" placeholder="Card slip or transfer reference" /></div>
              </div>
              <details><summary className="small">Cheque details (needed for a cheque)</summary>
                <div className="row">
                  <div className="field"><label>Cheque number</label><input name="cheque_no" /></div>
                  <div className="field"><label>Bank</label><input name="cheque_bank" /></div>
                  <div className="field"><label>Cheque date</label><input name="cheque_date" type="date" /></div>
                </div>
              </details>
              <button className="btn green" style={{ marginTop: 8 }}>Record payment</button>
              <span className="small muted"> Paying more than is open keeps the rest on the customer&apos;s account.</span>
            </form>
          )}
          {canTake && open.gt(0) && advances.length > 0 && (
            <form action={applyAdvanceAction} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="invoice_id" value={id} />
              <div className="field"><label>Use money held for the customer</label><select name="advance_id">{advances.map((a) => <option key={a.id} value={a.id}>{a.source_no} · AED {D(a.open).toFixed(2)} left</option>)}</select></div>
              <div className="field"><label>Amount (blank = as much as possible)</label><input name="amount" inputMode="decimal" /></div>
              <div className="shrink"><button className="btn">Apply</button></div>
            </form>
          )}
        </div>
        <div className="card">
          <h2>Credit notes</h2>
          {!credits.length && <p className="small muted">None.</p>}
          {credits.map((c) => <div key={c.id} className="small"><Link href={`/billing/credit-notes/${c.id}`}>{c.doc_no ?? "Waiting for approval"}</Link> · <Money v={c.grand_total} /> <Status s={c.status} /></div>)}
          <p className="small muted" style={{ marginTop: 10 }}>Posted by {i.posted_by_name} · {dt(i.posted_at)}. A posted invoice is never edited or deleted; corrections are made with a credit note.</p>
        </div>
      </div>
      <RecordHistory rows={await docHistory(ctx, "sales_invoice", id)} />
    </>
  );
}
