import { requireCtx } from "@/lib/session";
import { listPeriods, periodChecklist } from "@/lib/services/accounting-close";
import { periodAction } from "@/app/actions-accounting";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, PageHead, Status, dt } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { ConfirmButton } from "@/components/ConfirmButton";

const monthName = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function Periods({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const periods = await listPeriods(ctx);
  const sel = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : periods.find((p) => p.status === "open" && Number(p.journals) > 0)?.period_month ?? periods[0].period_month;
  const ck = await periodChecklist(ctx, sel);
  const isOwner = ctx.grants.some((g) => g.roleCode === "owner");
  const canClose = canAnywhere(ctx, "accounting", "approve");
  const year = new Date().getFullYear();
  return (
    <>
      <PageHead title="Period close" sub="A closed month is locked for every user: nothing can be posted into it. Months close in order. Only the owner can reopen a month, and the reason is logged." />
      <AccountsTabs group="monthend" at="/accounts/periods" />
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card"><h2>Months</h2>
          <table>
            <thead><tr><th>Month</th><th className="num">Journals</th><th>Status</th><th>Closed by</th></tr></thead>
            <tbody>{periods.map((p) => (
              <tr key={p.period_month} className={p.period_month === sel ? "sel" : ""}><td><Link href={`/accounts/periods?month=${p.period_month.slice(0, 7)}`}>{monthName(p.period_month)}</Link></td><td className="num">{p.journals}</td><td><Status s={p.status} /></td>
                <td className="small">{p.status === "closed" ? `${p.closed_by_name} · ${dt(p.closed_at)}` : p.reopened_at ? `Reopened by ${p.reopened_by_name}: ${p.reopen_reason}` : ""}</td></tr>))}</tbody>
          </table>
        </div>
        <div className="card"><h2>{monthName(ck.month)} <Status s={ck.status} /></h2>
          <ul className="check" style={{ listStyle: "none", paddingLeft: 0 }}>{ck.items.map((i) => (
            <li key={i.key} className={i.ok ? "ok" : "no"}>{i.label}. <span className="small muted">{i.detail}</span> {i.link && <Link className="small" href={i.link}>Open</Link>}
              {i.manual && ck.status === "open" && canAnywhere(ctx, "accounting", "edit") && (
                <form action={periodAction} style={{ display: "inline", marginLeft: 6 }}><input type="hidden" name="month" value={ck.month} /><input type="hidden" name="key" value={i.key} /><input type="hidden" name="on" value={i.ok ? "0" : "1"} />
                  <button className="btn sm ghost" name="do" value="tick">{i.ok ? "Untick" : "Mark as reviewed"}</button></form>)}
            </li>))}</ul>
          {ck.status === "open" && canClose && (
            <form action={periodAction}><input type="hidden" name="month" value={ck.month} />
              <ConfirmButton className="btn green" name="do" value="close" message={`Close ${monthName(ck.month)}? Nothing can be posted into it afterwards unless the owner reopens it.`}>Close {monthName(ck.month)}</ConfirmButton></form>)}
          {ck.status === "closed" && isOwner && (
            <form action={periodAction} className="row" style={{ alignItems: "flex-end" }}><input type="hidden" name="month" value={ck.month} />
              <div className="field"><label>Reason for reopening</label><input name="reason" required minLength={5} /></div>
              <div className="shrink"><ConfirmButton className="btn amber" name="do" value="reopen" message="Reopen this month? The reason is recorded in the audit log.">Reopen</ConfirmButton></div></form>)}
          {ck.status === "closed" && !isOwner && <p className="small muted">Only the owner can reopen a closed month.</p>}
        </div>
      </div>
      {canClose && (
        <div className="card" style={{ maxWidth: 700 }}><h2>Year-end close</h2>
          <p className="small muted">Moves each branch&apos;s profit or loss for the year into retained earnings, dated 31 December. Run it once, after the last day of the year, before closing December.</p>
          <form action={periodAction} className="row" style={{ alignItems: "flex-end" }}><input type="hidden" name="month" value={ck.month} />
            <div className="field"><label>Year</label><select name="year" defaultValue={year - 1}>{[year - 2, year - 1, year].map((y) => <option key={y}>{y}</option>)}</select></div>
            <div className="shrink"><ConfirmButton className="btn ghost" name="do" value="year_end" message="Post the year-end closing entry?">Close the year</ConfirmButton></div></form>
        </div>)}
    </>
  );
}
