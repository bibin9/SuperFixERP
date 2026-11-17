import { requireCtx } from "@/lib/session";
import { storeQueue } from "@/lib/services/stock-ops";
import { can } from "@/lib/access";
import { issueAction } from "@/app/actions";
import { partRequestCloseAction } from "@/app/actions-ops";
import { Flash, Link, PageHead, Status, dt } from "@/components/ui";
import { StockTabs } from "@/components/StockTabs";
import { D } from "@/lib/money";

export default async function Queue({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const { requests, toIssue } = await storeQueue(ctx);
  const canIssue = can(ctx, "stock", "edit", ctx.currentBranchId);
  return (
    <>
      <PageHead title="Store queue" sub="Parts to hand out at this branch. Stock leaves the store only against a job line." />
      <StockTabs at="/stock/queue" />
      <Flash sp={sp} />
      <div className="card"><h2>Requests from technicians</h2>
        <table>
          <thead><tr><th>Job</th><th>Part</th><th className="num">Qty</th><th>Asked by</th><th>Status</th><th>Note</th><th></th></tr></thead>
          <tbody>{requests.map((r) => (
            <tr key={r.id}><td><Link href={`/jobs/${r.job_card_id}`}>{r.job_no}</Link></td><td>{r.part_no ?? ""}<div className="small muted">{r.item_desc}</div></td>
              <td className="num">{D(r.qty).toString()}</td><td className="small">{r.requested_name}<div className="muted">{dt(r.requested_at)}</div></td>
              <td>{r.status === "needs_quote" ? <span className="pill amber">Advisor to quote first</span> : <Status s="open" />}</td><td className="small">{r.note}</td>
              <td>{canIssue && <form action={partRequestCloseAction} className="row"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="$back" value="/stock/queue" />
                {r.status === "open" && <button name="status" value="issued" className="btn ghost sm shrink">Mark handed out</button>}
                <button name="status" value="cancelled" className="btn ghost sm shrink">Close</button></form>}</td></tr>
          ))}{!requests.length && <tr><td colSpan={7} className="muted">No open requests.</td></tr>}</tbody>
        </table>
      </div>
      <div className="card"><h2>Approved parts not yet issued</h2>
        <table>
          <thead><tr><th>Job</th><th>Part</th><th className="num">Issued</th><th className="num">Committed</th><th>Issue</th></tr></thead>
          <tbody>{toIssue.map((r) => (
            <tr key={r.job_line_id}><td><Link href={`/jobs/${r.job_id}`}>{r.job_no}</Link> <Status s={r.job_status} /></td><td>{r.part_no}<div className="small muted">{r.description}</div></td>
              <td className="num">{D(r.issued_qty).toString()} of {D(r.qty).toString()}</td>
              <td className="num">{r.committed ? D(r.committed).toString() : "0"}{D(r.back_ordered ?? 0).gt(0) && <div><span className="pill amber">back-ordered {D(r.back_ordered).toString()}</span></div>}</td>
              <td>{canIssue && <form action={issueAction} className="row"><input type="hidden" name="job_id" value={r.job_id} /><input type="hidden" name="line_id" value={r.job_line_id} /><input type="hidden" name="$back" value="/stock/queue" />
                <input name="qty" defaultValue={D(r.qty).minus(r.issued_qty).toString()} style={{ width: 80, minWidth: 60 }} /><button className="btn sm shrink">Issue</button></form>}</td></tr>
          ))}{!toIssue.length && <tr><td colSpan={5} className="muted">Nothing waiting.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
