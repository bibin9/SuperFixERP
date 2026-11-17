import type { Ctx } from "@/lib/access";
import { can } from "@/lib/access";
import { jobWorkshop, minutesText, lineColour } from "@/lib/services/workshop";
import { jobRelease } from "@/lib/services/billing";
import { creditReleaseAction } from "@/app/actions-billing";
import { assignAction, correctClockAction, partRequestAction, qcAction, deliverAction } from "@/app/actions-ops";
import { SignaturePad } from "@/components/SignaturePad";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Status, dt, label } from "@/components/ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACTIVE = ["approved", "awaiting_parts", "in_progress", "quality_check"];
const KIND: Record<string, string> = { clock_in: "Clock in", pause: "Pause", resume: "Resume", clock_out: "Clock out" };
const local = (v: string | Date) => new Date(new Date(v).getTime() + 4 * 3600_000).toISOString().slice(0, 16);

/** Workshop floor on the job card: who works on what, clocked time, part requests, quality check and delivery. */
export async function WorkshopPanel({ ctx, job, lines, m, back }: { ctx: Ctx; job: Row; lines: Row[]; m: { technicians: Row[]; bays: Row[]; items: Row[] }; back: string }) {
  const w = await jobWorkshop(ctx, job.id);
  const rel = !w.delivery && can(ctx, "jobs", "view", job.branch_id) && (job.status === "ready" || (job.status === "invoiced" && !job.delivered_at)) ? await jobRelease(ctx, job.id) : null;
  const b = job.branch_id;
  const active = ACTIVE.includes(job.status);
  const canAssign = active && (w.canSupervise || can(ctx, "jobs", "edit", b));
  const labour = lines.filter((l) => l.line_type === "labour" || l.line_type === "outside").filter((l) => l.approval_status === "approved");
  const assigned = (lineId: string) => w.assignments.filter((a) => a.job_line_id === lineId);
  return (
    <>
      <div className="card"><h2>Workshop</h2>
        {!labour.length && <p className="muted small">No approved labour lines yet.</p>}
        {labour.length > 0 && <table><thead><tr><th>Work</th><th>Technicians</th><th>Clocked / standard</th>{canAssign && <th>Assign</th>}</tr></thead><tbody>
          {labour.map((l) => {
            const t = w.byLine[l.id];
            const mins = t?.minutes ?? 0;
            const colour = lineColour(mins, l.standard_hours, w.amber);
            const mine = assigned(l.id);
            return (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="small">{mine.length ? mine.map((a) => <div key={a.technician_id}>{a.full_name}{t?.techs[a.technician_id] ? <span className="muted"> · {minutesText(t.techs[a.technician_id].minutes)} {t.techs[a.technician_id].state && <Status s={t.techs[a.technician_id].state} />}</span> : null}</div>) : (l.technician_name ?? <span className="muted">Not assigned</span>)}</td>
                <td><span className={`pill ${colour}`}>{minutesText(mins)}</span> <span className="small muted">/ {l.standard_hours ? `${Number(l.standard_hours)} h` : "—"}</span></td>
                {canAssign && <td>
                  <details><summary className="small">Change</summary>
                    <form action={assignAction}>
                      <input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="$back" value={back} />
                      {m.technicians.map((tech) => <label key={tech.id} className="check"><input type="checkbox" name="technician_id" value={tech.id} defaultChecked={mine.some((a) => a.technician_id === tech.id) || (!mine.length && l.technician_id === tech.id)} /> {tech.full_name}</label>)}
                      <div className="row"><select name="bay_id" defaultValue={job.bay_id ?? ""} aria-label="Bay"><option value="">Bay</option>{m.bays.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select><button className="btn sm shrink">Save</button></div>
                    </form>
                  </details>
                </td>}
              </tr>
            );
          })}
        </tbody></table>}
        {w.events.length > 0 && <details style={{ marginTop: 10 }}><summary className="small">Clock events ({w.events.length})</summary>
          <table><thead><tr><th>Technician</th><th>Event</th><th>Time</th><th>Reason</th>{w.canSupervise && <th>Correct</th>}</tr></thead><tbody>
            {w.events.map((e) => <tr key={e.id}><td>{e.technician_name}</td><td>{KIND[e.kind] ?? e.kind}</td>
              <td className="small">{dt(e.at)}{e.corrected && <div className="muted">corrected from {dt(e.original_at)}: {e.correction_reason}</div>}</td><td className="small">{label(e.reason)}</td>
              {w.canSupervise && <td>{e.technician_id !== ctx.userId ? <form action={correctClockAction} className="row">
                <input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="$back" value={back} />
                <input type="datetime-local" name="at" defaultValue={local(e.at)} required aria-label="Corrected time" /><input name="reason" placeholder="Reason" required /><button className="btn ghost sm shrink">Correct</button></form> : <span className="small muted">Your own</span>}</td>}
            </tr>)}
          </tbody></table></details>}
      </div>

      <div className="grid2">
        <div className="card"><h2>Part requests</h2>
          {w.requests.map((r) => <div key={r.id} className="small">{r.part_no ?? r.description} × {Number(r.qty)} · {r.requested_name} · <Status s={r.status} /> <span className="muted">{dt(r.requested_at)}</span>{r.note && <> · {r.note}</>}</div>)}
          {!w.requests.length && <p className="muted small">None.</p>}
          {active && <form action={partRequestAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="job_id" value={job.id} /><input type="hidden" name="$back" value={back} />
            <div className="row"><select name="item_id" defaultValue="" aria-label="Part"><option value="">Part not in the list</option>{m.items.map((i) => <option key={i.id} value={i.id}>{i.part_no} · {i.description}</option>)}</select>
              <input name="qty" defaultValue="1" inputMode="decimal" style={{ maxWidth: 70 }} aria-label="Quantity" /></div>
            <div className="row" style={{ marginTop: 6 }}><input name="description" placeholder="Describe it if not in the list" /><input name="note" placeholder="Note" /><button className="btn sm shrink">Need part</button></div>
          </form>}
        </div>
        <div className="card"><h2>Quality check</h2>
          {w.qc.map((q) => <div key={q.id} className="small"><Status s={q.result === "pass" ? "passed" : "failed"} /> {q.full_name} <span className="muted">{dt(q.checked_at)}</span>
            {(q.items as Row[]).filter((i) => i.result === "failed").map((i) => <div key={i.code} className="muted">✗ {i.label}: {i.note}</div>)}{q.note && <div className="muted">{q.note}</div>}</div>)}
          {job.status === "quality_check" && w.canSupervise ? (
            <form action={qcAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="job_id" value={job.id} />
              <table><tbody>{w.qcList.map((i) => <tr key={i.code}><td>{i.name_en}</td><td>
                <select name={`qc[${i.code}]`} defaultValue="" required aria-label={i.name_en}><option value="" disabled>Choose</option><option value="done">Done</option><option value="na">N/A</option><option value="failed">Failed</option></select></td>
                <td><input name={`qcnote[${i.code}]`} placeholder="What failed" /></td></tr>)}</tbody></table>
              <div className="row"><input name="note" placeholder="Note" /><button className="btn green sm shrink">Record check</button></div>
            </form>
          ) : job.status === "quality_check" ? <p className="small muted">Waiting for the supervisor's check.</p>
            : !w.qc.length && <p className="small muted">The quality check opens when the job is moved to Quality check. A pass makes the car Ready.</p>}
        </div>
      </div>

      {(job.status === "ready" || (job.status === "invoiced" && !job.delivered_at) || w.delivery) && <div className="card"><h2>Delivery</h2>
        {!w.delivery && rel && (
          <div className={`flash ${rel.basis ? "ok" : "warn"}`} style={{ marginBottom: 10 }}>
            {rel.basis === "paid" && "Nothing is owed. The car can be handed over."}
            {rel.basis === "credit_terms" && <>The customer is on credit terms within the limit{rel.canSeePrices && <> (AED {rel.balance} to be invoiced or open)</>}. The car can be handed over.</>}
            {rel.basis === "credit_release" && <>Released on credit by {rel.release?.full_name}: {rel.release?.reason}.</>}
            {!rel.basis && <>
              <b>{rel.canSeePrices ? `AED ${rel.balance} is still owed.` : "Money is still owed on this job."}</b> Invoice the job and take payment{rel.creditTerms ? " (the customer's credit limit is used up)" : ""}, or a manager can release the car on credit.
              {rel.canRelease && (
                <form action={creditReleaseAction} className="row" style={{ marginTop: 8 }}>
                  <input type="hidden" name="job_id" value={job.id} />
                  <input name="reason" placeholder="Why the car may leave unpaid" required aria-label="Release reason" />
                  <ConfirmButton className="btn amber sm shrink" message="Release this car with money owing? This is recorded under your name.">Release on credit</ConfirmButton>
                </form>)}
            </>}
          </div>)}
        {w.delivery ? <div className="small">
          Delivered {dt(w.delivery.delivered_at)} by {w.delivery.full_name} to <b>{w.delivery.received_by_name}</b> · odometer out {Number(w.delivery.odometer_out).toLocaleString()} km · old parts {w.delivery.old_parts}
          {w.delivery.release_basis && <div>Released because: {w.delivery.release_basis === "paid" ? "paid in full" : w.delivery.release_basis === "credit_terms" ? "customer on credit terms" : "released on credit by a manager"}{Number(w.delivery.balance_at_release) > 0 && can(ctx, "invoices", "view", b) && <> · AED {Number(w.delivery.balance_at_release).toFixed(2)} owed at hand-over</>}</div>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {w.delivery.signature && <div><img src={w.delivery.signature} alt="Customer signature" style={{ maxWidth: 240, border: "1px solid #ddd", marginTop: 6 }} /></div>}
        </div> : can(ctx, "jobs", "edit", b) && rel?.basis ? (
          <form action={deliverAction}>
            <input type="hidden" name="job_id" value={job.id} />
            <div className="grid2">
              <div>{w.deliveryList.map((i) => <label key={i.code} className="check"><input type="checkbox" name={`chk_${i.code}`} required /> {i.name_en}</label>)}
                <div className="field"><label>Old parts</label><select name="old_parts" required defaultValue=""><option value="" disabled>Choose</option><option value="returned">Returned to the customer</option><option value="disposed">Disposed</option><option value="none">No old parts</option></select></div>
                <div className="field"><label>Odometer out (km)</label><input name="odometer_out" inputMode="numeric" required defaultValue={job.odometer_in ?? ""} /></div>
                <div className="field"><label>Received by</label><input name="received_by_name" required /></div></div>
              <div><label className="small">Customer signature</label><SignaturePad /></div>
            </div>
            <ConfirmButton className="btn green" message="Hand the car over to the customer now?">Deliver the car</ConfirmButton>
          </form>
        ) : <p className="small muted">{rel?.basis ? "Ready for delivery." : "Delivery opens once the job is paid or released."}</p>}
      </div>}
    </>
  );
}
