import type { PoolClient } from "pg";
import { Ctx, assertCan, can } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { optStr, str } from "../validate";
import { parseDec } from "../money";

/**
 * Booking calendar (FSD 4.3, booking calendar by bay and technician). A booking sits on the enquiry:
 * the day and time the car comes in, the bay, the technician and the hours it takes. The day's load of
 * a bay or technician is the hours of its open bookings plus the labour hours of assigned job lines not
 * yet finished, counted on their planned start day, or today when no start is planned. Capacity comes from the Bays and Technician capacity masters. Going over capacity is
 * warned (a reason is kept) or blocked, as the setting workshop.overbook_policy says.
 */

export type Load = { id: string; name: string; capacity: number; booked: number; planned: number; total: number };
const n = (v: unknown) => Number(v ?? 0);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const fmtH = (h: number) => (Math.round(h * 100) / 100).toString();
const LIVE_JOB = "('ready','delivered','invoiced','closed','cancelled')";

function branchOf(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}

async function technicians(c: PoolClient, branchId: string) {
  const fallback = n(await getSetting(c, "workshop.technician_day_hours", branchId, 8));
  return (await c.query(
    `SELECT DISTINCT u.id, u.full_name, coalesce(tc.daily_hours, $2) capacity
       FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id JOIN app_user u ON u.id = ubr.user_id
       LEFT JOIN technician_capacity tc ON tc.user_id = u.id AND tc.active
      WHERE ubr.branch_id = $1 AND r.code = 'technician' AND u.status = 'active' ORDER BY u.full_name`, [branchId, fallback])).rows;
}

/** Load of every bay and technician of the branch on one day, leaving out one enquiry (the one being booked). */
export async function dayLoad(c: PoolClient, branchId: string, date: string, excludeEnquiryId: string | null = null) {
  const bays = (await c.query("SELECT id, code, capacity_hours FROM bay WHERE branch_id = $1 AND active ORDER BY code", [branchId])).rows;
  const techs = await technicians(c, branchId);
  const booked = (await c.query(
    `SELECT booking_bay_id bay, booking_technician_id tech, booking_hours h FROM enquiry
      WHERE branch_id = $1 AND booking_status = 'booked' AND booked_for::date = $2::date AND ($3::uuid IS NULL OR id <> $3)`,
    [branchId, date, excludeEnquiryId])).rows;
  const planned = (await c.query(
    `SELECT coalesce(a.bay_id, j.bay_id) bay, a.technician_id tech, l.qty h
       FROM job_assignment a JOIN job_line l ON l.id = a.job_line_id JOIN job_card j ON j.id = l.job_card_id
      WHERE a.branch_id = $1 AND coalesce(a.planned_start::date, (now() AT TIME ZONE 'Asia/Dubai')::date) = $2::date AND NOT l.removed AND l.line_type = 'labour'
        AND l.approval_status = 'approved' AND j.status NOT IN ${LIVE_JOB}
        AND coalesce((SELECT t.kind FROM time_event t WHERE t.job_line_id = l.id AND t.technician_id = a.technician_id ORDER BY t.at DESC LIMIT 1), '') <> 'clock_out'`,
    [branchId, date])).rows;
  const sum = (rows: { bay: string; tech: string; h: unknown }[], key: "bay" | "tech", id: string) => rows.filter((r) => r[key] === id).reduce((a, r) => a + n(r.h), 0);
  const mk = (id: string, name: string, capacity: unknown): Load => ({ id, name, capacity: n(capacity), booked: 0, planned: 0, total: 0 });
  const bayLoad = bays.map((b) => {
    const l = mk(b.id, b.code, b.capacity_hours);
    l.booked = sum(booked, "bay", b.id); l.planned = sum(planned, "bay", b.id); l.total = l.booked + l.planned;
    return l;
  });
  const techLoad = techs.map((t) => {
    const l = mk(t.id, t.full_name, t.capacity);
    l.booked = sum(booked, "tech", t.id); l.planned = sum(planned, "tech", t.id); l.total = l.booked + l.planned;
    return l;
  });
  return { bays: bayLoad, techs: techLoad };
}

/** Load for the booking form, as the advisor picks a day. */
export async function loadFor(ctx: Ctx, date: string, excludeEnquiryId: string | null, branchIn?: string | null) {
  const branchId = branchIn || branchOf(ctx);
  if (!can(ctx, "customers", "view", branchId)) throw forbidden();
  if (!isDate(date)) throw invalid("Pick a valid day.");
  return withTx(ctx, (c) => dayLoad(c, branchId, date, excludeEnquiryId));
}

/** The booking calendar: the day's load, its bookings and a strip of the next seven days. */
export async function bookingDay(ctx: Ctx, dateIn: string) {
  const branchId = branchOf(ctx);
  if (!can(ctx, "customers", "view", branchId)) throw forbidden();
  const date = isDate(dateIn) ? dateIn : today();
  return withTx(ctx, async (c) => {
    const load = await dayLoad(c, branchId, date);
    const bookings = (await c.query(
      `SELECT e.id, e.doc_no, e.status, e.booking_status, e.booked_for, e.booking_hours, e.booking_override_reason, e.service_asked,
              e.contact_name, e.contact_mobile, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile,
              v.registered_in, v.plate_code, v.plate_number, v.make, v.model, b.code bay_code, t.full_name technician_name, e.converted_job_id
         FROM enquiry e LEFT JOIN customer c ON c.id = e.customer_id LEFT JOIN vehicle v ON v.id = e.vehicle_id
         LEFT JOIN bay b ON b.id = e.booking_bay_id LEFT JOIN app_user t ON t.id = e.booking_technician_id
        WHERE e.branch_id = $1 AND e.booking_status IS NOT NULL AND e.booked_for::date = $2::date ORDER BY e.booked_for`, [branchId, date])).rows;
    const week = (await c.query(
      `SELECT d::date::text AS day, count(e.id)::int AS bookings, coalesce(sum(e.booking_hours),0) hours
         FROM generate_series($2::date, $2::date + 6, interval '1 day') d
         LEFT JOIN enquiry e ON e.branch_id = $1 AND e.booking_status = 'booked' AND e.booked_for::date = d::date
        GROUP BY d ORDER BY d`, [branchId, date])).rows;
    const capacity = load.bays.reduce((a, b) => a + b.capacity, 0);
    const runs = (await c.query(
      `SELECT r.id, r.doc_no, r.run_type, r.scheduled_at, r.status, r.from_location, r.to_location, coalesce(u.full_name, r.driver_name) driver
         FROM vehicle_run r LEFT JOIN app_user u ON u.id = r.driver_user_id
        WHERE r.branch_id = $1 AND r.scheduled_at::date = $2::date AND r.status <> 'cancelled' ORDER BY r.scheduled_at`, [branchId, date])).rows;
    return { date, today: today(), load, bookings, week, capacity, runs, canBook: can(ctx, "customers", "edit", branchId) };
  });
}

function overMessages(load: { bays: Load[]; techs: Load[] }, bayId: string | null, techId: string | null, hours: number, day: string) {
  const out: string[] = [];
  for (const [list, id, what] of [[load.bays, bayId, "Bay"], [load.techs, techId, "Technician"]] as const) {
    if (!id) continue;
    const l = list.find((x) => x.id === id);
    if (l && l.total + hours > l.capacity + 1e-9)
      out.push(`${what} ${l.name} has ${fmtH(l.total)} of ${fmtH(l.capacity)} hours taken on ${day}; this booking makes ${fmtH(l.total + hours)}.`);
  }
  return out;
}

/** Books (or moves) the enquiry's visit. Over capacity needs a reason, or is refused, per the setting. */
export async function bookEnquiry(ctx: Ctx, id: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [id]);
    if (!e.rowCount) throw notFound("Enquiry");
    const enq = e.rows[0];
    assertCan(ctx, "customers", "edit", enq.branch_id);
    if (!["open", "booked", "quoted", "approved"].includes(enq.status)) throw invalid("This enquiry is closed, so it cannot be booked.");
    const when = str(f.booked_for);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) throw invalid("Booked for: pick the day and time the car comes in.", { field: "booked_for" });
    const day = when.slice(0, 10);
    const t = (await c.query("SELECT $1::timestamp AT TIME ZONE 'Asia/Dubai' ts, ($1::timestamp AT TIME ZONE 'Asia/Dubai') < now() - interval '15 minutes' past, $2::date - (now() AT TIME ZONE 'Asia/Dubai')::date ahead", [when, day])).rows[0];
    if (t.past) throw invalid("Booked for: that time has already passed.", { field: "booked_for" });
    const maxAhead = n(await getSetting(c, "workshop.booking_days_ahead", enq.branch_id, 60));
    if (n(t.ahead) > maxAhead) throw invalid(`Booked for: bookings can be made up to ${maxAhead} days ahead.`, { field: "booked_for" });
    const bayId = optStr(f.bay_id);
    if (bayId && !(await c.query("SELECT 1 FROM bay WHERE id = $1 AND branch_id = $2 AND active", [bayId, enq.branch_id])).rowCount)
      throw invalid("Bay: pick a bay of this branch.", { field: "bay_id" });
    const techId = optStr(f.technician_id);
    if (techId && !(await technicians(c, enq.branch_id)).some((x) => x.id === techId))
      throw invalid("Technician: pick a technician of this branch.", { field: "technician_id" });
    let hours: number;
    if (str(f.hours)) {
      try { hours = parseDec(f.hours, "Hours", { min: "0.25", dp: 2 }).toNumber(); } catch { throw invalid("Hours must be a number from 0.25 to 24.", { field: "hours" }); }
      if (hours > 24) throw invalid("Hours must be a number from 0.25 to 24.", { field: "hours" });
    } else {
      const lab = (await c.query("SELECT coalesce(sum(qty),0) h FROM job_line WHERE enquiry_id = $1 AND line_type = 'labour' AND NOT removed AND approval_status <> 'declined'", [id])).rows[0].h;
      hours = n(lab) || n(await getSetting(c, "workshop.default_booking_hours", enq.branch_id, 2));
    }
    const load = await dayLoad(c, enq.branch_id, day, id);
    const over = overMessages(load, bayId, techId, hours, day);
    const reason = optStr(f.override_reason);
    if (over.length) {
      const policy = String(await getSetting(c, "workshop.overbook_policy", enq.branch_id, "warn"));
      if (policy === "block") throw invalid(`${over.join(" ")} Overbooking is not allowed. Pick another bay, technician or time.`, { field: bayId && over.some((m) => m.startsWith("Bay")) ? "bay_id" : "technician_id" });
      if (!reason) throw invalid(`Reason for overbooking: ${over.join(" ")} To book anyway, give the reason.`, { field: "override_reason", over });
    }
    await c.query(
      `UPDATE enquiry SET booked_for = $2::timestamp AT TIME ZONE 'Asia/Dubai', booking_bay_id = $3, booking_technician_id = $4, booking_hours = $5, booking_status = 'booked',
              booking_override_reason = $6, booked_by = $7, booked_at = now(), status = CASE WHEN status = 'open' THEN 'booked' ELSE status END,
              updated_at = now(), updated_by = $7, version = version + 1 WHERE id = $1`,
      [id, when, bayId, techId, hours, over.length ? reason : null, ctx.userId]);
    await audit(c, ctx, "enquiry", id, enq.booking_status === "booked" ? "rebook" : "book",
      { booked_for: when, bay_id: bayId, technician_id: techId, hours, overbooked: over.length ? over : undefined, override_reason: over.length ? reason : undefined }, enq.branch_id);
    return { overbooked: over.length > 0, hours, day };
  });
}

/** Cancels the booking or records that the customer did not come. The enquiry itself stays open. */
export async function closeBooking(ctx: Ctx, id: string, outcome: "cancelled" | "no_show", reason: string | null) {
  return withTx(ctx, async (c) => {
    const e = await c.query("SELECT * FROM enquiry WHERE id = $1 FOR UPDATE", [id]);
    if (!e.rowCount) throw notFound("Enquiry");
    const enq = e.rows[0];
    assertCan(ctx, "customers", "edit", enq.branch_id);
    if (enq.booking_status !== "booked") throw invalid("There is no open booking on this enquiry.");
    if (outcome === "cancelled" && !optStr(reason)) throw invalid("Reason: say why the booking is cancelled.", { field: "reason" });
    await c.query(
      `UPDATE enquiry SET booking_status = $2, status = CASE WHEN status = 'booked' THEN 'open' ELSE status END,
              notes = CASE WHEN $3::text IS NULL THEN notes ELSE concat_ws(E'\\n', notes, $3::text) END,
              updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1`,
      [id, outcome, optStr(reason) ? `Booking cancelled: ${optStr(reason)}` : null, ctx.userId]);
    await audit(c, ctx, "enquiry", id, outcome === "no_show" ? "no_show" : "cancel_booking", { reason: optStr(reason) }, enq.branch_id);
  });
}

/** Booking-form data: the branch's bays and technicians. */
export async function bookingOptions(ctx: Ctx, branchId: string) {
  return withTx(ctx, async (c) => ({
    bays: (await c.query("SELECT id, code, capacity_hours FROM bay WHERE branch_id = $1 AND active ORDER BY code", [branchId])).rows,
    techs: await technicians(c, branchId),
    policy: String(await getSetting(c, "workshop.overbook_policy", branchId, "warn")),
  }));
}
