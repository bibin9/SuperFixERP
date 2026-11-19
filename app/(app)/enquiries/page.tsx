import { requireCtx } from "@/lib/session";
import { listEnquiries, enquiryCounts } from "@/lib/services/enquiries";
import { can } from "@/lib/access";
import { Flash, Link, PageHead, Status, custName, dt, Plate } from "@/components/ui";
import { ListToolbar } from "@/components/ListToolbar";

const TABS: [string, string][] = [["", "All"], ["open", "Open"], ["booked", "Booked"], ["quoted", "Quoted"], ["approved", "Approved, job card to create"], ["converted", "Job card created"], ["lost", "Lost"], ["due", "Follow-up due"]];

export default async function Enquiries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, counts] = await Promise.all([listEnquiries(ctx, sp.status ?? "", sp.q ?? ""), enquiryCounts(ctx)]);
  return (
    <>
      <PageHead title="Enquiries" sub="Every job starts here: enquiry, then quotation, then the customer's approval, then the job card.">
        {can(ctx, "customers", "create") && <Link className="btn" href="/enquiries/new">New enquiry</Link>}
      </PageHead>
      <Flash sp={sp} />
      <ListToolbar base="/enquiries" sp={sp} placeholder="Search enquiry no., customer, mobile, plate or service" shown={rows.length} total={counts[sp.status ?? ""] ?? 0}
        chips={TABS.map(([s, label]) => [s, label, counts[s] ?? 0])} />
      {sp.view === "cards" ? (
        <div className="cardgrid">
          {rows.map((e) => (
            <Link key={e.id} href={e.converted_job_id ? `/jobs/${e.converted_job_id}` : `/enquiries/${e.id}`} className="card lcard">
              <div className="lc-top"><b>{e.doc_no}</b><Status s={e.status} /></div>
              {e.vehicle_id && <div className="lc-car"><Plate v={e} /><span className="muted small">{e.make} {e.model}</span></div>}
              <div className="lc-cust">{e.customer_id ? custName(e) : `${e.contact_name ?? ""} ${e.contact_mobile ?? ""}`}</div>
              <div className="muted small lc-sum">{e.service_asked}</div>
              <div className="lc-foot small"><span>{e.branch_code}{e.job_no ? ` · ${e.job_no}` : ""}</span><span style={e.overdue ? { color: "var(--late)" } : {}} className={e.overdue ? "" : "muted"}>Follow up {dt(e.follow_up_at)}</span></div>
            </Link>
          ))}
          {!rows.length && <p className="muted">No enquiries.</p>}
        </div>
      ) : (
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
      )}
    </>
  );
}
