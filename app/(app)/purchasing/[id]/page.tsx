import { RecordHistory } from "@/components/RecordHistory";
import { QuickAdd } from "@/components/QuickAdd";
import { quickSpec } from "@/lib/services/quick-add";
import { docHistory } from "@/lib/services/history";
import { requireCtx } from "@/lib/session";
import { getPo } from "@/lib/services/purchasing";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { poLineAction, poStepAction } from "@/app/actions-ops";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, Link, Money, PageHead, Status, dt, label } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { D } from "@/lib/money";

export default async function PoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const [{ po, lines, grns, approvals }, m] = await Promise.all([getPo(ctx, id), masters(ctx)]);
  const qi = await quickSpec(ctx, "items");
  const b = po.branch_id;
  const cost = "grand_total" in po;
  const editable = ["draft", "rejected", "approved"].includes(po.status) && !lines.some((l) => D(l.received_qty).gt(0)) && (can(ctx, "purchasing", "create", b) || can(ctx, "purchasing", "edit", b));
  const receivable = ["approved", "partly_received"].includes(po.status) && (can(ctx, "stock", "create", b) || can(ctx, "purchasing", "edit", b));
  return (
    <>
      <PageHead title={`Purchase order ${po.doc_no}`} sub={`${po.supplier_name} · ${po.branch_code}${po.terms ? ` · ${po.terms}` : ""}`}><Status s={po.status} /></PageHead>
      <PurchTabs at="/purchasing" />
      <Flash sp={sp} />
      {po.status === "approved" && editable && <div className="flash warn">Approved. Changing a line sends the order back for approval.</div>}
      <div className="card">
        <table>
          <thead><tr><th>#</th><th>Item</th><th>For job</th><th className="num">Qty</th><th className="num">Received</th>{cost && <th className="num">Unit price</th>}{cost && <th className="num">Net</th>}{cost && <th className="num">VAT</th>}<th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td>{l.job_id ? <Link href={`/jobs/${l.job_id}`}>{l.job_no}</Link> : "—"}</td>
              <td className="num">{D(l.qty).toString()}</td><td className="num">{D(l.received_qty).toString()}</td>
              {cost && <td className="num"><Money v={l.unit_price} /></td>}{cost && <td className="num"><Money v={l.net_amount} /></td>}{cost && <td className="num"><Money v={l.vat_amount} /></td>}
              <td>{editable && <form action={poLineAction}><input type="hidden" name="po_id" value={id} /><button name="remove" value={l.id} className="btn ghost sm">Remove</button></form>}</td></tr>
          ))}{!lines.length && <tr><td colSpan={9} className="muted">No lines yet.</td></tr>}</tbody>
          {cost && lines.length > 0 && <tfoot><tr><td colSpan={6}>Total</td><td className="num"><Money v={po.net_total} /></td><td className="num"><Money v={po.vat_total} /></td><td className="num"><Money v={po.grand_total} /></td></tr></tfoot>}
        </table>
        {editable && (
          <form action={poLineAction} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="po_id" value={id} />
            <div className="field"><label>Item</label><div className="picker"><select name="item_id" defaultValue=""><option value="">Not a stock item (describe it)</option>{m.items.map((i) => <option key={i.id} value={i.id}>{i.part_no} · {i.description}</option>)}</select>{qi && <QuickAdd spec={qi} target="item_id" label="+ New part" />}</div></div>
            <div className="field"><label>Description (if not an item)</label><input name="description" /></div>
            <div className="field shrink" style={{ width: 90 }}><label>Qty</label><input name="qty" required /></div>
            <div className="field shrink" style={{ width: 120 }}><label>Unit price (AED)</label><input name="unit_price" required /></div>
            <div className="field shrink" style={{ width: 110 }}><label>Discount</label><input name="discount" placeholder="0" /></div>
            <div className="field shrink" style={{ width: 120 }}><label>Tax</label><select name="vat_code" defaultValue="SR">{m.taxCodes.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}</select></div>
            <div className="shrink"><button className="btn ghost">Add line</button></div>
          </form>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {["draft", "rejected"].includes(po.status) && lines.length > 0 && can(ctx, "purchasing", "create", b) && <form action={poStepAction} className="shrink"><input type="hidden" name="po_id" value={id} /><button name="step" value="submit" className="btn">Submit for approval</button></form>}
          {!["received", "cancelled", "partly_received"].includes(po.status) && can(ctx, "purchasing", "cancel", b) && <form action={poStepAction} className="shrink"><input type="hidden" name="po_id" value={id} /><ConfirmButton name="step" value="cancel" className="btn ghost red-text" message="Cancel this purchase order?">Cancel order</ConfirmButton></form>}
        </div>
      </div>
      {receivable && (
        <form action={poStepAction} className="card"><h2>Goods received</h2>
          <input type="hidden" name="po_id" value={id} />
          <table><thead><tr><th>Item</th><th className="num">Still to come</th><th>Good qty received</th><th>Damaged (not taken)</th></tr></thead>
            <tbody>{lines.filter((l) => l.item_id && D(l.received_qty).lt(l.qty)).map((l) => (
              <tr key={l.id}><td>{l.description}</td><td className="num">{D(l.qty).minus(l.received_qty).toString()}</td>
                <td><input name={`qty[${l.id}]`} defaultValue={D(l.qty).minus(l.received_qty).toString()} style={{ width: 90, minWidth: 70 }} /></td>
                <td><input name={`damaged[${l.id}]`} placeholder="0" style={{ width: 90, minWidth: 70 }} /></td></tr>
            ))}</tbody></table>
          <div className="row" style={{ marginTop: 10 }}><div className="field"><label>Supplier delivery note</label><input name="delivery_note" /></div>
            <div className="shrink"><button className="btn green" name="step" value="receive">Receive into stock</button></div></div>
          <p className="small muted">Parts ordered for a job go to that job first.</p>
        </form>
      )}
      <div className="grid2">
        <div className="card"><h2>Receipts</h2>
          <table><tbody>{grns.map((g) => <tr key={g.id}><td>{g.doc_no}</td><td className="small">{g.delivery_note}</td><td className="small">{g.full_name}</td><td className="small muted">{dt(g.received_at)}</td></tr>)}</tbody></table>
          {!grns.length && <p className="muted small">Nothing received yet.</p>}
        </div>
        <div className="card"><h2>Approval history</h2>
          <table><tbody>{approvals.map((a) => <tr key={a.id}><td>{label(a.action)}</td><td>{a.step_name ?? ""}</td><td>{a.full_name}</td><td className="small">{a.comment}</td><td className="small muted">{dt(a.at)}</td></tr>)}</tbody></table>
          {!approvals.length && <p className="muted small">Not submitted yet.</p>}
        </div>
      </div>
      <RecordHistory rows={await docHistory(ctx, "purchase_order", id)} />
    </>
  );
}
