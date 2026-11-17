import type { PoolClient } from "pg";
import { Ctx, assertCan, can } from "../access";
import { withTx, withAnonTx, withBranchSystemTx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { D, parseDec } from "../money";
import { optStr, required, str, int } from "../validate";
import { setStatus, STATUS_LABEL } from "./jobs";
import { releaseStatus, maybeCloseJob } from "./billing";

/** M05 workshop floor: assignment, clocking, part requests, quality check, delivery and the board. */

export type TimeEvent = { kind: string; at: Date | string; reason?: string | null };
const ACTIVE_JOB = ["approved", "awaiting_parts", "in_progress", "quality_check"];

/** FSD 5.4: clocked time = sum of working segments (clock in or resume, to pause or clock out). */
export function clockedMinutes(events: TimeEvent[], now = new Date()) {
  let total = 0, start: number | null = null;
  const pauses: Record<string, number> = {};
  let pauseStart: number | null = null, pauseReason = "";
  for (const e of [...events].sort((a, b) => +new Date(a.at) - +new Date(b.at))) {
    const t = +new Date(e.at);
    if (e.kind === "clock_in" || e.kind === "resume") {
      if (pauseStart !== null) { pauses[pauseReason] = (pauses[pauseReason] ?? 0) + (t - pauseStart) / 60000; pauseStart = null; }
      if (start === null) start = t;
    } else if (e.kind === "pause" || e.kind === "clock_out") {
      if (start !== null) { total += (t - start) / 60000; start = null; }
      if (e.kind === "pause") { pauseStart = t; pauseReason = e.reason ?? "other"; }
      else pauseStart = null;
    }
  }
  if (start !== null) total += (+now - start) / 60000;
  return { minutes: Math.max(0, Math.round(total)), pauses };
}

/** State of one technician on one line, from that technician's last event on it. */
const lineState = (last?: { kind: string } | null) =>
  !last ? "not_started" : last.kind === "clock_out" ? "done" : last.kind === "pause" ? "paused" : "working";

/** WS-05 colours: green below the amber threshold, amber up to 100% of standard, red above. */
export function lineColour(minutes: number, standardHours: number | string | null, amberPct: number) {
  const std = Number(standardHours ?? 0) * 60;
  if (!std) return "";
  const pct = (minutes / std) * 100;
  return pct > 100 ? "red" : pct >= amberPct ? "amber" : "green";
}

/** WS-05 job colour on the board: red once the promised time has passed, amber inside the warning window. */
export function jobColour(promisedAt: Date | string | null, warnMinutes: number, now = new Date()) {
  if (!promisedAt) return "";
  const left = (+new Date(promisedAt) - +now) / 60000;
  return left < 0 ? "red" : left < warnMinutes ? "amber" : "green";
}

async function isTechnicianAt(c: PoolClient, userId: string, branchId: string) {
  return !!(await c.query("SELECT 1 FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = $1 AND ubr.branch_id = $2 AND r.code = 'technician'", [userId, branchId])).rowCount;
}

// ---------- assignment (WS-02) ----------

/** Several technicians can share a line; the first is the line's main technician. */
export async function setAssignments(ctx: Ctx, lineId: string, techIds: string[], bayId?: string | null) {
  return withTx(ctx, async (c) => {
    const l = (await c.query("SELECT l.*, j.status job_status FROM job_line l JOIN job_card j ON j.id = l.job_card_id WHERE l.id = $1 FOR UPDATE OF l", [lineId])).rows[0];
    if (!l) throw notFound("Job line");
    if (!can(ctx, "workshop", "edit", l.branch_id) && !can(ctx, "jobs", "edit", l.branch_id)) throw forbidden();
    if (!ACTIVE_JOB.includes(l.job_status)) throw invalid("Work can be assigned only on an open job.");
    if (l.line_type !== "labour" && l.line_type !== "outside") throw invalid("Assign technicians to labour lines.");
    const ids = [...new Set(techIds.filter(Boolean))];
    for (const t of ids) if (!(await isTechnicianAt(c, t, l.branch_id))) throw invalid("Only technicians of this branch can be assigned.");
    const before = (await c.query("SELECT technician_id FROM job_assignment WHERE job_line_id = $1 ORDER BY assigned_at", [lineId])).rows.map((r) => r.technician_id);
    await c.query("DELETE FROM job_assignment WHERE job_line_id = $1 AND NOT (technician_id = ANY($2::uuid[]))", [lineId, ids]);
    for (const t of ids) {
      await c.query(`INSERT INTO job_assignment (branch_id, job_line_id, technician_id, bay_id, assigned_by) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (job_line_id, technician_id) DO UPDATE SET bay_id = EXCLUDED.bay_id`, [l.branch_id, lineId, t, bayId || null, ctx.userId]);
    }
    await c.query("UPDATE job_line SET technician_id = $2, version = version + 1 WHERE id = $1", [lineId, ids[0] ?? null]);
    if (bayId) await c.query("UPDATE job_card SET bay_id = $2 WHERE id = $1", [l.job_card_id, bayId]);
    await audit(c, ctx, "job_line", lineId, "assign", { technicians: { old: before, new: ids } }, l.branch_id);
  });
}

// ---------- technician home (WS-04, UX-02) ----------

export async function myJobs(ctx: Ctx) {
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT l.id line_id, l.description, l.standard_hours, l.line_no, j.id job_id, j.doc_no, j.status job_status, j.promised_at, j.branch_id,
              v.make, v.model, v.registered_in, v.plate_code, v.plate_number, b.code bay_code
         FROM job_line l JOIN job_card j ON j.id = l.job_card_id JOIN vehicle v ON v.id = j.vehicle_id LEFT JOIN bay b ON b.id = j.bay_id
        WHERE NOT l.removed AND l.approval_status = 'approved' AND j.status = ANY($2::text[])
          AND (l.technician_id = $1 OR EXISTS (SELECT 1 FROM job_assignment a WHERE a.job_line_id = l.id AND a.technician_id = $1))
        ORDER BY j.promised_at NULLS LAST, j.doc_no, l.line_no`, [ctx.userId, ACTIVE_JOB])).rows;
    const ev = rows.length ? (await c.query("SELECT * FROM time_event WHERE technician_id = $1 AND job_line_id = ANY($2::uuid[]) ORDER BY at, created_at", [ctx.userId, rows.map((r) => r.line_id)])).rows : [];
    const amber = Number(await getSetting(c, "workshop.amber_pct", ctx.currentBranchId, 85));
    const failed = rows.length ? (await c.query(
      `SELECT DISTINCT ON (job_card_id) job_card_id, result, items, note FROM qc_check WHERE job_card_id = ANY($1::uuid[]) ORDER BY job_card_id, checked_at DESC`,
      [[...new Set(rows.map((r) => r.job_id))]])).rows.filter((q) => q.result === "fail") : [];
    return rows.map((r) => {
      const mine = ev.filter((e) => e.job_line_id === r.line_id);
      const last = mine[mine.length - 1];
      const t = clockedMinutes(mine);
      const qc = failed.find((q) => q.job_card_id === r.job_id);
      return { ...r, state: lineState(last), pauseReason: last?.kind === "pause" ? last.reason : null, minutes: t.minutes, colour: lineColour(t.minutes, r.standard_hours, amber),
        qcFailed: qc ? (qc.items as { label: string; result: string; note?: string }[]).filter((i) => i.result === "failed") : [] };
    });
  });
}

/**
 * Clock in, pause, resume, clock out (WS-04). One job at a time: clocking into a line while working
 * on another pauses the other with "Switched job", after the technician confirms.
 */
export async function clock(ctx: Ctx, lineId: string, kind: "clock_in" | "pause" | "resume" | "clock_out", f: { reason?: string; confirmSwitch?: boolean; device?: string } = {}) {
  return withTx(ctx, async (c) => {
    const l = (await c.query("SELECT l.*, j.status job_status, j.doc_no, j.id job_id FROM job_line l JOIN job_card j ON j.id = l.job_card_id WHERE l.id = $1", [lineId])).rows[0];
    if (!l) throw notFound("Job line");
    const assigned = l.technician_id === ctx.userId || (await c.query("SELECT 1 FROM job_assignment WHERE job_line_id = $1 AND technician_id = $2", [lineId, ctx.userId])).rowCount;
    if (!assigned) throw forbidden("This work is not assigned to you.");
    if (!["approved", "awaiting_parts", "in_progress"].includes(l.job_status)) throw invalid(`The job is ${STATUS_LABEL[l.job_status] ?? l.job_status}; clocking is closed.`);
    // Serialise this technician's clocking so two taps cannot both start work.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ctx.userId]);
    const lastHere = (await c.query("SELECT * FROM time_event WHERE technician_id = $1 AND job_line_id = $2 ORDER BY at DESC, created_at DESC LIMIT 1", [ctx.userId, lineId])).rows[0];
    const state = lineState(lastHere);
    let reason: string | null = null;
    if (kind === "clock_in" || kind === "resume") {
      if (state === "working") throw conflict("You are already clocked in on this work.");
      const other = (await c.query(
        `SELECT DISTINCT ON (job_line_id) e.*, j.doc_no FROM time_event e JOIN job_card j ON j.id = e.job_card_id
          WHERE e.technician_id = $1 AND e.job_line_id <> $2 ORDER BY job_line_id, at DESC, created_at DESC`, [ctx.userId, lineId])).rows
        .filter((e) => e.kind === "clock_in" || e.kind === "resume");
      if (other.length && !f.confirmSwitch) throw conflict(`You are clocked in on job ${other[0].doc_no}. Switch to this job? It will be paused.`);
      for (const o of other) {
        await c.query("INSERT INTO time_event (branch_id, job_card_id, job_line_id, technician_id, kind, reason, device) VALUES ($1,$2,$3,$4,'pause','switched',$5)",
          [o.branch_id, o.job_card_id, o.job_line_id, ctx.userId, optStr(f.device)]);
      }
      kind = state === "paused" ? "resume" : "clock_in";
      if (["approved", "awaiting_parts"].includes(l.job_status)) await setStatus(c, ctx, { id: l.job_id, branch_id: l.branch_id, status: l.job_status }, "in_progress", "Technician clocked in");
    } else if (kind === "pause") {
      if (state !== "working") throw invalid("You are not clocked in on this work.");
      reason = required(f.reason, "Pause reason");
      const ok = await c.query("SELECT 1 FROM lookup_value WHERE list = 'pause_reason' AND code = $1 AND active", [reason]);
      if (!ok.rowCount) throw invalid("Choose a pause reason.");
    } else if (kind === "clock_out") {
      if (state !== "working" && state !== "paused") throw invalid("You have not started this work.");
    }
    await c.query("INSERT INTO time_event (branch_id, job_card_id, job_line_id, technician_id, kind, reason, device) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [l.branch_id, l.job_card_id, lineId, ctx.userId, kind, reason, optStr(f.device)]);
    return { kind };
  });
}

/** WS-07: a supervisor corrects a clock event; the original time is kept and the event is marked. */
export async function correctEvent(ctx: Ctx, eventId: string, newAt: string, reason: string) {
  const why = required(reason, "Reason");
  const at = new Date(str(newAt));
  if (isNaN(+at)) throw invalid("Enter the corrected time.");
  if (+at > Date.now() + 60_000) throw invalid("The corrected time cannot be in the future.");
  return withTx(ctx, async (c) => {
    const e = (await c.query("SELECT * FROM time_event WHERE id = $1 FOR UPDATE", [eventId])).rows[0];
    if (!e) throw notFound("Clock event");
    assertCan(ctx, "workshop", "edit", e.branch_id);
    if (e.technician_id === ctx.userId) throw forbidden("You cannot correct your own clock events.");
    await c.query("UPDATE time_event SET at = $2, original_at = coalesce(original_at, at), corrected = true, correction_reason = $3, corrected_by = $4 WHERE id = $1",
      [eventId, at.toISOString(), why, ctx.userId]);
    await audit(c, ctx, "time_event", eventId, "corrected", { at: { old: e.at, new: at.toISOString() }, reason: why }, e.branch_id);
  });
}

/** Clock events and clocked time per line for the job card (supervisor view). */
export async function jobTime(c: PoolClient, ctx: Ctx, jobId: string, branchId: string) {
  const ev = (await c.query(
    `SELECT e.*, u.full_name technician_name FROM time_event e JOIN app_user u ON u.id = e.technician_id WHERE e.job_card_id = $1 ORDER BY e.at, e.created_at`, [jobId])).rows;
  const assignments = (await c.query(
    `SELECT a.job_line_id, a.technician_id, u.full_name FROM job_assignment a JOIN app_user u ON u.id = a.technician_id WHERE a.branch_id = $1 AND a.job_line_id IN (SELECT id FROM job_line WHERE job_card_id = $2) ORDER BY a.assigned_at`,
    [branchId, jobId])).rows;
  const amber = Number(await getSetting(c, "workshop.amber_pct", branchId, 85));
  const byLine: Record<string, { minutes: number; techs: Record<string, { name: string; minutes: number; state: string }> }> = {};
  for (const e of ev) {
    byLine[e.job_line_id] ??= { minutes: 0, techs: {} };
    byLine[e.job_line_id].techs[e.technician_id] ??= { name: e.technician_name, minutes: 0, state: "" };
  }
  for (const [lineId, v] of Object.entries(byLine)) {
    for (const techId of Object.keys(v.techs)) {
      const mine = ev.filter((e) => e.job_line_id === lineId && e.technician_id === techId);
      const m = clockedMinutes(mine).minutes;
      v.techs[techId].minutes = m;
      v.techs[techId].state = lineState(mine[mine.length - 1]);
      v.minutes += m;
    }
  }
  const qc = (await c.query("SELECT q.*, u.full_name FROM qc_check q LEFT JOIN app_user u ON u.id = q.checked_by WHERE job_card_id = $1 ORDER BY checked_at DESC", [jobId])).rows;
  const delivery = (await c.query("SELECT d.*, u.full_name FROM delivery d LEFT JOIN app_user u ON u.id = d.delivered_by WHERE job_card_id = $1", [jobId])).rows[0] ?? null;
  const requests = (await c.query(
    `SELECT pr.*, i.part_no, u.full_name requested_name FROM part_request pr LEFT JOIN item i ON i.id = pr.item_id LEFT JOIN app_user u ON u.id = pr.requested_by
      WHERE pr.job_card_id = $1 ORDER BY pr.requested_at DESC`, [jobId])).rows;
  return { events: can(ctx, "workshop", "edit", branchId) || can(ctx, "jobs", "view", branchId) ? ev : [], byLine, assignments, amber, qc, delivery, requests };
}

/** Workshop panel data for the job card page; the caller's job access is checked by getJob first. */
export async function jobWorkshop(ctx: Ctx, jobId: string) {
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT branch_id FROM job_card WHERE id = $1", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    const t = await jobTime(c, ctx, jobId, j.branch_id);
    const qcList = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'qc_checklist' AND active ORDER BY sort")).rows;
    const deliveryList = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'delivery_checklist' AND active ORDER BY sort")).rows;
    return { ...t, qcList, deliveryList, canSupervise: can(ctx, "workshop", "edit", j.branch_id) };
  });
}

// ---------- part requests (WS-08) ----------

/** "Need part" from the technician. A part already approved on the job goes to the store queue; a new part needs a quote first. */
export async function requestPart(ctx: Ctx, jobId: string, f: Record<string, unknown>) {
  const qty = parseDec(f.qty || "1", "Quantity", { min: "0.001", dp: 3 });
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT * FROM job_card WHERE id = $1", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    const mine = (await c.query(`SELECT 1 FROM job_line l WHERE l.job_card_id = $1 AND (l.technician_id = $2 OR EXISTS (SELECT 1 FROM job_assignment a WHERE a.job_line_id = l.id AND a.technician_id = $2))`, [jobId, ctx.userId])).rowCount;
    if (!mine && !can(ctx, "jobs", "edit", j.branch_id) && !can(ctx, "workshop", "edit", j.branch_id)) throw forbidden();
    if (!ACTIVE_JOB.includes(j.status)) throw invalid("The job is closed.");
    const itemId = optStr(f.item_id);
    const desc = optStr(f.description);
    if (!itemId && !desc) throw invalid("Choose the part or describe it.");
    const line = itemId ? (await c.query(
      `SELECT id FROM job_line WHERE job_card_id = $1 AND item_id = $2 AND NOT removed AND approval_status = 'approved' AND issued_qty < qty ORDER BY line_no LIMIT 1`, [jobId, itemId])).rows[0] : null;
    const status = line ? "open" : "needs_quote";
    await c.query("INSERT INTO part_request (branch_id, job_card_id, job_line_id, item_id, description, qty, note, status, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [j.branch_id, jobId, line?.id ?? null, itemId, desc, qty.toFixed(3), optStr(f.note), status, ctx.userId]);
    await audit(c, ctx, "part_request", jobId, status, { item_id: itemId, qty: qty.toFixed(3) }, j.branch_id);
    return status;
  });
}

// ---------- quality check (WS-09) and delivery (WS-10) ----------

export async function recordQc(ctx: Ctx, jobId: string, results: Record<string, string>, notes: Record<string, string>, note?: string) {
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    assertCan(ctx, "workshop", "edit", j.branch_id);
    if (j.status !== "quality_check") throw invalid("The job is not waiting for a quality check.");
    const list = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'qc_checklist' AND active ORDER BY sort")).rows;
    const items = list.map((i) => {
      const r = results[i.code];
      if (!["done", "na", "failed"].includes(r)) throw invalid(`Mark "${i.name_en}" as Done, N/A or Failed.`);
      if (r === "failed" && !str(notes[i.code])) throw invalid(`Say what failed on "${i.name_en}".`);
      return { code: i.code, label: i.name_en, result: r, note: optStr(notes[i.code]) };
    });
    const pass = !items.some((i) => i.result === "failed");
    if (pass) {
      // DL-02: a late job needs a delay reason before it moves on.
      if (j.promised_at && new Date(j.promised_at) < new Date() && !j.delay_reason) throw invalid("This job is late. Enter a delay reason on the job card first.");
    }
    await c.query("INSERT INTO qc_check (branch_id, job_card_id, result, items, note, checked_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [j.branch_id, jobId, pass ? "pass" : "fail", JSON.stringify(items), optStr(note), ctx.userId]);
    await setStatus(c, ctx, j, pass ? "ready" : "in_progress", pass ? "Quality check passed" : "Quality check failed");
    if (pass) await c.query("UPDATE job_card SET ready_at = now() WHERE id = $1", [jobId]);
    await audit(c, ctx, "job_card", jobId, pass ? "qc_pass" : "qc_fail", { failed: items.filter((i) => i.result === "failed").map((i) => i.label) }, j.branch_id);
    return pass;
  });
}

export async function deliver(ctx: Ctx, jobId: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const j = (await c.query("SELECT * FROM job_card WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    assertCan(ctx, "jobs", "edit", j.branch_id);
    if (!(j.status === "ready" || (j.status === "invoiced" && !j.delivered_at))) throw invalid("Only a job at Ready (or invoiced and not yet handed over) can be delivered.");
    // IV-08 / PY-05: the car leaves only when paid, on credit terms within the limit, or released by a manager.
    const rel = await releaseStatus(c, jobId);
    if (!rel.basis) throw invalid(`AED ${rel.balance.toFixed(2)} is still owed on this job. Take payment first, or ask a manager to release the car on credit.`);
    const list = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'delivery_checklist' AND active ORDER BY sort")).rows;
    const checklist = list.map((i) => ({ code: i.code, label: i.name_en, done: f[`chk_${i.code}`] === "on" }));
    const missing = checklist.filter((x) => !x.done);
    if (missing.length) throw invalid(`Tick every walkthrough item: ${missing.map((m) => m.label).join(", ")}.`);
    const oldParts = str(f.old_parts);
    if (!["returned", "disposed", "none"].includes(oldParts)) throw invalid("Say what happened to the old parts.");
    const odo = int(f.odometer_out, "Odometer out", 0);
    if (j.odometer_in !== null && odo < j.odometer_in) throw invalid("Odometer out is lower than the reading at check-in.");
    const sig = optStr(f.signature);
    if (sig && (!sig.startsWith("data:image/png;base64,") || sig.length > 400_000)) throw invalid("The signature could not be read. Sign again.");
    await c.query("INSERT INTO delivery (branch_id, job_card_id, checklist, old_parts, received_by_name, signature, odometer_out, delivered_by, balance_at_release, release_basis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [j.branch_id, jobId, JSON.stringify(checklist), oldParts, required(f.received_by_name, "Received by"), sig, odo, ctx.userId, rel.balance.toFixed(2), rel.basis]);
    await c.query("UPDATE job_card SET delivered_at = now() WHERE id = $1", [jobId]);
    await c.query("UPDATE vehicle SET odometer = GREATEST(coalesce(odometer,0), $2) WHERE id = $1", [j.vehicle_id, odo]);
    if (j.status === "ready") await setStatus(c, ctx, j, "delivered", "Delivered to the customer");
    else {
      await c.query("INSERT INTO job_status_history (job_card_id, branch_id, from_status, to_status, reason, user_id) VALUES ($1,$2,$3,$3,$4,$5)",
        [jobId, j.branch_id, j.status, "Delivered to the customer", ctx.userId]);
      await maybeCloseJob(c, ctx, jobId);
    }
    await audit(c, ctx, "job_card", jobId, "delivered", { odometer_out: odo, old_parts: oldParts, release_basis: rel.basis, balance: rel.balance.toFixed(2) }, j.branch_id);
  });
}

// ---------- workshop board (WS-01) ----------

async function boardRows(c: PoolClient, branchId: string) {
  const jobs = (await c.query(
    `SELECT j.id, j.doc_no, j.status, j.promised_at, j.delay_reason, v.make, v.model, v.registered_in, v.plate_code, v.plate_number, b.code bay_code,
            (SELECT string_agg(DISTINCT u.full_name, ', ') FROM job_line l LEFT JOIN job_assignment a ON a.job_line_id = l.id
               JOIN app_user u ON u.id = coalesce(a.technician_id, l.technician_id) WHERE l.job_card_id = j.id AND NOT l.removed) technicians,
            EXISTS (SELECT 1 FROM stock_commitment sc JOIN job_line l ON l.id = sc.job_line_id WHERE l.job_card_id = j.id AND sc.status = 'active' AND sc.back_ordered > 0) waiting_parts
       FROM job_card j JOIN vehicle v ON v.id = j.vehicle_id LEFT JOIN bay b ON b.id = j.bay_id
      WHERE j.branch_id = $1 AND j.status IN ('approved','awaiting_parts','in_progress','quality_check','ready')
      ORDER BY j.promised_at NULLS LAST, j.doc_no`, [branchId])).rows;
  const warn = Number(await getSetting(c, "workshop.job_warning_minutes", branchId, 30));
  const refresh = Number(await getSetting(c, "workshop.board_refresh_seconds", branchId, 30));
  const now = new Date();
  return {
    refresh,
    jobs: jobs.map((j) => ({ ...j, colour: j.status === "ready" ? "green" : jobColour(j.promised_at, warn, now),
      minutesLeft: j.promised_at ? Math.round((+new Date(j.promised_at) - +now) / 60000) : null })),
  };
}

export async function board(ctx: Ctx) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "workshop", "view", b);
  return withTx(ctx, async (c) => {
    const br = (await c.query("SELECT code, name_en, board_token FROM branch WHERE id = $1", [b])).rows[0];
    return { ...(await boardRows(c, b)), branch: br, showToken: can(ctx, "workshop", "edit", b) || can(ctx, "settings", "edit", b) };
  });
}

/** Full-screen board for a registered wall TV: the branch's board link works without signing in. */
export async function publicBoard(token: string) {
  if (!/^[0-9a-f]{24}$/.test(token)) return null;
  const br = await withAnonTx(async (c) => (await c.query("SELECT id, code, name_en FROM branch WHERE board_token = $1 AND active", [token])).rows[0]);
  if (!br) return null;
  return withBranchSystemTx(br.id, async (c) => ({ ...(await boardRows(c, br.id)), branch: br }));
}

export async function newBoardLink(ctx: Ctx) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  if (!can(ctx, "settings", "edit", b) && !can(ctx, "workshop", "edit", b)) throw forbidden();
  return withTx(ctx, async (c) => {
    await c.query("UPDATE branch SET board_token = encode(gen_random_bytes(12), 'hex') WHERE id = $1", [b]);
    await audit(c, ctx, "branch", b, "board_link_changed", {}, b);
  });
}

export const minutesText = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export { D };
