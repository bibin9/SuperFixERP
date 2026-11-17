import { requireCtx } from "@/lib/session";
import { getJournal, SOURCE_NAMES } from "@/lib/services/financials";
import { Link, Money, PageHead, d, dt } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export default async function Journal({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { journal: j, lines } = await getJournal(ctx, id);
  const dr = lines.reduce((s, l) => s + Number(l.debit), 0), cr = lines.reduce((s, l) => s + Number(l.credit), 0);
  return (
    <>
      <PageHead title={`Journal ${j.doc_no}`} sub={`${SOURCE_NAMES[j.source_type] ?? j.source_type} · ${d(j.journal_date)} · ${j.branch_code} · posted by ${j.posted_by_name ?? "the system"} on ${dt(j.posted_at)}`}>
        {j.link && <Link className="btn ghost" href={j.link}>Open the document</Link>}<PrintButton />
      </PageHead>
      <div className="card">
        <p>{j.narration}</p>
        <table>
          <thead><tr><th>Ledger</th><th>Branch</th><th>Party</th><th>Line note</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td><Link href={`/accounts/ledger?account=${l.code}&from=${j.journal_date}&to=${j.journal_date}`}>{l.code}</Link> {l.name}</td><td>{l.branch_code}</td><td className="small">{l.customer_name ?? l.supplier_name ?? ""}</td><td className="small">{l.narration}</td>
              <td className="num">{Number(l.debit) > 0 && <Money v={l.debit} />}</td><td className="num">{Number(l.credit) > 0 && <Money v={l.credit} />}</td></tr>))}</tbody>
          <tfoot><tr className="tot"><td colSpan={4}>Total</td><td className="num"><Money v={dr} /></td><td className="num"><Money v={cr} /></td></tr></tfoot>
        </table>
        <p className="small muted">Posted journals are never edited or deleted. A correction is a new voucher or a reversal.</p>
      </div>
    </>
  );
}
