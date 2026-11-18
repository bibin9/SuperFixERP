import { requireCtx } from "@/lib/session";
import { listEnquiries, enquiryCounts } from "@/lib/services/enquiries";
import { can } from "@/lib/access";
import { Flash, Link, PageHead, Status, custName, dt, Plate } from "@/components/ui";

const TABS: [string, string][] = [["", "All"], ["open", "Open"], ["booked", "Booked"], ["quoted", "Quoted"], ["approved", "Approved, job card to create"], ["converted", "Job card created"], ["lost", "Lost"]];

export default async function Enquiries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, counts] = await Promise.all([listEnquiries(ctx, sp.status ?? ""), enquiryCounts(ctx)]);
  return (
    <>
      <PageHead title="Enquiries" sub="Every job starts here: enquiry, then quotation, then the customer's approval, then the job card.">
        {can(ctx, "customers", "create") && <Link className="btn" href="/enquiries/new">New enquiry</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="tabs chips">{TABS.map(([s, label]) => <Link key={s} className={(sp.status ?? "") === s ? "on" : ""} href={`/enquiries${s ? `?status=${s}` : ""}`}>{label} <span className="cnt">{counts[s] ?? 0}</span></Link>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>No.</th><th>Branch</th><th>Customer</th><th>Vehicle</th><th>Service asked</th><th>Follow up</th><th>Status</th><th>Job card</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}>
              <td><Link href={`/enquiries/${e.id}`}>{e.doc_no}</Link></td><td>{e.branch_code}</td>
              <td>{e.customer_id ? custName(e) : `${e.contact_name ?? ""} ${e.contact_mobile ?? ""}`}</td>
              <td className="small">{e.vehicle_id ? <><Plate v={e} /> {e.make} {e.model}</> : <span className="muted">—</span>}</td>
              <td>{e.service_asked}</td>
              <td className={e.overdue ? "" : "muted"} style={e.overdue ? { color: "var(--late)" } : {}}>{dt(e.follow_up_at)}</td>
              <td><Status s={e.status} /></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {e.converted_job_id ? <Link href={`/jobs/${e.converted_job_id}`}>{e.job_no}</Link>
                  : <Link className="btn sm ghost" href={`/enquiries/${e.id}`}>{e.status === "approved" ? "Create job card" : "Open"}</Link>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="muted">No enquiries.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
