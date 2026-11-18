import { requireCtx } from "@/lib/session";
import { listCheques } from "@/lib/services/billing";
import { chequeAction } from "@/app/actions-billing";
import { Flash, Money, PageHead, Status, d, dt } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { can } from "@/lib/access";

const TABS: [string, string][] = [["held", "On hand"], ["cleared", "Cleared"], ["bounced", "Returned"], ["", "All"]];

export default async function Cheques({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const st = TABS.some(([k]) => k === sp.status) ? sp.status ?? "held" : "held";
  const rows = await listCheques(ctx, st);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  return (
    <>
      <PageHead title="Cheques received" sub="Post-dated cheques stay on hand until their date. Clear a cheque when the bank credits it; a returned cheque opens the invoice again." />
      <BillingTabs at="/billing/cheques" />
      <Flash sp={sp} />
      <div className="tabs">{TABS.map(([k, l]) => <a key={k} className={st === k ? "on" : ""} href={`/billing/cheques?status=${k}`}>{l}</a>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>Receipt</th><th>Customer</th><th>Branch</th><th>Cheque</th><th>Cheque date</th><th className="num">Amount</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{rows.map((r) => {
            const manage = can(ctx, "invoices", "approve", r.branch_id) || can(ctx, "invoices", "edit", r.branch_id) || can(ctx, "accounting", "create", r.branch_id);
            return (
              <tr key={r.id}><td>{r.doc_no}{r.kind === "advance" && <span className="small muted"> deposit</span>}</td><td>{r.customer_name}</td><td>{r.branch_code}</td><td>{r.cheque_no} · {r.cheque_bank}</td>
                <td>{d(r.cheque_date)}{r.cheque_status === "held" && r.cheque_date > today && <span className="small muted"> (post-dated)</span>}</td><td className="num"><Money v={r.amount} /></td>
                <td><Status s={r.cheque_status} />{r.cheque_note && <div className="small">{r.cheque_note}</div>}{r.cheque_event_at && <div className="small muted">{dt(r.cheque_event_at)}</div>}</td>
                <td>{manage && ["held", "cleared"].includes(r.cheque_status) && <div className="row">
                  {r.cheque_status === "held" && <form action={chequeAction} className="shrink"><input type="hidden" name="receipt_id" value={r.id} /><input type="hidden" name="step" value="clear" /><input type="hidden" name="$back" value={`/billing/cheques?status=${st}`} />
                    <button className="btn green sm" disabled={r.cheque_date > today}>Cleared</button></form>}
                  <form action={chequeAction} className="row shrink"><input type="hidden" name="receipt_id" value={r.id} /><input type="hidden" name="step" value="bounce" /><input type="hidden" name="$back" value={`/billing/cheques?status=${st}`} />
                    <input name="note" placeholder="Why returned" required style={{ width: 130 }} aria-label="Reason returned" /><ConfirmButton className="btn red sm shrink" message="Record this cheque as returned? The invoice opens again.">Returned</ConfirmButton></form>
                </div>}</td></tr>);
          })}</tbody>
        </table>
        {!rows.length && <p className="muted">No cheques here.</p>}
      </div>
    </>
  );
}
