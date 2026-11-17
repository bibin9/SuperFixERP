import { requireCtx } from "@/lib/session";
import { planning } from "@/lib/services/stock-ops";
import { masters } from "@/lib/services/masters";
import { can } from "@/lib/access";
import { requestFromBranchAction, raisePoAction, expectedDateAction } from "@/app/actions-ops";
import { Flash, Link, PageHead, d, dt } from "@/components/ui";
import { StockTabs } from "@/components/StockTabs";
import { D } from "@/lib/money";

export default async function Planning({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await planning(ctx);
  const m = await masters(ctx);
  return (
    <>
      <PageHead title="Stock planning" sub="Parts that jobs are waiting for. Ask another branch or raise a purchase order in one click; received parts go to the waiting job first." />
      <StockTabs at="/stock/planning" />
      <Flash sp={sp} />
      <div className="card">
        <table>
          <thead><tr><th>Job</th><th>Branch</th><th>Part</th><th className="num">Required</th><th className="num">Committed</th><th className="num">Back-ordered</th><th>Being sourced</th><th>Other branches (free)</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((r) => {
            const editable = can(ctx, "stock", "create", r.branch_id);
            return (
              <tr key={r.id}>
                <td><Link href={`/jobs/${r.job_id}`}>{r.job_no}</Link><div className="small muted">{r.promised_at ? `promised ${dt(r.promised_at)}` : ""}</div></td>
                <td>{r.branch_code}</td>
                <td>{r.part_no}<div className="small muted">{r.description}</div></td>
                <td className="num">{D(r.required).minus(r.issued_qty).toString()}</td>
                <td className="num">{D(r.committed).toString()}</td>
                <td className="num"><b>{D(r.back_ordered).toString()}</b></td>
                <td className="small">{r.source_ref ? <>{r.source_type === "po" ? "PO" : "Transfer"} {r.source_ref}</> : <span className="pill amber">Not yet</span>}
                  {editable && <form action={expectedDateAction} className="row" style={{ marginTop: 4 }}><input type="hidden" name="commitment_id" value={r.id} />
                    <input type="date" name="expected_date" defaultValue={r.expected_date ? new Date(r.expected_date).toISOString().slice(0, 10) : ""} style={{ minWidth: 130 }} /><button className="btn ghost sm shrink">Set date</button></form>}
                  {r.expected_date && <div className="muted">expected {d(new Date(r.expected_date).toISOString().slice(0, 10))}</div>}</td>
                <td className="small">{r.elsewhere.length ? r.elsewhere.map((e: { branch_id: string; code: string; free: string }) => <div key={e.branch_id}>{e.code}: {D(e.free).toString()}</div>) : <span className="muted">None free</span>}</td>
                <td className="small">{editable && !r.source_ref && <>
                  {r.elsewhere.length > 0 && <form action={requestFromBranchAction} className="row"><input type="hidden" name="commitment_id" value={r.id} />
                    <select name="from_branch_id">{r.elsewhere.map((e: { branch_id: string; code: string }) => <option key={e.branch_id} value={e.branch_id}>{e.code}</option>)}</select>
                    <button className="btn sm shrink">Request</button></form>}
                  {can(ctx, "purchasing", "create", r.branch_id) && <form action={raisePoAction} className="row" style={{ marginTop: 4 }}><input type="hidden" name="commitment_id" value={r.id} />
                    <select name="supplier_id" defaultValue={r.preferred_supplier_id ?? ""}><option value="">Preferred supplier</option>{m.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</select>
                    <button className="btn ghost sm shrink">Raise PO</button></form>}</>}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={9} className="muted">No job is waiting for parts.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
