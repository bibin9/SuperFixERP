import { requireCtx } from "@/lib/session";
import { getInvoice } from "@/lib/services/billing";
import { creditNoteAction } from "@/app/actions-billing";
import { Flash, Link, Money, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { withTx } from "@/lib/db";
import { D } from "@/lib/money";

export default async function NewCreditNote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { invoice: i, lines } = await getInvoice(ctx, id);
  const reasons = await withTx(ctx, async (c) => (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'credit_note_reason' AND active ORDER BY sort")).rows);
  return (
    <>
      <PageHead title={`Credit note against ${i.doc_no}`} sub="Choose what to credit: a quantity, or a lower amount before VAT for a price correction. It goes to the branch manager for approval and gets its number when it posts.">
        <Link className="btn ghost" href={`/invoices/${id}`}>Back to invoice</Link>
      </PageHead>
      <Flash sp={sp} />
      <form action={creditNoteAction} className="card">
        <input type="hidden" name="invoice_id" value={id} />
        <table>
          <thead><tr><th>Line</th><th className="num">Sold</th><th className="num">Left to credit</th><th className="num">Taxable left</th><th>Credit qty</th><th>Or amount before VAT</th><th>Goods</th></tr></thead>
          <tbody>{lines.map((l) => {
            const qtyLeft = D(l.qty).minus(l.credited_qty);
            const amtLeft = D(l.taxable_amount).minus(l.credited_amount);
            const done = amtLeft.lte(0);
            return (
              <tr key={l.id}><td>{l.line_no}. {l.description}</td><td className="num">{D(l.qty).toString()}</td><td className="num">{qtyLeft.toString()}</td><td className="num"><Money v={amtLeft.toFixed(2)} /></td>
                <td><input name={`qty[${l.id}]`} inputMode="decimal" disabled={done} aria-label={`Credit quantity for line ${l.line_no}`} style={{ width: 80 }} /></td>
                <td><input name={`amount[${l.id}]`} inputMode="decimal" disabled={done} aria-label={`Credit amount for line ${l.line_no}`} style={{ width: 100 }} /></td>
                <td>{l.item_id ? <select name={`stock[${l.id}]`} defaultValue="none" aria-label={`Goods for line ${l.line_no}`}><option value="none">No goods back</option><option value="restock">Back into stock</option><option value="scrap">Returned, scrapped</option></select> : <span className="small muted">Service</span>}</td></tr>);
          })}</tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field"><label>Reason</label><select name="reason" required defaultValue=""><option value="" disabled>Choose</option>{reasons.map((r) => <option key={r.code} value={r.code}>{r.name_en}</option>)}</select></div>
          <div className="field" style={{ flex: 2 }}><label>Note (needed for Other)</label><input name="note" /></div>
        </div>
        <ConfirmButton className="btn" message="Send this credit note for approval?">Create credit note</ConfirmButton>
        <span className="small muted"> VAT is reversed on each credited line. If the invoice is already paid, the credit is held on the customer&apos;s account.</span>
      </form>
    </>
  );
}
