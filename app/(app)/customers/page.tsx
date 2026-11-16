import { requireCtx } from "@/lib/session";
import { listCustomers } from "@/lib/services/customers";
import { can } from "@/lib/access";
import { Flash, Link, PageHead, custName } from "@/components/ui";

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listCustomers(ctx, sp.q ?? "");
  return (
    <>
      <PageHead title="Customers" sub="One customer database shared by every branch.">
        {can(ctx, "customers", "create") && <Link className="btn" href="/customers/new">New customer</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="card">
        <form className="row" style={{ marginBottom: 10 }}><input name="q" defaultValue={sp.q} placeholder="Name, customer no. or mobile" /><button className="btn ghost shrink">Filter</button></form>
        <table>
          <thead><tr><th>No.</th><th>Name</th><th>Type</th><th>Mobile</th><th className="num">Vehicles</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.customer_no}</td><td><Link href={`/customers/${r.id}`}>{custName(r)}</Link></td><td>{r.customer_type}</td><td>{r.mobile}</td><td className="num">{r.vehicles}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
