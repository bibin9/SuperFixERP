import { requireCtx } from "@/lib/session";
import { listAssets, depreciationRuns } from "@/lib/services/accounting-close";
import { bankAccounts } from "@/lib/services/accounting";
import { finScope } from "@/lib/services/financials";
import { assetAction } from "@/app/actions-accounting";
import { withTx } from "@/lib/db";
import { canAnywhere } from "@/lib/access";
import { Flash, Money, PageHead, Status, d, dt } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function Assets({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [assets, runs, banks, scope] = await Promise.all([listAssets(ctx), depreciationRuns(ctx), bankAccounts(ctx), finScope(ctx, undefined)]);
  const cats = await withTx(ctx, async (c) => (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'asset_category' AND active ORDER BY sort")).rows);
  const canCreate = canAnywhere(ctx, "accounting", "create"), canDispose = canAnywhere(ctx, "accounting", "approve");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const lastMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  return (
    <>
      <PageHead title="Fixed assets" sub="Asset register with straight-line depreciation, run once a month from the month after purchase down to the value at the end of its life." />
      <AccountsTabs group="monthend" at="/accounts/assets" />
      <Flash sp={sp} />
      <div className="card">
        <table>
          <thead><tr><th>Asset</th><th>Name</th><th>Category</th><th>Branch</th><th>Bought</th><th className="num">Cost</th><th className="num">Monthly</th><th className="num">Depreciated</th><th className="num">Book value</th><th>Status</th><th className="no-print"></th></tr></thead>
          <tbody>{assets.map((a) => (
            <tr key={a.id}><td>{a.asset_no}</td><td>{a.name}</td><td>{cats.find((c) => c.code === a.category)?.name_en ?? a.category}</td><td>{a.branch_code}</td><td>{d(String(a.acquired_on).slice(0, 10))}</td>
              <td className="num"><Money v={a.cost} /></td><td className="num"><Money v={a.monthly} /></td><td className="num"><Money v={a.depreciated} /></td><td className="num"><Money v={a.book_value} /></td>
              <td><Status s={a.status} />{a.disposed_on && <div className="small muted">{d(String(a.disposed_on).slice(0, 10))} for {Number(a.disposal_amount).toFixed(2)}</div>}</td>
              <td className="no-print">{a.status === "active" && canDispose && (
                <details><summary className="small">Dispose</summary>
                  <form action={assetAction} style={{ minWidth: 240 }}><input type="hidden" name="do" value="dispose" /><input type="hidden" name="asset_id" value={a.id} />
                    <div className="field"><label>Date</label><input type="date" name="date" defaultValue={today} max={today} /></div>
                    <div className="field"><label>Amount received (0 if scrapped)</label><input name="amount" inputMode="decimal" defaultValue="0" /></div>
                    <div className="field"><label>Into bank account</label><select name="bank_account_id">{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                    <ConfirmButton className="btn sm red" message="Dispose of this asset? The gain or loss is posted.">Dispose</ConfirmButton></form></details>)}</td></tr>))}
            {!assets.length && <tr><td colSpan={11} className="muted">No assets yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {canCreate && (
        <div className="grid2">
          <form action={assetAction} className="card"><input type="hidden" name="do" value="add" />
            <h2>Add an asset</h2>
            <div className="row">
              <div className="field"><label>Name</label><input name="name" required /></div>
              <div className="field"><label>Category</label><select name="category">{cats.map((c) => <option key={c.code} value={c.code}>{c.name_en}</option>)}</select></div>
              <div className="field"><label>Branch</label><select name="branch_id" defaultValue={ctx.currentBranchId ?? ""}>{scope.all.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}</select></div>
            </div>
            <div className="row">
              <div className="field"><label>Bought on</label><input type="date" name="acquired_on" max={today} required /></div>
              <div className="field"><label>Cost (AED, before VAT)</label><input name="cost" inputMode="decimal" required /></div>
              <div className="field"><label>Value at the end of its life</label><input name="salvage" inputMode="decimal" defaultValue="0" /></div>
              <div className="field"><label>Useful life (months)</label><input name="life_months" inputMode="numeric" defaultValue="60" required /></div>
            </div>
            <div className="field"><label>Paid from</label><select name="paid_from">{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.bank_name}</option>)}<option value="opening">Already owned (opening balance)</option></select></div>
            <button className="btn green">Add asset</button>
          </form>
          <div className="card"><h2>Monthly depreciation</h2>
            <form action={assetAction} className="row" style={{ alignItems: "flex-end" }}><input type="hidden" name="do" value="depreciate" />
              <div className="field"><label>Month</label><input type="month" name="month" defaultValue={lastMonth} max={today.slice(0, 7)} /></div>
              <div className="shrink"><ConfirmButton className="btn" message="Post depreciation for this month?">Run depreciation</ConfirmButton></div></form>
            <table><thead><tr><th>Month</th><th className="num">Total</th><th>Run by</th></tr></thead>
              <tbody>{runs.map((r) => <tr key={String(r.period_month)}><td>{String(r.period_month).slice(0, 7)}</td><td className="num"><Money v={r.total} /></td><td className="small">{r.run_by_name} · {dt(r.run_at)}</td></tr>)}
                {!runs.length && <tr><td colSpan={3} className="muted">Not run yet.</td></tr>}</tbody></table>
          </div>
        </div>)}
    </>
  );
}
