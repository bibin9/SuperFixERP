import { requireCtx } from "@/lib/session";
import { trialBalance } from "@/lib/services/ledger";
import { Money, PageHead } from "@/components/ui";

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const scope = ctx.allBranches && sp.branch !== "current" ? "all" : ctx.currentBranchId!;
  const tb = await trialBalance(ctx, scope);
  return (
    <>
      <PageHead title="Trial balance" sub={`${scope === "all" ? "Company total" : "Current branch"} · every posting is created with its document and must balance per branch.`} />
      {tb.bankHidden && <div className="flash warn">Cash and bank balances are hidden for your role (field permission: bank balances).</div>}
      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{tb.rows.map((r) => <tr key={r.code}><td>{r.code}</td><td>{r.name}</td><td>{r.account_type}</td><td className="num"><Money v={r.debit} /></td><td className="num"><Money v={r.credit} /></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}>Total</td><td className="num"><Money v={tb.totals.debit} /></td><td className="num"><Money v={tb.totals.credit} /></td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
