import { getPublicQuotation } from "@/lib/services/quotations";
import { publicDecisionAction } from "@/app/actions";
import { Money } from "@/components/ui";
import { D } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PublicQuote({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const data = await getPublicQuotation(token);
  if (!data) return <div className="public"><div className="card">This link is not valid.</div></div>;
  const { q, lines, expired } = data;
  const name = q.customer_type === "individual" ? `${q.title} ${q.first_name}` : q.company_name;
  const open = q.status === "sent" && !expired;
  return (
    <div className="public">
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sflogo.png" alt="Superfix" style={{ height: 44 }} />
        <h1 style={{ marginTop: 8 }}>Quotation {q.doc_no}</h1>
        <p className="sub">Dear {name}, here is the work we recommend for {q.make} {q.model} ({q.registered_in} {q.plate_code} {q.plate_number}) at Superfix {q.branch_name}. Prices include 5% VAT.</p>
        {sp.err && <div className="flash err">{sp.err}</div>}
        {sp.done && <div className="flash ok">Thank you. Your answer has been sent to the workshop.</div>}
        {expired && <div className="flash warn">This quotation has expired. Please call {q.branch_phone}.</div>}
        <form action={publicDecisionAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="all_lines" value={lines.filter((l) => l.decision === "pending").map((l) => l.id).join(",")} />
          <table>
            <tbody>{lines.map((l) => (
              <tr key={l.id}>
                <td style={{ width: 36 }}>{l.decision === "pending" && open ? <input type="checkbox" name={`line_${l.id}`} defaultChecked aria-label={`Approve ${l.description}`} /> : l.decision === "approved" ? "✓" : l.decision === "declined" ? "✗" : ""}</td>
                <td>{l.description}<div className="small muted">qty {D(l.qty).toString()}</div></td>
                <td className="num">AED <Money v={l.line_total} /></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td></td><td>Total incl. VAT</td><td className="num">AED <Money v={q.grand_total} /></td></tr></tfoot>
          </table>
          {open && <><p className="small muted">Untick anything you do not want today; we will remind you about it later.</p><button className="btn green" style={{ width: "100%", minHeight: 48 }}>Approve ticked work</button></>}
        </form>
      </div>
    </div>
  );
}
