import { RecordHistory } from "@/components/RecordHistory";
import { docHistory } from "@/lib/services/history";
import { requireCtx } from "@/lib/session";
import { getVoucher, VOUCHER_TYPES } from "@/lib/services/accounting";
import { Flash, Link, Money, PageHead, Status, d, dt } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export default async function Voucher({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const r = await getVoucher(ctx, id);
  const v = r.voucher;
  return (
    <>
      <PageHead title={`${VOUCHER_TYPES[v.voucher_type]} voucher ${v.doc_no ?? ""}`} sub={`${d(String(v.voucher_date).slice(0, 10))} · ${v.branch_code} · entered by ${v.created_by_name} on ${dt(v.created_at)}`}>
        <Status s={v.status} />{v.journal_id && <Link className="btn ghost" href={`/accounts/journal/${v.journal_id}`}>Journal</Link>}<PrintButton />
      </PageHead>
      <Flash sp={sp} />
      {v.status === "pending_approval" && <div className="flash warn">Waiting for approval. It is not numbered or posted until approved.</div>}
      {v.status === "rejected" && <div className="flash err">Rejected: {v.reject_reason}</div>}
      <div className="card">
        <p>{v.narration}</p>
        <table>
          <thead><tr><th>#</th><th>Ledger</th><th>Party</th><th>Note</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{r.lines.map((l) => <tr key={l.id}><td>{l.line_no}</td><td>{l.code} · {l.name}</td><td className="small">{l.party}</td><td className="small">{l.narration}</td><td className="num">{Number(l.debit) > 0 && <Money v={l.debit} />}</td><td className="num">{Number(l.credit) > 0 && <Money v={l.credit} />}</td></tr>)}</tbody>
          <tfoot><tr className="tot"><td colSpan={4}>Total</td><td className="num"><Money v={v.total} /></td><td className="num"><Money v={v.total} /></td></tr></tfoot>
        </table>
        {r.history?.length > 0 && <><h2 style={{ marginTop: 14 }}>Approval history</h2><ul className="small">{r.history.map((h: { id: string; action: string; full_name: string; at: string; comment?: string }) => <li key={h.id}>{h.action.replace(/_/g, " ")} by {h.full_name ?? "the system"} · {dt(h.at)}{h.comment ? ` · ${h.comment}` : ""}</li>)}</ul></>}
      </div>
      <RecordHistory rows={await docHistory(ctx, "voucher", id)} />
    </>
  );
}
