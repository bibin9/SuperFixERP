import { requireCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { ledgerReport, SOURCE_NAMES } from "@/lib/services/financials";
import { Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function Ledger({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  let r;
  try { r = await ledgerReport(ctx, { account: one(sp.account), from: one(sp.from), to: one(sp.to), branches: branchesParam(sp).join(",") }); } catch (e) {
    if (e instanceof AppError && e.code === "forbidden") return (<><PageHead title="Ledger" /><AccountsTabs group="books" at="/accounts/ledger" /><div className="flash warn">{e.message}</div></>);
    throw e;
  }
  return (
    <>
      <PageHead title="Ledger" sub="Every entry on one ledger with the running balance. The balance on any date is the closing figure with that date as the end. Click an entry to see the full voucher." />
      <AccountsTabs group="books" at="/accounts/ledger" />
      <FinFilter scope={r.scope} mode="range" from={r.from} to={r.to}>
        <div className="field"><label>Ledger</label><select name="account" defaultValue={r.account?.code ?? ""} required><option value="">Choose…</option>{r.accounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}</select></div>
      </FinFilter>
      {r.account && (
        <div className="card">
          <h2>{r.account.code} · {r.account.name}</h2>
          <table className="fin">
            <thead><tr><th>Date</th><th>Entry</th><th>Type</th><th>Branch</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr className="grp"><td>{d(r.from)}</td><td colSpan={6}>Opening balance</td><td className="num"><Money v={r.opening} /></td></tr>
              {r.rows.map((l, k) => (
                <tr key={k}><td>{d(l.journal_date)}</td><td><Link href={`/accounts/journal/${l.journal_id}`}>{l.doc_no}</Link></td><td className="small">{l.link ? <Link href={l.link}>{SOURCE_NAMES[l.source_type] ?? l.source_type}</Link> : SOURCE_NAMES[l.source_type] ?? l.source_type}</td>
                  <td>{l.branch_code}</td><td className="small">{l.narration}{l.party && <span className="muted"> · {l.party}</span>}</td>
                  <td className="num">{Number(l.debit) > 0 && <Money v={l.debit} />}</td><td className="num">{Number(l.credit) > 0 && <Money v={l.credit} />}</td><td className="num"><Money v={l.balance} /></td></tr>))}
              <tr className="tot"><td colSpan={5}>Closing balance on {d(r.to)} (debit positive)</td><td className="num"><Money v={r.debit} /></td><td className="num"><Money v={r.credit} /></td><td className="num"><Money v={r.closing} /></td></tr>
            </tbody>
          </table>
        </div>)}
    </>
  );
}
