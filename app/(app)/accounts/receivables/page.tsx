import { requireCtx } from "@/lib/session";
import { receivablesAgeing, BUCKETS } from "@/lib/services/financials";
import { Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function Receivables({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const r = await receivablesAgeing(ctx, { asof: one(sp.asof), branches: branchesParam(sp).join(","), overdue: one(sp.overdue) });
  return (
    <>
      <PageHead title="Receivables by branch" sub={`What customers owe on ${d(r.asof)}, by days past the due date, with credit limit and overdue. Total ${Number(r.total).toFixed(2)} · overdue ${Number(r.overdue).toFixed(2)}.`} />
      <AccountsTabs group="parties" at="/accounts/receivables" />
      <FinFilter scope={r.scope} mode="asof" asof={r.asof}><label className="small shrink" style={{ marginBottom: 14 }}><input type="checkbox" name="overdue" value="1" defaultChecked={one(sp.overdue) === "1"} /> Overdue only</label></FinFilter>
      <Ageing r={r} kind="customer" />
    </>
  );
}

export function Ageing({ r, kind }: { r: Awaited<ReturnType<typeof receivablesAgeing>>; kind: "customer" | "supplier" }) {
  return (
    <div className="card">
      <table className="fin">
        <thead><tr><th>{kind === "customer" ? "Customer" : "Supplier"}</th>{BUCKETS.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Total</th><th className="num">Overdue</th><th className="num">Credit limit</th><th className="num">{kind === "customer" ? "Credit left" : "Limit left"}</th><th className="num">{kind === "customer" ? "Held for them" : "Paid on account"}</th></tr></thead>
        <tbody>
          {r.branches.map((b) => [
            <tr key={b.code} className="grp"><td colSpan={BUCKETS.length + 6}>{b.code}</td></tr>,
            ...b.parties.map((p) => {
              const pid = p.customer_id ?? p.supplier_id;
              return (
                <tr key={b.code + pid}><td className="ind"><Link href={`/accounts/statement?party=${kind}&id=${pid}`}>{p.name}</Link> <span className="small muted">{p.no}</span></td>
                  {BUCKETS.map(([k]) => <td key={k} className={`num ${k !== "not_due" && Number(p.b[k]) > 0 ? "neg" : ""}`}>{Number(p.b[k]) ? <Money v={p.b[k]} /> : ""}</td>)}
                  <td className="num"><b><Money v={p.total} /></b></td><td className="num">{Number(p.overdue) > 0 && <span className="neg"><Money v={p.overdue} /></span>}</td>
                  <td className="num">{Number(p.credit_limit) > 0 && <Money v={p.credit_limit} />}</td><td className={`num ${p.over_limit ? "neg" : ""}`}>{p.available !== "" && <Money v={p.available} />}</td>
                  <td className="num">{Number(p.held) > 0 && <Money v={p.held} />}</td></tr>);
            }),
            <tr key={b.code + "t"}><td><b>{b.code} total</b></td>{BUCKETS.map(([k]) => <td key={k} className="num"><b><Money v={b.sub[k]} /></b></td>)}<td className="num"><b><Money v={b.total} /></b></td><td colSpan={4}></td></tr>,
          ])}
          {!r.branches.length && <tr><td colSpan={BUCKETS.length + 6} className="muted">Nothing is open.</td></tr>}
        </tbody>
        <tfoot><tr className="tot"><td>All branches</td>{BUCKETS.map(([k]) => <td key={k} className="num"><Money v={r.grand[k]} /></td>)}<td className="num"><Money v={r.total} /></td><td className="num"><Money v={r.overdue} /></td><td colSpan={3}></td></tr></tfoot>
      </table>
    </div>
  );
}
