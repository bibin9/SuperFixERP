import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, appQueryAs, branchId, id } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { prepareMessage, confirmMessageSent } from "../lib/services/messaging";
import { saveMaster, setMasterActive, getMaster, MASTERS } from "../lib/services/master-forms";
import { recordReceipt, postInvoice } from "../lib/services/billing";
import { AppError } from "../lib/errors";

const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("messages are manual only: prepared, sent by staff, then marked as sent; nothing automatic can be stored (FSD v0.10)", async () => {
  const priya = await ctxFor("priya", "YAS");
  const enq = await id("enquiry", "doc_no = $1", ["YAS-ENQ-26-00001"]);
  const m = await prepareMessage(priya, { enquiryId: enq }, "enquiry_reply");
  assert.match(m.url, /^https:\/\/wa\.me\/966\d+\?text=/);
  assert.match(m.text, /Dear Mr Faisal/);
  const row = (await adminQuery("SELECT * FROM message_log WHERE id = $1", [m.id]))[0];
  assert.equal(row.mode, "manual");
  assert.equal(row.status, "prepared");
  const sara = await ctxFor("sara", "QUS");
  await assert.rejects(confirmMessageSent(sara, m.id)); // another branch cannot touch it
  await confirmMessageSent(priya, m.id);
  const after = (await adminQuery("SELECT * FROM message_log WHERE id = $1", [m.id]))[0];
  assert.equal(after.status, "sent_manually");
  assert.ok(after.confirmed_by);
  const yas = await branchId("YAS");
  await assert.rejects(appQueryAs([yas], "UPDATE branch SET whatsapp_mode = 'automatic' WHERE id = $1", [yas]));
  await assert.rejects(appQueryAs([yas], "INSERT INTO message_log (branch_id, event, body, mode) VALUES ($1,'x','x','automatic')", [yas]));
  assert.equal((await adminQuery("SELECT value FROM setting WHERE key = 'payments.gateway'"))[0].value, "manual");
});

test("master forms: only settings users can change them; changes are audited; deactivated values stop being offered", async () => {
  const priya = await ctxFor("priya", "YAS");
  await rejects(saveMaster(priya, "payment-methods", { code: "wallet", name: "Wallet", posting_event: "card_clearing" }), "forbidden");
  assert.equal((await adminQuery("SELECT count(*) n FROM payment_method WHERE code = 'wallet'"))[0].n, "0");
  const admin = await ctxFor("admin", "HQ");
  await saveMaster(admin, "payment-methods", { code: "wallet", name: "Mobile wallet", posting_event: "card_clearing", needs_reference: "on", sort: "5" });
  await rejects(saveMaster(admin, "payment-methods", { code: "wallet", name: "Again", posting_event: "card_clearing" }), "conflict");
  await rejects(saveMaster(admin, "tax-codes", { code: "XX", name: "Bad", rate: "1.5" }), "validation");
  assert.equal((await adminQuery("SELECT count(*) n FROM tax_code WHERE code = 'XX'"))[0].n, "0");
  const audit = await adminQuery("SELECT action FROM audit_log WHERE entity = 'master:payment_method' AND entity_id = 'wallet'");
  assert.deepEqual(audit.map((a) => a.action), ["create"]);
  // Edit keeps the key and logs the change.
  await saveMaster(admin, "payment-methods", { name: "Wallet (Apple/Google Pay)", posting_event: "card_clearing", needs_reference: "on", sort: "5" }, JSON.stringify(["wallet"]));
  assert.equal((await adminQuery("SELECT name FROM payment_method WHERE code = 'wallet'"))[0].name, "Wallet (Apple/Google Pay)");

  // The new method works for a payment, needs its reference, and stops working once deactivated.
  const job = await id("job_card", "doc_no = $1", ["YAS-1483"]);
  const inv = await postInvoice(priya, job, crypto.randomUUID());
  await rejects(recordReceipt(priya, { invoice_id: inv.id, method: "wallet", amount: "10.00", idempotency_key: crypto.randomUUID() }), "validation");
  await recordReceipt(priya, { invoice_id: inv.id, method: "wallet", amount: "10.00", reference: "AP-1", idempotency_key: crypto.randomUUID() });
  await setMasterActive(admin, "payment-methods", JSON.stringify(["wallet"]), false);
  await rejects(recordReceipt(priya, { invoice_id: inv.id, method: "wallet", amount: "10.00", reference: "AP-2", idempotency_key: crypto.randomUUID() }), "validation");
  assert.ok((await adminQuery("SELECT action FROM audit_log WHERE entity = 'master:payment_method' ORDER BY id")).some((a) => a.action === "deactivate"));

  // Every registered master opens for an admin.
  for (const m of MASTERS) assert.ok((await getMaster(admin, m.key)).rows.length > 0, m.key);
});
