import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, branchId } from "./helpers";
import crypto from "node:crypto";
import { quotationPrint, jobCardPrint, receiptPrint, invoicePrintSetup } from "../lib/services/print";
import { recordAdvance } from "../lib/services/billing";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { saveMaster } from "../lib/services/master-forms";
import { importMasters } from "../lib/services/migration";
import { globalSearch } from "../lib/services/search";
import { stockList } from "../lib/services/stock";
import { masters } from "../lib/services/masters";
import { matchCode } from "../lib/scan-match";

before(async () => { await resetTestDb(); });
after(async () => { await closePool(); });

const base = { description: "Spark plug Iridium", category: "parts", uom: "EA", list_price: "40", vat_code: "SR", item_type: "stock" };

test("IN-01: a part keeps its barcode, OEM and other part numbers and the vehicles it fits; a barcode belongs to one part only", async () => {
  const admin = await ctxFor("admin", "YAS");
  await saveMaster(admin, "items", { ...base, part_no: "SPK-IR-01", barcode: "8801234567893", oem_part_no: "90919-01253", alt_part_nos: "NGK ILKAR7B11, Denso FK20HR11", fits_vehicles: "Toyota Camry 2018-2023" });
  const r = (await adminQuery("SELECT barcode, oem_part_no, search_codes FROM item WHERE part_no = 'SPK-IR-01'"))[0];
  assert.equal(r.oem_part_no, "90919-01253");
  assert.equal(r.search_codes, "SPK-IR-01|8801234567893|90919-01253|NGK ILKAR7B11|DENSO FK20HR11");
  await assert.rejects(saveMaster(admin, "items", { ...base, part_no: "SPK-IR-02", barcode: "8801234567893" }),
    (e: unknown) => e instanceof AppError && /Another part already has this barcode/.test(e.message));
  await assert.rejects(saveMaster(admin, "items", { ...base, part_no: "SPK-IR-03", barcode: "88 01#" }), (e: unknown) => e instanceof AppError && /Barcode is not in the right format/.test(e.message));
  // Two parts without a barcode are fine.
  await saveMaster(admin, "items", { ...base, part_no: "SPK-IR-04" });
  await saveMaster(admin, "items", { ...base, part_no: "SPK-IR-05", barcode: "" });
});

test("IN-01: the item import takes barcode, OEM number and fitment columns", async () => {
  const admin = await ctxFor("admin", "YAS");
  const csv = "Part no,Description,Category,Unit,List price,Tax code,Item type,Barcode,OEM part no.,Fits vehicles\nFLT-CAB-01,Cabin filter,parts,EA,55,SR,stock,6291234567890,87139-0N010,Toyota Land Cruiser 2008-2021";
  const res = await importMasters(admin, "items", csv);
  assert.equal(res.created, 1, res.errors.join("; "));
  const r = (await adminQuery("SELECT barcode, oem_part_no, fits_vehicles FROM item WHERE part_no = 'FLT-CAB-01'"))[0];
  assert.deepEqual([r.barcode, r.oem_part_no, r.fits_vehicles], ["6291234567890", "87139-0N010", "Toyota Land Cruiser 2008-2021"]);
});

test("IN-01 / UX-03: search finds a part by barcode, OEM number, aftermarket number and vehicle", async () => {
  const store = await ctxFor("anil", "YAS");
  for (const q of ["8801234567893", "90919-01253", "ilkar7b11", "Camry 2018"]) {
    const hits = (await globalSearch(store, q)).filter((h) => h.type === "Part");
    assert.ok(hits.some((h) => h.label === "SPK-IR-01"), `search ${q}`);
  }
  // The seeded oil filter is on the stock list under its barcode and its Bosch number.
  assert.ok((await stockList(store, "4987654321012")).some((r) => r.part_no === "FLT-OIL-90915"));
  assert.ok((await stockList(store, "0986af0123")).some((r) => r.part_no === "FLT-OIL-90915"));
  assert.ok(!(await stockList(store, "4987654321012")).some((r) => r.part_no !== "FLT-OIL-90915"));
});

test("IN-07: a scanned or typed code picks one part only", async () => {
  const m = await masters(await ctxFor("anil", "YAS"));
  const pick = (c: string) => matchCode(c, m.items as { codes: string; part_no: string }[])?.part_no ?? null;
  assert.equal(pick("4987654321012"), "FLT-OIL-90915");      // barcode
  assert.equal(pick(" 90915-yzze1 "), "FLT-OIL-90915");     // OEM, any case and spaces
  assert.equal(pick("0986AF0123"), "FLT-OIL-90915");        // aftermarket number without the brand
  assert.equal(pick("C26003"), "FLT-AIR-17801");            // "MANN C 26003" without spaces
  assert.equal(pick("brk-pad"), "BRK-PAD-FR-LC");           // a unique start of a part number
  assert.equal(pick("FLT-"), null);                          // more than one part starts this way
  assert.equal(pick("0000000000000"), null);
});

// ---------------------------------------------------------------- OT-08 print layouts

test("OT-08: quotation, job card and receipt print in the language the admin set, with the admin's terms and Arabic names", async () => {
  const YAS = await branchId("YAS");
  const priya = await ctxFor("priya", "YAS");
  const q = (await adminQuery("SELECT q.id, q.job_card_id FROM quotation q WHERE q.branch_id = $1 AND q.job_card_id IS NOT NULL LIMIT 1", [YAS]))[0];
  await adminQuery("UPDATE service SET name_ar = 'تغيير زيت المحرك' WHERE id IN (SELECT service_id FROM job_line WHERE job_card_id = $1 AND service_id IS NOT NULL)", [q.job_card_id]);
  const qp = await quotationPrint(priya, q.id);
  assert.equal(qp.setup.lang, "both");
  assert.match(qp.setup.terms.ar, /الأسعار/);
  assert.equal(qp.setup.company.name_ar, "سوبر فكس لصيانة السيارات");
  const jp = await jobCardPrint(priya, q.job_card_id);
  assert.ok(Object.values(jp.names).includes("تغيير زيت المحرك"));
  assert.match(jp.setup.terms.en, /valuables/);

  // A branch can print Arabic only.
  await adminQuery("INSERT INTO setting (key, value, grp, description, branch_id) VALUES ('print.language', '\"ar\"', 'Printing', 'Language', $1)", [YAS]);
  assert.equal((await jobCardPrint(priya, q.job_card_id)).setup.lang, "ar");
  await adminQuery("DELETE FROM setting WHERE key = 'print.language' AND branch_id = $1", [YAS]);

  const cust = (await adminQuery("SELECT customer_id FROM job_card WHERE id = $1", [q.job_card_id]))[0].customer_id;
  const adv = await recordAdvance(priya, { customer_id: cust, job_card_id: q.job_card_id, method: "card", amount: "52.50", reference: "SLIP-P1", idempotency_key: crypto.randomUUID() });
  const rid = (await adminQuery("SELECT id FROM receipt WHERE doc_no = $1", [(adv as { docNo?: string; doc_no?: string }).docNo ?? (adv as { doc_no?: string }).doc_no]))[0]?.id
    ?? (await adminQuery("SELECT id FROM receipt WHERE reference = 'SLIP-P1'"))[0].id;
  const rp = await receiptPrint(priya, rid);
  assert.equal(rp.r.kind, "advance"); assert.equal(rp.r.amount, "52.50"); assert.match(rp.setup.terms.en, /Thank you/);

  // Another branch's staff cannot print YAS documents; a technician cannot print the priced quotation.
  const omar = await ctxFor("omar", "QUS");
  await assert.rejects(receiptPrint(omar, rid), (e: unknown) => e instanceof AppError);
  await assert.rejects(quotationPrint(omar, q.id), (e: unknown) => e instanceof AppError);
  await assert.rejects(quotationPrint(await ctxFor("ramesh", "YAS"), q.id), (e: unknown) => e instanceof AppError);

  // The invoice setup reads the same settings for the share link.
  const inv = await invoicePrintSetup(YAS, []);
  assert.match(inv.setup.terms.en, /maker's warranty/);
});
