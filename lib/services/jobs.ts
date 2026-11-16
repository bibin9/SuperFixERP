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

// ---------- enquiries (CV-10) ----------

export async function createEnquiry(ctx: Ctx, f: Record<string, unknown>) {
  const branchId = currentBranch(ctx);
  assertCan(ctx, "customers", "create", branchId);
  return withTx(ctx, async (c) => {
    const docNo = await nextDocNo(c, branchId, "enquiry");
    const customerId = optStr(f.customer_id);
    if (!customerId && !optStr(f.contact_mobile)) throw invalid("Pick a customer or enter a contact mobile.");
    const r = await c.query(
      `INSERT INTO enquiry (branch_id, doc_no, customer_id, vehicle_id, contact_name, contact_mobile, service_asked, source, assigned_to, follow_up_at, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
      [branchId, docNo, customerId, optStr(f.vehicle_id), optStr(f.contact_name), optStr(f.contact_mobile), required(f.service_asked, "Service asked about"),
        required(f.source, "Source"), optStr(f.assigned_to) ?? ctx.userId, optStr(f.follow_up_at), optStr(f.notes), ctx.userId],
    );
    await audit(c, ctx, "enquiry", r.rows[0].id, "create", { doc_no: docNo }, branchId);
    return { id: r.rows[0].id, docNo };
  });
}

export async function listEnquiries(ctx: Ctx, status = "") {
  return withTx(ctx, async (c) => (await c.query(
    `SELECT e.*, b.code branch_code, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, u.full_name assigned_name,
            (e.follow_up_at < now() AND e.status = 'open') overdue
       FROM enquiry e JOIN branch b ON b.id = e.branch_id LEFT JOIN customer c ON c.id = e.customer_id LEFT JOIN app_user u ON u.id = e.assigned_to
      WHERE ($1 = '' OR e.status = $1) ORDER BY e.created_at DESC LIMIT 200`, [status],
  )).rows);
}

export async function markEnquiryLost(ctx: Ctx, id: string, reason: string) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [id]);
    if (!e.rowCount) throw notFound("Enquiry");
    assertCan(ctx, "customers", "edit", e.rows[0].branch_id);
    if (!["open", "quoted", "booked"].includes(e.rows[0].status)) throw invalid("Only an open enquiry can be marked lost.");
    await c.query("UPDATE enquiry SET status = 'lost', lost_reason = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1", [id, required(reason, "Lost reason"), ctx.userId]);
    await audit(c, ctx, "enquiry", id, "lost", { reason }, e.rows[0].branch_id);
  });
}

// ---------- job cards ----------

const TRANSITIONS: Record<string, string[]> = {
  booked: ["checked_in", "cancelled"],
  checked_in: ["inspection", "awaiting_approval", "cancelled"],
  inspection: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["approved", "closed", "cancelled"],
  approved: ["in_progress", "awaiting_parts", "cancelled"],
  awaiting_parts: ["in_progress", "cancelled"],
  in_progress: ["quality_check"],
  quality_check: ["ready", "in_progress"],
  ready: ["delivered"],
  delivered: ["invoiced"],
  invoiced: ["closed"],
  closed: [],
  cancelled: [],
};
export const STATUS_LABEL: Record<string, string> = {
  booked: "Booked", checked_in: "Checked in", inspection: "Inspection", awaiting_approval: "Awaiting approval", approved: "Approved",
  awaiting_parts: "Awaiting parts", in_progress: "In progress", quality_check: "Quality check", ready: "Ready", delivered: "Delivered",
  invoiced: "Invoiced", closed: "Closed", cancelled: "Cancelled",
};
export const nextStatuses = (s: string) => TRANSITIONS[s] ?? [];
const EDITABLE = ["checked_in", "inspection", "awaiting_approval", "approved", "awaiting_parts", "in_progress", "quality_check"];

export async function setStatus(c: PoolClient, ctx: Ctx | null, job: { id: string; branch_id: string; status: string }, to: string, reason?: string | null) {
  await c.query("UPDATE job_card SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1", [job.id, to]);
  await c.query("INSERT INTO job_status_history (job_card_id, branch_id, from_status, to_status, reason, user_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [job.id, job.branch_id, job.status, to, reason ?? null, ctx?.userId ?? null]);
}

export async function createJobCard(ctx: Ctx, f: Record<string, unknown>) {
  const branchId = currentBranch(ctx);
  assertCan(ctx, "jobs", "create", branchId);
  return withTx(ctx, async (c) => {
    const customerId = required(f.customer_id, "Customer");
    const vehicleId = required(f.vehicle_id, "Vehicle");
    const v = await c.query("SELECT * FROM vehicle WHERE id = $1 AND active", [vehicleId]);
    if (!v.rowCount) throw invalid("Vehicle not found.");
    if (!(await c.query("SELECT 1 FROM customer WHERE id = $1 AND active", [customerId])).rowCount) throw invalid("Customer not found.");
    const jobType = str(f.job_type) || "service";
    let originalJob: string | null = null;
    if (jobType === "warranty_comeback") {
      // JC-08: must link to the original job, which may be at any branch.
      const no = required(f.original_job_no, "Original job number");
      const o = await c.query("SELECT job_id FROM vehicle_history($1) WHERE doc_no = $2", [vehicleId, no.toUpperCase()]);
      if (!o.rowCount) throw invalid("Original job not found for this vehicle.");
      originalJob = o.rows[0].job_id;
    }
    const enquiryId = optStr(f.enquiry_id);
    const docNo = await nextDocNo(c, branchId, "job_card");
    const odo = optInt(f.odometer_in, "Odometer", 0, 5_000_000);
    if (odo !== null && v.rows[0].odometer && odo < v.rows[0].odometer) throw invalid(`Odometer is lower than the last recorded reading (${v.rows[0].odometer} km).`);
    const r = await c.query(
      `INSERT INTO job_card (branch_id, doc_no, job_type, customer_id, vehicle_id, enquiry_id, original_job_id, odometer_in, fuel_level, complaints, valuables,
                             advisor_id, promised_at, lpo_no, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'checked_in',$12,$12) RETURNING id`,
      [branchId, docNo, jobType, customerId, vehicleId, enquiryId, originalJob, odo, optInt(f.fuel_level, "Fuel level", 0, 8), optStr(f.complaints), optStr(f.valuables),
        ctx.userId, optStr(f.promised_at), optStr(f.lpo_no)],
    );
    const id = r.rows[0].id;
    await c.query("INSERT INTO job_status_history (job_card_id, branch_id, from_status, to_status, user_id) VALUES ($1,$2,NULL,'checked_in',$3)", [id, branchId, ctx.userId]);
    if (odo !== null) await c.query("UPDATE vehicle SET odometer = $2 WHERE id = $1", [vehicleId, odo]);
    if (enquiryId) {
      const e = await c.query("UPDATE enquiry SET status = 'converted', converted_job_id = $2, updated_at = now(), version = version + 1 WHERE id = $1 AND status IN ('open','quoted','booked') RETURNING id", [enquiryId, id]);
      if (!e.rowCount) throw invalid("That enquiry is not open.");
    }
    await audit(c, ctx, "job_card", id, "create", { doc_no: docNo }, branchId);
    return { id, docNo };
  });
}

export async function listJobs(ctx: Ctx, status = "") {
  if (!can(ctx, "jobs", "view") && !can(ctx, "workshop", "view")) throw forbidden();
  const ownOnly = !can(ctx, "jobs", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT j.id, j.doc_no, j.status, j.job_type, j.promised_at, j.created_at, b.code branch_code, v.make, v.model, v.registered_in, v.plate_code, v.plate_number,
            c.customer_type, c.title, c.first_name, c.last_name, c.company_name,
            (j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled')) late
       FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id
      WHERE ($1 = '' OR j.status = $1)
        AND (NOT $2 OR EXISTS (SELECT 1 FROM job_line l WHERE l.job_card_id = j.id AND l.technician_id = $3))
      ORDER BY j.created_at DESC LIMIT 200`, [status, ownOnly, ctx.userId],
  )).rows);
}

const LINE_FIELDS = { unit_price: "selling_price", discount_amount: "discount", avg_cost: "purchase_cost", margin_pct: "purchase_cost" };
const QLINE_FIELDS = { unit_price: "selling_price", gross_amount: "selling_price", line_discount: "discount", doc_discount_share: "discount", taxable_amount: "selling_price", vat_amount: "selling_price", line_total: "selling_price" };
const Q_FIELDS = { gross_amount: "selling_price", discount_total: "discount", doc_discount_amount: "discount", taxable_total: "selling_price", vat_total: "selling_price", grand_total: "selling_price", approved_total: "selling_price" };

/** Job card with lines, quotations and history. Prices and costs are removed per field permissions. */
export async function getJob(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const j = await c.query(
      `SELECT j.*, b.code branch_code, b.name_en branch_name, v.make, v.model, v.model_year, v.registered_in, v.plate_code, v.plate_number, v.vin,
              c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, c.whatsapp, c.trn, u.full_name advisor_name
         FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id
         LEFT JOIN app_user u ON u.id = j.advisor_id WHERE j.id = $1`, [id]);
    if (!j.rowCount) throw notFound("Job card");
    const job = j.rows[0];
    const ownOnly = !can(ctx, "jobs", "view", job.branch_id);
    if (ownOnly) {
      if (!can(ctx, "workshop", "view", job.branch_id)) throw forbidden();
      const mine = await c.query("SELECT 1 FROM job_line WHERE job_card_id = $1 AND technician_id = $2", [id, ctx.userId]);
      if (!mine.rowCount) throw notFound("Job card");
    }
    const lines = (await c.query(
      `SELECT l.*, sb.avg_cost, u.full_name technician_name, i.part_no,
              sc.qty committed_qty, sc.back_ordered
         FROM job_line l LEFT JOIN stock_balance sb ON sb.item_id = l.item_id AND sb.branch_id = l.branch_id
         LEFT JOIN app_user u ON u.id = l.technician_id LEFT JOIN item i ON i.id = l.item_id
         LEFT JOIN stock_commitment sc ON sc.job_line_id = l.id AND sc.status = 'active'
        WHERE l.job_card_id = $1 AND NOT l.removed ORDER BY l.line_no`, [id])).rows;
    const quotations = (await c.query("SELECT * FROM quotation WHERE job_card_id = $1 ORDER BY revision DESC", [id])).rows;
    const latest = quotations[0];
    const qlines = latest ? (await c.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [latest.id])).rows : [];
    const statusHistory = (await c.query("SELECT h.*, u.full_name FROM job_status_history h LEFT JOIN app_user u ON u.id = h.user_id WHERE job_card_id = $1 ORDER BY at", [id])).rows;
    const invoices = (await c.query("SELECT id, doc_no, doc_date, grand_total, paid_amount FROM sales_invoice WHERE job_card_id = $1", [id])).rows;
    const approvals = latest ? await approvalHistory(c, "discount", latest.id) : [];
    const b = job.branch_id;
    return {
      job,
      lines: redact(ctx, lines, LINE_FIELDS, () => b),
      quotations: redact(ctx, quotations, Q_FIELDS, () => b),
      quotationLines: redact(ctx, qlines, QLINE_FIELDS, () => b),
      statusHistory,
      invoices: canSee(ctx, "selling_price", b) ? invoices : [],
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

export async function addJobLine(ctx: Ctx, jobId: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const job = await lockJob(c, ctx, jobId);
    if (!EDITABLE.includes(job.status)) throw invalid(`Lines cannot be added while the job is ${STATUS_LABEL[job.status]}.`);
    const type = required(f.line_type, "Line type");
    let description = optStr(f.description);
    let unitPrice: string | null = null;
    let qty = str(f.qty) || "1";
    let stdHours: string | null = null;
    let serviceId: string | null = null;
    let itemId: string | null = null;
    let vatCode = "SR";
    if (type === "labour") {
      serviceId = required(f.service_id, "Service");
      const s = await c.query("SELECT * FROM service WHERE id = $1 AND active", [serviceId]);
      if (!s.rowCount) throw invalid("Service not found.");
      // WS-03: standard time copied from the master; later master changes do not change open jobs.
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
    // Advisors may change the price only with the Edit level on selling price.
    const priceLevel = fieldLevel(ctx, "selling_price", job.branch_id);
    if (str(f.unit_price)) {
      if (priceLevel !== "edit" && unitPrice !== null && D(str(f.unit_price)).cmp(unitPrice) !== 0) throw forbidden("You cannot change the selling price.");
      unitPrice = parseDec(f.unit_price, "Unit price", { min: 0, dp: 2 }).toFixed(2);
    }
    if (unitPrice === null) throw invalid("Enter the price for outside work.");
    const q = parseDec(qty, "Quantity", { min: "0.001", dp: 3 });
    if (q.lte(0)) throw invalid("Quantity must be more than zero.");
    const discount = str(f.discount_amount) ? parseDec(f.discount_amount, "Discount", { min: 0, dp: 2 }) : D(0);
    if (discount.gt(0) && fieldLevel(ctx, "discount", job.branch_id) !== "edit") throw forbidden("You cannot give a discount.");
    if (discount.gt(r2(q.mul(unitPrice)))) throw invalid("Discount cannot be more than the line amount.");
    const below = await isBelowMargin(c, job.branch_id, itemId, q.toString(), unitPrice, discount.toFixed(2));
    const extra = ["approved", "awaiting_parts", "in_progress", "quality_check"].includes(job.status);
    const no = (await c.query("SELECT coalesce(max(line_no),0)+1 n FROM job_line WHERE job_card_id = $1", [jobId])).rows[0].n;
    const r = await c.query(
      `INSERT INTO job_line (job_card_id, branch_id, line_no, line_type, service_id, item_id, description, qty, standard_hours, unit_price, discount_amount, vat_code,
                             technician_id, extra_work, below_margin, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [jobId, job.branch_id, no, type, serviceId, itemId, description, q.toFixed(3), stdHours, unitPrice, discount.toFixed(2), vatCode, optStr(f.technician_id), extra, below, ctx.userId],
    );
    await audit(c, ctx, "job_line", r.rows[0].id, "create", { job: job.doc_no, description, qty: q.toFixed(3), unit_price: unitPrice, discount: discount.toFixed(2), below_margin: below }, job.branch_id);
    return { id: r.rows[0].id, belowMargin: below };
  });
}

export async function removeJobLine(ctx: Ctx, lineId: string) {
  return withTx(ctx, async (c) => {
    const l = await c.query("SELECT * FROM job_line WHERE id = $1 FOR UPDATE", [lineId]);
    if (!l.rowCount) throw notFound("Job line");
    const job = await lockJob(c, ctx, l.rows[0].job_card_id);
    if (!EDITABLE.includes(job.status)) throw invalid("This job can no longer be changed.");
    if (D(l.rows[0].issued_qty).gt(0)) throw invalid("Parts were issued on this line. Return them to the store first.");
    if (l.rows[0].approval_status === "approved") throw invalid("The customer approved this line. Create a revised quotation instead.");
    await c.query("UPDATE job_line SET removed = true, version = version + 1 WHERE id = $1", [lineId]);
    await releaseCommitment(c, lineId);
    await audit(c, ctx, "job_line", lineId, "remove", { job: job.doc_no }, job.branch_id);
  });
}

/** Manual status change, limited to the allowed next steps (JC-06), with the late-job rule (DL-02). */
export async function changeStatus(ctx: Ctx, jobId: string, to: string, f: { reason?: string; delay_reason?: string; delay_note?: string; version?: string } = {}) {
  return withTx(ctx, async (c) => {
    const job = await lockJob(c, ctx, jobId, to === "cancelled" ? "cancel" : "edit");
    if (f.version && Number(f.version) !== job.version) throw conflict();
    if (!nextStatuses(job.status).includes(to)) throw invalid(`A job cannot move from ${STATUS_LABEL[job.status]} to ${STATUS_LABEL[to] ?? to}.`);
    if (["approved", "invoiced"].includes(to)) throw invalid("This status is set automatically.");
    if (to === "closed" && !str(f.reason)) throw invalid("Give a reason for closing.");
    if (f.delay_reason) {
      await c.query("UPDATE job_card SET delay_reason = $2, delay_note = $3 WHERE id = $1", [jobId, f.delay_reason, optStr(f.delay_note)]);
      job.delay_reason = f.delay_reason;
    }
    const late = job.promised_at && new Date(job.promised_at) < new Date() && !["ready", "delivered", "invoiced", "closed", "cancelled"].includes(job.status);
    if (late && !job.delay_reason && to !== "cancelled") throw invalid("This job is late. Enter a delay reason before moving it on.");
    if (to === "cancelled") {
      // JC rule 7: only with no clocked time, no issued parts and no posted invoice.
      const issued = await c.query("SELECT 1 FROM job_line WHERE job_card_id = $1 AND issued_qty > 0", [jobId]);
      const inv = await c.query("SELECT 1 FROM sales_invoice WHERE job_card_id = $1", [jobId]);
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
