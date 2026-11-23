import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canSee } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { D, parseDec } from "../money";
import { optStr, str } from "../validate";
import { insertPoLine, newPo } from "./purchasing";

/**
 * PU-08: ask several suppliers for a price on the same parts, compare their quotes on price and lead
 * time, choose a supplier for each line (the cheapest by default), and raise draft purchase orders,
 * one per supplier, that then go through the normal PO approval. Prices are purchase cost (FP-01).
 */

function here(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}

export async function listRfqs(ctx: Ctx) {
  assertCan(ctx, "purchasing", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT r.*, b.code branch_code, (SELECT count(*) FROM rfq_line l WHERE l.rfq_id = r.id) lines,
            (SELECT count(*) FROM rfq_quote q WHERE q.rfq_id = r.id) quotes
       FROM rfq r JOIN branch b ON b.id = r.branch_id ORDER BY r.created_at DESC LIMIT 200`)).rows);
}

export async function createRfq(ctx: Ctx, f: { needed_by?: string; note?: string; lines: { item_id?: string; description?: string; qty?: string }[] }) {
  const b = here(ctx);
  assertCan(ctx, "purchasing", "create", b);
  const needed = optStr(f.needed_by);
  if (needed && !/^\d{4}-\d{2}-\d{2}$/.test(needed)) throw invalid("Needed-by date is not valid.");
  const rows = f.lines.filter((l) => str(l.item_id) || str(l.description));
  if (!rows.length) throw invalid("Add at least one part.");
  return withTx(ctx, async (c) => {
    const docNo = await nextDocNo(c, b, "rfq");
    const r = (await c.query("INSERT INTO rfq (branch_id, doc_no, needed_by, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [b, docNo, needed, optStr(f.note), ctx.userId])).rows[0];
    let n = 0;
    for (const l of rows) {
      const qty = parseDec(l.qty, "Quantity", { min: "0.001", dp: 3 });
      let desc = optStr(l.description);
      const itemId = optStr(l.item_id);
      if (itemId) {
        const it = (await c.query("SELECT part_no, description FROM item WHERE id = $1 AND active", [itemId])).rows[0];
        if (!it) throw invalid("Part not found.");
        desc = desc ?? `${it.part_no} ${it.description}`;
      }
      await c.query("INSERT INTO rfq_line (rfq_id, branch_id, line_no, item_id, description, qty) VALUES ($1,$2,$3,$4,$5,$6)", [r.id, b, ++n, itemId, desc, qty.toFixed(3)]);
    }
    await audit(c, ctx, "rfq", r.id, "created", { doc_no: docNo, lines: n }, b);
    return { id: r.id as string, docNo };
  });
}

async function lockOpen(c: PoolClient, ctx: Ctx, id: string) {
  const r = (await c.query("SELECT * FROM rfq WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!r) throw notFound("Price request");
  assertCan(ctx, "purchasing", "create", r.branch_id);
  if (!canSee(ctx, "purchase_cost", r.branch_id)) throw forbidden();
  if (r.status !== "open") throw invalid("This price request is closed.");
  return r;
}

export async function getRfq(ctx: Ctx, id: string) {
  assertCan(ctx, "purchasing", "view");
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT r.*, b.code branch_code, u.full_name created_by_name FROM rfq r JOIN branch b ON b.id = r.branch_id LEFT JOIN app_user u ON u.id = r.created_by WHERE r.id = $1", [id])).rows[0];
    if (!r) throw notFound("Price request");
    assertCan(ctx, "purchasing", "view", r.branch_id);
    const lines = (await c.query(
      `SELECT l.*, i.part_no, p.doc_no po_no FROM rfq_line l LEFT JOIN item i ON i.id = l.item_id LEFT JOIN purchase_order p ON p.id = l.po_id WHERE l.rfq_id = $1 ORDER BY l.line_no`, [id])).rows;
    const showCost = canSee(ctx, "purchase_cost", r.branch_id);
    const quotes = (await c.query(
      `SELECT q.*, s.code supplier_code, s.name_en supplier_name FROM rfq_quote q JOIN supplier s ON s.id = q.supplier_id WHERE q.rfq_id = $1 ORDER BY s.name_en`, [id])).rows;
    const prices = showCost ? (await c.query("SELECT ql.* FROM rfq_quote_line ql JOIN rfq_quote q ON q.id = ql.quote_id WHERE q.rfq_id = $1", [id])).rows : [];
    const price: Record<string, Record<string, string>> = {};   // quote -> line -> unit price
    for (const p of prices) (price[p.quote_id] ??= {})[p.rfq_line_id] = p.unit_price;
    // Comparison: per line the cheapest quote (ties go to the shorter lead time); per supplier the total of what it quoted.
    const best = showCost ? (await getRfqIn(c, id)).best : {};
    const totals = Object.fromEntries(quotes.map((q) => [q.id, {
      total: lines.reduce((s, l) => (price[q.id]?.[l.id] === undefined ? s : s.plus(D(price[q.id][l.id]).mul(l.qty))), D(0)).toFixed(2),
      quoted: lines.filter((l) => price[q.id]?.[l.id] !== undefined).length,
    }]));
    const suppliers = (await c.query("SELECT id, code, name_en FROM supplier WHERE active ORDER BY name_en")).rows;
    return { r, lines, quotes, price, best, totals, suppliers, showCost,
      canEdit: r.status === "open" && can(ctx, "purchasing", "create", r.branch_id) && showCost };
  });
}

/** Enters or corrects one supplier's quote: lead time, validity and a unit price per line (blank = not quoted). */
export async function saveQuote(ctx: Ctx, id: string, f: { supplier_id?: string; lead_days?: string; valid_until?: string; note?: string; price: Record<string, string> }) {
  return withTx(ctx, async (c) => {
    const r = await lockOpen(c, ctx, id);
    const sup = (await c.query("SELECT id FROM supplier WHERE id = $1 AND active", [str(f.supplier_id)])).rows[0];
    if (!sup) throw invalid("Choose an active supplier.");
    const lead = str(f.lead_days) === "" ? null : Number(f.lead_days);
    if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) throw invalid("Lead time is a whole number of days, 0 to 365.");
    const valid = optStr(f.valid_until);
    if (valid && !/^\d{4}-\d{2}-\d{2}$/.test(valid)) throw invalid("Valid-until date is not valid.");
    const lineIds = new Set((await c.query("SELECT id FROM rfq_line WHERE rfq_id = $1", [id])).rows.map((x) => x.id as string));
    const entered = Object.entries(f.price).filter(([k, v]) => lineIds.has(k) && str(v) !== "");
    if (!entered.length) throw invalid("Enter the supplier's price for at least one line.");
    const q = (await c.query(
      `INSERT INTO rfq_quote (rfq_id, branch_id, supplier_id, lead_days, valid_until, note, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (rfq_id, supplier_id) DO UPDATE SET lead_days = EXCLUDED.lead_days, valid_until = EXCLUDED.valid_until, note = EXCLUDED.note, entered_by = EXCLUDED.entered_by, entered_at = now()
       RETURNING id`, [id, r.branch_id, sup.id, lead, valid, optStr(f.note), ctx.userId])).rows[0];
    await c.query("DELETE FROM rfq_quote_line WHERE quote_id = $1", [q.id]);
    for (const [lineId, v] of entered) {
      const p = parseDec(v, "Unit price", { min: 0, dp: 4 });
      await c.query("INSERT INTO rfq_quote_line (quote_id, rfq_line_id, branch_id, unit_price) VALUES ($1,$2,$3,$4)", [q.id, lineId, r.branch_id, p.toFixed(4)]);
    }
    // A choice that pointed at a line this supplier no longer quotes is cleared.
    await c.query(`UPDATE rfq_line l SET chosen_quote_id = NULL WHERE l.rfq_id = $1 AND l.chosen_quote_id = $2
                     AND NOT EXISTS (SELECT 1 FROM rfq_quote_line x WHERE x.quote_id = $2 AND x.rfq_line_id = l.id)`, [id, q.id]);
    await audit(c, ctx, "rfq", id, "quote", { supplier_id: sup.id, lines: entered.length, lead_days: lead }, r.branch_id);
  });
}

/**
 * Raises the orders: each line goes to the supplier chosen for it (or the cheapest quote when none was
 * chosen), one draft purchase order per supplier at the quoted price. The orders still need approval.
 */
export async function orderRfq(ctx: Ctx, id: string, choice: Record<string, string>) {
  return withTx(ctx, async (c) => {
    const r = await lockOpen(c, ctx, id);
    const full = await getRfqIn(c, id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Row = Record<string, any>;
    const bySupplier = new Map<string, { quote: Row; lines: { line: Row; price: string }[] }>();
    for (const l of full.lines) {
      if (l.po_id) continue;
      const qid = str(choice[l.id]) || full.best[l.id];
      if (!qid || qid === "skip") continue;
      const quote = full.quotes.find((q) => q.id === qid);
      const price = quote ? full.price[qid]?.[l.id] : undefined;
      if (!quote || price === undefined) throw invalid(`Line ${l.line_no}: that supplier did not quote for it.`);
      const g = bySupplier.get(quote.supplier_id) ?? { quote, lines: [] as { line: Row; price: string }[] };
      g.lines.push({ line: l, price });
      bySupplier.set(quote.supplier_id, g);
    }
    if (!bySupplier.size) throw invalid("No line has a quote to order from yet.");
    const made: string[] = [];
    for (const [supplierId, g] of bySupplier) {
      const lead = g.quote.lead_days as number | null;
      const po = await newPo(c, ctx, r.branch_id, supplierId, {
        note: `From price request ${r.doc_no}`, delivery_date: lead !== null ? new Date(Date.now() + lead * 86_400_000).toISOString().slice(0, 10) : undefined });
      for (const { line, price } of g.lines) {
        await insertPoLine(c, { id: po.id, branch_id: r.branch_id }, { item_id: line.item_id ?? undefined, description: line.item_id ? undefined : line.description, qty: line.qty, unit_price: price });
        await c.query("UPDATE rfq_line SET chosen_quote_id = $2, po_id = $3 WHERE id = $1", [line.id, g.quote.id, po.id]);
      }
      made.push(po.docNo);
    }
    const left = (await c.query("SELECT count(*)::int n FROM rfq_line WHERE rfq_id = $1 AND po_id IS NULL", [id])).rows[0].n;
    if (!left) await c.query("UPDATE rfq SET status = 'ordered', ordered_by = $2, ordered_at = now() WHERE id = $1", [id, ctx.userId]);
    await audit(c, ctx, "rfq", id, "ordered", { purchase_orders: made }, r.branch_id);
    return { orders: made, left };
  });
}

async function getRfqIn(c: PoolClient, id: string) {
  const lines = (await c.query("SELECT * FROM rfq_line WHERE rfq_id = $1 ORDER BY line_no", [id])).rows;
  const quotes = (await c.query("SELECT * FROM rfq_quote WHERE rfq_id = $1", [id])).rows;
  const price: Record<string, Record<string, string>> = {};
  for (const p of (await c.query("SELECT ql.* FROM rfq_quote_line ql JOIN rfq_quote q ON q.id = ql.quote_id WHERE q.rfq_id = $1", [id])).rows) (price[p.quote_id] ??= {})[p.rfq_line_id] = p.unit_price;
  const best: Record<string, string> = {};
  for (const l of lines) {
    const opts = quotes.filter((q) => price[q.id]?.[l.id] !== undefined)
      .sort((a, b) => D(price[a.id][l.id]).comparedTo(price[b.id][l.id]) || (a.lead_days ?? 9999) - (b.lead_days ?? 9999));
    if (opts[0]) best[l.id] = opts[0].id;
  }
  return { lines, quotes, price, best };
}

export async function cancelRfq(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await lockOpen(c, ctx, id);
    if ((await c.query("SELECT 1 FROM rfq_line WHERE rfq_id = $1 AND po_id IS NOT NULL", [id])).rowCount) throw invalid("Some lines are already ordered; the rest can stay open.");
    await c.query("UPDATE rfq SET status = 'cancelled' WHERE id = $1", [id]);
    await audit(c, ctx, "rfq", id, "cancelled", {}, r.branch_id);
  });
}
