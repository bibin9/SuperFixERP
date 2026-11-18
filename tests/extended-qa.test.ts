// Codex extended QA (18/11/2026): SEC-01, PERF-01, DATA-01, SEC-03, FILE-02.
import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { saveRecord } from "../lib/services/hr";
import { getAttachment, contentMatches } from "../lib/services/purchasing";
import { issueToJobLine } from "../lib/services/stock";
import * as bl from "../lib/services/billing";
import * as bm from "../lib/services/billing-more";
import { csvCell } from "../lib/csv";
import "../lib/services/workflow-handlers";

const key = () => crypto.randomUUID();
const one = async (sql: string, p: unknown[] = []) => (await adminQuery(sql, p))[0];
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("SEC-01: an employee file opens for HR and the employee, never for a technician or another branch", async () => {
  const hr = await ctxFor("fatima.hr");
  const emp = await one("SELECT e.id, e.user_id FROM employee e JOIN app_user u ON u.id = e.user_id WHERE u.username = 'yousef'");
  const docType = (await one("SELECT code FROM lookup_value WHERE list = 'hr_document_type' ORDER BY code LIMIT 1")).code;
  await saveRecord(hr, emp.id, "document", { doc_type: docType, number: "P-PRIVATE-1" }, { name: "passport.png", type: "image/png", bytes: PNG });
  const att = (await one("SELECT attachment_id FROM employee_record WHERE employee_id = $1 AND data->>'number' = 'P-PRIVATE-1'", [emp.id])).attachment_id;
  assert.ok(att);
  assert.ok((await getAttachment(hr, att)).content.length > 0, "HR may open it");
  assert.ok((await getAttachment(await ctxFor("yousef"), att)).content.length > 0, "the employee may open their own file");
  await rejects(getAttachment(await ctxFor("ramesh"), att), "not_found");       // same-branch technician
  await rejects(getAttachment(await ctxFor("priya"), att), "not_found");        // same-branch advisor without HR view
  await rejects(getAttachment(await ctxFor("omar"), att), "not_found");         // another branch
  await rejects(getAttachment(hr, crypto.randomUUID()), "not_found");
});

test("FILE-02: a file must really be the type it claims", async () => {
  assert.ok(contentMatches("image/png", PNG));
  assert.ok(contentMatches("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(contentMatches("application/pdf", Buffer.from("%PDF-1.7\n")));
  assert.ok(!contentMatches("application/pdf", Buffer.from("not a pdf at all")));
  assert.ok(!contentMatches("image/png", Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  const hr = await ctxFor("fatima.hr");
  const emp = await one("SELECT e.id FROM employee e JOIN app_user u ON u.id = e.user_id WHERE u.username = 'ramesh'");
  const docType = (await one("SELECT code FROM lookup_value WHERE list = 'hr_document_type' ORDER BY code LIMIT 1")).code;
  await rejects(saveRecord(hr, emp.id, "document", { doc_type: docType, number: "X-1" }, { name: "x.pdf", type: "application/pdf", bytes: Buffer.from("<html>hello</html>") }), "validation", /content does not match/);
});

test("SEC-03: CSV cells that look like formulas are kept as text; numbers stay numbers", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+971 50 123"), "'+971 50 123");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("  =HYPERLINK(\"x\")"), `"'  =HYPERLINK(""x"")"`);
  assert.equal(csvCell("-12.50"), "-12.50");
  assert.equal(csvCell(-3), "-3");
  assert.equal(csvCell("Ali, Dubai"), '"Ali, Dubai"');
  assert.equal(csvCell("=1+1", true), `"'=1+1"`);
});

test("DATA-01: a payment key reused with another cheque bank or date, or an advance key at another branch, is refused", async () => {
  const priya = await ctxFor("priya", "YAS");
  const fleet = await id("customer", "company_name = $1", ["Emirates Fleet Services LLC"]);
  const oil = (await one("SELECT id FROM item WHERE part_no = 'FLT-OIL-90915'")).id;
  const inv = await bm.postCounterSale(priya, { customer_id: fleet, lines: [{ item_id: oil, qty: "1" }], payment: null, idempotency_key: key() });
  const later = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), later2 = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  {
    const k = key();
    const base = { invoice_id: inv.id, method: "cheque", amount: "1.00", cheque_no: "000123", cheque_bank: "ADCB", cheque_date: later, idempotency_key: k };
    await bl.recordReceipt(priya, base);
    assert.equal((await bl.recordReceipt(priya, base)).duplicate, true);
    await rejects(bl.recordReceipt(priya, { ...base, cheque_bank: "ENBD" }), "conflict");
    await rejects(bl.recordReceipt(priya, { ...base, cheque_date: later2 }), "conflict");
  }
  const cust = await id("customer", "first_name = $1", ["Fatima"]);
  const yousefYas = await ctxFor("yousef", "YAS");
  const k2 = key();
  await bl.recordAdvance(yousefYas, { customer_id: cust, method: "card", amount: "50.00", reference: "ADV-1", idempotency_key: k2 });
  const saeedQus = await ctxFor("saeed", "QUS");
  const saeedYas = await ctxFor("saeed", "YAS");
  await rejects(bl.recordAdvance(saeedQus, { customer_id: cust, method: "card", amount: "50.00", reference: "ADV-1", idempotency_key: k2 }), "conflict");
  await rejects(bl.recordAdvance(saeedYas, { customer_id: cust, method: "card", amount: "50.00", reference: "ADV-1", idempotency_key: k2 }), "conflict"); // another user
});

test("PERF-01: counter sales, payments and stock issues on one shared item and invoice run together with no deadlock", async () => {
  const YAS = await branchId("YAS");
  const priya = await ctxFor("priya", "YAS"), anil = await ctxFor("anil", "YAS");
  const oil = (await one("SELECT id FROM item WHERE part_no = 'FLT-OIL-90915'")).id;
  await adminQuery("UPDATE stock_balance SET on_hand = on_hand + 500 WHERE item_id = $1 AND branch_id = $2", [oil, YAS]);
  const due = await bm.postCounterSale(priya, { bill_to_name: "Load", lines: [{ item_id: oil, qty: "1" }], payment: { method: "cash", amount: "0.01", idempotency_key: "" }, idempotency_key: key() })
    .then(() => "", (e: AppError) => /AED ([\d.,]+)/.exec(e.message)![1].replace(/,/g, "").replace(/\.$/, ""));
  // an open credit invoice for the fleet customer, to take many small payments against
  const fleet = await id("customer", "company_name = $1", ["Emirates Fleet Services LLC"]);
  const target = (await bm.postCounterSale(priya, { customer_id: fleet, lines: [{ item_id: oil, qty: "2" }], payment: null, idempotency_key: key() })).id;
  // open part lines that still have something to issue at YAS
  const lines = await adminQuery(`SELECT l.id FROM job_line l JOIN job_card j ON j.id = l.job_card_id WHERE l.branch_id = $1 AND l.item_id IS NOT NULL AND l.approval_status = 'approved'
                                   AND NOT l.removed AND l.issued_qty < l.qty AND j.status NOT IN ('invoiced','closed','cancelled')`, [YAS]);
  const dl = async () => Number((await one("SELECT deadlocks n FROM pg_stat_database WHERE datname = current_database()")).n);
  const before = await dl();
  const work: Promise<unknown>[] = [];
  for (let i = 0; i < 15; i++) {
    work.push(bm.postCounterSale(priya, { bill_to_name: `Load ${i}`, lines: [{ item_id: oil, qty: "1" }], payment: { method: "cash", amount: due, idempotency_key: "" }, idempotency_key: key() }));
    work.push(bl.recordReceipt(priya, { invoice_id: target, method: "card", amount: "0.01", reference: `L${i}`, idempotency_key: key() }));
    if (lines[i]) work.push(issueToJobLine(anil, lines[i].id, "0.001", key()));
  }
  const rs = await Promise.allSettled(work);
  const failed = rs.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message));
  assert.deepEqual(failed, []);
  await new Promise((r) => setTimeout(r, 600)); // pg_stat counters are flushed asynchronously
  assert.equal(await dl() - before, 0, "PostgreSQL recorded a deadlock");
  assert.equal((await adminQuery("SELECT journal_id FROM journal_line GROUP BY journal_id, branch_id HAVING sum(debit) <> sum(credit)")).length, 0);
});
