import { blockSql, toChunk } from "../paging";
import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canSee, redact } from "../access";
import { withTx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal } from "./ledger";
import { D, Decimal, r2, parseDec } from "../money";
import { optStr, required, str, normaliseTrn } from "../validate";
import { addDot, stockIn, stockOut, today } from "./stock";
import { categoriesOf, registerHandler, submitForApproval } from "./workflow";
import { getSetting } from "./settings";
import { cfVisible, customFields } from "./hr";

/** M08 purchasing: purchase orders, goods received, supplier bills with matching, petty cash. */

function here(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}
// PO and bill amounts are purchase-cost fields (FP-01): hidden from roles without cost access.
const PO_COST = { net_total: "purchase_cost", vat_total: "purchase_cost", grand_total: "purchase_cost" };
const LINE_COST = { unit_price: "purchase_cost", discount: "purchase_cost", net_amount: "purchase_cost", vat_amount: "purchase_cost", line_total: "purchase_cost", unit_cost: "purchase_cost", value: "purchase_cost", received_value: "purchase_cost" };

// =====================================================================================
// Purchase orders (PU-02, PU-03, PC-06)
// =====================================================================================

export async function createPo(ctx: Ctx, f: Record<string, unknown>) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "create", b);
  return withTx(ctx, async (c) => newPo(c, ctx, b, required(f.supplier_id, "Supplier"), f));
}

export async function newPo(c: PoolClient, ctx: Ctx, b: string, supplierId: string, f: Record<string, unknown>) {
  const s = (await c.query("SELECT id FROM supplier WHERE id = $1 AND active", [supplierId])).rows[0];
  if (!s) throw invalid("Choose an active supplier.");
  const delivery = optStr(f.delivery_date);
  if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) throw invalid("Delivery date is not valid.");
  const docNo = await nextDocNo(c, b, "purchase_order");
  const po = (await c.query("INSERT INTO purchase_order (branch_id, doc_no, supplier_id, delivery_date, terms, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [b, docNo, supplierId, delivery, optStr(f.terms), optStr(f.note), ctx.userId])).rows[0];
  await audit(c, ctx, "purchase_order", po.id, "created", { doc_no: docNo }, b);
  return { id: po.id as string, docNo };
}

async function lockPoForEdit(c: PoolClient, ctx: Ctx, poId: string) {
  const po = (await c.query("SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE", [poId])).rows[0];
  if (!po) throw notFound("Purchase order");
  // The person who raises orders (create) can build them; edit rights are needed for anything else.
  if (!can(ctx, "purchasing", "create", po.branch_id) && !can(ctx, "purchasing", "edit", po.branch_id)) throw forbidden();
  if (!["draft", "rejected", "approved"].includes(po.status)) throw invalid("This purchase order can no longer be changed.");
  if (po.status === "approved") {
    const rec = await c.query("SELECT 1 FROM po_line WHERE po_id = $1 AND received_qty > 0", [poId]);
    if (rec.rowCount) throw invalid("Goods have been received on this order; it can no longer be changed.");
    // WF-08: changing an approved order sends it back for approval.
    await c.query("UPDATE purchase_order SET status = 'draft', approved_at = NULL WHERE id = $1", [poId]);
  }
  return po;
}

async function recalcPo(c: PoolClient, poId: string) {
  await c.query(
    `UPDATE purchase_order p SET net_total = t.n, vat_total = t.v, grand_total = t.n + t.v, version = version + 1
       FROM (SELECT coalesce(sum(net_amount),0) n, coalesce(sum(vat_amount),0) v FROM po_line WHERE po_id = $1) t WHERE p.id = $1`, [poId]);
}

export async function addPoLine(ctx: Ctx, poId: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const po = await lockPoForEdit(c, ctx, poId);
    return insertPoLine(c, po, f);
  });
}

export async function insertPoLine(c: PoolClient, po: { id: string; branch_id: string }, f: Record<string, unknown>) {
  const qty = parseDec(f.qty, "Quantity", { min: "0.001", dp: 3 });
  const price = parseDec(f.unit_price, "Unit price", { min: 0, dp: 4 });
  const disc = str(f.discount) ? parseDec(f.discount, "Discount", { min: 0, dp: 2 }) : D(0);
  let description = optStr(f.description);
  let vatCode = optStr(f.vat_code);
  const itemId = optStr(f.item_id);
  if (itemId) {
    const it = (await c.query("SELECT * FROM item WHERE id = $1 AND active", [itemId])).rows[0];
    if (!it) throw invalid("Item not found.");
    description = description ?? `${it.part_no} ${it.description}`;
    vatCode = vatCode ?? it.vat_code;
  }
  if (!description) throw invalid("Choose an item or describe the purchase.");
  const tax = (await c.query("SELECT rate FROM tax_code WHERE code = $1", [vatCode ?? "SR"])).rows[0];
  if (!tax) throw invalid("Tax code not found.");
  const gross = r2(qty.mul(price));
  if (disc.gt(gross)) throw invalid("Discount cannot exceed the line amount.");
  const net = gross.minus(disc);
  const vat = r2(net.mul(tax.rate));
  const n = (await c.query("SELECT coalesce(max(line_no),0)+1 n FROM po_line WHERE po_id = $1", [po.id])).rows[0].n;
  const jobLine = optStr(f.job_line_id);
  await c.query(
    `INSERT INTO po_line (po_id, branch_id, line_no, item_id, description, qty, unit_price, discount, vat_code, net_amount, vat_amount, line_total, job_line_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [po.id, po.branch_id, n, itemId, description, qty.toFixed(3), price.toFixed(4), disc.toFixed(2), vatCode ?? "SR", net.toFixed(2), vat.toFixed(2), net.plus(vat).toFixed(2), jobLine]);
  await recalcPo(c, po.id);
}

export async function removePoLine(ctx: Ctx, lineId: string) {
  return withTx(ctx, async (c) => {
    const l = (await c.query("SELECT * FROM po_line WHERE id = $1", [lineId])).rows[0];
    if (!l) throw notFound("Order line");
    await lockPoForEdit(c, ctx, l.po_id);
    if (l.job_line_id) await c.query("UPDATE stock_commitment SET source_type = NULL, source_ref = NULL WHERE job_line_id = $1 AND status = 'active' AND source_type = 'po'", [l.job_line_id]);
    await c.query("DELETE FROM po_line WHERE id = $1", [lineId]);
    await recalcPo(c, l.po_id);
  });
}

/** PU-02: approval by amount and role through the purchase order workflow. */
export async function submitPo(ctx: Ctx, poId: string) {
  return withTx(ctx, async (c) => {
    const po = (await c.query("SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE", [poId])).rows[0];
    if (!po) throw notFound("Purchase order");
    assertCan(ctx, "purchasing", "create", po.branch_id);
    if (!["draft", "rejected"].includes(po.status)) throw invalid("Only a draft order can be submitted.");
    const n = (await c.query("SELECT count(*) n FROM po_line WHERE po_id = $1", [poId])).rows[0].n;
    if (!Number(n)) throw invalid("Add at least one line.");
    const r = await submitForApproval(c, ctx, { docType: "purchase_order", docId: poId, docRef: po.doc_no, branchId: po.branch_id, amount: po.grand_total, summary: { supplier: po.supplier_id },
      supplierId: po.supplier_id, itemCategories: await categoriesOf(c, (await c.query("SELECT item_id FROM po_line WHERE po_id = $1", [poId])).rows.map((r) => r.item_id)) });
    await c.query("UPDATE purchase_order SET status = $2, approved_at = CASE WHEN $2 = 'approved' THEN now() END, version = version + 1 WHERE id = $1",
      [poId, r.status === "approved" ? "approved" : "pending_approval"]);
    await audit(c, ctx, "purchase_order", poId, "submitted", { total: po.grand_total, result: r.status }, po.branch_id);
    return r.status;
  });
}

registerHandler("purchase_order", {
  onApproved: async (c, _ctx, req) => {
    await c.query("UPDATE purchase_order SET status = 'approved', approved_at = now(), version = version + 1 WHERE id = $1 AND status = 'pending_approval'", [req.doc_id]);
  },
  onRejected: async (c, _ctx, req, comment) => {
    await c.query("UPDATE purchase_order SET status = 'rejected', note = coalesce(note || ' · ', '') || 'Rejected: ' || $2, version = version + 1 WHERE id = $1", [req.doc_id, comment]);
  },
});

export async function cancelPo(ctx: Ctx, poId: string) {
  return withTx(ctx, async (c) => {
    const po = (await c.query("SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE", [poId])).rows[0];
    if (!po) throw notFound("Purchase order");
    assertCan(ctx, "purchasing", "cancel", po.branch_id);
    if ((await c.query("SELECT 1 FROM po_line WHERE po_id = $1 AND received_qty > 0", [poId])).rowCount) throw invalid("Goods have been received; the order cannot be cancelled.");
    if (po.status === "pending_approval") await c.query("UPDATE approval_request SET status = 'recalled', decided_at = now() WHERE doc_type = 'purchase_order' AND doc_id = $1 AND status = 'pending'", [poId]);
    await c.query("UPDATE purchase_order SET status = 'cancelled', version = version + 1 WHERE id = $1", [poId]);
    await c.query(`UPDATE stock_commitment SET source_type = NULL, source_ref = NULL, expected_date = NULL
                    WHERE status = 'active' AND source_ref = $2 AND job_line_id IN (SELECT job_line_id FROM po_line WHERE po_id = $1)`, [poId, po.doc_no]);
    await audit(c, ctx, "purchase_order", poId, "cancelled", {}, po.branch_id);
  });
}

/** PC-06: "Raise PO" from the planning screen: a draft PO to the preferred supplier, linked to the job line. */
export async function raisePoForBackOrder(ctx: Ctx, commitmentId: string, supplierId?: string) {
  return withTx(ctx, async (c) => {
    const sc = (await c.query("SELECT sc.*, i.preferred_supplier_id FROM stock_commitment sc JOIN item i ON i.id = sc.item_id WHERE sc.id = $1 AND sc.status = 'active'", [commitmentId])).rows[0];
    if (!sc || D(sc.back_ordered).lte(0)) throw invalid("Nothing is back-ordered on this line.");
    assertCan(ctx, "purchasing", "create", sc.branch_id);
    if (sc.source_ref) throw invalid(`Already being sourced by ${sc.source_ref}.`);
    const sup = supplierId || sc.preferred_supplier_id;
    if (!sup) throw invalid("This item has no preferred supplier. Choose one.");
    const po = await newPo(c, ctx, sc.branch_id, sup, { note: "For a back-ordered job line" });
    const cost = (await c.query("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [sc.item_id, sc.branch_id])).rows[0]?.avg_cost ?? 0;
    await insertPoLine(c, { id: po.id, branch_id: sc.branch_id }, { item_id: sc.item_id, qty: sc.back_ordered, unit_price: D(cost).toFixed(4), job_line_id: sc.job_line_id });
    await c.query("UPDATE stock_commitment SET source_type = 'po', source_ref = $2 WHERE id = $1", [commitmentId, po.docNo]);
    return po;
  });
}

/** Low-stock list: one purchase order (draft) for the suggested quantity, at the last average cost. */
export async function raiseReorderPo(ctx: Ctx, itemId: string, qty: unknown, supplierId?: string) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "create", b);
  const q = parseDec(qty, "Quantity", { min: "0.001", dp: 3 });
  return withTx(ctx, async (c) => {
    const it = (await c.query("SELECT id, preferred_supplier_id FROM item WHERE id = $1 AND active", [itemId])).rows[0];
    if (!it) throw invalid("Part not found.");
    const sup = supplierId || it.preferred_supplier_id;
    if (!sup) throw invalid("This part has no preferred supplier. Choose one.");
    const po = await newPo(c, ctx, b, sup, { note: "Reorder: stock at or below the reorder level" });
    const cost = (await c.query("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [itemId, b])).rows[0]?.avg_cost ?? 0;
    await insertPoLine(c, { id: po.id, branch_id: b }, { item_id: itemId, qty: q.toFixed(3), unit_price: D(cost).toFixed(4) });
    return po;
  });
}

export async function listPos(ctx: Ctx, status = "", offset = 0) {
  assertCan(ctx, "purchasing", "view");
  return toChunk(await withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT p.*, s.name_en supplier_name, b.code branch_code,
              (SELECT coalesce(sum(qty),0) FROM po_line WHERE po_id = p.id) ordered, (SELECT coalesce(sum(received_qty),0) FROM po_line WHERE po_id = p.id) received
         FROM purchase_order p JOIN supplier s ON s.id = p.supplier_id JOIN branch b ON b.id = p.branch_id
        WHERE ($1 = '' OR p.status = $1) ORDER BY p.created_at DESC ${blockSql(offset)}`, [status])).rows;
    return redact(ctx, rows, PO_COST, (r) => r.branch_id as string);
  }), offset);
}

export async function getPo(ctx: Ctx, id: string) {
  assertCan(ctx, "purchasing", "view");
  return withTx(ctx, async (c) => {
    const po = (await c.query("SELECT p.*, s.name_en supplier_name, s.code supplier_code, b.code branch_code FROM purchase_order p JOIN supplier s ON s.id = p.supplier_id JOIN branch b ON b.id = p.branch_id WHERE p.id = $1", [id])).rows[0];
    if (!po) throw notFound("Purchase order");
    const lines = (await c.query(
      `SELECT pl.*, i.part_no, i.item_type, i.category, j.doc_no job_no, j.id job_id FROM po_line pl LEFT JOIN item i ON i.id = pl.item_id
         LEFT JOIN job_line jl ON jl.id = pl.job_line_id LEFT JOIN job_card j ON j.id = jl.job_card_id WHERE pl.po_id = $1 ORDER BY pl.line_no`, [id])).rows;
    const grns = (await c.query("SELECT g.*, u.full_name FROM grn g LEFT JOIN app_user u ON u.id = g.received_by WHERE g.po_id = $1 ORDER BY g.received_at", [id])).rows;
    const grnLines = (await c.query(
      `SELECT gl.id, gl.grn_id, i.part_no, i.description, gl.qty, gl.billed_qty, gl.returned_qty, gl.qty - gl.billed_qty - gl.returned_qty returnable
         FROM grn_line gl JOIN grn g ON g.id = gl.grn_id JOIN item i ON i.id = gl.item_id WHERE g.po_id = $1 ORDER BY i.part_no`, [id])).rows;
    const returns = (await c.query(
      `SELECT r.*, g.doc_no grn_no, lv.name_en reason_name, u.full_name FROM supplier_return r JOIN grn g ON g.id = r.grn_id
         LEFT JOIN lookup_value lv ON lv.list = 'supplier_return_reason' AND lv.code = r.reason LEFT JOIN app_user u ON u.id = r.created_by
        WHERE g.po_id = $1 ORDER BY r.created_at`, [id])).rows;
    const returnReasons = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'supplier_return_reason' AND active ORDER BY sort")).rows;
    const approvals = (await c.query(
      `SELECT a.*, u.full_name, t.step_name FROM approval_action a JOIN approval_request r ON r.id = a.request_id LEFT JOIN app_user u ON u.id = a.user_id
         LEFT JOIN approval_task t ON t.id = a.task_id WHERE r.doc_type = 'purchase_order' AND r.doc_id = $1 ORDER BY a.at`, [id])).rows;
    return { po: redact(ctx, [po], PO_COST, () => po.branch_id)[0], lines: redact(ctx, lines, LINE_COST, () => po.branch_id), grns, grnLines, returns, returnReasons, approvals };
  });
}

// =====================================================================================
// Goods received (PU-04) — stock at the order's unit cost; job-linked lines are committed first (PC-08)
// =====================================================================================

export async function receiveGoods(ctx: Ctx, poId: string, f: { delivery_note?: string; qty: Record<string, unknown>; damaged?: Record<string, unknown>; dot?: Record<string, unknown> }) {
  return withTx(ctx, async (c) => {
    const po = (await c.query("SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE", [poId])).rows[0];
    if (!po) throw notFound("Purchase order");
    if (!can(ctx, "stock", "create", po.branch_id) && !can(ctx, "purchasing", "edit", po.branch_id)) throw forbidden();
    if (!["approved", "partly_received"].includes(po.status)) throw invalid("Goods can be received only on an approved order.");
    const lines = (await c.query("SELECT pl.*, i.item_type, i.category FROM po_line pl JOIN item i ON i.id = pl.item_id WHERE pl.po_id = $1 AND pl.item_id IS NOT NULL ORDER BY line_no FOR UPDATE OF pl", [poId])).rows;
    const docNo = await nextDocNo(c, po.branch_id, "grn");
    const g = (await c.query("INSERT INTO grn (branch_id, doc_no, po_id, supplier_id, delivery_note, received_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [po.branch_id, docNo, poId, po.supplier_id, optStr(f.delivery_note), ctx.userId])).rows[0];
    let total = D(0);
    let any = false;
    for (const l of lines) {
      if (!str(f.qty[l.id])) continue;
      const q = parseDec(f.qty[l.id], "Received quantity", { min: 0, dp: 3 });
      const dmg = str(f.damaged?.[l.id]) ? parseDec(f.damaged?.[l.id], "Damaged quantity", { min: 0, dp: 3 }) : D(0);
      if (q.eq(0) && dmg.eq(0)) continue;
      if (D(l.received_qty).plus(q).gt(l.qty)) throw invalid(`More than ordered on line ${l.line_no}. Order the extra quantity first.`);
      const unitCost = D(l.net_amount).div(l.qty).toDecimalPlaces(4);
      if (q.gt(0)) {
        any = true;
        const r = await stockIn(c, ctx, { branchId: po.branch_id, itemId: l.item_id, qty: q, unitCost, moveType: "receipt", ref: docNo, preferLineIds: l.job_line_id ? [l.job_line_id] : [] });
        total = total.plus(r.value);
        const dot = str(f.dot?.[l.id]) || null;
        if (dot) await addDot(c, po.branch_id, l.item_id, dot, q);
        else if (l.category === "tyres" && await getSetting(c, "tyres.dot_required", po.branch_id, false) === true) throw invalid(`Line ${l.line_no}: enter the tyres' DOT (week and year made).`);
        await c.query("INSERT INTO grn_line (grn_id, branch_id, po_line_id, item_id, qty, damaged_qty, unit_cost, value, dot_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [g.id, po.branch_id, l.id, l.item_id, q.toFixed(3), dmg.toFixed(3), unitCost.toFixed(4), r.value.toFixed(2), dot]);
        await c.query("UPDATE po_line SET received_qty = received_qty + $2 WHERE id = $1", [l.id, q.toFixed(3)]);
      }
    }
    if (!any) throw invalid("Enter the quantity received on at least one line.");
    await postJournal(c, ctx, { branchId: po.branch_id, date: today(), sourceType: "grn", sourceId: g.id, narration: `${docNo} against ${po.doc_no}`,
      lines: [{ event: "inventory", debit: total }, { event: "goods_received_clearing", credit: total }] });
    const open = (await c.query("SELECT count(*) n FROM po_line WHERE po_id = $1 AND item_id IS NOT NULL AND received_qty < qty", [poId])).rows[0].n;
    await c.query("UPDATE purchase_order SET status = $2, version = version + 1 WHERE id = $1", [poId, Number(open) ? "partly_received" : "received"]);
    await audit(c, ctx, "grn", g.id, "received", { po: po.doc_no, value: total.toFixed(2) }, po.branch_id);
    return { id: g.id as string, docNo };
  });
}

// =====================================================================================
// Returns to the supplier (PU-04): received parts that are not billed yet go back
// =====================================================================================

/**
 * Sends received parts back to the supplier before they are billed. The parts leave free stock at
 * average cost; the goods-received clearing is reversed at the received cost, and any difference
 * between the two goes to stock write-off. The order line opens again so a replacement can be
 * received, and the returned quantity can no longer be billed. Parts already billed go back through a
 * debit note voucher to the supplier instead.
 */
export async function returnToSupplier(ctx: Ctx, grnId: string, f: { reason?: string; note?: string; qty: Record<string, unknown> }) {
  return withTx(ctx, async (c) => {
    const g = (await c.query("SELECT g.*, p.doc_no po_no, p.status po_status FROM grn g JOIN purchase_order p ON p.id = g.po_id WHERE g.id = $1 FOR UPDATE OF g", [grnId])).rows[0];
    if (!g) throw notFound("Goods received note");
    if (!can(ctx, "stock", "create", g.branch_id) && !can(ctx, "purchasing", "edit", g.branch_id)) throw forbidden();
    const reason = str(f.reason);
    if (!reason || !(await c.query("SELECT 1 FROM lookup_value WHERE list = 'supplier_return_reason' AND code = $1 AND active", [reason])).rowCount) throw invalid("Choose why the parts go back.");
    if (reason === "other" && !optStr(f.note)) throw invalid("Write a note when the reason is Other.");
    const lines = (await c.query("SELECT gl.*, i.part_no FROM grn_line gl JOIN item i ON i.id = gl.item_id WHERE gl.grn_id = $1 ORDER BY i.part_no FOR UPDATE OF gl", [grnId])).rows;
    const docNo = await nextDocNo(c, g.branch_id, "supplier_return");
    const r = (await c.query("INSERT INTO supplier_return (branch_id, doc_no, grn_id, supplier_id, reason, note, value, created_by) VALUES ($1,$2,$3,$4,$5,$6,0,$7) RETURNING id",
      [g.branch_id, docNo, grnId, g.supplier_id, reason, optStr(f.note), ctx.userId])).rows[0];
    let received = D(0), stockValue = D(0);
    for (const l of lines) {
      if (!str(f.qty[l.id])) continue;
      const q = parseDec(f.qty[l.id], "Quantity to return", { min: 0, dp: 3 });
      if (q.eq(0)) continue;
      const open = D(l.qty).minus(l.billed_qty).minus(l.returned_qty);
      if (q.gt(open)) throw invalid(`${l.part_no}: only ${open.toString()} can go back (the rest is billed or already returned). For billed parts, raise a debit note to the supplier.`);
      const out = await stockOut(c, ctx, { branchId: g.branch_id, itemId: l.item_id, qty: q, moveType: "supplier_return", ref: docNo });
      const value = r2(q.mul(l.unit_cost));
      received = received.plus(value); stockValue = stockValue.plus(out.value);
      await c.query("INSERT INTO supplier_return_line (return_id, branch_id, grn_line_id, item_id, qty, unit_cost, value) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [r.id, g.branch_id, l.id, l.item_id, q.toFixed(3), D(l.unit_cost).toFixed(4), value.toFixed(2)]);
      await c.query("UPDATE grn_line SET returned_qty = returned_qty + $2 WHERE id = $1", [l.id, q.toFixed(3)]);
      await c.query("UPDATE po_line SET received_qty = received_qty - $2 WHERE id = $1", [l.po_line_id, q.toFixed(3)]);
    }
    if (received.eq(0)) throw invalid("Enter the quantity to send back on at least one line.");
    const diff = received.minus(stockValue);
    await postJournal(c, ctx, { branchId: g.branch_id, date: today(), sourceType: "supplier_return", sourceId: r.id, narration: `${docNo}: return to supplier against ${g.doc_no}`,
      lines: [{ event: "goods_received_clearing", debit: received }, { event: "inventory", credit: stockValue },
        ...(diff.gt(0) ? [{ event: "stock_writeoff", credit: diff }] : diff.lt(0) ? [{ event: "stock_writeoff", debit: diff.neg() }] : [])] });
    await c.query("UPDATE supplier_return SET value = $2 WHERE id = $1", [r.id, received.toFixed(2)]);
    if (["received", "partly_received"].includes(g.po_status)) {
      const open = (await c.query("SELECT count(*) n FROM po_line WHERE po_id = $1 AND item_id IS NOT NULL AND received_qty < qty", [g.po_id])).rows[0].n;
      await c.query("UPDATE purchase_order SET status = $2, version = version + 1 WHERE id = $1", [g.po_id, Number(open) ? "partly_received" : "received"]);
    }
    await audit(c, ctx, "grn", grnId, "returned_to_supplier", { doc_no: docNo, reason, value: received.toFixed(2) }, g.branch_id);
    return { id: r.id as string, docNo };
  });
}

// =====================================================================================
// Supplier bills with three-way match (PU-05, PU-07)
// =====================================================================================

type BillLineIn = { grn_line_id?: string; description?: string; expense_type?: string; qty: unknown; unit_price: unknown; vat_code?: string };

export async function createBill(ctx: Ctx, f: { supplier_id: string; supplier_invoice_no: string; invoice_date: string; lines: BillLineIn[] }) {
  let b = here(ctx);
  const invNo = required(f.supplier_invoice_no, "Supplier invoice no.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f.invoice_date))) throw invalid("Invoice date is required.");
  const lines = f.lines.filter((l) => str(l.qty) && str(l.unit_price));
  if (!lines.length) throw invalid("Add at least one line.");
  return withTx(ctx, async (c) => {
    const sup = (await c.query("SELECT * FROM supplier WHERE id = $1", [f.supplier_id])).rows[0];
    if (!sup) throw invalid("Choose a supplier.");
    // A bill against goods received belongs to the branch that received them, so the receipt clearing account nets off there.
    const grnIds = lines.map((l) => l.grn_line_id).filter(Boolean);
    if (grnIds.length) {
      const brs = (await c.query("SELECT DISTINCT branch_id FROM grn_line WHERE id = ANY($1::uuid[])", [grnIds])).rows;
      if (brs.length > 1) throw invalid("Enter a separate bill for each branch's receipts.");
      if (brs[0]) b = brs[0].branch_id;
    }
    if (!can(ctx, "purchasing", "edit", b) && !can(ctx, "accounting", "create", b)) throw forbidden();
    const dup = await c.query("SELECT doc_no FROM supplier_bill WHERE supplier_id = $1 AND supplier_invoice_no = $2 AND status <> 'rejected'", [f.supplier_id, invNo]);
    if (dup.rowCount) throw invalid(`This supplier invoice is already entered as ${dup.rows[0].doc_no}.`);
    const tolPct = D(await getSetting(c, "purchasing.price_tolerance_pct", b, 1));
    const tolAmt = D(await getSetting(c, "purchasing.price_tolerance_amount", b, 5));
    const prepared: { l: BillLineIn; q: Decimal; p: Decimal; net: Decimal; vat: Decimal; code: string; recv: Decimal | null; note: string | null; desc: string }[] = [];
    let mismatch = false, anyGrn = false;
    for (const l of lines) {
      const q = parseDec(l.qty, "Quantity", { min: "0.001", dp: 3 });
      const p = parseDec(l.unit_price, "Unit price", { min: 0, dp: 4 });
      const net = r2(q.mul(p));
      let code = l.vat_code || "SR", recv: Decimal | null = null, note: string | null = null, desc = str(l.description);
      if (l.grn_line_id) {
        anyGrn = true;
        const gl = (await c.query(
          `SELECT gl.*, g.supplier_id, g.doc_no grn_no, pl.vat_code, pl.description FROM grn_line gl JOIN grn g ON g.id = gl.grn_id JOIN po_line pl ON pl.id = gl.po_line_id
            WHERE gl.id = $1 FOR UPDATE OF gl`, [l.grn_line_id])).rows[0];
        if (!gl || gl.supplier_id !== f.supplier_id) throw invalid("A received line does not belong to this supplier.");
        code = gl.vat_code; desc = desc || `${gl.description} (${gl.grn_no})`;
        const open = D(gl.qty).minus(gl.billed_qty).minus(gl.returned_qty);
        recv = r2(q.mul(gl.unit_cost));
        const diff = net.minus(recv).abs();
        const allowed = Decimal.max(r2(recv.mul(tolPct).div(100)), tolAmt);
        if (!q.eq(open)) { mismatch = true; note = `Quantity ${q.toString()} billed, ${open.toString()} received and not yet billed`; }
        else if (diff.gt(allowed)) { mismatch = true; note = `Price differs by AED ${diff.toFixed(2)} (allowed ${allowed.toFixed(2)})`; }
        if (q.gt(open)) throw invalid(`Billed quantity is more than received on ${gl.grn_no}.`);
      } else if (!desc || !l.expense_type) throw invalid("A line without a received item needs a description and an expense type.");
      const tax = (await c.query("SELECT rate FROM tax_code WHERE code = $1", [code])).rows[0];
      if (!tax) throw invalid("Tax code not found.");
      prepared.push({ l, q, p, net, vat: r2(net.mul(tax.rate)), code, recv, note, desc });
    }
    const netT = prepared.reduce((s, x) => s.plus(x.net), D(0));
    const vatT = prepared.reduce((s, x) => s.plus(x.vat), D(0));
    // Reverse charge (imports, AC-07): the supplier does not charge the VAT; we account for it ourselves, so it is not owed to the supplier.
    const rcVat = prepared.filter((x) => x.code === "RC").reduce((s, x) => s.plus(x.vat), D(0));
    const docNo = await nextDocNo(c, b, "supplier_bill");
    const due = new Date(f.invoice_date + "T00:00:00Z"); due.setUTCDate(due.getUTCDate() + Number(sup.payment_terms_days));
    const match = mismatch ? "mismatch" : anyGrn ? "matched" : "no_po";
    const bill = (await c.query(
      `INSERT INTO supplier_bill (branch_id, doc_no, supplier_id, supplier_invoice_no, invoice_date, due_date, match_status, net_total, vat_total, grand_total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b, docNo, f.supplier_id, invNo, f.invoice_date, due.toISOString().slice(0, 10), match, netT.toFixed(2), vatT.toFixed(2), netT.plus(vatT).minus(rcVat).toFixed(2), ctx.userId])).rows[0];
    for (const x of prepared) {
      await c.query(
        `INSERT INTO supplier_bill_line (bill_id, branch_id, grn_line_id, description, expense_type, qty, unit_price, vat_code, net_amount, vat_amount, received_value, match_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [bill.id, b, x.l.grn_line_id || null, x.desc, x.l.grn_line_id ? null : x.l.expense_type, x.q.toFixed(3), x.p.toFixed(4), x.code, x.net.toFixed(2), x.vat.toFixed(2), x.recv?.toFixed(2) ?? null, x.note]);
      if (x.l.grn_line_id) await c.query("UPDATE grn_line SET billed_qty = billed_qty + $2 WHERE id = $1", [x.l.grn_line_id, x.q.toFixed(3)]);
    }
    await audit(c, ctx, "supplier_bill", bill.id, "entered", { invoice: invNo, match }, b);
    // A matched bill (or one with no PO, e.g. a service invoice) posts at once; a mismatch goes for approval.
    if (mismatch) {
      const r = await submitForApproval(c, ctx, { docType: "supplier_bill", docId: bill.id, docRef: docNo, branchId: b, amount: netT.plus(vatT).toFixed(2), summary: { supplier: sup.name_en }, supplierId: f.supplier_id,
        itemCategories: await categoriesOf(c, (await c.query("SELECT gl.item_id FROM supplier_bill_line bl JOIN grn_line gl ON gl.id = bl.grn_line_id WHERE bl.bill_id = $1", [bill.id])).rows.map((r) => r.item_id)) });
      if (r.status === "approved") await postBill(c, ctx, bill.id);
    } else await postBill(c, ctx, bill.id);
    return { id: bill.id as string, docNo, match };
  });
}

/** Dr goods-received clearing (at received value) + price difference, Dr expense, Dr input VAT; Cr the supplier. */
async function postBill(c: PoolClient, ctx: Ctx, id: string) {
  const bill = (await c.query("SELECT * FROM supplier_bill WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!bill || bill.status !== "pending_approval") throw conflict("This bill has already been dealt with.");
  const lines = (await c.query("SELECT * FROM supplier_bill_line WHERE bill_id = $1", [id])).rows;
  const recv = lines.filter((l) => l.grn_line_id).reduce((s, l) => s.plus(l.received_value), D(0));
  const recvNet = lines.filter((l) => l.grn_line_id).reduce((s, l) => s.plus(l.net_amount), D(0));
  const expense = lines.filter((l) => !l.grn_line_id).reduce((s, l) => s.plus(l.net_amount), D(0));
  const variance = recvNet.minus(recv);
  const rcVat = lines.filter((l) => l.vat_code === "RC").reduce((s, l) => s.plus(l.vat_amount), D(0));
  await postJournal(c, ctx, {
    branchId: bill.branch_id, date: bill.invoice_date instanceof Date ? bill.invoice_date.toISOString().slice(0, 10) : String(bill.invoice_date),
    sourceType: "supplier_bill", sourceId: id, narration: `Supplier bill ${bill.doc_no} (${bill.supplier_invoice_no})`,
    lines: [
      { event: "goods_received_clearing", debit: recv },
      { event: "purchase_price_variance", debit: Decimal.max(variance, 0), credit: Decimal.max(variance.neg(), 0) },
      { event: "general_expense", debit: expense },
      { event: "vat_input", debit: bill.vat_total },
      { event: "vat_output", credit: rcVat, narration: "Reverse charge VAT accounted for by us" },
      { event: "trade_payable", credit: bill.grand_total, supplierId: bill.supplier_id },
    ],
  });
  await c.query("UPDATE supplier_bill SET status = 'posted', posted_at = now(), version = version + 1 WHERE id = $1", [id]);
}

registerHandler("supplier_bill", {
  onApproved: async (c, ctx, req) => postBill(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req) => {
    await c.query("UPDATE supplier_bill SET status = 'rejected', version = version + 1 WHERE id = $1", [req.doc_id]);
    await c.query("UPDATE grn_line gl SET billed_qty = gl.billed_qty - bl.qty FROM supplier_bill_line bl WHERE bl.bill_id = $1 AND bl.grn_line_id = gl.id", [req.doc_id]);
  },
});

/** Received lines of a supplier that are not fully billed, for the bill form. */
export async function unbilledLines(ctx: Ctx, supplierId: string) {
  assertCan(ctx, "purchasing", "view");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT gl.id, g.doc_no grn_no, p.doc_no po_no, i.part_no, pl.description, gl.qty - gl.billed_qty - gl.returned_qty open_qty, gl.unit_cost, gl.branch_id
         FROM grn_line gl JOIN grn g ON g.id = gl.grn_id JOIN purchase_order p ON p.id = g.po_id JOIN po_line pl ON pl.id = gl.po_line_id JOIN item i ON i.id = gl.item_id
        WHERE g.supplier_id = $1 AND gl.billed_qty + gl.returned_qty < gl.qty ORDER BY g.received_at, i.part_no`, [supplierId])).rows;
    return redact(ctx, rows, LINE_COST, (r) => r.branch_id as string);
  });
}

export async function listBills(ctx: Ctx, offset = 0) {
  assertCan(ctx, "purchasing", "view");
  return toChunk(await withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT sb.*, s.name_en supplier_name, b.code branch_code FROM supplier_bill sb JOIN supplier s ON s.id = sb.supplier_id JOIN branch b ON b.id = sb.branch_id
        ORDER BY sb.created_at DESC ${blockSql(offset)}`)).rows;
    return redact(ctx, rows, PO_COST, (r) => r.branch_id as string);
  }), offset);
}

export async function getBill(ctx: Ctx, id: string) {
  assertCan(ctx, "purchasing", "view");
  return withTx(ctx, async (c) => {
    const bill = (await c.query("SELECT sb.*, s.name_en supplier_name FROM supplier_bill sb JOIN supplier s ON s.id = sb.supplier_id WHERE sb.id = $1", [id])).rows[0];
    if (!bill) throw notFound("Supplier bill");
    const lines = (await c.query("SELECT * FROM supplier_bill_line WHERE bill_id = $1 ORDER BY id", [id])).rows;
    return { bill: redact(ctx, [bill], PO_COST, () => bill.branch_id)[0], lines: redact(ctx, lines, LINE_COST, () => bill.branch_id) };
  });
}

// =====================================================================================
// Petty cash (PU-06): receipt photo required; input VAT only with the supplier's TRN
// =====================================================================================

export type Upload = { name: string; type: string; bytes: Buffer };

/** FILE-02: the file's first bytes must match the type it claims (JPEG, PNG, WebP, HEIC or PDF). */
export function contentMatches(mime: string, b: Buffer) {
  const at = (i: number, sig: number[]) => sig.every((v, k) => b[i + k] === v);
  const ascii = (i: number, t: string) => b.subarray(i, i + t.length).toString("latin1") === t;
  switch (mime) {
    case "image/jpeg": return at(0, [0xff, 0xd8, 0xff]);
    case "image/png": return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp": return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/heic": return ascii(4, "ftyp") && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(b.subarray(8, 12).toString("latin1"));
    case "application/pdf": return b.subarray(0, 1024).toString("latin1").includes("%PDF-");
    default: return false;
  }
}

export async function saveAttachment(c: PoolClient, ctx: Ctx, branchId: string, entity: string, entityId: string | null, file: Upload) {
  if (!file.bytes.length) throw invalid("Attach the photo or PDF.");
  if (file.bytes.length > 5 * 1024 * 1024) throw invalid("The file is larger than 5 MB.");
  if (!/^image\/(jpeg|png|webp|heic)$|^application\/pdf$/.test(file.type)) throw invalid("Attach a photo (JPG or PNG) or a PDF.");
  if (!contentMatches(file.type, file.bytes)) throw invalid("This file is not a real photo or PDF (its content does not match its type). Save it again as JPG, PNG or PDF.");
  return (await c.query("INSERT INTO attachment (branch_id, entity, entity_id, file_name, mime, size_bytes, content, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [branchId, entity, entityId, file.name.slice(0, 200), file.type, file.bytes.length, file.bytes, ctx.userId])).rows[0].id as string;
}

/**
 * Serves a file only to someone who may open the record it belongs to (SEC-01): branch row security
 * alone is not enough. Employee files: the employee themself, or HR view at the employee's branch,
 * and for a custom field only if that field is visible to the role. Petty cash photos: purchasing
 * view at the branch. Anything else is refused. A refusal looks the same as a missing file.
 */
export async function getAttachment(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const a = (await c.query("SELECT * FROM attachment WHERE id = $1", [id])).rows[0];
    if (!a) throw notFound("Attachment");
    let ok = false;
    if (a.entity === "petty_cash_entry") ok = can(ctx, "purchasing", "view", a.branch_id);
    else if (a.entity === "job_checkin") ok = can(ctx, "jobs", "view", a.branch_id) || can(ctx, "workshop", "view", a.branch_id);
    else if (a.entity === "key_drop") ok = can(ctx, "customers", "view", a.branch_id);
    else if (String(a.entity).startsWith("employee_")) {
      const custom = a.entity === "employee_custom";
      const emp = (await c.query(
        custom
          ? "SELECT e.id, e.branch_id, e.user_id, kv.key field FROM employee e CROSS JOIN LATERAL jsonb_each_text(coalesce(e.custom, '{}'::jsonb)) kv WHERE kv.value = $1 LIMIT 1"
          : "SELECT id, branch_id, user_id, NULL field FROM employee WHERE id = $1",
        [custom ? id : a.entity_id])).rows[0];
      if (emp) {
        ok = emp.user_id === ctx.userId || can(ctx, "hr", "view", emp.branch_id);
        if (ok && custom) {
          const f = (await customFields(c)).find((x) => x.code === emp.field);
          ok = !!f && cfVisible(ctx, f, emp.branch_id);
        }
      }
    }
    if (!ok) throw notFound("Attachment");
    return a as { file_name: string; mime: string; content: Buffer };
  });
}

async function pettyBalance(c: PoolClient, b: string) {
  return D((await c.query("SELECT coalesce(sum(CASE WHEN kind = 'top_up' THEN net_amount ELSE -(net_amount + vat_amount) END),0) bal FROM petty_cash_entry WHERE branch_id = $1", [b])).rows[0].bal);
}

export async function pettyCashTopUp(ctx: Ctx, amount: unknown, note: unknown) {
  const b = here(ctx);
  if (!can(ctx, "accounting", "create", b) && !can(ctx, "purchasing", "approve", b)) throw forbidden("Only a branch manager or the accountant can top up petty cash.");
  const amt = parseDec(amount, "Amount", { min: "0.01", dp: 2 });
  return withTx(ctx, async (c) => {
    const docNo = await nextDocNo(c, b, "petty_cash");
    const e = (await c.query("INSERT INTO petty_cash_entry (branch_id, doc_no, kind, description, net_amount, created_by) VALUES ($1,$2,'top_up',$3,$4,$5) RETURNING id",
      [b, docNo, optStr(note) ?? "Top-up", amt.toFixed(2), ctx.userId])).rows[0];
    await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "petty_cash", sourceId: e.id, narration: `Petty cash top-up ${docNo}`,
      lines: [{ event: "petty_cash", debit: amt }, { event: "bank", credit: amt }] });
    await audit(c, ctx, "petty_cash_entry", e.id, "top_up", { amount: amt.toFixed(2) }, b);
  });
}

export async function pettyCashSpend(ctx: Ctx, f: Record<string, unknown>, photo: Upload | null) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "create", b);
  const net = parseDec(f.net_amount, "Amount before VAT", { min: "0.01", dp: 2 });
  const vat = str(f.vat_amount) ? parseDec(f.vat_amount, "VAT", { min: 0, dp: 2 }) : D(0);
  const trn = normaliseTrn(f.supplier_trn);
  if (vat.gt(0) && !trn) throw invalid("VAT can be claimed only with the supplier's TRN from the tax invoice. Enter the TRN or set VAT to 0.");
  if (vat.gt(r2(net.mul("0.05")).plus("0.01"))) throw invalid("VAT is more than 5% of the amount.");
  const type = required(f.expense_type, "Expense type");
  if (!photo || !photo.bytes.length) throw invalid("A photo of the receipt is required.");
  return withTx(ctx, async (c) => {
    const ok = await c.query("SELECT 1 FROM lookup_value WHERE list = 'expense_type' AND code = $1 AND active", [type]);
    if (!ok.rowCount) throw invalid("Choose an expense type from the list.");
    const bal = await pettyBalance(c, b);
    if (bal.lt(net.plus(vat))) throw invalid(`Not enough in petty cash (AED ${bal.toFixed(2)}).`);
    const docNo = await nextDocNo(c, b, "petty_cash");
    const e = (await c.query(
      `INSERT INTO petty_cash_entry (branch_id, doc_no, kind, supplier_name, supplier_trn, expense_type, description, net_amount, vat_amount, created_by)
       VALUES ($1,$2,'spend',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b, docNo, required(f.supplier_name, "Shop or supplier"), trn, type, optStr(f.description), net.toFixed(2), vat.toFixed(2), ctx.userId])).rows[0];
    const att = await saveAttachment(c, ctx, b, "petty_cash_entry", e.id, photo);
    await c.query("UPDATE petty_cash_entry SET attachment_id = $2 WHERE id = $1", [e.id, att]);
    await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "petty_cash", sourceId: e.id, narration: `Petty cash ${docNo}: ${type}`,
      lines: [{ event: "general_expense", debit: net }, { event: "vat_input", debit: vat }, { event: "petty_cash", credit: net.plus(vat) }] });
    await audit(c, ctx, "petty_cash_entry", e.id, "spend", { amount: net.plus(vat).toFixed(2), type }, b);
    return { docNo };
  });
}

export async function pettyCash(ctx: Ctx) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "view", b);
  return withTx(ctx, async (c) => ({
    balance: (await pettyBalance(c, b)).toFixed(2),
    rows: (await c.query(
      `SELECT e.*, u.full_name, lv.name_en expense_name FROM petty_cash_entry e LEFT JOIN app_user u ON u.id = e.created_by
         LEFT JOIN lookup_value lv ON lv.list = 'expense_type' AND lv.code = e.expense_type WHERE e.branch_id = $1 ORDER BY e.created_at DESC LIMIT 100`, [b])).rows,
    costOk: canSee(ctx, "purchase_cost", b) || can(ctx, "purchasing", "create", b),
  }));
}

export async function suppliers(ctx: Ctx) {
  return withTx(ctx, async (c) => (await c.query("SELECT id, code, name_en, payment_terms_days FROM supplier WHERE active ORDER BY name_en")).rows);
}

/**
 * Buy a part for one job (PU-03): paid from petty cash with the receipt photo, never in stock.
 * Either attaches the cost to an existing line of the job, or adds a new outside line at the selling
 * price (extra work, so the customer approves it first). Dr work in progress + input VAT, Cr petty cash.
 */
export async function directPurchase(ctx: Ctx, f: Record<string, unknown>, photo: Upload | null) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "create", b);
  const net = parseDec(f.net_amount, "Cost before VAT", { min: "0.01", dp: 2 });
  const vat = str(f.vat_amount) ? parseDec(f.vat_amount, "VAT", { min: 0, dp: 2 }) : D(0);
  const trn = normaliseTrn(f.supplier_trn);
  if (vat.gt(0) && !trn) throw invalid("VAT can be claimed only with the shop's TRN from the tax invoice. Enter the TRN or set VAT to 0.");
  if (vat.gt(r2(net.mul("0.05")).plus("0.01"))) throw invalid("VAT is more than 5% of the cost.");
  const what = required(f.description, "Part bought");
  const shop = required(f.supplier_name, "Shop or supplier");
  if (!photo || !photo.bytes.length) throw invalid("A photo of the receipt is required.");
  const { addLineIn } = await import("./jobs");
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT id, doc_no, branch_id, status FROM job_card WHERE id = $1 FOR UPDATE", [required(f.job_id, "Job card")])).rows[0];
    if (!j || j.branch_id !== b) throw invalid("Choose an open job card at this branch.");
    if (["invoiced", "closed", "cancelled", "delivered"].includes(j.status)) throw invalid(`Job ${j.doc_no} is ${j.status}; parts can no longer be added to it.`);
    let lineId = str(f.job_line_id);
    if (lineId === "new") {
      if (!can(ctx, "jobs", "edit", b)) throw invalid("Only the service advisor or the manager can add a new line to the job. Ask them to add it, or choose the line this part is for.");
      const price = str(f.unit_price) ? str(f.unit_price) : net.toFixed(2);
      lineId = (await addLineIn(c, ctx, { kind: "job", id: j.id }, { line_type: "outside", description: what, unit_price: price, qty: "1" })).id;
    } else {
      const l = (await c.query("SELECT id FROM job_line WHERE id = $1 AND job_card_id = $2 AND NOT removed FOR UPDATE", [lineId, j.id])).rows[0];
      if (!l) throw invalid("Choose the job line this part is for, or add it as a new line.");
      if ((await c.query("SELECT 1 FROM sales_invoice_line WHERE job_line_id = $1", [lineId])).rowCount) throw invalid("That line is invoiced already. Add the part as a new line.");
    }
    const bal = await pettyBalance(c, b);
    if (bal.lt(net.plus(vat))) throw invalid(`Not enough in petty cash (AED ${bal.toFixed(2)}).`);
    const docNo = await nextDocNo(c, b, "petty_cash");
    const e = (await c.query(
      `INSERT INTO petty_cash_entry (branch_id, doc_no, kind, supplier_name, supplier_trn, expense_type, description, net_amount, vat_amount, created_by, job_card_id, job_line_id)
       VALUES ($1,$2,'spend',$3,$4,'part_for_job',$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b, docNo, shop, trn, what, net.toFixed(2), vat.toFixed(2), ctx.userId, j.id, lineId])).rows[0];
    const att = await saveAttachment(c, ctx, b, "petty_cash_entry", e.id, photo);
    await c.query("UPDATE petty_cash_entry SET attachment_id = $2 WHERE id = $1", [e.id, att]);
    await c.query("UPDATE job_line SET direct_cost = direct_cost + $2, version = version + 1 WHERE id = $1", [lineId, net.toFixed(2)]);
    await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "petty_cash", sourceId: e.id, narration: `${docNo}: ${what} bought for ${j.doc_no}`,
      lines: [{ event: "work_in_progress", debit: net }, { event: "vat_input", debit: vat }, { event: "petty_cash", credit: net.plus(vat) }] });
    await audit(c, ctx, "petty_cash_entry", e.id, "direct_purchase", { job: j.doc_no, amount: net.plus(vat).toFixed(2), what }, b);
    return { docNo, job: j.doc_no as string };
  });
}

export async function directPurchases(ctx: Ctx) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "view", b);
  return withTx(ctx, async (c) => {
    const list = (await c.query(
      `SELECT p.id, p.doc_no, p.entry_date, p.supplier_name, p.description, p.net_amount, p.vat_amount, p.attachment_id, j.id job_id, j.doc_no job_no, l.line_no, u.full_name
         FROM petty_cash_entry p JOIN job_card j ON j.id = p.job_card_id LEFT JOIN job_line l ON l.id = p.job_line_id LEFT JOIN app_user u ON u.id = p.created_by
        WHERE p.branch_id = $1 ORDER BY p.created_at DESC LIMIT 100`, [b])).rows;
    const jobs = (await c.query(
      `SELECT j.id, j.doc_no, v.make, v.model, coalesce(json_agg(json_build_object('id', l.id, 'no', l.line_no, 'd', l.description) ORDER BY l.line_no) FILTER (WHERE l.id IS NOT NULL), '[]') lines
         FROM job_card j JOIN vehicle v ON v.id = j.vehicle_id
         LEFT JOIN job_line l ON l.job_card_id = j.id AND NOT l.removed AND l.approval_status <> 'declined' AND NOT EXISTS (SELECT 1 FROM sales_invoice_line s WHERE s.job_line_id = l.id)
        WHERE j.branch_id = $1 AND j.status NOT IN ('invoiced','closed','cancelled','delivered') GROUP BY j.id, v.make, v.model ORDER BY j.doc_no DESC`, [b])).rows;
    return { list, jobs, balance: (await pettyBalance(c, b)).toFixed(2) };
  });
}
