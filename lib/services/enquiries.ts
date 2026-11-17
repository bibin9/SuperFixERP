import { Ctx, assertCan, can, canSee, redact } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { optStr, required, optInt, str } from "../validate";
import { commitForLine } from "./stock";
import { history as approvalHistory } from "./workflow";
import { ENQUIRY_QUOTABLE, LINE_FIELDS, QLINE_FIELDS, Q_FIELDS, setStatus } from "./jobs";
import { expireQuotations } from "./quotations";

/**
 * M02/M03 enquiries (CV-10). FSD v0.10 flow: enquiry, then quotation, then customer approval, then
 * the job card. The enquiry holds the customer, the vehicle, the check-in details, the work lines
 * and the quotation revisions until the job card is created from the approved quotation.
 */

function currentBranch(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}

async function checkVehicle(c: import("pg").PoolClient, customerId: string | null, vehicleId: string | null) {
  if (customerId && !(await c.query("SELECT 1 FROM customer WHERE id = $1 AND active", [customerId])).rowCount) throw invalid("Customer not found.");
  if (vehicleId) {
    const v = await c.query("SELECT 1 FROM vehicle WHERE id = $1 AND active", [vehicleId]);
    if (!v.rowCount) throw invalid("Vehicle not found.");
    if (customerId && !(await c.query("SELECT 1 FROM vehicle_customer WHERE vehicle_id = $1 AND customer_id = $2", [vehicleId, customerId])).rowCount)
      throw invalid("That vehicle is not linked to this customer.");
  }
}

export async function createEnquiry(ctx: Ctx, f: Record<string, unknown>) {
  const branchId = currentBranch(ctx);
  assertCan(ctx, "customers", "create", branchId);
  return withTx(ctx, async (c) => {
    const customerId = optStr(f.customer_id);
    const vehicleId = optStr(f.vehicle_id);
    if (!customerId && !optStr(f.contact_mobile)) throw invalid("Pick a customer or enter a contact mobile.");
    await checkVehicle(c, customerId, vehicleId);
    const source = required(f.source, "Source");
    if (!(await c.query("SELECT 1 FROM lookup_value WHERE list = 'enquiry_source' AND code = $1 AND active", [source])).rowCount) throw invalid("Unknown enquiry source.");
    const docNo = await nextDocNo(c, branchId, "enquiry");
    const r = await c.query(
      `INSERT INTO enquiry (branch_id, doc_no, customer_id, vehicle_id, contact_name, contact_mobile, service_asked, source, assigned_to, follow_up_at, notes,
                            odometer_in, fuel_level, complaints, valuables, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING id`,
      [branchId, docNo, customerId, vehicleId, optStr(f.contact_name), optStr(f.contact_mobile), required(f.service_asked, "Service asked about"),
        source, optStr(f.assigned_to) ?? ctx.userId, optStr(f.follow_up_at), optStr(f.notes),
        optInt(f.odometer_in, "Odometer", 0, 5_000_000), optInt(f.fuel_level, "Fuel level", 0, 8), optStr(f.complaints), optStr(f.valuables), ctx.userId],
    );
    await audit(c, ctx, "enquiry", r.rows[0].id, "create", { doc_no: docNo }, branchId);
    return { id: r.rows[0].id as string, docNo };
  });
}

/** Customer, vehicle and check-in details. Customer and vehicle are fixed once work lines exist. */
export async function updateEnquiry(ctx: Ctx, id: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [id]);
    if (!e.rowCount) throw notFound("Enquiry");
    const enq = e.rows[0];
    assertCan(ctx, "customers", "edit", enq.branch_id);
    if (!ENQUIRY_QUOTABLE.includes(enq.status)) throw invalid("This enquiry can no longer be changed.");
    const customerId = "customer_id" in f ? optStr(f.customer_id) : enq.customer_id;
    const vehicleId = "vehicle_id" in f ? optStr(f.vehicle_id) : enq.vehicle_id;
    if (customerId !== enq.customer_id || vehicleId !== enq.vehicle_id) {
      const hasLines = await c.query("SELECT 1 FROM job_line WHERE enquiry_id = $1 AND NOT removed", [id]);
      if (hasLines.rowCount) throw invalid("Work is already priced for this customer and vehicle. Start a new enquiry instead.");
    }
    await checkVehicle(c, customerId, vehicleId);
    const odo = "odometer_in" in f ? optInt(f.odometer_in, "Odometer", 0, 5_000_000) : enq.odometer_in;
    const next = {
      customer_id: customerId, vehicle_id: vehicleId, odometer_in: odo,
      fuel_level: "fuel_level" in f ? optInt(f.fuel_level, "Fuel level", 0, 8) : enq.fuel_level,
      complaints: "complaints" in f ? optStr(f.complaints) : enq.complaints,
      valuables: "valuables" in f ? optStr(f.valuables) : enq.valuables,
      follow_up_at: "follow_up_at" in f ? optStr(f.follow_up_at) : enq.follow_up_at,
      notes: "notes" in f ? optStr(f.notes) : enq.notes,
    };
    await c.query(
      `UPDATE enquiry SET customer_id = $2, vehicle_id = $3, odometer_in = $4, fuel_level = $5, complaints = $6, valuables = $7, follow_up_at = $8, notes = $9,
              updated_at = now(), updated_by = $10, version = version + 1 WHERE id = $1`,
      [id, next.customer_id, next.vehicle_id, next.odometer_in, next.fuel_level, next.complaints, next.valuables, next.follow_up_at, next.notes, ctx.userId]);
    await audit(c, ctx, "enquiry", id, "update", next, enq.branch_id);
  });
}

export async function listEnquiries(ctx: Ctx, status = "") {
  if (!can(ctx, "customers", "view")) throw forbidden();
  return withTx(ctx, async (c) => { await expireQuotations(c); return (await c.query(
    `SELECT e.*, b.code branch_code, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, u.full_name assigned_name,
            v.registered_in, v.plate_code, v.plate_number, v.make, v.model, j.doc_no job_no,
            (e.follow_up_at < now() AND e.status IN ('open','booked','quoted')) overdue
       FROM enquiry e JOIN branch b ON b.id = e.branch_id LEFT JOIN customer c ON c.id = e.customer_id LEFT JOIN app_user u ON u.id = e.assigned_to
       LEFT JOIN vehicle v ON v.id = e.vehicle_id LEFT JOIN job_card j ON j.id = e.converted_job_id
      WHERE ($1 = '' OR e.status = $1) AND e.doc_no NOT LIKE 'LEGACY-%' ORDER BY e.created_at DESC LIMIT 200`, [status],
  )).rows; });
}

export async function markEnquiryLost(ctx: Ctx, id: string, reason: string) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [id]);
    if (!e.rowCount) throw notFound("Enquiry");
    assertCan(ctx, "customers", "edit", e.rows[0].branch_id);
    if (!ENQUIRY_QUOTABLE.includes(e.rows[0].status)) throw invalid("Only an open enquiry can be marked lost.");
    await c.query("UPDATE enquiry SET status = 'lost', lost_reason = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1", [id, required(reason, "Lost reason"), ctx.userId]);
    await c.query("UPDATE quotation SET status = 'superseded', updated_at = now(), version = version + 1 WHERE enquiry_id = $1 AND status IN ('draft','pending_internal_approval','ready_to_send','sent')", [id]);
    await audit(c, ctx, "enquiry", id, "lost", { reason }, e.rows[0].branch_id);
  });
}

/** Enquiry with its lines and quotations. Prices are removed per field permissions, as on the job card. */
export async function getEnquiry(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const e = await c.query(
      `SELECT e.*, b.code branch_code, b.name_en branch_name, v.make, v.model, v.model_year, v.registered_in, v.plate_code, v.plate_number, v.vin, v.odometer last_odometer,
              c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, c.whatsapp, u.full_name assigned_name, j.doc_no job_no,
              bb.code booking_bay_code, bt.full_name booking_technician_name, to_char(e.booked_for, 'YYYY-MM-DD"T"HH24:MI') booked_for_local
         FROM enquiry e JOIN branch b ON b.id = e.branch_id LEFT JOIN vehicle v ON v.id = e.vehicle_id LEFT JOIN customer c ON c.id = e.customer_id
         LEFT JOIN app_user u ON u.id = e.assigned_to LEFT JOIN job_card j ON j.id = e.converted_job_id
         LEFT JOIN bay bb ON bb.id = e.booking_bay_id LEFT JOIN app_user bt ON bt.id = e.booking_technician_id WHERE e.id = $1`, [id]);
    if (!e.rowCount) throw notFound("Enquiry");
    const enq = e.rows[0];
    if (!can(ctx, "customers", "view", enq.branch_id)) throw forbidden();
    const lines = (await c.query(
      `SELECT l.*, sb.avg_cost, i.part_no, sb.on_hand - sb.committed - sb.reserved free_here
         FROM job_line l LEFT JOIN stock_balance sb ON sb.item_id = l.item_id AND sb.branch_id = l.branch_id LEFT JOIN item i ON i.id = l.item_id
        WHERE l.enquiry_id = $1 AND NOT l.removed ORDER BY l.line_no`, [id])).rows;
    await expireQuotations(c, id);
    const quotations = (await c.query("SELECT * FROM quotation WHERE enquiry_id = $1 ORDER BY revision DESC", [id])).rows;
    const latest = quotations[0];
    const qlines = latest ? (await c.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [latest.id])).rows : [];
    const approvals = latest ? await approvalHistory(c, "discount", latest.id) : [];
    const vehicles = enq.customer_id ? (await c.query(
      "SELECT v.id, v.registered_in, v.plate_code, v.plate_number, v.make, v.model FROM vehicle_customer vc JOIN vehicle v ON v.id = vc.vehicle_id WHERE vc.customer_id = $1 AND v.active ORDER BY v.make", [enq.customer_id])).rows : [];
    const b = enq.branch_id;
    return {
      enquiry: enq, vehicles,
      lines: redact(ctx, lines, LINE_FIELDS, () => b),
      quotations: redact(ctx, quotations, Q_FIELDS, () => b),
      quotationLines: redact(ctx, qlines, QLINE_FIELDS, () => b),
      approvals,
      canSeePrices: canSee(ctx, "selling_price", b),
    };
  });
}

/**
 * Creates the job card from the customer-approved quotation (FSD v0.10). Only approved lines are
 * work; declined lines stay as deferred work. Parts for approved lines are committed now, first
 * come first served, and any shortage is back-ordered (PC-01, PC-03). The database refuses a job
 * card without an approved quotation of the same enquiry.
 */
export async function createJobCard(ctx: Ctx, enquiryId: string, f: Record<string, unknown> = {}) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [enquiryId]);
    if (!e.rowCount) throw notFound("Enquiry");
    const enq = e.rows[0];
    assertCan(ctx, "jobs", "create", enq.branch_id);
    if (enq.status === "converted") throw invalid("A job card already exists for this enquiry.");
    if (enq.status !== "approved") throw invalid("The customer has not approved a quotation for this enquiry yet.");
    const q = (await c.query("SELECT * FROM quotation WHERE enquiry_id = $1 ORDER BY revision DESC LIMIT 1 FOR UPDATE", [enquiryId])).rows[0];
    if (!q || !["approved", "partly_approved"].includes(q.status)) throw invalid("The latest quotation is not approved. Wait for the customer's answer first.");

    const jobType = str(f.job_type) || "service";
    if (!["service", "repair", "warranty_comeback", "internal", "recovery"].includes(jobType)) throw invalid("Unknown job type.");
    let originalJob: string | null = null;
    if (jobType === "warranty_comeback") {
      // JC-08: must link to the original job, which may be at any branch.
      const no = required(f.original_job_no, "Original job number");
      const o = await c.query("SELECT job_id FROM vehicle_history($1) WHERE doc_no = $2", [enq.vehicle_id, no.toUpperCase()]);
      if (!o.rowCount) throw invalid("Original job not found for this vehicle.");
      originalJob = o.rows[0].job_id;
    }
    const odo = "odometer_in" in f && str(f.odometer_in) ? optInt(f.odometer_in, "Odometer", 0, 5_000_000) : enq.odometer_in;
    if (odo === null || odo === undefined) throw invalid("Enter the odometer reading before creating the job card.");
    const v = (await c.query("SELECT odometer FROM vehicle WHERE id = $1", [enq.vehicle_id])).rows[0];
    if (v?.odometer && odo < v.odometer) throw invalid(`Odometer is lower than the last recorded reading (${v.odometer} km).`);
    if (enq.odometer_in !== null && enq.odometer_in !== undefined && odo < enq.odometer_in) throw invalid(`Odometer is lower than the reading taken at check-in (${enq.odometer_in} km).`);

    const docNo = await nextDocNo(c, enq.branch_id, "job_card");
    const r = await c.query(
      `INSERT INTO job_card (branch_id, doc_no, job_type, customer_id, vehicle_id, enquiry_id, source_quotation_id, original_job_id, odometer_in, fuel_level,
                             complaints, valuables, advisor_id, promised_at, lpo_no, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',$16,$16) RETURNING *`,
      [enq.branch_id, docNo, jobType, enq.customer_id, enq.vehicle_id, enquiryId, q.id, originalJob, odo, enq.fuel_level, enq.complaints, enq.valuables,
        enq.assigned_to ?? ctx.userId, optStr(f.promised_at), optStr(f.lpo_no), ctx.userId]);
    const job = r.rows[0];
    await c.query("INSERT INTO job_status_history (job_card_id, branch_id, from_status, to_status, reason, user_id) VALUES ($1,$2,NULL,'approved',$3,$4)",
      [job.id, job.branch_id, `Created from approved quotation ${q.doc_no}`, ctx.userId]);
    await c.query("UPDATE job_line SET job_card_id = $2, version = version + 1 WHERE enquiry_id = $1 AND NOT removed", [enquiryId, job.id]);
    await c.query("UPDATE quotation SET job_card_id = $2 WHERE enquiry_id = $1", [enquiryId, job.id]);
    await c.query("UPDATE deferred_work SET job_card_id = $2 WHERE enquiry_id = $1", [enquiryId, job.id]);
    await c.query("UPDATE vehicle SET odometer = $2 WHERE id = $1", [enq.vehicle_id, odo]);
    await c.query(`UPDATE enquiry SET status = 'converted', converted_job_id = $2, odometer_in = $3, updated_at = now(), updated_by = $4, version = version + 1,
                          booking_status = CASE WHEN booking_status = 'booked' THEN 'checked_in' ELSE booking_status END WHERE id = $1`,
      [enquiryId, job.id, odo, ctx.userId]);
    // The booked bay becomes the job's bay, so the workshop board and the calendar agree.
    if (enq.booking_status === "booked" && enq.booking_bay_id) await c.query("UPDATE job_card SET bay_id = $2 WHERE id = $1 AND bay_id IS NULL", [job.id, enq.booking_bay_id]);

    let backOrdered = false;
    const approved = (await c.query("SELECT * FROM job_line WHERE job_card_id = $1 AND approval_status = 'approved' AND NOT removed ORDER BY line_no", [job.id])).rows;
    for (const l of approved) {
      const sc = await commitForLine(c, l);
      if (sc && Number(sc.back_ordered) > 0) backOrdered = true;
    }
    if (backOrdered) await setStatus(c, ctx, job, "awaiting_parts", "Approved part is back-ordered");
    await audit(c, ctx, "job_card", job.id, "create", { doc_no: docNo, enquiry: enq.doc_no, quotation: q.doc_no, approved_total: q.approved_total }, enq.branch_id);
    return { id: job.id as string, docNo: docNo as string, backOrdered };
  });
}
