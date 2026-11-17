/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireCtx } from "@/lib/session";
import { listRevisions, isPayroll } from "@/lib/services/payroll";
import { hrLookups, today } from "@/lib/services/hr";
import { withTx } from "@/lib/db";
import { salaryRevisionAction } from "@/app/actions-hr";
import { Flash, Money, PageHead, Status, d, dt } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Revisions({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listRevisions(ctx);
  const l = await hrLookups(ctx);
  const comps = await withTx(ctx, async (c) => (await c.query("SELECT code, name_en FROM salary_component WHERE active ORDER BY sort")).rows);
  const nextFirst = (() => { const x = new Date(`${today().slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); })();
  return (
    <>
      <PageHead title="Salary updates" sub="Raises, new allowances and corrections for one or many employees, from a date. The owner approves before payroll uses them." />
      <HrTabs group="payroll" at="/payroll/revisions" />
      <Flash sp={sp} />
      {isPayroll(ctx) && (
        <form className="card" action={salaryRevisionAction}><h2>Update salary</h2>
          <div className="row"><div className="field"><label htmlFor="ef">From</label><input id="ef" type="date" name="effective_date" defaultValue={nextFirst} required /></div>
            <div className="field" style={{ flexGrow: 3 }}><label htmlFor="rr">Reason</label><input id="rr" name="reason" required placeholder="For example: annual increment 2027" /></div></div>
          <table><thead><tr><th>Employee</th><th>Component</th><th>New monthly amount (AED)</th></tr></thead><tbody>
            {[0, 1, 2, 3, 4].map((i) => (
              <tr key={i}><td><select name="l_employee" defaultValue={i === 0 ? sp.employee ?? "" : ""} aria-label={`Employee ${i + 1}`}><option value="">—</option>{l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)}</select></td>
                <td><select name="l_component" defaultValue="basic" aria-label={`Component ${i + 1}`}>{comps.map((c: any) => <option key={c.code} value={c.code}>{c.name_en}</option>)}</select></td>
                <td><input name="l_amount" inputMode="decimal" aria-label={`Amount ${i + 1}`} /></td></tr>))}
          </tbody></table>
          <button className="btn">Send for approval</button>
        </form>
      )}
      <div className="card"><h2>Updates</h2>
        <table><thead><tr><th>No.</th><th>From</th><th>Changes</th><th>Change a month</th><th>Reason</th><th>By</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r: any) => <tr key={r.id}><td>{r.doc_no ?? "—"}</td><td>{d(r.eff)}</td><td className="small">{(r.lines as any[]).map((x) => `${x.emp_no} ${x.name}: ${x.component} ${x.old} → ${x.new}`).join("; ")}</td>
            <td className="num"><Money v={r.total_change} /></td><td>{r.reason}</td><td className="small">{r.created_by_name} {dt(r.created_at)}</td><td><Status s={r.status} />{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="muted small">None yet.</p>}
      </div>
    </>
  );
}
