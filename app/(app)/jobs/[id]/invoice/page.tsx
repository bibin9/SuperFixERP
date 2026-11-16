import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { invoiceDraft } from "@/lib/services/billing";
import { postInvoiceAction } from "@/app/actions";
import { Flash, Link, Money, PageHead } from "@/components/ui";
import { D } from "@/lib/money";

export default async function InvoiceDraft({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const d = await invoiceDraft(ctx, id);
  const ready = d.checks.every((c) => c.ok);
  return (
    <>
      <PageHead title={`Tax invoice draft · ${d.job.doc_no}`} sub="Lines come only from approved job lines, at the approved quotation price (IV-01, QT-07)."><Link className="btn ghost" href={`/jobs/${id}`}>Back to job</Link></PageHead>
      <Flash sp={sp} />
      <div className="card"><h2>Checks</h2>
        <ul className="checks">{d.checks.map((c) => <li key={c.text} className={c.ok ? "ok" : "no"}>{c.text}</li>)}</ul>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Line</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Taxable</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
          <tbody>{d.lines.map((l) => (
            <tr key={l.job_line_id}><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td><td className="num"><Money v={l.unit_price} /></td>
              <td className="num"><Money v={D(l.line_discount).plus(l.doc_discount_share).toFixed(2)} /></td><td className="num"><Money v={l.taxable_amount} /></td><td className="num"><Money v={l.vat_amount} /></td><td className="num"><Money v={l.line_total} /></td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={4}>Total AED</td><td className="num"><Money v={d.taxable} /></td><td className="num"><Money v={d.vat} /></td><td className="num"><Money v={d.total} /></td></tr></tfoot>
        </table>
        <form action={postInvoiceAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="job_id" value={id} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
          <button className="btn green" disabled={!ready}>Post tax invoice</button>
          <span className="small muted"> Posting gives the next invoice number for this branch and cannot be undone; corrections are made with a credit note.</span>
        </form>
      </div>
    </>
  );
}
