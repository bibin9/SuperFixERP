import type { PoolClient } from "pg";
import { claimRequest, finishRequest } from "./requests";
import { lockSeries } from "./numbering";
import Decimal from "decimal.js";
import { Ctx, assertCan, canSee, redact } from "../access";
import { withTx } from "../db";
import { invalid, notFound } from "../errors";
import { audit } from "./audit";
import { D, r2, parseDec, newAverageCost } from "../money";
import { postJournal } from "./ledger";

/** Stock engine (M06/M07): one ledger, weighted average cost, commitments to job lines. */

export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
/** The UAE calendar date n days from today (YYYY-MM-DD), so dates never shift between midnight and 4 am. */
export const addDaysLocal = (n: number) => { const d = new Date(today() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Locks a stock balance row. The branch's journal series is locked first, so every posting takes
 *  number series before stock rows and never the other way round (PERF-01). */
export async function lockBalance(c: PoolClient, itemId: string, branchId: string) {
  await lockSeries(c, branchId, ["journal"]);
  await c.query("INSERT INTO stock_balance (item_id, branch_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [itemId, branchId]);
  return (await c.query("SELECT * FROM stock_balance WHERE item_id = $1 AND branch_id = $2 FOR UPDATE", [itemId, branchId])).rows[0];
}
export const freeQty = (b: { on_hand: string; committed: string; reserved: string }) => D(b.on_hand).minus(b.committed).minus(b.reserved);

type LineRef = { id: string; branch_id: string; item_id: string | null; qty: string; issued_qty: string; line_type: string };

/**
 * PC-01/PC-03: commits min(required, free) to a part line; the rest is back-ordered. Commitments are
 * made in order of saving (first come, first served). An existing active commitment is kept.
 */
export async function commitForLine(c: PoolClient, line: LineRef) {
  if (!line.item_id || !["part", "consumable"].includes(line.line_type)) return null;
  const existing = await c.query("SELECT * FROM stock_commitment WHERE job_line_id = $1 AND status = 'active'", [line.id]);
  if (existing.rowCount) return existing.rows[0];
  const required = D(line.qty).minus(line.issued_qty);
  if (required.lte(0)) return null;
  const bal = await lockBalance(c, line.item_id, line.branch_id);
  const commit = Decimal.min(required, Decimal.max(freeQty(bal), 0));
  const back = required.minus(commit);
  if (commit.gt(0)) await c.query("UPDATE stock_balance SET committed = committed + $3 WHERE item_id = $1 AND branch_id = $2", [line.item_id, line.branch_id, commit.toFixed(3)]);
  return (await c.query("INSERT INTO stock_commitment (branch_id, item_id, job_line_id, qty, back_ordered) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [line.branch_id, line.item_id, line.id, commit.toFixed(3), back.toFixed(3)])).rows[0];
}

/** PC-04: releases a line's active commitment and gives the quantity back to free stock. */
export async function releaseCommitment(c: PoolClient, lineId: string) {
  const r = await c.query("SELECT * FROM stock_commitment WHERE job_line_id = $1 AND status = 'active' FOR UPDATE", [lineId]);
  if (!r.rowCount) return;
  const sc = r.rows[0];
  await c.query("UPDATE stock_commitment SET status = 'released', closed_at = now() WHERE id = $1", [sc.id]);
  if (D(sc.qty).gt(0)) {
    await lockBalance(c, sc.item_id, sc.branch_id);
    await c.query("UPDATE stock_balance SET committed = committed - $3 WHERE item_id = $1 AND branch_id = $2", [sc.item_id, sc.branch_id, sc.qty]);
  }
}

/**
 * PC-08: received quantity goes to waiting back orders first. A line the receipt was raised for
 * (transfer or PO linked to a job line) is filled first, then the oldest commitment.
 */
export async function fillBackOrders(c: PoolClient, itemId: string, branchId: string, preferLineIds: string[] = []) {
  const waiting = await c.query(
    `SELECT * FROM stock_commitment WHERE item_id = $1 AND branch_id = $2 AND status = 'active' AND back_ordered > 0
      ORDER BY (job_line_id = ANY($3::uuid[])) DESC, created_at FOR UPDATE`,
    [itemId, branchId, preferLineIds]);
  const filled: string[] = [];
  for (const sc of waiting.rows) {
    const bal = (await c.query("SELECT * FROM stock_balance WHERE item_id = $1 AND branch_id = $2 FOR UPDATE", [itemId, branchId])).rows[0];
    const take = Decimal.min(D(sc.back_ordered), Decimal.max(freeQty(bal), 0));
    if (take.lte(0)) break;
    const done = D(sc.back_ordered).minus(take).lte(0);
    await c.query(`UPDATE stock_commitment SET qty = qty + $2, back_ordered = back_ordered - $2,
                   source_type = CASE WHEN $3 THEN NULL ELSE source_type END, source_ref = CASE WHEN $3 THEN NULL ELSE source_ref END,
                   expected_date = CASE WHEN $3 THEN NULL ELSE expected_date END WHERE id = $1`, [sc.id, take.toFixed(3), done]);
    await c.query("UPDATE stock_balance SET committed = committed + $3 WHERE item_id = $1 AND branch_id = $2", [itemId, branchId, take.toFixed(3)]);
    filled.push(sc.job_line_id);
  }
  return filled;
}

/**
 * Stock in at weighted average cost (IN-02) inside the caller's transaction: updates the balance,
 * writes the stock ledger and fills waiting back orders. The caller posts the journal.
 */
export async function stockIn(c: PoolClient, ctx: Ctx, f: { branchId: string; itemId: string; qty: Decimal; unitCost: Decimal; moveType: string; ref: string; preferLineIds?: string[] }) {
  const bal = await lockBalance(c, f.itemId, f.branchId);
  const avg = newAverageCost(bal.on_hand, bal.avg_cost, f.qty, f.unitCost);
  const onHand = D(bal.on_hand).plus(f.qty);
  const value = r2(f.qty.mul(f.unitCost));
  await c.query("UPDATE stock_balance SET on_hand = $3, avg_cost = $4, last_move_at = now() WHERE item_id = $1 AND branch_id = $2", [f.itemId, f.branchId, onHand.toFixed(3), avg.toFixed(4)]);
  await c.query(
    `INSERT INTO stock_move (branch_id, item_id, move_type, doc_ref, qty_in, unit_cost, value, balance_qty, balance_avg_cost, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [f.branchId, f.itemId, f.moveType, f.ref, f.qty.toFixed(3), f.unitCost.toFixed(4), value.toFixed(2), onHand.toFixed(3), avg.toFixed(4), ctx.userId]);
  const filled = await fillBackOrders(c, f.itemId, f.branchId, f.preferLineIds ?? []);
  return { value, avg, onHand, filled };
}

/**
 * Stock out at the current average cost. Only free stock can leave (PC-02, IN-05); `fromReserved`
 * takes the quantity out of the branch's reservation instead (an approved transfer being dispatched).
 */
export async function stockOut(c: PoolClient, ctx: Ctx, f: { branchId: string; itemId: string; qty: Decimal; moveType: string; ref: string; fromReserved?: boolean }) {
  const bal = await lockBalance(c, f.itemId, f.branchId);
  if (f.fromReserved) {
    if (D(bal.reserved).lt(f.qty)) throw invalid("The reserved quantity for this transfer is no longer there.");
  } else if (freeQty(bal).lt(f.qty)) {
    const part = (await c.query("SELECT part_no FROM item WHERE id = $1", [f.itemId])).rows[0]?.part_no ?? "this part";
    const jobs = (await c.query(
      `SELECT DISTINCT j.doc_no FROM stock_commitment sc JOIN job_line l ON l.id = sc.job_line_id JOIN job_card j ON j.id = l.job_card_id
        WHERE sc.item_id = $1 AND sc.branch_id = $2 AND sc.status = 'active' AND sc.qty > 0 LIMIT 3`, [f.itemId, f.branchId])).rows.map((r) => r.doc_no);
    throw invalid(`Not enough free stock of ${part}: ${Decimal.max(freeQty(bal), 0).toString()} free.${jobs.length ? ` Committed to job ${jobs.join(", ")}.` : ""}`);
  }
  const cost = D(bal.avg_cost);
  const value = r2(f.qty.mul(cost));
  const onHand = D(bal.on_hand).minus(f.qty);
  await c.query(`UPDATE stock_balance SET on_hand = $3, reserved = reserved - $4, last_move_at = now() WHERE item_id = $1 AND branch_id = $2`,
    [f.itemId, f.branchId, onHand.toFixed(3), f.fromReserved ? f.qty.toFixed(3) : "0"]);
  await c.query(
    `INSERT INTO stock_move (branch_id, item_id, move_type, doc_ref, qty_out, unit_cost, value, balance_qty, balance_avg_cost, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [f.branchId, f.itemId, f.moveType, f.ref, f.qty.toFixed(3), cost.toFixed(4), value.toFixed(2), onHand.toFixed(3), cost.toFixed(4), ctx.userId]);
  await consumeDot(c, f.branchId, f.itemId, f.qty);
  return { value, cost };
}

/** IN-03: tyres leave oldest DOT first (week and year made, WWYY). Stock with no DOT recorded is not tracked. */
async function consumeDot(c: PoolClient, branchId: string, itemId: string, qty: Decimal) {
  const lots = (await c.query(
    "SELECT dot_code, qty FROM tyre_dot_stock WHERE branch_id = $1 AND item_id = $2 AND qty > 0 ORDER BY right(dot_code, 2), left(dot_code, 2) FOR UPDATE", [branchId, itemId])).rows;
  let left = qty;
  for (const l of lots) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, D(l.qty));
    await c.query("UPDATE tyre_dot_stock SET qty = qty - $4 WHERE branch_id = $1 AND item_id = $2 AND dot_code = $3", [branchId, itemId, l.dot_code, take.toFixed(3)]);
    left = left.minus(take);
  }
}

/** IN-03: records the DOT of tyres coming into stock. */
export async function addDot(c: PoolClient, branchId: string, itemId: string, dot: string, qty: Decimal) {
  if (!/^\d{4}$/.test(dot) || Number(dot.slice(0, 2)) < 1 || Number(dot.slice(0, 2)) > 53) throw invalid("DOT is the week and year made, four digits, for example 2425 for week 24 of 2025.");
  await c.query(`INSERT INTO tyre_dot_stock (branch_id, item_id, dot_code, qty) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (branch_id, item_id, dot_code) DO UPDATE SET qty = tyre_dot_stock.qty + EXCLUDED.qty`, [branchId, itemId, dot, qty.toFixed(3)]);
}

/**
 * Receives stock at a branch (opening stock IN-10, or a receipt) at weighted average cost (IN-02)
 * and posts Dr Inventory / Cr opening balance or goods-received clearing.
 */
export async function receiveStock(ctx: Ctx, f: { item_id: string; qty: unknown; unit_cost: unknown; kind: "opening" | "receipt"; ref?: string }) {
  const branchId = ctx.currentBranchId;
  if (!branchId) throw invalid("Choose a branch first.");
  assertCan(ctx, "stock", "create", branchId);
  const qty = parseDec(f.qty, "Quantity", { min: "0.001", dp: 3 });
  const cost = parseDec(f.unit_cost, "Unit cost", { min: 0, dp: 4 });
  return withTx(ctx, async (c) => {
    const item = await c.query("SELECT * FROM item WHERE id = $1 AND active AND item_type IN ('stock','consumable')", [f.item_id]);
    if (!item.rowCount) throw invalid("Stock item not found.");
    const bal = await lockBalance(c, f.item_id, branchId);
    const avg = newAverageCost(bal.on_hand, bal.avg_cost, qty, cost);
    const onHand = D(bal.on_hand).plus(qty);
    const value = r2(qty.mul(cost));
    await c.query("UPDATE stock_balance SET on_hand = $3, avg_cost = $4, last_move_at = now() WHERE item_id = $1 AND branch_id = $2", [f.item_id, branchId, onHand.toFixed(3), avg.toFixed(4)]);
    const ref = f.ref || (f.kind === "opening" ? "Opening stock" : "Stock receipt");
    const mv = await c.query(
      `INSERT INTO stock_move (branch_id, item_id, move_type, doc_ref, qty_in, unit_cost, value, balance_qty, balance_avg_cost, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [branchId, f.item_id, f.kind, ref, qty.toFixed(3), cost.toFixed(4), value.toFixed(2), onHand.toFixed(3), avg.toFixed(4), ctx.userId]);
    await postJournal(c, ctx, {
      branchId, date: today(), sourceType: `stock_${f.kind}`, sourceId: f.item_id, narration: `${ref}: ${item.rows[0].part_no} x ${qty.toFixed(3)}`,
      lines: [{ event: "inventory", debit: value }, { event: f.kind === "opening" ? "opening_balance" : "goods_received_clearing", credit: value }],
    });
    await fillBackOrders(c, f.item_id, branchId);
    await audit(c, ctx, "stock_move", String(mv.rows[0].id), f.kind, { item: item.rows[0].part_no, qty: qty.toFixed(3), unit_cost: cost.toFixed(4) }, branchId);
    return { avgCost: avg.toFixed(4), onHand: onHand.toFixed(3) };
  });
}

/**
 * Issues parts to an approved job line (WS-08, IN-05). Committed stock is issued to its own job;
 * anything beyond the commitment must come from free stock. Cost moves from stock to work in progress.
 */
/**
 * Issue parts to an approved job line. With a request key (every issue form has one), a replay of the
 * same submission returns the first issue instead of issuing again (CONC-01); a different quantity or
 * line under the same key is refused. Two intended issues come from two forms, so two keys.
 */
export async function issueToJobLine(ctx: Ctx, lineId: string, qtyIn: unknown, requestKey?: string) {
  const qty = parseDec(qtyIn, "Quantity", { min: "0.001", dp: 3 });
  type Out = { lineId: string; qty: string; duplicate: boolean };
  return withTx(ctx, async (c): Promise<Out> => {
    if (requestKey !== undefined) {
      const replay = await claimRequest<Out>(c, ctx, requestKey, "stock_issue", { lineId, qty: qty.toFixed(3) });
      if (replay) return replay;
    }
    await issueToLineIn(c, ctx, lineId, qty);
    const out: Out = { lineId, qty: qty.toFixed(3), duplicate: false };
    return requestKey !== undefined ? finishRequest<Out>(c, requestKey, out) : out;
  });
}

/**
 * Issues parts to a job line inside the caller's transaction. The store issues with Stock edit; a sale
 * at the counter or at billing (quick job, a part added on the invoice) moves its own stock under
 * the invoice permission, as a counter sale does (`asSale`).
 */
export async function issueToLineIn(c: PoolClient, ctx: Ctx, lineId: string, qty: Decimal, asSale = false) {
  {
    const l = await c.query("SELECT l.*, j.doc_no, j.status job_status FROM job_line l JOIN job_card j ON j.id = l.job_card_id WHERE l.id = $1 FOR NO KEY UPDATE OF l", [lineId]);
    if (!l.rowCount) throw notFound("Job line");
    const line = l.rows[0];
    assertCan(ctx, asSale ? "invoices" : "stock", asSale ? "create" : "edit", line.branch_id);
    if (!line.item_id || line.removed) throw invalid("This line has no stock part.");
    if (line.approval_status !== "approved") throw invalid("Parts can only be issued to a line the customer approved.");
    if ((asSale ? ["closed", "cancelled"] : ["invoiced", "closed", "cancelled"]).includes(line.job_status)) throw invalid("This job is closed.");
    if (D(line.issued_qty).plus(qty).gt(line.qty)) throw invalid("That is more than the line quantity.");
    await lockSeries(c, line.branch_id, ["journal"]); // series before stock rows, as every posting does (PERF-01)
    const bal = await lockBalance(c, line.item_id, line.branch_id);
    const sc = (await c.query("SELECT * FROM stock_commitment WHERE job_line_id = $1 AND status = 'active' FOR UPDATE", [lineId])).rows[0];
    const fromCommit = Decimal.min(qty, D(sc?.qty ?? 0));
    const fromFree = qty.minus(fromCommit);
    if (fromFree.gt(Decimal.max(freeQty(bal), 0))) throw invalid("Not enough free stock. Committed stock belongs to other jobs.");
    const cost = D(bal.avg_cost);
    const value = r2(qty.mul(cost));
    const onHand = D(bal.on_hand).minus(qty);
    await c.query("UPDATE stock_balance SET on_hand = $3, committed = committed - $4, last_move_at = now() WHERE item_id = $1 AND branch_id = $2",
      [line.item_id, line.branch_id, onHand.toFixed(3), fromCommit.toFixed(3)]);
    if (sc) {
      const left = D(sc.qty).minus(fromCommit);
      const back = Decimal.max(D(sc.back_ordered).minus(fromFree), 0);
      if (left.lte(0) && back.lte(0)) await c.query("UPDATE stock_commitment SET qty = 0, back_ordered = 0, status = 'issued', closed_at = now() WHERE id = $1", [sc.id]);
      else await c.query("UPDATE stock_commitment SET qty = $2, back_ordered = $3 WHERE id = $1", [sc.id, left.toFixed(3), back.toFixed(3)]);
    }
    await c.query("UPDATE job_line SET issued_qty = issued_qty + $2, version = version + 1 WHERE id = $1", [lineId, qty.toFixed(3)]);
    await c.query(
      `INSERT INTO stock_move (branch_id, item_id, move_type, doc_ref, job_line_id, qty_out, unit_cost, value, balance_qty, balance_avg_cost, user_id)
       VALUES ($1,$2,'issue',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [line.branch_id, line.item_id, line.doc_no, lineId, qty.toFixed(3), cost.toFixed(4), value.toFixed(2), onHand.toFixed(3), cost.toFixed(4), ctx.userId]);
    await postJournal(c, ctx, {
      branchId: line.branch_id, date: today(), sourceType: "stock_issue", sourceId: line.job_card_id, narration: `Issue to ${line.doc_no}: ${line.description}`,
      lines: [{ event: "work_in_progress", debit: value }, { event: "inventory", credit: value }],
    });
    await audit(c, ctx, "job_line", lineId, "issue", { qty: qty.toFixed(3), job: line.doc_no, at_sale: asSale || undefined }, line.branch_id);
  }
}

/** Stock by branch. Quantities at every branch are visible (BR-03); cost and value follow FP. */
export async function stockList(ctx: Ctx, q = "") {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT i.id item_id, i.part_no, i.description, i.brand, i.oem_part_no, i.barcode, i.uom, i.list_price, b.id branch_id, b.code branch_code,
              coalesce(sb.on_hand,0) on_hand, coalesce(sb.committed,0) committed, coalesce(sb.reserved,0) reserved,
              coalesce(sb.on_hand,0) - coalesce(sb.committed,0) - coalesce(sb.reserved,0) free, sb.avg_cost,
              round(coalesce(sb.on_hand,0) * coalesce(sb.avg_cost,0), 2) stock_value
         FROM item i JOIN stock_balance sb ON sb.item_id = i.id JOIN branch b ON b.id = sb.branch_id
        WHERE i.active AND ($1 = '' OR i.part_no ILIKE '%'||$1||'%' OR i.description ILIKE '%'||$1||'%' OR i.search_codes LIKE '%'||upper($1)||'%' OR i.fits_vehicles ILIKE '%'||$1||'%')
        ORDER BY i.part_no, b.code`, [q.trim()])).rows;
    // Cost is shown only for the user's own branches, and only with the purchase-cost permission.
    return rows.map((r) => (ctx.branchIds.includes(r.branch_id) && canSee(ctx, "purchase_cost", r.branch_id)) ? r : (({ avg_cost, stock_value, ...rest }) => { void avg_cost; void stock_value; return rest; })(r))
      .map((r) => redact(ctx, [r], { list_price: "selling_price" })[0]);
  });
}

export async function stockLedger(ctx: Ctx, itemId: string) {
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT m.*, b.code branch_code FROM stock_move m JOIN branch b ON b.id = m.branch_id WHERE m.item_id = $1 ORDER BY m.at, m.id`, [itemId])).rows;
    assertCan(ctx, "stock", "view");
    return redact(ctx, rows, { unit_cost: "purchase_cost", value: "purchase_cost", balance_avg_cost: "purchase_cost" }, (r) => r.branch_id as string);
  });
}
