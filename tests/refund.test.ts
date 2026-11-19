// Paying back money held for a customer (UAT open item: a real cash or card refund).
import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import * as bl from "../lib/services/billing";
import * as bm from "../lib/services/billing-more";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const key = () => crypto.randomUUID();
const one = async (sql: string, p: unknown[] = []) => (await adminQuery(sql, p))[0];
let cust: string;

before(async () => { await resetTestDb(true); cust = await id("customer", "first_name = $1", ["Fatima"]); });
after(async () => { await closePool(); });

test("a manager pays a deposit back in cash: VAT reversed, books balance, drawer expects less, no double payout", async () => {
  const priya = await ctxFor("priya", "YAS"), yousef = await ctxFor("yousef", "YAS");
  const adv = await bl.recordAdvance(priya, { customer_id: cust, method: "card", amount: "210.00", reference: "SLIP-R1", idempotency_key: key() });
  const a = await one("SELECT id FROM customer_advance WHERE source_id = $1", [adv.id]);
  // An advisor cannot pay money out; a reason is needed; not more than is held.
  await rejects(bl.refundAdvance(priya, { advance_id: a.id, amount: "10", method: "cash", reason: "test", idempotency_key: key() }), "forbidden");
  await rejects(bl.refundAdvance(yousef, { advance_id: a.id, amount: "10", method: "cash", reason: "", idempotency_key: key() }), "validation");
  await rejects(bl.refundAdvance(yousef, { advance_id: a.id, amount: "210.01", method: "cash", reason: "x", idempotency_key: key() }), "validation");
  await rejects(bl.refundAdvance(yousef, { advance_id: a.id, amount: "10", method: "cheque", reason: "x", idempotency_key: key() }), "validation");

  const before = await bm.cashToday(yousef);
  const k = key();
  const r1 = await bl.refundAdvance(yousef, { advance_id: a.id, amount: "105.00", method: "cash", reason: "Job cancelled", idempotency_key: k });
  assert.equal(r1.vat, "5.00");
  const again = await bl.refundAdvance(yousef, { advance_id: a.id, amount: "105.00", method: "cash", reason: "Job cancelled", idempotency_key: k });
  assert.equal(again.id, r1.id, "same key returns the first refund");
  await rejects(bl.refundAdvance(yousef, { advance_id: a.id, amount: "100.00", method: "cash", reason: "x", idempotency_key: k }), "conflict");
  const after1 = await bm.cashToday(yousef);
  assert.equal(Number(after1.cash), Number(before.cash) - 105, "the drawer expects the refunded cash to be gone");

  // The rest by card takes the remaining VAT, so nothing is stranded.
  const r2 = await bl.refundAdvance(yousef, { advance_id: a.id, amount: "105.00", method: "card", reference: "VOID-22", reason: "Job cancelled", idempotency_key: key() });
  assert.equal(r2.vat, "5.00");
  const left = await one("SELECT amount - used_amount l FROM customer_advance WHERE id = $1", [a.id]);
  assert.equal(Number(left.l), 0);
  await rejects(bl.refundAdvance(yousef, { advance_id: a.id, amount: "0.01", method: "cash", reason: "x", idempotency_key: key() }), "validation");

  const refundVat = await one(`SELECT coalesce(sum(jl.debit - jl.credit), 0) n FROM journal_line jl JOIN account_mapping m ON m.account_id = jl.account_id JOIN journal j ON j.id = jl.journal_id
     WHERE m.event_key = 'vat_output' AND j.source_type = 'refund' AND j.source_id = $1`, [a.id]);
  assert.equal(Number(refundVat.n), 10, "all of the deposit's VAT is reversed");
  assert.equal((await adminQuery("SELECT journal_id FROM journal_line GROUP BY journal_id HAVING sum(debit) <> sum(credit)")).length, 0);
  // Refund rows are append-only.
  await assert.rejects(adminQuery("UPDATE customer_refund SET amount = 1 WHERE id = $1", [r1.id]));
});

test("money held at another branch is paid back there, not here", async () => {
  const priya = await ctxFor("priya", "YAS"), saeedQus = await ctxFor("saeed", "QUS");
  const adv = await bl.recordAdvance(priya, { customer_id: cust, method: "card", amount: "50.00", reference: "SLIP-R2", idempotency_key: key() });
  const a = await one("SELECT id FROM customer_advance WHERE source_id = $1", [adv.id]);
  await rejects(bl.refundAdvance(saeedQus, { advance_id: a.id, amount: "10", method: "cash", reason: "x", idempotency_key: key() }), "validation", /another branch/);
});
