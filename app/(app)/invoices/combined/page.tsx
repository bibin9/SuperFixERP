import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { combinableJobs } from "@/lib/services/billing";
import { listCustomers } from "@/lib/services/customers";
import { combinedInvoiceAction } from "@/app/actions-billing";
import { Flash, Link, Money, PageHead, custName } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { withTx } from "@/lib/db";
import { D } from "@/lib/money";

const uuid = (v?: string) => (/^[0-9a-f-]{36}$/.test(v ?? "") ? v! : null);

/** One tax invoice for several finished job cards of the same customer (fleet month-end billing). */
export default async function CombinedInvoice({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const customerId = uuid(sp.customer);
  const data = customerId ? await combinableJobs(ctx, customerId) : null;
  const found = !customerId && sp.q && sp.q.trim().length >= 2 ? (await listCustomers(ctx, sp.q)).filter((c) => !c.is_walk_in).slice(0, 10) : [];
  // Customers with two or more finished job cards waiting for an invoice at this branch.
  const waiting = !customerId && ctx.currentBranchId ? await withTx(ctx, async (c) => (await c.query(
    `SELECT cu.id, cu.customer_type, cu.title, cu.first_name, cu.last_name, cu.company_name, count(*)::int jobs
       FROM job_card j JOIN customer cu ON cu.id = j.customer_id
      WHERE j.branch_id = $1 AND j.status IN ('ready','delivered') AND NOT cu.is_walk_in
      GROUP BY cu.id HAVING count(*) >= 2 ORDER BY (cu.customer_type <> 'individual') DESC, count(*) DESC LIMIT 20`, [ctx.currentBranchId])).rows) : [];
  const ok = data?.jobs.filter((j) => !j.problems.length) ?? [];
  const total = ok.reduce((s, j) => s.plus(j.total), D(0));
  return (
    <>
      <PageHead title="Combined invoice" sub="One tax invoice for several finished job cards of the same customer, for example a fleet's cars at month end. Each car is listed with its own subtotal." />
      <BillingTabs at="/invoices" />
      <Flash sp={sp} />
      {!data ? (
        <div className="card">
          <h2>Choose the customer</h2>
          <form className="row"><input name="q" defaultValue={sp.q ?? ""} placeholder="Company name, customer name or mobile" aria-label="Find customer" /><button className="btn sm shrink">Find</button></form>
          {found.map((c) => <div key={c.id}><Link href={`/invoices/combined?customer=${c.id}`}>{custName(c)}</Link> <span className="small muted">{c.mobile}</span></div>)}
          {waiting.length > 0 && <>
            <h3 style={{ marginTop: 14 }}>Customers with several cars waiting for an invoice</h3>
            <ul>{waiting.map((c) => <li key={c.id}><Link href={`/invoices/combined?customer=${c.id}`}>{custName(c)}</Link> · {c.jobs} job cards</li>)}</ul>
          </>}
        </div>
      ) : (
        <form action={combinedInvoiceAction} className="card">
          <input type="hidden" name="customer_id" value={customerId!} />
          <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
          <input type="hidden" name="$back" value={`/invoices/combined?customer=${customerId}`} />
          <p><b>{data.billTo}</b> · <Link href="/invoices/combined">change customer</Link></p>
          {!data.jobs.length ? <p className="muted">No finished job cards with work waiting to be invoiced at this branch.</p> : (
            <div className="tablewrap"><table>
              <thead><tr><th></th><th>Job card</th><th>Car</th><th>Ready</th><th>LPO</th><th className="num">Before VAT</th><th className="num">VAT</th><th className="num">Total</th><th>Check</th></tr></thead>
              <tbody>{data.jobs.map((j) => (
                <tr key={j.id}>
                  <td><input type="checkbox" name="job" value={j.id} defaultChecked={!j.problems.length} disabled={!!j.problems.length} aria-label={`Include ${j.doc_no}`} /></td>
                  <td><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></td>
                  <td>{[j.plate_code, j.plate_number].filter(Boolean).join(" ")} {j.make} {j.model}</td>
                  <td>{j.ready_on ?? ""}</td><td>{j.lpo_no ?? ""}</td>
                  <td className="num"><Money v={j.taxable} /></td><td className="num"><Money v={j.vat} /></td><td className="num"><b><Money v={j.total} /></b></td>
                  <td className="small">{j.problems.length ? <span style={{ color: "var(--late)" }}>{j.problems.join("; ")}</span> : <span className="pill green">Ready to bill</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          {ok.length > 0 && <p>All ticked jobs together: <b>AED <Money v={total.toFixed(2)} /></b> including VAT. Untick any job that should not be on this invoice.</p>}
          <div className="field"><label htmlFor="notes">Note on the invoice</label><input id="notes" name="notes" placeholder="e.g. November 2026 services" /></div>
          <button className="btn green" disabled={ok.length < 2} style={{ marginTop: 8 }}>Post combined tax invoice</button>
          {ok.length < 2 && <p className="small muted">You need at least two job cards that are ready to bill.</p>}
        </form>
      )}
    </>
  );
}
