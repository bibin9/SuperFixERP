import { Ctx, assertCan } from "../access";
import { withTx } from "../db";
import { AppError, invalid, notFound } from "../errors";
import { audit, diff } from "./audit";
import { parseDec } from "../money";

/**
 * Master forms (FSD v0.10, section 3.10): every list of business values that the system uses has an
 * add, edit and deactivate screen. Records are never deleted; a deactivated record stays on old
 * documents and is no longer offered for new ones. Every change is written to the audit log.
 * The registry below is the single place a new master is declared. Table and column names come
 * only from this registry, never from the request.
 */

export type MField = {
  name: string; label: string;
  type: "text" | "number" | "bool" | "textarea" | "select" | "list";
  required?: boolean; pattern?: string; dp?: number; min?: number; max?: number; hint?: string;
  /** select options: from an admin list (lookup_value), from fixed system values, or from SQL returning (value, label). */
  lookup?: string; values?: [string, string][]; sql?: string;
};
export type MDef = {
  key: string; title: string; group: string; table: string; note: string;
  pk: string[]; autoId?: boolean; hasActive: boolean; noCreate?: boolean; order: string; fields: MField[];
};

const TAX = "SELECT code, code || ' · ' || name FROM tax_code WHERE active ORDER BY code";

export const MASTERS: MDef[] = [
  { key: "services", title: "Services and labour rates", group: "Front office", table: "service", pk: ["id"], autoId: true, hasActive: true, order: "code",
    note: "Labour operations with standard time and labour rate. A job line copies these when it is added; later changes do not alter open work.",
    fields: [
      { name: "code", label: "Code", type: "text", required: true, pattern: "^[A-Z0-9-]{2,20}$", hint: "Capitals, digits and dashes" },
      { name: "name_en", label: "Name (English)", type: "text", required: true }, { name: "name_ar", label: "Name (Arabic)", type: "text" },
      { name: "category", label: "Category", type: "select", lookup: "service_category", required: true },
      { name: "standard_hours", label: "Standard hours", type: "number", dp: 4, min: 0, required: true },
      { name: "labour_rate", label: "Price (AED, before VAT)", type: "number", dp: 2, min: 0, required: true },
      { name: "is_quick", label: "Quick service", type: "bool" }, { name: "vat_code", label: "Tax code", type: "select", sql: TAX, required: true },
    ] },
  { key: "items", title: "Parts and items", group: "Stock", table: "item", pk: ["id"], autoId: true, hasActive: true, order: "part_no",
    note: "Item master shared by all branches. Cost is kept per branch by the stock ledger and is not edited here.",
    fields: [
      { name: "part_no", label: "Part no.", type: "text", required: true }, { name: "description", label: "Description", type: "text", required: true },
      { name: "name_ar", label: "Name (Arabic)", type: "text" }, { name: "brand", label: "Brand", type: "text" },
      { name: "category", label: "Category", type: "select", lookup: "item_category", required: true },
      { name: "uom", label: "Unit", type: "select", lookup: "uom", required: true },
      { name: "list_price", label: "List price (AED, before VAT)", type: "number", dp: 2, min: 0, required: true },
      { name: "vat_code", label: "Tax code", type: "select", sql: TAX, required: true },
      { name: "item_type", label: "Item type", type: "select", required: true, values: [["stock", "Stock item"], ["consumable", "Consumable"], ["non_stock", "Non-stock"], ["service", "Service item"]] },
      { name: "preferred_supplier", label: "Preferred supplier", type: "text" },
    ] },
  { key: "tax-codes", title: "Tax codes and VAT rates", group: "Accounts", table: "tax_code", pk: ["code"], hasActive: true, order: "code",
    note: "VAT rate as a fraction (0.05 = 5%). A quotation or invoice keeps the rate it was made with.",
    fields: [
      { name: "code", label: "Code", type: "text", required: true, pattern: "^[A-Z]{1,4}$" }, { name: "name", label: "Name", type: "text", required: true },
      { name: "rate", label: "Rate (fraction)", type: "number", dp: 4, min: 0, max: 1, required: true }, { name: "vat201_box", label: "VAT 201 box", type: "text" },
    ] },
  { key: "payment-methods", title: "Payment methods", group: "Accounts", table: "payment_method", pk: ["code"], hasActive: true, order: "sort, name",
    note: "Methods offered when taking a payment. Each one posts to the account set for its posting event. Payments are recorded by staff; no gateway is called.",
    fields: [
      { name: "code", label: "Code", type: "text", required: true, pattern: "^[a-z0-9_]{2,30}$" }, { name: "name", label: "Name", type: "text", required: true },
      { name: "posting_event", label: "Posting event (debit)", type: "select", required: true, sql: "SELECT event_key, event_key FROM account_mapping ORDER BY event_key" },
      { name: "needs_reference", label: "Reference required", type: "bool" }, { name: "sort", label: "Order", type: "number", dp: 0, min: 0 },
    ] },
  { key: "lists", title: "Pick lists", group: "General", table: "lookup_value", pk: ["list", "code"], hasActive: true, order: "list, sort, name_en",
    note: "Enquiry sources, lost reasons, delay reasons, bay types, item categories, units and service categories.",
    fields: [
      { name: "list", label: "List", type: "select", required: true, sql: "SELECT DISTINCT list, list FROM lookup_value ORDER BY 1" },
      { name: "code", label: "Code", type: "text", required: true, pattern: "^[A-Za-z0-9_]{1,40}$" },
      { name: "name_en", label: "Name (English)", type: "text", required: true }, { name: "name_ar", label: "Name (Arabic)", type: "text" },
      { name: "sort", label: "Order", type: "number", dp: 0, min: 0 },
    ] },
  { key: "titles", title: "Customer titles", group: "Front office", table: "customer_title", pk: ["code"], hasActive: true, order: "name_en",
    note: "Titles used on quotations, invoices and messages (CV-02).",
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name_en", label: "Title (English)", type: "text", required: true }, { name: "name_ar", label: "Title (Arabic)", type: "text" }] },
  { key: "countries", title: "Countries, phone formats and ID types", group: "Front office", table: "country", pk: ["code"], hasActive: true, order: "name",
    note: "Choosing the country on a customer sets the dialling code, the mobile check and the ID types (CV-02).",
    fields: [
      { name: "code", label: "ISO code", type: "text", required: true, pattern: "^[A-Z]{2}$" }, { name: "name", label: "Name", type: "text", required: true },
      { name: "dial_code", label: "Dialling code", type: "text", required: true, pattern: "^\\+[0-9]{1,4}$" },
      { name: "mobile_regex", label: "Mobile pattern (national number)", type: "text", required: true },
      { name: "id_types", label: "ID types (comma separated)", type: "list", required: true },
    ] },
  { key: "plates", title: "Plate set-up per emirate and country", group: "Front office", table: "plate_template", pk: ["code"], hasActive: true, order: "country_code, name",
    note: "Plate parts per place of registration (CV-11).",
    fields: [
      { name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true },
      { name: "country_code", label: "Country", type: "select", required: true, sql: "SELECT code, name FROM country WHERE active ORDER BY name" },
      { name: "code_label", label: "Plate code label", type: "text" }, { name: "code_values", label: "Plate codes (comma separated)", type: "list" },
      { name: "number_regex", label: "Plate number pattern", type: "text", required: true },
    ] },
  { key: "message-templates", title: "Message templates", group: "Front office", table: "message_template", pk: ["id"], autoId: true, hasActive: true, order: "event, language",
    note: "Text for the WhatsApp messages staff send themselves. Placeholders: {title} {name} {plate} {job_no} {doc_no} {amount} {link} {branch}.",
    fields: [
      { name: "event", label: "Event", type: "select", required: true,
        values: [["enquiry_reply", "Reply to enquiry"], ["quotation_for_approval", "Quotation for approval"], ["approved", "Work approved"], ["car_ready", "Car ready"], ["invoice", "Invoice"], ["service_due", "Service due"], ["feedback", "Feedback request"]] },
      { name: "language", label: "Language", type: "select", required: true, values: [["en", "English"], ["ar", "Arabic"]] },
      { name: "body", label: "Text", type: "textarea", required: true },
    ] },
  { key: "bays", title: "Bays", group: "Workshop", table: "bay", pk: ["id"], autoId: true, hasActive: true, order: "branch_id, code",
    note: "Workshop bays per branch.",
    fields: [
      { name: "branch_id", label: "Branch", type: "select", required: true, sql: "SELECT id::text, code || ' · ' || name_en FROM branch WHERE active ORDER BY code" },
      { name: "code", label: "Bay", type: "text", required: true }, { name: "bay_type", label: "Type", type: "select", lookup: "bay_type", required: true },
    ] },
  { key: "accounts", title: "Chart of accounts", group: "Accounts", table: "account", pk: ["id"], autoId: true, hasActive: true, order: "code",
    note: "Ledger accounts with Tally-style groups.",
    fields: [
      { name: "code", label: "Code", type: "text", required: true, pattern: "^[0-9]{3,8}$" }, { name: "name", label: "Name", type: "text", required: true },
      { name: "account_group", label: "Group", type: "text", required: true },
      { name: "account_type", label: "Type", type: "select", required: true, values: [["asset", "Asset"], ["liability", "Liability"], ["equity", "Equity"], ["income", "Income"], ["expense", "Expense"]] },
      { name: "sub_type", label: "Sub-type", type: "select", required: true,
        values: [["normal", "Normal"], ["cash", "Cash"], ["bank", "Bank"], ["receivable", "Receivable"], ["payable", "Payable"], ["vat_output", "VAT output"], ["vat_input", "VAT input"], ["stock", "Stock"]] },
    ] },
  { key: "posting", title: "Posting rules (account mapping)", group: "Accounts", table: "account_mapping", pk: ["event_key"], hasActive: false, noCreate: true, order: "event_key",
    note: "Which account each business event posts to. Events are fixed by the system; the account is yours to choose.",
    fields: [
      { name: "event_key", label: "Event", type: "text", required: true },
      { name: "account_id", label: "Account", type: "select", required: true, sql: "SELECT id::text, code || ' · ' || name FROM account WHERE active ORDER BY code" },
      { name: "description", label: "Description", type: "text" },
    ] },
];

export const masterDef = (key: string) => {
  const d = MASTERS.find((m) => m.key === key);
  if (!d) throw notFound("Master");
  return d;
};

const q = (id: string) => `"${id.replace(/"/g, "")}"`;
const cols = (d: MDef) => [...new Set([...d.pk, ...d.fields.map((f) => f.name), ...(d.hasActive ? ["active"] : [])])];

export async function getMaster(ctx: Ctx, key: string) {
  assertCan(ctx, "settings", "view");
  const d = masterDef(key);
  return withTx(ctx, async (c) => {
    const rows = (await c.query(`SELECT ${cols(d).map((x) => `${q(x)}${["id", "branch_id", "account_id"].includes(x) ? "::text" : ""} ${q(x)}`).join(", ")} FROM ${q(d.table)} ORDER BY ${d.order}`)).rows;
    const options: Record<string, [string, string][]> = {};
    for (const f of d.fields) {
      if (f.values) options[f.name] = f.values;
      else if (f.lookup) options[f.name] = (await c.query("SELECT code, name_en FROM lookup_value WHERE list = $1 AND active ORDER BY sort, name_en", [f.lookup])).rows.map((r) => [r.code, r.name_en]);
      else if (f.sql) options[f.name] = (await c.query({ text: f.sql, rowMode: "array" })).rows.map((r) => [String(r[0]), String(r[1])]);
    }
    return { def: d, rows, options };
  });
}

function parse(_d: MDef, f: MField, raw: unknown) {
  const s = raw === undefined || raw === null ? "" : String(raw).trim();
  if (f.type === "bool") return s === "on" || s === "true";
  if (!s) {
    if (f.required) throw invalid(`${f.label} is required.`);
    return f.type === "number" ? (f.name === "sort" ? 0 : null) : null;
  }
  if (f.type === "number") {
    try { return parseDec(s, f.label, { min: f.min ?? undefined, max: f.max ?? undefined, dp: f.dp ?? 2 }).toString(); }
    catch (e) { throw invalid(`${(e as Error).message}.`); }
  }
  if (f.type === "list") return s.split(",").map((x) => x.trim()).filter(Boolean);
  if (f.pattern && !new RegExp(f.pattern).test(s)) throw invalid(`${f.label} is not in the right format.${f.hint ? ` ${f.hint}.` : ""}`);
  if (f.name.endsWith("_regex")) { try { new RegExp(s); } catch { throw invalid(`${f.label} is not a valid pattern.`); } }
  return s;
}

/** Adds or edits a master record. `key` is the JSON of the primary key when editing. */
export async function saveMaster(ctx: Ctx, mkey: string, form: Record<string, unknown>, editKey?: string | null) {
  const d = masterDef(mkey);
  assertCan(ctx, "settings", editKey ? "edit" : "create");
  if (!editKey && d.noCreate) throw invalid(`New ${d.title.toLowerCase()} are added by the system, not here.`);
  return withTx(ctx, async (c) => {
    const values: Record<string, unknown> = {};
    for (const f of d.fields) {
      if (editKey && d.pk.includes(f.name)) continue; // keys are fixed once created
      const v = parse(d, f, form[f.name]);
      const opts = f.values ?? null;
      if (opts && v !== null && !opts.some(([o]) => o === v)) throw invalid(`Choose a valid ${f.label.toLowerCase()}.`);
      if (f.lookup && v !== null && !(await c.query("SELECT 1 FROM lookup_value WHERE list = $1 AND code = $2 AND active", [f.lookup, v])).rowCount) throw invalid(`Choose a valid ${f.label.toLowerCase()}.`);
      values[f.name] = v;
    }
    try {
      if (editKey) {
        const keyVals: unknown[] = JSON.parse(editKey);
        const where = d.pk.map((k, i) => `${q(k)} = $${i + 1}`).join(" AND ");
        const before = (await c.query(`SELECT * FROM ${q(d.table)} WHERE ${where} FOR UPDATE`, keyVals)).rows[0];
        if (!before) throw notFound(d.title);
        const names = Object.keys(values);
        await c.query(`UPDATE ${q(d.table)} SET ${names.map((n, i) => `${q(n)} = $${d.pk.length + i + 1}`).join(", ")} WHERE ${where}`, [...keyVals, ...names.map((n) => values[n])]);
        await audit(c, ctx, `master:${d.table}`, String(keyVals.join("/")), "update", diff(before, values), null);
        return { key: editKey };
      }
      const names = Object.keys(values);
      const r = await c.query(`INSERT INTO ${q(d.table)} (${names.map(q).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING ${d.pk.map((k) => `${q(k)}::text`).join(", ")}`,
        names.map((n) => values[n]));
      const keyVals = d.pk.map((k) => r.rows[0][k]);
      await audit(c, ctx, `master:${d.table}`, String(keyVals.join("/")), "create", values, null);
      return { key: JSON.stringify(keyVals) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "23505") throw new AppError("conflict", `A record with this ${d.fields.find((f) => d.pk.includes(f.name) || f.name === "code" || f.name === "part_no")?.label.toLowerCase() ?? "key"} already exists.`);
      if (code === "23503" || code === "23514") throw invalid("That value is not allowed here.");
      throw e;
    }
  });
}

export async function setMasterActive(ctx: Ctx, mkey: string, editKey: string, active: boolean) {
  const d = masterDef(mkey);
  assertCan(ctx, "settings", "edit");
  if (!d.hasActive) throw invalid("These records cannot be deactivated.");
  return withTx(ctx, async (c) => {
    const keyVals: unknown[] = JSON.parse(editKey);
    const where = d.pk.map((k, i) => `${q(k)} = $${i + 1}`).join(" AND ");
    const r = await c.query(`UPDATE ${q(d.table)} SET active = $${d.pk.length + 1} WHERE ${where}`, [...keyVals, active]);
    if (!r.rowCount) throw notFound(d.title);
    await audit(c, ctx, `master:${d.table}`, String(keyVals.join("/")), active ? "activate" : "deactivate", null, null);
  });
}
