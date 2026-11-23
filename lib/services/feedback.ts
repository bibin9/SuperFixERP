import { randomBytes } from "node:crypto";
import { Ctx, assertCan, canAnywhere } from "../access";
import { withTx, withAnonTx, withBranchSystemTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { optStr } from "../validate";
import { prepareMessage } from "./messaging";

/** Customer feedback after delivery: a rating link on WhatsApp; ratings of 1 or 2 are followed up. */

export async function askFeedback(ctx: Ctx, jobId: string, origin: string) {
  const token = await withTx(ctx, async (c) => {
    const j = (await c.query("SELECT id, branch_id, status, doc_no FROM job_card WHERE id = $1", [jobId])).rows[0];
    if (!j) throw notFound("Job card");
    assertCan(ctx, "jobs", "edit", j.branch_id);
    if (!["delivered", "invoiced", "closed"].includes(j.status)) throw invalid("Ask for feedback after the car is handed over.");
    const old = (await c.query("SELECT token, rating FROM job_feedback WHERE job_card_id = $1", [jobId])).rows[0];
    if (old?.rating) throw invalid("The customer has already rated this job.");
    if (old) { await c.query("UPDATE job_feedback SET asked_at = now(), asked_by = $2 WHERE job_card_id = $1", [jobId, ctx.userId]); return old.token as string; }
    const t = randomBytes(24).toString("base64url");
    await c.query("INSERT INTO job_feedback (branch_id, job_card_id, token, asked_by) VALUES ($1,$2,$3,$4)", [j.branch_id, jobId, t, ctx.userId]);
    await audit(c, ctx, "job_card", jobId, "feedback_asked", {}, j.branch_id);
    return t;
  });
  return prepareMessage(ctx, { jobId }, "feedback", { link: `${origin}/f/${token}` });
}

async function branchFor(token: string) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  return withAnonTx(async (c) => (await c.query("SELECT feedback_branch_by_token($1) b", [token])).rows[0].b as string | null);
}

export async function getPublicFeedback(token: string) {
  const b = await branchFor(token);
  if (!b) return null;
  return withBranchSystemTx(b, async (c) => (await c.query(
    `SELECT f.rating, f.comment, j.doc_no, br.name_en branch_name, br.name_ar branch_name_ar, br.phone branch_phone, v.make, v.model, c.customer_type, c.title, c.first_name, c.company_name, c.name_ar
       FROM job_feedback f JOIN job_card j ON j.id = f.job_card_id JOIN branch br ON br.id = f.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id
      WHERE f.token = $1`, [token])).rows[0] ?? null);
}

export async function submitFeedback(token: string, rating: unknown, comment: unknown) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw invalid("Choose from 1 to 5 stars.");
  const text = optStr(comment);
  if (text && text.length > 1000) throw invalid("Please keep the comment under 1,000 characters.");
  const b = await branchFor(token);
  if (!b) throw notFound("Feedback");
  return withBranchSystemTx(b, async (c) => {
    const u = await c.query("UPDATE job_feedback SET rating = $2, comment = $3, answered_at = now() WHERE token = $1 AND rating IS NULL RETURNING id", [token, r, text]);
    if (!u.rowCount) throw invalid("Thank you, your rating was already received.");
  });
}

export async function listFeedback(ctx: Ctx, filter = "") {
  if (!canAnywhere(ctx, "jobs", "view")) throw forbidden();
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT f.*, j.doc_no, b.code branch_code, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, u.full_name followed_by_name
         FROM job_feedback f JOIN job_card j ON j.id = f.job_card_id JOIN branch b ON b.id = f.branch_id JOIN customer c ON c.id = j.customer_id
         LEFT JOIN app_user u ON u.id = f.followed_up_by
        WHERE ($1 = '' OR ($1 = 'low' AND f.rating <= 2 AND f.followed_up_at IS NULL) OR ($1 = 'waiting' AND f.rating IS NULL))
        ORDER BY coalesce(f.answered_at, f.asked_at) DESC LIMIT 300`, [filter])).rows;
    const s = (await c.query(
      `SELECT count(*) FILTER (WHERE rating IS NOT NULL)::int answered, count(*)::int asked, round(avg(rating), 2) avg,
              count(*) FILTER (WHERE rating <= 2 AND followed_up_at IS NULL)::int low_open, count(*) FILTER (WHERE rating IS NULL)::int waiting FROM job_feedback`)).rows[0];
    return { rows, stats: s };
  });
}

export async function followUpFeedback(ctx: Ctx, id: string, note: unknown) {
  const n = optStr(note);
  if (!n) throw invalid("Write what was done for the customer.", { field: "note" });
  return withTx(ctx, async (c) => {
    const f = (await c.query("SELECT * FROM job_feedback WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!f) throw notFound("Feedback");
    assertCan(ctx, "jobs", "edit", f.branch_id);
    if (f.rating === null) throw invalid("The customer has not rated yet.");
    await c.query("UPDATE job_feedback SET followed_up_at = now(), followed_up_by = $2, follow_up_note = $3 WHERE id = $1", [id, ctx.userId, n]);
    await audit(c, ctx, "job_card", f.job_card_id, "feedback_followed_up", { note: n }, f.branch_id);
  });
}
