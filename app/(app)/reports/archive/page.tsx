import { requireCtx } from "@/lib/session";
import { archiveStatus, ARCHIVE_TABLES } from "@/lib/services/archive";
import { Flash, PageHead, dt, d } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { runArchiveAction } from "@/app/actions-reports";

export default async function Archive({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const a = await archiveStatus(ctx);
  const label = (t: string) => ARCHIVE_TABLES.find((x) => x.tbl === t)?.label ?? t;
  const pendingTotal = a.pending ? Object.values(a.pending).reduce((s, n) => s + n, 0) : 0;
  return (
    <>
      <PageHead title="Archive" sub={`Closed, paid and posted transactions older than ${a.live} months move to the archive every ${a.every} months. Archived records are read only, kept ${a.keep} years, and appear in reports when you choose Archived as the data source. Masters are never archived.`} />
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card" data-testid="archive-status">
          <h2>Next run</h2>
          <p>Records dated before <b>{d(a.cutoff)}</b> are eligible today. {a.runs.length ? <>The next run is due on <b>{d(a.nextDue)}</b>{a.due ? " (due now)" : ""}.</> : "No archive has been run yet."}</p>
          <p className="small muted">The live window, how often and how long to keep are settings (Archive group in Settings).</p>
          {a.canRun ? (<>
            <table><tbody>{Object.entries(a.pending!).map(([t, n]) => <tr key={t}><td>{label(t)}</td><td className="num" data-testid={`pending-${t}`}>{n}</td></tr>)}</tbody></table>
            <form action={runArchiveAction} className="row" style={{ alignItems: "flex-end", marginTop: 10 }}>
              <div className="field"><label htmlFor="note">Note</label><input id="note" name="note" maxLength={300} placeholder="Optional" /></div>
              <div className="shrink"><ConfirmButton className="btn" message={`Archive ${pendingTotal} records dated before ${d(a.cutoff)}? They become read only.`} disabled={!pendingTotal}>Run the archive now</ConfirmButton></div>
            </form>
          </>) : <p className="small muted">Only the owner or an administrator with access to every branch runs the archive.</p>}
        </div>
        <div className="card">
          <h2>In the archive</h2>
          <table><tbody>{ARCHIVE_TABLES.map((t) => <tr key={t.tbl}><td>{t.label}</td><td className="num">{a.archivedTotals[t.tbl] ?? 0}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }} data-testid="archive-runs">
        <h2>Archive runs</h2>
        <table><thead><tr><th>Run</th><th>When</th><th>By</th><th>Before</th><th className="num">Records</th><th>Ledger check</th><th>Keep until</th><th>Note</th></tr></thead><tbody>
          {a.runs.map((r) => { const total = Object.values(r.counts as Record<string, number>).reduce((s, n) => s + Number(n), 0); const lc = r.ledger_check as { debit: string; credit: string; balanced: boolean };
            return <tr key={r.id}><td>{r.run_no}</td><td className="small">{dt(r.run_at)}</td><td>{r.run_by}</td><td>{d(r.cutoff)}</td><td className="num">{total}</td>
              <td className="small">{lc.balanced ? `Balanced: debit ${Number(lc.debit).toFixed(2)} = credit ${Number(lc.credit).toFixed(2)}` : "Not balanced"}</td><td>{d(r.keep_until)}</td><td className="small">{r.note}</td></tr>; })}
          {!a.runs.length && <tr><td colSpan={8} className="muted">No runs yet.</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}
