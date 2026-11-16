import { requireCtx } from "@/lib/session";
import { listJobs, STATUS_LABEL } from "@/lib/services/jobs";
import { can } from "@/lib/access";
import { Flash, Link, PageHead, Status, custName, plate, dt } from "@/components/ui";

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listJobs(ctx, sp.status ?? "");
  const tech = !can(ctx, "jobs", "view");
  return (
    <>
      <PageHead title={tech ? "My jobs" : "Job cards"} sub={tech ? "Jobs with work assigned to you." : "Your branches only; the owner sees all branches."}>
        {can(ctx, "jobs", "create") && <Link className="btn" href="/jobs/new">New check-in</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="tabs">{["", "checked_in", "awaiting_approval", "approved", "awaiting_parts", "in_progress", "quality_check", "ready", "invoiced", "closed"].map((s) => (
        <Link key={s} className={(sp.status ?? "") === s ? "on" : ""} href={`/jobs${s ? `?status=${s}` : ""}`}>{s ? STATUS_LABEL[s] : "All"}</Link>
      ))}</div>
      <div className="card">
        <table>
          <thead><tr><th>Job</th><th>Branch</th><th>Vehicle</th><th>Customer</th><th>Status</th><th>Promised</th></tr></thead>
          <tbody>{rows.map((j) => (
            <tr key={j.id}><td><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></td><td>{j.branch_code}</td><td>{plate(j)} · {j.make} {j.model}</td><td>{custName(j)}</td>
              <td><Status s={j.status} /> {j.late && <span className="pill red">Late</span>}</td><td className="small">{dt(j.promised_at)}</td></tr>
          ))}</tbody>
        </table>
        {!rows.length && <p className="muted">No jobs.</p>}
      </div>
    </>
  );
}
