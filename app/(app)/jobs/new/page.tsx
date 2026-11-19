import { requireCtx } from "@/lib/session";
import { can } from "@/lib/access";
import { Link, PageHead } from "@/components/ui";

/** A job card comes from an approved quotation (FSD v0.10), or, for a small job, from the quick job screen (OT-02). */
export default async function NewJob() {
  const ctx = await requireCtx();
  return (
    <>
      <PageHead title="New job card" sub="Choose how the job starts." />
      <div className="grid2">
        <div className="card"><h2>Normal job</h2><p className="small">Enquiry, quotation, the customer approves, then the job card. Use it for repairs and bigger work.</p>
          <Link className="btn" href="/enquiries?status=approved">From an approved quotation</Link> <Link className="btn ghost" href="/enquiries/new">New enquiry</Link></div>
        {can(ctx, "invoices", "create") && <div className="card"><h2>Quick job</h2><p className="small">A small job done while the customer waits: job card, invoice and payment on one screen.</p>
          <Link className="btn green" href="/billing/quick">Quick job</Link></div>}
      </div>
    </>
  );
}
