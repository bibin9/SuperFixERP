import { requireCtx } from "@/lib/session";
import { openingBatches, openingComparison } from "@/lib/services/accounting-close";
import { openingAction, importMastersAction } from "@/app/actions-accounting";
import { MASTER_IMPORTS } from "@/lib/services/migration";
import { canAnywhere } from "@/lib/access";
import { Flash, Money, PageHead, Status, d, dt } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { OpeningCheck } from "@/components/OpeningCheck";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function Opening({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const batches = await openingBatches(ctx);
  const b = batches.find((x) => x.id === sp.batch) ?? batches[0];
  const cmp = b ? await openingComparison(ctx, b.id) : null;
  return (
    <>
      <PageHead title="Opening balances from Tally" sub="1. Masters are set up (chart of accounts, customers, suppliers). 2. Check the three files. 3. Load them. 4. Compare with Tally's trial balance. 5. Sign off. No Tally vouchers or history are brought over." />
      <AccountsTabs group="monthend" at="/accounts/opening" />
      <Flash sp={sp} />
      {(canAnywhere(ctx, "settings", "create") || canAnywhere(ctx, "customers", "create")) && (
        <details className="card" open={!b}>
          <summary><b>Step 1 · Import masters from Tally</b> <span className="small muted">ledgers, suppliers, stock items and customers; existing codes are skipped</span></summary>
          <form action={importMastersAction} encType="multipart/form-data" style={{ marginTop: 10 }}>
            <div className="row">
              <div className="field"><label>What</label><select name="kind">{Object.entries(MASTER_IMPORTS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}</select></div>
              <div className="field"><label>CSV file</label><input type="file" name="file" accept=".csv" /></div>
            </div>
            <div className="field"><label>Or paste the CSV</label><textarea name="file_text" rows={4} aria-label="Masters CSV" placeholder={Object.values(MASTER_IMPORTS).map((v) => v.sample).join("\n\n")} /></div>
            <button className="btn ghost">Import</button>
            <p className="small muted">Employees are imported in HR. Stock quantities and values are loaded per branch under Parts, stock on hand, as opening stock; leave 1300 inventory out of the ledger balances file.</p>
          </form>
        </details>)}
      {!b && canAnywhere(ctx, "accounting", "create") && <OpeningCheck action={openingAction} />}
      {b && cmp && (
        <div className="card">
          <h2>Cut-over {d(String(b.cutover_date).slice(0, 10))} <Status s={b.status} /></h2>
          <p className="small muted">Loaded by {b.loaded_by_name} on {dt(b.loaded_at)} · {b.ledger_rows} ledger balances, {b.bill_rows} open bills{b.signed_at ? ` · signed off by ${b.signed_by_name} on ${dt(b.signed_at)}${b.sign_note ? `: ${b.sign_note}` : ""}` : ""}</p>
          <table className="fin">
            <thead><tr><th>Ledger</th><th className="num">Superfix debit</th><th className="num">Superfix credit</th><th className="num">Tally debit</th><th className="num">Tally credit</th><th className="num">Difference</th></tr></thead>
            <tbody>{cmp.rows.map((r) => <tr key={r.code}><td>{r.code} {r.name}</td><td className="num"><Money v={r.ours_dr} /></td><td className="num"><Money v={r.ours_cr} /></td><td className="num">{r.tally_dr && <Money v={r.tally_dr} />}</td><td className="num">{r.tally_cr && <Money v={r.tally_cr} />}</td><td className={`num ${Number(r.diff) ? "neg" : "okline"}`}><Money v={r.diff} /></td></tr>)}</tbody>
          </table>
          <p>{cmp.matches ? <b className="okline">The opening trial balance agrees with Tally.</b> : <b className="neg">The opening trial balance differs from Tally. Explain the difference when signing off, or correct it with a journal voucher first.</b>}</p>
          {b.status === "loaded" && canAnywhere(ctx, "accounting", "approve") && (
            <form action={openingAction} className="row" style={{ alignItems: "flex-end" }}><input type="hidden" name="do" value="sign" /><input type="hidden" name="batch_id" value={b.id} />
              <div className="field" style={{ flex: 3 }}><label>Note {cmp.matches ? "(optional)" : "(required: explain the difference)"}</label><input name="note" /></div>
              <div className="shrink"><ConfirmButton className="btn green" message="Sign off the opening balances?">Sign off</ConfirmButton></div></form>)}
        </div>)}
    </>
  );
}
