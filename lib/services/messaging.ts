import { Ctx, assertCan } from "../access";
import { withTx } from "../db";
import { invalid, notFound } from "../errors";
import { displayName } from "./customers";

/** M15 manual WhatsApp (WA-02): builds the message from the template and a wa.me link; logs "button used". */

export function render(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function waLink(mobile: string, text: string) {
  return `https://wa.me/${mobile.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}

export async function whatsappForJob(ctx: Ctx, jobId: string, event: string, extra: Record<string, string> = {}) {
  return withTx(ctx, async (c) => {
    const j = await c.query(
      `SELECT j.*, b.name_en branch, v.plate_code, v.plate_number, v.registered_in, c.id cid, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile, c.whatsapp
         FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id WHERE j.id = $1`, [jobId]);
    if (!j.rowCount) throw notFound("Job card");
    const job = j.rows[0];
    assertCan(ctx, "jobs", "edit", job.branch_id);
    const lang = ctx.language === "ar" ? "ar" : "en";
    const t = await c.query("SELECT body FROM message_template WHERE event = $1 AND active ORDER BY (language = $2) DESC LIMIT 1", [event, lang]);
    if (!t.rowCount) throw invalid(`No message template for ${event}.`);
    const name = job.customer_type === "individual" ? job.first_name : job.company_name;
    const vars = { title: job.customer_type === "individual" ? job.title : "M/s.", name, plate: `${job.registered_in} ${job.plate_code ?? ""} ${job.plate_number}`.replace(/\s+/g, " "), job_no: job.doc_no, branch: job.branch, ...extra };
    const text = render(t.rows[0].body, vars);
    await c.query("INSERT INTO message_log (branch_id, customer_id, job_card_id, event, body, user_id) VALUES ($1,$2,$3,$4,$5,$6)", [job.branch_id, job.cid, jobId, event, text, ctx.userId]);
    return { url: waLink(job.mobile, text), text, to: displayName(job) };
  });
}
