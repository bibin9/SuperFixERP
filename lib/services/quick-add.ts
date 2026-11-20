import { Ctx, can, canAnywhere } from "../access";
import { withTx } from "../db";
import { invalid } from "../errors";
import { createCustomer, createVehicle } from "./customers";
import { MASTERS, masterModule, saveMaster } from "./master-forms";

/**
 * "+ New" from the place a master is picked (a customer on an enquiry, a part on a job line, a supplier
 * on a purchase order): a short form in a popup that saves the record through the same service as the
 * master screen, with the same checks, and hands back the new record for the picker to select.
 */

export type QuickKind = "customer" | "vehicle" | "items" | "services" | "suppliers";
export type QField = {
  name: string; label: string; type: "text" | "number" | "select" | "date" | "bool";
  required?: boolean; options?: [string, string][]; def?: string; hint?: string; pattern?: string;
  /** Show only while another field has one of these values. */
  showIf?: [string, string[]];
  /** Options that depend on another field's value. */
  dep?: { on: string; map: Record<string, [string, string][]> };
};
export type QuickSpec = { kind: QuickKind; title: string; fields: QField[] };
export type QuickResult = { ok: true; id: string; label: string } | { ok: false; err: string; field?: string; dups?: { kind: string; id: string; label: string }[]; blocked?: boolean };

/** Which "+ New" buttons this user may see (the save is checked again by the service). */
export function canQuickAdd(ctx: Ctx, kind: QuickKind) {
  if (kind === "customer" || kind === "vehicle") return can(ctx, "customers", "create");
  const d = MASTERS.find((m) => m.key === kind)!;
  return canAnywhere(ctx, masterModule(d), "create");
}

const MASTER_FIELDS: Record<string, string[]> = {
  items: ["part_no", "description", "brand", "category", "uom", "list_price", "vat_code", "item_type"],
  services: ["code", "name_en", "category", "standard_hours", "labour_rate", "vat_code"],
  suppliers: ["code", "name_en", "trn", "country_code", "phone", "payment_terms_days", "credit_limit"],
};
const MASTER_DEFAULTS: Record<string, Record<string, string>> = {
  items: { vat_code: "SR", item_type: "stock", uom: "EA" },
  services: { vat_code: "SR", standard_hours: "1" },
  suppliers: { country_code: "AE", payment_terms_days: "30", credit_limit: "0" },
};
const TITLES: Record<string, string> = { items: "New part", services: "New service", suppliers: "New supplier" };

export async function quickSpec(ctx: Ctx, kind: QuickKind): Promise<QuickSpec | null> {
  if (!canQuickAdd(ctx, kind)) return null;
  return withTx(ctx, async (c) => {
    if (kind === "customer") {
      const countries = (await c.query("SELECT code, name, id_types FROM country WHERE active ORDER BY code <> 'AE', name")).rows;
      const titles = (await c.query("SELECT code, name_en FROM customer_title WHERE active ORDER BY name_en")).rows;
      const ids = Object.fromEntries(countries.map((x) => [x.code, (x.id_types ?? []).map((t: string) => [t, t] as [string, string])]));
      const person: [string, string[]] = ["customer_type", ["individual"]], firm: [string, string[]] = ["customer_type", ["corporate", "government"]];
      return { kind, title: "New customer", fields: [
        { name: "customer_type", label: "Customer type", type: "select", required: true, def: "individual", options: [["individual", "Individual"], ["corporate", "Company"], ["government", "Government"]] },
        { name: "title", label: "Title", type: "select", required: true, showIf: person, options: titles.map((t) => [t.code, t.name_en]) },
        { name: "first_name", label: "First name", type: "text", required: true, showIf: person },
        { name: "last_name", label: "Last name", type: "text", required: true, showIf: person },
        { name: "company_name", label: "Company name", type: "text", required: true, showIf: firm },
        { name: "trade_licence_no", label: "Trade licence no.", type: "text", required: true, showIf: firm },
        { name: "country_code", label: "Country", type: "select", required: true, def: "AE", options: countries.map((x) => [x.code, x.name]) },
        { name: "mobile", label: "Mobile", type: "text", required: true, hint: "For example 050 123 4567" },
        { name: "id_type", label: "ID type", type: "select", required: true, showIf: person, dep: { on: "country_code", map: ids } },
        { name: "id_number", label: "ID number", type: "text", required: true, showIf: person },
        { name: "email", label: "Email", type: "text" },
      ] };
    }
    if (kind === "vehicle") {
      const plates = (await c.query("SELECT code, name, code_values FROM plate_template WHERE active ORDER BY country_code <> 'AE', name")).rows;
      const codes = Object.fromEntries(plates.map((p) => [p.code, (p.code_values ?? []).map((v: string) => [v, v] as [string, string])]));
      return { kind, title: "New car", fields: [
        { name: "registered_in", label: "Registered in", type: "select", required: true, def: "AUH", options: plates.map((p) => [p.code, p.name]) },
        { name: "plate_code", label: "Plate code", type: "text", required: true, dep: { on: "registered_in", map: codes } },
        { name: "plate_number", label: "Plate number", type: "text", required: true },
        { name: "make", label: "Make", type: "text", required: true }, { name: "model", label: "Model", type: "text", required: true },
        { name: "model_year", label: "Year", type: "number", required: true },
        { name: "vin", label: "VIN (17 characters)", type: "text" },
        { name: "vin_missing_reason", label: "If no VIN, why", type: "text", hint: "Needed when the VIN is left empty" },
        { name: "colour", label: "Colour", type: "text" }, { name: "odometer", label: "Odometer (km)", type: "number" },
      ] };
    }
    const d = MASTERS.find((m) => m.key === kind)!;
    const fields: QField[] = [];
    for (const name of MASTER_FIELDS[kind]) {
      const f = d.fields.find((x) => x.name === name)!;
      let options: [string, string][] | undefined;
      if (f.values) options = f.values;
      else if (f.lookup) options = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = $1 AND active ORDER BY sort, name_en", [f.lookup])).rows.map((r) => [r.code, r.name_en]);
      else if (f.sql) options = (await c.query({ text: f.sql, rowMode: "array" })).rows.map((r) => [String(r[0]), String(r[1])]);
      const def = MASTER_DEFAULTS[kind][name];
      fields.push({ name, label: f.label, type: f.type === "select" ? "select" : f.type === "number" ? "number" : f.type === "bool" ? "bool" : "text",
        required: f.required, options, hint: f.hint, pattern: f.pattern, def: options && def && !options.some(([v]) => v === def) ? options[0]?.[0] : def });
    }
    return { kind, title: TITLES[kind], fields };
  });
}

/** Saves the new record and returns its id and the text its picker shows. */
export async function quickSave(ctx: Ctx, kind: QuickKind, f: Record<string, string>): Promise<QuickResult> {
  if (kind === "customer") {
    const r = await createCustomer(ctx, { ...f, whatsapp: true });
    if (r.duplicates) return { ok: false, err: "A customer with this mobile already exists.", dups: r.duplicates };
    return { ok: true, id: r.id!, label: await labelOf(ctx, kind, r.id!) };
  }
  if (kind === "vehicle") {
    if (!f.owner_customer_id) throw invalid("Pick or add the customer first, then add the car.");
    const r = await createVehicle(ctx, f);
    if (r.duplicates) {
      const blocked = r.duplicates.some((d) => d.kind === "vin");
      return { ok: false, err: blocked ? "A car with this VIN already exists." : "A car with this plate already exists.", dups: r.duplicates, blocked };
    }
    return { ok: true, id: r.id!, label: await labelOf(ctx, kind, r.id!) };
  }
  const allowed = MASTER_FIELDS[kind];
  if (!allowed) throw invalid("This list cannot be added to here.");
  // Fields not on the short form keep the master's defaults (empty).
  const form = Object.fromEntries(Object.entries(f).filter(([k]) => allowed.includes(k)));
  const r = await saveMaster(ctx, kind, form);
  const id = (JSON.parse(r.key) as string[])[0];
  return { ok: true, id, label: await labelOf(ctx, kind, id) };
}

async function labelOf(ctx: Ctx, kind: QuickKind, id: string) {
  return withTx(ctx, async (c) => {
    const sql: Record<QuickKind, string> = {
      customer: `SELECT CASE WHEN customer_type = 'individual' THEN concat_ws(' ', title, first_name, last_name) ELSE 'M/s. ' || company_name END || ' · ' || mobile FROM customer WHERE id = $1`,
      vehicle: `SELECT concat_ws(' ', registered_in, plate_code, plate_number) || ' · ' || make || ' ' || model FROM vehicle WHERE id = $1`,
      items: `SELECT part_no || ' · ' || description FROM item WHERE id = $1`,
      services: `SELECT name_en || ' · ' || trim_scale(standard_hours)::text || ' h' FROM service WHERE id = $1`,
      suppliers: `SELECT code || ' · ' || name_en FROM supplier WHERE id = $1`,
    };
    return String((await c.query({ text: sql[kind], values: [id], rowMode: "array" })).rows[0]?.[0] ?? "");
  });
}
