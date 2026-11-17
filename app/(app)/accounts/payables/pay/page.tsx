import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { supplierOpenItems, partyOptions, bankAccounts, listSupplierPayments } from "@/lib/services/accounting";
import { paySupplierAction, allocateCreditAction } from "@/app/actions-accounting";
import { can } from "@/lib/access";
import { Flash, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });

export default async function PaySupplier({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const { suppliers } = await partyOptions(ctx);
  const sid = suppliers.some((x) => x.id === sp.supplier) ? sp.supplier : "";
  const open = sid ? await supplierOpenItems(ctx, sid) : null;
  const banks = await bankAccounts(ctx);
  const credits = sid ? (await listSupplierPayments(ctx)).filter((p) => p.supplier_id === sid && Number(p.on_account) > 0 && p.cheque_status !== "cancelled") : [];
  const canPay = !!ctx.currentBranchId && can(ctx, "accounting", "create", ctx.currentBranchId);
  return (
    <>
      <PageHead title="Pay a supplier" sub="Choose the bills this payment settles, in full or in part. Anything not allocated stays on the supplier's account for a later bill. Bills of other branches are settled through inter-branch clearing." />
      <AccountsTabs group="parties" at="/accounts/payables/pay" />
      <Flash sp={sp} />
      <div className="card no-print">
        <form className="row" style={{ alignItems: "flex-end" }}>
          <div className="field"><label>Supplier</label><select name="supplier" defaultValue={sid}><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></div>
          <div className="shrink"><button className="btn ghost">Show open bills</button></div>
        </form>
      </div>
      {open && (
        <form action={paySupplierAction} className="card">
          <input type="hidden" name="supplier_id" value={sid} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
          <h2>Open bills</h2>
          <table>
            <thead><tr><th>Bill</th><th>Supplier ref.</th><th>Branch</th><th>Date</th><th>Due</th><th className="num">Amount</th><th className="num">Open</th><th className="num">Settle now</th></tr></thead>
            <tbody>{open.items.map((b) => (
              <tr key={b.id}><td>{b.doc_no}</td><td className="small">{b.ref}</td><td>{b.branch_code}</td><td>{d(String(b.doc_date).slice(0, 10))}</td>
                <td className={String(b.due_date).slice(0, 10) < today() ? "neg" : ""}>{d(String(b.due_date).slice(0, 10))}</td><td className="num"><Money v={b.amount} /></td><td className="num"><Money v={b.open} /></td>
                <td className="num"><input name={`alloc[${b.kind}:${b.id}]`} inputMode="decimal" placeholder={Number(b.open).toFixed(2)} style={{ width: 110, textAlign: "right" }} aria-label={`Settle ${b.doc_no}`} /></td></tr>))}
              {!open.items.length && <tr><td colSpan={8} className="muted">No open bills.{Number(open.onAccount) > 0 && ` AED ${Number(open.onAccount).toFixed(2)} is already paid on account.`}</td></tr>}
            </tbody>
          </table>
          {canPay ? (
            <div className="row" style={{ marginTop: 12 }}>
              <div className="field"><label>Method</label><select name="method"><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash (petty cash)</option></select></div>
              <div className="field"><label>From bank account</label><select name="bank_account_id">{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.bank_name}</option>)}</select></div>
              <div className="field"><label>Amount (AED)</label><input name="amount" inputMode="decimal" required /></div>
              <div className="field"><label>Transfer reference</label><input name="reference" /></div>
              <div className="field"><label>Cheque no.</label><input name="cheque_no" /></div>
              <div className="field"><label>Cheque date</label><input name="cheque_date" type="date" /></div>
              <div className="shrink" style={{ alignSelf: "flex-end" }}><button className="btn green">Post payment</button></div>
            </div>) : <p className="small muted">Choose a branch you can pay from in the branch switcher to make a payment.</p>}
          <p className="small muted">The payment is made by the branch you are working in ({ctx.currentBranchId ? "current branch" : "none chosen"}). A cheque stays under "cheques issued" until the bank pays it.</p>
        </form>)}
      {credits.length > 0 && open && (
        <div className="card"><h2>Money already paid on account</h2>
          {credits.map((p) => (
            <form key={p.id} action={allocateCreditAction} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="supplier_id" value={sid} />
              <div className="field"><label>Payment</label><div>{p.doc_no} · {p.branch_code} · <Money v={p.on_account} /> left</div></div>
              <div className="field"><label>Use against bill</label><select name="bill_id">{open.items.filter((b) => b.kind === "bill" && b.branch_id === p.branch_id).map((b) => <option key={b.id} value={b.id}>{b.doc_no} · open {Number(b.open).toFixed(2)}</option>)}</select></div>
              <div className="field"><label>Amount (blank = as much as possible)</label><input name="amount" inputMode="decimal" /></div>
              <div className="shrink"><button className="btn ghost">Allocate</button></div>
            </form>))}
        </div>)}
    </>
  );
}
