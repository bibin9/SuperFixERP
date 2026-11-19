import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Ctx, assertCan, roleAt } from "../access";
import { withTx, withBranchSystemTx } from "../db";
import { invalid, notFound, conflict } from "../errors";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { submitForApproval, registerHandler } from "./workflow";
import { calcDocument, D, Decimal } from "../money";
import { addDaysLocal, commitForLine, releaseCommitment, today } from "./stock";
import { setStatus, ENQUIRY_QUOTABLE, JOB_EDITABLE } from "./jobs";
import { optInt, str } from "../validate";

/** M04 quotations, customer approval and discount limits. */

const OPEN = ["draft", "pending_internal_approval", "ready_to_send", "sent"];
/** Quotation number from the enquiry number: YAS-ENQ-26-00012 revision 2 is YAS-Q-26-00012-2. */
export function quoteNo(enquiryNo: string, rev: number) {
  return `${enquiryNo.replace("-ENQ-", "-Q-")}-${rev}`;
}

/** Discount % = discount / amount before discount, per line and for the document (FSD 5.6). */
export function discountPercents(lines: { gross: Decimal; lineDiscount: Decimal }[], docDiscount: Decimal) {
  const gross = lines.reduce((s, l) => s.plus(l.gross), D(0));
  const perLine = lines.map((l) => (l.gross.gt(0) ? l.lineDiscount.div(l.gross).mul(100) : D(0)));
  const total = lines.reduce((s, l) => s.plus(l.lineDiscount), D(0)).plus(docDiscount);
  const docPct = gross.gt(0) ? total.div(gross).mul(100) : D(0);
  return { maxLinePct: perLine.reduce((m, p) => Decimal.max(m, p), D(0)), docPct };
}

/**
 * Saves a quotation revision for an enquiry. Before the job card exists this is the quotation the
 * customer approves to start the job; afterwards it is a revised quotation for extra work (JC-07).
 * Older open revisions become Superseded. Discounts above the role's limit, or a below-margin price,
 * send it to the discount workflow and it cannot be sent until approved (QT-04, FP-05). Saving shows
 * part availability but commits nothing: parts are committed only for approved lines on a job card.
 */
export async function saveQuotation(ctx: Ctx, enquiryId: string, f: { doc_discount?: unknown; valid_days?: unknown; terms?: unknown } = {}) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [enquiryId]);
    if (!e.rowCount) throw notFound("Enquiry");
    const enq = e.rows[0];
    assertCan(ctx, "jobs", "edit", enq.branch_id);
    let jobId: string | null = null;
    if (enq.status === "converted") {
      const job = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [enq.converted_job_id])).rows[0];
      if (!JOB_EDITABLE.includes(job.status)) throw invalid("A quotation cannot be made at this job status.");
      jobId = job.id;
    } else if (!ENQUIRY_QUOTABLE.includes(enq.status)) throw invalid("This enquiry is closed.");
    if (!enq.customer_id || !enq.vehicle_id) throw invalid("Pick the customer and the vehicle first.");
    const job = { branch_id: enq.branch_id as string };
    const lines = (await c.query(
      `SELECT l.*, t.rate vat_rate FROM job_line l JOIN tax_code t ON t.code = l.vat_code
        WHERE l.enquiry_id = $1 AND NOT l.removed AND l.approval_status IN ('pending','approved') ORDER BY l.line_no`, [enquiryId])).rows;
    if (!lines.some((l) => l.approval_status === "pending")) throw invalid("Add at least one new line to quote.");
    const docDiscount = str(f.doc_discount) ? D(str(f.doc_discount)) : D(0);
    if (docDiscount.isNeg() || docDiscount.decimalPlaces() > 2) throw invalid("Document discount must be an amount.");
    // Lines the customer already approved keep their approved amounts; only new lines are priced
    // now and only they need approval (revision rule). The overall discount spreads over new lines.
    const prevApproved = new Map((await c.query(
      `SELECT DISTINCT ON (ql.job_line_id) ql.* FROM quotation_line ql JOIN quotation qq ON qq.id = ql.quotation_id
        WHERE qq.enquiry_id = $1 AND ql.decision = 'approved' ORDER BY ql.job_line_id, qq.revision DESC`, [enquiryId])).rows.map((r) => [r.job_line_id, r]));
    const pending = lines.filter((l) => l.approval_status === "pending");
    const calcNew = calcDocument(pending.map((l) => ({ key: l.id, qty: l.qty, unitPrice: l.unit_price, lineDiscount: l.discount_amount, vatRate: l.vat_rate })), docDiscount);
    const kept = lines.filter((l) => l.approval_status === "approved").map((l) => {
      const p = prevApproved.get(l.id);
      if (!p) throw invalid(`Approved line ${l.line_no} has no approved quotation line.`);
      return { key: l.id, gross: D(p.gross_amount), lineDiscount: D(p.line_discount), docDiscountShare: D(p.doc_discount_share), taxable: D(p.taxable_amount), vat: D(p.vat_amount), total: D(p.line_total) };
    });
    const byKey = new Map([...calcNew.lines, ...kept].map((x) => [x.key, x]));
    const all = lines.map((l) => byKey.get(l.id)!);
    const sumOf = (f: (x: (typeof all)[number]) => Decimal) => all.reduce((s, x) => s.plus(f(x)), D(0));
    const calc = {
      lines: all,
      gross: sumOf((x) => x.gross), discount: sumOf((x) => x.lineDiscount.plus(x.docDiscountShare)),
      taxable: sumOf((x) => x.taxable), vat: sumOf((x) => x.vat), total: sumOf((x) => x.total),
    };

    // Discount limit per role (settings per branch); the user's role at the job's branch applies.
    const role = roleAt(ctx, job.branch_id);
    const limit = D(await getSetting(c, `discount.max_pct.${role?.roleCode}`, job.branch_id, 0));
    const pcts = discountPercents(calcNew.lines, docDiscount);
    const maxPct = Decimal.max(pcts.maxLinePct, pcts.docPct);
    const below = lines.filter((l) => l.approval_status === "pending" && l.below_margin);
    const reasons: string[] = [];
    if (maxPct.gt(limit)) reasons.push(`Discount ${maxPct.toFixed(2)}% is above your limit of ${limit.toFixed(2)}%`);
    if (below.length) reasons.push("Needs manager approval: price below allowed level");

    await c.query("UPDATE quotation SET status = 'superseded', updated_at = now(), version = version + 1 WHERE enquiry_id = $1 AND status = ANY($2)", [enquiryId, OPEN]);
    await c.query("UPDATE approval_request SET status = 'recalled', decided_at = now() WHERE doc_type = 'discount' AND status = 'pending' AND doc_id IN (SELECT id FROM quotation WHERE enquiry_id = $1)", [enquiryId]);
    const rev = (await c.query("SELECT coalesce(max(revision),0)+1 r FROM quotation WHERE enquiry_id = $1", [enquiryId])).rows[0].r;
    const validDays = optInt(f.valid_days, "Validity days", 1, 90) ?? Number(await getSetting(c, "quotation.validity_days", job.branch_id, 7));
    const validUntil = addDaysLocal(validDays);
    const docNo = quoteNo(enq.doc_no, rev);
    const approvedTotal = kept.reduce((s, x) => s.plus(x.total), D(0));
    const q = await c.query(
      `INSERT INTO quotation (branch_id, enquiry_id, job_card_id, revision, doc_no, status, valid_until, doc_discount_amount, gross_amount, discount_total, taxable_total, vat_total, grand_total,
                              approved_total, needs_internal_approval, internal_approval_reason, terms, created_by, updated_by)
       VALUES ($1,$17,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING id`,
      [job.branch_id, jobId, rev, docNo, validUntil, docDiscount.toFixed(2), calc.gross.toFixed(2), calc.discount.toFixed(2),
        calc.taxable.toFixed(2), calc.vat.toFixed(2), calc.total.toFixed(2), approvedTotal.toFixed(2), reasons.length > 0, reasons.join("; ") || null, str(f.terms) || null, ctx.userId, enquiryId]);
    const qid = q.rows[0].id;
    for (const [i, x] of calc.lines.entries()) {
      const l = lines[i];
      await c.query(
        `INSERT INTO quotation_line (quotation_id, branch_id, job_line_id, line_no, line_type, description, qty, unit_price, gross_amount, line_discount, doc_discount_share,
                                     taxable_amount, vat_code, vat_rate, vat_amount, line_total, below_margin, decision, decided_at, decision_channel, decided_by, decision_note)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, pl.decided_at, pl.decision_channel, pl.decided_by, pl.decision_note
           FROM (SELECT 1) one LEFT JOIN LATERAL (
             SELECT ql.* FROM quotation_line ql JOIN quotation qq ON qq.id = ql.quotation_id
              WHERE ql.job_line_id = $3 AND ql.decision = 'approved' ORDER BY qq.revision DESC LIMIT 1) pl ON $18 = 'approved'`,
        [qid, job.branch_id, l.id, l.line_no, l.line_type, l.description, l.qty, l.unit_price, x.gross.toFixed(2), x.lineDiscount.toFixed(2), x.docDiscountShare.toFixed(2),
          x.taxable.toFixed(2), l.vat_code, l.vat_rate, x.vat.toFixed(2), x.total.toFixed(2), l.below_margin, l.approval_status === "approved" ? "approved" : "pending"]);
    }
    let status = "ready_to_send";
    if (reasons.length) {
      const res = await submitForApproval(c, ctx, {
        docType: "discount", docId: qid, docRef: docNo, branchId: job.branch_id, amount: calc.total.toFixed(2), discountPct: maxPct.toFixed(4),
        summary: { reason: reasons.join("; "), enquiry: enq.doc_no, total: calc.total.toFixed(2), discount: calc.discount.toFixed(2) },
      });
      status = res.status === "approved" ? "ready_to_send" : "pending_internal_approval";
    }
    await c.query("UPDATE quotation SET status = $2 WHERE id = $1", [qid, status]);
    await audit(c, ctx, "quotation", qid, "save", { doc_no: docNo, total: calc.total.toFixed(2), discount: calc.discount.toFixed(2), status }, job.branch_id);
    return { id: qid, docNo, status, reasons };
  });
}

registerHandler("discount", {
  async onApproved(c, _ctx, req) {
    await c.query("UPDATE quotation SET status = 'ready_to_send', updated_at = now(), version = version + 1 WHERE id = $1 AND status = 'pending_internal_approval'", [req.doc_id]);
  },
  async onRejected(c, _ctx, req) {
    await c.query("UPDATE quotation SET status = 'draft', updated_at = now(), version = version + 1 WHERE id = $1 AND status = 'pending_internal_approval'", [req.doc_id]);
  },
});

/** Sends the quotation: creates the customer approval link. Before the job exists the enquiry becomes Quoted. */
export async function sendQuotation(ctx: Ctx, qid: string) {
  return withTx(ctx, async (c) => {
    const q = await c.query("SELECT * FROM quotation WHERE id = $1 FOR UPDATE", [qid]);
    if (!q.rowCount) throw notFound("Quotation");
    const qt = q.rows[0];
    assertCan(ctx, "jobs", "edit", qt.branch_id);
    if (qt.status === "pending_internal_approval") throw invalid("This quotation is waiting for manager approval and cannot be sent yet.");
    if (!["ready_to_send", "sent"].includes(qt.status)) throw invalid("Only a quotation that is ready can be sent.");
    const token = qt.public_token ?? crypto.randomBytes(32).toString("base64url");
    await c.query("UPDATE quotation SET status = 'sent', public_token = $2, sent_at = now(), version = version + 1 WHERE id = $1", [qid, token]);
    await c.query("UPDATE enquiry SET status = 'quoted', updated_at = now(), version = version + 1 WHERE id = $1 AND status IN ('open','booked','approved')", [qt.enquiry_id]);
    await audit(c, ctx, "quotation", qid, "send", { doc_no: qt.doc_no }, qt.branch_id);
    return { token, enquiryId: qt.enquiry_id as string, jobId: qt.job_card_id as string | null };
  });
}

type Decisions = Record<string, "approved" | "declined">;

async function applyDecisions(c: PoolClient, actorId: string | null, qid: string, decisions: Decisions, channel: string, note: string | null) {
  const q = await c.query("SELECT * FROM quotation WHERE id = $1 FOR UPDATE", [qid]);
  if (!q.rowCount) throw notFound("Quotation");
  const qt = q.rows[0];
  if (qt.status !== "sent") throw conflict("This quotation is no longer waiting for the customer's answer.");
  if (qt.valid_until < today()) throw invalid("This quotation has expired.");
  if (channel === "phone" && !note) throw invalid("A phone approval needs a note.");
  if (channel === "whatsapp_reply" && !note) throw invalid("A WhatsApp reply needs a note of what the customer wrote.");
  const enq = (await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [qt.enquiry_id])).rows[0];
  const job = qt.job_card_id ? (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [qt.job_card_id])).rows[0] : null;
  const lines = (await c.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [qid])).rows;
  const pending = lines.filter((l) => l.decision === "pending");
  for (const l of pending) if (!decisions[l.id]) throw invalid("Approve or decline every line.");
  const followDays = Number(await getSetting(c, "quotation.deferred_follow_up_days", qt.branch_id, 30));
  let backOrdered = false;
  for (const l of pending) {
    const d = decisions[l.id];
    await c.query("UPDATE quotation_line SET decision = $2, decided_at = now(), decision_channel = $3, decided_by = $4, decision_note = $5 WHERE id = $1", [l.id, d, channel, actorId, note]);
    const jl = (await c.query("UPDATE job_line SET approval_status = $2, version = version + 1 WHERE id = $1 RETURNING *", [l.job_line_id, d === "approved" ? "approved" : "deferred"])).rows[0];
    if (d === "declined") {
      // QT-03 deferred work, saved against the vehicle whether or not a job card exists yet.
      await releaseCommitment(c, l.job_line_id);
      await c.query("INSERT INTO deferred_work (vehicle_id, branch_id, enquiry_id, job_card_id, description, follow_up_date) VALUES ($1,$2,$3,$4,$5, current_date + $6::int)",
        [enq.vehicle_id, qt.branch_id, enq.id, qt.job_card_id, l.description, followDays]);
    } else if (job) {
      // Extra work on an open job: parts are committed once the customer approves (PC-01).
      const sc = await commitForLine(c, jl);
      if (sc && Number(sc.back_ordered) > 0) backOrdered = true;
    }
  }
  const after = lines.map((l) => ({ ...l, decision: l.decision === "pending" ? decisions[l.id] : l.decision }));
  const approved = after.filter((l) => l.decision === "approved");
  const approvedTotal = approved.reduce((s, l) => s.plus(l.line_total), D(0));
  const status = approved.length === after.length ? "approved" : approved.length ? "partly_approved" : "declined";
  await c.query("UPDATE quotation SET status = $2, approved_total = $3, updated_at = now(), version = version + 1 WHERE id = $1", [qid, status, approvedTotal.toFixed(2)]);
  if (!job) {
    // The job card is created by the advisor from the approved quotation (FSD v0.10).
    if (approved.length) await c.query("UPDATE enquiry SET status = 'approved', approved_at = now(), updated_at = now(), version = version + 1 WHERE id = $1", [enq.id]);
    else await c.query("UPDATE enquiry SET status = 'lost', lost_reason = 'Customer declined the quotation', updated_at = now(), version = version + 1 WHERE id = $1", [enq.id]);
  } else if (backOrdered && job.status === "approved") {
    await setStatus(c, null, job, "awaiting_parts", "Approved extra part is back-ordered");
  }
  await c.query("INSERT INTO audit_log (user_id, branch_id, entity, entity_id, action, changes) VALUES ($1,$2,'quotation',$3,'customer_decision',$4)",
    [actorId, qt.branch_id, qid, JSON.stringify({ channel, note, decisions })]);
  return { status, enquiryId: enq.id as string, jobId: qt.job_card_id as string | null };
}

export const STAFF_CHANNELS = ["in_person", "phone", "email", "whatsapp_reply"] as const;
export type StaffChannel = (typeof STAFF_CHANNELS)[number];

/** Advisor records an answer given in person, by phone, by email or as a typed WhatsApp reply (QT-02). */
export async function recordDecisionsByStaff(ctx: Ctx, qid: string, decisions: Decisions, channel: StaffChannel, note: string | null) {
  // Staff can never record a decision as if the customer used the approval link themselves.
  if (!(STAFF_CHANNELS as readonly string[]).includes(channel)) throw invalid("Choose how the customer gave the answer.");
  return withTx(ctx, async (c) => {
    const q = await c.query("SELECT branch_id FROM quotation WHERE id = $1", [qid]);
    if (!q.rowCount) throw notFound("Quotation");
    assertCan(ctx, "jobs", "edit", q.rows[0].branch_id);
    return applyDecisions(c, ctx.userId, qid, decisions, channel, note);
  });
}

async function branchForToken(token: string) {
  const { withAnonTx } = await import("../db");
  return withAnonTx(async (c) => (await c.query("SELECT quotation_branch_by_token($1) b", [token])).rows[0].b as string | null);
}

/** Public customer approval page: quotation by unguessable token, prices incl. VAT, no internal data. */
export async function getPublicQuotation(token: string) {
  const branchId = await branchForToken(token);
  if (!branchId) return null;
  return withBranchSystemTx(branchId, async (c) => {
    const q = (await c.query(
      `SELECT q.id, q.doc_no, q.status, q.valid_until, q.taxable_total, q.vat_total, q.grand_total, q.approved_total, b.name_en branch_name, b.phone branch_phone,
              v.make, v.model, v.plate_code, v.plate_number, v.registered_in, c.customer_type, c.title, c.first_name, c.last_name, c.company_name
         FROM quotation q JOIN branch b ON b.id = q.branch_id JOIN enquiry e ON e.id = q.enquiry_id JOIN vehicle v ON v.id = e.vehicle_id JOIN customer c ON c.id = e.customer_id
        WHERE q.public_token = $1`, [token])).rows[0];
    if (!q) return null;
    const lines = (await c.query("SELECT id, line_no, description, qty, line_total, decision FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [q.id])).rows;
    return { q, lines, expired: q.valid_until < today() };
  });
}

export async function submitPublicDecisions(token: string, decisions: Decisions) {
  const branchId = await branchForToken(token);
  if (!branchId) throw notFound("Quotation");
  return withBranchSystemTx(branchId, async (c) => {
    const q = await c.query("SELECT id FROM quotation WHERE public_token = $1", [token]);
    if (!q.rowCount) throw notFound("Quotation");
    return applyDecisions(c, null, q.rows[0].id, decisions, "whatsapp_link", null);
  });
}

/** QT expiry: open quotations past their validity become Expired. Nothing is committed before approval. */
export async function expireQuotations(c: PoolClient, enquiryId: string | null = null) {
  const r = await c.query("UPDATE quotation SET status = 'expired', updated_at = now(), version = version + 1 WHERE status IN ('draft','pending_internal_approval','ready_to_send','sent') AND valid_until < current_date AND ($1::uuid IS NULL OR enquiry_id = $1) RETURNING id", [enquiryId]);
  return r.rowCount;
}
