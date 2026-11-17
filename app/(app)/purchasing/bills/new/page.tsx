import { requireCtx } from "@/lib/session";
import { unbilledLines } from "@/lib/services/purchasing";
import { masters } from "@/lib/services/masters";
import { billAction } from "@/app/actions-ops";
import { Flash, Money, PageHead } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { today } from "@/lib/services/stock";
import { D } from "@/lib/money";

export default async function NewBill({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [open, m] = await Promise.all([unbilledLines(ctx, sp.supplier_id), masters(ctx)]);
  const sup = m.suppliers.find((s) => s.id === sp.supplier_id);
  const types = m.lookups.filter((l) => l.list === "expense_type");
  return (
    <>
      <PageHead title={`Supplier bill · ${sup?.name_en ?? ""}`} sub="Tick nothing you have not received. Lines that are not stock (e.g. a service) go to an expense account." />
      <PurchTabs at="/purchasing/bills" />
      <Flash sp={sp} />
      <form action={billAction} className="card">
        <input type="hidden" name="supplier_id" value={sp.supplier_id} />
        <div className="row"><div className="field"><label>Supplier invoice no.</label><input name="supplier_invoice_no" required /></div>
          <div className="field"><label>Invoice date</label><input type="date" name="invoice_date" defaultValue={today()} required /></div></div>
        <h3>Received and not yet billed</h3>
        <table><thead><tr><th>Receipt</th><th>Item</th><th className="num">Open qty</th><th className="num">Received at</th><th>Billed qty</th><th>Bill unit price</th></tr></thead>
          <tbody>{open.map((l) => (
            <tr key={l.id}><td>{l.grn_no}<div className="small muted">{l.po_no}</div></td><td>{l.part_no}<div className="small muted">{l.description}</div></td>
              <td className="num">{D(l.open_qty).toString()}</td><td className="num">{"unit_cost" in l ? <Money v={l.unit_cost} /> : "—"}</td>
              <td><input name={`bq[${l.id}]`} placeholder={D(l.open_qty).toString()} style={{ width: 90, minWidth: 70 }} /></td>
              <td><input name={`bp[${l.id}]`} defaultValue={"unit_cost" in l ? D(l.unit_cost).toString() : ""} style={{ width: 110, minWidth: 80 }} /></td></tr>
          ))}{!open.length && <tr><td colSpan={6} className="muted">Nothing received from this supplier is waiting for a bill.</td></tr>}</tbody></table>
        <h3 style={{ marginTop: 16 }}>Other lines (not stock)</h3>
        {[0, 1].map((i) => (
          <div className="row" key={i}>
            <div className="field"><label>Description</label><input name="x_description" /></div>
            <div className="field"><label>Expense type</label><select name="x_expense_type">{types.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
            <div className="field shrink" style={{ width: 80 }}><label>Qty</label><input name="x_qty" placeholder="1" /></div>
            <div className="field shrink" style={{ width: 120 }}><label>Unit price</label><input name="x_unit_price" /></div>
            <div className="field shrink" style={{ width: 100 }}><label>Tax</label><select name="x_vat_code" defaultValue="SR">{m.taxCodes.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}</select></div>
          </div>
        ))}
        <button className="btn" style={{ marginTop: 10 }}>Save and match</button>
      </form>
    </>
  );
}
