import { requireCtx } from "@/lib/session";
import { listSupplierPayments } from "@/lib/services/accounting";
import { issuedChequeAction } from "@/app/actions-accounting";
import { can } from "@/lib/access";
import { Flash, Link, Money, PageHead, Status, d, label } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listSupplierPayments(ctx, { cheques: ["issued", "cleared", "cancelled"].includes(sp.cheques) ? sp.cheques : "" });
  const out = rows.filter((r) => r.cheque_status === "issued").reduce((s, r) => s + Number(r.amount), 0);
  return (
    <>
      <PageHead title="Supplier payments and cheques issued" sub={`Cheques still out: AED ${out.toFixed(2)}. Mark a cheque as paid when it shows on the bank statement; cancelling one reverses the payment and opens the bills again.`}>
        <Link className="btn" href="/accounts/payables/pay">Pay a supplier</Link>
      </PageHead>
      <AccountsTabs group="parties" at="/accounts/payables/payments" />
      <Flash sp={sp} />
      <div className="tabs">{[["", "All payments"], ["issued", "Cheques still out"], ["cleared", "Cheques paid"], ["cancelled", "Cancelled"]].map(([k, l]) => <Link key={k} className={(sp.cheques ?? "") === k ? "on" : ""} href={`/accounts/payables/payments${k ? `?cheques=${k}` : ""}`}>{l}</Link>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>Payment</th><th>Date</th><th>Supplier</th><th>Branch</th><th>Method</th><th>Cheque</th><th className="num">Amount</th><th className="num">On account</th><th></th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}><td>{p.doc_no}</td><td>{d(String(p.doc_date).slice(0, 10))}</td><td><Link href={`/accounts/statement?party=supplier&id=${p.supplier_id}`}>{p.supplier_name}</Link></td><td>{p.branch_code}</td>
              <td>{label(p.method)}{p.bank_name && <span className="small muted"> · {p.bank_name}</span>}{p.reference && <span className="small muted"> · {p.reference}</span>}</td>
              <td>{p.cheque_no && <>{p.cheque_no} · {d(String(p.cheque_date).slice(0, 10))} <Status s={p.cheque_status} /></>}</td>
              <td className="num"><Money v={p.amount} /></td><td className="num">{Number(p.on_account) > 0 && <Money v={p.on_account} />}</td>
              <td>{p.cheque_status === "issued" && (
                <form action={issuedChequeAction} className="row" style={{ gap: 6 }}>
                  <input type="hidden" name="payment_id" value={p.id} />
                  {can(ctx, "accounting", "create", p.branch_id) && <button className="btn sm green" name="do" value="clear">Paid by bank</button>}
                  {can(ctx, "accounting", "approve", p.branch_id) && <><input name="note" placeholder="Why cancelled" style={{ width: 130 }} aria-label="Why cancelled" /><ConfirmButton className="btn sm ghost red-text" name="do" value="cancel" message="Cancel this cheque? The payment is reversed and the bills open again.">Cancel</ConfirmButton></>}
                </form>)}</td></tr>))}
            {!rows.length && <tr><td colSpan={9} className="muted">No payments.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
