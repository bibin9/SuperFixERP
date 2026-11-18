import { requireCtx } from "@/lib/session";
import { cashToday, listCashSessions } from "@/lib/services/billing-more";
import { cashCloseAction, cashSignOffAction } from "@/app/actions-billing";
import { Flash, Money, PageHead, Status, d } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { can } from "@/lib/access";
import { D } from "@/lib/money";

export default async function CashClosing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const canTake = !!ctx.currentBranchId && can(ctx, "invoices", "create", ctx.currentBranchId);
  const t = canTake ? await cashToday(ctx) : null;
  const rows = await listCashSessions(ctx);
  return (
    <>
      <PageHead title="Daily cash closing" sub="At the end of the day each cashier counts the drawer. The branch manager checks and signs it off; any difference is booked to cash over and short." />
      <BillingTabs at="/billing/cash" />
      <Flash sp={sp} />
      {t && (
        <div className="card"><h2>Your day · {d(t.date)}</h2>
          <p>Cash taken by you today: <b><Money v={t.cash} /></b> ({t.cashCount} receipts) · card: <b><Money v={t.card} /></b> ({t.cardCount} slips)</p>
          {t.session ? (
            <p>Closed: counted <Money v={t.session.counted_cash} /> against <Money v={t.session.expected_cash} /> expected, difference <b><Money v={t.session.variance} /></b> <Status s={t.session.status} />. No more cash can be taken by you today.</p>
          ) : (
            <form action={cashCloseAction}>
              <div className="grid2">
                <div>
                  <label className="small">How many of each note and coin (AED)</label>
                  <div className="denoms">{(t.denoms as number[]).map((dn) => <div key={dn} className="field"><label>{dn}</label><input name={`count[${dn}]`} inputMode="numeric" aria-label={`Count of ${dn}`} /></div>)}</div>
                </div>
                <div>
                  <div className="field"><label>Opening float (AED)</label><input name="opening_float" inputMode="decimal" defaultValue="0" /></div>
                  <div className="field"><label>Cash handed over during the day (AED)</label><input name="handed_over" inputMode="decimal" defaultValue="0" /></div>
                  <div className="field"><label>Card terminal batch total (AED)</label><input name="card_batch_total" inputMode="decimal" placeholder={D(t.card).toFixed(2)} /></div>
                  <div className="field"><label>Note (needed if the difference is over AED {t.tolerance})</label><input name="note" /></div>
                  <ConfirmButton className="btn green" message="Close today's cash? You cannot take more cash today after this.">Close my cash</ConfirmButton>
                </div>
              </div>
            </form>
          )}
        </div>
      )}
      <div className="card"><h2>Closings</h2>
        <table>
          <thead><tr><th>Date</th><th>Branch</th><th>Cashier</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Difference</th><th className="num">Card</th><th>Note</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{rows.map((s) => {
            const sign = s.status === "submitted" && s.cashier_id !== ctx.userId && can(ctx, "invoices", "approve", s.branch_id);
            return (
              <tr key={s.id}><td>{d(s.session_date)}</td><td>{s.branch_code}</td><td>{s.cashier}</td><td className="num"><Money v={s.expected_cash} /></td><td className="num"><Money v={s.counted_cash} /></td>
                <td className="num">{Number(s.variance) === 0 ? <Money v={s.variance} /> : <b><Money v={s.variance} /></b>}</td>
                <td className="num"><Money v={s.card_expected} />{s.card_batch_total !== null && D(s.card_batch_total).minus(s.card_expected).abs().gt(0) && <div className="small">batch <Money v={s.card_batch_total} /></div>}</td>
                <td className="small">{s.note}{s.sign_note && <div>Manager: {s.sign_note}</div>}</td>
                <td><Status s={s.status} />{s.signed_by_name && <div className="small muted">{s.signed_by_name}</div>}</td>
                <td>{sign && <form action={cashSignOffAction} className="row"><input type="hidden" name="id" value={s.id} /><input name="note" placeholder="Note" style={{ width: 100 }} aria-label="Sign-off note" /><button className="btn green sm shrink">Sign off</button></form>}</td></tr>);
          })}</tbody>
        </table>
        {!rows.length && <p className="muted">No closings yet.</p>}
      </div>
    </>
  );
}
