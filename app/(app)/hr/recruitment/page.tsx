import { requireCtx } from "@/lib/session";
import { recruitment, hrLookups } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { addOpeningAction, addApplicantAction, moveApplicantAction, hireApplicantAction } from "@/app/actions-hr";
import { Flash, Money, PageHead, Status, Link } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Recruitment({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const r = await recruitment(ctx);
  const l = await hrLookups(ctx);
  const edit = canAnywhere(ctx, "hr", "edit");
  return (
    <>
      <PageHead title="Recruitment" sub="Openings and applicants: applied, interview, offer, hired. A hired applicant becomes an employee file." />
      <HrTabs group="hr" at="/hr/recruitment" />
      <Flash sp={sp} />
      <div className="card"><h2>Openings</h2>
        <table><thead><tr><th>Title</th><th>Branch</th><th>Positions</th><th>Applicants</th><th>Hired</th><th>Status</th></tr></thead>
          <tbody>{r.openings.map((o) => <tr key={o.id}><td>{o.title}</td><td>{o.branch_code}</td><td className="num">{o.positions}</td><td className="num">{o.applicants}</td><td className="num">{o.hired}</td><td><Status s={o.status} /></td></tr>)}</tbody></table>
        {!r.openings.length && <p className="muted small">No openings.</p>}
        {canAnywhere(ctx, "hr", "create") && (
          <details><summary className="btn ghost sm">New opening</summary>
            <form action={addOpeningAction}><div className="row">
              <div className="field"><label>Job title</label><input name="title" required /></div>
              <div className="field"><label>Branch</label><select name="branch_id" required>{l.branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
              <div className="field"><label>Department (optional)</label><select name="department_id"><option value="">—</option>{l.departments.map((x) => <option key={x.id} value={x.id}>{x.name_en}</option>)}</select></div>
              <div className="field"><label>Designation (optional)</label><select name="designation_id"><option value="">—</option>{l.designations.map((x) => <option key={x.id} value={x.id}>{x.name_en}</option>)}</select></div>
              <div className="field"><label>Positions</label><input name="positions" defaultValue="1" inputMode="numeric" /></div></div>
              <button className="btn sm">Add opening</button></form></details>)}
      </div>
      <div className="card"><h2>Applicants</h2>
        <table><thead><tr><th>Name</th><th>For</th><th>Contact</th><th>Stage</th><th>Notes</th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{r.applicants.map((a) => (
            <tr key={a.id}><td>{a.full_name}</td><td>{a.title} · {a.branch_code}</td><td className="small">{a.mobile} {a.email}</td><td><Status s={a.stage} />{a.offer_salary && <div className="small">Offer <Money v={a.offer_salary} /></div>}</td>
              <td className="small">{a.interview_notes}</td>
              <td>{a.stage === "hired" ? <Link href={`/hr/employees/${a.employee_id}`}>{a.emp_no}</Link> : edit && <>
                {a.stage !== "rejected" && <form action={moveApplicantAction} className="row"><input type="hidden" name="id" value={a.id} />
                  <select name="stage" defaultValue={a.stage === "applied" ? "interview" : "offer"} aria-label="Stage"><option value="interview">Interview</option><option value="offer">Offer</option><option value="rejected">Not taken</option></select>
                  <input name="interview_notes" placeholder="Notes" style={{ maxWidth: 140 }} /><input name="offer_salary" placeholder="Offer (AED)" inputMode="decimal" style={{ maxWidth: 110 }} /><button className="btn ghost sm shrink">Move</button></form>}
                {a.stage === "offer" && <form action={hireApplicantAction} className="row"><input type="hidden" name="id" value={a.id} /><input type="date" name="joining_date" required aria-label="Joining date" /><button className="btn sm shrink">Hire</button></form>}
              </>}</td></tr>))}
          </tbody></table>
        {!r.applicants.length && <p className="muted small">No applicants.</p>}
        {canAnywhere(ctx, "hr", "create") && r.openings.some((o) => o.status === "open") && (
          <details><summary className="btn ghost sm">Add applicant</summary>
            <form action={addApplicantAction}><div className="row">
              <div className="field"><label>Opening</label><select name="opening_id" required>{r.openings.filter((o) => o.status === "open").map((o) => <option key={o.id} value={o.id}>{o.title} · {o.branch_code}</option>)}</select></div>
              <div className="field"><label>Full name</label><input name="full_name" required /></div><div className="field"><label>Mobile (optional)</label><input name="mobile" /></div>
              <div className="field"><label>Email (optional)</label><input name="email" /></div>
              <div className="field"><label>Nationality (optional)</label><select name="nationality"><option value="">—</option>{l.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div></div>
              <button className="btn sm">Add applicant</button></form></details>)}
      </div>
    </>
  );
}
