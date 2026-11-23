import type { PoolClient } from "pg";
import { Ctx, assertCan, redact } from "../access";
import { withTx, withBranchSystemTx } from "../db";
import { forbidden, notFound } from "../errors";
import { getSetting } from "./settings";
import { getJob, QLINE_FIELDS, Q_FIELDS } from "./jobs";
import { getEnquiry } from "./enquiries";
import { printLang, type PrintLang } from "../print-text";

/**
 * OT-08: printed documents in English and Arabic. The admin sets the language (both, en, ar) and the
 * terms at the foot of each document under Settings, Printing; a branch setting overrides the company one.
 */
export type DocKind = "invoice" | "quotation" | "job_card" | "receipt" | "credit_note";
export type PrintSetup = {
  lang: PrintLang; terms: { en: string; ar: string };
  company: { name_en: string; name_ar: string; trn: string };
  branch: { name_en: string; name_ar: string | null; address: string | null; emirate: string; phone: string | null };
};

async function setupIn(c: PoolClient, branchId: string, kind: DocKind): Promise<PrintSetup> {
  const co = (await c.query("SELECT legal_name_en, legal_name_ar, trn FROM company LIMIT 1")).rows[0];
  const b = (await c.query("SELECT name_en, name_ar, address, emirate, phone FROM branch WHERE id = $1", [branchId])).rows[0];
  return {
    lang: printLang(await getSetting(c, "print.language", branchId, "both")),
    terms: { en: String(await getSetting(c, `print.terms_${kind}_en`, branchId, "")), ar: String(await getSetting(c, `print.terms_${kind}_ar`, branchId, "")) },
    company: { name_en: co.legal_name_en, name_ar: co.legal_name_ar, trn: co.trn }, branch: b,
  };
}

/** Arabic names of the parts and services on document lines, by job line or item id. */
async function arabicNamesIn(c: PoolClient, jobLineIds: string[], itemIds: string[]) {
  const out: Record<string, string> = {};
  if (jobLineIds.length) for (const r of (await c.query(
    `SELECT l.id, coalesce(i.name_ar, s.name_ar) ar FROM job_line l LEFT JOIN item i ON i.id = l.item_id LEFT JOIN service s ON s.id = l.service_id
      WHERE l.id = ANY($1::uuid[])`, [jobLineIds])).rows) if (r.ar) out[r.id] = r.ar;
  if (itemIds.length) for (const r of (await c.query("SELECT id, name_ar FROM item WHERE id = ANY($1::uuid[]) AND name_ar IS NOT NULL", [itemIds])).rows) out[r.id] = r.name_ar;
  return out;
}

/**
 * For the invoice, which is also printed from the customer's share link: the caller has already
 * checked access to the invoice, so this reads only the shared print settings and the line names.
 */
export async function invoicePrintSetup(branchId: string, lines: { job_line_id?: string | null; item_id?: string | null }[], kind: DocKind = "invoice") {
  return withBranchSystemTx(branchId, async (c) => {
    const names = await arabicNamesIn(c, lines.map((l) => l.job_line_id).filter(Boolean) as string[], lines.map((l) => l.item_id).filter(Boolean) as string[]);
    return { setup: await setupIn(c, branchId, kind), names };
  });
}

export async function quotationPrint(ctx: Ctx, quotationId: string) {
  const head = await withTx(ctx, async (c) => (await c.query("SELECT enquiry_id, job_card_id FROM quotation WHERE id = $1", [quotationId])).rows[0]);
  if (!head) throw notFound("Quotation");
  // Reading the enquiry or job card checks access to it and hides fields the user may not see.
  const owner = head.job_card_id ? await getJob(ctx, head.job_card_id) : await getEnquiry(ctx, head.enquiry_id);
  if (!owner.canSeePrices) throw forbidden();
  return withTx(ctx, async (c) => {
    const q = (await c.query(
      `SELECT q.*, coalesce(e.customer_id, j.customer_id) customer_id, coalesce(e.vehicle_id, j.vehicle_id) vehicle_id FROM quotation q
         LEFT JOIN enquiry e ON e.id = q.enquiry_id LEFT JOIN job_card j ON j.id = q.job_card_id WHERE q.id = $1`, [quotationId])).rows[0];
    const lines = (await c.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [quotationId])).rows;
    const cust = (await c.query("SELECT customer_type, title, first_name, last_name, company_name, name_ar, mobile, trn FROM customer WHERE id = $1", [q.customer_id])).rows[0];
    const veh = q.vehicle_id ? (await c.query("SELECT make, model, model_year, registered_in, plate_code, plate_number, vin FROM vehicle WHERE id = $1", [q.vehicle_id])).rows[0] : null;
    const names = await arabicNamesIn(c, lines.map((l) => l.job_line_id).filter(Boolean), []);
    const b = q.branch_id as string;
    return { q: redact(ctx, [q], Q_FIELDS, () => b)[0], lines: redact(ctx, lines, QLINE_FIELDS, () => b), cust, veh, names, setup: await setupIn(c, b, "quotation") };
  });
}

export async function jobCardPrint(ctx: Ctx, jobId: string) {
  const j = await getJob(ctx, jobId);
  return withTx(ctx, async (c) => {
    const cust = (await c.query("SELECT name_ar FROM customer WHERE id = $1", [j.job.customer_id])).rows[0];
    const names = await arabicNamesIn(c, j.lines.map((l) => l.id as string), []);
    return { job: { ...j.job, customer_name_ar: cust?.name_ar }, lines: j.lines.filter((l) => l.approval_status !== "declined"), names, setup: await setupIn(c, j.job.branch_id, "job_card") };
  });
}

export async function receiptPrint(ctx: Ctx, receiptId: string) {
  return withTx(ctx, async (c) => {
    const r = (await c.query(
      `SELECT r.*, pm.name method_name, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.name_ar customer_name_ar, c.mobile, c.trn customer_trn,
              j.doc_no job_no
         FROM receipt r JOIN customer c ON c.id = r.customer_id LEFT JOIN payment_method pm ON pm.code = r.method LEFT JOIN job_card j ON j.id = r.job_card_id
        WHERE r.id = $1`, [receiptId])).rows[0];
    if (!r) throw notFound("Receipt");
    assertCan(ctx, "invoices", "view", r.branch_id);
    const allocations = (await c.query(
      `SELECT i.doc_no, ra.amount, ra.reversed FROM receipt_allocation ra JOIN sales_invoice i ON i.id = ra.invoice_id WHERE ra.receipt_id = $1 ORDER BY ra.at`, [receiptId])).rows;
    return { r, allocations, setup: await setupIn(c, r.branch_id, "receipt") };
  });
}
