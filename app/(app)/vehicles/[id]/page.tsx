import { requireCtx } from "@/lib/session";
import { vehicleView } from "@/lib/services/vehicle-view";
import { serviceIntervalAction } from "@/app/actions-front";
import { can } from "@/lib/access";
import { Flash, Link, Money, PageHead, Status, custName, plate, d, dt, label } from "@/components/ui";
import { runType } from "@/components/RunsPanel";

const STATE_PILL: Record<string, string> = { "Working": "violet", "Paused": "amber", "Done": "green", "Waiting for approval": "amber", "Not started": "grey", "Deferred": "grey", "Approved": "" };

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { vehicle: v, history, deferred, openJobs, enquiries, runs, balance, prices, service } = await vehicleView(ctx, id);
  const due = service.due;
  const mobile = String(v.mobile ?? "").replace(/[^0-9]/g, "");
  const canEnq = can(ctx, "customers", "create");
  const canEdit = can(ctx, "customers", "edit");
  return (
    <>
      <PageHead title={plate(v)} sub={`${v.make} ${v.model} ${v.model_year ?? ""}${v.colour ? ` · ${v.colour}` : ""} · VIN ${v.vin ?? "not available"}`}>
        {canEnq && <Link className="btn" href={`/enquiries/new?customer=${v.customer_id}&vehicle=${v.id}`}>New enquiry</Link>}
      </PageHead>
      <Flash sp={sp} />

      <div className="card custhead" data-testid="vehicle-customer">
        <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="small muted">Owner</div>
            <b style={{ fontSize: 17 }}><Link href={`/customers/${v.customer_id}`}>{custName(v)}</Link></b>
            <div className="small">{v.mobile}{v.email ? ` · ${v.email}` : ""}{v.price_level ? ` · ${label(v.price_level)} prices` : ""}</div>
          </div>
          <div className="shrink" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {mobile && <a className="btn ghost sm" href={`tel:+${mobile}`}>Call</a>}
            {mobile && v.whatsapp && <a className="btn wa sm" href={`https://wa.me/${mobile}`} target="_blank" rel="noreferrer">WhatsApp chat</a>}
            {canEnq && <Link className="btn ghost sm" href={`/enquiries/new?customer=${v.customer_id}&vehicle=${v.id}`}>Book a visit</Link>}
            <Link className="btn ghost sm" href={`/customers/${v.customer_id}`}>Customer file</Link>
            {balance && <Link className="btn ghost sm" href={`/customers/${v.customer_id}`}>{balance.open ? <>Owes AED <Money v={balance.due} /> on {balance.open} invoice{balance.open === 1 ? "" : "s"}</> : "No unpaid invoices"}</Link>}
          </div>
        </div>
        <div className="kv small" style={{ marginTop: 10 }}>
          <span>Odometer <b>{v.odometer ? `${Number(v.odometer).toLocaleString()} km` : "—"}</b></span>
          <span>Fuel <b>{v.fuel ? label(v.fuel) : "—"}</b></span>
          <span>Mulkiya expires <b>{d(v.mulkiya_expiry) || "—"}</b></span>
          <span>Next service{" "}
            {due ? <b className={due.overdue ? "late" : due.soon ? "amberText" : ""} data-testid="next-service">
              {d(due.dueDate)}{due.dueKm ? ` or ${due.dueKm.toLocaleString()} km` : ""}{due.overdue ? " · overdue" : due.soon ? " · due soon" : ""}</b>
              : <b data-testid="next-service">no service on record yet</b>}
          </span>
        </div>
      </div>

      {deferred.length > 0 && <div className="flash warn"><b>Deferred work to offer:</b> {deferred.map((x) => `${x.description} (from ${x.doc_no}, follow up ${d(x.follow_up_date)})`).join("; ")}</div>}

      <div className="card" data-testid="open-work"><h2>Open work</h2>
        {!openJobs.length && !enquiries.length && <p className="small muted">Nothing open for this vehicle.</p>}
        {enquiries.map((e) => (
          <p key={e.id} className="small"><Link href={`/enquiries/${e.id}`}>{e.doc_no}</Link> · {e.branch_code} · <Status s={e.status} /> · {e.service_asked}
            {e.booking_status === "booked" && <> · booked for <b>{dt(e.booked_for)}</b></>}</p>
        ))}
        {openJobs.map((j) => (
          <div key={j.id} style={{ marginTop: 10 }}>
            <p><b><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></b> · {j.branch_code} · {label(j.job_type)} · <Status s={j.status} />
              {j.bay_code && <> · bay {j.bay_code}</>}{j.advisor && <> · advisor {j.advisor}</>}{j.promised_at && <> · promised <b>{dt(j.promised_at)}</b></>}</p>
            <table>
              <thead><tr><th>#</th><th>Work</th><th>Technician</th><th className="num">Est. hours</th><th>Status</th></tr></thead>
              <tbody>{j.lines.map((l: Record<string, any>) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <tr key={l.id}><td>{l.line_no}</td><td>{l.description}{l.extra_work && <span className="small muted"> (extra work)</span>}</td>
                  <td>{l.line_type === "labour" ? l.technician ?? <span className="muted">Not assigned</span> : <span className="muted">{label(l.line_type)}</span>}</td>
                  <td className="num">{l.est_hours ?? ""}</td><td><span className={`pill ${STATE_PILL[l.line_status] ?? ""}`}>{l.line_status}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card"><h2>Next service</h2>
          {due ? <p>Due on <b>{d(due.dueDate)}</b>{due.dueKm ? <> or at <b>{due.dueKm.toLocaleString()} km</b></> : null}, whichever comes first.
            {" "}{due.overdue ? <span className="pill red">Overdue</span> : due.soon ? <span className="pill amber">Due soon</span> : <span className="pill green">{due.daysLeft} days left</span>}</p>
            : <p className="small muted">No completed service job yet, so there is nothing to count from.</p>}
          {service.lastService && <p className="small">Last service {d(service.lastService.date)}{service.lastService.km ? ` at ${Number(service.lastService.km).toLocaleString()} km` : ""}.</p>}
          <p className="small muted">Every {service.intervalKm.toLocaleString()} km or {service.intervalMonths} months{service.ownInterval ? " (set for this vehicle)" : " (default from Settings)"}.</p>
          {canEdit && (
            <form action={serviceIntervalAction} className="row" style={{ alignItems: "end" }}><input type="hidden" name="id" value={v.id} />
              <div className="field"><label htmlFor="si-km">Every (km)</label><input id="si-km" name="service_interval_km" inputMode="numeric" defaultValue={v.service_interval_km ?? ""} placeholder={String(service.intervalKm)} /></div>
              <div className="field"><label htmlFor="si-m">Every (months)</label><input id="si-m" name="service_interval_months" inputMode="numeric" defaultValue={v.service_interval_months ?? ""} placeholder={String(service.intervalMonths)} /></div>
              <div className="shrink field"><button className="btn sm">Save</button></div>
            </form>
          )}
        </div>
        <div className="card"><h2>Pickup, drop-off and recovery</h2>
          {runs.length ? <table><tbody>{runs.map((r) => <tr key={r.id}><td className="small">{dt(r.scheduled_at)}</td><td>{runType(r.run_type)}</td><td>{r.driver}</td><td className="small">{r.from_location} → {r.to_location}</td><td><Status s={r.status} /></td></tr>)}</tbody></table>
            : <p className="small muted">None.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Past services, all branches</h2>
        <p className="muted small">Other branches&apos; jobs show date, branch, job number, work done and odometer only.</p>
        <table>
          <thead><tr><th>Date</th><th>Branch</th><th>Job</th><th>Status</th><th>Odometer</th><th>Work done</th>{prices && <th className="num">Approved value</th>}</tr></thead>
          <tbody>{history.map((h) => (
            <tr key={h.job_id}><td>{d(h.doc_date)}</td><td>{h.branch_code}</td><td>{h.can_open ? <Link href={`/jobs/${h.job_id}`}>{h.doc_no}</Link> : h.doc_no}</td>
              <td><Status s={h.status} /></td><td className="num">{h.odometer_in?.toLocaleString()}</td><td>{h.work_done}</td>
              {prices && <td className="num">{h.amount !== null ? <Money v={h.amount} /> : <span className="muted">—</span>}</td>}</tr>
          ))}</tbody>
        </table>
        {!history.length && <p className="small muted">No jobs yet.</p>}
      </div>
    </>
  );
}
