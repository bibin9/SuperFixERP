import { requireCtx } from "@/lib/session";
import { listEnquiries } from "@/lib/services/jobs";
import { listCustomers } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { createEnquiryAction, lostEnquiryAction } from "@/app/actions";
import { Flash, Link, PageHead, Status, custName, dt } from "@/components/ui";

export default async function Enquiries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listEnquiries(ctx, sp.status ?? "");
  const m = await masters(ctx);
  const customers = await listCustomers(ctx);
  const src = m.lookups.filter((l) => l.list === "enquiry_source");
  const lost = m.lookups.filter((l) => l.list === "lost_reason");
  return (
    <>
      <PageHead title="Enquiries" sub="Walk-in, phone and WhatsApp enquiries with follow-up (CV-10)." />
      <Flash sp={sp} />
      {can(ctx, "customers", "create") && (
        <div className="card"><h2>New enquiry</h2>
          <form action={createEnquiryAction}>
            <div className="row">
              <div className="field"><label>Existing customer</label><select name="customer_id"><option value="">New / unknown</option>{customers.map((c) => <option key={c.id} value={c.id}>{custName(c)} · {c.mobile}</option>)}</select></div>
              <div className="field"><label>Or contact name</label><input name="contact_name" /></div>
              <div className="field"><label>Contact mobile</label><input name="contact_mobile" /></div>
            </div>
            <div className="row">
              <div className="field"><label>Service asked about</label><input name="service_asked" required /></div>
              <div className="field"><label>Source</label><select name="source">{src.map((s) => <option key={s.code} value={s.code}>{s.name_en}</option>)}</select></div>
              <div className="field"><label>Follow up at</label><input type="datetime-local" name="follow_up_at" /></div>
              <div className="shrink"><button className="btn">Save enquiry</button></div>
            </div>
          </form>
        </div>
      )}
      <div className="tabs">{["", "open", "converted", "lost"].map((s) => <Link key={s} className={(sp.status ?? "") === s ? "on" : ""} href={`/enquiries${s ? `?status=${s}` : ""}`}>{s || "All"}</Link>)}</div>
      <div className="card">
        <table>
          <thead><tr><th>No.</th><th>Branch</th><th>Customer</th><th>Service asked</th><th>Source</th><th>Follow up</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}>
              <td>{e.doc_no}</td><td>{e.branch_code}</td><td>{e.customer_id ? <Link href={`/customers/${e.customer_id}`}>{custName(e)}</Link> : `${e.contact_name ?? ""} ${e.contact_mobile ?? ""}`}</td>
              <td>{e.service_asked}</td><td>{e.source}</td><td className={e.overdue ? "" : "muted"} style={e.overdue ? { color: "var(--late)" } : {}}>{dt(e.follow_up_at)}</td><td><Status s={e.status} /></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {e.status === "open" && e.customer_id && <Link className="btn sm" href={`/jobs/new?customer=${e.customer_id}&enquiry=${e.id}${e.vehicle_id ? `&vehicle=${e.vehicle_id}` : ""}`}>Convert</Link>}{" "}
                {e.status === "open" && (
                  <form action={lostEnquiryAction} className="inline"><input type="hidden" name="id" value={e.id} />
                    <select name="reason" style={{ width: 130, minHeight: 32 }}>{lost.map((l) => <option key={l.code} value={l.name_en}>{l.name_en}</option>)}</select>{" "}
                    <button className="btn ghost sm">Lost</button></form>
                )}
                {e.converted_job_id && <Link href={`/jobs/${e.converted_job_id}`}>job</Link>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
