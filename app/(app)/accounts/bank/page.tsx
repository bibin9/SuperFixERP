import { requireCtx } from "@/lib/session";
import { bankAccounts, listCardSettlements, listStatements, chequesDue } from "@/lib/services/accounting";
import { cardSettlementAction, importStatementAction } from "@/app/actions-accounting";
import { withTx } from "@/lib/db";
import { can, canAnywhere, canSee } from "@/lib/access";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";

export default async function Bank({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const [banks, cards, statements, due] = await Promise.all([bankAccounts(ctx), listCardSettlements(ctx), listStatements(ctx), chequesDue(ctx)]);
  const showBal = ctx.allBranches && canSee(ctx, "bank_balance", null);
  const bal = showBal ? new Map((await withTx(ctx, async (c) => (await c.query("SELECT account_id, sum(debit - credit) v FROM journal_line GROUP BY account_id")).rows)).map((r) => [r.account_id, r.v])) : null;
  const held = ctx.currentBranchId ? (await withTx(ctx, async (c) => (await c.query(
    "SELECT coalesce(sum(jl.debit - jl.credit),0) v FROM journal_line jl JOIN account_mapping m ON m.account_id = jl.account_id WHERE m.event_key = 'card_clearing' AND jl.branch_id = $1", [ctx.currentBranchId])).rows[0].v)) : null;
  const canCreate = canAnywhere(ctx, "accounting", "create");
  return (
    <>
      <PageHead title="Bank" sub="Bank accounts, card settlements and statement reconciliation. Import the bank's statement as CSV; lines are matched to the books by amount, a few days either side, and the reference." />
      <Flash sp={sp} />
      {(due.received.length > 0 || due.issued.length > 0) && (
        <div className="card" style={{ borderLeft: "4px solid var(--amber)" }}><h2>Cheques due in the next {due.days} days</h2>
          <table><thead><tr><th>Due</th><th>Kind</th><th>Cheque</th><th>Party</th><th>Branch</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {due.received.map((r) => <tr key={r.id}><td className={String(r.cheque_date).slice(0, 10) <= today ? "neg" : ""}>{d(String(r.cheque_date).slice(0, 10))}</td><td>Received, to deposit</td><td><Link href="/billing/cheques">{r.cheque_no}</Link> {r.cheque_bank && <span className="small muted">· {r.cheque_bank}</span>}</td><td>{r.party}</td><td>{r.branch_code}</td><td className="num"><Money v={r.amount} /></td></tr>)}
              {due.issued.map((r) => <tr key={r.id}><td className={String(r.cheque_date).slice(0, 10) <= today ? "neg" : ""}>{d(String(r.cheque_date).slice(0, 10))}</td><td>Issued, bank will pay</td><td><Link href="/accounts/payables/payments?cheques=issued">{r.cheque_no}</Link></td><td>{r.party}</td><td>{r.branch_code}</td><td className="num"><Money v={r.amount} /></td></tr>)}
            </tbody></table>
        </div>)}
      <div className="card"><h2>Bank accounts</h2>
        <table>
          <thead><tr><th>Name</th><th>Bank</th><th>Account no.</th><th>IBAN</th><th>Ledger</th>{bal && <th className="num">Book balance</th>}</tr></thead>
          <tbody>{banks.map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.bank_name}</td><td>{b.account_no}</td><td className="small">{b.iban}</td><td><Link href={`/accounts/ledger?account=${b.account_code}&from=2000-01-01`}>{b.account_code}</Link></td>{bal && <td className="num"><Money v={bal.get(b.account_id) ?? 0} /></td>}</tr>)}</tbody>
        </table>
        <p className="small muted">Add or change bank accounts under Administration, Master forms.</p>
      </div>
      {canCreate && (
        <div className="grid2">
          <form action={importStatementAction} className="card" encType="multipart/form-data">
            <h2>Import a bank statement</h2>
            <div className="field"><label>Bank account</label><select name="bank_account_id">{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.bank_name}</option>)}</select></div>
            <div className="field"><label>Statement file (CSV with Date, Description, Reference, and Amount or Debit and Credit)</label><input type="file" name="file" accept=".csv,text/csv" /></div>
            <div className="field"><label>Or paste the CSV here</label><textarea name="file_text" rows={4} placeholder={"Date,Description,Reference,Debit,Credit\n15/11/2026,CARD SETTLEMENT,,,1520.00"} /></div>
            <div className="field"><label>Closing balance on the statement (optional)</label><input name="closing_balance" inputMode="decimal" /></div>
            <button className="btn">Import and match</button>
          </form>
          {ctx.currentBranchId && can(ctx, "accounting", "create", ctx.currentBranchId) && (
            <form action={cardSettlementAction} className="card">
              <h2>Card settlement</h2>
              <p className="small muted">Card receipts waiting at this branch: <b><Money v={held} /></b>. Enter the terminal batch total and what the bank actually credited; the difference is the bank&apos;s commission.</p>
              <div className="field"><label>Bank account credited</label><select name="bank_account_id">{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.bank_name}</option>)}</select></div>
              <div className="row">
                <div className="field"><label>Date</label><input type="date" name="settle_date" defaultValue={today} max={today} /></div>
                <div className="field"><label>Batch total (AED)</label><input name="batch_total" inputMode="decimal" required /></div>
                <div className="field"><label>Bank credit (AED)</label><input name="bank_credit" inputMode="decimal" required /></div>
              </div>
              <div className="field"><label>Reference</label><input name="reference" /></div>
              <button className="btn green">Post settlement</button>
            </form>)}
        </div>)}
      <div className="card"><h2>Statements</h2>
        <table>
          <thead><tr><th>File</th><th>Account</th><th>Dates</th><th className="num">Lines</th><th className="num">Not matched</th><th>Status</th></tr></thead>
          <tbody>{statements.map((s) => <tr key={s.id}><td><Link href={`/accounts/bank/statements/${s.id}`}>{s.file_name}</Link></td><td>{s.bank_name}</td><td>{d(String(s.date_from).slice(0, 10))} to {d(String(s.date_to).slice(0, 10))}</td><td className="num">{s.n}</td><td className="num">{Number(s.unmatched) > 0 ? <b className="neg">{s.unmatched}</b> : 0}</td><td><Status s={s.status} /></td></tr>)}
            {!statements.length && <tr><td colSpan={6} className="muted">No statements imported yet.</td></tr>}</tbody>
        </table>
      </div>
      <div className="card"><h2>Card settlements</h2>
        <table>
          <thead><tr><th>Number</th><th>Date</th><th>Branch</th><th>Bank</th><th className="num">Batch</th><th className="num">Credited</th><th className="num">Commission</th><th>Reference</th></tr></thead>
          <tbody>{cards.map((c) => <tr key={c.id}><td>{c.doc_no}</td><td>{d(String(c.settle_date).slice(0, 10))}</td><td>{c.branch_code}</td><td>{c.bank_name}</td><td className="num"><Money v={c.batch_total} /></td><td className="num"><Money v={c.bank_credit} /></td><td className="num"><Money v={c.commission} /></td><td className="small">{c.reference}</td></tr>)}
            {!cards.length && <tr><td colSpan={8} className="muted">None yet.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
