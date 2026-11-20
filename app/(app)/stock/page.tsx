import { requireCtx } from "@/lib/session";
import { QuickAdd } from "@/components/QuickAdd";
import { quickSpec } from "@/lib/services/quick-add";
import { stockList } from "@/lib/services/stock";
import { masters } from "@/lib/services/masters";
import { can, canSee } from "@/lib/access";
import { receiveStockAction } from "@/app/actions";
import { Flash, Money, PageHead } from "@/components/ui";
import { D } from "@/lib/money";
import { StockTabs } from "@/components/StockTabs";
import { Link } from "@/components/ui";

export default async function Stock({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await stockList(ctx, sp.q ?? "");
  const m = await masters(ctx);
  const qi = await quickSpec(ctx, "items");
  const cost = canSee(ctx, "purchase_cost");
  return (
    <>
      <PageHead title="Stock by branch" sub="Quantities at every branch are visible to all branches; cost and value only for your own branches with cost access." />
      <StockTabs at="/stock" />
      <Flash sp={sp} />
      {can(ctx, "stock", "create") && (
        <details className="card"><summary><b>Opening stock or a receipt without a purchase order</b></summary>
          <form action={receiveStockAction} className="row">
            <div className="field"><label>Item</label><div className="picker"><select name="item_id">{m.items.map((i) => <option key={i.id} value={i.id}>{i.part_no} · {i.description}</option>)}</select>{qi && <QuickAdd spec={qi} target="item_id" label="+ New part" />}</div></div>
            <div className="field"><label>Quantity</label><input name="qty" required /></div>
            <div className="field"><label>Unit cost (AED)</label><input name="unit_cost" required /></div>
            <div className="field"><label>Type</label><select name="kind"><option value="receipt">Receipt (before supplier bill)</option><option value="opening">Opening stock</option></select></div>
            <div className="field"><label>Reference</label><input name="ref" placeholder="GRN / delivery note" /></div>
            <div className="shrink"><button className="btn">Receive</button></div>
          </form>
          <p className="small muted">Received quantity goes first to jobs waiting for this part. Normal buying goes through Purchasing (order, goods received, supplier bill).</p>
        </details>
      )}
      <div className="card">
        <form className="row" style={{ marginBottom: 10 }}><div className="field"><label htmlFor="q">Search parts</label><input id="q" name="q" defaultValue={sp.q} placeholder="Part no. or description" /></div><button className="btn ghost shrink">Filter</button></form>
        <table>
          <thead><tr><th>Part</th><th>Branch</th><th className="num">On hand</th><th className="num">Committed</th><th className="num">Reserved</th><th className="num">Free</th>{cost && <th className="num">Avg cost</th>}{cost && <th className="num">Value</th>}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.item_id + r.branch_code}><td><Link href={`/stock/ledger?item=${r.item_id}&branch=${r.branch_id}`}>{r.part_no}</Link><div className="small muted">{r.description}</div></td><td>{r.branch_code}</td>
              <td className="num">{D(r.on_hand).toString()}</td><td className="num">{D(r.committed).toString()}</td><td className="num">{D(r.reserved).toString()}</td><td className="num"><b>{D(r.free).toString()}</b></td>
              {cost && <td className="num">{"avg_cost" in r ? <Money v={r.avg_cost} /> : <span className="muted">—</span>}</td>}
              {cost && <td className="num">{"stock_value" in r ? <Money v={r.stock_value} /> : <span className="muted">—</span>}</td>}</tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
