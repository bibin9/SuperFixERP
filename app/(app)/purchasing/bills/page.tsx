import { OlderRows } from "@/components/OlderRows";
import { offsetOf } from "@/lib/paging";
import { requireCtx } from "@/lib/session";
import { listBills } from "@/lib/services/purchasing";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";

export default async function Bills({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, m] = await Promise.all([listBills(ctx, offsetOf(sp)), masters(ctx)]);
  const here = ctx.currentBranchId;
  const canEnter = !!here && (can(ctx, "purchasing", "edit", here) || can(ctx, "accounting", "create", here));
  return (
    <>
      <PageHead title="Supplier bills" sub="Each bill line is matched to the order price and the received quantity. A mismatch goes to the accountant; a bill cannot be paid until it is posted." />
      <PurchTabs at="/purchasing/bills" />
      <Flash sp={sp} />
      {canEnter && (
        <form action="/purchasing/bills/new" className="card row"><div className="field"><label>Enter a bill from</label><select name="supplier_id" required>{m.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</select></div>
          <div className="shrink"><button className="btn">Next</button></div></form>
      )}
      <div className="card">
        <table>
          <thead><tr><th>Bill</th><th>Supplier</th><th>Their invoice</th><th>Match</th><th>Status</th><th className="num">Total</th><th>Due</th></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}><td><Link href={`/purchasing/bills/${b.id}`}>{b.doc_no}</Link><div className="small muted">{b.branch_code}</div></td><td>{b.supplier_name}</td><td>{b.supplier_invoice_no}</td>
              <td><Status s={b.match_status} /></td><td><Status s={b.status} /></td><td className="num">{"grand_total" in b ? <Money v={b.grand_total} /> : <span className="muted">hidden</span>}</td>
              <td className="small">{b.due_date ? d(new Date(b.due_date).toISOString().slice(0, 10)) : ""}</td></tr>
          ))}{!rows.length && <tr><td colSpan={7} className="muted">No supplier bills yet.</td></tr>}</tbody>
        </table>
      </div>
      <OlderRows rows={rows} base="/purchasing/bills" sp={sp} />
    </>
  );
}
