import { requireCtx } from "@/lib/session";
import { inbox, sentByMe } from "@/lib/services/workflow";
import { approvalAction } from "@/app/actions";
import { Flash, Link, Money, PageHead, Status, dt } from "@/components/ui";

const DOC_LINK: Record<string, (id: string) => string> = {
  credit_note: (id) => `/billing/credit-notes/${id}`, purchase_order: (id) => `/purchasing/${id}`, stock_transfer: (id) => `/stock/transfers/${id}`,
  voucher: (id) => `/accounts/vouchers/${id}`, supplier_bill: (id) => `/purchasing/bills/${id}`,
  final_settlement: (id) => `/payroll/settlements/${id}`, loan: () => "/payroll/loans", salary_revision: () => "/payroll/revisions",
};
/** HR and payroll requests show their details (employee, dates, amounts) on the inbox line. */
const HR_DOCS = ["leave_request", "overtime_request", "hr_letter", "loan", "salary_revision", "payroll_run", "final_settlement"];
const LABEL: Record<string, string> = { leave_request: "Leave", overtime_request: "Overtime", hr_letter: "HR letter", loan: "Advance or loan", salary_revision: "Salary update", payroll_run: "Payroll", final_settlement: "Final settlement" };

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
              <div><b>{LABEL[i.doc_type] ?? i.doc_type.replace(/_/g, " ")}</b> · {i.doc_type === "payroll_run" && i.summary?.month ? <Link href={`/payroll/${i.summary.month}`}>{i.doc_ref}</Link> : DOC_LINK[i.doc_type] ? <Link href={DOC_LINK[i.doc_type](i.doc_id)}>{i.doc_ref}</Link> : i.doc_ref} · {i.branch_code} · from {i.requested_by_name} <span className="muted small">{dt(i.created_at)}</span>{i.overdue && <span className="pill red">Waiting too long</span>}{i.escalated && <span className="pill amber">Escalated to you</span>}
                <div className="small">{i.summary?.reason}{i.amount !== null && <> · total AED <Money v={i.amount} /></>}{i.discount_pct && <> · discount {Number(i.discount_pct).toFixed(2)}%</>} · step: {i.step_name}</div>
                {i.summary?.job && <div className="small">Job {i.summary.job}</div>}
                {HR_DOCS.includes(i.doc_type) && i.summary && <div className="small" data-testid="hr-summary">{Object.entries(i.summary).filter(([k]) => k !== "reason").map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}</div>}</div>
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
        <table><tbody>{mine.map((r) => <tr key={r.id}><td>{LABEL[r.doc_type] ?? r.doc_type.replace(/_/g, " ")}</td><td>{r.doc_ref}</td><td>{r.branch_code}</td><td><Status s={r.status} /></td><td className="small muted">{dt(r.created_at)}</td></tr>)}</tbody></table>
        {!mine.length && <p className="muted small">None.</p>}
        <p className="small muted">Approvers act from this inbox; <Link href="/admin/workflows">workflow set-up</Link> decides who approves what.</p>
      </div>
    </>
  );
}
