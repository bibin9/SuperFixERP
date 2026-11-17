import { requireCtx } from "@/lib/session";
import { profitAndLoss } from "@/lib/services/financials";
import { Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function ProfitLoss({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const r = await profitAndLoss(ctx, { from: one(sp.from), to: one(sp.to), branches: branchesParam(sp).join(","), side: one(sp.side) });
  const bq = branchesParam(sp).map((b) => `&branches=${b}`).join("");
  const Lines = ({ rows }: { rows: typeof r.income }) => <>{rows.map((x) => (
    <tr key={x.id}><td className="ind"><Link href={`/accounts/ledger?account=${x.code}&from=${r.from}&to=${r.to}${bq}`}>{x.code}</Link> {x.name}</td>{r.cols.map((c) => <td key={c.key} className="num"><Money v={x.v[c.key]} /></td>)}</tr>))}</>;
  const Tot = ({ label, v, strong }: { label: string; v: Record<string, string>; strong?: boolean }) => (
    <tr className={strong ? "tot" : "grp"}><td>{label}</td>{r.cols.map((c) => <td key={c.key} className={`num ${Number(v[c.key]) < 0 ? "neg" : ""}`}><Money v={v[c.key]} /></td>)}</tr>);
  return (
    <>
      <PageHead title="Profit and loss" sub={`${d(r.from)} to ${d(r.to)} · ${r.scope.branches.length === r.scope.all.length ? "all your branches" : r.scope.branches.map((b) => b.code).join(", ")}. Head-office costs appear once allocated.`} />
      <AccountsTabs group="statements" at="/accounts/pl" />
      <FinFilter scope={r.scope} mode="range" from={r.from} to={r.to} side={r.scope.sideBySide} />
      <div className="card">
        <table className="fin">
          <thead><tr><th>Ledger</th>{r.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            <tr className="grp"><td colSpan={r.cols.length + 1}>Income</td></tr><Lines rows={r.income} /><Tot label="Total income" v={r.totalIncome} />
            <tr className="grp"><td colSpan={r.cols.length + 1}>Direct costs</td></tr><Lines rows={r.direct} /><Tot label="Gross profit" v={r.gross} />
            <tr className="grp"><td colSpan={r.cols.length + 1}>Other expenses</td></tr><Lines rows={r.indirect} /><Tot label="Total other expenses" v={r.totalIndirect} />
            <Tot label="Net profit" v={r.net} strong />
          </tbody>
        </table>
      </div>
    </>
  );
}
