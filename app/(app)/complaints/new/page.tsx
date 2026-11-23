import { requireCtx } from "@/lib/session";
import { complaintOptions } from "@/lib/services/complaints";
import { withTx } from "@/lib/db";
import { openComplaintAction } from "@/app/actions-front";
import { Flash, Link, PageHead, custName } from "@/components/ui";

/** Opens a complaint for a customer, optionally on one of their job cards. */
export default async function NewComplaint({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const jobId = uuid(sp.job), custId = uuid(sp.customer);
  const ctxRow = await withTx(ctx, async (c) => {
    if (jobId) return (await c.query("SELECT j.id job_id, j.doc_no, cu.* FROM job_card j JOIN customer cu ON cu.id = j.customer_id WHERE j.id = $1", [jobId])).rows[0];
    if (custId) return (await c.query("SELECT NULL job_id, NULL doc_no, cu.* FROM customer cu WHERE cu.id = $1", [custId])).rows[0];
    return null;
  });
  const o = await complaintOptions(ctx);
  const back = `/complaints/new?${jobId ? `job=${jobId}` : `customer=${custId ?? ""}`}`;
  return (
    <>
      <PageHead title="Open a complaint" sub="Write what the customer is unhappy about and who will deal with it." />
      <Flash sp={sp} />
      {!ctxRow ? <div className="card"><p>Open a complaint from the customer&apos;s page or from the job card, so it is linked to the right customer.</p><Link className="btn" href="/customers">Find the customer</Link></div> : (
        <div className="card">
          <p><b>{custName(ctxRow)}</b> · {ctxRow.mobile}{ctxRow.doc_no ? <> · job card <b>{ctxRow.doc_no}</b></> : null}</p>
          <form action={openComplaintAction}>
            <input type="hidden" name="$back" value={back} /><input type="hidden" name="customer_id" value={ctxRow.id} />{ctxRow.job_id && <input type="hidden" name="job_card_id" value={ctxRow.job_id} />}
            <div className="field"><label>What is the complaint?</label><textarea name="description" rows={4} required /></div>
            <div className="row">
              <div className="field"><label>How it came in</label><select name="source" defaultValue="walk_in">{o.sources.filter((s) => s.code !== "feedback").map((s) => <option key={s.code} value={s.code}>{s.name_en}</option>)}</select></div>
              <div className="field"><label>Who deals with it</label><select name="owner_id" defaultValue={ctx.userId}>{o.owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>
              <div className="shrink"><button className="btn">Open the complaint</button></div>
            </div>
          </form>
        </div>)}
    </>
  );
}
