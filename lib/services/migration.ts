import { Ctx, assertCan, canAnywhere } from "../access";
import { withTx } from "../db";
import { AppError, forbidden, invalid } from "../errors";
import { masterDef, saveMaster } from "./master-forms";
import { createCustomer, createVehicle } from "./customers";
import { createEmployee } from "./hr";
import { receiveStock } from "./stock";
import { str } from "../validate";

/**
 * Tally master import (TM-01): ledgers, suppliers, stock items and customers from CSV. Masters only; no
 * vouchers or history. Each row goes through the same checks as the master form; a row whose code (or
 * customer mobile) already exists is skipped, and every other problem is reported by line.
 */

export const MASTER_IMPORTS = {
  accounts: { title: "Ledgers (chart of accounts)", master: "accounts", key: "code", sample: "Code,Name,Group,Type,Sub-type\n5920,Telephone and internet,Indirect expenses,expense,normal" },
  suppliers: { title: "Suppliers", master: "suppliers", key: "code", sample: "Code,Name,TRN,Phone,Payment terms (days),Credit limit\nGULFOIL,Gulf Oil Trading,100234567800003,+97142223333,30,50000" },
  items: { title: "Stock items", master: "items", key: "part_no", sample: "Part no,Description,Category,Unit,List price,Tax code,Item type,Barcode,OEM part no.,Fits vehicles\nFLT-AIR-1780,Air filter Corolla,parts,EA,45,SR,stock,6291234567890,17801-0T030,Toyota Corolla 2014-2019" },
  customers: { title: "Customers", master: null, key: "mobile", sample: "Customer type,First name,Last name,Company name,Mobile,Email,TRN,Credit limit,Payment terms days\ncorporate,,,Al Noor Transport LLC,0501234567,accounts@alnoor.ae,100555666700003,20000,30" },
  vehicles: { title: "Vehicles (owner found by mobile)", master: null, key: "plate_number", sample: "Owner mobile,Registered in,Plate code,Plate number,VIN,Make,Model,Year,Colour,Odometer,Mulkiya expiry\n0501234567,DXB,A,61363,JTMHV05J604123456,Toyota,Land Cruiser,2021,White,85000,2027-03-31" },
  employees: { title: "Employees", master: null, key: "emp_no", sample: "Employee no,Branch,First name,Last name,Nationality,Date of birth,Gender,Mobile,Department,Designation,Joining date,IBAN\nSF-1001,YAS,Ramesh,Kumar,India,1990-05-14,male,0551234567,WORKSHOP,TECH,2019-02-01,AE070331234567890123456" },
  opening_stock: { title: "Opening stock (by branch)", master: null, key: "part_no", sample: "Branch,Part no,Quantity,Unit cost\nYAS,FLT-AIR-1780,24,28.50" },
} as const;
export type ImportKind = keyof typeof MASTER_IMPORTS;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS: Record<string, string[]> = {
  name: ["name_en", "name"], group: ["account_group"], type: ["account_type", "item_type"], subtype: ["sub_type"], unit: ["uom"], uom: ["uom"],
  taxcode: ["vat_code"], tax: ["vat_code"], vat: ["vat_code"], country: ["country_code"], partno: ["part_no"], price: ["list_price"], paymentterms: ["payment_terms_days"],
  ean: ["barcode"], oem: ["oem_part_no"], oemno: ["oem_part_no"], oempartnumber: ["oem_part_no"], alternatives: ["alt_part_nos"], crossreference: ["alt_part_nos"], fits: ["fits_vehicles"], vehicles: ["fits_vehicles"],
};

function parseCsv(text: string) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const split = (l: string) => { const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; } else cur += ch; }
    out.push(cur.trim()); return out; };
  if (lines.length < 2) throw invalid("The file needs a header row and at least one line.");
  if (lines.length > 5001) throw invalid("Import at most 5,000 rows at a time.");
  return { head: split(lines[0]), rows: lines.slice(1).map(split) };
}

export async function importMasters(ctx: Ctx, kind: ImportKind, text: string) {
  const def = MASTER_IMPORTS[kind];
  if (!def) throw invalid("Choose what to import.");
  if (kind === "vehicles" || kind === "employees" || kind === "opening_stock") return importOpening(ctx, kind, text);
  assertCan(ctx, kind === "customers" ? "customers" : "settings", "create");
  const { head, rows } = parseCsv(text);
  const fields = def.master ? masterDef(def.master).fields : null;
  // header -> field name
  const map = head.map((h) => {
    const n = norm(h);
    if (!fields) return h.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const direct = fields.find((f) => norm(f.name) === n || norm(f.label) === n);
    if (direct) return direct.name;
    return (ALIAS[n] ?? []).find((a) => fields.some((f) => f.name === a)) ?? null;
  });
  if (fields && !map.includes(def.key)) throw invalid(`The file needs a "${def.key.replace(/_/g, " ")}" column.`);
  const existing = new Set(await withTx(ctx, async (c) => {
    if (kind === "accounts") return (await c.query("SELECT code k FROM account")).rows.map((r) => r.k);
    if (kind === "suppliers") return (await c.query("SELECT code k FROM supplier")).rows.map((r) => r.k);
    if (kind === "items") return (await c.query("SELECT part_no k FROM item")).rows.map((r) => r.k);
    return [] as string[];
  }));
  let created = 0, skipped = 0;
  const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    const form: Record<string, unknown> = {};
    map.forEach((f, k) => { if (f && str(r[k])) form[f] = r[k]; });
    try {
      if (kind === "customers") {
        form.country_code = form.country_code ?? "AE";
        const t = str(form.customer_type).toLowerCase();
        form.customer_type = t === "company" ? "corporate" : t || "individual";
        // Masters brought over from Tally rarely carry the ID; staff complete it on the first edit.
        const res = await createCustomer(ctx, { ...form, imported: true });
        if (res.duplicates?.length) { skipped++; continue; }
        created++;
      } else {
        if (existing.has(str(form[def.key]))) { skipped++; continue; }
        if (kind === "suppliers") { form.country_code = form.country_code ?? "AE"; form.payment_terms_days = form.payment_terms_days ?? "30"; form.credit_limit = form.credit_limit ?? "0"; }
        if (kind === "accounts") { form.sub_type = form.sub_type ?? "normal"; form.account_type = str(form.account_type).toLowerCase(); }
        if (kind === "items") { form.vat_code = form.vat_code ?? "SR"; form.item_type = form.item_type ?? "stock"; form.uom = form.uom ?? "EA"; form.category = form.category ?? "parts"; }
        await saveMaster(ctx, def.master!, form);
        existing.add(str(form[def.key]));
        created++;
      }
    } catch (e) {
      if (e instanceof AppError) errors.push(`Line ${i + 2}: ${e.message}`);
      else throw e;
    }
  }
  return { created, skipped, errors };
}

/** "14/05/1990", "14-05-1990" or "1990-05-14" as YYYY-MM-DD; anything else is passed on for the form's own check. */
function isoDate(v: unknown) {
  const t = str(v);
  // An Excel date cell arrives as a day number (1 = 1 Jan 1900, with Excel's 1900 leap-year quirk).
  if (/^\d{4,5}(\.\d+)?$/.test(t) && Number(t) > 3000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000).toISOString().slice(0, 10); const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : t;
}
const col = (h: string) => h.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const COLS: Record<string, string> = {
  owner_mobile: "owner_mobile", mobile_of_owner: "owner_mobile", owner: "owner_mobile", emirate: "registered_in", registered_in: "registered_in",
  plate_code: "plate_code", code: "plate_code", plate_number: "plate_number", plate_no: "plate_number", plate: "plate_number", vin: "vin", make: "make", model: "model",
  year: "model_year", model_year: "model_year", colour: "colour", color: "colour", odometer: "odometer", odometer_km: "odometer", mulkiya_expiry: "mulkiya_expiry", registration_expiry: "mulkiya_expiry",
  employee_no: "emp_no", emp_no: "emp_no", employee_number: "emp_no", branch: "branch", branch_code: "branch", first_name: "first_name", last_name: "last_name",
  nationality: "nationality", date_of_birth: "date_of_birth", dob: "date_of_birth", gender: "gender", mobile: "mobile", email: "email", department: "department", designation: "designation",
  joining_date: "joining_date", date_of_joining: "joining_date", iban: "iban", labour_card_no: "labour_card_no", mohre_person_code: "mohre_person_code", contract_type: "contract_type",
  part_no: "part_no", part_number: "part_no", item: "part_no", quantity: "qty", qty: "qty", unit_cost: "unit_cost", cost: "unit_cost",
};
const NEEDS: Record<string, string[]> = {
  vehicles: ["owner_mobile", "registered_in", "plate_number", "make", "model", "model_year"],
  employees: ["branch", "first_name", "last_name", "joining_date"],
  opening_stock: ["branch", "part_no", "qty", "unit_cost"],
};

/**
 * Opening data that is not a master form (OT-10, NF-07, IN-10): vehicles under their owner, employees,
 * and opening stock per branch. Each row goes through the same service as its screen; a row already
 * there (same plate or VIN, same employee number, or opening stock already loaded for that part at
 * that branch) is skipped, and every other problem is reported by line.
 */
async function importOpening(ctx: Ctx, kind: "vehicles" | "employees" | "opening_stock", text: string) {
  if (kind === "vehicles") assertCan(ctx, "customers", "create");
  if (kind === "employees" && !canAnywhere(ctx, "hr", "create")) throw forbidden("Only HR can import employees.");
  if (kind === "opening_stock" && !canAnywhere(ctx, "stock", "create")) throw forbidden("You cannot load stock.");
  const { head, rows } = parseCsv(text);
  const map = head.map((h) => COLS[col(h)] ?? null);
  const missing = NEEDS[kind].filter((n) => !map.includes(n));
  if (missing.length) throw invalid(`The file needs these columns: ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}.`);
  const look = await withTx(ctx, async (c) => ({
    branches: new Map((await c.query("SELECT id, code FROM branch")).rows.map((r) => [String(r.code).toUpperCase(), r.id as string])),
    depts: (await c.query("SELECT id, code, name_en FROM department")).rows,
    desigs: (await c.query("SELECT id, code, name_en FROM designation")).rows,
    emps: new Set((await c.query("SELECT emp_no FROM employee")).rows.map((r) => String(r.emp_no).toUpperCase())),
    countries: (await c.query("SELECT code, name FROM country WHERE active")).rows as { code: string; name: string }[],
  }));
  const pick = (list: { id: string; code: string; name_en: string }[], v: string) => list.find((x) => x.code.toUpperCase() === v.toUpperCase() || x.name_en.toLowerCase() === v.toLowerCase())?.id;
  let created = 0, skipped = 0;
  const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    const f: Record<string, string> = {};
    map.forEach((n, k) => { if (n && str(r[k])) f[n] = str(r[k]); });
    try {
      if (kind === "vehicles") {
        const digits = f.owner_mobile?.replace(/\D/g, "").replace(/^0+/, "").slice(-9) ?? "";
        if (digits.length < 7) throw invalid("Owner mobile is missing.");
        const owners = await withTx(ctx, async (c) => (await c.query("SELECT id FROM customer WHERE active AND regexp_replace(mobile, '\\D', '', 'g') LIKE '%' || $1", [digits])).rows);
        if (!owners.length) throw invalid(`No customer with mobile ${f.owner_mobile}. Import the customers first.`);
        if (owners.length > 1) throw invalid(`More than one customer has mobile ${f.owner_mobile}; add this car from the customer's screen.`);
        const res = await createVehicle(ctx, { ...f, registered_in: f.registered_in.toUpperCase(), plate_code: f.plate_code ?? "", owner_customer_id: owners[0].id,
          mulkiya_expiry: f.mulkiya_expiry ? isoDate(f.mulkiya_expiry) : undefined, vin_missing_reason: f.vin ? undefined : "Imported without VIN" });
        if (res.duplicates?.length) { skipped++; continue; }
        created++;
      } else if (kind === "employees") {
        const branchId = look.branches.get(str(f.branch).toUpperCase());
        if (!branchId) throw invalid(`Branch "${f.branch}" not found. Use the branch code, for example YAS.`);
        assertCan(ctx, "hr", "create", branchId);
        if (f.emp_no && look.emps.has(f.emp_no.toUpperCase())) { skipped++; continue; }
        const department_id = f.department ? pick(look.depts, f.department) : undefined;
        if (f.department && !department_id) throw invalid(`Department "${f.department}" not found.`);
        const designation_id = f.designation ? pick(look.desigs, f.designation) : undefined;
        if (f.designation && !designation_id) throw invalid(`Designation "${f.designation}" not found.`);
        const nat = str(f.nationality);
        const nationality = nat ? look.countries.find((x) => x.code.toUpperCase() === nat.toUpperCase() || x.name.toLowerCase() === nat.toLowerCase())?.code : "";
        if (nat && !nationality) throw invalid(`Nationality "${nat}" is not in the country list. Add it under Masters, Countries, or use its code.`);
        const gender = str(f.gender).toLowerCase().replace(/^m$/, "male").replace(/^f$/, "female");
        const res = await createEmployee(ctx, { ...f, branch_id: branchId, department_id, designation_id, gender, nationality,
          date_of_birth: f.date_of_birth ? isoDate(f.date_of_birth) : undefined, joining_date: isoDate(f.joining_date) }, {}, true);
        look.emps.add(res.empNo.toUpperCase());
        created++;
      } else {
        const branchId = look.branches.get(str(f.branch).toUpperCase());
        if (!branchId) throw invalid(`Branch "${f.branch}" not found. Use the branch code, for example YAS.`);
        assertCan(ctx, "stock", "create", branchId);
        const item = await withTx(ctx, async (c) => (await c.query("SELECT id, EXISTS (SELECT 1 FROM stock_move m WHERE m.item_id = i.id AND m.branch_id = $2 AND m.move_type = 'opening') loaded FROM item i WHERE upper(part_no) = upper($1)", [f.part_no, branchId])).rows[0]);
        if (!item) throw invalid(`Part ${f.part_no} not found. Import the stock items first.`);
        if (item.loaded) { skipped++; continue; }
        await receiveStock({ ...ctx, currentBranchId: branchId }, { item_id: item.id, qty: f.qty, unit_cost: f.unit_cost, kind: "opening", ref: "Opening stock (import)" });
        created++;
      }
    } catch (e) {
      if (e instanceof AppError) errors.push(`Line ${i + 2}: ${e.message}`);
      else throw e;
    }
  }
  return { created, skipped, errors };
}
