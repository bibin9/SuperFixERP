import { requireCtx } from "@/lib/session";
import { directPurchases } from "@/lib/services/purchasing";
import { can } from "@/lib/access";
import { directPurchaseAction } from "@/app/actions-ops";
import { Flash, Link, Money, PageHead, dt } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";

export default async function DirectPurchase({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const d = await directPurchases(ctx);
  const job = d.jobs.find((j) => j.id === sp.job);
  const b = ctx.currentBranchId;
  return (
    <>
      <PageHead title="Buy a part for a job" sub="A part bought from a local shop for one car. It goes on that job card at cost and never into stock. Paid from petty cash with the receipt photo.">
        <span className="pill">Petty cash AED <Money v={d.balance} /></span>
      </PageHead>
      <PurchTabs at="/purchasing/direct" />
      <Flash sp={sp} />
      {can(ctx, "purchasing", "create", b) && (
        <div className="card">
          <h2>Record a purchase for a job</h2>
          <form className="row" action="/purchasing/direct" style={{ alignItems: "flex-end" }}>
            <div className="field"><label>Job card</label><select name="job" defaultValue={sp.job ?? ""} required><option value="" disabled>Choose the job</option>{d.jobs.map((j) => <option key={j.id} value={j.id}>{j.doc_no} · {j.make} {j.model}</option>)}</select></div>
            <button className="btn ghost shrink">Choose</button>
          </form>
          {job && (
            <form action={directPurchaseAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="job_id" value={job.id} />
              <div className="row">
                <div className="field"><label>For which line</label><select name="job_line_id" defaultValue="new" required>
                  <option value="new">New line on the job (the customer approves it first)</option>
                  {(job.lines as { id: string; no: number; d: string }[]).map((l) => <option key={l.id} value={l.id}>Line {l.no}: {l.d}</option>)}</select></div>
                <div className="field"><label>Part bought</label><input name="description" required placeholder="AC expansion valve" /></div>
              </div>
              <div className="row">
                <div className="field"><label>Shop or supplier</label><input name="supplier_name" required /></div>
                <div className="field"><label>Their TRN (if on the receipt)</label><input name="supplier_trn" inputMode="numeric" /></div>
              </div>
              <div className="row">
                <div className="field"><label>Cost before VAT</label><input name="net_amount" required inputMode="decimal" /></div>
                <div className="field"><label>VAT</label><input name="vat_amount" placeholder="0" inputMode="decimal" /></div>
                <div className="field"><label>Price to the customer (new line, optional)</label><input name="unit_price" inputMode="decimal" placeholder="Same as cost" /></div>
              </div>
              <div className="field"><label>Receipt photo</label><input type="file" name="photo" accept="image/*,application/pdf" capture="environment" required /></div>
              <button className="btn">Add to the job at cost</button>
            </form>
          )}
          {!d.jobs.length && <p className="muted small">No open job cards at this branch.</p>}
        </div>
      )}
      <div className="card">
        <table>
          <thead><tr><th>Entry</th><th>Job</th><th>Part</th><th>Shop</th><th className="num">Cost</th><th className="num">VAT</th><th>Receipt</th><th>By</th></tr></thead>
          <tbody>{d.list.map((e) => (
            <tr key={e.id}><td>{e.doc_no}<div className="small muted">{dt(e.entry_date)}</div></td><td><Link href={`/jobs/${e.job_id}`}>{e.job_no}</Link>{e.line_no ? <div className="small muted">line {e.line_no}</div> : null}</td>
              <td>{e.description}</td><td>{e.supplier_name}</td><td className="num"><Money v={e.net_amount} /></td><td className="num"><Money v={e.vat_amount} /></td>
              <td>{e.attachment_id ? <a href={`/api/attachments/${e.attachment_id}`} target="_blank" rel="noreferrer">View</a> : ""}</td><td className="small">{e.full_name}</td></tr>
          ))}{!d.list.length && <tr><td colSpan={8} className="muted">Nothing bought for jobs yet.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
