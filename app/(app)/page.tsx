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
        {can(ctx, "customers", "create") && <Link className="btn" href="/enquiries/new">New enquiry</Link>}
      </PageHead>
      <div className="grid4">
        <div className="kpi"><div className="v">{total}</div><div className="l">Cars on site</div></div>
        <div className="kpi"><div className="v" style={{ color: d.late.length ? "var(--late)" : undefined }}>{d.late.length}</div><div className="l">Late jobs</div></div>
        <div className="kpi"><div className="v">{d.enq.open}</div><div className="l">Enquiries to quote ({d.enq.overdue} past follow-up)</div></div>
        <div className="kpi"><div className="v">{canSee(ctx, "selling_price") ? <Money v={d.sales.net} /> : "—"}</div><div className="l">Sales today, AED (net of VAT)</div></div>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Quotations</h2>
          <table><tbody>
            <tr><td><Link href="/enquiries?status=quoted">Sent, waiting for the customer</Link></td><td className="num">{d.enq.quoted}</td></tr>
            <tr><td><Link href="/enquiries?status=approved">Approved, job card to create</Link></td><td className="num"><b>{d.enq.approved}</b></td></tr>
          </tbody></table>
        </div>
        <div className="card"><h2>How work starts</h2>
          <p className="small">Enquiry, then quotation, then the customer&apos;s approval, then the job card. A job card can only be created from an approved quotation.</p>
        </div>
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
