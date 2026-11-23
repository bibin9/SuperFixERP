import { requireCtx } from "@/lib/session";
import { listClaims, claimOptions } from "@/lib/services/supplier-claims";
import { can } from "@/lib/access";
import { openClaimAction } from "@/app/actions-ops";
import { ScanBox } from "@/components/ScanBox";
import { Flash, Link, PageHead, Status, dt } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { D } from "@/lib/money";

/** OT-05: warranty claims to suppliers for failed parts and tyres. */
export default async function Claims({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const show = ["open", "closed", "all"].includes(sp.show) ? sp.show : "open";
  const [rows, o] = await Promise.all([listClaims(ctx, show), claimOptions(ctx)]);
  const here = ctx.currentBranchId;
  const canOpen = here && (can(ctx, "purchasing", "create", here) || can(ctx, "stock", "create", here));
  return (
    <>
      <PageHead title="Supplier warranty claims" sub="A failed part or tyre goes back to the supplier; the claim ends in a credit, a replacement part, or a rejection." />
      <PurchTabs at="/purchasing/claims" />
      <Flash sp={sp} />
      {canOpen && (
        <details className="card" open={!rows.length && show === "open"}><summary><b>New warranty claim</b></summary>
          <form action={openClaimAction} style={{ marginTop: 12 }}>
            <ScanBox />
            <div className="row">
              <div className="field"><label>Failed part</label><select name="item_id" required defaultValue=""><option value="" disabled>Choose the part</option>{o.items.map((i) => <option key={i.id} value={i.id} data-codes={i.codes}>{i.part_no} · {i.description}</option>)}</select></div>
              <div className="field shrink" style={{ width: 110 }}><label>Quantity</label><input name="qty" defaultValue="1" inputMode="decimal" /></div>
              <div className="field"><label>Supplier</label><select name="supplier_id" required defaultValue=""><option value="" disabled>Choose the supplier</option>{o.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</select></div>
            </div>
            <div className="row">
              <div className="field"><label>Failed on job card</label><select name="job_card_id" defaultValue=""><option value="">—</option>{o.jobs.map((j) => <option key={j.id} value={j.id}>{j.doc_no}</option>)}</select></div>
              <div className="field"><label>Serial or DOT number</label><input name="serial_no" placeholder="battery serial, tyre DOT" /></div>
              <div className="field shrink"><label className="check"><input type="checkbox" name="from_stock" /> Comes off the shelf (not fitted)</label></div>
            </div>
            <div className="field"><label>Fault</label><input name="fault" required placeholder="e.g. battery dead after 3 months, sidewall bulge" /></div>
            <button className="btn">Open claim</button>
          </form>
        </details>
      )}
      <div className="tabs">{["open", "closed", "all"].map((s) => <Link key={s} className={show === s ? "on" : ""} href={`/purchasing/claims?show=${s}`}>{s === "open" ? "Open" : s === "closed" ? "Closed" : "All"}</Link>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>Claim</th><th>Branch</th><th>Part</th><th className="num">Qty</th><th>Supplier</th><th>Job</th><th>Status</th><th>Opened</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link href={`/purchasing/claims/${r.id}`}>{r.doc_no}</Link></td><td>{r.branch_code}</td><td>{r.part_no}<div className="small muted">{r.fault}</div></td>
              <td className="num">{D(r.qty).toString()}</td><td>{r.supplier_name}</td><td>{r.job_no ?? (r.from_stock ? "shelf" : "")}</td>
              <td><Status s={r.status} />{r.overdue && <span className="pill red">No answer</span>}</td><td className="small muted">{dt(r.created_at)}</td></tr>
          ))}</tbody>
        </table>
        {!rows.length && <p className="small muted">No claims here.</p>}
      </div>
    </>
  );
}
