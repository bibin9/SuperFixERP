import { requireCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { balanceSheet } from "@/lib/services/financials";
import { Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function BalanceSheet({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  let r;
  try { r = await balanceSheet(ctx, { asof: one(sp.asof), branches: branchesParam(sp).join(","), side: one(sp.side) }); } catch (e) {
    if (e instanceof AppError && e.code === "forbidden") return (<><PageHead title="Balance sheet" /><AccountsTabs group="statements" at="/accounts/bs" /><div className="flash warn">{e.message}</div></>);
    throw e;
  }
  const bq = branchesParam(sp).map((b) => `&branches=${b}`).join("");
  const Lines = ({ rows }: { rows: typeof r.assets }) => <>{rows.map((x) => (
    <tr key={x.id}><td className="ind"><Link href={`/accounts/ledger?account=${x.code}&from=2000-01-01&to=${r.asof}${bq}`}>{x.code}</Link> {x.name}</td>{r.cols.map((c) => <td key={c.key} className={`num ${Number(x.v[c.key]) < 0 ? "neg" : ""}`}><Money v={x.v[c.key]} /></td>)}</tr>))}</>;
  const Tot = ({ label, v, strong }: { label: string; v: Record<string, string>; strong?: boolean }) => (
    <tr className={strong ? "tot" : "grp"}><td>{label}</td>{r.cols.map((c) => <td key={c.key} className="num"><Money v={v[c.key]} /></td>)}</tr>);
  return (
    <>
      <PageHead title="Balance sheet" sub={`As on ${d(r.asof)}. Branch columns include inter-branch clearing, which nets to zero for the company.`} />
      <AccountsTabs group="statements" at="/accounts/bs" />
      <FinFilter scope={r.scope} mode="asof" asof={r.asof} side={r.scope.sideBySide} />
      {!r.balanced && <div className="flash err">The balance sheet does not balance. Check for postings outside the posting engine.</div>}
      <div className="card">
        <table className="fin">
          <thead><tr><th>Ledger</th>{r.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            <tr className="grp"><td colSpan={r.cols.length + 1}>Assets</td></tr><Lines rows={r.assets} /><Tot label="Total assets" v={r.totalAssets} strong />
            <tr className="grp"><td colSpan={r.cols.length + 1}>Liabilities</td></tr><Lines rows={r.liabilities} /><Tot label="Total liabilities" v={r.totalLiabilities} />
            <tr className="grp"><td colSpan={r.cols.length + 1}>Equity</td></tr><Lines rows={r.equity} />
            <tr><td className="ind">Profit for the period (not yet closed to retained earnings)</td>{r.cols.map((c) => <td key={c.key} className="num"><Money v={r.profit[c.key]} /></td>)}</tr>
            <Tot label="Total liabilities and equity" v={r.totalLE} strong />
          </tbody>
        </table>
      </div>
    </>
  );
}
