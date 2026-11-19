import { OlderRows } from "@/components/OlderRows";
import { offsetOf } from "@/lib/paging";
import { requireCtx } from "@/lib/session";
import { listPos } from "@/lib/services/purchasing";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { createPoAction } from "@/app/actions-ops";
import { Flash, Link, Money, PageHead, Status, d, label } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { D } from "@/lib/money";

const STATES = ["", "draft", "pending_approval", "approved", "partly_received", "received", "rejected", "cancelled"];

export default async function Pos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, m] = await Promise.all([listPos(ctx, sp.status ?? "", offsetOf(sp)), masters(ctx)]);
  const here = ctx.currentBranchId;
  return (
    <>
      <PageHead title="Purchase orders" sub="Orders go for approval by amount (approval workflows). An approved order is locked; changing it sends it back for approval." />
      <PurchTabs at="/purchasing" />
      <Flash sp={sp} />
      {here && can(ctx, "purchasing", "create", here) && (
        <details className="card"><summary><b>New purchase order</b></summary>
          <form action={createPoAction} className="row" style={{ marginTop: 12 }}>
            <div className="field"><label>Supplier</label><select name="supplier_id" required defaultValue=""><option value="" disabled>Choose a supplier</option>{m.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</select></div>
            <div className="field"><label>Delivery date</label><input type="date" name="delivery_date" /></div>
            <div className="field"><label>Terms</label><input name="terms" placeholder="e.g. 30 days" /></div>
            <div className="shrink"><button className="btn">Create and add lines</button></div>
          </form>
        </details>
      )}
      <div className="tabs">{STATES.map((s) => <Link key={s} className={(sp.status ?? "") === s ? "on" : ""} href={`/purchasing${s ? `?status=${s}` : ""}`}>{s ? label(s) : "All"}</Link>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>Order</th><th>Branch</th><th>Supplier</th><th>Status</th><th className="num">Received</th><th className="num">Total incl. VAT</th><th>Delivery</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}><td><Link href={`/purchasing/${p.id}`}>{p.doc_no}</Link></td><td>{p.branch_code}</td><td>{p.supplier_name}</td><td><Status s={p.status} /></td>
              <td className="num">{D(p.received).toString()} of {D(p.ordered).toString()}</td><td className="num">{"grand_total" in p ? <Money v={p.grand_total} /> : <span className="muted">hidden</span>}</td>
              <td className="small">{p.delivery_date ? d(new Date(p.delivery_date).toISOString().slice(0, 10)) : "—"}</td></tr>
          ))}{!rows.length && <tr><td colSpan={7} className="muted">No purchase orders.</td></tr>}</tbody>
        </table>
      </div>
      <OlderRows rows={rows} base="/purchasing" sp={sp} />
    </>
  );
}
