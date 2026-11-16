import { Ctx, assertCan } from "../access";
import { withTx } from "../db";
import { invalid, notFound } from "../errors";
import { displayName } from "./customers";

/**
 * M15 customer messages, manual only (FSD v0.10). The system prepares the text from the template
 * and a click-to-chat link. Staff open WhatsApp (or copy the text) and send it themselves, then
 * press "Mark as sent". Nothing is ever sent automatically and no messaging API is called.
 */

export function render(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function waLink(mobile: string, text: string) {
  return `https://wa.me/${mobile.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(text)}`;
}

type Target = { jobId: string } | { enquiryId: string };

/** Prepares a message and logs it as Prepared. Returns the log id for the confirm step. */
export async function prepareMessage(ctx: Ctx, target: Target, event: string, extra: Record<string, string> = {}) {
  return withTx(ctx, async (c) => {
    const isJob = "jobId" in target;
    const r = await c.query(
      `SELECT d.id, d.doc_no, d.branch_id, ${isJob ? "d.id" : "NULL::uuid"} job_id, ${isJob ? "d.enquiry_id" : "d.id"} enquiry_id,
              b.name_en branch, v.plate_code, v.plate_number, v.registered_in, c.id cid, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, c.whatsapp
         FROM ${isJob ? "job_card" : "enquiry"} d JOIN branch b ON b.id = d.branch_id JOIN vehicle v ON v.id = d.vehicle_id JOIN customer c ON c.id = d.customer_id
        WHERE d.id = $1`, [isJob ? target.jobId : target.enquiryId]);
    if (!r.rowCount) throw notFound(isJob ? "Job card" : "Enquiry");
    const d = r.rows[0];
    assertCan(ctx, isJob ? "jobs" : "customers", "edit", d.branch_id);
    const lang = ctx.language === "ar" ? "ar" : "en";
    const t = await c.query("SELECT body FROM message_template WHERE event = $1 AND active ORDER BY (language = $2) DESC LIMIT 1", [event, lang]);
    if (!t.rowCount) throw invalid(`No active message template for ${event}. Add one under Masters, Message templates.`);
    const name = d.customer_type === "individual" ? d.first_name : d.company_name;
    const vars = {
      title: d.customer_type === "individual" ? d.title : "M/s.", name, plate: `${d.registered_in} ${d.plate_code ?? ""} ${d.plate_number}`.replace(/\s+/g, " "),
      job_no: d.doc_no, branch: d.branch, ...extra,
    };
    const text = render(t.rows[0].body, vars);
    const mobile = String(d.mobile);
    const log = await c.query(
      "INSERT INTO message_log (branch_id, customer_id, job_card_id, enquiry_id, event, body, to_mobile, user_id, mode, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual','prepared') RETURNING id",
      [d.branch_id, d.cid, d.job_id, d.enquiry_id, event, text, mobile, ctx.userId]);
    return { id: String(log.rows[0].id), url: waLink(mobile, text), text, to: displayName(d) };
  });
}

/** Back-compatible helper for job card messages. */
export const whatsappForJob = (ctx: Ctx, jobId: string, event: string, extra: Record<string, string> = {}) => prepareMessage(ctx, { jobId }, event, extra);

export async function getMessage(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await c.query("SELECT * FROM message_log WHERE id = $1", [id]);
    if (!r.rowCount) return null;
    const m = r.rows[0];
    return { ...m, id: String(m.id), url: waLink(m.to_mobile ?? "", m.body) };
  });
}

/** Staff confirm they sent the prepared message themselves. */
export async function confirmMessageSent(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await c.query("SELECT * FROM message_log WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rowCount) throw notFound("Message");
    const m = r.rows[0];
    assertCan(ctx, m.job_card_id ? "jobs" : "customers", "edit", m.branch_id);
    if (m.status === "sent_manually") return;
    await c.query("UPDATE message_log SET status = 'sent_manually', confirmed_at = now(), confirmed_by = $2 WHERE id = $1", [id, ctx.userId]);
  });
}

export async function messagesFor(ctx: Ctx, target: Target) {
  return withTx(ctx, async (c) => (await c.query(
    `SELECT m.id::text, m.event, m.status, m.at, m.confirmed_at, u.full_name FROM message_log m LEFT JOIN app_user u ON u.id = m.user_id
      WHERE ${"jobId" in target ? "m.job_card_id" : "m.enquiry_id"} = $1 ORDER BY m.at DESC LIMIT 20`, ["jobId" in target ? target.jobId : target.enquiryId])).rows);
}
