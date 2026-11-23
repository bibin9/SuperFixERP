import { requireCtx } from "@/lib/session";
import { listRfqs } from "@/lib/services/rfq";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { createRfqAction } from "@/app/actions-ops";
import { LineRows } from "@/components/LineRows";
import { Flash, Link, PageHead, Status, d, dt } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** PU-08: price requests to several suppliers, compared before ordering. */
export default async function Rfqs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, m] = await Promise.all([listRfqs(ctx), masters(ctx)]);
  const here = ctx.currentBranchId;
  return (
    <>
      <PageHead title="Price requests" sub="Ask several suppliers for a price, compare their quotes on price and lead time, then order each part from the supplier you choose." />
      <PurchTabs at="/purchasing/rfq" />
      <Flash sp={sp} />
      {here && can(ctx, "purchasing", "create", here) && (
        <details className="card" open={!rows.length}><summary><b>New price request</b></summary>
          <form action={createRfqAction} style={{ marginTop: 12 }}>
            <LineRows items={m.items} qtyName="qty" qtyLabel="Quantity" />
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field"><label>Needed by</label><input type="date" name="needed_by" /></div>
              <div className="field"><label>Note for the suppliers</label><input name="note" placeholder="e.g. genuine parts only" /></div>
              <div className="shrink"><button className="btn">Create price request</button></div>
            </div>
          </form>
        </details>
      )}
      <div className="card">
        <table>
          <thead><tr><th>Request</th><th>Branch</th><th>Status</th><th className="num">Parts</th><th className="num">Quotes</th><th>Needed by</th><th>Made</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link href={`/purchasing/rfq/${r.id}`}>{r.doc_no}</Link></td><td>{r.branch_code}</td><td><Status s={r.status} /></td>
              <td className="num">{r.lines}</td><td className="num">{r.quotes}</td><td>{day(r.needed_by)}</td><td className="small muted">{dt(r.created_at)}</td></tr>
          ))}</tbody>
        </table>
        {!rows.length && <p className="small muted">No price requests yet.</p>}
      </div>
    </>
  );
}
