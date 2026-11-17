import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { stockItemLedger } from "@/lib/services/stock-ops";
import { Link, Money, PageHead, dt, label } from "@/components/ui";
import { D } from "@/lib/money";

export default async function Ledger({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!sp.item || !sp.branch) redirect("/stock");
  const { item, rows } = await stockItemLedger(ctx, sp.item, sp.branch);
  const cost = rows.some((r) => "unit_cost" in r);
  return (
    <>
      <PageHead title={`Stock ledger · ${item.part_no}`} sub={item.description}><Link className="btn ghost" href="/stock">Back to stock</Link></PageHead>
      <div className="card">
        <table>
          <thead><tr><th>When</th><th>Movement</th><th>Document</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th>{cost && <th className="num">Rate</th>}{cost && <th className="num">Value</th>}<th>By</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="small">{dt(r.at)}</td><td>{label(r.move_type)}</td><td>{r.doc_ref}</td>
              <td className="num">{D(r.qty_in).gt(0) ? D(r.qty_in).toString() : ""}</td><td className="num">{D(r.qty_out).gt(0) ? D(r.qty_out).toString() : ""}</td>
              <td className="num"><b>{D(r.balance_qty).toString()}</b></td>{cost && <td className="num"><Money v={r.unit_cost} /></td>}{cost && <td className="num"><Money v={r.value} /></td>}
              <td className="small">{r.full_name}</td></tr>
          ))}{!rows.length && <tr><td colSpan={9} className="muted">No movements at this branch.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
