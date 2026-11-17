import { requireCtx } from "@/lib/session";
import { budgetGrid } from "@/lib/services/accounting-close";
import { finScope } from "@/lib/services/financials";
import { budgetAction } from "@/app/actions-accounting";
import { can } from "@/lib/access";
import { Flash, Money, PageHead } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Budgets({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const scope = await finScope(ctx, undefined);
  const branch = scope.all.find((b) => b.id === sp.branch)?.id ?? (scope.all.find((b) => b.id === ctx.currentBranchId)?.id ?? scope.all[0].id);
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : new Date().getFullYear();
  const g = await budgetGrid(ctx, branch, year);
  const edit = sp.view !== "report" && can(ctx, "accounting", "edit", branch);
  return (
    <>
      <PageHead title="Budget against actual" sub="Budgets per branch, ledger and month. Variance is favourable (positive) when income is above budget or spending is below it." />
      <AccountsTabs group="statements" at="/accounts/budgets" />
      <Flash sp={sp} />
      <div className="card no-print"><form className="row" style={{ alignItems: "flex-end" }}>
        <div className="field"><label>Branch</label><select name="branch" defaultValue={branch}>{scope.all.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}</select></div>
        <div className="field"><label>Year</label><input name="year" inputMode="numeric" defaultValue={year} /></div>
        <div className="field"><label>View</label><select name="view" defaultValue={sp.view ?? (edit ? "edit" : "report")}><option value="report">Budget against actual</option>{can(ctx, "accounting", "edit", branch) && <option value="edit">Enter budgets</option>}</select></div>
        <div className="shrink"><button className="btn ghost">Show</button></div></form></div>
      {edit ? (
        <form action={budgetAction} className="card" style={{ overflowX: "auto" }}>
          <input type="hidden" name="branch_id" value={branch} /><input type="hidden" name="year" value={year} />
          <table className="budget"><thead><tr><th>Ledger</th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
            <tbody>{g.rows.map((r) => (
              <tr key={r.id}><td className="small">{r.code} {r.name}</td>{r.months.map((m: { m: number; budget: string }) => <td key={m.m}><input name={`b[${r.id}:${m.m}]`} defaultValue={m.budget} inputMode="decimal" aria-label={`${r.code} ${MONTHS[m.m - 1]}`} /></td>)}</tr>))}</tbody></table>
          <button className="btn green" style={{ marginTop: 10 }}>Save budgets</button>
        </form>
      ) : (
        <div className="card">
          <table className="fin"><thead><tr><th>Ledger</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Variance</th><th className="num">% used</th></tr></thead>
            <tbody>{(["income", "expense"] as const).map((t) => [
              <tr key={t} className="grp"><td colSpan={5}>{t === "income" ? "Income" : "Expenses"}</td></tr>,
              ...g.rows.filter((r) => r.account_type === t && (Number(r.budget) || Number(r.actual))).map((r) => (
                <tr key={r.id}><td className="ind">{r.code} {r.name}</td><td className="num"><Money v={r.budget} /></td><td className="num"><Money v={r.actual} /></td><td className={`num ${Number(r.variance) < 0 ? "neg" : "okline"}`}><Money v={r.variance} /></td><td className="num">{r.pct ? `${r.pct}%` : ""}</td></tr>)),
            ])}</tbody></table>
        </div>)}
    </>
  );
}
