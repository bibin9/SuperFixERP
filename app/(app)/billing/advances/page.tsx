import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { listAdvances } from "@/lib/services/billing";
import { listCustomers } from "@/lib/services/customers";
import { masters } from "@/lib/services/masters";
import { advanceAction } from "@/app/actions-billing";
import { Flash, Link, Money, PageHead, custName, dt, label } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { withTx } from "@/lib/db";
import { can } from "@/lib/access";
import { D } from "@/lib/money";

const uuid = (v?: string) => (/^[0-9a-f-]{36}$/.test(v ?? "") ? v! : null);

export default async function Advances({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const jobId = uuid(sp.job);
  const job = jobId ? await withTx(ctx, async (c) => (await c.query(
    "SELECT j.id, j.doc_no, j.customer_id, j.branch_id, c.customer_type, c.title, c.first_name, c.last_name, c.company_name FROM job_card j JOIN customer c ON c.id = j.customer_id WHERE j.id = $1", [jobId])).rows[0]) : null;
  const customerId = job?.customer_id ?? uuid(sp.customer);
  const customer = customerId && !job ? await withTx(ctx, async (c) => (await c.query("SELECT id, customer_type, title, first_name, last_name, company_name FROM customer WHERE id = $1 AND NOT is_walk_in", [customerId])).rows[0]) : null;
  const found = sp.q && sp.q.trim().length >= 2 ? (await listCustomers(ctx, sp.q)).filter((c) => !c.is_walk_in).slice(0, 8) : [];
  const rows = await listAdvances(ctx, customerId ?? undefined);
  const m = await masters(ctx);
  const who = job ?? customer;
  const back = jobId ? `/billing/advances?job=${jobId}` : customerId ? `/billing/advances?customer=${customerId}` : "/billing/advances";
  return (
    <>
      <PageHead title="Advances and deposits" sub="Money taken before the work is invoiced. VAT is accounted when the deposit is taken and reversed when it is applied to the invoice." />
      <BillingTabs at="/billing/advances" />
      <Flash sp={sp} />
      {ctx.currentBranchId && can(ctx, "invoices", "create", job?.branch_id ?? ctx.currentBranchId) && (
        <div className="card"><h2>Take a deposit</h2>
          {!who ? (
            <>
              <form className="row"><input name="q" defaultValue={sp.q ?? ""} placeholder="Find the customer by mobile or name" aria-label="Find customer" /><button className="btn sm shrink">Find</button></form>
              {found.map((c) => <div key={c.id} className="small"><Link href={`/billing/advances?customer=${c.id}`}>{custName(c)}</Link> {c.mobile}</div>)}
              <p className="small muted">Or open a job card and choose Take deposit.</p>
            </>
          ) : (
            <form action={advanceAction}>
              <input type="hidden" name="customer_id" value={customerId!} />{jobId && <input type="hidden" name="job_card_id" value={jobId} />}
              <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} /><input type="hidden" name="$back" value={back} />
              <p><b>{custName(who)}</b>{job && <> · for job <Link href={`/jobs/${job.id}`}>{job.doc_no}</Link></>} · <Link href="/billing/advances">change</Link></p>
              <div className="row">
                <div className="field"><label>Method</label><select name="method">{m.paymentMethods.map((pm) => <option key={pm.code} value={pm.code}>{pm.name}</option>)}</select></div>
                <div className="field"><label>Amount incl. VAT (AED)</label><input name="amount" inputMode="decimal" required /></div>
                <div className="field"><label>Reference</label><input name="reference" /></div>
              </div>
              <details><summary className="small">Cheque details</summary><div className="row">
                <div className="field"><label>Cheque number</label><input name="cheque_no" /></div><div className="field"><label>Bank</label><input name="cheque_bank" /></div>
                <div className="field"><label>Cheque date</label><input name="cheque_date" type="date" /></div></div></details>
              <button className="btn green" style={{ marginTop: 8 }}>Receive deposit</button>
            </form>
          )}
        </div>
      )}
      <div className="card"><h2>{customerId ? "This customer's money held" : "Money held for customers"}</h2>
        <table>
          <thead><tr><th>Reference</th><th>Customer</th><th>Branch</th><th>Job</th><th>From</th><th className="num">Amount</th><th className="num">VAT in it</th><th className="num">Left</th><th>Taken</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td>{a.source_no}</td><td>{a.customer_name}</td><td>{a.branch_code}</td><td>{a.job_no ?? ""}</td><td>{label(a.source)}</td>
            <td className="num"><Money v={a.amount} /></td><td className="num"><Money v={a.vat_amount} /></td><td className="num">{D(a.open).gt(0) ? <Money v={a.open} /> : <span className="muted">used</span>}</td><td className="small">{dt(a.created_at)}</td></tr>)}</tbody>
        </table>
        {!rows.length && <p className="muted">Nothing held.</p>}
      </div>
    </>
  );
}
