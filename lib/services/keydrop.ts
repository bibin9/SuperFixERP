import crypto from "node:crypto";
import { Ctx, assertCan, can } from "../access";
import { withTx, withAnonTx, withBranchSystemTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { str, optStr, normaliseMobile } from "../validate";
import { audit } from "./audit";
import { saveAttachment, type Upload } from "./purchasing";
import { createEnquiry } from "./enquiries";

/**
 * After-hours key drop. The QR code on the key box opens a short web form on the customer's phone (no app,
 * no sign-in); the advisor completes the check-in next morning, which starts an enquiry with the details.
 */
export async function keydropBranch(code: string) {
  if (!code || code.length < 32) return null;
  return withAnonTx(async (c) => (await c.query("SELECT * FROM keydrop_branch_by_code($1)", [code])).rows[0] as { id: string; code: string; name_en: string; phone: string | null } | undefined ?? null);
}

export async function keydropOptions(branchId: string) {
  return withBranchSystemTx(branchId, async (c) => ({
    plates: (await c.query("SELECT code, name FROM plate_template WHERE active AND country_code = 'AE' ORDER BY name")).rows as { code: string; name: string }[],
  }));
}

const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export async function submitKeyDrop(code: string, f: Record<string, unknown>, photos: Upload[]) {
  const b = await keydropBranch(code);
  if (!b) throw notFound("Key drop");
  const name = str(f.name);
  if (name.length < 2) throw invalid("Your name is required.", { field: "name" });
  if (name.length > 120) throw invalid("Name is too long.", { field: "name" });
  const plate = str(f.plate_number).toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(plate)) throw invalid("Plate number: letters and numbers only.", { field: "plate_number" });
  const service = str(f.service_asked);
  if (!service) throw invalid("Tell us what you need.", { field: "service_asked" });
  if (str(f.agree) !== "1") throw invalid("Please tick that you agree, so we can look at the car.", { field: "agree" });
  const sig = str(f.signature);
  if (!sig) throw invalid("Please sign in the box.", { field: "signature" });
  if (!PNG.test(sig) || sig.length > 400000) throw invalid("The signature could not be read. Sign again.", { field: "signature" });
  const odo = str(f.odometer).replace(/[,\s]/g, "");
  if (odo && !/^\d{1,7}$/.test(odo)) throw invalid("Odometer: numbers only.", { field: "odometer" });
  if (photos.length > 3) throw invalid("Add at most 3 photos.");
  return withBranchSystemTx(b.id, async (c) => {
    const country = (await c.query("SELECT dial_code, mobile_regex, name FROM country WHERE code = 'AE'")).rows[0];
    let mobile: string;
    try { mobile = normaliseMobile(f.mobile, country); } catch { throw invalid("Mobile number is not valid. Type it like 050 123 4567.", { field: "mobile" }); }
    // A key box is not a public inbox: at most 25 waiting key drops per branch.
    if (Number((await c.query("SELECT count(*) n FROM key_drop WHERE branch_id = $1 AND status = 'waiting'", [b.id])).rows[0].n) >= 25) throw invalid("The key box is full. Please call the branch.");
    const reg = optStr(f.registered_in);
    if (reg && !(await c.query("SELECT 1 FROM plate_template WHERE code = $1 AND active", [reg])).rowCount) throw invalid("Choose where the car is registered.", { field: "registered_in" });
    const n = Number((await c.query("SELECT count(*) n FROM key_drop WHERE branch_id = $1", [b.id])).rows[0].n) + 1;
    const docNo = `KD-${b.code}-${String(n).padStart(4, "0")}`;
    const id = (await c.query(
      `INSERT INTO key_drop (branch_id, doc_no, title, name, mobile, registered_in, plate_code, plate_number, make_model, odometer, service_asked, complaints, valuables, key_slot, signature, agreed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) RETURNING id`,
      [b.id, docNo, optStr(f.title)?.slice(0, 10) ?? null, name, mobile, reg, optStr(f.plate_code)?.toUpperCase().slice(0, 5) ?? null, plate, optStr(f.make_model)?.slice(0, 80) ?? null,
        odo ? Number(odo) : null, service.slice(0, 300), optStr(f.complaints)?.slice(0, 2000) ?? null, optStr(f.valuables)?.slice(0, 300) ?? null, optStr(f.key_slot)?.slice(0, 10) ?? null, sig])).rows[0].id;
    for (const p of photos) await saveAttachment(c, { userId: null } as unknown as Ctx, b.id, "key_drop", id, p);
    return { docNo, name: `${optStr(f.title) ? `${str(f.title)} ` : ""}${name}`, branch: b.name_en };
  });
}

export async function listKeyDrops(ctx: Ctx, all = false) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "customers", "view", b);
  return withTx(ctx, async (c) => (await c.query(
    `SELECT k.id, k.doc_no, k.title, k.name, k.mobile, k.registered_in, k.plate_code, k.plate_number, k.make_model, k.service_asked, k.key_slot, k.status,
            to_char(k.created_at AT TIME ZONE 'Asia/Dubai', 'Dy DD Mon HH24:MI') at, e.doc_no enquiry_no, k.enquiry_id,
            (SELECT count(*)::int FROM attachment a WHERE a.entity = 'key_drop' AND a.entity_id = k.id) photos
       FROM key_drop k LEFT JOIN enquiry e ON e.id = k.enquiry_id
      WHERE k.branch_id = $1 AND ($2 OR k.status = 'waiting' OR k.done_at > now() - interval '2 days') ORDER BY k.status = 'waiting' DESC, k.created_at DESC LIMIT 100`, [b, all])).rows);
}

export async function getKeyDrop(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const k = (await c.query(
      `SELECT k.*, to_char(k.created_at AT TIME ZONE 'Asia/Dubai', 'Dy DD Mon YYYY HH24:MI') at, e.doc_no enquiry_no, u.full_name done_by_name
         FROM key_drop k LEFT JOIN enquiry e ON e.id = k.enquiry_id LEFT JOIN app_user u ON u.id = k.done_by WHERE k.id = $1`, [id])).rows[0];
    if (!k) throw notFound("Key drop");
    assertCan(ctx, "customers", "view", k.branch_id);
    const photos = (await c.query("SELECT id, file_name FROM attachment WHERE entity = 'key_drop' AND entity_id = $1 ORDER BY uploaded_at", [id])).rows;
    // Match the customer by mobile and the car by plate, so the advisor does not type them again.
    const customers = (await c.query(
      `SELECT id, customer_no, coalesce(company_name, trim(coalesce(title,'') || ' ' || first_name || ' ' || coalesce(last_name,''))) name FROM customer WHERE mobile = $1 ORDER BY created_at LIMIT 5`, [k.mobile])).rows;
    const vehicles = (await c.query(
      `SELECT v.id, v.make, v.model, v.model_year, v.registered_in, v.plate_code, v.plate_number, v.owner_customer_id FROM vehicle v
        WHERE upper(v.plate_number) = $1 AND ($2::text IS NULL OR v.registered_in = $2) AND ($3::text IS NULL OR upper(coalesce(v.plate_code,'')) = $3) LIMIT 5`,
      [k.plate_number, k.registered_in, k.plate_code])).rows;
    return { k, photos, customers, vehicles };
  });
}

/** Completes the check-in: starts the enquiry with the customer's own words, odometer and valuables. */
export async function completeKeyDrop(ctx: Ctx, id: string, f: { customer_id: string; vehicle_id: string }) {
  const k = await withTx(ctx, async (c) => (await c.query("SELECT * FROM key_drop WHERE id = $1", [id])).rows[0]);
  if (!k) throw notFound("Key drop");
  if (k.branch_id !== ctx.currentBranchId) throw forbidden("Switch to the key drop's branch first.");
  if (k.status !== "waiting") throw invalid("This key drop is already done.");
  if (!str(f.customer_id)) throw invalid("Choose the customer, or add them first.", { field: "customer_id" });
  if (!str(f.vehicle_id)) throw invalid("Choose the car, or add it first.", { field: "vehicle_id" });
  const tomorrow = new Date(Date.now() + 2 * 3600_000).toLocaleString("sv-SE", { timeZone: "Asia/Dubai" }).slice(0, 16).replace(" ", "T");
  const e = await createEnquiry(ctx, {
    customer_id: f.customer_id, vehicle_id: f.vehicle_id, source: "other", follow_up_at: tomorrow,
    service_asked: k.service_asked, complaints: k.complaints ?? k.service_asked, odometer_in: k.odometer ?? undefined, valuables: k.valuables ?? undefined,
    notes: `After-hours key drop ${k.doc_no}${k.key_slot ? `, key in slot ${k.key_slot}` : ""}. Signed by the customer on the phone form.`,
  });
  await withTx(ctx, async (c) => {
    const r = await c.query("UPDATE key_drop SET status = 'checked_in', enquiry_id = $2, done_by = $3, done_at = now() WHERE id = $1 AND status = 'waiting'", [id, e.id, ctx.userId]);
    if (!r.rowCount) throw invalid("This key drop is already done.");
    await audit(c, ctx, "key_drop", id, "checked_in", { enquiry: e.docNo }, k.branch_id);
  });
  return e;
}

export async function cancelKeyDrop(ctx: Ctx, id: string, reason: string) {
  if (!str(reason)) throw invalid("Say why it is cancelled.", { field: "reason" });
  return withTx(ctx, async (c) => {
    const k = (await c.query("SELECT id, branch_id, status FROM key_drop WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!k) throw notFound("Key drop");
    if (!can(ctx, "customers", "edit", k.branch_id)) throw forbidden();
    if (k.status !== "waiting") throw invalid("This key drop is already done.");
    await c.query("UPDATE key_drop SET status = 'cancelled', cancel_reason = $2, done_by = $3, done_at = now() WHERE id = $1", [id, str(reason).slice(0, 300), ctx.userId]);
    await audit(c, ctx, "key_drop", id, "cancelled", { reason: str(reason) }, k.branch_id);
  });
}

export async function keydropCode(ctx: Ctx) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "customers", "view", b);
  return withTx(ctx, async (c) => (await c.query("SELECT code, name_en, keydrop_code FROM branch WHERE id = $1", [b])).rows[0] as { code: string; name_en: string; keydrop_code: string });
}

/** A new QR code for the key box (if a photo of it was shared): the old one stops working. */
export async function newKeydropCode(ctx: Ctx) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  if (!can(ctx, "settings", "edit", b) && !can(ctx, "workshop", "edit", b)) throw forbidden();
  await withTx(ctx, async (c) => {
    // SEC-06: the code in the QR link comes from a cryptographic random source (not the database's random()).
    await c.query("UPDATE branch SET keydrop_code = $2 WHERE id = $1", [b, crypto.randomBytes(32).toString("hex")]);
    await audit(c, ctx, "branch", b, "keydrop_code_changed", {}, b);
  });
}
