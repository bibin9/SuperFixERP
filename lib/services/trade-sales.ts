import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canSee, roleAt } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { lockSeries, nextDocNo } from "./numbering";
import { postJournal } from "./ledger";
import { getSetting } from "./settings";
import { addDaysLocal, stockOut, today } from "./stock";
import { D, Decimal, parseDec, r2 } from "../money";
import { optStr, str } from "../validate";
import { assertBuyerEinvoiceDetails, billToName, invoiceKindFor } from "./billing";
import { priceFor } from "./billing-more";
import { setupIn } from "./print";

/**
 * SL-02: trade sales on credit terms. A quotation (status quote) becomes a sales order when the
 * customer confirms it, checked against their credit terms and limit. Goods leave on delivery notes,
 * which move stock and post cost of sales. The tax invoice covers everything delivered and not yet
 * invoiced, due on the customer's terms. Prices follow the customer's price level and the user's
 * discount limit, as at the counter (SL-03).
 */

const here = (ctx: Ctx) => { if (!ctx.currentBranchId) throw invalid("Choose a branch first."); return ctx.currentBranchId; };
const OPEN_FOR_DELIVERY = ["confirmed", "partly_delivered"];

export async function listOrders(ctx: Ctx, show = "open") {
  const b = here(ctx);
  if (!can(ctx, "invoices", "view", b) && !can(ctx, "stock", "create", b)) throw forbidden();
  const prices = canSee(ctx, "selling_price", b);
  return withTx(ctx, async (c) => (await c.query(
    `SELECT o.*, coalesce(cu.company_name, concat_ws(' ', cu.first_name, cu.last_name)) customer_name,
            (SELECT coalesce(sum(qty - delivered_qty), 0) FROM sales_order_line WHERE order_id = o.id) to_deliver,
            (SELECT coalesce(sum(delivered_qty - invoiced_qty), 0) FROM sales_order_line WHERE order_id = o.id) to_invoice
       FROM sales_order o JOIN customer cu ON cu.id = o.customer_id
      WHERE o.branch_id = $1 AND ($2 = 'all' OR o.status NOT IN ('closed','cancelled')) ORDER BY o.created_at DESC LIMIT 200`, [b, show])).rows.map((r) => (prices ? r : { ...r, taxable_total: null, vat_total: null, grand_total: null })));
}

/** Trade customers: those on credit terms, plus any customer the user picks for a quotation. */
export async function tradeSetup(ctx: Ctx) {
  const b = here(ctx);
  assertCan(ctx, "invoices", "create", b);
  return withTx(ctx, async (c) => ({
    customers: (await c.query(
      `SELECT id, customer_no, coalesce(company_name, concat_ws(' ', first_name, last_name)) name, price_level, payment_terms_days, credit_limit
         FROM customer WHERE active AND NOT is_walk_in AND (payment_terms_days > 0 OR customer_type <> 'individual') ORDER BY 3 LIMIT 500`)).rows,
  }));
}

export async function createOrder(ctx: Ctx, f: { customer_id?: string; customer_ref?: string; valid_until?: string; notes?: string }) {
  const b = here(ctx);
  assertCan(ctx, "invoices", "create", b);
  if (!canSee(ctx, "selling_price", b)) throw forbidden("You cannot see prices.");
  const cid = str(f.customer_id);
  if (!cid) throw invalid("Choose the customer.", { field: "customer_id" });
  return withTx(ctx, async (c) => {
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1 AND active AND NOT is_walk_in", [cid])).rows[0];
    if (!cust) throw invalid("Choose a named customer: walk-in customers buy at the counter.");
    const days = Number(await getSetting(c, "quotation.validity_days", b, 7)) || 7;
    const valid = str(f.valid_until) || addDaysLocal(days);
    const docNo = await nextDocNo(c, b, "sales_order");
    const o = (await c.query(
      `INSERT INTO sales_order (branch_id, doc_no, customer_id, customer_ref, valid_until, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b, docNo, cid, optStr(f.customer_ref), valid, optStr(f.notes), ctx.userId])).rows[0];
    await audit(c, ctx, "sales_order", o.id, "created", { doc_no: docNo }, b);
    return { id: o.id as string, docNo };
  });
}

async function lockOrder(c: PoolClient, ctx: Ctx, id: string) {
  const o = (await c.query("SELECT * FROM sales_order WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!o) throw notFound("Sales order");
  return o;
}

async function retotal(c: PoolClient, id: string) {
  await c.query(
    `UPDATE sales_order o SET taxable_total = t.tx, vat_total = t.vt, grand_total = t.tx + t.vt, version = version + 1
       FROM (SELECT coalesce(sum(taxable_amount),0) tx, coalesce(sum(vat_amount),0) vt FROM sales_order_line WHERE order_id = $1) t WHERE o.id = $1`, [id]);
}

/** Adds a part to a quotation at the customer's price level, within the user's discount limit. */
export async function addOrderLine(ctx: Ctx, id: string, f: { item_id?: string; qty?: unknown; price?: unknown; discount?: unknown }) {
  return withTx(ctx, async (c) => {
    const o = await lockOrder(c, ctx, id);
    const b = o.branch_id;
    assertCan(ctx, "invoices", "create", b);
    if (!canSee(ctx, "selling_price", b)) throw forbidden("You cannot see prices.");
    if (o.status !== "quote") throw invalid("Lines can be changed only while it is a quotation.");
    if (!str(f.item_id)) throw invalid("Choose a part.", { field: "item_id" });
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [o.customer_id])).rows[0];
    const qty = parseDec(f.qty, "Quantity", { min: "0.001", dp: 3 });
    const p = await priceFor(c, String(f.item_id), cust.price_level);
    const inclusiveSetting = await getSetting<unknown>(c, "sales.prices_include_vat", b, true);
    const inclusive = inclusiveSetting === true || inclusiveSetting === "true";
    const listUnit = inclusive ? r2(p.net.mul(D(1).plus(p.rate))) : p.net;
    const unit = str(f.price) ? parseDec(f.price, "Price", { min: 0, dp: 2 }) : listUnit;
    const disc = str(f.discount) ? parseDec(f.discount, "Discount", { min: 0, dp: 2 }) : D(0);
    const gross = r2(qty.mul(unit)).minus(disc);
    if (gross.lt(0)) throw invalid("The discount is more than the line.");
    const manager = can(ctx, "invoices", "approve", b);
    const listGross = r2(qty.mul(listUnit));
    const pct = listGross.gt(0) ? listGross.minus(gross).div(listGross).mul(100) : D(0);
    const role = roleAt(ctx, b)?.roleCode ?? "advisor";
    const maxPct = D(await getSetting(c, `discount.max_pct.${role}`, b, 0));
    if (pct.gt(maxPct) && !manager) throw invalid(`${pct.toFixed(1)}% off is above your limit of ${maxPct.toString()}%. Ask the branch manager.`);
    const taxable = inclusive ? r2(gross.div(D(1).plus(p.rate))) : gross;
    const vat = inclusive ? gross.minus(taxable) : r2(taxable.mul(p.rate));
    if (p.min && taxable.lt(r2(p.min.mul(qty))) && !manager) throw invalid("Below the minimum price for this customer. Ask the branch manager.");
    const avg = D((await c.query("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [f.item_id, b])).rows[0]?.avg_cost ?? 0);
    if (avg.gt(0) && taxable.lt(r2(avg.mul(qty))) && !manager) throw invalid("This price is below cost. Ask the branch manager.");
    const unitNet = inclusive ? r2(unit.div(D(1).plus(p.rate))) : unit;
    // With no discount typed, a cent of VAT rounding is not shown as a discount.
    const discountNet = disc.gt(0) || str(f.price) ? Decimal.max(r2(qty.mul(unitNet)).minus(taxable), 0) : D(0);
    const n = Number((await c.query("SELECT coalesce(max(line_no),0) + 1 n FROM sales_order_line WHERE order_id = $1", [id])).rows[0].n);
    await c.query(
      `INSERT INTO sales_order_line (order_id, branch_id, line_no, item_id, description, qty, unit_price, discount_amount, taxable_amount, vat_code, vat_rate, vat_amount, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, b, n, f.item_id, `${p.item.part_no} ${p.item.description}`, qty.toFixed(3), unitNet.toFixed(2), discountNet.toFixed(2), taxable.toFixed(2), p.item.vat_code, p.rate.toFixed(4), vat.toFixed(2), taxable.plus(vat).toFixed(2)]);
    await retotal(c, id);
  });
}

export async function removeOrderLine(ctx: Ctx, id: string, lineId: string) {
  return withTx(ctx, async (c) => {
    const o = await lockOrder(c, ctx, id);
    assertCan(ctx, "invoices", "create", o.branch_id);
    if (o.status !== "quote") throw invalid("Lines can be changed only while it is a quotation.");
    await c.query("DELETE FROM sales_order_line WHERE id = $1 AND order_id = $2", [lineId, id]);
    await retotal(c, id);
  });
}

/** What the customer owes plus orders confirmed and not yet invoiced, against their credit limit. */
async function creditRoom(c: PoolClient, cust: { id: string; credit_limit: string }, exceptOrder: string) {
  const owed = D((await c.query("SELECT coalesce(sum(grand_total - paid_amount - credited_amount),0) v FROM sales_invoice WHERE customer_id = $1", [cust.id])).rows[0].v);
  const onOrder = D((await c.query(
    `SELECT coalesce(sum((l.qty - l.invoiced_qty) / l.qty * l.line_total),0) v FROM sales_order_line l JOIN sales_order o ON o.id = l.order_id
      WHERE o.customer_id = $1 AND o.id <> $2 AND o.status IN ('confirmed','partly_delivered','delivered')`, [cust.id, exceptOrder])).rows[0].v);
  return D(cust.credit_limit).minus(owed).minus(onOrder);
}

/** The customer confirmed the quotation: it becomes a sales order, within their credit terms and limit. */
export async function confirmOrder(ctx: Ctx, id: string, f: { customer_ref?: string }) {
  return withTx(ctx, async (c) => {
    const o = await lockOrder(c, ctx, id);
    const b = o.branch_id;
    assertCan(ctx, "invoices", "create", b);
    if (o.status !== "quote") throw invalid("Only a quotation can be confirmed.");
    const n = Number((await c.query("SELECT count(*) n FROM sales_order_line WHERE order_id = $1", [id])).rows[0].n);
    if (!n) throw invalid("Add at least one part.");
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [o.customer_id])).rows[0];
    if (Number(cust.payment_terms_days) <= 0) throw invalid(`${billToName(cust)} has no credit terms. Sell at the counter and take payment, or set credit terms on the customer.`);
    const room = (await creditRoom(c, cust, id)).minus(o.grand_total);
    if (room.lt(0) && !can(ctx, "invoices", "approve", b))
      throw invalid(`This order takes ${billToName(cust)} AED ${room.abs().toFixed(2)} over their credit limit of AED ${D(cust.credit_limit).toFixed(2)}. Ask the branch manager to confirm it.`);
    await c.query("UPDATE sales_order SET status = 'confirmed', customer_ref = coalesce($2, customer_ref), confirmed_by = $3, confirmed_at = now(), version = version + 1 WHERE id = $1",
      [id, optStr(f.customer_ref), ctx.userId]);
    await audit(c, ctx, "sales_order", id, "confirmed", { total: o.grand_total, over_limit: room.lt(0) ? room.abs().toFixed(2) : null }, b);
  });
}

export async function cancelOrder(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const o = await lockOrder(c, ctx, id);
    assertCan(ctx, "invoices", "create", o.branch_id);
    if (!["quote", "confirmed"].includes(o.status)) throw invalid("Goods have gone out on this order: it cannot be cancelled. Return them with a credit note.");
    await c.query("UPDATE sales_order SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), version = version + 1 WHERE id = $1", [id, ctx.userId]);
    await audit(c, ctx, "sales_order", id, "cancelled", {}, o.branch_id);
  });
}

/** Goods leave the store on a delivery note: stock out at average cost, cost of sales posted. */
export async function deliver(ctx: Ctx, id: string, f: { qty: Record<string, unknown>; received_by_name?: string; vehicle_ref?: string }) {
  return withTx(ctx, async (c) => {
    const pre = (await c.query("SELECT branch_id FROM sales_order WHERE id = $1", [id])).rows[0];
    if (!pre) throw notFound("Sales order");
    if (!can(ctx, "stock", "create", pre.branch_id) && !can(ctx, "invoices", "create", pre.branch_id)) throw forbidden();
    await lockSeries(c, pre.branch_id, ["delivery_note", "journal"]);
    const o = await lockOrder(c, ctx, id);
    const b = o.branch_id;
    if (!OPEN_FOR_DELIVERY.includes(o.status)) throw invalid(o.status === "quote" ? "Confirm the order first." : "Nothing is left to deliver on this order.");
    const lines = (await c.query("SELECT * FROM sales_order_line WHERE order_id = $1 ORDER BY line_no FOR UPDATE", [id])).rows;
    const take: { l: (typeof lines)[number]; q: Decimal }[] = [];
    for (const l of lines) {
      const raw = f.qty?.[l.id];
      if (raw === undefined || str(raw) === "") continue;
      const q = parseDec(raw, `Line ${l.line_no} quantity`, { min: 0, dp: 3 });
      if (q.lte(0)) continue;
      if (q.gt(D(l.qty).minus(l.delivered_qty))) throw invalid(`Line ${l.line_no}: only ${D(l.qty).minus(l.delivered_qty).toString()} left to deliver.`);
      take.push({ l, q });
    }
    if (!take.length) throw invalid("Enter the quantity going out.");
    const docNo = await nextDocNo(c, b, "delivery_note");
    const dn = (await c.query("INSERT INTO delivery_note (branch_id, doc_no, order_id, received_by_name, vehicle_ref, delivered_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [b, docNo, id, optStr(f.received_by_name), optStr(f.vehicle_ref), ctx.userId])).rows[0];
    let cost = D(0);
    for (const { l, q } of take) {
      const out = await stockOut(c, ctx, { branchId: b, itemId: l.item_id, qty: q, moveType: "sale", ref: docNo });
      cost = cost.plus(out.value);
      await c.query("INSERT INTO delivery_note_line (dn_id, branch_id, order_line_id, item_id, qty, cost_value) VALUES ($1,$2,$3,$4,$5,$6)", [dn.id, b, l.id, l.item_id, q.toFixed(3), out.value.toFixed(2)]);
      await c.query("UPDATE sales_order_line SET delivered_qty = delivered_qty + $2, delivered_cost = delivered_cost + $3 WHERE id = $1", [l.id, q.toFixed(3), out.value.toFixed(2)]);
    }
    await c.query("UPDATE delivery_note SET cost_value = $2 WHERE id = $1", [dn.id, cost.toFixed(2)]);
    await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "delivery_note", sourceId: dn.id, narration: `Delivery ${docNo} on ${o.doc_no}`,
      lines: [{ event: "cost_of_sales", debit: cost }, { event: "inventory", credit: cost }] });
    const left = D((await c.query("SELECT coalesce(sum(qty - delivered_qty),0) v FROM sales_order_line WHERE order_id = $1", [id])).rows[0].v);
    await c.query("UPDATE sales_order SET status = $2, version = version + 1 WHERE id = $1", [id, left.gt(0) ? "partly_delivered" : "delivered"]);
    await audit(c, ctx, "sales_order", id, "delivered", { delivery_note: docNo, lines: take.length }, b);
    return { id: dn.id as string, docNo };
  });
}

/** One tax invoice for everything delivered and not yet invoiced, due on the customer's credit terms. */
export async function invoiceOrder(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const pre = (await c.query("SELECT branch_id FROM sales_order WHERE id = $1", [id])).rows[0];
    if (!pre) throw notFound("Sales order");
    assertCan(ctx, "invoices", "create", pre.branch_id);
    await lockSeries(c, pre.branch_id, ["invoice", "journal"]);
    const o = await lockOrder(c, ctx, id);
    const b = o.branch_id;
    const lines = (await c.query("SELECT * FROM sales_order_line WHERE order_id = $1 AND delivered_qty > invoiced_qty ORDER BY line_no FOR UPDATE", [id])).rows;
    if (!lines.length) throw invalid("Nothing delivered is waiting to be invoiced.");
    const cust = (await c.query("SELECT * FROM customer WHERE id = $1", [o.customer_id])).rows[0];
    const out = lines.map((l) => {
      const q = D(l.delivered_qty).minus(l.invoiced_qty);
      const last = D(l.invoiced_qty).plus(q).eq(l.qty);
      const share = q.div(l.qty);
      const taxable = last ? D(l.taxable_amount).minus(l.invoiced_taxable) : r2(D(l.taxable_amount).mul(share));
      const vat = last ? D(l.vat_amount).minus(l.invoiced_vat) : r2(D(l.vat_amount).mul(share));
      const deliveredUninvoiced = D(l.delivered_cost).minus(l.invoiced_cost);
      return { l, q, taxable, vat, cost: deliveredUninvoiced, discount: last ? D(l.discount_amount).minus(r2(D(l.discount_amount).mul(D(l.invoiced_qty).div(l.qty)))) : r2(D(l.discount_amount).mul(share)) };
    });
    const taxable = out.reduce((s, x) => s.plus(x.taxable), D(0));
    const vat = out.reduce((s, x) => s.plus(x.vat), D(0));
    const total = taxable.plus(vat);
    const kind = await invoiceKindFor(c, cust, total, b);
    if (kind === "tax") await assertBuyerEinvoiceDetails(c, cust, b);
    const docNo = await nextDocNo(c, b, "invoice");
    const invId = crypto.randomUUID();
    const jr = await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "sales_invoice", sourceId: invId, narration: `Trade sale ${docNo} on ${o.doc_no}`,
      lines: [{ event: "trade_receivable", debit: total, customerId: cust.id }, { event: "sales_parts", credit: taxable }, { event: "vat_output", credit: vat }] });
    const due = addDaysLocal(Number(cust.payment_terms_days) || 0);
    await c.query(
      `INSERT INTO sales_invoice (id, branch_id, doc_no, doc_date, customer_id, bill_to_name, customer_trn, taxable_total, vat_total, grand_total, due_date, journal_id, posted_by, invoice_kind, source, sales_order_id, lpo_no, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'trade',$15,$16,$17)`,
      [invId, b, docNo, today(), cust.id, billToName(cust), cust.trn, taxable.toFixed(2), vat.toFixed(2), total.toFixed(2), due, jr!.id, ctx.userId, kind, id, o.customer_ref, `trade:${invId}`]);
    for (const [i, x] of out.entries()) {
      await c.query(
        `INSERT INTO sales_invoice_line (invoice_id, branch_id, line_no, line_type, description, qty, unit_price, discount_amount, taxable_amount, vat_code, vat_rate, vat_amount, line_total, item_id, cost_value)
         VALUES ($1,$2,$3,'part',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [invId, b, i + 1, x.l.description, x.q.toFixed(3), D(x.l.unit_price).toFixed(2), x.discount.toFixed(2), x.taxable.toFixed(2), x.l.vat_code, D(x.l.vat_rate).toFixed(4), x.vat.toFixed(2), x.taxable.plus(x.vat).toFixed(2), x.l.item_id, x.cost.toFixed(2)]);
      await c.query("UPDATE sales_order_line SET invoiced_qty = invoiced_qty + $2, invoiced_taxable = invoiced_taxable + $3, invoiced_vat = invoiced_vat + $4, invoiced_cost = invoiced_cost + $5 WHERE id = $1",
        [x.l.id, x.q.toFixed(3), x.taxable.toFixed(2), x.vat.toFixed(2), x.cost.toFixed(2)]);
    }
    await c.query("UPDATE delivery_note SET invoice_id = $2 WHERE order_id = $1 AND invoice_id IS NULL", [id, invId]);
    const done = !(await c.query("SELECT 1 FROM sales_order_line WHERE order_id = $1 AND invoiced_qty < qty", [id])).rowCount;
    if (done) await c.query("UPDATE sales_order SET status = 'closed', version = version + 1 WHERE id = $1", [id]);
    await audit(c, ctx, "sales_invoice", invId, "trade_sale", { doc_no: docNo, order: o.doc_no, total: total.toFixed(2), due }, b);
    return { id: invId, docNo };
  });
}

export async function getOrder(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const o = (await c.query(
      `SELECT o.*, cu.customer_no, cu.price_level, cu.payment_terms_days, cu.credit_limit, cu.trn customer_trn, cu.mobile, cu.name_ar customer_name_ar,
              coalesce(cu.company_name, concat_ws(' ', cu.first_name, cu.last_name)) customer_name, u.full_name created_by_name
         FROM sales_order o JOIN customer cu ON cu.id = o.customer_id LEFT JOIN app_user u ON u.id = o.created_by WHERE o.id = $1`, [id])).rows[0];
    if (!o) throw notFound("Sales order");
    const b = o.branch_id;
    if (!can(ctx, "invoices", "view", b) && !can(ctx, "stock", "create", b)) throw forbidden();
    const showPrices = canSee(ctx, "selling_price", b);
    const lines = (await c.query("SELECT l.*, i.part_no, i.name_ar, coalesce(sb.on_hand,0) - coalesce(sb.committed,0) - coalesce(sb.reserved,0) free FROM sales_order_line l JOIN item i ON i.id = l.item_id LEFT JOIN stock_balance sb ON sb.item_id = l.item_id AND sb.branch_id = l.branch_id WHERE l.order_id = $1 ORDER BY l.line_no", [id])).rows;
    const notes = (await c.query("SELECT d.*, u.full_name, i.doc_no invoice_no FROM delivery_note d LEFT JOIN app_user u ON u.id = d.delivered_by LEFT JOIN sales_invoice i ON i.id = d.invoice_id WHERE d.order_id = $1 ORDER BY d.delivered_at", [id])).rows;
    const invoices = (await c.query("SELECT id, doc_no, doc_date, grand_total, due_date, paid_amount FROM sales_invoice WHERE sales_order_id = $1 ORDER BY doc_no", [id])).rows;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strip = <T extends Record<string, any>>(r: T): T => {
      if (showPrices) return r;
      const x: Record<string, unknown> = { ...r };
      for (const k of ["unit_price", "discount_amount", "taxable_amount", "vat_amount", "line_total", "taxable_total", "vat_total", "grand_total", "invoiced_taxable", "invoiced_vat", "delivered_cost", "invoiced_cost", "credit_limit"]) delete x[k];
      return x as T;
    };
    const items = can(ctx, "invoices", "create", b) && o.status === "quote" ? (await c.query(
      `SELECT i.id, i.part_no, i.description, i.search_codes codes FROM item i WHERE i.active AND i.item_type IN ('stock','consumable') ORDER BY i.part_no`)).rows : [];
    return {
      o: strip(o), lines: lines.map(strip), notes: notes.map((n) => strip(n)), invoices: showPrices ? invoices : [], items, showPrices,
      canEdit: can(ctx, "invoices", "create", b), canDeliver: can(ctx, "stock", "create", b) || can(ctx, "invoices", "create", b), canOverride: can(ctx, "invoices", "approve", b),
    };
  });
}

/** The delivery note to print and have signed. No prices. */
export async function deliveryNotePrint(ctx: Ctx, dnId: string) {
  return withTx(ctx, async (c) => {
    const d = (await c.query(
      `SELECT d.*, o.doc_no order_no, o.customer_ref, coalesce(cu.company_name, concat_ws(' ', cu.first_name, cu.last_name)) customer_name, cu.name_ar customer_name_ar, cu.mobile, cu.trn customer_trn, cu.address
         FROM delivery_note d JOIN sales_order o ON o.id = d.order_id JOIN customer cu ON cu.id = o.customer_id WHERE d.id = $1`, [dnId])).rows[0];
    if (!d) throw notFound("Delivery note");
    if (!can(ctx, "invoices", "view", d.branch_id) && !can(ctx, "stock", "view", d.branch_id)) throw forbidden();
    const lines = (await c.query("SELECT dl.qty, i.part_no, i.description, i.name_ar FROM delivery_note_line dl JOIN item i ON i.id = dl.item_id WHERE dl.dn_id = $1 ORDER BY i.part_no", [dnId])).rows;
    return { d, lines, setup: await setupIn(c, d.branch_id, "delivery_note") };
  });
}
