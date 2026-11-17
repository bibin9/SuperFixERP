import { Fragment } from "react";
import { requireCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { cashFlow } from "@/lib/services/financials";
import { Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");
const NAMES: Record<string, string> = { operating: "Operating activities", investing: "Investing activities", financing: "Financing activities" };

export default async function CashFlow({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  let r;
  try { r = await cashFlow(ctx, { from: one(sp.from), to: one(sp.to), branches: branchesParam(sp).join(",") }); } catch (e) {
    if (e instanceof AppError && e.code === "forbidden") return (<><PageHead title="Cash flow" /><AccountsTabs group="statements" at="/accounts/cash-flow" /><div className="flash warn">{e.message}</div></>);
    throw e;
  }
  return (
    <>
      <PageHead title="Cash flow" sub={`${d(r.from)} to ${d(r.to)} · money into and out of cash and bank, by what it was for (direct method).`} />
      <AccountsTabs group="statements" at="/accounts/cash-flow" />
      <FinFilter scope={r.scope} mode="range" from={r.from} to={r.to} />
      <div className="card" style={{ maxWidth: 760 }}>
        <table className="fin">
          <tbody>
            <tr className="grp"><td>Cash and bank at the start</td><td className="num"><Money v={r.opening} /></td></tr>
            {(["operating", "investing", "financing"] as const).map((k) => (<Fragment key={k}>
              <tr className="grp"><td colSpan={2}>{NAMES[k]}</td></tr>
              {r.groups[k].map((x) => <tr key={k + x.code}><td className="ind">{x.code} {x.name}</td><td className={`num ${Number(x.v) < 0 ? "neg" : ""}`}><Money v={x.v} /></td></tr>)}
              {!r.groups[k].length && <tr key={k + "none"}><td className="ind muted small" colSpan={2}>None</td></tr>}
              <tr key={k + "t"}><td><b>Net from {NAMES[k].toLowerCase()}</b></td><td className="num"><b><Money v={r.totals[k]} /></b></td></tr>
            </Fragment>))}
            <tr className="tot"><td>Net change in cash and bank</td><td className="num"><Money v={r.net} /></td></tr>
            <tr className="tot"><td>Cash and bank at the end</td><td className="num"><Money v={r.closing} /></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
