import { requireCtx } from "@/lib/session";
import { dayBook, SOURCE_NAMES } from "@/lib/services/financials";
import { Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function DayBook({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const r = await dayBook(ctx, { from: one(sp.from), to: one(sp.to), branches: branchesParam(sp).join(","), type: one(sp.type) });
  const total = r.rows.reduce((s, x) => s + Number(x.amount), 0);
  return (
    <>
      <PageHead title="Day book" sub="Every journal in date order, from documents and vouchers alike." />
      <AccountsTabs group="books" at="/accounts/day-book" />
      <FinFilter scope={r.scope} mode="range" from={r.from} to={r.to}>
        <div className="field"><label>Type</label><select name="type" defaultValue={one(sp.type)}><option value="">All</option>{Object.entries(SOURCE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </FinFilter>
      <div className="card">
        <table>
          <thead><tr><th>Date</th><th>Journal</th><th>Type</th><th>Branch</th><th>Narration</th><th className="num">Amount</th></tr></thead>
          <tbody>{r.rows.map((j) => (
            <tr key={j.id}><td>{d(j.journal_date)}</td><td><Link href={`/accounts/journal/${j.id}`}>{j.doc_no}</Link></td><td className="small">{j.link ? <Link href={j.link}>{SOURCE_NAMES[j.source_type] ?? j.source_type}</Link> : SOURCE_NAMES[j.source_type] ?? j.source_type}</td>
              <td>{j.branch_code}</td><td className="small">{j.narration}</td><td className="num"><Money v={j.amount} /></td></tr>))}
            {!r.rows.length && <tr><td colSpan={6} className="muted">No journals in these dates.</td></tr>}
          </tbody>
          <tfoot><tr className="tot"><td colSpan={5}>{r.rows.length} journal(s)</td><td className="num"><Money v={total} /></td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
