import { OlderRows } from "@/components/OlderRows";
import { offsetOf } from "@/lib/paging";
import { requireCtx } from "@/lib/session";
import { listJobs, jobCounts, STATUS_LABEL } from "@/lib/services/jobs";
import { can } from "@/lib/access";
import { Flash, Link, PageHead, Status, custName, Plate, dt } from "@/components/ui";
import { ListToolbar } from "@/components/ListToolbar";

const STATUSES = ["", "approved", "awaiting_parts", "in_progress", "quality_check", "ready", "invoiced", "closed", "late"];
const initials = (n?: string | null) => (n ?? "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, counts] = await Promise.all([listJobs(ctx, sp.status ?? "", sp.q ?? "", offsetOf(sp)), jobCounts(ctx)]);
  const tech = !can(ctx, "jobs", "view");
  const cards = sp.view === "cards";
  return (
    <>
      <PageHead title={tech ? "My jobs" : "Job cards"} sub={tech ? "Jobs with work assigned to you." : "Your branches only; the owner sees all branches."}>
        {can(ctx, "invoices", "create") && can(ctx, "jobs", "create") && <Link className="btn ghost" href="/billing/quick">Quick job</Link>}
        {can(ctx, "customers", "create") && <Link className="btn" href="/enquiries/new">New enquiry</Link>}
      </PageHead>
      <Flash sp={sp} />
      <ListToolbar base="/jobs" sp={sp} placeholder="Search job no., customer, mobile, plate or car" shown={rows.length} total={counts[sp.status ?? ""] ?? 0}
        chips={STATUSES.map((s) => [s, s === "late" ? "Late" : s ? STATUS_LABEL[s] : "All", counts[s] ?? 0])} />
      {cards ? (
        <div className="cardgrid">
          {rows.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card lcard">
              <div className="lc-top"><b>{j.doc_no}</b><span>{j.late && <span className="pill red">Late</span>} <Status s={j.status} /></span></div>
              <div className="lc-car"><Plate v={j} /><span className="muted small">{j.make} {j.model}{j.model_year ? <><br />{j.model_year}</> : null}</span></div>
              <div className="lc-cust">{custName(j)}</div>
              {j.summary && <div className="muted small lc-sum">{j.summary}</div>}
              <div className="lc-foot small"><span>{j.branch_name}</span><span className="muted">Promised {dt(j.promised_at)}</span></div>
              <div className="lc-foot small"><span>{j.techs ?? "No technician yet"}</span><Hours std={j.std_h} act={j.actual_h} /></div>
              {j.advisor_name && <div className="lc-foot"><span className="avatar sm" title={j.advisor_name}>{initials(j.advisor_name)}</span>{j.value != null && <b>AED {Number(j.value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>}</div>}
            </Link>
          ))}
        </div>
      ) : (
        <div className="card">
          <table>
            <thead><tr><th>Job</th><th>Branch</th><th>Vehicle</th><th>Customer</th><th>Technicians</th><th className="num">Std / actual</th><th className="num">Value</th><th>Status</th><th>Promised</th></tr></thead>
            <tbody>{rows.map((j) => (
              <tr key={j.id}><td><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></td><td>{j.branch_code}</td><td><Plate v={j} /> {j.make} {j.model}</td><td>{custName(j)}</td>
                <td className="small">{j.techs ?? <span className="muted">Not assigned</span>}</td>
                <td className="num small"><Hours std={j.std_h} act={j.actual_h} /></td>
                <td className="num">{j.value == null ? "" : Number(j.value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td><Status s={j.status} /> {j.late && <span className="pill red">Late</span>}</td><td className="small">{dt(j.promised_at)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!rows.length && <p className="muted">No jobs{sp.q ? ` match “${sp.q}”` : ""}.</p>}
      <OlderRows rows={rows} base="/jobs" sp={sp} />
    </>
  );
}

/** Standard hours against clocked hours; red when the clocked time is over the standard. */
function Hours({ std, act }: { std: number | string; act: number | string }) {
  const s = Number(std), a = Number(act);
  if (!s && !a) return <span className="muted">-</span>;
  return <span style={a > s && s > 0 ? { color: "var(--late)", fontWeight: 600 } : undefined}>{s.toFixed(1)} h / {a.toFixed(1)} h</span>;
}
