import { requireCtx } from "@/lib/session";
import { bookingDay } from "@/lib/services/bookings";
import { closeBookingAction } from "@/app/actions-front";
import { Flash, Link, PageHead, Status, custName, plate, Plate, label } from "@/components/ui";
import { LoadBars } from "@/components/LoadBars";
import { runType } from "@/components/RunsPanel";

const time = (v: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
const dayName = (s: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" }).format(new Date(`${s}T00:00:00Z`));
const shift = (s: string, n: number) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!ctx.currentBranchId) return (<><PageHead title="Booking calendar" /><div className="flash warn">Choose a branch at the top to see its booking calendar.</div></>);
  const { date, today, load, bookings, week, capacity, runs, canBook } = await bookingDay(ctx, sp.date ?? "");
  const back = `/bookings?date=${date}`;
  const over = [...load.bays, ...load.techs].filter((l) => l.total > l.capacity + 1e-9);
  const open = bookings.filter((b) => b.booking_status === "booked");
  return (
    <>
      <PageHead title="Booking calendar" sub={`${dayName(date)} · bookings and planned job work against each bay's and technician's hours`}>
        <Link className="btn ghost sm" href={`/bookings?date=${shift(date, -1)}`}>‹ Previous day</Link>
        {date !== today && <Link className="btn ghost sm" href="/bookings">Today</Link>}
        <Link className="btn ghost sm" href={`/bookings?date=${shift(date, 1)}`}>Next day ›</Link>
        <form className="shrink" style={{ display: "flex", gap: 6 }}><input type="date" name="date" defaultValue={date} aria-label="Go to day" style={{ width: 160 }} /><button className="btn sm">Go</button></form>
        {canBook && <Link className="btn" href="/enquiries/new">New enquiry to book</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="weekstrip" aria-label="Next seven days">
        {week.map((w) => {
          const pct = capacity ? (Number(w.hours) / capacity) * 100 : 0;
          return (
            <Link key={w.day} href={`/bookings?date=${w.day}`} className={`${w.day === date ? "on" : ""} ${pct > 100 ? "full" : pct >= 85 ? "busy" : ""}`}>
              <span className="small muted">{dayName(w.day)}</span><b>{w.bookings} booked</b><span className="small">{Number(w.hours)} of {capacity} bay hours</span>
            </Link>
          );
        })}
      </div>
      {over.length > 0 && <div className="flash err" data-testid="day-over">Over capacity on this day: {over.map((o) => `${o.name} (${o.total} of ${o.capacity} h)`).join(", ")}.</div>}
      <div className="grid2">
        <div className="card"><h2>Bay load</h2>
          <div className="legend"><span><i style={{ background: "var(--blue)" }} />Booked</span><span><i style={{ background: "var(--violet)" }} />Planned job work</span></div>
          <LoadBars title="Bays" rows={load.bays} /></div>
        <div className="card"><h2>Technician load</h2>
          <div className="legend"><span><i style={{ background: "var(--blue)" }} />Booked</span><span><i style={{ background: "var(--violet)" }} />Planned job work</span></div>
          <LoadBars title="Technicians" rows={load.techs} /></div>
      </div>
      <div className="card"><h2>Bookings on {dayName(date)} ({open.length} open)</h2>
        <table data-testid="bookings-table">
          <thead><tr><th>Time</th><th>Enquiry</th><th>Customer</th><th>Vehicle</th><th>Work</th><th>Bay</th><th>Technician</th><th className="num">Hours</th><th>Status</th>{canBook && <th><span className="vh">Actions</span></th>}</tr></thead>
          <tbody>{bookings.map((b) => (
            <tr key={b.id}>
              <td>{time(b.booked_for)}</td><td><Link href={`/enquiries/${b.id}#booking`}>{b.doc_no}</Link></td>
              <td>{b.customer_type ? custName(b) : `${b.contact_name ?? ""} ${b.contact_mobile ?? ""}`}</td>
              <td>{b.plate_number ? <><Plate v={b} /> {b.make} {b.model}</> : "—"}</td><td className="small">{b.service_asked}</td>
              <td>{b.bay_code ?? "—"}</td><td>{b.technician_name ?? "—"}</td><td className="num">{Number(b.booking_hours)}</td>
              <td><Status s={b.booking_status} />{b.booking_override_reason && <div className="small" title={b.booking_override_reason}><span className="pill red">Overbooked</span></div>}</td>
              {canBook && <td>{b.booking_status === "booked" && (
                <form action={closeBookingAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="$back" value={back} /><input type="hidden" name="outcome" value="no_show" />
                  <button className="btn ghost sm">Did not come</button></form>)}</td>}
            </tr>
          ))}</tbody>
        </table>
        {!bookings.length && <p className="small muted">No bookings on this day. Book from an enquiry: open it and use the Booking card.</p>}
      </div>
      <div className="card"><h2>Runs on this day</h2>
        {runs.length ? <table><tbody>{runs.map((r) => <tr key={r.id}><td>{time(r.scheduled_at)}</td><td>{r.doc_no}</td><td>{runType(r.run_type)}</td><td>{r.driver}</td><td>{r.from_location} → {r.to_location}</td><td><Status s={r.status} /></td></tr>)}</tbody></table>
          : <p className="small muted">None. <Link href="/workshop/runs">All runs</Link></p>}
        <p className="small muted" style={{ marginTop: 6 }}>{label("vehicle_run")}s are scheduled from the enquiry, the job card or <Link href="/workshop/runs">Runs</Link>.</p>
      </div>
    </>
  );
}
