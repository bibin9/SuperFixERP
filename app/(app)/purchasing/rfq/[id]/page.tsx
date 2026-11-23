import { requireCtx } from "@/lib/session";
import { getRfq } from "@/lib/services/rfq";
import { rfqStepAction } from "@/app/actions-ops";
import { Popup } from "@/components/Popup";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, Link, Money, PageHead, Status, d, dt } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { D } from "@/lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */
const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** PU-08: one price request, its supplier quotes side by side, and ordering from the chosen suppliers. */
export default async function Rfq({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { r, lines, quotes, price, best, totals, suppliers, showCost, canEdit } = await getRfq(ctx, id);
  const quoteForm = (q: any | null) => (
    <form action={rfqStepAction}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="step" value="quote" />
      {q ? <input type="hidden" name="supplier_id" value={q.supplier_id} /> :
        <div className="field"><label>Supplier</label><select name="supplier_id" required defaultValue=""><option value="" disabled>Choose a supplier</option>
          {suppliers.filter((s) => !quotes.some((x) => x.supplier_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</select></div>}
      <table>
        <thead><tr><th>Part</th><th className="num">Qty</th><th className="num">Unit price before VAT (AED)</th></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td>
          <td className="num"><input name={`price[${l.id}]`} inputMode="decimal" defaultValue={q ? price[q.id]?.[l.id] ?? "" : ""} placeholder="not quoted" aria-label={`Price for ${l.description}`} style={{ width: 120 }} /></td></tr>)}</tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="field"><label>Lead time (days)</label><input name="lead_days" inputMode="numeric" defaultValue={q?.lead_days ?? ""} /></div>
        <div className="field"><label>Quote valid until</label><input type="date" name="valid_until" defaultValue={q?.valid_until ? new Date(q.valid_until).toISOString().slice(0, 10) : ""} /></div>
      </div>
      <div className="field"><label>Note</label><input name="note" defaultValue={q?.note ?? ""} placeholder="e.g. brand offered, payment terms" /></div>
      <button className="btn green">Save quote</button>
    </form>
  );
  const open = r.status === "open";
  return (
    <>
      <PageHead title={`Price request ${r.doc_no}`} sub={`${r.branch_code} · made by ${r.created_by_name ?? "—"} ${dt(r.created_at)}${r.needed_by ? ` · needed by ${day(r.needed_by)}` : ""}${r.note ? ` · ${r.note}` : ""}`}>
        <Status s={r.status} />
        {canEdit && <Popup id="add-quote" title="Enter a supplier's quote" label="+ Supplier quote" className="btn sm" wide>{quoteForm(null)}</Popup>}
      </PageHead>
      <PurchTabs at="/purchasing/rfq" />
      <Flash sp={sp} />
      {!showCost && <div className="flash warn">Prices are hidden for your role.</div>}
      <form action={rfqStepAction} className="card">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="step" value="order" />
        <h2>Compare quotes</h2>
        {!quotes.length && <p className="small muted">No quotes yet. Press <b>+ Supplier quote</b> to enter what each supplier offered.</p>}
        <div style={{ overflowX: "auto" }}>
        <table className="compare">
          <thead>
            <tr><th>Part</th><th className="num">Qty</th>{quotes.map((q) => <th key={q.id} className="num">{q.supplier_name}
              {canEdit && <div><Popup id={`quote-${q.id}`} title={`Quote from ${q.supplier_name}`} label="Edit" className="btn ghost sm" wide>{quoteForm(q)}</Popup></div>}</th>)}
              {open && quotes.length > 0 && <th>Order from</th>}{lines.some((l) => l.po_no) && <th>Ordered on</th>}</tr>
          </thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.description}</td><td className="num">{D(l.qty).toString()}</td>
              {quotes.map((q) => { const p = price[q.id]?.[l.id]; return (
                <td key={q.id} className={`num${best[l.id] === q.id ? " best" : ""}`}>{p === undefined ? <span className="muted">—</span> : <><Money v={p} /><div className="small muted"><Money v={D(p).mul(l.qty).toFixed(2)} /></div></>}</td>); })}
              {open && quotes.length > 0 && <td>{l.po_id ? <span className="small muted">ordered</span> :
                <select name={`pick[${l.id}]`} defaultValue={best[l.id] ?? "skip"} aria-label={`Order ${l.description} from`}>
                  {quotes.filter((q) => price[q.id]?.[l.id] !== undefined).map((q) => <option key={q.id} value={q.id}>{q.supplier_name}{best[l.id] === q.id ? " (best)" : ""}</option>)}
                  <option value="skip">Do not order now</option></select>}</td>}
              {lines.some((x) => x.po_no) && <td>{l.po_id ? <Link href={`/purchasing/${l.po_id}`}>{l.po_no}</Link> : ""}</td>}</tr>
          ))}</tbody>
          {quotes.length > 0 && <tfoot>
            <tr><td colSpan={2}>Total of quoted lines (AED, before VAT)</td>{quotes.map((q) => <td key={q.id} className="num"><b><Money v={totals[q.id].total} /></b><div className="small muted">{totals[q.id].quoted} of {lines.length} lines</div></td>)}{open && <td></td>}{lines.some((l) => l.po_no) && <td></td>}</tr>
            <tr><td colSpan={2}>Lead time</td>{quotes.map((q) => <td key={q.id} className="num">{q.lead_days === null ? "—" : `${q.lead_days} day${q.lead_days === 1 ? "" : "s"}`}</td>)}{open && <td></td>}{lines.some((l) => l.po_no) && <td></td>}</tr>
            <tr><td colSpan={2}>Valid until</td>{quotes.map((q) => <td key={q.id} className="num small">{day(q.valid_until) || "—"}{q.note && <div className="muted">{q.note}</div>}</td>)}{open && <td></td>}{lines.some((l) => l.po_no) && <td></td>}</tr>
          </tfoot>}
        </table>
        </div>
        <p className="small muted">The cheapest price for each part is marked in green (on a tie, the shorter lead time). Choose a different supplier for any line under <b>Order from</b>.</p>
        {canEdit && quotes.length > 0 && <div className="row"><div className="shrink"><ConfirmButton className="btn" message="Raise draft purchase orders, one per supplier, at the quoted prices? You then send each for approval.">Raise purchase orders</ConfirmButton></div></div>}
      </form>
      {canEdit && !lines.some((l) => l.po_id) && <form action={rfqStepAction} className="no-print"><input type="hidden" name="id" value={id} /><input type="hidden" name="step" value="cancel" />
        <ConfirmButton className="btn ghost sm" message="Cancel this price request?">Cancel price request</ConfirmButton></form>}
    </>
  );
}
