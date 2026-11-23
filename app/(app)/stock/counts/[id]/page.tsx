import { requireCtx } from "@/lib/session";
import { getCount } from "@/lib/services/stock-ops";
import { can } from "@/lib/access";
import { countAction } from "@/app/actions-ops";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, PageHead, Status, label } from "@/components/ui";
import { StockTabs } from "@/components/StockTabs";
import { D } from "@/lib/money";
import { ScanBox } from "@/components/ScanBox";

export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { cnt, lines, showBook } = await getCount(ctx, id);
  const open = cnt.status === "open" && can(ctx, "stock", "edit", cnt.branch_id);
  return (
    <>
      <PageHead title={`Stock count ${cnt.doc_no}`} sub={`${cnt.branch_code} · ${cnt.category ? label(cnt.category) : "All stock items"}`}><Status s={cnt.status} /></PageHead>
      <StockTabs at="/stock/adjustments" />
      <Flash sp={sp} />
      <form action={countAction} className="card">
        <input type="hidden" name="id" value={id} />
        {open && <><ScanBox mode="count" label="Scan each piece, or type a barcode or part no." />
          <p className="small muted">Each scan adds one to that part&apos;s count. You can still type a number in the Counted box. Save often.</p></>}
        <table>
          <thead><tr><th>Part</th><th>Unit</th><th className="num">Counted</th>{showBook && <th className="num">Book</th>}{showBook && <th className="num">Difference</th>}</tr></thead>
          <tbody>{lines.map((l) => {
            const diff = showBook && l.counted_qty !== null ? D(l.counted_qty).minus(l.system_qty) : null;
            return (
              <tr key={l.id} data-codes={l.codes ?? undefined} data-part={l.part_no}><td>{l.part_no}<div className="small muted">{l.description}</div></td><td>{l.uom}</td>
                <td className="num">{open ? <input name={`qty[${l.id}]`} inputMode="decimal" defaultValue={l.counted_qty ?? ""} style={{ width: 90, minWidth: 70 }} /> : l.counted_qty === null ? "—" : D(l.counted_qty).toString()}</td>
                {showBook && <td className="num">{D(l.system_qty).toString()}</td>}
                {showBook && <td className="num">{diff === null ? "—" : diff.eq(0) ? "0" : <b className={diff.lt(0) ? "red-text" : ""}>{diff.gt(0) ? "+" : ""}{diff.toString()}</b>}</td>}</tr>
            );
          })}</tbody>
        </table>
        {open && <div className="row" style={{ marginTop: 12 }}>
          <div className="shrink"><button className="btn ghost" name="submit" value="0">Save</button></div>
          <div className="shrink"><ConfirmButton className="btn" name="submit" value="1" message="Submit the count? You cannot change it afterwards.">Submit count</ConfirmButton></div></div>}
      </form>
    </>
  );
}
