import { blockSql, toChunk } from "../paging";
import type { PoolClient } from "pg";
import { Ctx, assertCan, can, canSee, roleAt, redact, fieldLevel } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound, conflict } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { getSetting } from "./settings";
import { D, r2, parseDec } from "../money";
import { optStr, required, optInt, str } from "../validate";
import { releaseCommitment } from "./stock";
import { history as approvalHistory } from "./workflow";

/** M02 enquiries and M03 job cards. */

function currentBranch(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}

// ---------- job cards ----------

// A job card exists only after the customer approved a quotation, so it starts at Approved.
// Booked, checked in and quoted are enquiry stages (FSD v0.10).
const TRANSITIONS: Record<string, string[]> = {
  approved: ["in_progress", "awaiting_parts", "cancelled"],
  awaiting_parts: ["in_progress", "cancelled"],
  in_progress: ["quality_check"],
  quality_check: ["ready", "in_progress"],
  ready: ["delivered", "invoiced"],
  delivered: ["invoiced"],
  invoiced: ["closed"],
  closed: [],
  cancelled: [],
};
export const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  awaiting_parts: "Awaiting parts", in_progress: "In progress", quality_check: "Quality check", ready: "Ready", delivered: "Delivered",
  invoiced: "Invoiced", closed: "Closed", cancelled: "Cancelled",
};
export const nextStatuses = (s: string) => TRANSITIONS[s] ?? [];
export const JOB_EDITABLE = ["approved", "awaiting_parts", "in_progress", "quality_check"];
const EDITABLE = JOB_EDITABLE;

export async function setStatus(c: PoolClient, ctx: Ctx | null, job: { id: string; branch_id: string; status: string }, to: string, reason?: string | null) {
  await c.query("UPDATE job_card SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1", [job.id, to]);
  await c.query("INSERT INTO job_status_history (job_card_id, branch_id, from_status, to_status, reason, user_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [job.id, job.branch_id, job.status, to, reason ?? null, ctx?.userId ?? null]);
}

export async function listJobs(ctx: Ctx, status = "", q = "", offset = 0) {
  if (!can(ctx, "jobs", "view") && !can(ctx, "workshop", "view")) throw forbidden();
  const ownOnly = !can(ctx, "jobs", "view");
  const late = status === "late";
  const term = q.trim().slice(0, 80);
  return toChunk(await withTx(ctx, async (c) => (await c.query(
    `SELECT j.id, j.doc_no, j.status, j.job_type, j.promised_at, j.created_at, b.code branch_code, b.name_en branch_name, v.make, v.model, v.model_year, v.registered_in, v.plate_code, v.plate_number,
            c.customer_type, c.title, c.first_name, c.last_name, c.company_name, u.full_name advisor_name,
            (SELECT string_agg(x.description, ' + ' ORDER BY x.line_no) FROM (SELECT l.description, l.line_no FROM job_line l WHERE l.job_card_id = j.id AND l.line_type IN ('labour','part') ORDER BY l.line_no LIMIT 2) x) summary,
            (j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled')) late,
            j.branch_id,
            (SELECT string_agg(DISTINCT tu.full_name, ', ') FROM job_line l JOIN job_assignment a ON a.job_line_id = l.id JOIN app_user tu ON tu.id = a.technician_id WHERE l.job_card_id = j.id AND NOT l.removed) techs,
            (SELECT coalesce(sum(l.standard_hours), 0) FROM job_line l WHERE l.job_card_id = j.id AND l.line_type = 'labour' AND l.approval_status = 'approved' AND NOT l.removed) std_h,
            (SELECT coalesce(sum(extract(epoch FROM coalesce(t.nx, now()) - t.at)), 0) / 3600 FROM (SELECT e.kind, e.at, lead(e.at) OVER (PARTITION BY e.technician_id, e.job_line_id ORDER BY e.at) nx FROM time_event e WHERE e.job_card_id = j.id) t WHERE t.kind IN ('clock_in','resume')) actual_h,
            (SELECT coalesce(sum(round(l.qty * l.unit_price, 2) - l.discount_amount), 0) FROM job_line l WHERE l.job_card_id = j.id AND l.approval_status = 'approved' AND NOT l.removed) value
       FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id LEFT JOIN app_user u ON u.id = j.advisor_id
      WHERE ($1 = '' OR $1 = 'late' OR j.status = $1)
        AND (NOT $4 OR (j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled')))
        AND ($5 = '' OR concat_ws(' ', j.doc_no, v.plate_code, v.plate_number, v.make, v.model, v.vin, c.first_name, c.last_name, c.company_name, c.mobile) ILIKE '%' || $5 || '%')
        AND (NOT $2 OR EXISTS (SELECT 1 FROM job_line l WHERE l.job_card_id = j.id AND (l.technician_id = $3 OR EXISTS (SELECT 1 FROM job_assignment a WHERE a.job_line_id = l.id AND a.technician_id = $3))))
      ORDER BY j.created_at DESC ${blockSql(offset)}`, [status, ownOnly, ctx.userId, late, term],
  )).rows.map((r) => (canSee(ctx, "selling_price", r.branch_id) ? r : { ...r, value: null }))), offset);
}

export const LINE_FIELDS = { unit_price: "selling_price", discount_amount: "discount", avg_cost: "purchase_cost", margin_pct: "purchase_cost" };
export const QLINE_FIELDS = { unit_price: "selling_price", gross_amount: "selling_price", line_discount: "discount", doc_discount_share: "discount", taxable_amount: "selling_price", vat_amount: "selling_price", line_total: "selling_price" };
export const Q_FIELDS = { gross_amount: "selling_price", discount_total: "discount", doc_discount_amount: "discount", taxable_total: "selling_price", vat_total: "selling_price", grand_total: "selling_price", approved_total: "selling_price" };

/** Job card with lines, quotations and history. Prices and costs are removed per field permissions. */
export async function getJob(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const j = await c.query(
      `SELECT j.*, b.code branch_code, b.name_en branch_name, v.make, v.model, v.model_year, v.registered_in, v.plate_code, v.plate_number, v.vin,
              c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, c.whatsapp, c.trn, u.full_name advisor_name, e.doc_no enquiry_no
         FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id
         LEFT JOIN app_user u ON u.id = j.advisor_id LEFT JOIN enquiry e ON e.id = j.enquiry_id WHERE j.id = $1`, [id]);
    if (!j.rowCount) throw notFound("Job card");
    const job = j.rows[0];
    const ownOnly = !can(ctx, "jobs", "view", job.branch_id);
    if (ownOnly) {
      if (!can(ctx, "workshop", "view", job.branch_id)) throw forbidden();
      const mine = await c.query("SELECT 1 FROM job_line l WHERE l.job_card_id = $1 AND (l.technician_id = $2 OR EXISTS (SELECT 1 FROM job_assignment a WHERE a.job_line_id = l.id AND a.technician_id = $2))", [id, ctx.userId]);
      if (!mine.rowCount) throw notFound("Job card");
    }
    const lines = (await c.query(
      `SELECT l.*, sb.avg_cost, u.full_name technician_name, i.part_no,
              sc.qty committed_qty, sc.back_ordered
         FROM job_line l LEFT JOIN stock_balance sb ON sb.item_id = l.item_id AND sb.branch_id = l.branch_id
         LEFT JOIN app_user u ON u.id = l.technician_id LEFT JOIN item i ON i.id = l.item_id
         LEFT JOIN stock_commitment sc ON sc.job_line_id = l.id AND sc.status = 'active'
        WHERE l.job_card_id = $1 AND NOT l.removed ORDER BY l.line_no`, [id])).rows;
    await c.query("UPDATE quotation SET status = 'expired', updated_at = now(), version = version + 1 WHERE job_card_id = $1 AND status IN ('draft','pending_internal_approval','ready_to_send','sent') AND valid_until < current_date", [id]);
    const quotations = (await c.query("SELECT * FROM quotation WHERE job_card_id = $1 ORDER BY revision DESC", [id])).rows;
    const latest = quotations[0];
    const qlines = latest ? (await c.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [latest.id])).rows : [];
    const statusHistory = (await c.query("SELECT h.*, u.full_name FROM job_status_history h LEFT JOIN app_user u ON u.id = h.user_id WHERE job_card_id = $1 ORDER BY at", [id])).rows;
    const invoices = (await c.query(`SELECT i.id, i.doc_no, i.doc_date, i.grand_total, i.paid_amount, i.credited_amount, i.invoice_kind, i.bill_to_name, i.source FROM sales_invoice i
       WHERE i.job_card_id = $1 OR EXISTS (SELECT 1 FROM sales_invoice_job x WHERE x.invoice_id = i.id AND x.job_card_id = $1) ORDER BY i.doc_no`, [id])).rows;
    const invoicedLineIds = (await c.query("SELECT sil.job_line_id FROM sales_invoice_line sil JOIN job_line l ON l.id = sil.job_line_id WHERE l.job_card_id = $1", [id])).rows.map((r) => r.job_line_id as string);
    const warranty = (await c.query("SELECT id, doc_no, claim_ref FROM warranty_claim WHERE job_card_id = $1 ORDER BY doc_no", [id])).rows;
    const approvals = latest ? await approvalHistory(c, "discount", latest.id) : [];
    const b = job.branch_id;
    return {
      job,
      lines: redact(ctx, lines, LINE_FIELDS, () => b),
      quotations: redact(ctx, quotations, Q_FIELDS, () => b),
      quotationLines: redact(ctx, qlines, QLINE_FIELDS, () => b),
      statusHistory,
      invoices: canSee(ctx, "selling_price", b) ? invoices : [],
      invoicedLineIds, warranty,
      approvals,
      canSeePrices: canSee(ctx, "selling_price", b),
      ownJobsOnly: ownOnly,
    };
  });
}

async function lockJob(c: PoolClient, ctx: Ctx, id: string, action: "edit" | "cancel" | "approve" = "edit") {
  const j = await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [id]);
  if (!j.rowCount) throw notFound("Job card");
  assertCan(ctx, "jobs", action, j.rows[0].branch_id);
  return j.rows[0];
}

/**
 * FP-05 below-cost check without showing cost: flags a part line whose net selling price gives a
 * margin below the minimum margin setting, or is below cost.
 */
async function isBelowMargin(c: PoolClient, branchId: string, itemId: string | null, qty: string, unitPrice: string, discount: string) {
  if (!itemId) return false;
  const b = await c.query("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [itemId, branchId]);
  const cost = D(b.rows[0]?.avg_cost ?? 0);
  if (cost.lte(0)) return false;
  const netUnit = D(qty).mul(unitPrice).minus(discount).div(qty);
  if (netUnit.lte(0)) return true;
  const minMargin = D(await getSetting(c, "pricing.min_margin_pct", branchId, 10)).div(100);
  return netUnit.minus(cost).div(netUnit).lt(minMargin);
}

export const ENQUIRY_QUOTABLE = ["open", "booked", "quoted", "approved"];
export type Owner = { kind: "job" | "enquiry"; id: string };

/**
 * Locks whatever owns the work lines. Before the job card exists that is the enquiry (the quotation
 * is built there); after it exists, new lines go on the job card as extra work (JC-07).
 */
async function lockOwner(c: PoolClient, ctx: Ctx, owner: Owner) {
  if (owner.kind === "job") {
    const job = await lockJob(c, ctx, owner.id);
    if (!EDITABLE.includes(job.status)) throw invalid(`Lines cannot be changed while the job is ${STATUS_LABEL[job.status]}.`);
    return { branchId: job.branch_id as string, enquiryId: job.enquiry_id as string, jobId: job.id as string | null, extra: true, ref: job.doc_no as string };
  }
  const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [owner.id]);
  if (!e.rowCount) throw notFound("Enquiry");
  const enq = e.rows[0];
  assertCan(ctx, "jobs", "edit", enq.branch_id);
  if (enq.status === "converted") throw invalid("The job card exists already. Add extra work on the job card.");
  if (!ENQUIRY_QUOTABLE.includes(enq.status)) throw invalid("This enquiry is closed.");
  if (!enq.customer_id || !enq.vehicle_id) throw invalid("Pick the customer and the vehicle before adding work.");
  return { branchId: enq.branch_id as string, enquiryId: enq.id as string, jobId: null as string | null, extra: false, ref: enq.doc_no as string };
}

async function addLine(ctx: Ctx, owner: Owner, f: Record<string, unknown>) {
  return withTx(ctx, (c) => addLineIn(c, ctx, owner, f));
}

/** Adds one work line inside the caller's transaction (also used to add a whole service bundle). */
export async function addLineIn(c: PoolClient, ctx: Ctx, owner: Owner, f: Record<string, unknown>) {
  {
    const o = await lockOwner(c, ctx, owner);
    const type = required(f.line_type, "Line type");
    let description = optStr(f.description);
    let unitPrice: string | null = null;
    let qty = str(f.qty) || "1";
    let stdHours: string | null = null;
    let serviceId: string | null = null;
    let itemId: string | null = null;
    let vatCode = String(await getSetting(c, "tax.default_code", o.branchId, "SR"));
    if (type === "labour") {
      serviceId = required(f.service_id, "Service");
      const s = await c.query("SELECT * FROM service WHERE id = $1 AND active", [serviceId]);
      if (!s.rowCount) throw invalid("Service not found.");
      // WS-03: standard time copied from the master; later master changes do not change open work.
      stdHours = s.rows[0].standard_hours;
      qty = str(f.qty) || s.rows[0].standard_hours;
      unitPrice = s.rows[0].labour_rate;
      description = description || s.rows[0].name_en;
      vatCode = s.rows[0].vat_code;
    } else if (type === "part" || type === "consumable") {
      itemId = required(f.item_id, "Part");
      const i = await c.query("SELECT * FROM item WHERE id = $1 AND active", [itemId]);
      if (!i.rowCount) throw invalid("Part not found.");
      unitPrice = i.rows[0].list_price;
      description = description || `${i.rows[0].part_no} ${i.rows[0].description}`;
      vatCode = i.rows[0].vat_code;
    } else if (type !== "outside") throw invalid("Unknown line type.");
    if (!(await c.query("SELECT 1 FROM tax_code WHERE code = $1 AND active", [vatCode])).rowCount) throw invalid(`Tax code ${vatCode} is not active.`);
    // Advisors may change the price only with the Edit level on selling price.
    const priceLevel = fieldLevel(ctx, "selling_price", o.branchId);
    if (str(f.unit_price)) {
      if (priceLevel !== "edit" && unitPrice !== null && D(str(f.unit_price)).cmp(unitPrice) !== 0) throw forbidden("You cannot change the selling price.");
      unitPrice = parseDec(f.unit_price, "Unit price", { min: 0, dp: 2 }).toFixed(2);
    }
    if (unitPrice === null) throw invalid("Enter the price for outside work.");
    const q = parseDec(qty, "Quantity", { min: "0.001", dp: 3 });
    if (q.lte(0)) throw invalid("Quantity must be more than zero.");
    const discount = str(f.discount_amount) ? parseDec(f.discount_amount, "Discount", { min: 0, dp: 2 }) : D(0);
    if (discount.gt(0) && fieldLevel(ctx, "discount", o.branchId) !== "edit") throw forbidden("You cannot give a discount.");
    if (discount.gt(r2(q.mul(unitPrice)))) throw invalid("Discount cannot be more than the line amount.");
    const below = await isBelowMargin(c, o.branchId, itemId, q.toString(), unitPrice, discount.toFixed(2));
    const no = (await c.query("SELECT coalesce(max(line_no),0)+1 n FROM job_line WHERE enquiry_id = $1", [o.enquiryId])).rows[0].n;
    const r = await c.query(
      `INSERT INTO job_line (enquiry_id, job_card_id, branch_id, line_no, line_type, service_id, item_id, description, qty, standard_hours, unit_price, discount_amount, vat_code,
                             technician_id, extra_work, below_margin, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [o.enquiryId, o.jobId, o.branchId, no, type, serviceId, itemId, description, q.toFixed(3), stdHours, unitPrice, discount.toFixed(2), vatCode,
        o.jobId ? optStr(f.technician_id) : null, o.extra, below, ctx.userId],
    );
    await audit(c, ctx, "job_line", r.rows[0].id, "create", { ref: o.ref, description, qty: q.toFixed(3), unit_price: unitPrice, discount: discount.toFixed(2), below_margin: below, extra_work: o.extra }, o.branchId);
    return { id: r.rows[0].id as string, belowMargin: below };
  }
}

/** A work line on the enquiry, priced for the quotation. */
export const addEnquiryLine = (ctx: Ctx, enquiryId: string, f: Record<string, unknown>) => addLine(ctx, { kind: "enquiry", id: enquiryId }, f);
/** Extra work found on an open job card; it needs a revised quotation approved before work or billing (JC-07). */
export const addJobLine = (ctx: Ctx, jobId: string, f: Record<string, unknown>) => addLine(ctx, { kind: "job", id: jobId }, f);

export async function removeLine(ctx: Ctx, lineId: string) {
  return withTx(ctx, async (c) => {
    const l = await c.query("SELECT * FROM job_line WHERE id = $1 FOR UPDATE", [lineId]);
    if (!l.rowCount) throw notFound("Line");
    const line = l.rows[0];
    const o = await lockOwner(c, ctx, line.job_card_id ? { kind: "job", id: line.job_card_id } : { kind: "enquiry", id: line.enquiry_id });
    if (D(line.issued_qty).gt(0)) throw invalid("Parts were issued on this line. Return them to the store first.");
    if (line.approval_status === "approved") throw invalid("The customer approved this line. Create a revised quotation instead.");
    await c.query("UPDATE job_line SET removed = true, version = version + 1 WHERE id = $1", [lineId]);
    await releaseCommitment(c, lineId);
    await audit(c, ctx, "job_line", lineId, "remove", { ref: o.ref }, o.branchId);
  });
}
export const removeJobLine = removeLine;

/** Manual status change, limited to the allowed next steps (JC-06), with the late-job rule (DL-02). */
export async function changeStatus(ctx: Ctx, jobId: string, to: string, f: { reason?: string; delay_reason?: string; delay_note?: string; version?: string } = {}) {
  return withTx(ctx, async (c) => {
    const job = await lockJob(c, ctx, jobId, to === "cancelled" ? "cancel" : "edit");
    if (f.version && Number(f.version) !== job.version) throw conflict();
    if (!nextStatuses(job.status).includes(to)) throw invalid(`A job cannot move from ${STATUS_LABEL[job.status]} to ${STATUS_LABEL[to] ?? to}.`);
    if (["approved", "invoiced"].includes(to)) throw invalid("This status is set automatically.");
    if (to === "ready") throw invalid("A job becomes Ready when it passes the quality check.");
    if (to === "delivered") throw invalid("Use the delivery form to hand the car over.");
    if (to === "closed" && !str(f.reason)) throw invalid("Give a reason for closing.");
    if (f.delay_reason) {
      await c.query("UPDATE job_card SET delay_reason = $2, delay_note = $3 WHERE id = $1", [jobId, f.delay_reason, optStr(f.delay_note)]);
      job.delay_reason = f.delay_reason;
    }
    const late = job.promised_at && new Date(job.promised_at) < new Date() && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
    if (late && !job.delay_reason && to !== "cancelled") throw invalid("This job is late. Enter a delay reason before moving it on.");
    if (to === "cancelled") {
      // JC rule 7: only with no clocked time, no issued parts and no posted invoice.
      const issued = await c.query("SELECT 1 FROM job_line WHERE job_card_id = $1 AND (issued_qty > 0 OR direct_cost > 0)", [jobId]);
      const inv = await c.query("SELECT 1 FROM sales_invoice WHERE job_card_id = $1 UNION ALL SELECT 1 FROM sales_invoice_job WHERE job_card_id = $1", [jobId]);
      if (issued.rowCount || inv.rowCount) throw invalid("A job with issued parts or an invoice cannot be cancelled.");
      if (!str(f.reason)) throw invalid("Give a reason for cancelling.");
      for (const l of (await c.query("SELECT id FROM job_line WHERE job_card_id = $1", [jobId])).rows) await releaseCommitment(c, l.id);
      await c.query("UPDATE quotation SET status = 'superseded' WHERE job_card_id = $1 AND status NOT IN ('superseded','declined','expired')", [jobId]);
      await c.query("UPDATE job_card SET cancel_reason = $2 WHERE id = $1", [jobId, f.reason]);
    }
    if (to === "quality_check") {
      const open = await c.query("SELECT 1 FROM job_line WHERE job_card_id = $1 AND NOT removed AND approval_status = 'approved' AND line_type IN ('part','consumable') AND issued_qty < qty", [jobId]);
      if (open.rowCount) throw invalid("Some approved parts have not been issued from the store yet.");
    }
    await setStatus(c, ctx, job, to, optStr(f.reason));
    await audit(c, ctx, "job_card", jobId, "status", { status: { old: job.status, new: to }, reason: f.reason ?? null, delay_reason: f.delay_reason ?? null }, job.branch_id);
  });
}

export async function assignTechnician(ctx: Ctx, lineId: string, techId: string | null) {
  return withTx(ctx, async (c) => {
    const l = await c.query("SELECT * FROM job_line WHERE id = $1 FOR UPDATE", [lineId]);
    if (!l.rowCount) throw notFound("Job line");
    const job = await lockJob(c, ctx, l.rows[0].job_card_id);
    if (techId) {
      const t = await c.query("SELECT 1 FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = $1 AND ubr.branch_id = $2 AND r.code = 'technician'", [techId, job.branch_id]);
      if (!t.rowCount) throw invalid("That person is not a technician at this branch.");
    }
    await c.query("UPDATE job_line SET technician_id = $2, version = version + 1 WHERE id = $1", [lineId, techId]);
    await audit(c, ctx, "job_line", lineId, "assign", { technician_id: { old: l.rows[0].technician_id, new: techId } }, job.branch_id);
  });
}

export function roleCodeAt(ctx: Ctx, branchId?: string | null) {
  return roleAt(ctx, branchId)?.roleCode ?? "";
}

/** Job count per status for the filter chips (same scope as listJobs). */
export async function jobCounts(ctx: Ctx): Promise<Record<string, number>> {
  if (!can(ctx, "jobs", "view") && !can(ctx, "workshop", "view")) return {};
  const ownOnly = !can(ctx, "jobs", "view");
  const rows = await withTx(ctx, async (c) => (await c.query(
    `SELECT j.status, count(*)::int n, count(*) FILTER (WHERE j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled'))::int late FROM job_card j
      WHERE (NOT $1 OR EXISTS (SELECT 1 FROM job_line l WHERE l.job_card_id = j.id AND (l.technician_id = $2 OR EXISTS (SELECT 1 FROM job_assignment a WHERE a.job_line_id = l.id AND a.technician_id = $2))))
      GROUP BY j.status`, [ownOnly, ctx.userId])).rows);
  const out: Record<string, number> = { "": 0, late: 0 };
  for (const r of rows) { out[r.status] = r.n; out[""] += r.n; out.late += r.late; }
  return out;
}

/**
 * "Send new time": a late (or soon late) job gets a new promised time and a delay reason. The customer
 * message is prepared afterwards from the "new_time" template. Returns the new time as the customer reads it.
 */
export async function setNewTime(ctx: Ctx, jobId: string, f: { promised_at?: string; delay_reason?: string; delay_note?: string }) {
  return withTx(ctx, async (c) => {
    const job = await lockJob(c, ctx, jobId, "edit");
    if (["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status)) throw invalid("This job is already finished.");
    const at = required(f.promised_at, "New promised time");
    const reason = required(f.delay_reason, "Delay reason");
    const r = await c.query(
      `UPDATE job_card SET promised_at = $2::timestamptz, delay_reason = $3, delay_note = $4, updated_at = now(), updated_by = $5, version = version + 1
        WHERE id = $1 AND $2::timestamptz > now()
        RETURNING to_char(promised_at AT TIME ZONE 'Asia/Dubai', 'Dy DD Mon, HH24:MI') label`,
      [jobId, at, reason, optStr(f.delay_note), ctx.userId]);
    if (!r.rowCount) throw invalid("The new promised time must be later than now.", { field: "promised_at" });
    await audit(c, ctx, "job_card", jobId, "new_time", { promised_at: { old: job.promised_at, new: at }, delay_reason: reason }, job.branch_id);
    return { label: String(r.rows[0].label), reason };
  });
}

// ---------- check-in record: damage diagram, photos, customer's signature ----------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Saves the damage marks and, when given, the customer's signature. A signature, once taken, is not replaced. */
export async function saveCheckin(ctx: Ctx, jobId: string, f: { damage?: string; signature?: string; signed_name?: string }) {
  const { ZONES, KINDS } = await import("../checkin");
  let marks: { z: string; k: string }[] = [];
  try { marks = JSON.parse(f.damage || "[]"); } catch { throw invalid("The damage marks could not be read. Mark them again."); }
  if (!Array.isArray(marks) || marks.length > ZONES.length) throw invalid("The damage marks could not be read. Mark them again.");
  marks = marks.map((m) => {
    if (!ZONES.some(([z]) => z === m?.z) || !KINDS.some(([k]) => k === m?.k)) throw invalid("Unknown part of the car or kind of damage.");
    return { z: m.z, k: m.k };
  });
  const sig = str(f.signature);
  if (sig) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sig);
    if (!m || sig.length > 400000 || !Buffer.from(m[1].slice(0, 16), "base64").subarray(0, 8).equals(PNG_SIG)) throw invalid("The signature could not be read. Ask the customer to sign again.");
  }
  return withTx(ctx, async (c) => {
    const job = await lockJob(c, ctx, jobId, "edit");
    if (["closed", "cancelled"].includes(job.status)) throw invalid("This job is closed.");
    if (sig && job.checkin_signature) throw invalid("The customer has signed the check-in already.");
    await c.query(
      `UPDATE job_card SET damage_marks = $2::jsonb,
              checkin_signature = coalesce(checkin_signature, $3), checkin_signed_name = CASE WHEN checkin_signature IS NULL AND $3::text IS NOT NULL THEN $4 ELSE checkin_signed_name END,
              checkin_signed_at = CASE WHEN checkin_signature IS NULL AND $3::text IS NOT NULL THEN now() ELSE checkin_signed_at END,
              updated_at = now(), updated_by = $5, version = version + 1 WHERE id = $1`,
      [jobId, JSON.stringify(marks), sig || null, optStr(f.signed_name), ctx.userId]);
    await audit(c, ctx, "job_card", jobId, "checkin", { damage: marks, signed: !!sig }, job.branch_id);
  });
}

/** Adds one labelled check-in photo to the job card. */
export async function addCheckinPhoto(ctx: Ctx, jobId: string, label: string, file: { name: string; type: string; bytes: Buffer } | undefined) {
  const { PHOTO_LABELS } = await import("../checkin");
  if (!file) throw invalid("Take or choose the photo.");
  const l = PHOTO_LABELS.includes(label) ? label : "Other";
  const { saveAttachment } = await import("./purchasing");
  return withTx(ctx, async (c) => {
    const job = await lockJob(c, ctx, jobId, "edit");
    if (["closed", "cancelled"].includes(job.status)) throw invalid("This job is closed.");
    const n = (await c.query("SELECT count(*)::int n FROM attachment WHERE entity = 'job_checkin' AND entity_id = $1", [jobId])).rows[0].n;
    if (n >= 12) throw invalid("A job card keeps at most 12 check-in photos.");
    const ext = (file.name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "").toLowerCase();
    const id = await saveAttachment(c, ctx, job.branch_id, "job_checkin", jobId, { ...file, name: `${l}${ext}` });
    await audit(c, ctx, "job_card", jobId, "checkin_photo", { label: l }, job.branch_id);
    return id;
  });
}

export async function checkinPhotos(ctx: Ctx, jobId: string) {
  return withTx(ctx, async (c) => (await c.query(
    "SELECT a.id, a.file_name, a.mime, a.uploaded_at, u.full_name FROM attachment a LEFT JOIN app_user u ON u.id = a.uploaded_by WHERE a.entity = 'job_checkin' AND a.entity_id = $1 ORDER BY a.uploaded_at", [jobId])).rows);
}
