"use client";
import { useActionState, startTransition } from "react";
import { checkOpeningAction } from "@/app/actions-accounting";

const LEDGER = "Branch,Account code,Debit,Credit\nYAS,1120,50000.00,\nYAS,1200,3150.00,\nYAS,2000,,4200.00\nYAS,3900,,48950.00";
const BILLS = "Branch,Party type,Party code,Bill no,Bill date,Due date,Amount\nYAS,customer,C-000001,TLY-S-881,01/10/2026,31/10/2026,3150.00\nYAS,supplier,AGMC,AG-5531,30/09/2026,30/10/2026,4200.00";
const TALLY = "Account code,Debit,Credit\n1120,50000,\n1200,3150,\n2000,,4200\n3900,,48950";

/** Steps 2 to 4: check the files (nothing is written), then load them. */
export function OpeningCheck({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [state, check, pending] = useActionState(checkOpeningAction, null);
  const plan = state?.ok ? state.plan : null;
  return (
    // Checking must not clear what was typed or pasted (a form action resets the form), so the check runs from onSubmit;
    // only the Load button submits the form as an action.
    <form className="card" encType="multipart/form-data" onSubmit={(e) => {
      const by = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      if (by?.value === "load") return;
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      startTransition(() => check(fd));
    }}>
      <h2>Load the opening balances</h2>
      <div className="field" style={{ maxWidth: 220 }}><label>Cut-over date</label><input type="date" name="cutover_date" required /></div>
      <div className="grid3">
        <div className="field"><label>Ledger balances by branch (CSV)</label><input type="file" name="ledger" accept=".csv" /><textarea name="ledger_text" rows={6} placeholder={LEDGER} aria-label="Ledger balances CSV" /></div>
        <div className="field"><label>Open customer and supplier bills (CSV)</label><input type="file" name="bills" accept=".csv" /><textarea name="bills_text" rows={6} placeholder={BILLS} aria-label="Open bills CSV" /></div>
        <div className="field"><label>Tally trial balance at the cut-over (CSV)</label><input type="file" name="tally" accept=".csv" /><textarea name="tally_text" rows={6} placeholder={TALLY} aria-label="Tally trial balance CSV" /></div>
      </div>
      <p className="small muted">Trade receivables and payables must equal the open bills behind them, branch by branch. Each branch must balance; put any difference on 3900 opening balance equity. Customers are matched by customer number and suppliers by code.</p>
      <div className="row"><button className="btn ghost shrink" disabled={pending}>{pending ? "Checking…" : "Check the files"}</button>
        {plan && !plan.errors.length && <button className="btn green shrink" formAction={action} name="do" value="load">Load opening balances</button>}</div>
      {state && !state.ok && <div className="flash err">{state.error}</div>}
      {plan && (
        <div style={{ marginTop: 12 }}>
          {plan.errors.length ? <div className="flash err"><b>{plan.errors.length} problem(s) to fix:</b><ul>{plan.errors.map((e, k) => <li key={k}>{e}</li>)}</ul></div>
            : <div className="flash ok">No problems: {plan.ledgerRows} ledger balances and {plan.billRows} open bills are ready to load.{plan.tbMatches === false ? " Note: the totals differ from the Tally trial balance (see below)." : plan.tbMatches ? " The totals agree with Tally." : ""}</div>}
          <table className="fin"><thead><tr><th>Ledger</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Tally debit</th><th className="num">Tally credit</th><th className="num">Difference</th></tr></thead>
            <tbody>{plan.tb.map((r) => <tr key={r.code}><td>{r.code} {r.name}</td><td className="num">{r.ours_dr}</td><td className="num">{r.ours_cr}</td><td className="num">{r.tally_dr}</td><td className="num">{r.tally_cr}</td><td className={`num ${Number(r.diff) ? "neg" : ""}`}>{r.diff}</td></tr>)}</tbody></table>
        </div>)}
    </form>
  );
}
