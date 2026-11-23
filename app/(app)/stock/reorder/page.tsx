import { ScanBox } from "@/components/ScanBox";
import { requireCtx } from "@/lib/session";
import { reorderList } from "@/lib/services/stock-ops";
import { suppliers } from "@/lib/services/purchasing";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { reorderPoAction, reorderTransferAction, reorderLevelAction } from "@/app/actions-ops";
import { Flash, Link, PageHead } from "@/components/ui";
import { D } from "@/lib/money";

export default async function Reorder({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const b = ctx.currentBranchId;
  const all = sp.all === "1";
  const canPo = can(ctx, "purchasing", "create", b);
  const canTr = can(ctx, "stock", "create", b);
  const canSet = can(ctx, "stock", "edit", b);
  const [rows, sups, m] = await Promise.all([reorderList(ctx, all), canPo ? suppliers(ctx) : Promise.resolve([]), all && canSet ? masters(ctx) : Promise.resolve(null)]);
  const low = rows.filter((r) => r.low);
  const fresh = low.filter((r) => D(r.onOrder).lte(0));
  return (
    <>
      <PageHead title="Low stock" sub="Parts at or below their reorder level at this branch. Ask another branch or raise a purchase order in one click.">
        <Link className="btn ghost sm" href={all ? "/stock/reorder" : "/stock/reorder?all=1"}>{all ? "Show low stock only" : "Reorder levels"}</Link>
      </PageHead>
      <Flash sp={sp} />
      {!all && (low.length
        ? <div className="callout warn"><b>{low.length} part{low.length === 1 ? "" : "s"} at or below the reorder level.</b> {fresh.length ? `${fresh.length} not yet on order.` : "All are already on order."}</div>
        : <div className="card"><p className="muted">Nothing is below its reorder level at this branch.</p></div>)}
      {(all || low.length > 0) && (
        <div className="card">
          <table>
            <thead><tr><th>Part</th><th className="num">Free</th><th className="num">Reorder level</th><th className="num">On order</th><th>Days of cover</th><th>Other branches</th><th>Action</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.item_id}>
                <td><b>{r.part_no}</b><div className="small muted">{r.description}{r.default_bin ? ` · bin ${r.default_bin}` : ""}</div></td>
                <td className="num"><span className={r.low ? (D(r.free).lte(0) || D(r.free).lte(D(r.reorder_level).div(2)) ? "pill red" : "pill amber") : ""}>{D(r.free).toString()}</span></td>
                <td className="num">{D(r.reorder_level).toString()}<div className="small muted">order {D(r.reorder_qty).toString()}</div></td>
                <td className="num">{D(r.onOrder).gt(0) ? D(r.onOrder).toString() : <span className="muted">—</span>}</td>
                <td>{r.cover === null ? <span className="muted small">no use in 30 days</span> : `${r.cover} day${r.cover === 1 ? "" : "s"}`}</td>
                <td className="small">{(r.elsewhere as { code: string; free: string }[]).slice(0, 4).map((o) => <div key={o.code}>{o.code}: {D(o.free).toString()}</div>)}{!(r.elsewhere as unknown[]).length && <span className="muted">none free</span>}</td>
                <td>
                  {all && canSet && (
                    <form action={reorderLevelAction} className="row" style={{ margin: 0 }}><input type="hidden" name="item_id" value={r.item_id} />
                      <input name="reorder_level" defaultValue={D(r.reorder_level).toString()} aria-label={`Reorder level for ${r.part_no}`} style={{ width: 80 }} />
                      <input name="reorder_qty" defaultValue={D(r.reorder_qty).toString()} aria-label={`Reorder quantity for ${r.part_no}`} style={{ width: 80 }} />
                      <button className="btn ghost sm shrink">Save</button></form>
                  )}
                  {!all && <>
                    {canTr && (r.elsewhere as { id: string; code: string; free: string }[]).length > 0 && (
                      <form action={reorderTransferAction} className="row" style={{ margin: "0 0 6px" }}><input type="hidden" name="item_id" value={r.item_id} />
                        <select name="from_branch_id" aria-label="Ask which branch">{(r.elsewhere as { id: string; code: string; free: string }[]).map((o) => <option key={o.id} value={o.id}>{o.code} ({D(o.free).toString()} free)</option>)}</select>
                        <input name="qty" defaultValue={r.suggest} style={{ width: 70 }} aria-label="Quantity to ask for" /><button className="btn ghost sm shrink">Ask branch</button></form>
                    )}
                    {canPo && (
                      <form action={reorderPoAction} className="row" style={{ margin: 0 }}><input type="hidden" name="item_id" value={r.item_id} />
                        <select name="supplier_id" defaultValue={r.preferred_supplier_id ?? ""} aria-label="Supplier"><option value="" disabled>Supplier</option>{sups.map((s: { id: string; name_en: string }) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</select>
                        <input name="qty" defaultValue={r.suggest} style={{ width: 70 }} aria-label="Quantity to order" /><button className="btn sm shrink">Raise PO</button></form>
                    )}
                  </>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {all && canSet && m && (
            <form action={reorderLevelAction} className="row" style={{ marginTop: 14, alignItems: "flex-end" }}>
              <div className="field"><label>Scan</label><ScanBox /></div>
              <div className="field"><label>Another part</label><select name="item_id" required defaultValue=""><option value="" disabled>Choose the part</option>{m.items.filter((i) => !rows.some((r) => r.item_id === i.id)).map((i) => <option key={i.id} value={i.id} data-codes={i.codes}>{i.part_no} · {i.description}</option>)}</select></div>
              <div className="field"><label>Reorder level</label><input name="reorder_level" required inputMode="decimal" /></div>
              <div className="field"><label>Reorder quantity</label><input name="reorder_qty" required inputMode="decimal" /></div>
              <button className="btn ghost shrink">Add</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
