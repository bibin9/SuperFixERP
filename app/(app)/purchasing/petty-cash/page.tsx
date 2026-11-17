import { requireCtx } from "@/lib/session";
import { pettyCash } from "@/lib/services/purchasing";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { pettyCashAction } from "@/app/actions-ops";
import { Flash, Money, PageHead, dt, label } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";

export default async function PettyCash({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [pc, m] = await Promise.all([pettyCash(ctx), masters(ctx)]);
  const b = ctx.currentBranchId;
  const types = m.lookups.filter((l) => l.list === "expense_type");
  return (
    <>
      <PageHead title="Petty cash" sub="Small purchases paid in cash at this branch. A photo of the receipt is required; VAT is claimed only with the shop's TRN."><span className="pill">Balance AED <Money v={pc.balance} /></span></PageHead>
      <PurchTabs at="/purchasing/petty-cash" />
      <Flash sp={sp} />
      <div className="grid2">
        {can(ctx, "purchasing", "create", b) && (
          <form action={pettyCashAction} className="card"><h2>Record a purchase</h2>
            <input type="hidden" name="kind" value="spend" />
            <div className="row"><div className="field"><label>Shop or supplier</label><input name="supplier_name" required /></div><div className="field"><label>Their TRN (if on the receipt)</label><input name="supplier_trn" inputMode="numeric" /></div></div>
            <div className="row"><div className="field"><label>Expense type</label><select name="expense_type">{types.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div><div className="field"><label>What was bought</label><input name="description" /></div></div>
            <div className="row"><div className="field"><label>Amount before VAT</label><input name="net_amount" required inputMode="decimal" /></div><div className="field"><label>VAT</label><input name="vat_amount" placeholder="0" inputMode="decimal" /></div></div>
            <div className="field"><label>Receipt photo (required)</label><input type="file" name="photo" accept="image/*,application/pdf" capture="environment" required /></div>
            <button className="btn">Save</button>
          </form>
        )}
        {(can(ctx, "accounting", "create", b) || can(ctx, "purchasing", "approve", b)) && (
          <form action={pettyCashAction} className="card"><h2>Top up the box</h2>
            <input type="hidden" name="kind" value="top_up" />
            <div className="row"><div className="field"><label>Amount</label><input name="amount" required inputMode="decimal" /></div><div className="field"><label>Note</label><input name="note" /></div></div>
            <button className="btn ghost">Top up</button>
          </form>
        )}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Entry</th><th>Type</th><th>Shop</th><th className="num">Amount</th><th className="num">VAT</th><th>Receipt</th><th>By</th></tr></thead>
          <tbody>{pc.rows.map((e) => (
            <tr key={e.id}><td>{e.doc_no}<div className="small muted">{dt(e.created_at)}</div></td><td>{e.kind === "top_up" ? "Top-up" : e.expense_name ?? label(e.expense_type)}<div className="small muted">{e.description}</div></td>
              <td>{e.supplier_name}<div className="small muted">{e.supplier_trn}</div></td><td className="num">{e.kind === "top_up" ? "+" : "−"}<Money v={e.net_amount} /></td><td className="num"><Money v={e.vat_amount} /></td>
              <td>{e.attachment_id ? <a href={`/api/attachments/${e.attachment_id}`} target="_blank">View</a> : ""}</td><td className="small">{e.full_name}</td></tr>
          ))}{!pc.rows.length && <tr><td colSpan={7} className="muted">No entries yet.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
