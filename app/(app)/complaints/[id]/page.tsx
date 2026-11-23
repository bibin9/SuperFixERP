import { requireCtx } from "@/lib/session";
import { getComplaint } from "@/lib/services/complaints";
import { workComplaintAction } from "@/app/actions-front";
import { Flash, Link, PageHead, d, dt } from "@/components/ui";

export default async function ComplaintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { k, actions, owners, canEdit } = await getComplaint(ctx, id);
  const closed = k.status === "closed";
  const hidden = <input type="hidden" name="id" value={k.id} />;
  return (
    <>
      <PageHead title={`Complaint ${k.doc_no}`} sub={`${k.customer_name} · ${k.mobile} · ${k.branch_name}`}>
        {closed ? <span className="pill green">Closed</span> : <span className={`pill ${k.overdue ? "red" : "amber"}`}>{k.overdue ? "Overdue" : k.status === "open" ? "Open" : "In progress"}</span>}
      </PageHead>
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card"><h2>The complaint</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{k.description}</p>
          <p className="small muted">{k.source_name} · opened by {k.opened_by_name} {dt(k.opened_at)}{k.job_no && <> · job card <Link href={`/jobs/${k.job_card_id}`}>{k.job_no}</Link></>} · <Link href={`/customers/${k.customer_id}`}>customer</Link></p>
          <p>Dealt with by <b>{k.owner_name ?? "nobody yet"}</b>{!closed && <> · close by <b>{d(k.due_date)}</b></>}</p>
          {closed && <div className="flash ok"><b>Resolved:</b> {k.resolution}<div className="small">{k.closed_by_name} · {dt(k.closed_at)}</div></div>}
        </div>
        <div className="card"><h2>What was done</h2>
          <table><tbody>{actions.map((a) => <tr key={a.id}><td className="small">{a.note}</td><td className="small">{a.full_name}</td><td className="small muted">{dt(a.at)}</td></tr>)}</tbody></table>
          {canEdit && !closed && <>
            <form action={workComplaintAction} style={{ marginTop: 10 }}>{hidden}<input type="hidden" name="step" value="action" />
              <div className="field"><label>Add what was done</label><textarea name="note" rows={2} required placeholder="Called the customer, booked a free re-check for Thursday" /></div>
              <button className="btn">Add</button></form>
            <form action={workComplaintAction} className="row" style={{ marginTop: 10 }}>{hidden}<input type="hidden" name="step" value="owner" />
              <div className="field"><label>Hand to</label><select name="owner_id" defaultValue={k.owner_id ?? ""}>{owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>
              <div className="shrink"><button className="btn ghost">Change owner</button></div></form>
            <form action={workComplaintAction} style={{ marginTop: 10 }}>{hidden}<input type="hidden" name="step" value="close" />
              <div className="field"><label>How it was resolved</label><textarea name="note" rows={2} required /></div>
              <button className="btn green">Close the complaint</button></form>
          </>}
          {canEdit && closed && <form action={workComplaintAction} className="row" style={{ marginTop: 10 }}>{hidden}<input type="hidden" name="step" value="reopen" />
            <div className="field"><label>Why reopen</label><input name="note" required /></div><div className="shrink"><button className="btn ghost">Reopen</button></div></form>}
        </div>
      </div>
    </>
  );
}
