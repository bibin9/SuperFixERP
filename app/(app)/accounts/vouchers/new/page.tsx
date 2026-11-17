import { requireCtx } from "@/lib/session";
import { accountsList, partyOptions, VOUCHER_TYPES } from "@/lib/services/accounting";
import { voucherAction } from "@/app/actions-accounting";
import { assertCan } from "@/lib/access";
import { Flash, PageHead } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { KeepForm } from "@/components/KeepForm";

const N = 8;
export default async function NewVoucher({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  assertCan(ctx, "accounting", "create", ctx.currentBranchId);
  const sp = await searchParams;
  const [accounts, parties] = await Promise.all([accountsList(ctx), partyOptions(ctx)]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  return (
    <>
      <PageHead title="New voucher" sub="Debits must equal credits. Lines on trade receivables or payables need the customer or supplier. The voucher is posted for the branch you are working in." />
      <AccountsTabs group="books" at="/accounts/vouchers" />
      <Flash sp={sp} />
      <KeepForm action={voucherAction} className="card">
        <input type="hidden" name="lines" value={N} />
        <div className="row">
          <div className="field"><label>Type</label><select name="voucher_type" defaultValue="journal">{Object.entries(VOUCHER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label>Date</label><input type="date" name="voucher_date" defaultValue={today} max={today} required /></div>
          <div className="field" style={{ flex: 3 }}><label>Narration (what it is for)</label><input name="narration" required minLength={3} /></div>
        </div>
        <table className="vlines">
          <thead><tr><th style={{ width: "32%" }}>Ledger</th><th style={{ width: "22%" }}>Customer or supplier</th><th className="num">Debit</th><th className="num">Credit</th><th>Line note</th></tr></thead>
          <tbody>{Array.from({ length: N }, (_, i) => (
            <tr key={i}>
              <td><select name={`acct_${i}`} aria-label={`Ledger line ${i + 1}`} defaultValue=""><option value=""></option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.party_type ? ` (needs ${a.party_type})` : ""}</option>)}</select></td>
              <td><select name={`party_${i}`} aria-label={`Party line ${i + 1}`} defaultValue=""><option value=""></option>
                <optgroup label="Suppliers">{parties.suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                <optgroup label="Customers">{parties.customers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</optgroup></select></td>
              <td><input name={`dr_${i}`} inputMode="decimal" aria-label={`Debit line ${i + 1}`} style={{ textAlign: "right" }} /></td>
              <td><input name={`cr_${i}`} inputMode="decimal" aria-label={`Credit line ${i + 1}`} style={{ textAlign: "right" }} /></td>
              <td><input name={`nar_${i}`} aria-label={`Note line ${i + 1}`} /></td></tr>))}
          </tbody>
        </table>
        <button className="btn green" style={{ marginTop: 10 }}>Submit for approval</button>
      </KeepForm>
    </>
  );
}
