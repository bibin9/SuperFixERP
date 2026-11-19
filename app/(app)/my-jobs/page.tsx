import { requireCtx } from "@/lib/session";
import { myJobs, minutesText } from "@/lib/services/workshop";
import { masters } from "@/lib/services/masters";
import { clockAction } from "@/app/actions-ops";
import { Flash, PageHead, Link, Plate, label } from "@/components/ui";
import { setPinAction, tabletLockAction } from "@/app/actions";
import { IdleLock } from "@/components/IdleLock";

/** Technician phone screen (WS-04, UX-02): big buttons, one job at a time. */
export default async function MyJobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const jobs = await myJobs(ctx);
  const m = await masters(ctx);
  const reasons = m.lookups.filter((l) => l.list === "pause_reason");
  const askSwitch = sp.switch && sp.err && /Switch to this job/.test(sp.err) ? sp.switch : null;
  return (
    <>
      <PageHead title="My jobs" sub={`${jobs.length} line${jobs.length === 1 ? "" : "s"} assigned to you`}>
        {ctx.pinOnly && <IdleLock minutes={2} action={tabletLockAction} />}
      </PageHead>
      <Flash sp={askSwitch ? { ok: sp.ok } : sp} />
      {!jobs.length && <p className="muted">No work is assigned to you right now.</p>}
      {jobs.map((j) => (
        <div key={j.line_id} className="techjob">
          <div className="row"><Plate v={j} /><span className={`pill ${j.colour}`}>{minutesText(j.minutes)}{j.standard_hours ? ` / ${Number(j.standard_hours)} h` : ""}</span></div>
          <div className="small">{j.make} {j.model} · <Link href={`/jobs/${j.job_id}`}>{j.doc_no}</Link>{j.bay_code ? ` · bay ${j.bay_code}` : ""}</div>
          <div style={{ marginTop: 4 }}>{j.description}</div>
          <div className="small muted">{j.state === "working" ? "Working" : j.state === "paused" ? `Paused: ${label(j.pauseReason)}` : j.state === "done" ? "Clocked out" : "Not started"}</div>
          {j.qcFailed.length > 0 && <div className="small" style={{ color: "var(--late)" }}>Quality check failed: {j.qcFailed.map((q: { label: string; note?: string }) => `${q.label}${q.note ? ` (${q.note})` : ""}`).join(", ")}</div>}
          {askSwitch === j.line_id && <div className="flash err">{sp.err}
            <form action={clockAction}><input type="hidden" name="line_id" value={j.line_id} /><input type="hidden" name="kind" value={j.state === "paused" ? "resume" : "clock_in"} /><input type="hidden" name="confirm" value="1" />
              <button className="btn big">Yes, switch to this job</button></form></div>}
          {(j.state === "not_started" || j.state === "done") && <form action={clockAction}><input type="hidden" name="line_id" value={j.line_id} /><input type="hidden" name="kind" value="clock_in" /><input type="hidden" name="$back" value={`/my-jobs?switch=${j.line_id}`} /><button className="btn green big">Clock in</button></form>}
          {j.state === "paused" && <form action={clockAction}><input type="hidden" name="line_id" value={j.line_id} /><input type="hidden" name="kind" value="resume" /><input type="hidden" name="$back" value={`/my-jobs?switch=${j.line_id}`} /><button className="btn green big">Resume</button></form>}
          {j.state === "working" && <form action={clockAction}><input type="hidden" name="line_id" value={j.line_id} /><input type="hidden" name="kind" value="pause" />
            <select name="reason" required defaultValue="" aria-label="Pause reason" style={{ marginTop: 8, minHeight: 48 }}><option value="" disabled>Pause reason</option>{reasons.map((r) => <option key={r.code} value={r.code}>{r.name_en}</option>)}</select>
            <button className="btn amber big">Pause</button></form>}
          {(j.state === "working" || j.state === "paused") && <form action={clockAction}><input type="hidden" name="line_id" value={j.line_id} /><input type="hidden" name="kind" value="clock_out" /><button className="btn ghost big">Clock out (work finished)</button></form>}
          <Link className="btn ghost big" href={`/jobs/${j.job_id}#parts`} style={{ textAlign: "center", lineHeight: "54px", padding: 0 }}>Need part</Link>
        </div>
      ))}
      {!ctx.pinOnly && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary><b>Set my tablet PIN</b> <span className="muted small">for the shared bay tablet</span></summary>
          <form action={setPinAction} className="row" style={{ alignItems: "flex-end", marginTop: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor="pin">New PIN (4 digits)</label><input id="pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="new-password" /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="pin2">Type it again</label><input id="pin2" name="pin2" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="new-password" /></div>
            <button className="btn shrink">Save PIN</button>
          </form>
          <p className="small muted">Do not use an easy PIN like 1234 or 0000, and do not tell anyone. Five wrong tries lock the account for 15 minutes.</p>
        </details>
      )}
    </>
  );
}
