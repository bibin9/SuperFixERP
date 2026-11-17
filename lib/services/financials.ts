import { Ctx, assertCan, can, canSee } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { D, Decimal } from "../money";
import { today } from "./stock";
import { str } from "../validate";
import { ymd } from "./accounting";

/** Financial statements and party reports (AC-08, AC-14, AC-15, AC-16). Every query is limited to branches where the user can view accounting. */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const dateOr = (v: unknown, fb: string) => { const s = str(v); if (!s) return fb; if (!isDate(s)) throw invalid("Enter dates as YYYY-MM-DD."); return s; };
const monthFirst = () => `${today().slice(0, 7)}-01`;

export type Scope = { ids: string[]; branches: { id: string; code: string; name_en: string }[]; all: { id: string; code: string; name_en: string }[]; sideBySide: boolean };

/** Branches the user may report on, narrowed to the ones chosen ("all" or a list). */
export async function finScope(ctx: Ctx, sel: string[] | string | undefined, sideBySide = false): Promise<Scope> {
  const rows = await withTx(ctx, async (c) => (await c.query("SELECT id, code, name_en FROM branch WHERE active ORDER BY branch_type <> 'head_office', code")).rows);
  const all = rows.filter((b) => can(ctx, "accounting", "view", b.id));
  if (!all.length) throw forbidden();
  const want = (Array.isArray(sel) ? sel : str(sel) ? str(sel).split(",") : []).filter((x) => x && x !== "all");
  const branches = want.length ? all.filter((b) => want.includes(b.id)) : all;
  if (want.length && branches.length !== want.length) throw forbidden("You cannot report on one of the branches chosen.");
  return { ids: branches.map((b) => b.id), branches, all, sideBySide: sideBySide && branches.length > 1 };
}
const hideBank = (ctx: Ctx, s: Scope) => s.ids.some((b) => !canSee(ctx, "bank_balance", b));

/** Where a journal came from, for drill-down to the voucher or document (AC-08). */
export function sourceLink(type: string, id: string | null) {
  if (!id) return null;
  const m: Record<string, string> = { sales_invoice: `/invoices/${id}`, voucher: `/accounts/vouchers/${id}`, supplier_bill: `/purchasing/bills/${id}`, credit_note: `/billing/credit-notes/${id}`,
    bank_statement: `/accounts/bank/statements/${id}`, stock_transfer: `/stock/transfers/${id}`, transfer_in: `/stock/transfers/${id}`, transfer_out: `/stock/transfers/${id}` };
  return m[type] ?? null;
}
export const SOURCE_NAMES: Record<string, string> = {
  sales_invoice: "Invoice", receipt: "Receipt", advance: "Deposit", advance_application: "Deposit applied", credit_note: "Credit note", cash_session: "Cash closing",
  cheque_cleared: "Cheque cleared", cheque_returned: "Cheque returned", grn: "Goods received", supplier_bill: "Supplier bill", supplier_payment: "Supplier payment",
  cheque_issued_cleared: "Issued cheque cleared", cheque_issued_cancelled: "Issued cheque cancelled", petty_cash: "Petty cash", stock_adjustment: "Stock adjustment",
  stock_issue: "Parts issued to job", transfer_in: "Transfer in", transfer_out: "Transfer out", warranty_claim: "Warranty claim", voucher: "Voucher",
  card_settlement: "Card settlement", bank_statement: "Bank entry", ho_allocation: "Head-office allocation", fixed_asset: "Asset bought", depreciation: "Depreciation",
  asset_disposal: "Asset disposal", opening: "Opening balance", year_end: "Year-end close", payroll: "Payroll",
};

export async function getJournal(ctx: Ctx, id: string) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT j.*, b.code branch_code, u.full_name posted_by_name FROM journal j JOIN branch b ON b.id = j.branch_id LEFT JOIN app_user u ON u.id = j.posted_by WHERE j.id = $1", [id])).rows[0];
    if (!j) throw notFound("Journal");
    const lines = (await c.query(
      `SELECT l.*, a.code, a.name, a.sub_type, b.code branch_code, coalesce(cu.company_name, cu.first_name || ' ' || coalesce(cu.last_name, '')) customer_name, s.name_en supplier_name
         FROM journal_line l JOIN account a ON a.id = l.account_id JOIN branch b ON b.id = l.branch_id
         LEFT JOIN customer cu ON cu.id = l.customer_id LEFT JOIN supplier s ON s.id = l.supplier_id WHERE l.journal_id = $1 ORDER BY l.id`, [id])).rows;
    return { journal: { ...j, journal_date: ymd(j.journal_date), link: sourceLink(j.source_type, j.source_id) }, lines };
  });
}

export async function dayBook(ctx: Ctx, f: { from?: string; to?: string; branches?: string; type?: string }) {
  const s = await finScope(ctx, f.branches);
  const from = dateOr(f.from, today()), to = dateOr(f.to, today());
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT j.id, j.doc_no, j.journal_date, j.source_type, j.source_id, j.narration, b.code branch_code, sum(l.debit) amount
         FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN branch b ON b.id = j.branch_id
        WHERE j.journal_date BETWEEN $1 AND $2 AND l.branch_id = ANY($3) AND ($4 = '' OR j.source_type = $4)
        GROUP BY j.id, b.code ORDER BY j.journal_date, j.posted_at LIMIT 1000`, [from, to, s.ids, str(f.type)])).rows;
    return { scope: s, from, to, rows: rows.map((r) => ({ ...r, journal_date: ymd(r.journal_date), link: sourceLink(r.source_type, r.source_id) })) };
  });
}

/** One ledger with opening balance, running balance and drill-down (AC-15: balance on any date). */
export async function ledgerReport(ctx: Ctx, f: { account?: string; from?: string; to?: string; branches?: string; customer?: string; supplier?: string }) {
  const s = await finScope(ctx, f.branches);
  const from = dateOr(f.from, monthFirst()), to = dateOr(f.to, today());
  if (from > to) throw invalid("The start date is after the end date.");
  return withTx(ctx, async (c) => {
    const accounts = (await c.query("SELECT id, code, name, account_type, sub_type FROM account WHERE active ORDER BY code")).rows;
    const acc = accounts.find((a) => a.id === f.account || a.code === f.account);
    if (!acc) return { scope: s, from, to, accounts, account: null, opening: "0.00", rows: [], closing: "0.00" };
    if (["cash", "bank"].includes(acc.sub_type) && hideBank(ctx, s)) throw forbidden("Your role cannot see bank and cash balances.");
    const args = [acc.id, s.ids, from, to, str(f.customer) || null, str(f.supplier) || null];
    const party = "AND ($5::uuid IS NULL OR l.customer_id = $5) AND ($6::uuid IS NULL OR l.supplier_id = $6)";
    const op = (await c.query(`SELECT coalesce(sum(l.debit - l.credit), 0) v FROM journal_line l JOIN journal j ON j.id = l.journal_id WHERE l.account_id = $1 AND l.branch_id = ANY($2) AND j.journal_date < $3 AND $4::date IS NOT NULL ${party}`, args)).rows[0].v;
    const lines = (await c.query(
      `SELECT j.id journal_id, j.doc_no, j.journal_date, j.source_type, j.source_id, coalesce(l.narration, j.narration) narration, l.debit, l.credit, b.code branch_code,
              coalesce(cu.company_name, cu.first_name || ' ' || coalesce(cu.last_name, ''), s.name_en) party
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN branch b ON b.id = l.branch_id
         LEFT JOIN customer cu ON cu.id = l.customer_id LEFT JOIN supplier s ON s.id = l.supplier_id
        WHERE l.account_id = $1 AND l.branch_id = ANY($2) AND j.journal_date BETWEEN $3 AND $4 ${party}
        ORDER BY j.journal_date, j.posted_at, l.id LIMIT 3000`, args)).rows;
    let bal = D(op);
    const rows = lines.map((l) => { bal = bal.plus(l.debit).minus(l.credit); return { ...l, journal_date: ymd(l.journal_date), balance: bal.toFixed(2), link: sourceLink(l.source_type, l.source_id) }; });
    return { scope: s, from, to, accounts, account: acc, opening: D(op).toFixed(2), rows, closing: bal.toFixed(2),
      debit: lines.reduce((x, l) => x.plus(l.debit), D(0)).toFixed(2), credit: lines.reduce((x, l) => x.plus(l.credit), D(0)).toFixed(2) };
  });
}

type Col = { key: string; label: string };
const colsFor = (s: Scope): Col[] => (s.sideBySide ? [...s.branches.map((b) => ({ key: b.id, label: b.code })), { key: "total", label: "Total" }] : [{ key: "total", label: "Total" }]);
/** Sums by account and branch, then folds into the columns asked for. */
type Acct = { id: string; code: string; name: string; account_type: string; account_group: string; sub_type: string };
function pivot(rows: Row[], s: Scope, value: (r: Row) => Decimal) {
  const out = new Map<string, { account: Acct; v: Record<string, Decimal> }>();
  for (const r of rows) {
    const e = out.get(r.account_id) ?? { account: { id: r.account_id, code: r.code, name: r.name, account_type: r.account_type, account_group: r.account_group, sub_type: r.sub_type }, v: { total: D(0) } as Record<string, Decimal> };
    const n = value(r);
    e.v.total = e.v.total.plus(n);
    if (s.sideBySide) e.v[r.branch_id] = (e.v[r.branch_id] ?? D(0)).plus(n);
    out.set(r.account_id, e);
  }
  return [...out.values()].sort((a, b) => a.account.code.localeCompare(b.account.code));
}
const fmt = (v: Record<string, Decimal>, cols: Col[]) => Object.fromEntries(cols.map((c) => [c.key, (v[c.key] ?? D(0)).toFixed(2)]));
const sumCols = (list: { v: Record<string, Decimal> }[], cols: Col[], sign = 1) => Object.fromEntries(cols.map((c) => [c.key, list.reduce((s, x) => s.plus(x.v[c.key] ?? 0), D(0)).times(sign)]));

/** Trial balance as of any date, one branch, several side by side, or the company total (AC-08, AC-14). */
export async function trialBalanceAsOf(ctx: Ctx, f: { asof?: string; branches?: string; side?: string }) {
  const s = await finScope(ctx, f.branches, f.side === "1");
  const asof = dateOr(f.asof, today());
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT l.account_id, l.branch_id, a.code, a.name, a.account_type, a.account_group, a.sub_type, sum(l.debit) dr, sum(l.credit) cr
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE j.journal_date <= $1 AND l.branch_id = ANY($2) GROUP BY 1,2,3,4,5,6,7`, [asof, s.ids])).rows;
    const hidden = hideBank(ctx, s);
    const cols = colsFor(s);
    const p = pivot(rows.filter((r) => !(hidden && ["cash", "bank"].includes(r.sub_type))), s, (r) => D(r.dr).minus(r.cr));
    const lines = p.filter((x) => Object.values(x.v).some((n) => !n.eq(0))).map((x) => ({ ...x.account, net: fmt(x.v, cols),
      debit: x.v.total.gt(0) ? x.v.total.toFixed(2) : "", credit: x.v.total.lt(0) ? x.v.total.neg().toFixed(2) : "" }));
    const dr = p.reduce((a, x) => a.plus(Decimal.max(x.v.total, 0)), D(0)), cr = p.reduce((a, x) => a.plus(Decimal.max(x.v.total.neg(), 0)), D(0));
    return { scope: s, asof, cols, lines, debit: dr.toFixed(2), credit: cr.toFixed(2), balanced: dr.eq(cr), bankHidden: hidden };
  });
}

/** Profit and loss for a period with branches side by side (AC-08, AC-14). Year-end closing entries are left out. */
export async function profitAndLoss(ctx: Ctx, f: { from?: string; to?: string; branches?: string; side?: string }) {
  const s = await finScope(ctx, f.branches, f.side === "1");
  const from = dateOr(f.from, monthFirst()), to = dateOr(f.to, today());
  if (from > to) throw invalid("The start date is after the end date.");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT l.account_id, l.branch_id, a.code, a.name, a.account_type, a.account_group, a.sub_type, sum(l.debit) dr, sum(l.credit) cr
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE j.journal_date BETWEEN $1 AND $2 AND l.branch_id = ANY($3) AND a.account_type IN ('income','expense') AND j.source_type <> 'year_end'
        GROUP BY 1,2,3,4,5,6,7`, [from, to, s.ids])).rows;
    const cols = colsFor(s);
    const p = pivot(rows, s, (r) => (r.account_type === "income" ? D(r.cr).minus(r.dr) : D(r.dr).minus(r.cr)));
    const inc = p.filter((x) => x.account.account_type === "income"), exp = p.filter((x) => x.account.account_type === "expense");
    const direct = exp.filter((x) => x.account.account_group === "Direct expenses"), indirect = exp.filter((x) => x.account.account_group !== "Direct expenses");
    const ti = sumCols(inc, cols), td = sumCols(direct, cols), tx = sumCols(indirect, cols);
    const gross = Object.fromEntries(cols.map((c) => [c.key, ti[c.key].minus(td[c.key])]));
    const net = Object.fromEntries(cols.map((c) => [c.key, gross[c.key].minus(tx[c.key])]));
    const view = (l: typeof p) => l.map((x) => ({ ...x.account, v: fmt(x.v, cols) }));
    const f2 = (o: Record<string, Decimal>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toFixed(2)]));
    return { scope: s, from, to, cols, income: view(inc), direct: view(direct), indirect: view(indirect), totalIncome: f2(ti), totalDirect: f2(td), totalIndirect: f2(tx), gross: f2(gross), net: f2(net) };
  });
}

/** Balance sheet as of a date; the profit not yet closed to retained earnings is shown as "Profit for the period" (AC-08). */
export async function balanceSheet(ctx: Ctx, f: { asof?: string; branches?: string; side?: string }) {
  const s = await finScope(ctx, f.branches, f.side === "1");
  if (hideBank(ctx, s)) throw forbidden("Your role cannot see bank and cash balances, so the balance sheet is not available.");
  const asof = dateOr(f.asof, today());
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT l.account_id, l.branch_id, a.code, a.name, a.account_type, a.account_group, a.sub_type, sum(l.debit) dr, sum(l.credit) cr
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE j.journal_date <= $1 AND l.branch_id = ANY($2) GROUP BY 1,2,3,4,5,6,7`, [asof, s.ids])).rows;
    const cols = colsFor(s);
    const assets = pivot(rows.filter((r) => r.account_type === "asset"), s, (r) => D(r.dr).minus(r.cr));
    const liab = pivot(rows.filter((r) => r.account_type === "liability"), s, (r) => D(r.cr).minus(r.dr));
    const eq = pivot(rows.filter((r) => r.account_type === "equity"), s, (r) => D(r.cr).minus(r.dr));
    const pl = pivot(rows.filter((r) => ["income", "expense"].includes(r.account_type)), s, (r) => D(r.cr).minus(r.dr));
    const profit = sumCols(pl, cols);
    const ta = sumCols(assets, cols), tl = sumCols(liab, cols), te = sumCols(eq, cols);
    const totalLE = Object.fromEntries(cols.map((c) => [c.key, tl[c.key].plus(te[c.key]).plus(profit[c.key])]));
    const nz = (l: typeof assets) => l.filter((x) => Object.values(x.v).some((n) => !n.eq(0))).map((x) => ({ ...x.account, v: fmt(x.v, cols) }));
    const f2 = (o: Record<string, Decimal>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toFixed(2)]));
    return { scope: s, asof, cols, assets: nz(assets), liabilities: nz(liab), equity: nz(eq), profit: f2(profit), totalAssets: f2(ta), totalLiabilities: f2(tl), totalEquity: f2(te), totalLE: f2(totalLE),
      balanced: cols.every((c) => ta[c.key].eq(totalLE[c.key])) };
  });
}

/** Cash flow, direct method: money into and out of cash and bank ledgers, grouped by what was on the other side. */
export async function cashFlow(ctx: Ctx, f: { from?: string; to?: string; branches?: string }) {
  const s = await finScope(ctx, f.branches);
  if (hideBank(ctx, s)) throw forbidden("Your role cannot see bank and cash balances.");
  const from = dateOr(f.from, monthFirst()), to = dateOr(f.to, today());
  return withTx(ctx, async (c) => {
    const opening = D((await c.query(
      `SELECT coalesce(sum(l.debit - l.credit), 0) v FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE a.sub_type IN ('cash','bank') AND j.journal_date < $1 AND l.branch_id = ANY($2)`, [from, s.ids])).rows[0].v);
    // Each journal's cash movement is spread over its non-cash lines in proportion (the last line takes the rounding), so a mixed entry is classified correctly.
    const lines = (await c.query(
      `SELECT j.id, a.sub_type, a.account_group, a.account_type, a.code, a.name, l.debit, l.credit
         FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id
        WHERE j.journal_date BETWEEN $1 AND $2 AND l.branch_id = ANY($3) ORDER BY j.id, l.id`, [from, to, s.ids])).rows;
    const byJ = new Map<string, Row[]>();
    for (const l of lines) byJ.set(l.id, [...(byJ.get(l.id) ?? []), l]);
    const agg = new Map<string, Row & { v: Decimal }>();
    for (const ls of byJ.values()) {
      const isCash = (l: Row) => ["cash", "bank"].includes(l.sub_type);
      const cash = ls.filter(isCash).reduce((t, l) => t.plus(l.debit).minus(l.credit), D(0));
      const others = ls.filter((l) => !isCash(l));
      const weight = others.reduce((t, l) => t.plus(l.debit).plus(l.credit), D(0));
      if (cash.eq(0) || weight.eq(0)) continue;
      let left = cash;
      others.forEach((l, k) => {
        const part = k === others.length - 1 ? left : cash.times(D(l.debit).plus(l.credit)).div(weight).toDecimalPlaces(2);
        left = left.minus(part);
        const e = agg.get(l.code) ?? { ...l, v: D(0) };
        e.v = e.v.plus(part); agg.set(l.code, e);
      });
    }
    const rows = [...agg.values()].sort((a, b) => a.code.localeCompare(b.code));
    const section = (r: Row) => (r.account_group === "Fixed assets" ? "investing" : ["Capital account", "Reserves and surplus", "Loans"].includes(r.account_group) ? "financing" : "operating");
    const groups: Record<string, { code: string; name: string; v: string }[]> = { operating: [], investing: [], financing: [] };
    const totals: Record<string, Decimal> = { operating: D(0), investing: D(0), financing: D(0) };
    for (const r of rows) { const v = D(r.v).toDecimalPlaces(2); if (v.eq(0)) continue; const k = section(r); groups[k].push({ code: r.code, name: r.name, v: v.toFixed(2) }); totals[k] = totals[k].plus(v); }
    const net = totals.operating.plus(totals.investing).plus(totals.financing);
    const closing = D((await c.query(
      `SELECT coalesce(sum(l.debit - l.credit), 0) v FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE a.sub_type IN ('cash','bank') AND j.journal_date <= $1 AND l.branch_id = ANY($2)`, [to, s.ids])).rows[0].v);
    return { scope: s, from, to, opening: opening.toFixed(2), groups, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)])), net: net.toFixed(2), closing: closing.toFixed(2),
      rounding: closing.minus(opening).minus(net).toFixed(2) };
  });
}

// =====================================================================================
// Receivables and payables by branch with ageing, credit limit and overdue (AC-16)
// =====================================================================================

export const BUCKETS = [["not_due", "Not due"], ["d30", "1-30"], ["d60", "31-60"], ["d90", "61-90"], ["d120", "91-120"], ["over", "Over 120"]] as const;
const bucketSql = (asof: string) => `CASE WHEN due_date >= '${asof}'::date THEN 'not_due' WHEN '${asof}'::date - due_date <= 30 THEN 'd30' WHEN '${asof}'::date - due_date <= 60 THEN 'd60'
  WHEN '${asof}'::date - due_date <= 90 THEN 'd90' WHEN '${asof}'::date - due_date <= 120 THEN 'd120' ELSE 'over' END`;

export async function receivablesAgeing(ctx: Ctx, f: { asof?: string; branches?: string; overdue?: string }) {
  const s = await finScope(ctx, f.branches);
  const asof = dateOr(f.asof, today());
  return withTx(ctx, async (c) => {
    const items = (await c.query(
      `WITH open_items AS (
         SELECT i.branch_id, i.customer_id, i.due_date, i.grand_total - i.paid_amount - i.credited_amount open FROM sales_invoice i
          WHERE i.status = 'posted' AND i.grand_total - i.paid_amount - i.credited_amount > 0 AND i.doc_date <= $1
         UNION ALL
         SELECT o.branch_id, o.customer_id, o.due_date, o.amount - o.settled_amount FROM opening_item o WHERE o.party_type = 'customer' AND o.amount > o.settled_amount)
       SELECT oi.branch_id, b.code branch_code, oi.customer_id, cu.customer_no, coalesce(cu.company_name, cu.first_name || ' ' || coalesce(cu.last_name, '')) name, cu.credit_limit, cu.payment_terms_days,
              ${bucketSql(asof)} bucket, sum(oi.open) amount
         FROM open_items oi JOIN customer cu ON cu.id = oi.customer_id JOIN branch b ON b.id = oi.branch_id
        WHERE oi.branch_id = ANY($2) GROUP BY 1,2,3,4,5,6,7,8`, [asof, s.ids])).rows;
    const held = (await c.query("SELECT customer_id, sum(amount - used_amount) v FROM customer_advance WHERE branch_id = ANY($1) AND amount > used_amount GROUP BY 1", [s.ids])).rows;
    const heldMap = new Map(held.map((h) => [h.customer_id, D(h.v)]));
    return { scope: s, asof, ...ageingRows(items, (r) => ({ customer_id: r.customer_id, no: r.customer_no, credit_limit: r.credit_limit, terms: r.payment_terms_days }), heldMap, f.overdue === "1") };
  });
}

export async function payablesAgeing(ctx: Ctx, f: { asof?: string; branches?: string; overdue?: string }) {
  const s = await finScope(ctx, f.branches);
  const asof = dateOr(f.asof, today());
  return withTx(ctx, async (c) => {
    const items = (await c.query(
      `WITH open_items AS (
         SELECT sb.branch_id, sb.supplier_id, coalesce(sb.due_date, sb.invoice_date) due_date, sb.grand_total - sb.paid_amount open FROM supplier_bill sb
          WHERE sb.status = 'posted' AND sb.grand_total > sb.paid_amount AND sb.invoice_date <= $1
         UNION ALL
         SELECT o.branch_id, o.supplier_id, o.due_date, o.amount - o.settled_amount FROM opening_item o WHERE o.party_type = 'supplier' AND o.amount > o.settled_amount)
       SELECT oi.branch_id, b.code branch_code, oi.supplier_id, s.code supplier_code, s.name_en name, s.credit_limit, s.payment_terms_days, ${bucketSql(asof)} bucket, sum(oi.open) amount
         FROM open_items oi JOIN supplier s ON s.id = oi.supplier_id JOIN branch b ON b.id = oi.branch_id
        WHERE oi.branch_id = ANY($2) GROUP BY 1,2,3,4,5,6,7,8`, [asof, s.ids])).rows;
    const credit = (await c.query("SELECT supplier_id, sum(on_account) v FROM supplier_payment WHERE branch_id = ANY($1) AND on_account > 0 AND (cheque_status IS NULL OR cheque_status <> 'cancelled') GROUP BY 1", [s.ids])).rows;
    return { scope: s, asof, ...ageingRows(items, (r) => ({ supplier_id: r.supplier_id, no: r.supplier_code, credit_limit: r.credit_limit, terms: r.payment_terms_days }), new Map(credit.map((h) => [h.supplier_id, D(h.v)])), f.overdue === "1") };
  });
}

export type AgeRow = { customer_id?: string; supplier_id?: string; name: string; no: string; b: Record<string, string>; total: string; overdue: string; held: string; credit_limit: string; available: string; over_limit: boolean };
function ageingRows(items: Row[], party: (r: Row) => Row, held: Map<string, Decimal>, overdueOnly: boolean) {
  const byBranch = new Map<string, { code: string; parties: Map<string, Row> }>();
  for (const r of items) {
    const br = byBranch.get(r.branch_id) ?? { code: r.branch_code, parties: new Map() };
    const pid = r.customer_id ?? r.supplier_id;
    const p = br.parties.get(pid) ?? { ...party(r), name: r.name, b: Object.fromEntries(BUCKETS.map(([k]) => [k, D(0)])), total: D(0) };
    p.b[r.bucket] = p.b[r.bucket].plus(r.amount); p.total = p.total.plus(r.amount);
    br.parties.set(pid, p); byBranch.set(r.branch_id, br);
  }
  const grand = Object.fromEntries(BUCKETS.map(([k]) => [k, D(0)])) as Record<string, Decimal>;
  let total = D(0), overdue = D(0);
  const branches = [...byBranch.values()].sort((a, b) => a.code.localeCompare(b.code)).map((br) => {
    const sub = Object.fromEntries(BUCKETS.map(([k]) => [k, D(0)])) as Record<string, Decimal>;
    let bt = D(0);
    const parties = [...br.parties.values()].map((p) => {
      const od = p.total.minus(p.b.not_due);
      const limit = D(p.credit_limit ?? 0);
      return { ...p, b: Object.fromEntries(Object.entries(p.b).map(([k, v]) => [k, (v as Decimal).toFixed(2)])), total: p.total.toFixed(2), overdue: od.toFixed(2), od,
        held: (held.get(p.customer_id ?? p.supplier_id) ?? D(0)).toFixed(2), credit_limit: limit.toFixed(2), available: limit.gt(0) ? limit.minus(p.total).toFixed(2) : "", over_limit: limit.gt(0) && p.total.gt(limit) };
    }).filter((p) => !overdueOnly || p.od.gt(0)).sort((a, b) => D(b.total).cmp(a.total)).map((p) => {
      for (const [k] of BUCKETS) sub[k] = sub[k].plus(p.b[k]);
      bt = bt.plus(p.total); overdue = overdue.plus(p.od);
      const { od: _od, ...rest } = p; void _od; return rest as unknown as AgeRow;
    });
    for (const [k] of BUCKETS) grand[k] = grand[k].plus(sub[k]);
    total = total.plus(bt);
    return { code: br.code, parties, sub: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, v.toFixed(2)])), total: bt.toFixed(2) };
  }).filter((b) => b.parties.length);
  return { branches, grand: Object.fromEntries(Object.entries(grand).map(([k, v]) => [k, v.toFixed(2)])), total: total.toFixed(2), overdue: overdue.toFixed(2) };
}

/** Statement of account for a customer or supplier: opening balance, every entry on the party, closing balance. */
export async function partyStatement(ctx: Ctx, f: { party: "customer" | "supplier"; id: string; from?: string; to?: string; branches?: string }) {
  const s = await finScope(ctx, f.branches);
  const from = dateOr(f.from, `${today().slice(0, 4)}-01-01`), to = dateOr(f.to, today());
  return withTx(ctx, async (c) => {
    const col = f.party === "customer" ? "customer_id" : "supplier_id";
    const p = f.party === "customer"
      ? (await c.query("SELECT id, customer_no no, coalesce(company_name, first_name || ' ' || coalesce(last_name, '')) name, trn, credit_limit, payment_terms_days FROM customer WHERE id = $1", [f.id])).rows[0]
      : (await c.query("SELECT id, code no, name_en name, trn, credit_limit, payment_terms_days FROM supplier WHERE id = $1", [f.id])).rows[0];
    if (!p) throw notFound(f.party === "customer" ? "Customer" : "Supplier");
    const sign = f.party === "customer" ? "l.debit - l.credit" : "l.credit - l.debit";
    const op = D((await c.query(`SELECT coalesce(sum(${sign}), 0) v FROM journal_line l JOIN journal j ON j.id = l.journal_id WHERE l.${col} = $1 AND l.branch_id = ANY($2) AND j.journal_date < $3`, [f.id, s.ids, from])).rows[0].v);
    const lines = (await c.query(
      `SELECT j.id journal_id, j.doc_no, j.journal_date, j.source_type, j.source_id, coalesce(l.narration, j.narration) narration, b.code branch_code, a.code account_code, ${sign} amt
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN branch b ON b.id = l.branch_id JOIN account a ON a.id = l.account_id
        WHERE l.${col} = $1 AND l.branch_id = ANY($2) AND j.journal_date BETWEEN $3 AND $4 ORDER BY j.journal_date, j.posted_at, l.id`, [f.id, s.ids, from, to])).rows;
    // Source document numbers make the statement readable for the customer.
    const docs = new Map((await c.query(
      `SELECT id, doc_no FROM sales_invoice WHERE id = ANY($1) UNION ALL SELECT id, doc_no FROM receipt WHERE id = ANY($1) UNION ALL SELECT id, doc_no FROM credit_note WHERE id = ANY($1) AND doc_no IS NOT NULL
       UNION ALL SELECT id, doc_no FROM supplier_bill WHERE id = ANY($1) UNION ALL SELECT id, doc_no FROM supplier_payment WHERE id = ANY($1) UNION ALL SELECT id, doc_no FROM voucher WHERE id = ANY($1) AND doc_no IS NOT NULL`,
      [lines.map((l) => l.source_id).filter(Boolean)])).rows.map((r) => [r.id, r.doc_no]));
    let bal = op;
    const rows = lines.map((l) => { const a = D(l.amt); bal = bal.plus(a); return { ...l, journal_date: ymd(l.journal_date), ref: docs.get(l.source_id) ?? l.doc_no, what: SOURCE_NAMES[l.source_type] ?? l.source_type,
      debit: a.gt(0) ? a.toFixed(2) : "", credit: a.lt(0) ? a.neg().toFixed(2) : "", balance: bal.toFixed(2), link: sourceLink(l.source_type, l.source_id) }; });
    return { scope: s, from, to, party: p, kind: f.party, opening: op.toFixed(2), rows, closing: bal.toFixed(2) };
  });
}

/** Budget against actual for a branch and year (AC-12), and ledger balances on a date with drill-down (AC-15) reuse the functions above. */
export { can };
