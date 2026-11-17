import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Ctx, assertCan, can, roleAt } from "../access";
import { withTx } from "../db";
import { invalid, notFound, forbidden, conflict } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal, type PostLine } from "./ledger";
import { getSetting } from "./settings";
import { registerHandler, submitForApproval } from "./workflow";
import { stockIn, stockOut, today } from "./stock";
import { D, Decimal, parseDec, r2 } from "../money";
import { optStr, str } from "../validate";
import { billToName, invoiceKindFor, maybeCloseJob, receiptTx, type PayIn } from "./billing";
import { setStatus } from "./jobs";

/** M11 credit notes and cash closing, M09 counter sales, and VAT reporting (FSD 4.9, 4.11, 5.1, 5.6). */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (ctx: Ctx) => { if (!ctx.currentBranchId) throw invalid("Choose a branch first."); return ctx.currentBranchId; };
const ymd = (v: unknown) => (v instanceof Date ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(v) : String(v ?? "").slice(0, 10));

// =====================================================================================
// Credit notes (IV-05) and sales returns (SL-04)
// =====================================================================================

export type CnLineIn = { invoice_line_id: string; qty?: unknown; amount?: unknown; stock_action?: string };

/**
 * A credit note against a posted invoice: chosen lines by quantity (or a lower amount), a reason,
 * and for parts whether the goods come back into stock or are scrapped. It cannot exceed what is
 * left to credit on each line. It goes through the credit note workflow; nothing posts before
 * approval. The number is given when it posts.
 */
export async function createCreditNote(ctx: Ctx, invoiceId: string, f: { reason: string; note?: string; lines: CnLineIn[] }) {
  const reason = str(f.reason);
  return withTx(ctx, async (c) => {
    const inv = (await c.query("SELECT * FROM sales_invoice WHERE id = $1 FOR UPDATE", [invoiceId])).rows[0];
    if (!inv) throw notFound("Invoice");
    assertCan(ctx, "invoices", "create", inv.branch_id);
    if (!(await c.query("SELECT 1 FROM lookup_value WHERE list = 'credit_note_reason' AND code = $1 AND active", [reason])).rowCount) throw invalid("Choose a reason.");
    if (reason === "other" && !str(f.note)) throw invalid("Describe the reason.");
    const pending = await c.query("SELECT 1 FROM credit_note WHERE invoice_id = $1 AND status = 'pending_approval'", [invoiceId]);
    if (pending.rowCount) throw invalid("A credit note for this invoice is already waiting for approval.");
    const prepared: { l: Row; qty: Decimal; taxable: Decimal; vat: Decimal; action: string }[] = [];
    for (const x of f.lines) {
      if (!str(x.qty) && !str(x.amount)) continue;
      const l = (await c.query("SELECT * FROM sales_invoice_line WHERE id = $1 AND invoice_id = $2", [x.invoice_line_id, invoiceId])).rows[0];
      if (!l) throw invalid("A line is not on this invoice.");
      const qtyLeft = D(l.qty).minus(l.credited_qty);
      const amtLeft = D(l.taxable_amount).minus(l.credited_amount);
      const qty = str(x.qty) ? parseDec(x.qty, "Quantity", { min: "0.001", dp: 3 }) : qtyLeft;
      if (qty.gt(qtyLeft)) throw invalid(`Line ${l.line_no}: at most ${qtyLeft.toString()} can be credited.`);
      let taxable = str(x.amount) ? parseDec(x.amount, "Amount", { min: "0.01", dp: 2 }) : r2(D(l.taxable_amount).mul(qty).div(l.qty));
      if (qty.eq(qtyLeft) && !str(x.amount)) taxable = amtLeft; // the last credit takes what is left, so rounding never strands a fil
      if (taxable.gt(amtLeft)) throw invalid(`Line ${l.line_no}: at most AED ${amtLeft.toFixed(2)} before VAT can be credited.`);
      const vatLeft = D(l.vat_amount).minus((await c.query(
        "SELECT coalesce(sum(cl.vat_amount),0) v FROM credit_note_line cl JOIN credit_note cn ON cn.id = cl.credit_note_id WHERE cl.invoice_line_id = $1 AND cn.status = 'posted'", [l.id])).rows[0].v);
      const vat = taxable.eq(amtLeft) ? vatLeft : r2(taxable.mul(l.vat_rate));
      const action = str(x.stock_action) || "none";
      if (!["none", "restock", "scrap"].includes(action)) throw invalid("Choose what happens to the goods.");
      if (action !== "none" && !l.item_id) throw invalid(`Line ${l.line_no} is not a stock item.`);
      prepared.push({ l, qty, taxable, vat, action });
    }
    if (!prepared.length) throw invalid("Enter a quantity or amount on at least one line.");
    const taxable = prepared.reduce((s, p) => s.plus(p.taxable), D(0));
    const vat = prepared.reduce((s, p) => s.plus(p.vat), D(0));
    const total = taxable.plus(vat);
    const room = D(inv.grand_total).minus(inv.credited_amount);
    if (total.gt(room)) throw invalid(`The credit note cannot exceed AED ${room.toFixed(2)} left on the invoice.`);
    const cn = (await c.query(
      `INSERT INTO credit_note (branch_id, invoice_id, customer_id, reason, note, taxable_total, vat_total, grand_total, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [inv.branch_id, invoiceId, inv.customer_id, reason, optStr(f.note), taxable.toFixed(2), vat.toFixed(2), total.toFixed(2), ctx.userId])).rows[0];
    for (const p of prepared) {
      await c.query("INSERT INTO credit_note_line (credit_note_id, branch_id, invoice_line_id, qty, taxable_amount, vat_amount, line_total, stock_action) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [cn.id, inv.branch_id, p.l.id, p.qty.toFixed(3), p.taxable.toFixed(2), p.vat.toFixed(2), p.taxable.plus(p.vat).toFixed(2), p.action]);
    }
    await audit(c, ctx, "credit_note", cn.id, "requested", { invoice: inv.doc_no, total: total.toFixed(2), reason }, inv.branch_id);
    const r = await submitForApproval(c, ctx, { docType: "credit_note", docId: cn.id, docRef: `Credit for ${inv.doc_no}`, branchId: inv.branch_id, amount: total.toFixed(2), summary: { invoice: inv.doc_no, reason } });
    if (r.status === "approved") await postCreditNote(c, ctx, cn.id);
    return { id: cn.id as string, status: r.status === "approved" ? "posted" : "pending_approval" };
  });
}

/**
 * Posts an approved credit note in its own period: Dr sales and output VAT, Cr the customer's open
 * amount; anything above what is still owed is held for the customer. Restocked parts come back at
 * the cost they went out at; scrapped parts stay in cost of sales.
 */
async function postCreditNote(c: PoolClient, ctx: Ctx, id: string) {
  const cn = (await c.query("SELECT * FROM credit_note WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cn || cn.status !== "pending_approval") return;
  const inv = (await c.query("SELECT * FROM sales_invoice WHERE id = $1 FOR UPDATE", [cn.invoice_id])).rows[0];
  const lines = (await c.query(
    "SELECT cl.*, il.line_type, il.item_id, il.qty inv_qty, il.cost_value, il.credited_qty, il.credited_amount, il.taxable_amount inv_taxable, il.job_line_id FROM credit_note_line cl JOIN sales_invoice_line il ON il.id = cl.invoice_line_id WHERE cl.credit_note_id = $1 FOR UPDATE OF il", [id])).rows;
  for (const l of lines) {
    if (D(l.credited_qty).plus(l.qty).gt(l.inv_qty) || D(l.credited_amount).plus(l.taxable_amount).gt(l.inv_taxable)) throw conflict("The invoice was credited in the meantime. Make the credit note again.");
  }
  const docNo = await nextDocNo(c, cn.branch_id, "credit_note");
  const date = today();
  const total = D(cn.grand_total);
  const open = Decimal.max(D(inv.grand_total).minus(inv.paid_amount).minus(inv.credited_amount), 0);
  const toReceivable = Decimal.min(total, open);
  const toAdvance = total.minus(toReceivable);
  const labour = lines.filter((l) => ["labour", "outside"].includes(l.line_type)).reduce((s, l) => s.plus(l.taxable_amount), D(0));
  const parts = D(cn.taxable_total).minus(labour);
  let restockCost = D(0);
  for (const l of lines.filter((x) => x.stock_action === "restock")) {
    const unitCost = D(l.inv_qty).gt(0) ? D(l.cost_value).div(l.inv_qty) : D(0);
    const r = await stockIn(c, ctx, { branchId: cn.branch_id, itemId: l.item_id, qty: D(l.qty), unitCost: unitCost.toDecimalPlaces(4), moveType: "return", ref: docNo });
    restockCost = restockCost.plus(r.value);
  }
  const jl: PostLine[] = [
    { event: "sales_labour", debit: labour },
    { event: "sales_parts", debit: parts },
    { event: "vat_output", debit: D(cn.vat_total) },
    { event: "trade_receivable", credit: toReceivable, customerId: cn.customer_id },
    { event: "customer_advances", credit: toAdvance, customerId: cn.customer_id },
    { event: "inventory", debit: restockCost },
    { event: "cost_of_sales", credit: restockCost },
  ];
  const jr = await postJournal(c, ctx, { branchId: cn.branch_id, date, sourceType: "credit_note", sourceId: id, narration: `Credit note ${docNo} against ${inv.doc_no}`, lines: jl });
  for (const l of lines) await c.query("UPDATE sales_invoice_line SET credited_qty = credited_qty + $2, credited_amount = credited_amount + $3 WHERE id = $1", [l.invoice_line_id, l.qty, l.taxable_amount]);
  await c.query("UPDATE sales_invoice SET credited_amount = credited_amount + $2 WHERE id = $1", [inv.id, toReceivable.toFixed(2)]);
  // The part paid already and now credited is held for the customer: the invoice counts it as credited too.
  if (toAdvance.gt(0)) {
    await c.query("UPDATE sales_invoice SET paid_amount = paid_amount - $2, credited_amount = credited_amount + $2 WHERE id = $1", [inv.id, toAdvance.toFixed(2)]);
    await c.query("INSERT INTO customer_advance (branch_id, customer_id, job_card_id, source, source_id, source_no, amount) VALUES ($1,$2,$3,'credit_note',$4,$5,$6)",
      [cn.branch_id, cn.customer_id, inv.job_card_id, id, docNo, toAdvance.toFixed(2)]);
  }
  await c.query("UPDATE credit_note SET status = 'posted', doc_no = $2, doc_date = $3, journal_id = $4, posted_at = now() WHERE id = $1", [id, docNo, date, jr?.id ?? null]);
  await audit(c, ctx, "credit_note", id, "posted", { doc_no: docNo, total: total.toFixed(2), to_customer_account: toAdvance.toFixed(2) }, cn.branch_id);
  if (inv.job_card_id) await maybeCloseJob(c, ctx, inv.job_card_id);
}

registerHandler("credit_note", {
  onApproved: async (c, ctx, req) => postCreditNote(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req, comment) => {
    await c.query("UPDATE credit_note SET status = 'rejected', note = coalesce(note || ' · ', '') || 'Rejected: ' || $2 WHERE id = $1 AND status = 'pending_approval'", [req.doc_id, comment]);
  },
});

export async function listCreditNotes(ctx: Ctx) {
  assertCan(ctx, "invoices", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT cn.*, i.doc_no invoice_no, i.bill_to_name, b.code branch_code, lv.name_en reason_name FROM credit_note cn JOIN sales_invoice i ON i.id = cn.invoice_id
       JOIN branch b ON b.id = cn.branch_id LEFT JOIN lookup_value lv ON lv.list = 'credit_note_reason' AND lv.code = cn.reason ORDER BY cn.created_at DESC LIMIT 300`)).rows);
}

export async function getCreditNote(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const cn = (await c.query(
      `SELECT cn.*, i.doc_no invoice_no, i.doc_date invoice_date, i.bill_to_name, i.customer_trn, i.invoice_kind, b.code branch_code, b.name_en branch_name, b.address branch_address,
              co.legal_name_en, co.trn company_trn, lv.name_en reason_name, u.full_name created_by_name
         FROM credit_note cn JOIN sales_invoice i ON i.id = cn.invoice_id JOIN branch b ON b.id = cn.branch_id CROSS JOIN LATERAL (SELECT * FROM company LIMIT 1) co
         LEFT JOIN lookup_value lv ON lv.list = 'credit_note_reason' AND lv.code = cn.reason LEFT JOIN app_user u ON u.id = cn.created_by WHERE cn.id = $1`, [id])).rows[0];
    if (!cn) throw notFound("Credit note");
    assertCan(ctx, "invoices", "view", cn.branch_id);
    const lines = (await c.query(
      "SELECT cl.*, il.line_no, il.description, il.vat_code, il.vat_rate, il.unit_price FROM credit_note_line cl JOIN sales_invoice_line il ON il.id = cl.invoice_line_id WHERE cl.credit_note_id = $1 ORDER BY il.line_no", [id])).rows;
    return { cn, lines };
  });
}

// =====================================================================================
// Daily cash closing (PY-03, FSD 5.6)
// =====================================================================================

async function dayTotals(c: PoolClient, branchId: string, cashierId: string, date: string) {
  const r = (await c.query(
    `SELECT coalesce(sum(r.amount) FILTER (WHERE pm.posting_event = 'cash_drawer'),0) cash, coalesce(sum(r.amount) FILTER (WHERE pm.posting_event = 'card_clearing'),0) card,
            count(*) FILTER (WHERE pm.posting_event = 'cash_drawer') cash_n, count(*) FILTER (WHERE pm.posting_event = 'card_clearing') card_n
       FROM receipt r JOIN payment_method pm ON pm.code = r.method WHERE r.branch_id = $1 AND r.posted_by = $2 AND r.doc_date = $3`, [branchId, cashierId, date])).rows[0];
  return { cash: D(r.cash), card: D(r.card), cashCount: Number(r.cash_n), cardCount: Number(r.card_n) };
}

export async function cashToday(ctx: Ctx) {
  const b = here(ctx);
  assertCan(ctx, "invoices", "create", b);
  return withTx(ctx, async (c) => {
    const date = today();
    const t = await dayTotals(c, b, ctx.userId, date);
    const session = (await c.query("SELECT * FROM cash_session WHERE branch_id = $1 AND cashier_id = $2 AND session_date = $3", [b, ctx.userId, date])).rows[0] ?? null;
    const denoms = await getSetting<number[]>(c, "cash.denominations", b, [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25]);
    const tol = String(await getSetting(c, "cash.variance_tolerance", b, 5));
    return { date, cash: t.cash.toFixed(2), card: t.card.toFixed(2), cashCount: t.cashCount, cardCount: t.cardCount, session, denoms, tolerance: tol };
  });
}

/** The cashier counts the drawer. Expected = float + cash receipts − cash refunds − cash handed over. */
export async function submitCashClose(ctx: Ctx, f: { opening_float?: unknown; handed_over?: unknown; counts: Record<string, unknown>; card_batch_total?: unknown; note?: string }) {
  const b = here(ctx);
  assertCan(ctx, "invoices", "create", b);
  return withTx(ctx, async (c) => {
    const date = today();
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cash:${b}:${ctx.userId}:${date}`]);
    if ((await c.query("SELECT 1 FROM cash_session WHERE branch_id = $1 AND cashier_id = $2 AND session_date = $3", [b, ctx.userId, date])).rowCount) throw invalid("Today's cash is already closed.");
    const t = await dayTotals(c, b, ctx.userId, date);
    const float = str(f.opening_float) ? parseDec(f.opening_float, "Opening float", { min: 0, dp: 2 }) : D(0);
    const handed = str(f.handed_over) ? parseDec(f.handed_over, "Cash handed over", { min: 0, dp: 2 }) : D(0);
    const denoms = await getSetting<number[]>(c, "cash.denominations", b, []);
    let counted = D(0);
    const counts: Record<string, number> = {};
    for (const d of denoms) {
      const v = f.counts[String(d)];
      if (!str(v)) continue;
      const n = parseDec(v, `Count of ${d}`, { min: 0, dp: 0 });
      counts[String(d)] = n.toNumber();
      counted = counted.plus(n.mul(d));
    }
    const expected = float.plus(t.cash).minus(handed);
    const variance = counted.minus(expected);
    const tol = D(await getSetting(c, "cash.variance_tolerance", b, 5));
    if (variance.abs().gt(tol) && !str(f.note)) throw invalid(`The count is AED ${variance.toFixed(2)} ${variance.lt(0) ? "short" : "over"}. Write a note explaining the difference.`);
    const batch = str(f.card_batch_total) ? parseDec(f.card_batch_total, "Card terminal batch total", { min: 0, dp: 2 }) : null;
    const s = await c.query(
      `INSERT INTO cash_session (branch_id, cashier_id, session_date, opening_float, cash_receipts, handed_over, expected_cash, counted_cash, denominations, card_expected, card_batch_total, variance, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [b, ctx.userId, date, float.toFixed(2), t.cash.toFixed(2), handed.toFixed(2), expected.toFixed(2), counted.toFixed(2), JSON.stringify(counts), t.card.toFixed(2), batch?.toFixed(2) ?? null,
        variance.toFixed(2), optStr(f.note)]);
    await audit(c, ctx, "cash_session", s.rows[0].id, "submitted", { expected: expected.toFixed(2), counted: counted.toFixed(2), variance: variance.toFixed(2) }, b);
    return { id: s.rows[0].id as string, variance: variance.toFixed(2) };
  });
}

/** The branch manager signs the day off (never their own); a difference posts to cash over and short. */
export async function signOffCash(ctx: Ctx, id: string, note?: string) {
  return withTx(ctx, async (c) => {
    const s = (await c.query("SELECT * FROM cash_session WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!s) throw notFound("Cash closing");
    if (!can(ctx, "invoices", "approve", s.branch_id)) throw forbidden("Only a manager can sign off cash.");
    if (s.cashier_id === ctx.userId) throw forbidden("You cannot sign off your own cash.");
    if (s.status !== "submitted") throw invalid("Already signed off.");
    const v = D(s.variance);
    const jr = await postJournal(c, ctx, {
      branchId: s.branch_id, date: today(), sourceType: "cash_session", sourceId: id, narration: `Cash closing ${ymd(s.session_date)} difference`,
      lines: v.lt(0) ? [{ event: "cash_over_short", debit: v.abs() }, { event: "cash_drawer", credit: v.abs() }] : [{ event: "cash_drawer", debit: v }, { event: "cash_over_short", credit: v }],
    });
    await c.query("UPDATE cash_session SET status = 'signed_off', signed_by = $2, signed_at = now(), sign_note = $3, journal_id = $4 WHERE id = $1", [id, ctx.userId, optStr(note), jr?.id ?? null]);
    await audit(c, ctx, "cash_session", id, "signed_off", { variance: v.toFixed(2) }, s.branch_id);
  });
}

export async function listCashSessions(ctx: Ctx) {
  assertCan(ctx, "invoices", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT s.*, u.full_name cashier, sb.full_name signed_by_name, b.code branch_code FROM cash_session s JOIN app_user u ON u.id = s.cashier_id
       LEFT JOIN app_user sb ON sb.id = s.signed_by JOIN branch b ON b.id = s.branch_id ORDER BY s.session_date DESC, s.submitted_at DESC LIMIT 200`)).rows);
}

// =====================================================================================
// Counter sales (SL-01, SL-03, SL-05)
// =====================================================================================

/** Price for a customer: their price level's list (within dates), else the item's list price (net of VAT). */
async function priceFor(c: PoolClient, itemId: string, level: string) {
  const it = (await c.query("SELECT i.*, t.rate FROM item i JOIN tax_code t ON t.code = i.vat_code WHERE i.id = $1 AND i.active", [itemId])).rows[0];
  if (!it) throw invalid("Choose an item.");
  const pl = (await c.query(
    `SELECT price, min_price FROM price_list_line WHERE item_id = $1 AND price_level = $2 AND active
        AND (valid_from IS NULL OR valid_from <= (now() AT TIME ZONE 'Asia/Dubai')::date) AND (valid_to IS NULL OR valid_to >= (now() AT TIME ZONE 'Asia/Dubai')::date) LIMIT 1`,
    [itemId, level])).rows[0];
  return { item: it, net: D(pl?.price ?? it.list_price), min: pl?.min_price != null ? D(pl.min_price) : null, rate: D(it.rate) };
}

export async function counterSaleSetup(ctx: Ctx, customerId?: string | null) {
  const b = here(ctx);
  assertCan(ctx, "invoices", "create", b);
  return withTx(ctx, async (c) => {
    const cust = customerId ? (await c.query("SELECT * FROM customer WHERE id = $1 AND active", [customerId])).rows[0] : (await c.query("SELECT * FROM customer WHERE is_walk_in")).rows[0];
    if (!cust) throw notFound("Customer");
    const inclusive = await getSetting<unknown>(c, "sales.prices_include_vat", b, true);
    const items = (await c.query(
      `SELECT i.id, i.part_no, i.description, i.vat_code, t.rate, coalesce(pl.price, i.list_price) net, coalesce(sb.on_hand,0) - coalesce(sb.committed,0) - coalesce(sb.reserved,0) free
         FROM item i JOIN tax_code t ON t.code = i.vat_code LEFT JOIN price_list_line pl ON pl.item_id = i.id AND pl.price_level = $2 AND pl.active
         LEFT JOIN stock_balance sb ON sb.item_id = i.id AND sb.branch_id = $1 WHERE i.active AND i.item_type IN ('stock','consumable') ORDER BY i.part_no`, [b, cust.price_level])).rows;
    return { customer: cust, billTo: billToName(cust), inclusive: inclusive === true || inclusive === "true", items };
  });
}

export type SaleLineIn = { item_id: string; qty: unknown; price?: unknown; discount?: unknown };

/**
 * Counter sale (SL-01): price from the customer's level, discount within the role limit, only the
 * branch's own free stock (committed stock is refused with the job number), a tax or simplified
 * invoice posted at once, and the payment taken in the same step.
 */
export async function postCounterSale(ctx: Ctx, f: { customer_id?: string | null; bill_to_name?: string; lines: SaleLineIn[]; payment?: (PayIn & { amount: unknown }) | null; idempotency_key: string }) {
  const b = here(ctx);
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  return withTx(ctx, async (c) => {
    assertCan(ctx, "invoices", "create", b);
    const prior = (await c.query("SELECT id, doc_no FROM sales_invoice WHERE idempotency_key = $1", [f.idempotency_key])).rows[0];
    if (prior) return { id: prior.id as string, docNo: prior.doc_no as string, duplicate: true };
    const cust = f.customer_id ? (await c.query("SELECT * FROM customer WHERE id = $1 AND active", [f.customer_id])).rows[0] : (await c.query("SELECT * FROM customer WHERE is_walk_in")).rows[0];
    if (!cust) throw invalid("Choose the customer.");
    const inclusiveSetting = await getSetting<unknown>(c, "sales.prices_include_vat", b, true);
    const inclusive = inclusiveSetting === true || inclusiveSetting === "true";
    const role = roleAt(ctx, b)?.roleCode ?? "advisor";
    const maxPct = D(await getSetting(c, `discount.max_pct.${role}`, b, 0));
    const manager = can(ctx, "invoices", "approve", b);
    const lines: { itemId: string; desc: string; qty: Decimal; unitNet: Decimal; discountNet: Decimal; taxable: Decimal; vat: Decimal; code: string; rate: Decimal; partNo: string }[] = [];
    for (const x of f.lines) {
      if (!str(x.item_id)) continue;
      const qty = parseDec(x.qty, "Quantity", { min: "0.001", dp: 3 });
      const p = await priceFor(c, x.item_id, cust.price_level);
      const listUnit = inclusive ? r2(p.net.mul(D(1).plus(p.rate))) : p.net;
      const unit = str(x.price) ? parseDec(x.price, "Price", { min: 0, dp: 2 }) : listUnit;
      const disc = str(x.discount) ? parseDec(x.discount, "Discount", { min: 0, dp: 2 }) : D(0);
      const gross = r2(qty.mul(unit)).minus(disc);
      if (gross.lt(0)) throw invalid(`${p.item.part_no}: the discount is more than the line.`);
      const listGross = r2(qty.mul(listUnit));
      const pct = listGross.gt(0) ? listGross.minus(gross).div(listGross).mul(100) : D(0);
      if (pct.gt(maxPct) && !manager) throw invalid(`${p.item.part_no}: ${pct.toFixed(1)}% off is above your limit of ${maxPct.toString()}%. Ask the branch manager to make this sale.`);
      const taxable = inclusive ? r2(gross.div(D(1).plus(p.rate))) : gross;
      const vat = inclusive ? gross.minus(taxable) : r2(taxable.mul(p.rate));
      const unitNet = inclusive ? r2(unit.div(D(1).plus(p.rate))) : unit;
      const discountNet = r2(qty.mul(unitNet)).minus(taxable);
      if (p.min && taxable.lt(r2(p.min.mul(qty))) && !manager) throw invalid(`${p.item.part_no}: below the minimum price for this customer. Ask the branch manager.`);
      const avg = D((await c.query("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [x.item_id, b])).rows[0]?.avg_cost ?? 0);
      if (avg.gt(0) && taxable.lt(r2(avg.mul(qty))) && !manager) throw invalid(`${p.item.part_no}: this price is below cost. Ask the branch manager.`);
      lines.push({ itemId: x.item_id, desc: `${p.item.part_no} ${p.item.description}`, qty, unitNet, discountNet, taxable, vat, code: p.item.vat_code, rate: p.rate, partNo: p.item.part_no });
    }
    if (!lines.length) throw invalid("Add at least one item.");
    const taxable = lines.reduce((s, l) => s.plus(l.taxable), D(0));
    const vat = lines.reduce((s, l) => s.plus(l.vat), D(0));
    const total = taxable.plus(vat);
    // Paying now with no amount typed means the whole sale.
    const payment = f.payment ? { ...f.payment, amount: str(f.payment.amount) ? f.payment.amount : total.toFixed(2) } : null;
    if (payment && cust.is_walk_in && parseDec(payment.amount, "Amount", { min: "0.01", dp: 2 }).lt(total)) throw invalid(`A walk-in sale must be paid in full: AED ${total.toFixed(2)}.`);
    const docNo = await nextDocNo(c, b, "invoice");
    const invId = crypto.randomUUID();
    const costs: Decimal[] = [];
    for (const l of lines) costs.push((await stockOut(c, ctx, { branchId: b, itemId: l.itemId, qty: l.qty, moveType: "sale", ref: docNo })).value);
    const cost = costs.reduce((s, v) => s.plus(v), D(0));
    const jr = await postJournal(c, ctx, {
      branchId: b, date: today(), sourceType: "sales_invoice", sourceId: invId, narration: `Counter sale ${docNo}`,
      lines: [
        { event: "trade_receivable", debit: total, customerId: cust.id }, { event: "sales_parts", credit: taxable }, { event: "vat_output", credit: vat },
        { event: "cost_of_sales", debit: cost }, { event: "inventory", credit: cost },
      ],
    });
    const kind = await invoiceKindFor(c, cust, total, b);
    const name = cust.is_walk_in ? (str(f.bill_to_name) || "Walk-in customer") : billToName(cust);
    const inv = (await c.query(
      `INSERT INTO sales_invoice (id, branch_id, doc_no, doc_date, customer_id, bill_to_name, customer_trn, taxable_total, vat_total, grand_total, due_date, idempotency_key, journal_id, posted_by, invoice_kind, source)
       VALUES ($15,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'counter') RETURNING id`,
      [b, docNo, today(), cust.id, name, cust.trn, taxable.toFixed(2), vat.toFixed(2), total.toFixed(2), today(), f.idempotency_key, jr!.id, ctx.userId, kind, invId])).rows[0];
    for (const [i, l] of lines.entries()) {
      await c.query(
        `INSERT INTO sales_invoice_line (invoice_id, branch_id, line_no, line_type, description, qty, unit_price, discount_amount, taxable_amount, vat_code, vat_rate, vat_amount, line_total, item_id, cost_value)
         VALUES ($1,$2,$3,'part',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [inv.id, b, i + 1, l.desc, l.qty.toFixed(3), l.unitNet.toFixed(2), l.discountNet.toFixed(2), l.taxable.toFixed(2), l.code, l.rate.toFixed(4), l.vat.toFixed(2), l.taxable.plus(l.vat).toFixed(2), l.itemId, costs[i].toFixed(2)]);
    }
    await audit(c, ctx, "sales_invoice", inv.id, "counter_sale", { doc_no: docNo, total: total.toFixed(2), kind }, b);
    if (payment) {
      await receiptTx(c, ctx, { ...payment, invoice_id: inv.id, idempotency_key: `${f.idempotency_key}:pay` });
    } else if (cust.is_walk_in) throw invalid("A walk-in sale must be paid now.");
    else if (Number(cust.payment_terms_days) <= 0) throw invalid(`${billToName(cust)} has no credit terms. Take the payment now.`);
    return { id: inv.id as string, docNo, duplicate: false };
  });
}

// =====================================================================================
// VAT 201 (VT-01), FTA audit file (VT-03), e-invoice data (VT-02)
// =====================================================================================

const EMIRATE_BOX: Record<string, string> = { "Abu Dhabi": "1a", Dubai: "1b", Sharjah: "1c", Ajman: "1d", "Umm Al Quwain": "1e", "Ras Al Khaimah": "1f", Fujairah: "1g" };
export const BOX_LABEL: Record<string, string> = {
  "1a": "Standard-rated supplies in Abu Dhabi", "1b": "Standard-rated supplies in Dubai", "1c": "Standard-rated supplies in Sharjah", "1d": "Standard-rated supplies in Ajman",
  "1e": "Standard-rated supplies in Umm Al Quwain", "1f": "Standard-rated supplies in Ras Al Khaimah", "1g": "Standard-rated supplies in Fujairah",
  "2": "Tax refunds provided to tourists", "3": "Supplies subject to the reverse charge", "4": "Zero-rated supplies", "5": "Exempt supplies", "6": "Goods imported into the UAE",
  "7": "Adjustments to goods imported", "8": "Totals (supplies)", "9": "Standard-rated expenses", "10": "Supplies subject to the reverse charge (input)", "11": "Totals (expenses)",
  "12": "Total value of due tax", "13": "Total value of recoverable tax", "14": "Payable tax for the period",
};

export type VatLine = { box: string; doc_type: string; doc_no: string; doc_date: string; branch: string; party: string; amount: string; vat: string; link: string | null };

async function vatLines(c: PoolClient, from: string, to: string, branchId: string | null) {
  const out: VatLine[] = [];
  const bf = branchId ? "AND x.branch_id = $3" : "";
  const p = branchId ? [from, to, branchId] : [from, to];
  const sales = (await c.query(
    `SELECT l.vat_code, sum(l.taxable_amount) amt, sum(l.vat_amount) vat, i.id, i.doc_no, i.doc_date, i.bill_to_name, i.invoice_kind, b.code, b.emirate
       FROM sales_invoice_line l JOIN sales_invoice x ON x.id = l.invoice_id JOIN sales_invoice i ON i.id = x.id JOIN branch b ON b.id = x.branch_id
      WHERE x.doc_date BETWEEN $1 AND $2 ${bf} GROUP BY l.vat_code, i.id, i.doc_no, i.doc_date, i.bill_to_name, i.invoice_kind, b.code, b.emirate ORDER BY i.doc_no`, p)).rows;
  const boxFor = (code: string, emirate: string) => (code === "SR" ? EMIRATE_BOX[emirate] ?? "1a" : code === "ZR" ? "4" : code === "EX" ? "5" : code === "RC" ? "3" : null);
  for (const s of sales) {
    const box = boxFor(s.vat_code, s.emirate);
    if (box) out.push({ box, doc_type: s.invoice_kind === "simplified" ? "Simplified invoice" : "Tax invoice", doc_no: s.doc_no, doc_date: ymd(s.doc_date), branch: s.code, party: s.bill_to_name, amount: D(s.amt).toFixed(2), vat: D(s.vat).toFixed(2), link: `/invoices/${s.id}` });
  }
  const credits = (await c.query(
    `SELECT il.vat_code, sum(l.taxable_amount) amt, sum(l.vat_amount) vat, x.id, x.doc_no, x.doc_date, i.bill_to_name, b.code, b.emirate
       FROM credit_note_line l JOIN credit_note x ON x.id = l.credit_note_id JOIN sales_invoice_line il ON il.id = l.invoice_line_id JOIN sales_invoice i ON i.id = x.invoice_id JOIN branch b ON b.id = x.branch_id
      WHERE x.status = 'posted' AND x.doc_date BETWEEN $1 AND $2 ${bf} GROUP BY il.vat_code, x.id, x.doc_no, x.doc_date, i.bill_to_name, b.code, b.emirate`, p)).rows;
  for (const s of credits) {
    const box = boxFor(s.vat_code, s.emirate);
    if (box) out.push({ box, doc_type: "Credit note", doc_no: s.doc_no, doc_date: ymd(s.doc_date), branch: s.code, party: s.bill_to_name, amount: D(s.amt).neg().toFixed(2), vat: D(s.vat).neg().toFixed(2), link: `/billing/credit-notes/${s.id}` });
  }
  // Advances taxed on receipt (box 1 of the branch), and the reversal when they are applied to the invoice.
  const adv = (await c.query(
    `SELECT x.id, x.doc_no, x.doc_date, x.amount, x.vat_amount, b.code, b.emirate FROM receipt x JOIN branch b ON b.id = x.branch_id
      WHERE x.kind = 'advance' AND x.vat_amount > 0 AND x.doc_date BETWEEN $1 AND $2 ${bf}`, p)).rows;
  for (const a of adv) out.push({ box: EMIRATE_BOX[a.emirate] ?? "1a", doc_type: "Advance received", doc_no: a.doc_no, doc_date: ymd(a.doc_date), branch: a.code, party: "", amount: D(a.amount).minus(a.vat_amount).toFixed(2), vat: D(a.vat_amount).toFixed(2), link: null });
  const apps = (await c.query(
    `SELECT x.amount, x.vat_amount, (x.applied_at AT TIME ZONE 'Asia/Dubai')::date d, a.source_no, i.doc_no inv, b.code, b.emirate FROM advance_application x JOIN customer_advance a ON a.id = x.advance_id
       JOIN sales_invoice i ON i.id = x.invoice_id JOIN branch b ON b.id = x.branch_id WHERE x.vat_amount > 0 AND (x.applied_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $1 AND $2 ${bf}`, p)).rows;
  for (const a of apps) out.push({ box: EMIRATE_BOX[a.emirate] ?? "1a", doc_type: "Advance applied", doc_no: `${a.source_no} → ${a.inv}`, doc_date: ymd(a.d), branch: a.code, party: "", amount: D(a.amount).minus(a.vat_amount).neg().toFixed(2), vat: D(a.vat_amount).neg().toFixed(2), link: null });
  // Box 9: standard-rated expenses from posted supplier bills and petty cash with VAT.
  const bills = (await c.query(
    `SELECT sum(l.net_amount) amt, sum(l.vat_amount) vat, x.id, x.doc_no, x.invoice_date, s.name_en, b.code, l.vat_code FROM supplier_bill_line l JOIN supplier_bill x ON x.id = l.bill_id
       JOIN supplier s ON s.id = x.supplier_id JOIN branch b ON b.id = x.branch_id WHERE x.status = 'posted' AND x.invoice_date BETWEEN $1 AND $2 ${bf} AND l.vat_amount > 0
      GROUP BY x.id, x.doc_no, x.invoice_date, s.name_en, b.code, l.vat_code`, p)).rows;
  for (const s of bills) out.push({ box: s.vat_code === "RC" ? "10" : "9", doc_type: "Supplier bill", doc_no: s.doc_no, doc_date: ymd(s.invoice_date), branch: s.code, party: s.name_en, amount: D(s.amt).toFixed(2), vat: D(s.vat).toFixed(2), link: `/purchasing/bills/${s.id}` });
  // Reverse charge: the same VAT is also due as output tax (box 3), so it nets to nil when recoverable.
  for (const s of bills.filter((x) => x.vat_code === "RC")) out.push({ box: "3", doc_type: "Supplier bill (reverse charge)", doc_no: s.doc_no, doc_date: ymd(s.invoice_date), branch: s.code, party: s.name_en, amount: D(s.amt).toFixed(2), vat: D(s.vat).toFixed(2), link: `/purchasing/bills/${s.id}` });
  const petty = (await c.query(
    `SELECT x.doc_no, x.entry_date, x.net_amount, x.vat_amount, x.supplier_name, b.code FROM petty_cash_entry x JOIN branch b ON b.id = x.branch_id
      WHERE x.kind = 'spend' AND x.vat_amount > 0 AND x.entry_date BETWEEN $1 AND $2 ${bf}`, p)).rows;
  for (const s of petty) out.push({ box: "9", doc_type: "Petty cash", doc_no: s.doc_no, doc_date: ymd(s.entry_date), branch: s.code, party: s.supplier_name ?? "", amount: D(s.net_amount).toFixed(2), vat: D(s.vat_amount).toFixed(2), link: "/purchasing/petty-cash" });
  return out;
}

export async function vat201(ctx: Ctx, from: string, to: string, branchId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw invalid("Choose a valid period.");
  if (!can(ctx, "accounting", "view", branchId ?? undefined) && !can(ctx, "accounting", "view")) throw forbidden();
  return withTx(ctx, async (c) => {
    const lines = await vatLines(c, from, to, branchId);
    const boxes: Record<string, { amount: Decimal; vat: Decimal }> = {};
    for (const k of Object.keys(BOX_LABEL)) boxes[k] = { amount: D(0), vat: D(0) };
    for (const l of lines) { boxes[l.box].amount = boxes[l.box].amount.plus(l.amount); boxes[l.box].vat = boxes[l.box].vat.plus(l.vat); }
    const supply = ["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7"];
    boxes["8"] = supply.reduce((s, k) => ({ amount: s.amount.plus(boxes[k].amount), vat: s.vat.plus(boxes[k].vat) }), { amount: D(0), vat: D(0) });
    boxes["11"] = { amount: boxes["9"].amount.plus(boxes["10"].amount), vat: boxes["9"].vat.plus(boxes["10"].vat) };
    boxes["12"] = { amount: D(0), vat: boxes["8"].vat };
    boxes["13"] = { amount: D(0), vat: boxes["11"].vat };
    boxes["14"] = { amount: D(0), vat: boxes["12"].vat.minus(boxes["13"].vat) };
    // Cross-check against the ledger: VAT output less VAT input booked in the period.
    const ledger = (await c.query(
      `SELECT coalesce(sum(jl.credit - jl.debit) FILTER (WHERE m.event_key = 'vat_output'),0) out_vat, coalesce(sum(jl.debit - jl.credit) FILTER (WHERE m.event_key = 'vat_input'),0) in_vat
         FROM journal_line jl JOIN journal j ON j.id = jl.journal_id JOIN account_mapping m ON m.account_id = jl.account_id
        WHERE j.journal_date BETWEEN $1 AND $2 ${branchId ? "AND jl.branch_id = $3" : ""} AND m.event_key IN ('vat_output','vat_input')`, branchId ? [from, to, branchId] : [from, to])).rows[0];
    return {
      boxes: Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, { amount: v.amount.toFixed(2), vat: v.vat.toFixed(2) }])),
      lines, ledgerOutput: D(ledger.out_vat).toFixed(2), ledgerInput: D(ledger.in_vat).toFixed(2),
    };
  });
}

const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // a spreadsheet must not run text as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(",")).join("\r\n");

/** FTA Audit File (VT-03): company, supply, purchase and general ledger sections for a period, as CSV. */
export async function ftaAuditFile(ctx: Ctx, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw invalid("Choose a valid period.");
  assertCan(ctx, "accounting", "export");
  return withTx(ctx, async (c) => {
    const co = (await c.query("SELECT * FROM company LIMIT 1")).rows[0];
    const rows: (string | number | null)[][] = [];
    rows.push(["Company Information"], ["TaxablePersonNameEn", "TaxablePersonNameAr", "TRN", "PeriodStart", "PeriodEnd", "FAFVersion", "ProductVersion"]);
    rows.push([co.legal_name_en, co.legal_name_ar ?? "", co.trn, from, to, "FAFv1.0.0", "AUTOVIQO local build"]);
    rows.push([], ["Supply Data"], ["CustomerName", "CustomerTRN", "InvoiceDate", "InvoiceNo", "PermitNo", "TransactionID", "LineNo", "ProductDescription", "SupplyValueAED", "VATValueAED", "TaxCode", "Country", "FCYCode", "SupplyFCY", "VATFCY"]);
    const sup = (await c.query(
      `SELECT i.bill_to_name, i.customer_trn, i.doc_date, i.doc_no, l.line_no, l.description, l.taxable_amount, l.vat_amount, l.vat_code FROM sales_invoice i JOIN sales_invoice_line l ON l.invoice_id = i.id
        WHERE i.doc_date BETWEEN $1 AND $2 ORDER BY i.doc_no, l.line_no`, [from, to])).rows;
    for (const s of sup) rows.push([s.bill_to_name, s.customer_trn ?? "", ymd(s.doc_date), s.doc_no, "", s.doc_no, s.line_no, s.description, s.taxable_amount, s.vat_amount, s.vat_code, "AE", "AED", s.taxable_amount, s.vat_amount]);
    const cns = (await c.query(
      `SELECT i.bill_to_name, i.customer_trn, x.doc_date, x.doc_no, il.line_no, il.description, l.taxable_amount, l.vat_amount, il.vat_code FROM credit_note x JOIN credit_note_line l ON l.credit_note_id = x.id
         JOIN sales_invoice_line il ON il.id = l.invoice_line_id JOIN sales_invoice i ON i.id = x.invoice_id WHERE x.status = 'posted' AND x.doc_date BETWEEN $1 AND $2`, [from, to])).rows;
    for (const s of cns) rows.push([s.bill_to_name, s.customer_trn ?? "", ymd(s.doc_date), s.doc_no, "", s.doc_no, s.line_no, s.description, `-${s.taxable_amount}`, `-${s.vat_amount}`, s.vat_code, "AE", "AED", `-${s.taxable_amount}`, `-${s.vat_amount}`]);
    rows.push([], ["Purchase Data"], ["SupplierName", "SupplierTRN", "InvoiceDate", "InvoiceNo", "PermitNo", "TransactionID", "LineNo", "ProductDescription", "PurchaseValueAED", "VATValueAED", "TaxCode", "FCYCode", "PurchaseFCY", "VATFCY"]);
    const pur = (await c.query(
      `SELECT s.name_en, s.trn, x.invoice_date, x.supplier_invoice_no, x.doc_no, row_number() OVER (PARTITION BY x.id ORDER BY l.id) ln, l.description, l.net_amount, l.vat_amount, l.vat_code
         FROM supplier_bill x JOIN supplier_bill_line l ON l.bill_id = x.id JOIN supplier s ON s.id = x.supplier_id WHERE x.status = 'posted' AND x.invoice_date BETWEEN $1 AND $2 ORDER BY x.doc_no`, [from, to])).rows;
    for (const s of pur) rows.push([s.name_en, s.trn ?? "", ymd(s.invoice_date), s.supplier_invoice_no, "", s.doc_no, s.ln, s.description, s.net_amount, s.vat_amount, s.vat_code, "AED", s.net_amount, s.vat_amount]);
    const pc = (await c.query("SELECT * FROM petty_cash_entry WHERE kind = 'spend' AND entry_date BETWEEN $1 AND $2 ORDER BY doc_no", [from, to])).rows;
    for (const s of pc) rows.push([s.supplier_name ?? "", s.supplier_trn ?? "", ymd(s.entry_date), s.doc_no, "", s.doc_no, 1, s.description ?? s.expense_type, s.net_amount, s.vat_amount, D(s.vat_amount).gt(0) ? "SR" : "OS", "AED", s.net_amount, s.vat_amount]);
    rows.push([], ["General Ledger Data"], ["TransactionDate", "AccountID", "AccountName", "TransactionDescription", "Name", "TransactionID", "SourceDocumentID", "SourceType", "Debit", "Credit", "Balance"]);
    const gl = (await c.query(
      `SELECT j.journal_date, a.code, a.name, j.narration, j.doc_no, j.source_id, j.source_type, jl.debit, jl.credit,
              sum(jl.debit - jl.credit) OVER (PARTITION BY a.code ORDER BY j.journal_date, j.doc_no, jl.id) bal
         FROM journal_line jl JOIN journal j ON j.id = jl.journal_id JOIN account a ON a.id = jl.account_id WHERE j.journal_date BETWEEN $1 AND $2 ORDER BY a.code, j.journal_date, j.doc_no`, [from, to])).rows;
    for (const g of gl) rows.push([ymd(g.journal_date), g.code, g.name, g.narration, "", g.doc_no, g.source_id, g.source_type, g.debit, g.credit, D(g.bal).toFixed(2)]);
    await audit(c, ctx, "vat", from, "faf_export", { from, to }, null);
    return csv(rows);
  });
}

/** VT-02: the invoice in a structure that maps to the UAE PINT AE e-invoice (UBL) fields, for the ASP later. */
export async function einvoiceData(ctx: Ctx, invoiceId: string) {
  assertCan(ctx, "invoices", "export");
  return withTx(ctx, async (c) => {
    const i = (await c.query(
      `SELECT i.*, b.name_en branch_name, b.address branch_address, b.emirate, co.legal_name_en, co.trn company_trn, cu.address cust_address, cu.country_code
         FROM sales_invoice i JOIN branch b ON b.id = i.branch_id CROSS JOIN LATERAL (SELECT * FROM company LIMIT 1) co JOIN customer cu ON cu.id = i.customer_id WHERE i.id = $1`, [invoiceId])).rows[0];
    if (!i) throw notFound("Invoice");
    const lines = (await c.query("SELECT * FROM sales_invoice_line WHERE invoice_id = $1 ORDER BY line_no", [invoiceId])).rows;
    const cat = (code: string) => ({ SR: "S", ZR: "Z", EX: "E", OS: "O", RC: "AE" })[code] ?? "S";
    return {
      CustomizationID: "urn:peppol:pint:billing-1@ae-1", ProfileID: "urn:peppol:bis:billing",
      ID: i.doc_no, IssueDate: ymd(i.doc_date), InvoiceTypeCode: "380", DocumentCurrencyCode: "AED",
      AccountingSupplierParty: { RegistrationName: i.legal_name_en, CompanyID: i.company_trn, TaxScheme: "VAT", Address: { Line: i.branch_address, CountrySubentity: i.emirate, Country: "AE" } },
      AccountingCustomerParty: { RegistrationName: i.bill_to_name, CompanyID: i.customer_trn ?? null, Address: { Line: i.bill_to_address ?? i.cust_address ?? null, Country: i.country_code } },
      OrderReference: i.lpo_no ?? null,
      TaxTotal: { TaxAmount: i.vat_total, TaxSubtotal: Object.values(lines.reduce((m: Record<string, Row>, l) => {
        const k = l.vat_code; m[k] ??= { TaxCategory: cat(k), Percent: D(l.vat_rate).mul(100).toFixed(2), TaxableAmount: D(0), TaxAmount: D(0) };
        m[k].TaxableAmount = D(m[k].TaxableAmount).plus(l.taxable_amount); m[k].TaxAmount = D(m[k].TaxAmount).plus(l.vat_amount); return m; }, {}))
        .map((t) => ({ ...t, TaxableAmount: D(t.TaxableAmount).toFixed(2), TaxAmount: D(t.TaxAmount).toFixed(2) })) },
      LegalMonetaryTotal: { LineExtensionAmount: i.taxable_total, TaxExclusiveAmount: i.taxable_total, TaxInclusiveAmount: i.grand_total, PrepaidAmount: i.paid_amount, PayableAmount: D(i.grand_total).minus(i.paid_amount).minus(i.credited_amount).toFixed(2) },
      InvoiceLine: lines.map((l) => ({ ID: l.line_no, InvoicedQuantity: l.qty, LineExtensionAmount: l.taxable_amount, AllowanceAmount: l.discount_amount, Item: { Name: l.description, ClassifiedTaxCategory: cat(l.vat_code), Percent: D(l.vat_rate).mul(100).toFixed(2) }, Price: { PriceAmount: l.unit_price } })),
    };
  });
}

/** Amount in words for the tax invoice (UAE dirhams and fils). */
export function amountInWords(v: string | number) {
  const n = D(v).toDecimalPlaces(2);
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const under1000 = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    const t = r < 20 ? ones[r] : `${tens[Math.floor(r / 10)]}${r % 10 ? "-" + ones[r % 10] : ""}`;
    return [h ? `${ones[h]} hundred` : "", t].filter(Boolean).join(" and ");
  };
  const words = (x: number): string => {
    if (x === 0) return "zero";
    const parts: string[] = [];
    for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as [number, string][]) {
      if (x >= size) { parts.push(`${under1000(Math.floor(x / size))} ${name}`); x %= size; }
    }
    if (x) parts.push(under1000(x));
    return parts.join(" ");
  };
  const dirhams = n.floor().toNumber();
  const fils = n.minus(n.floor()).mul(100).toDecimalPlaces(0).toNumber();
  const s = `${words(dirhams)} dirham${dirhams === 1 ? "" : "s"}${fils ? ` and ${words(fils)} fils` : ""} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { setStatus };
