import { requireCtx } from "@/lib/session";
import { hoPreview } from "@/lib/services/accounting-close";
import { hoAllocationAction } from "@/app/actions-accounting";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, Money, PageHead, dt } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function Allocation({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : now;
  const pv = await hoPreview(ctx, month);
  return (
    <>
      <PageHead title="Head-office cost allocation" sub={`Charges head-office costs to the workshops so each branch P&L carries its share. Basis: ${pv.basis === "fixed" ? "fixed percentage per branch" : "share of revenue"} (change it under Settings, accounting.ho_basis).`} />
      <AccountsTabs group="monthend" at="/accounts/allocation" />
      <Flash sp={sp} />
      <div className="card no-print"><form className="row" style={{ alignItems: "flex-end" }}>
        <div className="field"><label>Month</label><input type="month" name="month" defaultValue={month} /></div><div className="shrink"><button className="btn ghost">Preview</button></div></form></div>
      <div className="card" style={{ maxWidth: 820 }}>
        <h2>{month} · head-office costs <Money v={pv.cost} /></h2>
        {pv.done && <div className="flash ok">Posted on {dt(pv.done.posted_at)} as <Link href={`/accounts/journal/${pv.done.journal_id}`}>{pv.done.journal_no}</Link>.</div>}
        {pv.problem && !pv.done && <div className="flash warn">{pv.problem}</div>}
        <table>
          <thead><tr><th>Branch</th><th className="num">Revenue</th><th className="num">Share</th><th className="num">Charged</th></tr></thead>
          <tbody>{pv.shares.map((s) => <tr key={s.branch_id}><td>{s.code} · {s.name}</td><td className="num"><Money v={s.revenue} /></td><td className="num">{s.pct}%</td><td className="num"><Money v={s.amount} /></td></tr>)}</tbody>
        </table>
        {!pv.done && !pv.problem && canAnywhere(ctx, "accounting", "create") && (
          <form action={hoAllocationAction} style={{ marginTop: 10 }}><input type="hidden" name="month" value={`${month}-01`} />
            <ConfirmButton className="btn green" message="Post this allocation? It is posted once per month.">Post allocation</ConfirmButton></form>)}
        <p className="small muted">Each branch is charged through inter-branch clearing; the last branch takes any rounding so the total is exact.</p>
      </div>
    </>
  );
}
