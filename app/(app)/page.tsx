import { requireCtx } from "@/lib/session";
import { dashboard } from "@/lib/services/home";
import { canSee, roleAt, can } from "@/lib/access";
import { Link, Money, Status, dt, PageHead } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/services/jobs";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const scope = ctx.allBranches && sp.scope !== "current" ? "all" : "current";
  const d = await dashboard(ctx, scope);
  const role = roleAt(ctx, null);
  const total = d.byStatus.reduce((s, r) => s + Number(r.n), 0);
  return (
    <>
      <PageHead title={`Good day, ${ctx.fullName.split(" ")[0]}`} sub={`${role?.roleName} · ${scope === "all" ? "all branches" : "current branch"}`}>
        {ctx.allBranches && <Link className="btn ghost sm" href={scope === "all" ? "/?scope=current" : "/"}>{scope === "all" ? "Current branch only" : "All branches"}</Link>}
        {can(ctx, "jobs", "create") && <Link className="btn" href="/jobs/new">New check-in</Link>}
      </PageHead>
      <div className="grid4">
        <div className="kpi"><div className="v">{total}</div><div className="l">Cars on site</div></div>
        <div className="kpi"><div className="v" style={{ color: d.late.length ? "var(--late)" : undefined }}>{d.late.length}</div><div className="l">Late jobs</div></div>
        <div className="kpi"><div className="v">{d.enq.open}</div><div className="l">Open enquiries ({d.enq.overdue} past follow-up)</div></div>
        <div className="kpi"><div className="v">{canSee(ctx, "selling_price") ? <Money v={d.sales.net} /> : "—"}</div><div className="l">Sales today (net of VAT)</div></div>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Jobs by status</h2>
          <table><tbody>
            {d.byStatus.map((r) => <tr key={r.status}><td><Link href={`/jobs?status=${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</Link></td><td className="num">{r.n}</td></tr>)}
            {!d.byStatus.length && <tr><td className="muted">No open jobs.</td></tr>}
          </tbody></table>
        </div>
        <div className="card">
          <h2>Late jobs</h2>
          <table><tbody>
            {d.late.map((j) => <tr key={j.id}><td><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></td><td><Status s={j.status} /></td><td className="small muted">promised {dt(j.promised_at)}</td></tr>)}
            {!d.late.length && <tr><td className="muted">Nothing late.</td></tr>}
          </tbody></table>
        </div>
      </div>
    </>
  );
}
