import { requireCtx } from "@/lib/session";
import { listFeedback } from "@/lib/services/feedback";
import { can } from "@/lib/access";
import { followUpFeedbackAction, openComplaintAction } from "@/app/actions-front";
import { Flash, Link, PageHead, custName, dt } from "@/components/ui";

const Stars = ({ n }: { n: number }) => <span className="starline" aria-label={`${n} out of 5`}>{"★".repeat(n)}<span>{"★".repeat(5 - n)}</span></span>;

export default async function FeedbackList({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const show = ["low", "waiting"].includes(sp.show) ? sp.show : "";
  const { rows, stats } = await listFeedback(ctx, show);
  return (
    <>
      <PageHead title="Customer feedback" sub="Ratings customers give from the WhatsApp link after the car is handed over. Ratings of 1 or 2 are complaints: call the customer and write what was done." />
      <Flash sp={sp} />
      <div className="grid4">
        <div className="kpi"><div className="v">{stats.avg ?? "—"}</div><div className="l">Average rating (out of 5)</div></div>
        <div className="kpi"><div className="v">{stats.answered} / {stats.asked}</div><div className="l">Answered / asked</div></div>
        <div className="kpi"><div className="v" style={{ color: stats.low_open ? "var(--late)" : undefined }}>{stats.low_open}</div><div className="l">Complaints to follow up</div></div>
        <div className="kpi"><div className="v">{stats.waiting}</div><div className="l">Waiting for the customer</div></div>
      </div>
      <div className="tabs chips" style={{ marginTop: 16 }}>
        {[["", "All"], ["low", "To follow up"], ["waiting", "Not answered"]].map(([k, l]) => <Link key={k} className={show === k ? "on" : ""} href={k ? `/feedback?show=${k}` : "/feedback"}>{l}</Link>)}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Job</th><th>Customer</th><th>Rating</th><th>Comment</th><th>Follow-up</th></tr></thead>
          <tbody>{rows.map((f) => (
            <tr key={f.id}>
              <td><Link href={`/jobs/${f.job_card_id}`}>{f.doc_no}</Link><div className="small muted">{f.branch_code} · asked {dt(f.asked_at)}</div></td>
              <td>{custName(f)}<div className="small muted">{f.mobile}</div></td>
              <td>{f.rating ? <Stars n={f.rating} /> : <span className="muted small">not yet</span>}<div className="small muted">{dt(f.answered_at)}</div></td>
              <td className="small">{f.comment ?? ""}</td>
              <td className="small">{f.followed_up_at ? <>{f.follow_up_note}<div className="muted">{f.followed_by_name} · {dt(f.followed_up_at)}</div></>
                : f.rating && f.rating <= 2 && can(ctx, "jobs", "edit", f.branch_id) ? (
                  <><form action={followUpFeedbackAction} className="row" style={{ margin: 0 }}><input type="hidden" name="id" value={f.id} />
                    <input name="note" required placeholder="Called, offered a free re-check" aria-label="What was done" /><button className="btn sm shrink">Save</button></form>
                  <form action={openComplaintAction} style={{ marginTop: 4 }}><input type="hidden" name="$back" value="/feedback?show=low" /><input type="hidden" name="feedback_id" value={f.id} />
                    <button className="btn ghost sm">Open a complaint</button></form></>
                ) : ""}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted">Nothing here yet.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
