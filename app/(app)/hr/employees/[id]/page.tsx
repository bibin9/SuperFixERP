/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireCtx } from "@/lib/session";
import { getEmployee, hrLookups } from "@/lib/services/hr";
import { employeeLeave } from "@/lib/services/hr-time";
import { salaryOf } from "@/lib/services/payroll";
import { RECORD_KINDS } from "@/lib/services/hr-records";
import { can } from "@/lib/access";
import {
  updateEmployeeAction, saveRecordAction, closeRecordAction, tickChecklistAction, startLeavingAction, transferAction, openingSalaryAction, adjustLeaveAction, requestLeaveAction,
} from "@/app/actions-hr";
import { Flash, Link, Money, PageHead, Status, d, dt } from "@/components/ui";
import { EmployeeForm } from "@/components/EmployeeForm";
import { ConfirmButton } from "@/components/ConfirmButton";

const TABS: [string, string][] = [["details", "Details"], ["records", "Documents and records"], ["checklist", "Checklists"], ["salary", "Salary"], ["leave", "Leave"], ["transfers", "Transfers"], ["history", "History"]];

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab : "details";
  const x = await getEmployee(ctx, id);
  const e = x.employee as any;
  const base = `/hr/employees/${id}`;
  const here = `${base}?tab=${tab}`;
  const tabs = TABS.filter(([k]) => k !== "salary" || x.salaryVisible);
  const lists = x.lists as { list: string; code: string; name_en: string }[];
  return (
    <>
      <PageHead title={`${e.emp_no} · ${e.first_name} ${e.last_name}`} sub={`${e.designation ?? "No designation"} · ${e.department ?? "No department"} · ${e.branch_code} · joined ${d(e.joining_date)}${e.line_manager ? ` · reports to ${e.line_manager}` : ""}`}>
        <Status s={e.status} /><Link className="btn ghost sm" href="/hr/employees">Employees</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} className={tab === k ? "on" : ""} href={`${base}?tab=${k}`}>{l}</Link>)}</div>

      {tab === "details" && (x.canEdit ? (
        <form className="card" action={updateEmployeeAction}>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={e.version} />
          <EmployeeForm e={e} l={await hrLookups(ctx)} custom={x.custom} showBank={x.salaryVisible} />
          <button className="btn">Save</button>
        </form>
      ) : (
        <div className="card">
          <table><tbody>
            {[["Nationality", e.nationality_name], ["Mobile", e.mobile], ["Email", e.email], ["Contract", `${e.contract_type}${e.contract_end ? ` until ${d(e.contract_end)}` : ""}`], ["Probation ends", d(e.probation_end)],
              ["Shift", e.shift_name], ["MOHRE person code", e.mohre_person_code], ["Paid through", e.wps_agent], ["Sign-in user", e.username]].map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{v || "—"}</td></tr>)}
            {x.customFields.map((f) => <tr key={f.code}><td className="muted">{f.label}</td><td>{String(x.custom[f.code] ?? "—")}</td></tr>)}
          </tbody></table>
          {x.team.length > 0 && <p className="small">Team: {x.team.map((t: any) => `${t.emp_no} ${t.first_name} ${t.last_name}`).join(", ")}</p>}
        </div>
      ))}

      {tab === "records" && RECORD_KINDS.map((k) => {
        const rows = x.records.filter((r: any) => r.kind === k.kind);
        const canAdd = can(ctx, "hr", "create", e.branch_id) || (k.kind === "review" && can(ctx, "hr", "approve", e.branch_id));
        return (
          <div className="card" key={k.kind} id={k.kind}><h2>{k.title}</h2>
            {rows.length ? <table><thead><tr><th>Record</th><th>Expires</th><th>Status</th><th>Added</th><th></th></tr></thead><tbody>{rows.map((r: any) => (
              <tr key={r.id}><td>{k.summary(r.data)}{r.amount && Number(r.amount) > 0 && x.salaryVisible ? <> · <Money v={r.amount} /></> : null}{r.data.details && <div className="small muted">{r.data.details}</div>}{r.data.closed_note && <div className="small muted">Closed: {r.data.closed_note}</div>}{r.attachment_id && <> · <a className="small" href={`/api/attachments/${r.attachment_id}`}>file</a></>}</td>
                <td>{d(r.expiry_date)}</td><td><Status s={r.status} /></td><td className="small muted">{r.created_by_name} {dt(r.created_at)}</td>
                <td>{r.status === "active" && can(ctx, "hr", "edit", e.branch_id) && <form action={closeRecordAction} className="row"><input type="hidden" name="record_id" value={r.id} /><input type="hidden" name="$back" value={`${here}#${k.kind}`} /><input name="note" placeholder="Note" style={{ maxWidth: 140 }} /><button className="btn ghost sm shrink">{k.closeLabel ?? "Close"}</button></form>}</td></tr>))}</tbody></table>
              : <p className="muted small">None recorded.</p>}
            {canAdd && e.status === "active" && (
              <details><summary className="btn ghost sm">Add</summary>
                <form action={saveRecordAction} encType="multipart/form-data">
                  <input type="hidden" name="employee_id" value={id} /><input type="hidden" name="kind" value={k.kind} /><input type="hidden" name="$back" value={`${here}#${k.kind}`} />
                  <div className="row">{k.fields.map((f) => (
                    <div className="field" key={f.name} style={f.type === "textarea" ? { flexBasis: "100%" } : {}}><label>{f.label}{f.required ? "" : " (optional)"}</label>
                      {f.options ? <select name={f.name} required={f.required} defaultValue=""><option value="">—</option>{f.options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
                        : f.lookup ? <select name={f.name} required={f.required} defaultValue=""><option value="">—</option>{lists.filter((l) => l.list === f.lookup).map((l) => <option key={l.code} value={l.code}>{l.name_en}</option>)}</select>
                        : f.type === "textarea" ? <textarea name={f.name} required={f.required} />
                        : <input name={f.name} required={f.required} type={f.type === "date" ? "date" : f.type === "month" ? "month" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} />}
                    </div>))}
                    <div className="field"><label>File (optional)</label><input type="file" name="file" accept="image/*,application/pdf" /></div>
                  </div>
                  <button className="btn sm">Save</button>
                </form>
              </details>
            )}
          </div>
        );
      })}

      {tab === "checklist" && (
        <div className="card"><h2>Joining and leaving checklists</h2>
          {["joining", "leaving"].map((kind) => {
            const items = x.checklist.filter((c: any) => c.kind === kind);
            if (!items.length) return null;
            return (<div key={kind}><h3>{kind === "joining" ? "Joining" : "Leaving"} ({items.filter((i: any) => i.done).length} of {items.length} done)</h3>
              <table><tbody>{items.map((i: any) => (
                <tr key={i.id}><td>{i.done ? "✓" : "○"} {i.item}</td><td className="small muted">{i.done ? `${i.done_by_name ?? ""} ${dt(i.done_at)}` : ""}{i.note ? ` · ${i.note}` : ""}</td>
                  <td>{can(ctx, "hr", "edit", e.branch_id) && <form action={tickChecklistAction} className="row"><input type="hidden" name="item_id" value={i.id} /><input type="hidden" name="$back" value={here} /><input type="hidden" name="done" value={i.done ? "false" : "true"} />
                    {!i.done && <input name="note" placeholder="Note" style={{ maxWidth: 160 }} />}<button className="btn ghost sm shrink">{i.done ? "Undo" : "Done"}</button></form>}</td></tr>))}</tbody></table></div>);
          })}
          {e.status === "active" && can(ctx, "hr", "edit", e.branch_id) && !x.checklist.some((c: any) => c.kind === "leaving") && (
            <form action={startLeavingAction}><input type="hidden" name="employee_id" value={id} /><ConfirmButton className="btn ghost sm" message="Start the leaving checklist for this employee? Company assets still with them are added to it.">Start leaving checklist</ConfirmButton></form>)}
          {e.status === "active" && x.salaryVisible && x.checklist.some((c: any) => c.kind === "leaving") && <p><Link className="btn sm" href={`/payroll/settlements/new?employee_id=${id}`}>Prepare final settlement</Link></p>}
        </div>
      )}

      {tab === "salary" && x.salaryVisible && await (async () => {
        const s = await salaryOf(ctx, id);
        return (
          <div className="grid2">
            <div className="card"><h2>Salary today</h2>
              {Object.keys(s.now).length ? <table><tbody>{s.comps.filter((c) => s.now[c.code]).map((c) => <tr key={c.code}><td>{c.name_en}{c.kind === "deduction" ? " (deduction)" : ""}</td><td className="num"><Money v={s.now[c.code]} /></td></tr>)}
                <tr><td><b>Gross a month</b></td><td className="num"><b><Money v={s.gross} /></b></td></tr></tbody></table> : <p className="muted small">No salary set yet.</p>}
              {s.pending.map((p: any) => <p key={p.id} className="small"><span className="pill amber">Waiting for approval</span> update from {d(String(p.effective_date).slice(0, 10))}: {p.reason}</p>)}
              {s.canEdit && !Object.keys(s.now).length && !s.history.length && (
                <form action={openingSalaryAction}><input type="hidden" name="employee_id" value={id} />
                  <p className="small muted">The first salary is set by HR. Later changes go through Update salary and the owner&apos;s approval.</p>
                  <div className="row">{s.comps.filter((c) => c.kind === "earning" || c.fixed).map((c) => <div className="field" key={c.code}><label>{c.name_en}{c.code === "basic" ? "" : " (optional)"}</label><input name={`amt[${c.code}]`} inputMode="decimal" required={c.code === "basic"} /></div>)}
                    <div className="field"><label>From</label><input type="date" name="effective_from" defaultValue={String(e.joining_date).slice(0, 10)} /></div></div>
                  <button className="btn sm">Save salary</button></form>)}
              {s.canEdit && s.history.length > 0 && <p><Link className="btn ghost sm" href={`/payroll/revisions?employee=${id}`}>Update salary</Link></p>}
            </div>
            <div className="card"><h2>Salary history</h2>
              <table><thead><tr><th>From</th><th>Component</th><th>Amount</th><th>Update</th></tr></thead><tbody>{s.history.map((h: any, i: number) => <tr key={i}><td>{d(h.effective_from)}</td><td>{s.comps.find((c) => c.code === h.component)?.name_en ?? h.component}</td><td className="num"><Money v={h.amount} /></td><td className="small">{h.doc_no ? `${h.doc_no} · ${h.reason}` : "Opening salary"}</td></tr>)}</tbody></table>
              {e.iban && <p className="small">IBAN {e.iban}</p>}{e.wps_card_no && <p className="small">WPS card {e.wps_card_no}</p>}
            </div>
          </div>
        );
      })()}

      {tab === "leave" && await (async () => {
        const lv = await employeeLeave(ctx, id);
        const l = await hrLookups(ctx);
        return (
          <div className="grid2">
            <div className="card"><h2>Balances today</h2>
              <table><thead><tr><th>Leave</th><th>Earned</th><th>Adjusted</th><th>Taken</th><th>Waiting</th><th>Balance</th></tr></thead><tbody>{lv.balances.map((b) => <tr key={b.code}><td>{b.name}</td><td className="num">{b.accrual === "none" ? "" : b.earned}</td><td className="num">{b.adjusted}</td><td className="num">{b.taken}</td><td className="num">{b.pending}</td><td className="num"><b>{b.balance ?? "No limit"}</b></td></tr>)}</tbody></table>
              {can(ctx, "hr", "create", e.branch_id) && e.status === "active" && (
                <details><summary className="btn ghost sm">Apply for leave for this employee</summary>
                  <form action={requestLeaveAction}><input type="hidden" name="employee_id" value={id} /><input type="hidden" name="$back" value={here} />
                    <div className="row"><div className="field"><label>Leave</label><select name="leave_type" required>{l.leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
                      <div className="field"><label>From</label><input type="date" name="from_date" required /></div><div className="field"><label>To</label><input type="date" name="to_date" required /></div>
                      <div className="field"><label>Reason</label><input name="reason" /></div></div><button className="btn sm">Send for approval</button></form></details>)}
              {can(ctx, "hr", "edit", e.branch_id) && (
                <details><summary className="btn ghost sm">Adjust a balance</summary>
                  <form action={adjustLeaveAction}><input type="hidden" name="employee_id" value={id} /><input type="hidden" name="$back" value={here} />
                    <div className="row"><div className="field"><label>Leave</label><select name="leave_type">{l.leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
                      <div className="field"><label>Days (minus to take off)</label><input name="days" inputMode="decimal" required /></div><div className="field"><label>Reason</label><input name="reason" required /></div></div>
                    <button className="btn sm">Save adjustment</button></form></details>)}
            </div>
            <div className="card"><h2>Leave requests</h2>
              <table><thead><tr><th>No.</th><th>Leave</th><th>From</th><th>To</th><th>Days</th><th>Status</th></tr></thead><tbody>{lv.requests.map((r: any) => <tr key={r.id}><td>{r.doc_no}</td><td>{r.type_name}</td><td>{d(r.from_d)}</td><td>{d(r.to_d)}</td><td className="num">{r.days}</td><td><Status s={r.status} />{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td></tr>)}</tbody></table>
              {!lv.requests.length && <p className="muted small">None.</p>}
              {lv.adjustments.length > 0 && <><h3>Adjustments</h3><table><tbody>{lv.adjustments.map((a: any) => <tr key={a.id}><td>{d(a.adj_d)}</td><td>{a.type_name}</td><td className="num">{a.days}</td><td className="small">{a.reason} · {a.by_name}</td></tr>)}</tbody></table></>}
            </div>
          </div>
        );
      })()}

      {tab === "transfers" && (
        <div className="card"><h2>Branch transfers</h2>
          <table><thead><tr><th>From</th><th>To</th><th>Effective</th><th>Reason</th><th>Done</th></tr></thead><tbody>{x.transfers.map((t: any) => <tr key={t.id}><td>{t.from_code}</td><td>{t.to_code}</td><td>{d(String(t.effective_date).slice(0, 10))}</td><td>{t.reason}</td><td>{t.applied ? "Yes" : "Planned"}</td></tr>)}</tbody></table>
          {!x.transfers.length && <p className="muted small">Always at {e.branch_code}.</p>}
          {can(ctx, "hr", "edit", e.branch_id) && e.status === "active" && await (async () => {
            const l = await hrLookups(ctx);
            return (<form action={transferAction}><input type="hidden" name="employee_id" value={id} /><input type="hidden" name="$back" value={here} />
              <div className="row"><div className="field"><label>To branch</label><select name="to_branch_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.branches.filter((b) => b.id !== e.branch_id).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)]}</select></div>
                <div className="field"><label>From date</label><input type="date" name="effective_date" required /></div><div className="field"><label>Reason (optional)</label><input name="reason" /></div></div>
              <p className="small muted">Payroll splits the month&apos;s cost between branches by the days worked at each.</p>
              <button className="btn sm">Transfer</button></form>);
          })()}
        </div>
      )}

      {tab === "history" && (
        <div className="card"><h2>Change history</h2>
          <table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>{x.history.map((h: any, i: number) => (
            <tr key={i}><td className="small">{dt(h.at)}</td><td>{h.full_name ?? "system"}</td><td>{String(h.action).replace(/_/g, " ")}</td>
              <td className="small">{h.changes ? Object.entries(h.changes).filter(([k]) => x.salaryVisible || !/salary|basic|housing|amount|iban|card/.test(k)).slice(0, 8).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : ""}</td></tr>))}</tbody></table>
        </div>
      )}
    </>
  );
}
