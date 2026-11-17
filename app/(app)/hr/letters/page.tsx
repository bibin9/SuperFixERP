import { requireCtx } from "@/lib/session";
import { listLetters, hrLookups } from "@/lib/services/hr";
import { canAnywhere } from "@/lib/access";
import { requestLetterAction } from "@/app/actions-hr";
import { Flash, Link, PageHead, Status, dt } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Letters({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listLetters(ctx);
  const l = await hrLookups(ctx);
  return (
    <>
      <PageHead title="HR letters" sub="Salary certificates, employment certificates, salary transfer and experience letters, in English or Arabic, after approval" />
      <HrTabs group="hr" at="/hr/letters" />
      <Flash sp={sp} />
      <div className="card"><table><thead><tr><th>Ref</th><th>Employee</th><th>Letter</th><th>Language</th><th>Addressed to</th><th>Asked</th><th>Status</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.status === "approved" ? <Link href={`/hr/letters/${r.id}`}>{r.ref_no}</Link> : "—"}</td><td>{r.emp_no} {r.full_name}</td><td>{r.template}</td><td>{r.language === "ar" ? "Arabic" : "English"}</td><td>{r.addressed_to}</td><td className="small">{dt(r.created_at)}</td>
          <td><Status s={r.status} />{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="muted small">No letters yet.</p>}
      </div>
      {canAnywhere(ctx, "hr", "create") && (
        <div className="card"><h2>Prepare a letter</h2>
          <form action={requestLetterAction}><input type="hidden" name="$back" value="/hr/letters" />
            <div className="row"><div className="field"><label>Employee</label><select name="employee_id" required defaultValue="">{[<option key="" value="">Choose</option>, ...l.managers.map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name}</option>)]}</select></div>
              <div className="field"><label>Letter</label><select name="template_code" required>{l.letterTemplates.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
              <div className="field"><label>Language</label><select name="language"><option value="en">English</option><option value="ar">Arabic</option></select></div>
              <div className="field"><label>Addressed to (optional)</label><input name="addressed_to" placeholder="To whom it may concern" /></div></div>
            <button className="btn sm">Send for approval</button></form>
        </div>
      )}
    </>
  );
}
