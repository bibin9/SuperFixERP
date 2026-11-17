import { Ctx, assertCan, can, canSee } from "../access";
import { withTx } from "../db";
import { invalid, notFound } from "../errors";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { optInt } from "../validate";

/**
 * One-page vehicle view: the owner with quick actions, the vehicle, its open enquiries and job cards
 * with each job line's technician, estimated time and status, past services from every branch, and
 * when the next service is due (by date or by km, whichever comes first).
 */

const CLOSED_JOB = ["delivered", "invoiced", "closed", "cancelled"];
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function nextServiceDue(last: { date: string | null; km: number | null } | null, intervalKm: number, intervalMonths: number, odometer: number | null, today: string) {
  if (!last?.date) return null;
  const d = new Date(`${last.date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + intervalMonths);
  const dueDate = d.toISOString().slice(0, 10);
  const dueKm = last.km !== null ? last.km + intervalKm : null;
  const daysLeft = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const kmLeft = dueKm !== null && odometer !== null ? dueKm - odometer : null;
  const overdue = daysLeft < 0 || (kmLeft !== null && kmLeft <= 0);
  const soon = !overdue && (daysLeft <= 30 || (kmLeft !== null && kmLeft <= 1000));
  return { dueDate, dueKm, daysLeft, kmLeft, overdue, soon };
}

export async function vehicleView(ctx: Ctx, id: string) {
  assertCan(ctx, "customers", "view");
  return withTx(ctx, async (c) => {
    const v = (await c.query(
      `SELECT v.*, c.id customer_id, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, c.whatsapp, c.email, c.price_level, c.credit_limit
         FROM vehicle v JOIN customer c ON c.id = v.owner_customer_id WHERE v.id = $1`, [id])).rows[0];
    if (!v) throw notFound("Vehicle");
    const prices = canSee(ctx, "selling_price");
    const history = (await c.query("SELECT * FROM vehicle_history($1)", [id])).rows.map((h) => (prices ? h : { ...h, amount: null }));
    const deferred = (await c.query("SELECT d.*, j.doc_no FROM deferred_work d JOIN job_card j ON j.id = d.job_card_id WHERE d.vehicle_id = $1 AND d.status = 'open'", [id])).rows;
    const jobs = (await c.query(
      `SELECT j.id, j.doc_no, j.status, j.job_type, j.promised_at, j.doc_date, j.odometer_in, b.code branch_code, a.full_name advisor, bay.code bay_code
         FROM job_card j JOIN branch b ON b.id = j.branch_id LEFT JOIN app_user a ON a.id = j.advisor_id LEFT JOIN bay ON bay.id = j.bay_id
        WHERE j.vehicle_id = $1 AND j.status <> ALL($2) ORDER BY j.created_at DESC`, [id, CLOSED_JOB])).rows;
    const jobIds = jobs.map((j) => j.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines: any[] = jobIds.length ? (await c.query(
      `SELECT l.id, l.job_card_id, l.line_no, l.line_type, l.description, l.qty, l.standard_hours, l.approval_status, l.extra_work,
              coalesce((SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name) FROM job_assignment ja JOIN app_user u ON u.id = ja.technician_id WHERE ja.job_line_id = l.id),
                       (SELECT full_name FROM app_user WHERE id = l.technician_id)) technician,
              (SELECT kind FROM time_event t WHERE t.job_line_id = l.id ORDER BY t.at DESC LIMIT 1) last_event,
              (SELECT min(planned_start) FROM job_assignment ja WHERE ja.job_line_id = l.id) planned_start
         FROM job_line l WHERE l.job_card_id = ANY($1) AND NOT l.removed AND l.approval_status <> 'declined' ORDER BY l.line_no`, [jobIds])).rows : [];
    const lineStatus = (l: { approval_status: string; last_event: string | null; line_type: string }) =>
      l.approval_status === "pending" ? "Waiting for approval" : l.approval_status === "deferred" ? "Deferred"
        : l.line_type !== "labour" ? "Approved" : !l.last_event ? "Not started" : l.last_event === "clock_out" ? "Done" : l.last_event === "pause" ? "Paused" : "Working";
    const openJobs = jobs.map((j) => ({
      ...j,
      lines: lines.filter((l) => l.job_card_id === j.id).map((l) => ({
        ...l, est_hours: l.line_type === "labour" ? n(l.qty) : null, line_status: lineStatus(l),
      })),
    }));
    const enquiries = (await c.query(
      `SELECT e.id, e.doc_no, e.status, e.service_asked, e.booked_for, e.booking_status, b.code branch_code FROM enquiry e JOIN branch b ON b.id = e.branch_id
        WHERE e.vehicle_id = $1 AND e.status IN ('open','booked','quoted','approved') ORDER BY e.created_at DESC`, [id])).rows;
    const lastService = (await c.query(
      `SELECT j.doc_date::text date, j.odometer_in km FROM job_card j WHERE j.vehicle_id = $1 AND j.job_type = 'service' AND j.status IN ('delivered','invoiced','closed')
        ORDER BY j.doc_date DESC LIMIT 1`, [id])).rows[0] ?? null;
    const intervalKm = n(v.service_interval_km) ?? Number(await getSetting(c, "vehicle.service_interval_km", null, 10000));
    const intervalMonths = n(v.service_interval_months) ?? Number(await getSetting(c, "vehicle.service_interval_months", null, 6));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
    const due = nextServiceDue(lastService ? { date: lastService.date, km: n(lastService.km) } : null, intervalKm, intervalMonths, n(v.odometer), today);
    const runs = (await c.query(
      `SELECT r.id, r.doc_no, r.run_type, r.scheduled_at, r.status, r.from_location, r.to_location, coalesce(u.full_name, r.driver_name) driver
         FROM vehicle_run r LEFT JOIN app_user u ON u.id = r.driver_user_id WHERE r.vehicle_id = $1 ORDER BY r.scheduled_at DESC LIMIT 10`, [id])).rows;
    const balance = can(ctx, "invoices", "view") && prices ? (await c.query(
      `SELECT coalesce(sum(grand_total - paid_amount - credited_amount),0) due, count(*) FILTER (WHERE grand_total - paid_amount - credited_amount > 0)::int open
         FROM sales_invoice WHERE customer_id = $1 AND status = 'posted'`, [v.customer_id])).rows[0] : null;
    return {
      vehicle: v, history, deferred, openJobs, enquiries, runs, balance, prices,
      service: { lastService, intervalKm, intervalMonths, ownInterval: v.service_interval_km !== null || v.service_interval_months !== null, due },
    };
  });
}

/** Service interval for this vehicle (blank = the default in Settings). */
export async function setServiceInterval(ctx: Ctx, id: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const v = (await c.query("SELECT id, owner_customer_id FROM vehicle WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!v) throw notFound("Vehicle");
    assertCan(ctx, "customers", "edit");
    let km: number | null, months: number | null;
    try { km = optInt(f.service_interval_km, "Every (km)", 500, 100000); } catch (e) { throw invalid((e as Error).message, { field: "service_interval_km" }); }
    try { months = optInt(f.service_interval_months, "Every (months)", 1, 36); } catch (e) { throw invalid((e as Error).message, { field: "service_interval_months" }); }
    await c.query("UPDATE vehicle SET service_interval_km = $2, service_interval_months = $3, updated_at = now(), updated_by = $4 WHERE id = $1", [id, km, months, ctx.userId]);
    await audit(c, ctx, "vehicle", id, "service_interval", { service_interval_km: km, service_interval_months: months }, null);
  });
}
