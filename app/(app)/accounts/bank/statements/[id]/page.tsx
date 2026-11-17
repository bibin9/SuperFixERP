import { requireCtx } from "@/lib/session";
import { getStatement, accountsList } from "@/lib/services/accounting";
import { statementLineAction } from "@/app/actions-accounting";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, Money, PageHead, Status, d } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function Reconcile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const [r, accounts] = await Promise.all([getStatement(ctx, id), accountsList(ctx)]);
  const open = r.s.status !== "finished";
  const canWork = open && canAnywhere(ctx, "accounting", "create");
  const unmatched = r.lines.filter((l) => !l.journal_line_id).length;
  const others = accounts.filter((a) => a.id !== r.s.account_id && !a.party_type);
  return (
    <>
      <PageHead title={`Reconcile ${r.s.bank_name}`} sub={`${r.s.file_name} · ${d(String(r.s.date_from).slice(0, 10))} to ${d(String(r.s.date_to).slice(0, 10))} · ${unmatched} line(s) not matched`}>
        <Status s={r.s.status} /><PrintButton />
        {open && canAnywhere(ctx, "accounting", "approve") && <form action={statementLineAction}><input type="hidden" name="statement_id" value={id} /><ConfirmButton className="btn green" name="do" value="finish" message="Finish and lock this statement?">Finish and lock</ConfirmButton></form>}
      </PageHead>
      <Flash sp={sp} />
      <div className="card">
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Amount</th><th>Matched to</th><th className="no-print"></th></tr></thead>
          <tbody>{r.lines.map((l) => (
            <tr key={l.id}><td>{d(String(l.line_date).slice(0, 10))}</td><td className="small">{l.description}</td><td className="small">{l.reference}</td><td className={`num ${Number(l.amount) < 0 ? "neg" : ""}`}><Money v={l.amount} /></td>
              <td className="small">{l.journal_line_id ? <>{l.journal_no} · {l.journal_narration} <span className="muted">({l.match_kind})</span></> : <span className="neg">Not matched</span>}</td>
              <td className="no-print">{canWork && (l.journal_line_id
                ? <form action={statementLineAction}><input type="hidden" name="statement_id" value={id} /><input type="hidden" name="line_id" value={l.id} /><button className="btn sm ghost" name="do" value="unmatch">Unmatch</button></form>
                : <div style={{ display: "grid", gap: 6 }}>
                    {l.candidates.length > 0 && <form action={statementLineAction} className="row" style={{ gap: 6 }}><input type="hidden" name="statement_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                      <select name="journal_line_id" aria-label="Book entry">{l.candidates.map((c: { id: string; doc_no: string; journal_date: string; narration: string }) => <option key={c.id} value={c.id}>{c.doc_no} · {d(String(c.journal_date).slice(0, 10))} · {String(c.narration).slice(0, 40)}</option>)}</select>
                      <button className="btn sm" name="do" value="match">Match</button></form>}
                    <form action={statementLineAction} className="row" style={{ gap: 6 }}><input type="hidden" name="statement_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                      <select name="account_id" aria-label="Post to ledger" defaultValue={others.find((a) => a.code === "5810")?.id}>{others.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
                      <button className="btn sm ghost" name="do" value="post">Post entry</button></form>
                  </div>)}</td></tr>))}</tbody>
        </table>
      </div>
      <div className="card" style={{ maxWidth: 700 }}><h2>Bank reconciliation statement on {d(String(r.s.date_to).slice(0, 10))}</h2>
        <table className="fin"><tbody>
          <tr><td>Balance in the books</td><td className="num"><Money v={r.book} /></td></tr>
          {r.unpresented.map((u, k) => <tr key={k}><td className="ind small">Less not yet on the statement: {u.doc_no} · {d(String(u.journal_date).slice(0, 10))} · {String(u.narration).slice(0, 50)}</td><td className="num"><Money v={-Number(u.amt)} /></td></tr>)}
          <tr className="tot"><td>Balance the bank should show</td><td className="num"><Money v={r.expectedBank} /></td></tr>
          {r.s.closing_balance != null && <tr><td>Closing balance on the statement</td><td className={`num ${Number(r.s.closing_balance) !== Number(r.expectedBank) ? "neg" : "okline"}`}><Money v={r.s.closing_balance} /></td></tr>}
        </tbody></table>
        <p className="small muted"><Link href="/accounts/bank">Back to bank</Link></p>
      </div>
    </>
  );
}
