import { requireCtx } from "@/lib/session";
import { getVehicle } from "@/lib/services/customers";
import { can, canSee } from "@/lib/access";
import { Link, Money, PageHead, Status, custName, plate, d } from "@/components/ui";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { vehicle: v, history, deferred } = await getVehicle(ctx, id);
  const prices = canSee(ctx, "selling_price");
  return (
    <>
      <PageHead title={plate(v)} sub={`${v.make} ${v.model} ${v.model_year ?? ""} · VIN ${v.vin ?? "not available"} · owner ${custName(v)}`}>
        {can(ctx, "customers", "create") && <Link className="btn" href={`/enquiries/new?customer=${v.owner_customer_id}&vehicle=${v.id}`}>New enquiry</Link>}
      </PageHead>
      {deferred.length > 0 && <div className="flash warn"><b>Deferred work to offer:</b> {deferred.map((x) => `${x.description} (from ${x.doc_no}, follow up ${d(x.follow_up_date)})`).join("; ")}</div>}
      <div className="card">
        <h2>Service history, all branches</h2>
        <p className="muted small">Other branches&apos; jobs show date, branch, job number, work done and odometer only (BR-04).</p>
        <table>
          <thead><tr><th>Date</th><th>Branch</th><th>Job</th><th>Status</th><th>Odometer</th><th>Work done</th><th className="num">Approved value</th></tr></thead>
          <tbody>{history.map((h) => (
            <tr key={h.job_id}><td>{d(h.doc_date)}</td><td>{h.branch_code}</td><td>{h.can_open ? <Link href={`/jobs/${h.job_id}`}>{h.doc_no}</Link> : h.doc_no}</td>
              <td><Status s={h.status} /></td><td className="num">{h.odometer_in?.toLocaleString()}</td><td>{h.work_done}</td>
              <td className="num">{prices && h.amount !== null ? <Money v={h.amount} /> : <span className="muted">—</span>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
