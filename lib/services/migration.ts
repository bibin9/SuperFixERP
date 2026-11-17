import { Ctx, assertCan } from "../access";
import { withTx } from "../db";
import { AppError, invalid } from "../errors";
import { masterDef, saveMaster } from "./master-forms";
import { createCustomer } from "./customers";
import { str } from "../validate";

/**
 * Tally master import (TM-01): ledgers, suppliers, stock items and customers from CSV. Masters only; no
 * vouchers or history. Each row goes through the same checks as the master form; a row whose code (or
 * customer mobile) already exists is skipped, and every other problem is reported by line.
 */

export const MASTER_IMPORTS = {
  accounts: { title: "Ledgers (chart of accounts)", master: "accounts", key: "code", sample: "Code,Name,Group,Type,Sub-type\n5920,Telephone and internet,Indirect expenses,expense,normal" },
  suppliers: { title: "Suppliers", master: "suppliers", key: "code", sample: "Code,Name,TRN,Phone,Payment terms (days),Credit limit\nGULFOIL,Gulf Oil Trading,100234567800003,+97142223333,30,50000" },
  items: { title: "Stock items", master: "items", key: "part_no", sample: "Part no,Description,Category,Unit,List price,Tax code,Item type\nFLT-AIR-1780,Air filter Corolla,parts,EA,45,SR,stock" },
  customers: { title: "Customers", master: null, key: "mobile", sample: "Customer type,First name,Last name,Company name,Mobile,Email,TRN,Credit limit,Payment terms days\ncorporate,,,Al Noor Transport LLC,0501234567,accounts@alnoor.ae,100555666700003,20000,30" },
} as const;
export type ImportKind = keyof typeof MASTER_IMPORTS;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS: Record<string, string[]> = {
  name: ["name_en", "name"], group: ["account_group"], type: ["account_type", "item_type"], subtype: ["sub_type"], unit: ["uom"], uom: ["uom"],
  taxcode: ["vat_code"], tax: ["vat_code"], vat: ["vat_code"], country: ["country_code"], partno: ["part_no"], price: ["list_price"], paymentterms: ["payment_terms_days"],
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
        const res = await createCustomer(ctx, form);
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
