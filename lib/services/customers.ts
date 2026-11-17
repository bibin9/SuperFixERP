import type { PoolClient } from "pg";
import { Ctx, assertCan, canSee } from "../access";
import { withTx } from "../db";
import { invalid, notFound, conflict } from "../errors";
import { audit, diff } from "./audit";
import { normaliseMobile, normaliseVin, normaliseTrn, normaliseEmiratesId, optStr, required, str, optInt } from "../validate";

/** M02. Customers and vehicles are shared by every branch (CV-12). */

export type Duplicate = { kind: "mobile" | "vin" | "plate"; id: string; label: string };

async function country(c: PoolClient, code: string) {
  const r = await c.query("SELECT * FROM country WHERE code = $1", [code]);
  if (!r.rowCount) throw invalid("Choose a country.");
  return r.rows[0];
}

export async function listCustomers(ctx: Ctx, q = "") {
  assertCan(ctx, "customers", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT id, customer_no, customer_type, is_walk_in, title, first_name, last_name, company_name, mobile, email,
            (SELECT count(*) FROM vehicle v WHERE v.owner_customer_id = customer.id) vehicles
       FROM customer WHERE active AND ($1 = '' OR customer_no ILIKE '%'||$1||'%' OR first_name ILIKE '%'||$1||'%' OR last_name ILIKE '%'||$1||'%'
             OR company_name ILIKE '%'||$1||'%' OR (regexp_replace($1,'\\D','','g') <> '' AND mobile LIKE '%'||regexp_replace($1,'\\D','','g')||'%'))
      ORDER BY created_at DESC LIMIT 100`, [q.trim()],
  )).rows);
}

export const displayName = (r: { customer_type: string; title?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }) =>
  r.customer_type === "individual" ? [r.title, r.first_name, r.last_name].filter(Boolean).join(" ") : `M/s. ${r.company_name}`;

export async function getCustomer(ctx: Ctx, id: string) {
  assertCan(ctx, "customers", "view");
  return withTx(ctx, async (c) => {
    const r = await c.query("SELECT * FROM customer WHERE id = $1", [id]);
    if (!r.rowCount) throw notFound("Customer");
    const vehicles = (await c.query("SELECT * FROM vehicle WHERE owner_customer_id = $1 AND active ORDER BY created_at", [id])).rows;
    const consents = (await c.query("SELECT * FROM consent_log WHERE customer_id = $1 ORDER BY at DESC", [id])).rows;
    return { customer: r.rows[0], vehicles, consents };
  });
}

/** CV-08 duplicate check across all branches: mobile, VIN, plate. */
export async function findDuplicates(c: PoolClient, f: { mobile?: string | null; vin?: string | null; plateKey?: string | null; excludeCustomer?: string; excludeVehicle?: string }) {
  const out: Duplicate[] = [];
  if (f.mobile) {
    for (const r of (await c.query("SELECT * FROM customer WHERE mobile = $1 AND active AND id IS DISTINCT FROM $2", [f.mobile, f.excludeCustomer ?? null])).rows)
      out.push({ kind: "mobile", id: r.id, label: `${r.customer_no} ${displayName(r)} (${r.mobile})` });
  }
  if (f.vin) {
    for (const r of (await c.query("SELECT * FROM vehicle WHERE vin = $1 AND id IS DISTINCT FROM $2", [f.vin, f.excludeVehicle ?? null])).rows)
      out.push({ kind: "vin", id: r.id, label: `${r.make} ${r.model} ${r.registered_in} ${r.plate_code ?? ""} ${r.plate_number} VIN ${r.vin}` });
  }
  if (f.plateKey) {
    for (const r of (await c.query("SELECT * FROM vehicle WHERE plate_key = $1 AND active AND id IS DISTINCT FROM $2", [f.plateKey, f.excludeVehicle ?? null])).rows)
      out.push({ kind: "plate", id: r.id, label: `${r.make} ${r.model} ${r.registered_in} ${r.plate_code ?? ""} ${r.plate_number}` });
  }
  return out;
}

export type CustomerInput = Record<string, unknown>;

async function buildCustomer(c: PoolClient, f: CustomerInput) {
  const type = required(f.customer_type, "Customer type");
  if (!["individual", "corporate", "government"].includes(type)) throw invalid("Unknown customer type.");
  const ctry = await country(c, required(f.country_code, "Country"));
  const mobile = normaliseMobile(required(f.mobile, "Mobile"), ctry);
  const row: Record<string, unknown> = {
    customer_type: type,
    title: type === "individual" ? required(f.title, "Title") : null,
    first_name: type === "individual" ? required(f.first_name, "First name") : null,
    last_name: type === "individual" ? optStr(f.last_name) : null,
    company_name: type === "individual" ? null : required(f.company_name, "Company name"),
    name_ar: optStr(f.name_ar),
    country_code: ctry.code,
    mobile,
    whatsapp: f.whatsapp_shown === "1" ? f.whatsapp === "on" : f.whatsapp === undefined ? true : f.whatsapp === "on" || f.whatsapp === true || f.whatsapp === "true",
    email: optStr(f.email),
    id_type: optStr(f.id_type),
    id_number: optStr(f.id_number),
    nationality: optStr(f.nationality),
    trn: normaliseTrn(f.trn),
    address: optStr(f.address),
    price_level: str(f.price_level) || "retail",
    // E-invoicing details of a business buyer (PINT AE): Peppol ID, trade licence, structured address, contact.
    peppol_id: type === "individual" ? null : optStr(String(f.peppol_id ?? "").replace(/\s/g, "")),
    trade_licence_no: type === "individual" ? null : optStr(f.trade_licence_no),
    licence_authority: type === "individual" ? null : optStr(f.licence_authority),
    building_street: optStr(f.building_street),
    city: optStr(f.city),
    emirate: optStr(f.emirate),
    po_box: optStr(f.po_box),
    contact_person: type === "individual" ? null : optStr(f.contact_person),
    contact_phone: type === "individual" ? null : optStr(String(f.contact_phone ?? "").replace(/[\s\-()]/g, "")),
    preferred_channel: str(f.preferred_channel) || "whatsapp",
    marketing_consent: f.marketing_consent === "on" || f.marketing_consent === true || f.marketing_consent === "true",
    credit_limit: str(f.credit_limit) || "0",
    payment_terms_days: optInt(f.payment_terms_days, "Payment terms", 0, 365) ?? 0,
    fleet_discount_pct: str(f.fleet_discount_pct) || "0",
    lpo_required: f.lpo_required === "on" || f.lpo_required === true,
    consolidated_invoice: f.consolidated_invoice === "on" || f.consolidated_invoice === true,
  };
  const level = (await c.query("SELECT 1 FROM lookup_value WHERE list = 'price_level' AND code = $1 AND active", [row.price_level])).rowCount;
  if (!level) throw invalid("Choose a price level from the list (Master forms, Pick lists, price level).");
  if (row.peppol_id && !/^[0-9]{4}:[A-Za-z0-9.\-]{1,50}$/.test(String(row.peppol_id))) throw invalid("Peppol ID is the scheme and the ID, for example 0235:100234567800003.");
  if (row.contact_phone && !/^\+?[0-9]{7,15}$/.test(String(row.contact_phone))) throw invalid("Contact phone is not a valid number.");
  for (const [k, list, lab] of [["licence_authority", "licence_authority", "Licence authority"], ["emirate", "emirate", "Emirate"]] as const)
    if (row[k] && !(await c.query("SELECT 1 FROM lookup_value WHERE list = $1 AND code = $2", [list, row[k]])).rowCount) throw invalid(`${lab}: choose from the list.`);
  if (row.id_type && !ctry.id_types.includes(row.id_type)) throw invalid(`ID type ${row.id_type} is not used for ${ctry.name}.`);
  if (row.id_type === "Emirates ID" && row.id_number) row.id_number = normaliseEmiratesId(row.id_number);
  if (!/^\d+(\.\d{1,2})?$/.test(String(row.credit_limit))) throw invalid("Credit limit must be an amount.");
  if (!/^\d+(\.\d{1,4})?$/.test(String(row.fleet_discount_pct)) || Number(row.fleet_discount_pct) > 100) throw invalid("Fleet discount must be between 0 and 100.");
  return row;
}

/**
 * Creates a customer. A mobile match returns the duplicates unless a reason is given
 * ("Save as new with reason", CV-08).
 */
export async function createCustomer(ctx: Ctx, f: CustomerInput): Promise<{ id?: string; duplicates?: Duplicate[] }> {
  assertCan(ctx, "customers", "create");
  return withTx(ctx, async (c) => {
    const row = await buildCustomer(c, f);
    const reason = optStr(f.duplicate_reason);
    const dups = await findDuplicates(c, { mobile: row.mobile as string });
    if (dups.length && !reason) return { duplicates: dups };
    row.duplicate_reason = dups.length ? reason : null;
    row.preferred_branch_id = ctx.currentBranchId;
    if (row.marketing_consent) { row.consent_at = new Date(); row.consent_channel = optStr(f.consent_channel) || "in_person"; }
    const cols = Object.keys(row);
    const r = await c.query(
      `INSERT INTO customer (${cols.join(",")}, created_by, updated_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}, $${cols.length + 1}, $${cols.length + 1}) RETURNING id`,
      [...cols.map((k) => row[k]), ctx.userId],
    );
    const id = r.rows[0].id;
    await c.query("INSERT INTO consent_log (customer_id, consent, channel, user_id) VALUES ($1,$2,$3,$4)", [id, row.marketing_consent, row.consent_channel ?? "in_person", ctx.userId]);
    await audit(c, ctx, "customer", id, "create", { mobile: row.mobile, duplicate_reason: row.duplicate_reason });
    return { id };
  });
}

export async function updateCustomer(ctx: Ctx, id: string, f: CustomerInput) {
  assertCan(ctx, "customers", "edit");
  return withTx(ctx, async (c) => {
    const cur = await c.query("SELECT * FROM customer WHERE id = $1 FOR UPDATE", [id]);
    if (!cur.rowCount) throw notFound("Customer");
    const before = cur.rows[0];
    if (Number(f.version) !== before.version) throw conflict();
    const row = await buildCustomer(c, f);
    if (row.mobile !== before.mobile) {
      const dups = await findDuplicates(c, { mobile: row.mobile as string, excludeCustomer: id });
      if (dups.length && !optStr(f.duplicate_reason)) return { duplicates: dups };
    }
    const changes = diff(before, row);
    const cols = Object.keys(row);
    await c.query(
      `UPDATE customer SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now(), updated_by = $${cols.length + 2}, version = version + 1 WHERE id = $1`,
      [id, ...cols.map((k) => row[k]), ctx.userId],
    );
    if (row.marketing_consent !== before.marketing_consent) {
      const ch = optStr(f.consent_channel) || "in_person";
      await c.query("UPDATE customer SET consent_at = now(), consent_channel = $2 WHERE id = $1", [id, ch]);
      await c.query("INSERT INTO consent_log (customer_id, consent, channel, user_id) VALUES ($1,$2,$3,$4)", [id, row.marketing_consent, ch, ctx.userId]);
    }
    await audit(c, ctx, "customer", id, "update", changes);
    return { id };
  });
}

// ---------- vehicles ----------

export async function plateKeyFor(c: PoolClient, registeredIn: string, code: string | null, number: string) {
  const t = await c.query("SELECT * FROM plate_template WHERE code = $1 AND active", [registeredIn]);
  if (!t.rowCount) throw invalid("Choose where the vehicle is registered.");
  const tpl = t.rows[0];
  const num = str(number).toUpperCase();
  if (!new RegExp(tpl.number_regex).test(num)) throw invalid(`Plate number is not valid for ${tpl.name}.`);
  const cd = code ? str(code).toUpperCase() : null;
  if (tpl.code_values?.length && (!cd || !tpl.code_values.includes(cd))) throw invalid(`Plate ${tpl.code_label ?? "code"} must be one of ${tpl.code_values.join(", ")} for ${tpl.name}.`);
  return { key: `${registeredIn}|${cd ?? ""}|${num}`, code: cd, number: num };
}

export async function createVehicle(ctx: Ctx, f: Record<string, unknown>): Promise<{ id?: string; duplicates?: Duplicate[] }> {
  assertCan(ctx, "customers", "create");
  return withTx(ctx, async (c) => {
    const owner = required(f.owner_customer_id, "Owner");
    if (!(await c.query("SELECT 1 FROM customer WHERE id = $1 AND active", [owner])).rowCount) throw invalid("Owner not found.");
    const plate = await plateKeyFor(c, required(f.registered_in, "Registered in"), optStr(f.plate_code), required(f.plate_number, "Plate number"));
    const vin = normaliseVin(f.vin);
    const vinMissing = vin ? null : optStr(f.vin_missing_reason);
    if (!vin && !vinMissing) throw invalid("Enter the VIN, or tick VIN not available and give a reason.");
    const dups = await findDuplicates(c, { vin, plateKey: plate.key });
    // A duplicate VIN is always blocked; a plate match can be overridden with a reason.
    if (dups.some((d) => d.kind === "vin")) return { duplicates: dups.filter((d) => d.kind === "vin") };
    const reason = optStr(f.duplicate_reason);
    if (dups.length && !reason) return { duplicates: dups };
    const year = optInt(f.model_year, "Year", 1950, new Date().getFullYear() + 1);
    const r = await c.query(
      `INSERT INTO vehicle (registered_in, plate_code, plate_number, vin, vin_missing_reason, make, model, model_year, engine, fuel, transmission, colour,
                            mulkiya_expiry, odometer, owner_customer_id, duplicate_reason, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id`,
      [f.registered_in, plate.code, plate.number, vin, vinMissing, required(f.make, "Make"), required(f.model, "Model"), year, optStr(f.engine), optStr(f.fuel),
        optStr(f.transmission), optStr(f.colour), optStr(f.mulkiya_expiry), optInt(f.odometer, "Odometer", 0, 5_000_000), owner, dups.length ? reason : null, ctx.userId],
    ).catch((e) => { if (e.code === "23505") throw invalid("A vehicle with this VIN already exists."); throw e; });
    await c.query("INSERT INTO vehicle_customer (vehicle_id, customer_id, relation) VALUES ($1,$2,'owner')", [r.rows[0].id, owner]);
    await audit(c, ctx, "vehicle", r.rows[0].id, "create", { plate: plate.key, vin });
    return { id: r.rows[0].id };
  });
}

/** Vehicle with service history from every branch; prices only for the caller's branches (BR-04). */
export async function getVehicle(ctx: Ctx, id: string) {
  assertCan(ctx, "customers", "view");
  return withTx(ctx, async (c) => {
    const v = await c.query("SELECT v.*, c.customer_type, c.title, c.first_name, c.last_name, c.company_name, c.mobile FROM vehicle v JOIN customer c ON c.id = v.owner_customer_id WHERE v.id = $1", [id]);
    if (!v.rowCount) throw notFound("Vehicle");
    const hist = (await c.query("SELECT * FROM vehicle_history($1)", [id])).rows
      .map((h) => (h.amount !== null && !canSee(ctx, "selling_price") ? { ...h, amount: null } : h));
    const deferred = (await c.query("SELECT d.*, j.doc_no FROM deferred_work d JOIN job_card j ON j.id = d.job_card_id WHERE d.vehicle_id = $1 AND d.status = 'open'", [id])).rows;
    return { vehicle: v.rows[0], history: hist, deferred };
  });
}
