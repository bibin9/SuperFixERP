import { addRunAction, runStepAction } from "@/app/actions-front";
import { Link, Money, Status, dt, label } from "./ui";

type Run = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Driver = { id: string; full_name: string };

const TYPE: Record<string, string> = { pickup: "Pickup", drop_off: "Drop-off", recovery: "Recovery", towing: "Towing" };
export const runType = (t: string) => TYPE[t] ?? label(t);

/** Step buttons for one run: driver left, completed (with km), cancel (with reason). */
export function RunSteps({ r, back }: { r: Run; back: string }) {
  if (!["scheduled", "on_the_way"].includes(r.status)) return r.status === "cancelled" ? <span className="small muted">{r.cancel_reason}</span> : null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {r.status === "scheduled" && (
        <form action={runStepAction} className="shrink"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="start" /><input type="hidden" name="$back" value={back} />
          <button className="btn sm">Driver left</button></form>
      )}
      <form action={runStepAction} className="row shrink" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="complete" /><input type="hidden" name="$back" value={back} />
        <input name="distance_km" placeholder="km" inputMode="decimal" aria-label={`Distance for ${r.doc_no}`} style={{ width: 70 }} /><button className="btn green sm shrink">Completed</button></form>
      <form action={runStepAction} className="row shrink" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="cancel" /><input type="hidden" name="$back" value={back} />
        <input name="reason" placeholder="Why cancelled" aria-label={`Cancel reason for ${r.doc_no}`} style={{ width: 130 }} /><button className="btn ghost sm shrink">Cancel</button></form>
    </div>
  );
}

/** The add-a-run form. Linked to an enquiry or a job card when given. */
export function RunForm({ back, drivers, enquiryId, jobId, defaults, canCharge, chargeTarget }: {
  back: string; drivers: Driver[]; enquiryId?: string; jobId?: string; defaults?: { from?: string; to?: string; type?: string };
  canCharge: boolean; chargeTarget?: "quotation" | "job" | null;
}) {
  return (
    <form action={addRunAction} data-testid="run-form">
      <input type="hidden" name="$back" value={back} />
      {enquiryId && <input type="hidden" name="enquiry_id" value={enquiryId} />}
      {jobId && <input type="hidden" name="job_card_id" value={jobId} />}
      <div className="row">
        <div className="field"><label htmlFor="run-type">Run type</label><select id="run-type" name="run_type" defaultValue={defaults?.type ?? "pickup"}>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="run-when">When</label><input id="run-when" type="datetime-local" name="scheduled_at" required /></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="run-from">From</label><input id="run-from" name="from_location" defaultValue={defaults?.from ?? ""} placeholder="Customer's address, breakdown spot" required /></div>
        <div className="field"><label htmlFor="run-to">To</label><input id="run-to" name="to_location" defaultValue={defaults?.to ?? ""} placeholder="Workshop, customer's home" required /></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="run-driver">Driver</label><select id="run-driver" name="driver_user_id" defaultValue=""><option value="">Outside driver (type the name)</option>
          {drivers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>
        <div className="field"><label htmlFor="run-dname">Outside driver&apos;s name</label><input id="run-dname" name="driver_name" placeholder="Only if not staff" /></div>
        <div className="field"><label htmlFor="run-veh">Recovery truck / vehicle</label><input id="run-veh" name="recovery_vehicle" placeholder="Plate or name" /></div>
      </div>
      <div className="row">
        {canCharge && <div className="field"><label htmlFor="run-charge">Charge (AED)</label><input id="run-charge" name="charge" inputMode="decimal" placeholder="0 if free" /></div>}
        <div className="field"><label htmlFor="run-notes">Notes</label><input id="run-notes" name="notes" /></div>
      </div>
      {canCharge && chargeTarget && (
        <label className="small" style={{ display: "block", marginBottom: 8 }}><input type="checkbox" name="add_charge" value="1" defaultChecked />{" "}
          Add the charge {chargeTarget === "quotation" ? "to the work lines for the quotation" : "to the job card as extra work"} (the customer approves it)</label>
      )}
      <button className="btn">Schedule run</button>
    </form>
  );
}

/** Runs table, used on the runs page and on enquiries and job cards. */
export function RunsTable({ rows, back, canEdit, prices, showRef = true }: { rows: Run[]; back: string; canEdit: boolean; prices: boolean; showRef?: boolean }) {
  if (!rows.length) return <p className="small muted">No runs yet.</p>;
  return (
    <table data-testid="runs-table">
      <thead><tr><th>Run</th><th>Type</th><th>When</th><th>Driver</th><th>From</th><th>To</th>{showRef && <th>For</th>}<th>Status</th><th className="num">km</th>{prices && <th className="num">Charge</th>}{canEdit && <th><span className="vh">Actions</span></th>}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}>
          <td>{r.doc_no}</td><td>{runType(r.run_type)}</td><td className="small">{dt(r.scheduled_at)}</td>
          <td>{r.driver}{r.outside_driver && <span className="small muted"> (outside)</span>}{r.recovery_vehicle && <div className="small muted">{r.recovery_vehicle}</div>}</td>
          <td>{r.from_location}</td><td>{r.to_location}</td>
          {showRef && <td className="small">{r.job_no ? <Link href={`/jobs/${r.job_card_id}`}>{r.job_no}</Link> : r.enquiry_no ? <Link href={`/enquiries/${r.enquiry_id}`}>{r.enquiry_no}</Link> : "—"}
            {r.plate_number && <div className="muted">{`${r.registered_in ?? ""} ${r.plate_code ?? ""} ${r.plate_number}`}</div>}</td>}
          <td><Status s={r.status} /></td>
          <td className="num">{r.distance_km ?? ""}</td>
          {prices && <td className="num">{r.charge !== null ? <Money v={r.charge} /> : ""}</td>}
          {canEdit && <td><RunSteps r={r} back={back} /></td>}
        </tr>
      ))}</tbody>
    </table>
  );
}
