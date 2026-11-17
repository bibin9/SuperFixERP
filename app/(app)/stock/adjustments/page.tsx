import { requireCtx } from "@/lib/session";
import { listAdjustments, listCounts } from "@/lib/services/stock-ops";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { adjustmentAction, startCountAction } from "@/app/actions-ops";
import { Flash, Link, Money, PageHead, Status, dt, label } from "@/components/ui";
import { StockTabs } from "@/components/StockTabs";
import { LineRows } from "@/components/LineRows";

export default async function Adjustments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, counts, m] = await Promise.all([listAdjustments(ctx), listCounts(ctx), masters(ctx)]);
  const here = ctx.currentBranchId;
  const reasons = m.lookups.filter((l) => l.list === "adjustment_reason");
  const cats = [...new Set(m.items.map((i) => i.category))];
  const canCreate = !!here && can(ctx, "stock", "create", here);
  return (
    <>
      <PageHead title="Adjustments and stock counts" sub="Nothing posts until the branch manager approves. Each reason goes to its own account." />
      <StockTabs at="/stock/adjustments" />
      <Flash sp={sp} />
      {canCreate && (
        <div className="grid2">
          <details className="card"><summary><b>New stock adjustment</b></summary>
            <form action={adjustmentAction} style={{ marginTop: 12 }}>
              <div className="row"><div className="field"><label>Reason</label><select name="reason" required>{reasons.map((r) => <option key={r.code} value={r.code}>{r.name_en}</option>)}</select></div>
                <div className="field"><label>Note</label><input name="note" placeholder="What happened" /></div></div>
              <LineRows items={m.items} qtyName="qty_change" qtyLabel="Change (+ or −)" qtyHint="-2 or 3" />
              <div style={{ marginTop: 10 }}><button className="btn">Send for approval</button></div>
            </form>
          </details>
          <div className="card"><h2>Stock count</h2>
            <form action={startCountAction} className="row"><div className="field"><label>Category</label><select name="category"><option value="">All stock items</option>{cats.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
              <div className="shrink"><button className="btn">Start a count sheet</button></div></form>
            <p className="small muted">Blind count: the counter does not see the book quantity. Differences go to the branch manager as one adjustment.</p>
          </div>
        </div>
      )}
      <div className="card"><h2>Stock counts</h2>
        <table><thead><tr><th>Count</th><th>Branch</th><th>Category</th><th>Status</th><th className="num">Counted</th><th>Adjustment</th><th>Started</th></tr></thead>
          <tbody>{counts.map((c) => <tr key={c.id}><td><Link href={`/stock/counts/${c.id}`}>{c.doc_no}</Link></td><td>{c.branch_code}</td><td>{c.category ? label(c.category) : "All"}</td>
            <td><Status s={c.status} /></td><td className="num">{c.counted} of {c.lines}</td><td>{c.adjustment_no ?? "—"}</td><td className="small muted">{dt(c.created_at)}</td></tr>)}
          {!counts.length && <tr><td colSpan={7} className="muted">No counts yet.</td></tr>}</tbody></table>
      </div>
      <div className="card"><h2>Adjustments</h2>
        <table><thead><tr><th>Adjustment</th><th>Branch</th><th>Reason</th><th>Parts</th><th className="num">Value</th><th>Status</th><th>By</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td>{a.doc_no}</td><td>{a.branch_code}</td><td>{a.reason_name ?? label(a.reason)}<div className="small muted">{a.note}</div></td>
            <td className="small">{a.summary}</td><td className="num">{"value" in a ? (a.status === "approved" ? <Money v={a.value} /> : "—") : <span className="muted">hidden</span>}</td>
            <td><Status s={a.status} /></td><td className="small">{a.created_name}<div className="muted">{dt(a.created_at)}</div></td></tr>)}
          {!rows.length && <tr><td colSpan={7} className="muted">No adjustments yet.</td></tr>}</tbody></table>
      </div>
    </>
  );
}
