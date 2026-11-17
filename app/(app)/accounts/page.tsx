import { requireCtx } from "@/lib/session";
import { trialBalanceAsOf, finScope } from "@/lib/services/financials";
import { Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";

type SP = Record<string, string | string[]>;
export const branchesParam = (sp: SP) => (Array.isArray(sp.branches) ? sp.branches : sp.branches ? [sp.branches] : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function TrialBalance({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tb = await trialBalanceAsOf(ctx, { asof: one(sp.asof), branches: branchesParam(sp).join(","), side: one(sp.side) });
  void finScope;
  const bq = branchesParam(sp).map((b) => `&branches=${b}`).join("");
  const grouped = one(sp.group) === "1";
  const groups = [...new Set(tb.lines.map((l) => l.account_group))];
  const ordered = grouped ? groups.flatMap((g) => tb.lines.filter((l) => l.account_group === g)) : tb.lines;
  const groupNet = (g: string, key: string) => tb.lines.filter((l) => l.account_group === g).reduce((s, l) => s + Number(l.net[key] ?? 0), 0);
  return (
    <>
      <PageHead title="Trial balance" sub={`As on ${d(tb.asof)} · ${tb.scope.branches.length === tb.scope.all.length ? "all your branches" : tb.scope.branches.map((b) => b.code).join(", ")}. Click a ledger to see its entries.`} />
      <AccountsTabs group="statements" at="/accounts" />
      <FinFilter scope={tb.scope} mode="asof" asof={tb.asof} side={tb.scope.sideBySide}>
        <label className="small shrink" style={{ marginBottom: 14 }}><input type="checkbox" name="group" value="1" defaultChecked={grouped} /> Group totals</label>
      </FinFilter>
      {tb.bankHidden && <div className="flash warn">Cash and bank balances are hidden for your role (field permission: bank balances), so the totals do not include them.</div>}
      <div className="card">
        <table className="fin">
          <thead><tr><th>Code</th><th>Ledger</th><th>Group</th>{tb.scope.sideBySide && tb.cols.filter((c) => c.key !== "total").map((c) => <th key={c.key} className="num">{c.label}</th>)}<th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{ordered.map((r, k) => [
            grouped && (k === 0 || ordered[k - 1].account_group !== r.account_group) ? (
              <tr key={"g" + r.account_group} className="grp"><td colSpan={3}>{r.account_group}</td>
                {tb.scope.sideBySide && tb.cols.filter((c) => c.key !== "total").map((c) => <td key={c.key} className="num"><Money v={groupNet(r.account_group, c.key)} /></td>)}
                <td className="num">{groupNet(r.account_group, "total") > 0 && <Money v={groupNet(r.account_group, "total")} />}</td><td className="num">{groupNet(r.account_group, "total") < 0 && <Money v={-groupNet(r.account_group, "total")} />}</td></tr>) : null,
            <tr key={r.id}><td className={grouped ? "ind" : ""}><Link href={`/accounts/ledger?account=${r.code}&to=${tb.asof}&from=2000-01-01${bq}`}>{r.code}</Link></td><td>{r.name}</td><td className="small muted">{r.account_group}</td>
              {tb.scope.sideBySide && tb.cols.filter((c) => c.key !== "total").map((c) => <td key={c.key} className="num"><Money v={r.net[c.key]} /></td>)}
              <td className="num">{r.debit && <Money v={r.debit} />}</td><td className="num">{r.credit && <Money v={r.credit} />}</td></tr>])}
            {!tb.lines.length && <tr><td colSpan={6} className="muted">Nothing posted yet.</td></tr>}
          </tbody>
          <tfoot><tr className="tot"><td colSpan={3 + (tb.scope.sideBySide ? tb.cols.length - 1 : 0)}>Total {tb.balanced ? <span className="okline small">· balanced</span> : <span className="neg small">· does not balance</span>}</td><td className="num"><Money v={tb.debit} /></td><td className="num"><Money v={tb.credit} /></td></tr></tfoot>
        </table>
        {tb.scope.sideBySide && <p className="small muted">Branch columns show the net balance (debit positive, credit negative).</p>}
      </div>
    </>
  );
}
