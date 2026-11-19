import type { PoolClient } from "pg";
import Decimal from "decimal.js";
import { Ctx, assertCan, can, canSee, redact } from "../access";
import { withTx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal } from "./ledger";
import { D, r2, parseDec } from "../money";
import { optStr, required, str } from "../validate";
import { freeQty, lockBalance, stockIn, stockOut, today } from "./stock";
import { registerHandler, submitForApproval, type ApprovalRequestRow } from "./workflow";
import { getSetting } from "./settings";

/** M07 transfers, adjustments and counts; M06 planning screen and store queue. */

function here(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}
const qtyOf = (v: unknown) => parseDec(v, "Quantity", { min: "0.001", dp: 3 });

// =====================================================================================
// Transfers between branches (ST-01 to ST-06)
// =====================================================================================

type TLine = { item_id: string; qty: unknown; job_line_id?: string | null };

/** ST-01: the requesting branch asks a supplying branch. Nothing moves until it is approved. */
export async function requestTransfer(ctx: Ctx, f: { from_branch_id: string; note?: string; lines: TLine[] }) {
  const to = here(ctx);
  assertCan(ctx, "stock", "create", to);
  if (!f.from_branch_id || f.from_branch_id === to) throw invalid("Choose another branch to ask for the parts.");
  const lines = f.lines.filter((l) => l.item_id && str(l.qty)).map((l) => ({ ...l, q: qtyOf(l.qty) }));
  if (!lines.length) throw invalid("Add at least one part.");
  return withTx(ctx, async (c) => createTransfer(c, ctx, to, f.from_branch_id, lines, optStr(f.note)));
}

async function createTransfer(c: PoolClient, ctx: Ctx, to: string, from: string, lines: (TLine & { q: Decimal })[], note: string | null) {
  const fromB = (await c.query("SELECT code FROM branch WHERE id = $1 AND active", [from])).rows[0];
  if (!fromB) throw invalid("Supplying branch not found.");
  const docNo = await nextDocNo(c, to, "transfer");
  const t = (await c.query("INSERT INTO transfer (doc_no, from_branch_id, to_branch_id, note, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [docNo, from, to, note, ctx.userId])).rows[0];
  for (const l of lines) {
    await c.query("INSERT INTO transfer_line (transfer_id, item_id, qty, job_line_id) VALUES ($1,$2,$3,$4)", [t.id, l.item_id, l.q.toFixed(3), l.job_line_id || null]);
    if (l.job_line_id) {
      await c.query("UPDATE stock_commitment SET source_type = 'transfer', source_ref = $2 WHERE job_line_id = $1 AND status = 'active'", [l.job_line_id, docNo]);
    }
  }
  await c.query("INSERT INTO transfer_event (transfer_id, status, user_id, note) VALUES ($1,'requested',$2,$3)", [t.id, ctx.userId, note]);
  await audit(c, ctx, "transfer", t.id, "requested", { from: fromB.code, lines: lines.length }, to);
  const r = await submitForApproval(c, ctx, { docType: "stock_transfer", docId: t.id, docRef: docNo, branchId: to, approverBranchId: from, summary: { from: fromB.code } });
  // Workflow switched off: approved at once, so the supplying branch's stock is reserved now.
  if (r.status === "approved") await reserveTransfer(c, ctx, t.id);
  return { id: t.id as string, docNo, status: r.status === "approved" ? "approved" : "requested" };
}

/** ST-02: on approval the quantity is reserved at the supplying branch (its free quantity falls). */
async function reserveTransfer(c: PoolClient, ctx: Ctx, id: string) {
  const t = (await c.query("SELECT * FROM transfer WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!t || t.status !== "requested") throw conflict("This transfer is no longer waiting for approval.");
  const lines = (await c.query("SELECT tl.*, i.part_no FROM transfer_line tl JOIN item i ON i.id = tl.item_id WHERE transfer_id = $1", [id])).rows;
  for (const l of lines) {
    const bal = await lockBalance(c, l.item_id, t.from_branch_id);
    if (freeQty(bal).lt(l.qty)) throw invalid(`Not enough free ${l.part_no} at the supplying branch (${Decimal.max(freeQty(bal), 0).toString()} free). Reject it, or approve once stock arrives.`);
    await c.query("UPDATE stock_balance SET reserved = reserved + $3 WHERE item_id = $1 AND branch_id = $2", [l.item_id, t.from_branch_id, l.qty]);
  }
  await c.query("UPDATE transfer SET status = 'approved', version = version + 1 WHERE id = $1", [id]);
  await c.query("INSERT INTO transfer_event (transfer_id, status, user_id) VALUES ($1,'approved',$2)", [id, ctx.userId]);
}

registerHandler("stock_transfer", {
  onApproved: async (c, ctx, req: ApprovalRequestRow) => reserveTransfer(c, ctx, req.doc_id),
  onRejected: async (c, ctx, req, comment) => {
    await c.query("UPDATE transfer SET status = 'rejected', reason = $2, version = version + 1 WHERE id = $1 AND status = 'requested'", [req.doc_id, comment]);
    await c.query("INSERT INTO transfer_event (transfer_id, status, user_id, note) VALUES ($1,'rejected',$2,$3)", [req.doc_id, ctx.userId, comment]);
    await clearSource(c, req.doc_id);
  },
});

async function clearSource(c: PoolClient, transferId: string) {
  await c.query(`UPDATE stock_commitment sc SET source_type = NULL, source_ref = NULL, expected_date = NULL
                   FROM transfer_line tl JOIN transfer t ON t.id = tl.transfer_id
                  WHERE tl.transfer_id = $1 AND sc.job_line_id = tl.job_line_id AND sc.status = 'active' AND sc.source_ref = t.doc_no`, [transferId]);
}

/** Cancel: the requester while it waits; the supplying branch after approval (reservation released). */
export async function cancelTransfer(ctx: Ctx, id: string, reason: string) {
  const why = required(reason, "Reason");
  return withTx(ctx, async (c) => {
    const t = (await c.query("SELECT * FROM transfer WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!t) throw notFound("Transfer");
    if (t.status === "requested") {
      assertCan(ctx, "stock", "cancel", t.to_branch_id);
      await c.query("UPDATE approval_request SET status = 'recalled', decided_at = now() WHERE doc_type = 'stock_transfer' AND doc_id = $1 AND status = 'pending'", [id]);
    } else if (t.status === "approved") {
      if (!can(ctx, "stock", "cancel", t.from_branch_id) && !can(ctx, "stock", "approve", t.from_branch_id)) throw forbidden();
      for (const l of (await c.query("SELECT * FROM transfer_line WHERE transfer_id = $1", [id])).rows) {
        await lockBalance(c, l.item_id, t.from_branch_id);
        await c.query("UPDATE stock_balance SET reserved = reserved - $3 WHERE item_id = $1 AND branch_id = $2", [l.item_id, t.from_branch_id, l.qty]);
      }
    } else throw invalid("Only a transfer that has not been dispatched can be cancelled.");
    await c.query("UPDATE transfer SET status = 'cancelled', reason = $2, version = version + 1 WHERE id = $1", [id, why]);
    await c.query("INSERT INTO transfer_event (transfer_id, status, user_id, note) VALUES ($1,'cancelled',$2,$3)", [id, ctx.userId, why]);
    await clearSource(c, id);
    await audit(c, ctx, "transfer", id, "cancelled", { reason: why }, t.to_branch_id);
  });
}

/** ST-03: the supplying stock keeper dispatches; stock leaves on hand into transit at average cost. */
export async function dispatchTransfer(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const t = (await c.query("SELECT * FROM transfer WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!t) throw notFound("Transfer");
    assertCan(ctx, "stock", "edit", t.from_branch_id);
    if (t.status !== "approved") throw invalid("Only an approved transfer can be dispatched.");
    let total = D(0);
    for (const l of (await c.query("SELECT * FROM transfer_line WHERE transfer_id = $1", [id])).rows) {
      const out = await stockOut(c, ctx, { branchId: t.from_branch_id, itemId: l.item_id, qty: D(l.qty), moveType: "transfer_out", ref: t.doc_no, fromReserved: true });
      await c.query("UPDATE transfer_line SET dispatched_qty = qty, unit_cost = $2 WHERE id = $1", [l.id, out.cost.toFixed(4)]);
      total = total.plus(out.value);
    }
    await postJournal(c, ctx, { branchId: t.from_branch_id, date: today(), sourceType: "transfer_out", sourceId: id, narration: `Transfer ${t.doc_no} dispatched`,
      lines: [{ event: "stock_in_transit", debit: total }, { event: "inventory", credit: total }] });
    await c.query("UPDATE transfer SET status = 'dispatched', version = version + 1 WHERE id = $1", [id]);
    await c.query("INSERT INTO transfer_event (transfer_id, status, user_id) VALUES ($1,'dispatched',$2)", [id, ctx.userId]);
    await audit(c, ctx, "transfer", id, "dispatched", { value: total.toFixed(2) }, t.from_branch_id);
  });
}

/**
 * ST-03/ST-05: the requesting stock keeper receives at the supplier's cost. Short or damaged
 * quantities stay in transit with a reason until found or written off. Received parts go to the
 * job the transfer was raised for first (PC-08).
 */
export async function receiveTransfer(ctx: Ctx, id: string, received: Record<string, unknown>, shortReason: Record<string, unknown> = {}) {
  return withTx(ctx, async (c) => {
    const t = (await c.query("SELECT * FROM transfer WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!t) throw notFound("Transfer");
    assertCan(ctx, "stock", "edit", t.to_branch_id);
    if (t.status !== "dispatched") throw invalid("Only a dispatched transfer can be received.");
    let total = D(0);
    const filledJobs = new Set<string>();
    for (const l of (await c.query("SELECT * FROM transfer_line WHERE transfer_id = $1", [id])).rows) {
      const got = str(received[l.id]) === "" ? D(l.dispatched_qty) : parseDec(received[l.id], "Received quantity", { min: 0, dp: 3 });
      if (got.gt(l.dispatched_qty)) throw invalid("Received quantity cannot be more than was dispatched.");
      const short = D(l.dispatched_qty).minus(got);
      const why = optStr(shortReason[l.id]);
      if (short.gt(0) && !why) throw invalid("Give a reason for every short or damaged quantity.");
      if (got.gt(0)) {
        const r = await stockIn(c, ctx, { branchId: t.to_branch_id, itemId: l.item_id, qty: got, unitCost: D(l.unit_cost), moveType: "transfer_in", ref: t.doc_no, preferLineIds: l.job_line_id ? [l.job_line_id] : [] });
        total = total.plus(r.value);
        r.filled.forEach((x) => filledJobs.add(x));
      }
      await c.query("UPDATE transfer_line SET received_qty = $2, short_qty = $3, short_reason = $4 WHERE id = $1", [l.id, got.toFixed(3), short.toFixed(3), why]);
    }
    await postJournal(c, ctx, { branchId: t.to_branch_id, date: today(), sourceType: "transfer_in", sourceId: id, narration: `Transfer ${t.doc_no} received`,
      lines: [{ event: "inventory", debit: total }, { event: "stock_in_transit", credit: total }] });
    await c.query("UPDATE transfer SET status = 'received', version = version + 1 WHERE id = $1", [id]);
    await c.query("INSERT INTO transfer_event (transfer_id, status, user_id) VALUES ($1,'received',$2)", [id, ctx.userId]);
    await audit(c, ctx, "transfer", id, "received", { value: total.toFixed(2) }, t.to_branch_id);
    return { jobLinesFilled: [...filledJobs] };
  });
}

export async function listTransfers(ctx: Ctx, status = "") {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT t.*, fb.code from_code, tb.code to_code, u.full_name requested_name,
            (SELECT count(*) FROM transfer_line WHERE transfer_id = t.id) lines,
            (SELECT coalesce(sum(short_qty),0) FROM transfer_line WHERE transfer_id = t.id) short_qty,
            (SELECT max(at) FROM transfer_event WHERE transfer_id = t.id) last_at
       FROM transfer t JOIN branch fb ON fb.id = t.from_branch_id JOIN branch tb ON tb.id = t.to_branch_id LEFT JOIN app_user u ON u.id = t.requested_by
      WHERE ($1 = '' OR t.status = $1) ORDER BY t.created_at DESC LIMIT 200`, [status])).rows);
}

export async function getTransfer(ctx: Ctx, id: string) {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => {
    const t = (await c.query(
      `SELECT t.*, fb.code from_code, fb.name_en from_name, tb.code to_code, tb.name_en to_name FROM transfer t
         JOIN branch fb ON fb.id = t.from_branch_id JOIN branch tb ON tb.id = t.to_branch_id WHERE t.id = $1`, [id])).rows[0];
    if (!t) throw notFound("Transfer");
    const lines = (await c.query(
      `SELECT tl.*, i.part_no, i.description, j.doc_no job_no, j.id job_id FROM transfer_line tl JOIN item i ON i.id = tl.item_id
         LEFT JOIN job_line l ON l.id = tl.job_line_id LEFT JOIN job_card j ON j.id = l.job_card_id WHERE tl.transfer_id = $1 ORDER BY i.part_no`, [id])).rows;
    const events = (await c.query("SELECT e.*, u.full_name FROM transfer_event e LEFT JOIN app_user u ON u.id = e.user_id WHERE transfer_id = $1 ORDER BY e.at, e.id", [id])).rows;
    // Transfer value is a purchase-cost field (FP-01).
    const costOk = canSee(ctx, "purchase_cost", t.from_branch_id) || canSee(ctx, "purchase_cost", t.to_branch_id);
    return { t, lines: costOk ? lines : lines.map(({ unit_cost, ...r }) => { void unit_cost; return r; }), events,
      side: { supplier: ctx.branchIds.includes(t.from_branch_id), requester: ctx.branchIds.includes(t.to_branch_id) } };
  });
}

// =====================================================================================
// Stock adjustments (IN-09) and counts (IN-07)
// =====================================================================================

const ADJ_DEBIT: Record<string, string> = { internal_use: "consumables_expense" };

export async function createAdjustment(ctx: Ctx, f: { reason: string; note?: string; lines: { item_id: string; qty_change: unknown }[] }) {
  const b = here(ctx);
  assertCan(ctx, "stock", "create", b);
  const reason = required(f.reason, "Reason");
  const lines = f.lines.filter((l) => l.item_id && str(l.qty_change)).map((l) => {
    const q = parseDec(l.qty_change, "Quantity change", { dp: 3 });
    if (q.eq(0)) throw invalid("A quantity change cannot be zero.");
    return { item_id: l.item_id, q };
  });
  if (!lines.length) throw invalid("Add at least one part.");
  return withTx(ctx, async (c) => insertAdjustment(c, ctx, b, reason, optStr(f.note), lines, null));
}

async function insertAdjustment(c: PoolClient, ctx: Ctx, b: string, reason: string, note: string | null, lines: { item_id: string; q: Decimal }[], countId: string | null) {
  const ok = await c.query("SELECT 1 FROM lookup_value WHERE list = 'adjustment_reason' AND code = $1 AND active", [reason]);
  if (!ok.rowCount) throw invalid("Choose a reason from the list.");
  const docNo = await nextDocNo(c, b, "stock_adjustment");
  const a = (await c.query("INSERT INTO stock_adjustment (branch_id, doc_no, reason, note, count_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [b, docNo, reason, note, countId, ctx.userId])).rows[0];
  let value = D(0);
  for (const l of lines) {
    const bal = await lockBalance(c, l.item_id, b);
    if (l.q.lt(0) && freeQty(bal).lt(l.q.abs())) {
      const part = (await c.query("SELECT part_no FROM item WHERE id = $1", [l.item_id])).rows[0].part_no;
      throw invalid(`Only ${Decimal.max(freeQty(bal), 0).toString()} of ${part} is free; committed stock cannot be written off. Release it from the job first.`);
    }
    value = value.plus(r2(l.q.abs().mul(bal.avg_cost)));
    await c.query("INSERT INTO stock_adjustment_line (adjustment_id, branch_id, item_id, qty_change) VALUES ($1,$2,$3,$4)", [a.id, b, l.item_id, l.q.toFixed(3)]);
  }
  await audit(c, ctx, "stock_adjustment", a.id, "submitted", { reason, lines: lines.length }, b);
  const r = await submitForApproval(c, ctx, { docType: "stock_adjustment", docId: a.id, docRef: docNo, branchId: b, amount: value.toFixed(2), summary: { reason } });
  if (r.status === "approved") await postAdjustment(c, ctx, a.id);
  return { id: a.id as string, docNo, status: r.status };
}

/** Posts an approved adjustment: stock in or out at average cost, each reason to its own account. */
async function postAdjustment(c: PoolClient, ctx: Ctx, id: string) {
  const a = (await c.query("SELECT * FROM stock_adjustment WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!a || a.status !== "pending") throw conflict("This adjustment has already been dealt with.");
  let gain = D(0), loss = D(0);
  for (const l of (await c.query("SELECT * FROM stock_adjustment_line WHERE adjustment_id = $1", [id])).rows) {
    const q = D(l.qty_change);
    if (q.gt(0)) {
      const bal = await lockBalance(c, l.item_id, a.branch_id);
      const r = await stockIn(c, ctx, { branchId: a.branch_id, itemId: l.item_id, qty: q, unitCost: D(bal.avg_cost), moveType: "adjustment", ref: a.doc_no });
      gain = gain.plus(r.value);
      await c.query("UPDATE stock_adjustment_line SET unit_cost = $2, value = $3 WHERE id = $1", [l.id, bal.avg_cost, r.value.toFixed(2)]);
    } else {
      const r = await stockOut(c, ctx, { branchId: a.branch_id, itemId: l.item_id, qty: q.abs(), moveType: "adjustment", ref: a.doc_no });
      loss = loss.plus(r.value);
      await c.query("UPDATE stock_adjustment_line SET unit_cost = $2, value = $3 WHERE id = $1", [l.id, r.cost.toFixed(4), r.value.neg().toFixed(2)]);
    }
  }
  await postJournal(c, ctx, { branchId: a.branch_id, date: today(), sourceType: "stock_adjustment", sourceId: id, narration: `Stock adjustment ${a.doc_no} (${a.reason})`,
    lines: [{ event: "inventory", debit: gain }, { event: "stock_gain", credit: gain }, { event: ADJ_DEBIT[a.reason] ?? "stock_writeoff", debit: loss }, { event: "inventory", credit: loss }] });
  await c.query("UPDATE stock_adjustment SET status = 'approved', posted_at = now(), version = version + 1 WHERE id = $1", [id]);
  if (a.count_id) await c.query("UPDATE stock_count SET status = 'approved', version = version + 1 WHERE id = $1", [a.count_id]);
}

registerHandler("stock_adjustment", {
  onApproved: async (c, ctx, req) => postAdjustment(c, ctx, req.doc_id),
  onRejected: async (c, ctx, req, comment) => {
    const a = (await c.query("UPDATE stock_adjustment SET status = 'rejected', note = coalesce(note || ' · ', '') || 'Rejected: ' || $2, version = version + 1 WHERE id = $1 RETURNING count_id", [req.doc_id, comment])).rows[0];
    if (a?.count_id) await c.query("UPDATE stock_count SET status = 'rejected', version = version + 1 WHERE id = $1", [a.count_id]);
  },
});

export async function listAdjustments(ctx: Ctx) {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT a.*, b.code branch_code, u.full_name created_name, lv.name_en reason_name,
              (SELECT coalesce(sum(value),0) FROM stock_adjustment_line WHERE adjustment_id = a.id) value,
              (SELECT string_agg(i.part_no || ' ' || to_char(l.qty_change, 'FMS999990.###'), ', ') FROM stock_adjustment_line l JOIN item i ON i.id = l.item_id WHERE l.adjustment_id = a.id) summary
         FROM stock_adjustment a JOIN branch b ON b.id = a.branch_id LEFT JOIN app_user u ON u.id = a.created_by
         LEFT JOIN lookup_value lv ON lv.list = 'adjustment_reason' AND lv.code = a.reason
        ORDER BY a.created_at DESC LIMIT 200`)).rows;
    return redact(ctx, rows, { value: "purchase_cost" }, (r) => r.branch_id as string);
  });
}

/** A count snapshots the book quantity; the counter does not see it (blind count). */
export async function startCount(ctx: Ctx, category: string) {
  const b = here(ctx);
  assertCan(ctx, "stock", "create", b);
  return withTx(ctx, async (c) => {
    const docNo = await nextDocNo(c, b, "stock_count");
    const cnt = (await c.query("INSERT INTO stock_count (branch_id, doc_no, category, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [b, docNo, optStr(category), ctx.userId])).rows[0];
    const n = await c.query(
      `INSERT INTO stock_count_line (count_id, branch_id, item_id, system_qty)
       SELECT $1, $2, i.id, coalesce(sb.on_hand, 0) FROM item i LEFT JOIN stock_balance sb ON sb.item_id = i.id AND sb.branch_id = $2
        WHERE i.active AND i.item_type IN ('stock','consumable') AND ($3::text IS NULL OR i.category = $3)`, [cnt.id, b, optStr(category)]);
    if (!n.rowCount) throw invalid("No stock items in that category.");
    await audit(c, ctx, "stock_count", cnt.id, "started", { category: category || "all" }, b);
    return { id: cnt.id as string, docNo };
  });
}

export async function getCount(ctx: Ctx, id: string) {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => {
    const cnt = (await c.query("SELECT sc.*, b.code branch_code FROM stock_count sc JOIN branch b ON b.id = sc.branch_id WHERE sc.id = $1", [id])).rows[0];
    if (!cnt) throw notFound("Stock count");
    const lines = (await c.query(
      `SELECT l.*, i.part_no, i.description, i.uom, sb.avg_cost FROM stock_count_line l JOIN item i ON i.id = l.item_id
         LEFT JOIN stock_balance sb ON sb.item_id = l.item_id AND sb.branch_id = l.branch_id WHERE l.count_id = $1 ORDER BY i.category, i.part_no`, [id])).rows;
    // Blind count: the book quantity is shown only once the count is submitted, and only to approvers.
    const showBook = cnt.status !== "open" && (can(ctx, "stock", "approve", cnt.branch_id) || can(ctx, "approvals", "approve", cnt.branch_id));
    const shaped = lines.map((l) => (showBook ? l : { ...l, system_qty: undefined }));
    return { cnt, lines: redact(ctx, shaped, { avg_cost: "purchase_cost" }, (r) => r.branch_id as string), showBook };
  });
}

export async function saveCountLines(ctx: Ctx, id: string, counted: Record<string, unknown>, submit: boolean) {
  return withTx(ctx, async (c) => {
    const cnt = (await c.query("SELECT * FROM stock_count WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!cnt) throw notFound("Stock count");
    assertCan(ctx, "stock", "edit", cnt.branch_id);
    if (cnt.status !== "open") throw invalid("This count has been submitted.");
    for (const [lineId, v] of Object.entries(counted)) {
      if (str(v) === "") continue;
      const q = parseDec(v, "Counted quantity", { min: 0, dp: 3 });
      await c.query("UPDATE stock_count_line SET counted_qty = $3 WHERE id = $1 AND count_id = $2", [lineId, id, q.toFixed(3)]);
    }
    if (!submit) return { status: "open" };
    const lines = (await c.query("SELECT * FROM stock_count_line WHERE count_id = $1", [id])).rows;
    if (lines.some((l) => l.counted_qty === null)) throw invalid("Count every line before submitting (enter 0 for none).");
    const diffs = lines.filter((l) => !D(l.counted_qty).eq(l.system_qty)).map((l) => ({ item_id: l.item_id, q: D(l.counted_qty).minus(l.system_qty) }));
    await c.query("UPDATE stock_count SET submitted_at = now(), status = $2, version = version + 1 WHERE id = $1", [id, diffs.length ? "submitted" : "no_difference"]);
    await audit(c, ctx, "stock_count", id, "submitted", { differences: diffs.length }, cnt.branch_id);
    if (!diffs.length) return { status: "no_difference" };
    // IN-07: the count posts nothing itself; its differences become an adjustment that goes for approval.
    const adj = await insertAdjustment(c, ctx, cnt.branch_id, "count_difference", `From count ${cnt.doc_no}`, diffs, id);
    await c.query("UPDATE stock_count SET adjustment_id = $2 WHERE id = $1", [id, adj.id]);
    return { status: adj.status === "approved" ? "approved" : "submitted", adjustment: adj.docNo };
  });
}

export async function listCounts(ctx: Ctx) {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT sc.*, b.code branch_code, a.doc_no adjustment_no, (SELECT count(*) FROM stock_count_line WHERE count_id = sc.id) lines,
            (SELECT count(*) FROM stock_count_line WHERE count_id = sc.id AND counted_qty IS NOT NULL) counted
       FROM stock_count sc JOIN branch b ON b.id = sc.branch_id LEFT JOIN stock_adjustment a ON a.id = sc.adjustment_id
      ORDER BY sc.created_at DESC LIMIT 100`)).rows);
}

// =====================================================================================
// Stock planning (PC-05 to PC-07) and the store queue (WS-08, IN-05)
// =====================================================================================

export async function planning(ctx: Ctx) {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT sc.id, sc.branch_id, b.code branch_code, sc.item_id, i.part_no, i.description, sc.qty committed, sc.back_ordered, sc.source_type, sc.source_ref,
              sc.expected_date, sc.created_at, l.id job_line_id, l.qty required, l.issued_qty, j.id job_id, j.doc_no job_no, j.promised_at,
              i.preferred_supplier_id, s.name_en supplier_name
         FROM stock_commitment sc JOIN job_line l ON l.id = sc.job_line_id JOIN job_card j ON j.id = l.job_card_id JOIN item i ON i.id = sc.item_id
         JOIN branch b ON b.id = sc.branch_id LEFT JOIN supplier s ON s.id = i.preferred_supplier_id
        WHERE sc.status = 'active' AND sc.back_ordered > 0 ORDER BY sc.created_at`)).rows;
    const items = [...new Set(rows.map((r) => r.item_id))];
    // BR-03: every branch's free quantity is visible to all branches (quantities only).
    const free = items.length ? (await c.query(
      `SELECT sb.item_id, sb.branch_id, b.code, sb.on_hand - sb.committed - sb.reserved free FROM stock_balance sb JOIN branch b ON b.id = sb.branch_id
        WHERE sb.item_id = ANY($1::uuid[]) AND sb.on_hand - sb.committed - sb.reserved > 0 ORDER BY free DESC`, [items])).rows : [];
    return rows.map((r) => ({ ...r, elsewhere: free.filter((f) => f.item_id === r.item_id && f.branch_id !== r.branch_id) }));
  });
}

/** PC-06: one click from planning: a transfer request for the back-ordered quantity, linked to the job line. */
export async function requestFromBranch(ctx: Ctx, commitmentId: string, fromBranchId: string) {
  return withTx(ctx, async (c) => {
    const sc = (await c.query("SELECT * FROM stock_commitment WHERE id = $1 AND status = 'active'", [commitmentId])).rows[0];
    if (!sc || D(sc.back_ordered).lte(0)) throw invalid("Nothing is back-ordered on this line.");
    assertCan(ctx, "stock", "create", sc.branch_id);
    if (sc.source_ref) throw invalid(`Already being sourced by ${sc.source_ref}.`);
    return createTransfer(c, { ...ctx, currentBranchId: sc.branch_id }, sc.branch_id, fromBranchId,
      [{ item_id: sc.item_id, qty: sc.back_ordered, job_line_id: sc.job_line_id, q: D(sc.back_ordered) }], "For a back-ordered job line");
  });
}

export async function setExpectedDate(ctx: Ctx, commitmentId: string, date: string) {
  return withTx(ctx, async (c) => {
    const sc = (await c.query("SELECT * FROM stock_commitment WHERE id = $1", [commitmentId])).rows[0];
    if (!sc) throw notFound("Back order");
    assertCan(ctx, "stock", "edit", sc.branch_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid("Choose a date.");
    await c.query("UPDATE stock_commitment SET expected_date = $2 WHERE id = $1", [commitmentId, date]);
  });
}

/** PC-07: planned start = latest expected arrival of the job's back-ordered parts + buffer days. */
export async function plannedStart(c: PoolClient, jobId: string, branchId: string) {
  const r = (await c.query(
    `SELECT max(sc.expected_date) d, count(*) FILTER (WHERE sc.expected_date IS NULL) open_n, count(*) n FROM stock_commitment sc JOIN job_line l ON l.id = sc.job_line_id
      WHERE l.job_card_id = $1 AND sc.status = 'active' AND sc.back_ordered > 0`, [jobId])).rows[0];
  if (!Number(r.n) || !r.d) return null;
  const buffer = Number(await getSetting(c, "planning.buffer_days", branchId, 1));
  const d = new Date(r.d); d.setUTCDate(d.getUTCDate() + buffer);
  return { date: d.toISOString().slice(0, 10), incomplete: Number(r.open_n) > 0 };
}

/** Store queue: technicians' part requests and approved parts committed to open jobs, not yet issued. */
export async function storeQueue(ctx: Ctx) {
  const b = here(ctx);
  assertCan(ctx, "stock", "view", b);
  return withTx(ctx, async (c) => {
    const requests = (await c.query(
      `SELECT pr.*, j.doc_no job_no, i.part_no, coalesce(i.description, pr.description) item_desc, u.full_name requested_name, l.qty line_qty, l.issued_qty
         FROM part_request pr JOIN job_card j ON j.id = pr.job_card_id LEFT JOIN item i ON i.id = pr.item_id
         LEFT JOIN app_user u ON u.id = pr.requested_by LEFT JOIN job_line l ON l.id = pr.job_line_id
        WHERE pr.branch_id = $1 AND pr.status IN ('open','needs_quote') ORDER BY pr.requested_at`, [b])).rows;
    const toIssue = (await c.query(
      `SELECT l.id job_line_id, l.description, l.qty, l.issued_qty, sc.qty committed, sc.back_ordered, i.part_no, j.id job_id, j.doc_no job_no, j.status job_status
         FROM job_line l JOIN job_card j ON j.id = l.job_card_id JOIN item i ON i.id = l.item_id
         LEFT JOIN stock_commitment sc ON sc.job_line_id = l.id AND sc.status = 'active'
        WHERE l.branch_id = $1 AND NOT l.removed AND l.approval_status = 'approved' AND l.issued_qty < l.qty
          AND j.status IN ('approved','awaiting_parts','in_progress','quality_check') ORDER BY j.doc_no, l.line_no`, [b])).rows;
    return { requests, toIssue };
  });
}

export async function closePartRequest(ctx: Ctx, id: string, status: "issued" | "cancelled") {
  return withTx(ctx, async (c) => {
    const pr = (await c.query("SELECT * FROM part_request WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!pr) throw notFound("Part request");
    if (!can(ctx, "stock", "edit", pr.branch_id) && !can(ctx, "jobs", "edit", pr.branch_id)) throw forbidden();
    await c.query("UPDATE part_request SET status = $2, closed_by = $3, closed_at = now() WHERE id = $1", [id, status, ctx.userId]);
  });
}

export async function stockItemLedger(ctx: Ctx, itemId: string, branchId: string) {
  assertCan(ctx, "stock", "view");
  return withTx(ctx, async (c) => {
    const item = (await c.query("SELECT * FROM item WHERE id = $1", [itemId])).rows[0];
    if (!item) throw notFound("Item");
    const rows = (await c.query(
      `SELECT m.*, u.full_name FROM stock_move m LEFT JOIN app_user u ON u.id = m.user_id
        WHERE m.item_id = $1 AND m.branch_id = $2 ORDER BY m.at, m.id`, [itemId, branchId])).rows;
    return { item, rows: redact(ctx, rows, { unit_cost: "purchase_cost", value: "purchase_cost", balance_avg_cost: "purchase_cost" }, (r) => r.branch_id as string) };
  });
}

/**
 * Low-stock list (IN-06): parts at this branch whose free quantity is at or below the reorder level,
 * with what is already on order, the days of cover from the last 30 days' use, and what other branches have.
 */
export async function reorderList(ctx: Ctx, all = false) {
  const b = here(ctx);
  assertCan(ctx, "stock", "view", b);
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT i.id item_id, i.part_no, i.description, i.preferred_supplier_id, sp.name_en supplier, ib.reorder_level, ib.reorder_qty, ib.default_bin,
              coalesce(sb.on_hand - sb.committed - sb.reserved, 0) free,
              coalesce((SELECT sum(pl.qty - pl.received_qty) FROM po_line pl JOIN purchase_order p ON p.id = pl.po_id
                         WHERE pl.item_id = i.id AND p.branch_id = $1 AND p.status IN ('draft','pending_approval','approved','partly_received')), 0) on_po,
              coalesce((SELECT sum(tl.qty) FROM transfer_line tl JOIN transfer t ON t.id = tl.transfer_id
                         WHERE tl.item_id = i.id AND t.to_branch_id = $1 AND t.status IN ('requested','approved','dispatched')), 0) on_transfer,
              coalesce((SELECT sum(m.qty_out) FROM stock_move m WHERE m.item_id = i.id AND m.branch_id = $1 AND m.move_type = 'issue' AND m.at > now() - interval '30 days'), 0) / 30.0 daily_use,
              coalesce((SELECT json_agg(json_build_object('id', ob.id, 'code', ob.code, 'free', o.on_hand - o.committed - o.reserved) ORDER BY o.on_hand - o.committed - o.reserved DESC)
                          FROM stock_balance o JOIN branch ob ON ob.id = o.branch_id WHERE o.item_id = i.id AND o.branch_id <> $1 AND o.on_hand - o.committed - o.reserved > 0), '[]') elsewhere
         FROM item_branch ib JOIN item i ON i.id = ib.item_id AND i.active LEFT JOIN supplier sp ON sp.id = i.preferred_supplier_id
         LEFT JOIN stock_balance sb ON sb.item_id = i.id AND sb.branch_id = ib.branch_id
        WHERE ib.branch_id = $1 AND ($2 OR (ib.reorder_level > 0 AND coalesce(sb.on_hand - sb.committed - sb.reserved, 0) <= ib.reorder_level))
        ORDER BY i.part_no`, [b, all])).rows;
    return rows.map((r) => {
      const free = D(r.free), use = D(r.daily_use);
      return { ...r, low: free.lte(r.reorder_level) && D(r.reorder_level).gt(0), onOrder: D(r.on_po).plus(r.on_transfer).toString(),
        cover: use.gt(0) ? Math.floor(free.div(use).toNumber()) : null,
        suggest: Decimal.max(D(r.reorder_qty).gt(0) ? D(r.reorder_qty) : D(r.reorder_level).minus(free), 1).toString() };
    });
  });
}

/** Sets the reorder level and quantity of a part at this branch. */
export async function setReorder(ctx: Ctx, itemId: string, level: unknown, qty: unknown) {
  const b = here(ctx);
  assertCan(ctx, "stock", "edit", b);
  const l = qtyOrZero(level, "Reorder level"), q = qtyOrZero(qty, "Reorder quantity");
  return withTx(ctx, async (c) => {
    if (!(await c.query("SELECT 1 FROM item WHERE id = $1 AND active", [itemId])).rowCount) throw invalid("Part not found.");
    await c.query(`INSERT INTO item_branch (item_id, branch_id, reorder_level, reorder_qty) VALUES ($1,$2,$3,$4)
                   ON CONFLICT (item_id, branch_id) DO UPDATE SET reorder_level = $3, reorder_qty = $4`, [itemId, b, l, q]);
    await audit(c, ctx, "item_branch", itemId, "reorder", { level: l, qty: q }, b);
  });
}

function qtyOrZero(v: unknown, field: string) {
  return str(v) ? parseDec(v, field, { min: 0, dp: 3 }).toFixed(3) : "0.000";
}
