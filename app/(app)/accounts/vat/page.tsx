import { requireCtx } from "@/lib/session";
import { vat201, BOX_LABEL } from "@/lib/services/billing-more";
import { Link, Money, PageHead, d } from "@/components/ui";
import { can } from "@/lib/access";

const ORDER = ["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"];
const TOTALS = ["8", "11", "12", "13", "14"];
const valid = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

export default async function Vat201({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const from = valid(sp.from) ? sp.from : `${now.slice(0, 8)}01`;
  const to = valid(sp.to) ? sp.to : now;
  const branchId = ctx.allBranches && sp.branch !== "current" ? null : ctx.currentBranchId;
  const r = await vat201(ctx, from, to, branchId);
  const box = ORDER.includes(sp.box ?? "") ? sp.box : null;
  const lines = box ? r.lines.filter((l) => l.box === box) : [];
  const q = (extra: string) => `/accounts/vat?from=${from}&to=${to}${sp.branch ? `&branch=${sp.branch}` : ""}${extra}`;
  const matches = r.boxes["12"].vat === r.ledgerOutput && r.boxes["13"].vat === r.ledgerInput;
  return (
    <>
      <PageHead title="VAT return (VAT 201)" sub={`${branchId ? "Current branch" : "Whole company"} · supplies split by the branch's emirate. Click a box to see the documents behind it.`}>
        {can(ctx, "accounting", "export") && <a className="btn ghost" href={`/api/faf?from=${from}&to=${to}`}>FTA audit file (CSV)</a>}
      </PageHead>
      <div className="card">
        <form className="row">
          <div className="field"><label>From</label><input type="date" name="from" defaultValue={from} /></div>
          <div className="field"><label>To</label><input type="date" name="to" defaultValue={to} /></div>
          {ctx.allBranches && <div className="field"><label>Branches</label><select name="branch" defaultValue={sp.branch ?? ""}><option value="">Whole company</option><option value="current">Current branch only</option></select></div>}
          <div className="shrink"><button className="btn">Show</button></div>
        </form>
      </div>
      <div className="grid2">
        <div className="card">
          <table>
            <thead><tr><th>Box</th><th>Description</th><th className="num">Amount (AED)</th><th className="num">VAT (AED)</th></tr></thead>
            <tbody>{ORDER.map((k) => (
              <tr key={k} className={box === k ? "sel" : ""}><td>{TOTALS.includes(k) ? k : <Link href={q(`&box=${k}`)}>{k}</Link>}</td><td>{TOTALS.includes(k) ? <b>{BOX_LABEL[k]}</b> : BOX_LABEL[k]}</td>
                <td className="num">{["12", "13", "14"].includes(k) ? "" : <Money v={r.boxes[k].amount} />}</td><td className="num">{TOTALS.includes(k) ? <b><Money v={r.boxes[k].vat} /></b> : <Money v={r.boxes[k].vat} />}</td></tr>))}</tbody>
          </table>
          <p className={`small ${matches ? "" : "err"}`} style={{ marginTop: 8 }}>Ledger check: VAT output account <Money v={r.ledgerOutput} />, VAT input account <Money v={r.ledgerInput} />. {matches ? "The return agrees with the ledger." : "The return does not agree with the ledger; check manual journals to the VAT accounts."}</p>
        </div>
        <div className="card">
          <h2>{box ? `Box ${box}: ${BOX_LABEL[box]}` : "Documents"}</h2>
          {!box && <p className="small muted">Choose a box on the left.</p>}
          {box && <table><thead><tr><th>Document</th><th>Date</th><th>Branch</th><th>Party</th><th className="num">Amount</th><th className="num">VAT</th></tr></thead>
            <tbody>{lines.map((l, k) => <tr key={k}><td>{l.link ? <Link href={l.link}>{l.doc_no}</Link> : l.doc_no} <span className="small muted">{l.doc_type}</span></td><td>{d(l.doc_date)}</td><td>{l.branch}</td><td>{l.party}</td>
              <td className="num"><Money v={l.amount} /></td><td className="num"><Money v={l.vat} /></td></tr>)}</tbody></table>}
          {box && !lines.length && <p className="small muted">Nothing in this box for the period.</p>}
        </div>
      </div>
    </>
  );
}
