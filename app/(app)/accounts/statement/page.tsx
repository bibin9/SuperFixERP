import crypto from "node:crypto";
import { requireCtx } from "@/lib/session";
import { partyStatement, finScope } from "@/lib/services/financials";
import { partyOptions } from "@/lib/services/accounting";
import { openingReceiptAction } from "@/app/actions-accounting";
import { masters } from "@/lib/services/masters";
import { withTx } from "@/lib/db";
import { can } from "@/lib/access";
import { Flash, Link, Money, PageHead, d } from "@/components/ui";
import { AccountsTabs } from "@/components/AccountsTabs";
import { FinFilter } from "@/components/FinFilter";
import { branchesParam } from "../page";

type SP = Record<string, string | string[]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

export default async function Statement({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const kind = one(sp.party) === "supplier" ? "supplier" : "customer";
  const pid = one(sp.id);
  const opts = await partyOptions(ctx);
  const r = pid ? await partyStatement(ctx, { party: kind, id: pid, from: one(sp.from), to: one(sp.to), branches: branchesParam(sp).join(",") }) : null;
  const scope = r?.scope ?? (await finScope(ctx, branchesParam(sp)));
  const openingBills = kind === "customer" && pid ? await withTx(ctx, async (c) => (await c.query("SELECT o.*, b.code branch_code, o.amount - o.settled_amount open FROM opening_item o JOIN branch b ON b.id = o.branch_id WHERE o.customer_id = $1 AND o.amount > o.settled_amount ORDER BY due_date", [pid])).rows) : [];
  const m = openingBills.length ? await masters(ctx) : null;
  const list = kind === "customer" ? opts.customers : opts.suppliers;
  return (
    <>
      <PageHead title="Statement of account" sub="Everything posted against one customer or supplier, with the balance after each entry. Print it to send to the party." />
      <AccountsTabs group="books" at="/accounts/statement" />
      <Flash sp={sp as Record<string, string>} />
      <FinFilter scope={scope} mode="range" from={r?.from} to={r?.to}>
        <div className="field"><label>Party type</label><select name="party" defaultValue={kind}><option value="customer">Customer</option><option value="supplier">Supplier</option></select></div>
        <div className="field"><label>{kind === "customer" ? "Customer" : "Supplier"}</label><select name="id" defaultValue={pid}><option value="">Choose…</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select></div>
      </FinFilter>
      {r && (
        <div className="card">
          <h2>{r.party.name} <span className="muted small">{r.party.no}{r.party.trn ? ` · TRN ${r.party.trn}` : ""}</span></h2>
          <p className="small muted">{d(r.from)} to {d(r.to)} · {kind === "customer" ? "a positive balance is owed to us" : "a positive balance is owed by us"}{Number(r.party.credit_limit) > 0 ? ` · credit limit AED ${Number(r.party.credit_limit).toFixed(2)}` : ""}</p>
          <table className="fin">
            <thead><tr><th>Date</th><th>Document</th><th>What</th><th>Branch</th><th>Details</th><th className="num">{kind === "customer" ? "Charged" : "Paid / debit"}</th><th className="num">{kind === "customer" ? "Paid / credit" : "Billed"}</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr className="grp"><td>{d(r.from)}</td><td colSpan={6}>Balance brought forward</td><td className="num"><Money v={r.opening} /></td></tr>
              {r.rows.map((l, k) => (
                <tr key={k}><td>{d(l.journal_date)}</td><td>{l.link ? <Link href={l.link}>{l.ref}</Link> : <Link href={`/accounts/journal/${l.journal_id}`}>{l.ref}</Link>}</td><td className="small">{l.what}</td><td>{l.branch_code}</td><td className="small">{l.narration}</td>
                  <td className="num">{kind === "customer" ? l.debit && <Money v={l.debit} /> : l.credit && <Money v={l.credit} />}</td><td className="num">{kind === "customer" ? l.credit && <Money v={l.credit} /> : l.debit && <Money v={l.debit} />}</td><td className="num"><Money v={l.balance} /></td></tr>))}
              <tr className="tot"><td colSpan={7}>Balance on {d(r.to)}</td><td className="num"><Money v={r.closing} /></td></tr>
            </tbody>
          </table>
        </div>)}
      {openingBills.length > 0 && m && (
        <div className="card no-print"><h2>Bills brought over from Tally</h2>
          {openingBills.map((o) => (
            <form key={o.id} action={openingReceiptAction} className="row" style={{ alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <input type="hidden" name="item_id" value={o.id} /><input type="hidden" name="customer_id" value={pid} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
              <div className="field"><label>Bill</label><div>{o.bill_no} · {o.branch_code} · due {d(String(o.due_date).slice(0, 10))} · open <b><Money v={o.open} /></b></div></div>
              {can(ctx, "invoices", "create", o.branch_id) && (<>
                <div className="field"><label>Method</label><select name="method">{m.paymentMethods.map((pm) => <option key={pm.code} value={pm.code}>{pm.name}</option>)}</select></div>
                <div className="field"><label>Amount</label><input name="amount" defaultValue={Number(o.open).toFixed(2)} inputMode="decimal" /></div>
                <div className="field"><label>Reference</label><input name="reference" /></div>
                <div className="shrink"><button className="btn green">Record receipt</button></div>
              </>)}
            </form>))}
        </div>)}
    </>
  );
}
