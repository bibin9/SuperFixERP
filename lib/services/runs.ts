import type { PoolClient } from "pg";
import { Ctx, can } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { addEnquiryLine, addJobLine } from "./jobs";
import { optStr, str, required } from "../validate";
import { parseDec } from "../money";

/**
 * Vehicle runs (FSD 4.3 recovery rule, extended at Superfix's request on 17 Nov 2026): recovery and
 * towing of a broken-down car, and pickup and drop-off of a customer's car. Each run records the driver
 * (a staff member, or the name of an outside driver), where from and where to, when, and its status, so
 * a driver's runs can be listed. A charge can go on the enquiry's quotation, or on the job card as extra
 * work, through the normal work lines (the customer approves it like any other work).
 */

export const RUN_TYPES: [string, string][] = [["pickup", "Pickup"], ["drop_off", "Drop-off"], ["recovery", "Recovery"], ["towing", "Towing"]];
const TYPE_LABEL = Object.fromEntries(RUN_TYPES);
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const mayView = (ctx: Ctx, b?: string | null) => can(ctx, "jobs", "view", b) || can(ctx, "customers", "view", b) || can(ctx, "workshop", "view", b);
const mayEdit = (ctx: Ctx, b: string) => can(ctx, "jobs", "edit", b) || can(ctx, "customers", "edit", b);

async function branchUsers(c: PoolClient, branchId: string) {
  return (await c.query(
    `SELECT DISTINCT u.id, u.full_name FROM user_branch_role ubr JOIN app_user u ON u.id = ubr.user_id
      WHERE (ubr.branch_id = $1 OR ubr.branch_id IS NULL) AND u.status = 'active' ORDER BY u.full_name`, [branchId])).rows as { id: string; full_name: string }[];
}

export async function runOptions(ctx: Ctx, branchId: string) {
  return withTx(ctx, async (c) => ({ drivers: await branchUsers(c, branchId), types: RUN_TYPES }));
}

export async function addRun(ctx: Ctx, f: Record<string, unknown>) {
  const r = await withTx(ctx, async (c) => {
    const enquiryId = optStr(f.enquiry_id);
    const jobId = optStr(f.job_card_id);
    let branchId = ctx.currentBranchId;
    let vehicleId: string | null = null;
    let quotable: "enquiry" | "job" | null = null;
    let ref = "";
    if (jobId) {
      const j = (await c.query("SELECT id, branch_id, vehicle_id, doc_no, status FROM job_card WHERE id = $1", [jobId])).rows[0];
      if (!j) throw notFound("Job card");
      branchId = j.branch_id; vehicleId = j.vehicle_id; ref = j.doc_no;
      if (["approved", "awaiting_parts", "in_progress", "quality_check"].includes(j.status)) quotable = "job";
    } else if (enquiryId) {
      const e = (await c.query("SELECT id, branch_id, vehicle_id, doc_no, status, customer_id FROM enquiry WHERE id = $1", [enquiryId])).rows[0];
      if (!e) throw notFound("Enquiry");
      branchId = e.branch_id; vehicleId = e.vehicle_id; ref = e.doc_no;
      if (["open", "booked", "quoted", "approved"].includes(e.status) && e.customer_id && e.vehicle_id) quotable = "enquiry";
    }
    if (!branchId) throw invalid("Choose a branch first.");
    if (!mayEdit(ctx, branchId)) throw forbidden();
    const type = str(f.run_type);
    if (!TYPE_LABEL[type]) throw invalid("Run type: pick pickup, drop-off, recovery or towing.", { field: "run_type" });
    const driverId = optStr(f.driver_user_id);
    const driverName = optStr(f.driver_name);
    if (!driverId && !driverName) throw invalid("Driver: pick a staff driver or type the outside driver's name.", { field: "driver_user_id" });
    if (driverId && !(await branchUsers(c, branchId)).some((u) => u.id === driverId)) throw invalid("Driver: pick someone who works at this branch.", { field: "driver_user_id" });
    let from: string, to: string;
    try { from = required(f.from_location, "From"); } catch { throw invalid("From is required: where the car is collected.", { field: "from_location" }); }
    try { to = required(f.to_location, "To"); } catch { throw invalid("To is required: where the car is taken.", { field: "to_location" }); }
    const when = str(f.scheduled_at);
    if (!LOCAL.test(when)) throw invalid("When: pick the day and time of the run.", { field: "scheduled_at" });
    let charge: string | null = null;
    if (str(f.charge)) {
      try { charge = parseDec(f.charge, "Charge", { min: 0, dp: 2 }).toFixed(2); } catch { throw invalid("Charge must be an amount in AED, for example 150.", { field: "charge" }); }
    }
    const docNo = await nextDocNo(c, branchId, "vehicle_run");
    const ins = await c.query(
      `INSERT INTO vehicle_run (branch_id, doc_no, run_type, enquiry_id, job_card_id, vehicle_id, driver_user_id, driver_name, recovery_vehicle,
                                from_location, to_location, scheduled_at, charge, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamp AT TIME ZONE 'Asia/Dubai',$13,$14,$15,$15) RETURNING id`,
      [branchId, docNo, type, jobId ? null : enquiryId, jobId, vehicleId, driverId, driverId ? null : driverName, optStr(f.recovery_vehicle), from, to, when, charge, optStr(f.notes), ctx.userId]);
    await audit(c, ctx, "vehicle_run", ins.rows[0].id, "create", { doc_no: docNo, run_type: type, ref, from, to, scheduled_at: when, driver: driverId ?? driverName, charge }, branchId);
    return { id: ins.rows[0].id as string, docNo, quotable, enquiryId, jobId, type, charge, from, to };
  });
  // The charge goes through the normal work lines, so the customer approves it with the rest of the work.
  if (r.charge && Number(r.charge) > 0 && str(f.add_charge) && r.quotable) {
    const line = { line_type: "outside", description: `${TYPE_LABEL[r.type]} ${r.from} to ${r.to} (${r.docNo})`, qty: "1", unit_price: r.charge };
    if (r.quotable === "job") await addJobLine(ctx, r.jobId!, line);
    else await addEnquiryLine(ctx, r.enquiryId!, line);
    return { ...r, chargeAdded: true };
  }
  return { ...r, chargeAdded: false };
}

/** Driver left, run completed (with the distance), or cancelled with a reason. */
export async function runStep(ctx: Ctx, id: string, step: string, f: Record<string, unknown> = {}) {
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT * FROM vehicle_run WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!r) throw notFound("Run");
    if (!mayEdit(ctx, r.branch_id)) throw forbidden();
    if (step === "start") {
      if (r.status !== "scheduled") throw invalid("Only a scheduled run can be started.");
      await c.query("UPDATE vehicle_run SET status = 'on_the_way', started_at = now(), updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1", [id, ctx.userId]);
    } else if (step === "complete") {
      if (!["scheduled", "on_the_way"].includes(r.status)) throw invalid("This run is already closed.");
      let km: string | null = null;
      if (str(f.distance_km)) {
        try { km = parseDec(f.distance_km, "Distance", { min: 0, dp: 1 }).toFixed(1); } catch { throw invalid("Distance must be in km, for example 12.5.", { field: "distance_km" }); }
      }
      await c.query(`UPDATE vehicle_run SET status = 'completed', started_at = coalesce(started_at, now()), completed_at = now(), distance_km = $2,
                            updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1`, [id, km, ctx.userId]);
    } else if (step === "cancel") {
      if (!["scheduled", "on_the_way"].includes(r.status)) throw invalid("This run is already closed.");
      const reason = optStr(f.reason);
      if (!reason) throw invalid("Reason: say why the run is cancelled.", { field: "reason" });
      await c.query("UPDATE vehicle_run SET status = 'cancelled', cancel_reason = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1", [id, reason, ctx.userId]);
    } else throw invalid("Unknown step.");
    await audit(c, ctx, "vehicle_run", id, step, { doc_no: r.doc_no, distance_km: optStr(f.distance_km), reason: optStr(f.reason) }, r.branch_id);
  });
}

const RUN_SELECT = `SELECT r.*, coalesce(u.full_name, r.driver_name) driver, (r.driver_user_id IS NULL) outside_driver, b.code branch_code,
       e.doc_no enquiry_no, j.doc_no job_no, v.registered_in, v.plate_code, v.plate_number, v.make, v.model
  FROM vehicle_run r JOIN branch b ON b.id = r.branch_id LEFT JOIN app_user u ON u.id = r.driver_user_id
  LEFT JOIN enquiry e ON e.id = r.enquiry_id LEFT JOIN job_card j ON j.id = r.job_card_id LEFT JOIN vehicle v ON v.id = r.vehicle_id`;

/** Runs list with filters: driver, type, status and a date range. */
export async function listRuns(ctx: Ctx, q: { driver?: string; type?: string; status?: string; from?: string; to?: string }) {
  if (!mayView(ctx, ctx.currentBranchId)) throw forbidden();
  const d = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `${RUN_SELECT}
        WHERE ($1::uuid IS NULL OR r.branch_id = $1) AND ($2 = '' OR r.driver_user_id::text = $2 OR lower(r.driver_name) = lower($2))
          AND ($3 = '' OR r.run_type = $3) AND ($4 = '' OR r.status = $4 OR ($4 = 'open' AND r.status IN ('scheduled','on_the_way')))
          AND ($5 = '' OR r.scheduled_at::date >= $5::date) AND ($6 = '' OR r.scheduled_at::date <= $6::date)
        ORDER BY r.scheduled_at DESC LIMIT 300`,
      [ctx.currentBranchId ?? null, q.driver ?? "", q.type ?? "", q.status ?? "", d(q.from), d(q.to)])).rows;
    const drivers = (await c.query(
      `SELECT DISTINCT coalesce(r.driver_user_id::text, r.driver_name) id, coalesce(u.full_name, r.driver_name || ' (outside)') name
         FROM vehicle_run r LEFT JOIN app_user u ON u.id = r.driver_user_id WHERE ($1::uuid IS NULL OR r.branch_id = $1) ORDER BY 2`, [ctx.currentBranchId ?? null])).rows;
    return { rows, drivers };
  });
}

export async function runsFor(ctx: Ctx, ref: { enquiryId?: string; jobId?: string; enquiryOfJob?: string | null }) {
  return withTx(ctx, async (c) => (await c.query(
    `${RUN_SELECT} WHERE ($1::uuid IS NOT NULL AND r.enquiry_id = $1) OR ($2::uuid IS NOT NULL AND r.job_card_id = $2) OR ($3::uuid IS NOT NULL AND r.enquiry_id = $3)
      ORDER BY r.scheduled_at`, [ref.enquiryId ?? null, ref.jobId ?? null, ref.enquiryOfJob ?? null])).rows);
}

export const canEditRuns = mayEdit;
export const canViewRuns = mayView;
