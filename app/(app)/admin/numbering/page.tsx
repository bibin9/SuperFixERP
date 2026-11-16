import { requireCtx } from "@/lib/session";
import { listSeries } from "@/lib/services/admin";
import { seriesAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/ui";

export default async function Numbering({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = (await listSeries(ctx)).filter((r) => !sp.b || r.code === sp.b);
  return (
    <>
      <PageHead title="Document numbering" sub="One series per branch and document type. Numbers are given inside the saving transaction, so posted tax invoices have no gaps." />
      <Flash sp={sp} />
      <div className="card">
        <form className="row" style={{ marginBottom: 8 }}><input name="b" defaultValue={sp.b} placeholder="Branch code, e.g. YAS" /><button className="btn ghost shrink">Filter</button></form>
        <table>
          <thead><tr><th>Branch</th><th>Document</th><th>Prefix · next · padding · year part</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.code + r.doc_type}><td>{r.code}</td><td>{r.doc_type}</td>
              <td><form action={seriesAction} className="row"><input type="hidden" name="branch_id" value={r.branch_id} /><input type="hidden" name="doc_type" value={r.doc_type} />
                <input name="prefix" defaultValue={r.prefix} /><input name="next_number" defaultValue={r.next_number} /><input name="padding" defaultValue={r.padding} />
                <label className="shrink"><input type="checkbox" name="year_part" defaultChecked={r.year_part} /> YY</label><button className="btn ghost sm shrink">Save</button></form></td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
