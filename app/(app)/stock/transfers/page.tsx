import { requireCtx } from "@/lib/session";
import { listTransfers } from "@/lib/services/stock-ops";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { requestTransferAction } from "@/app/actions-ops";
import { Flash, Link, PageHead, Status, dt, label } from "@/components/ui";
import { StockTabs } from "@/components/StockTabs";
import { LineRows } from "@/components/LineRows";
import { D } from "@/lib/money";

const STATES = ["", "requested", "approved", "dispatched", "received", "rejected", "cancelled"];

export default async function Transfers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listTransfers(ctx, sp.status ?? "");
  const m = await masters(ctx);
  const here = ctx.currentBranchId;
  return (
    <>
      <PageHead title="Transfers between branches" sub="Requested, approved by the supplying branch manager, dispatched into transit, received. No sale and no VAT." />
      <StockTabs at="/stock/transfers" />
      <Flash sp={sp} />
      {here && can(ctx, "stock", "create", here) && (
        <details className="card"><summary><b>Ask another branch for parts</b></summary>
          <form action={requestTransferAction} style={{ marginTop: 12 }}>
            <div className="row"><div className="field"><label>From branch</label><select name="from_branch_id" required defaultValue=""><option value="" disabled>Choose a branch</option>{m.branches.filter((b) => b.id !== here).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}</select></div>
              <div className="field"><label>Note</label><input name="note" placeholder="Why it is needed" /></div></div>
            <LineRows items={m.items} qtyName="qty" qtyLabel="Quantity" />
            <div style={{ marginTop: 10 }}><button className="btn">Send request</button></div>
          </form>
        </details>
      )}
      <div className="tabs">{STATES.map((s) => <Link key={s} className={(sp.status ?? "") === s ? "on" : ""} href={`/stock/transfers${s ? `?status=${s}` : ""}`}>{s ? label(s) : "All"}</Link>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>Transfer</th><th>From</th><th>To</th><th>Status</th><th className="num">Lines</th><th>Requested by</th><th>Last step</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id}><td><Link href={`/stock/transfers/${t.id}`}>{t.doc_no}</Link></td><td>{t.from_code}</td><td>{t.to_code}</td>
              <td><Status s={t.status} />{D(t.short_qty).gt(0) && <span className="pill red">short {D(t.short_qty).toString()}</span>}</td>
              <td className="num">{t.lines}</td><td className="small">{t.requested_name}</td><td className="small muted">{dt(t.last_at)}</td></tr>
          ))}{!rows.length && <tr><td colSpan={7} className="muted">No transfers.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
