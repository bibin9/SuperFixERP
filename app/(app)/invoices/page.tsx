import { OlderRows } from "@/components/OlderRows";
import { offsetOf } from "@/lib/paging";
import { requireCtx } from "@/lib/session";
import { listInvoices } from "@/lib/services/billing";
import { Link, Money, PageHead, Status, d } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { can, canAnywhere } from "@/lib/access";
import { forbidden } from "@/lib/errors";

const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
const FILTERS: [string, string][] = [["", "All"], ["open", "Open"], ["overdue", "Overdue"], ["settled", "Settled"]];

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  if (!canAnywhere(ctx, "invoices", "view")) throw forbidden();
  const sp = await searchParams;
  const status = FILTERS.some(([k]) => k === sp.status) ? sp.status ?? "" : "";
  const rows = await listInvoices(ctx, { status, q: sp.q ?? "" }, offsetOf(sp));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  return (
    <>
      <PageHead title="Invoices" sub="Posted invoices in your branches. Posted invoices are never edited or deleted.">
        {ctx.currentBranchId && can(ctx, "invoices", "create", ctx.currentBranchId) && <Link className="btn ghost sm" href="/invoices/combined">Combined invoice</Link>}
      </PageHead>
      <BillingTabs at="/invoices" />
      <div className="card">
        <form className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>Search</label><input name="q" defaultValue={sp.q ?? ""} placeholder="Invoice, customer or job number" /></div>
          <div className="field"><label>Show</label><select name="status" defaultValue={status}>{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="shrink"><button className="btn">Filter</button></div>
        </form>
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Branch</th><th>Bill to</th><th>Job</th><th>Kind</th><th className="num">Total</th><th className="num">Open</th><th>Due</th></tr></thead>
          <tbody>{rows.map((r) => {
            const open = Number(r.open_amount) > 0;
            const overdue = open && ymd(r.due_date) < today;
            return (
              <tr key={r.id}><td><Link href={`/invoices/${r.id}`}>{r.doc_no}</Link></td><td>{d(ymd(r.doc_date))}</td><td>{r.branch_code}</td><td>{r.bill_to_name}</td>
                <td>{r.job_no ?? (r.source === "counter" ? "Counter" : "")}</td><td className="small">{r.invoice_kind === "simplified" ? "Simplified" : "Tax"}{r.bill_to_type === "fleet" ? " · fleet" : ""}</td>
                <td className="num"><Money v={r.grand_total} /></td><td className="num"><Money v={r.open_amount} /></td>
                <td>{open ? <Status s={overdue ? "overdue" : "open"} /> : <Status s="settled" />} <span className="small">{d(ymd(r.due_date))}</span></td></tr>);
          })}</tbody>
        </table>
        {!rows.length && <p className="muted">No invoices match.</p>}
      </div>
      <OlderRows rows={rows} base="/invoices" sp={sp} />
    </>
  );
}
