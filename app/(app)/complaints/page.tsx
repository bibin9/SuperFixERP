import { requireCtx } from "@/lib/session";
import { listComplaints } from "@/lib/services/complaints";
import { Flash, Link, PageHead, dt, d } from "@/components/ui";

/** OT-03: customer complaints register. */
export default async function Complaints({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const show = ["open", "mine", "overdue", "closed", "all"].includes(sp.show) ? sp.show : "open";
  const { rows, stats } = await listComplaints(ctx, show);
  return (
    <>
      <PageHead title="Customer complaints" sub="Every complaint with who deals with it, what was done and when it was closed. Open one from the customer's page, the job card, or a low feedback rating." />
      <Flash sp={sp} />
      <div className="grid4">
        <div className="kpi"><div className="v">{stats.open}</div><div className="l">Open</div></div>
        <div className="kpi"><div className="v" style={{ color: stats.overdue ? "var(--late)" : undefined }}>{stats.overdue}</div><div className="l">Past the close-by date</div></div>
        <div className="kpi"><div className="v">{stats.mine}</div><div className="l">With me</div></div>
        <div className="kpi"><div className="v">{stats.avg_days ?? "—"}</div><div className="l">Average days to close (90 days)</div></div>
      </div>
      <div className="tabs chips" style={{ marginTop: 16 }}>
        {[["open", "Open"], ["mine", "With me"], ["overdue", "Overdue"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} className={show === k ? "on" : ""} href={`/complaints?show=${k}`}>{l}</Link>)}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Complaint</th><th>Customer</th><th>Complaint</th><th>Owner</th><th>Status</th></tr></thead>
          <tbody>{rows.map((k) => (
            <tr key={k.id}>
              <td><Link href={`/complaints/${k.id}`}>{k.doc_no}</Link><div className="small muted">{k.branch_code} · {dt(k.opened_at)}</div>{k.job_no && <div className="small"><Link href={`/jobs/${k.job_card_id}`}>{k.job_no}</Link></div>}</td>
              <td>{k.customer_name}<div className="small muted">{k.mobile}</div></td>
              <td className="small">{k.description}<div className="muted">{k.source_name}{k.actions > 1 ? ` · ${k.actions - 1} action${k.actions > 2 ? "s" : ""}` : ""}</div></td>
              <td className="small">{k.owner_name ?? "—"}</td>
              <td>{k.status === "closed" ? <><span className="pill green">Closed</span><div className="small muted">{dt(k.closed_at)}</div></>
                : <><span className={`pill ${k.overdue ? "red" : k.status === "open" ? "amber" : "blue"}`}>{k.overdue ? "Overdue" : k.status === "open" ? "Open" : "In progress"}</span><div className="small muted">close by {d(k.due_date)}</div></>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted">No complaints here.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
