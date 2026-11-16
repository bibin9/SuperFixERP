import { requireCtx } from "@/lib/session";
import { inbox, sentByMe } from "@/lib/services/workflow";
import { approvalAction } from "@/app/actions";
import { Flash, Link, Money, PageHead, Status, dt } from "@/components/ui";

export default async function Approvals({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const items = await inbox(ctx);
  const mine = await sentByMe(ctx);
  return (
    <>
      <PageHead title="Approvals" sub="Waiting for you. You never see your own documents here (WF rule 4)." />
      <Flash sp={sp} />
      <div className="card"><h2>Waiting for me</h2>
        {!items.length && <p className="muted">Nothing waiting.</p>}
        {items.map((i) => (
          <div key={i.task_id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}>
            <div className="row" style={{ alignItems: "center" }}>
              <div><b>{i.doc_type.replace("_", " ")}</b> · {i.doc_ref} · {i.branch_code} · from {i.requested_by_name} <span className="muted small">{dt(i.created_at)}</span>
                <div className="small">{i.summary?.reason}{i.amount !== null && <> · total AED <Money v={i.amount} /></>}{i.discount_pct && <> · discount {Number(i.discount_pct).toFixed(2)}%</>} · step: {i.step_name}</div>
                {i.summary?.job && <div className="small">Job {i.summary.job}</div>}</div>
            </div>
            <form action={approvalAction} className="row" style={{ marginTop: 6 }}>
              <input type="hidden" name="task_id" value={i.task_id} />
              <input name="comment" placeholder="Comment (required to reject or send back)" />
              <button name="action" value="approved" className="btn green shrink">Approve</button>
              <button name="action" value="sent_back" className="btn ghost shrink">Send back</button>
              <button name="action" value="rejected" className="btn red shrink">Reject</button>
            </form>
          </div>
        ))}
      </div>
      <div className="card"><h2>Sent by me</h2>
        <table><tbody>{mine.map((r) => <tr key={r.id}><td>{r.doc_type.replace("_", " ")}</td><td>{r.doc_ref}</td><td>{r.branch_code}</td><td><Status s={r.status} /></td><td className="small muted">{dt(r.created_at)}</td></tr>)}</tbody></table>
        {!mine.length && <p className="muted small">None.</p>}
        <p className="small muted">Approvers act from this inbox; <Link href="/admin/workflows">workflow set-up</Link> decides who approves what.</p>
      </div>
    </>
  );
}
