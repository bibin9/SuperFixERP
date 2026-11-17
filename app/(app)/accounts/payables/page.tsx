import { requireCtx } from "@/lib/session";
import { payablesAgeing } from "@/lib/services/financials";
import { PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";
import { Ageing } from "../receivables/page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function Payables({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const r = await payablesAgeing(ctx, { asof: one(sp.asof), branches: branchesParam(sp).join(","), overdue: one(sp.overdue) });
  return (
    <>
      <PageHead title="Payables by branch" sub={`What we owe suppliers on ${d(r.asof)}, by days past the due date. Total ${Number(r.total).toFixed(2)} · overdue ${Number(r.overdue).toFixed(2)}.`} />
      <AccountsTabs group="parties" at="/accounts/payables" />
      <FinFilter scope={r.scope} mode="asof" asof={r.asof}><label className="small shrink" style={{ marginBottom: 14 }}><input type="checkbox" name="overdue" value="1" defaultChecked={one(sp.overdue) === "1"} /> Overdue only</label></FinFilter>
      <Ageing r={r as never} kind="supplier" />
    </>
  );
}
