"use client";
import { useEffect, useState } from "react";
import { LoadBars, type LoadRow } from "./LoadBars";

type Opt = { id: string; code?: string; full_name?: string; capacity_hours?: string; capacity?: string };
type Booking = { status: string | null; when: string | null; bayId: string | null; techId: string | null; hours: string | null; bayCode?: string | null; techName?: string | null; reason?: string | null };

/**
 * Booking on the enquiry: day and time, bay, technician and hours. As the advisor picks the day, the
 * bay and technician load for that day is shown, with this booking added, and a warning before the
 * booking goes over capacity. The server checks again when it is saved.
 */
export function BookingCard({ enquiryId, branchId, back, bays, techs, policy, booking, defaultHours, canEdit, action, closeAction }: {
  enquiryId: string; branchId: string; back: string; bays: Opt[]; techs: Opt[]; policy: string; booking: Booking; defaultHours: string; canEdit: boolean;
  action: (fd: FormData) => Promise<void>; closeAction: (fd: FormData) => Promise<void>;
}) {
  const open = booking.status === "booked";
  const [when, setWhen] = useState(open ? booking.when ?? "" : "");
  const [bay, setBay] = useState(open ? booking.bayId ?? "" : "");
  const [tech, setTech] = useState(open ? booking.techId ?? "" : "");
  const [hours, setHours] = useState(open ? booking.hours ?? defaultHours : defaultHours);
  const [load, setLoad] = useState<{ bays: LoadRow[]; techs: LoadRow[] } | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(!open);
  const day = when.slice(0, 10);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setLoad(null); return; }
    let live = true;
    fetch(`/api/bookings/load?date=${day}&exclude=${enquiryId}&branch=${branchId}`).then(async (r) => {
      const j = await r.json();
      if (!live) return;
      if (!r.ok) { setErr(j.error ?? "Could not load the day."); setLoad(null); } else { setErr(""); setLoad(j); }
    }).catch(() => live && setErr("Could not load the day."));
    return () => { live = false; };
  }, [day, enquiryId, branchId]);

  const hrs = Number(hours) || 0;
  const over = load ? [
    ...load.bays.filter((b) => b.id === bay && b.total + hrs > b.capacity + 1e-9).map((b) => `Bay ${b.name}: ${b.total + hrs} of ${b.capacity} h`),
    ...load.techs.filter((t) => t.id === tech && t.total + hrs > t.capacity + 1e-9).map((t) => `${t.name}: ${t.total + hrs} of ${t.capacity} h`),
  ] : [];

  if (!editing) {
    return (
      <div className="card" id="booking"><h2>Booking</h2>
        <p data-testid="booking-summary"><b>{new Date(booking.when + ":00+04:00").toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b>
          {" "}· {booking.hours} h · bay {booking.bayCode ?? "not set"} · technician {booking.techName ?? "not set"}</p>
        {booking.reason && <p className="small"><span className="pill red">Overbooked</span> {booking.reason}</p>}
        <p className="small"><a href={`/bookings?date=${booking.when?.slice(0, 10)}`}>See the day on the booking calendar</a></p>
        {canEdit && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm shrink" onClick={() => setEditing(true)}>Move booking</button>
            <form action={closeAction} className="shrink"><input type="hidden" name="id" value={enquiryId} /><input type="hidden" name="$back" value={back} /><input type="hidden" name="outcome" value="no_show" />
              <button className="btn ghost sm">Did not come</button></form>
            <form action={closeAction} className="row shrink" style={{ gap: 6 }}><input type="hidden" name="id" value={enquiryId} /><input type="hidden" name="$back" value={back} /><input type="hidden" name="outcome" value="cancelled" />
              <div className="field" style={{ margin: 0 }}><input name="reason" placeholder="Reason for cancelling" aria-label="Reason" /></div><button className="btn ghost sm shrink">Cancel booking</button></form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" id="booking"><h2>{open ? "Move booking" : "Book the visit"}</h2>
      {booking.status && booking.status !== "booked" && <p className="small muted">Last booking: {booking.status === "no_show" ? "did not come" : booking.status.replace("_", " ")}.</p>}
      {!canEdit ? <p className="small muted">Not booked.</p> : (
        <form action={action}>
          <input type="hidden" name="id" value={enquiryId} /><input type="hidden" name="$back" value={back} />
          <div className="row">
            <div className="field"><label htmlFor="bk-when">Booked for</label><input id="bk-when" type="datetime-local" name="booked_for" value={when} onChange={(e) => setWhen(e.target.value)} required /></div>
            <div className="field"><label htmlFor="bk-hours">Hours</label><input id="bk-hours" name="hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="bk-bay">Bay</label><select id="bk-bay" name="bay_id" value={bay} onChange={(e) => setBay(e.target.value)}>
              <option value="">Not set yet</option>{bays.map((b) => <option key={b.id} value={b.id}>{b.code} ({Number(b.capacity_hours)} h a day)</option>)}</select></div>
            <div className="field"><label htmlFor="bk-tech">Technician</label><select id="bk-tech" name="technician_id" value={tech} onChange={(e) => setTech(e.target.value)}>
              <option value="">Not set yet</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.full_name} ({Number(t.capacity)} h a day)</option>)}</select></div>
          </div>
          {err && <p className="field-err">{err}</p>}
          {load && (
            <div data-testid="booking-load">
              <div className="legend"><span><i style={{ background: "var(--blue)" }} />Booked</span><span><i style={{ background: "var(--violet)" }} />Planned job work</span><span><i style={{ background: "var(--amber)" }} />This booking</span></div>
              <div className="grid2" style={{ gap: 12 }}>
                <LoadBars title={`Bays on ${day}`} rows={load.bays} selected={bay} adding={hrs} />
                <LoadBars title="Technicians" rows={load.techs} selected={tech} adding={hrs} />
              </div>
            </div>
          )}
          {over.length > 0 && (
            <div className="overwarn" role="alert" data-testid="overbook-warning">
              <b>Over capacity.</b> {over.join("; ")}.{" "}
              {policy === "block" ? "Overbooking is not allowed here. Pick another bay, technician or time." : "You can still book, with the reason."}
              {policy !== "block" && <div className="field" style={{ marginTop: 8 }}><label htmlFor="bk-reason">Reason for overbooking</label><input id="bk-reason" name="override_reason" required placeholder="For example: fleet priority, short job" /></div>}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn green shrink" disabled={over.length > 0 && policy === "block"}>{open ? "Save the new time" : "Book"}</button>
            {open && <button type="button" className="btn ghost shrink" onClick={() => setEditing(false)}>Keep the current booking</button>}
          </div>
        </form>
      )}
    </div>
  );
}
