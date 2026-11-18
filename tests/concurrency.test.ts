import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { addEnquiryLine, changeStatus } from "../lib/services/jobs";
import { createEnquiry, createJobCard } from "../lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff } from "../lib/services/quotations";
import { inbox, act } from "../lib/services/workflow";
import { issueToJobLine } from "../lib/services/stock";
import * as ws from "../lib/services/workshop";
import * as bl from "../lib/services/billing";
import * as bm from "../lib/services/billing-more";
import "../lib/services/workflow-handlers";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const key = () => crypto.randomUUID();
let items: Record<string, string>, svc: Record<string, string>, YAS: string, cust: string, veh: string, fleet: string, walkIn: string;
const one = async (sql: string, p: unknown[] = []) => (await adminQuery(sql, p))[0];
const balancedEverywhere = async () => assert.equal((await adminQuery("SELECT journal_id FROM journal_line GROUP BY journal_id, branch_id HAVING sum(debit) <> sum(credit)")).length, 0);

before(async () => {
  await resetTestDb(true);
  items = Object.fromEntries((await adminQuery("SELECT part_no, id FROM item")).map((r) => [r.part_no, r.id]));
  svc = Object.fromEntries((await adminQuery("SELECT code, id FROM service")).map((r) => [r.code, r.id]));
  YAS = await branchId("YAS");
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  veh = await id("vehicle", "plate_number = $1", ["77120"]);
  fleet = await id("customer", "company_name = $1", ["Emirates Fleet Services LLC"]);
  walkIn = await id("customer", "is_walk_in", []);
});
after(async () => { await closePool(); });

let odo = 500000;
/** A job at YAS: brake labour plus the given parts, approved, parts issued, QC passed, Ready. */
async function readyJob(parts: [string, string][], issue = true) {
  const priya = await ctxFor("priya", "YAS");
  const e = await createEnquiry(priya, { customer_id: cust, vehicle_id: veh, service_asked: "test", source: "walk_in" });
  await addEnquiryLine(priya, e.id, { line_type: "labour", service_id: svc["BRK-FR"] });
  for (const [p, q] of parts) await addEnquiryLine(priya, e.id, { line_type: "part", item_id: items[p], qty: q });
  const qt = await saveQuotation(priya, e.id, {});
  await sendQuotation(priya, qt.id);
  const ql = await adminQuery("SELECT id FROM quotation_line WHERE quotation_id = $1", [qt.id]);
  await recordDecisionsByStaff(priya, qt.id, Object.fromEntries(ql.map((l) => [l.id, "approved"])), "in_person", null);
  odo += 10;
  const j = await createJobCard(priya, e.id, { odometer_in: String(odo) });
  const lines = await adminQuery("SELECT id, line_type, item_id, qty FROM job_line WHERE job_card_id = $1 ORDER BY line_no", [j.id]);
  const anil = await ctxFor("anil", "YAS");
  if (issue) for (const l of lines.filter((x) => x.line_type === "part")) await issueToJobLine(anil, l.id, l.qty);
  else return { jobId: j.id as string, lines };
  await changeStatus(priya, j.id, "in_progress");
  await changeStatus(priya, j.id, "quality_check");
  const codes = (await adminQuery("SELECT code FROM lookup_value WHERE list = 'qc_checklist'")).map((r) => r.code);
  await ws.recordQc(await ctxFor("khalid", "YAS"), j.id, Object.fromEntries(codes.map((c) => [c, "done"])), {});
  return { jobId: j.id as string, lines };
}

const all = <T>(n: number, f: (i: number) => Promise<T>) => Promise.allSettled(Array.from({ length: n }, (_, i) => f(i)));
/** Every failure must be a controlled business answer (AppError), never a raw database error. */
const onlyControlled = (rs: PromiseSettledResult<unknown>[]) => {
  const raw = rs.filter((r) => r.status === "rejected" && !(r.reason instanceof AppError)).map((r) => String((r as PromiseRejectedResult).reason?.code ?? (r as PromiseRejectedResult).reason));
  assert.deepEqual(raw, [], "raw errors: " + raw.join(", "));
};
const ok = <T>(rs: PromiseSettledResult<T>[]) => rs.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled").map((r) => r.value);
const label = (l: { line_type: string }) => l.line_type;

test("CONC-01: a replayed partial stock issue is applied once; a new form issues again; a changed quantity under the same key is refused", async () => {
  const anil = await ctxFor("anil", "YAS");
  const { lines } = await readyJob([["FLT-OIL-90915", "2"]], false);
  const part = lines.find((l) => label(l) === "part")!.id;
  const item = lines.find((l) => label(l) === "part")!.item_id;
  const before = Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [item, YAS])).on_hand);
  const k = key();
  const rs = await all(8, () => issueToJobLine(anil, part, "1", k));
  onlyControlled(rs);
  const done = ok(rs);
  assert.equal(done.length, 8, "every replay gets the first answer");
  assert.equal(done.filter((r) => !r.duplicate).length, 1);
  assert.equal((await one("SELECT issued_qty FROM job_line WHERE id = $1", [part])).issued_qty, "1.000");
  assert.equal(Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [item, YAS])).on_hand), before - 1);
  assert.equal(Number((await one("SELECT count(*) n FROM stock_move WHERE job_line_id = $1 AND move_type = 'issue'", [part])).n), 1);
  await rejects(issueToJobLine(anil, part, "0.5", k), "conflict", /different request/);
  await issueToJobLine(anil, part, "1", key()); // the second intended issue has its own form, so its own key
  assert.equal((await one("SELECT issued_qty FROM job_line WHERE id = $1", [part])).issued_qty, "2.000");
  await balancedEverywhere();
});

test("CONC-03: forty simultaneous same-key invoice requests post one invoice and all get it back", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { jobId } = await readyJob([["FLT-OIL-90915", "1"]]);
  const k = key();
  const rs = await all(40, () => bl.postInvoice(priya, jobId, k));
  onlyControlled(rs);
  const done = ok(rs);
  assert.equal(done.length, 40);
  assert.equal(new Set(done.map((r) => r.id)).size, 1);
  assert.equal(done.filter((r) => !r.duplicate).length, 1);
  assert.equal(Number((await one("SELECT count(*) n FROM sales_invoice WHERE job_card_id = $1", [jobId])).n), 1);
  await balancedEverywhere();
});

test("CONC-04: an invoice key reused for other lines or another job is refused as a conflict, with no raw database error", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { jobId, lines } = await readyJob([["FLT-OIL-90915", "1"]]);
  const labour = lines.find((l) => label(l) === "labour")!.id, part = lines.find((l) => label(l) === "part")!.id;
  const k = key();
  const a = await bl.postInvoice(priya, jobId, k, { lineIds: [labour] });
  await rejects(bl.postInvoice(priya, jobId, k, { lineIds: [part] }), "conflict", /different request/);
  assert.equal(Number((await one("SELECT count(*) n FROM sales_invoice_line WHERE job_line_id = $1", [part])).n), 0, "the part was not billed under the old key");
  const again = await bl.postInvoice(priya, jobId, k, { lineIds: [labour] });
  assert.equal(again.id, a.id); assert.equal(again.duplicate, true);
  // the same key raced across different jobs: one posts, the rest are controlled conflicts
  const jobs: Awaited<ReturnType<typeof readyJob>>[] = []; for (let i = 0; i < 6; i++) jobs.push(await readyJob([["FLT-OIL-90915", "1"]]));
  const k2 = key();
  const rs = await all(jobs.length, (i) => bl.postInvoice(priya, jobs[i].jobId, k2));
  onlyControlled(rs);
  assert.equal(ok(rs).length, 1);
  assert.ok(rs.filter((r) => r.status === "rejected").every((r) => ((r as PromiseRejectedResult).reason as AppError).code === "conflict"));
});

test("CONC-03 payments: forty same-key payments make one receipt; same key with other amounts is a controlled conflict", async () => {
  const priya = await ctxFor("priya", "YAS");
  const { jobId } = await readyJob([["FLT-OIL-90915", "1"]]);
  const inv = await bl.postInvoice(priya, jobId, key());
  const k = key();
  const rs = await all(40, () => bl.recordReceipt(priya, { invoice_id: inv.id, method: "card", amount: "10.00", reference: "SLIP-C3", idempotency_key: k }));
  onlyControlled(rs);
  assert.equal(ok(rs).length, 40);
  assert.equal(new Set(ok(rs).map((r) => r.docNo)).size, 1);
  assert.equal(Number((await one("SELECT count(*) n FROM receipt WHERE idempotency_key = $1", [k])).n), 1);
  assert.equal((await one("SELECT paid_amount FROM sales_invoice WHERE id = $1", [inv.id])).paid_amount, "10.00");
  const k2 = key();
  const rs2 = await all(20, (i) => bl.recordReceipt(priya, { invoice_id: inv.id, method: "card", amount: `${1 + i}.00`, reference: "SLIP-C5", idempotency_key: k2 }));
  onlyControlled(rs2);
  assert.equal(ok(rs2).length, 1);
  assert.equal(Number((await one("SELECT count(*) n FROM receipt WHERE idempotency_key = $1", [k2])).n), 1);
  await balancedEverywhere();
});

test("CONC-03 counter sale: twenty same-key sales post stock, invoice and payment once", async () => {
  const priya = await ctxFor("priya", "YAS");
  const oil = items["FLT-OIL-90915"];
  const before = Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [oil, YAS])).on_hand);
  // the walk-in price comes from the price level; ask once to learn the total to pay
  const due = await bm.postCounterSale(priya, { bill_to_name: "Race", lines: [{ item_id: oil, qty: "1" }], payment: { method: "cash", amount: "0.01", idempotency_key: "" }, idempotency_key: key() })
    .then(() => "", (e: AppError) => /AED ([\d.,]+)/.exec(e.message)![1].replace(/,/g, "").replace(/\.$/, ""));
  const k = key();
  const rs = await all(20, () => bm.postCounterSale(priya, { bill_to_name: "Race", lines: [{ item_id: oil, qty: "1" }], payment: { method: "cash", amount: due, idempotency_key: "" }, idempotency_key: k }));
  onlyControlled(rs);
  assert.equal(ok(rs).length, 20);
  assert.equal(new Set(ok(rs).map((r) => r.id)).size, 1);
  assert.equal(Number((await one("SELECT on_hand FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [oil, YAS])).on_hand), before - 1);
  assert.equal(Number((await one("SELECT count(*) n FROM receipt WHERE idempotency_key = $1", [`${k}:pay`])).n), 1);
  await balancedEverywhere();
});

test("CONC-02: split invoicing and payments on the same jobs at once all complete, with no deadlock reaching the user", async () => {
  const priya = await ctxFor("priya", "YAS");
  const jobs: Awaited<ReturnType<typeof readyJob>>[] = []; for (let i = 0; i < 8; i++) jobs.push(await readyJob([["FLT-OIL-90915", "1"]]));
  const first = await Promise.all(jobs.map((j) => bl.postInvoice(priya, j.jobId, key(), { lineIds: [j.lines.find((l) => label(l) === "labour")!.id] })));
  for (let round = 0; round < 3; round++) {
    const work: Promise<unknown>[] = [];
    jobs.forEach((j, i) => {
      work.push(bl.recordReceipt(priya, { invoice_id: first[i].id, method: "card", amount: "1.00", reference: `R${round}-${i}`, idempotency_key: key() }));
      if (round === 0) work.push(bl.postInvoice(priya, j.jobId, key(), { lineIds: [j.lines.find((l) => label(l) === "part")!.id] }));
      work.push(bl.recordReceipt(priya, { invoice_id: first[i].id, method: "card", amount: "1.00", reference: `S${round}-${i}`, idempotency_key: key() }));
    });
    const rs = await Promise.allSettled(work);
    const failed = rs.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
    assert.deepEqual(failed, [], "round " + round);
  }
  for (const [i, j] of jobs.entries()) {
    assert.equal(Number((await one("SELECT count(*) n FROM sales_invoice WHERE job_card_id = $1", [j.jobId])).n), 2);
    assert.equal((await one("SELECT paid_amount FROM sales_invoice WHERE id = $1", [first[i].id])).paid_amount, "6.00");
  }
  await balancedEverywhere();
});
