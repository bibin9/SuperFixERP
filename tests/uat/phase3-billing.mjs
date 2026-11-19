// Phase 3 billing in the browser: release gate, invoice with QR, part and full payment, customer invoice link,
// delivery after payment closes the job, credit note with approval, counter sale, deposit with VAT, cash closing,
// VAT return and FTA audit file. Needs the app on :3000 and a fresh demo database.
// Run: node tests/uat/phase3-billing.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; (await import("node:fs")).mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(1000); await p.waitForLoadState("networkidle"); };
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const body = async (p) => (await p.locator("body").innerText());
let pass = 0, fail = 0;
const results = [];
const step = async (name, fn) => {
  const id = name.split(" ")[0];
  try { const r = await fn(); pass++; results.push({ id, status: "Pass", note: String(r ?? "") }); console.log("PASS", name, r ?? ""); }
  catch (e) { fail++; results.push({ id, status: "Fail", note: String(e.message).split("\n")[0] }); console.log("FAIL", name, String(e.message).split("\n")[0]); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

const priya = await as("priya");
let jobUrl, invUrl, shareLink;
await step("TC-P3-01 unpaid car cannot be handed over", async () => {
  await priya.goto(B + "/jobs"); await priya.click("a:has-text('YAS-1483')"); await settle(priya); jobUrl = priya.url();
  const t = await body(priya); must(/still owed/i.test(t), "no owed warning"); must(!(await priya.locator("button:has-text('Deliver the car')").count()), "deliver button shown while unpaid");
  await priya.screenshot({ path: `${EV}/p3-release-blocked.png`, fullPage: true }); return "owed warning shown, no Deliver button";
});
await step("TC-P3-02 invoice draft and post: simplified invoice, QR, amount in words", async () => {
  await priya.click("a:has-text('Prepare the invoice')"); await settle(priya);
  must((await priya.locator("input[name=line_id]").count()) >= 2, "line checkboxes missing");
  await priya.click("button:has-text('Post invoice')"); await settle(priya); invUrl = priya.url();
  const t = await body(priya); must(/Simplified Tax Invoice/.test(t), "title"); must(/dirhams/i.test(t), "amount in words");
  must(await priya.locator("img[alt='Invoice QR code']").count(), "QR missing");
  await priya.screenshot({ path: `${EV}/p3-invoice.png`, fullPage: true }); return await flash(priya);
});
await step("TC-P3-03 part payment by card, then the rest in cash", async () => {
  await priya.selectOption("select[name=method]", "card"); await priya.fill("input[name=amount]", "200"); await priya.fill("input[name=reference]", "SLIP-9001");
  await priya.click("button:has-text('Record payment')"); await settle(priya); const f1 = await flash(priya); must(/posted/i.test(f1), f1);
  await priya.selectOption("select[name=method]", "cash"); await priya.click("button:has-text('Record payment')"); await settle(priya);
  const f2 = await flash(priya); must(/posted/i.test(f2), f2); must(!(await priya.locator("button:has-text('Record payment')").count()), "still open"); return f2;
});
await step("TC-P3-04 WhatsApp message with the customer's invoice link (manual send)", async () => {
  await priya.click("button:has-text('Prepare WhatsApp')"); await settle(priya);
  const m = await priya.locator("pre.msg").innerText(); const link = m.match(/http\S+\/i\/[0-9a-f]{32}/); must(link, "no link in message: " + m); shareLink = link[0];
  return m.slice(0, 90) + "…";
});
await step("TC-P3-05 customer opens the invoice link without signing in", async () => {
  const c = await browser.newContext(); const p = await c.newPage(); await p.goto(shareLink); const t = await body(p);
  must(/Tax Invoice/.test(t) && /YAS-INV-/.test(t), "invoice not shown"); await p.screenshot({ path: `${EV}/p3-public-invoice.png`, fullPage: true }); await c.close(); return "shown";
});
await step("TC-P3-06 paid car is delivered and the job closes", async () => {
  await priya.goto(jobUrl); await settle(priya); must(/Nothing is owed/i.test(await body(priya)), "release not clear");
  for (const cb of await priya.locator("input[name^=chk_]").all()) await cb.check();
  await priya.selectOption("select[name=old_parts]", "returned"); await priya.fill("input[name=received_by_name]", "Fatima");
  await priya.click("button:has-text('Deliver the car')"); await settle(priya);
  const t = await body(priya); must(/Closed/.test(t), "job not closed: " + (await flash(priya))); return "Closed";
});
let cnUrl;
await step("TC-P3-07 credit note for one returned item goes for approval, no number yet", async () => {
  await priya.goto(invUrl); await priya.click("a[href$='/credit-note']"); await settle(priya);
  const row = priya.locator("tr", { hasText: "Engine oil" }).first(); must(await row.count(), "oil line not found");
  await row.locator("input[name^='qty[']").fill("1"); await row.locator("select[name^='stock[']").selectOption("restock");
  await priya.selectOption("select[name=reason]", "goods_returned"); await priya.click("button:has-text('Create credit note')"); await settle(priya); cnUrl = priya.url();
  const t = await body(priya); must(/Not numbered until approved/.test(t), "numbered early"); return await flash(priya);
});
const yousef = await as("yousef");
await step("TC-P3-08 branch manager approves; the credit note is numbered and posted", async () => {
  await yousef.goto(B + "/approvals"); const item = yousef.locator("div", { hasText: "Credit for" }).last(); must(await item.count(), "not in inbox");
  await yousef.locator("form:has(button:has-text('Approve'))").first().locator("button:has-text('Approve')").click(); await settle(yousef);
  await priya.goto(cnUrl); const t = await body(priya); must(/YAS-CN-\d{2}-\d{6}/.test(t) && /Posted/.test(t), "not posted");
  await priya.screenshot({ path: `${EV}/p3-credit-note.png`, fullPage: true }); return t.match(/YAS-CN-\d{2}-\d{6}/)[0];
});
await step("TC-P3-09 counter sale to a walk-in, VAT-inclusive, paid in cash", async () => {
  await priya.goto(B + "/billing/counter-sale"); const v = await priya.locator("select[name=item_id] option", { hasText: "OIL-5W30-L" }).first().getAttribute("value");
  await priya.locator("select[name=item_id]").first().selectOption(v); await priya.locator("input[name=qty]").first().fill("2");
  must((await priya.locator("[data-testid=counter-total]").innerText()) === "67.20", "live total wrong");
  await priya.fill("input[name=bill_to_name]", "Ali"); await priya.selectOption("select[name=method]", "cash"); await priya.click("button:has-text('Post sale')"); await settle(priya);
  const t = await body(priya); must(/Simplified Tax Invoice/.test(t) && /67\.20/.test(t), "invoice wrong: " + (await flash(priya))); return await flash(priya);
});
await step("TC-P3-10 discount above the advisor's limit is refused", async () => {
  await priya.goto(B + "/billing/counter-sale"); const v = await priya.locator("select[name=item_id] option", { hasText: "OIL-5W30-L" }).first().getAttribute("value");
  await priya.locator("select[name=item_id]").first().selectOption(v); await priya.locator("input[name=qty]").first().fill("2"); await priya.locator("input[name=discount]").first().fill("10");
  await priya.click("button:has-text('Post sale')"); await settle(priya); const f = await flash(priya); must(/above your limit/i.test(f), f); return f;
});
await step("TC-P3-11 deposit on an open job with VAT shown", async () => {
  await priya.goto(B + "/jobs"); await priya.click("a:has-text('YAS-1484')"); await settle(priya); await priya.click("summary:has-text('take a deposit')"); await priya.click("a:has-text('Take deposit')"); await settle(priya);
  await priya.selectOption("select[name=method]", "card"); await priya.fill("input[name=amount]", "105"); await priya.fill("input[name=reference]", "SLIP-DEP");
  await priya.click("button:has-text('Receive deposit')"); await settle(priya); const f = await flash(priya); must(/VAT AED 5\.00/.test(f), f); return f;
});
await step("TC-P3-12 cheques register opens", async () => { await yousef.goto(B + "/billing/cheques"); return (await yousef.locator("h1").innerText()); });
await step("TC-P3-13 cashier closes the day with a short count and a note; manager signs off", async () => {
  await priya.goto(B + "/billing/cash"); const t = await body(priya); const cash = Number(t.match(/Cash taken by you today: (?:AED )?([\d,.]+)/)?.[1].replace(/,/g, "")); must(cash > 0, "no cash");
  await priya.fill("input[name='count[100]']", String(Math.floor(cash / 100))); await priya.click("button:has-text('Close my cash')"); await settle(priya);
  must(/note/i.test(await flash(priya)), "difference without note accepted");
  await priya.fill("input[name='count[100]']", String(Math.floor(cash / 100))); await priya.fill("input[name=note]", "Counted twice"); await priya.click("button:has-text('Close my cash')"); await settle(priya);
  await yousef.goto(B + "/billing/cash"); await yousef.click("button:has-text('Sign off')"); await settle(yousef); const f = await flash(yousef); must(/signed off/i.test(f), f);
  await yousef.screenshot({ path: `${EV}/p3-cash.png`, fullPage: true }); return f;
});
const saeed = await as("saeed");
await step("TC-P3-14 VAT return agrees with the ledger and drills down", async () => {
  await saeed.goto(B + "/accounts/vat"); const t = await body(saeed); must(/agrees with the ledger/.test(t), "ledger mismatch");
  await saeed.click("a:has-text('1a')"); await settle(saeed); must(await saeed.locator("a:has-text('YAS-INV-')").count(), "no drill-down documents");
  await saeed.screenshot({ path: `${EV}/p3-vat201.png`, fullPage: true }); return "box 1a lists the invoices";
});
await step("TC-P3-15 FTA audit file downloads as CSV", async () => {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }); const r = await saeed.request.get(`${B}/api/faf?from=${day}&to=${day}`);
  must(r.status() === 200, "status " + r.status()); const csv = await r.text(); must(/-INV-/.test(csv), "no invoices"); return `${csv.split("\n").length} lines`;
});
await step("TC-P3-16 advisor cannot open the VAT return", async () => {
  await priya.goto(B + "/accounts/vat"); const t = await body(priya); must(/could not be shown|permission/i.test(t) && !/VAT 201/.test(t), "advisor saw VAT return"); return "refused";
});
await step("TC-P3-17 menu shows Billing items", async () => {
  await priya.goto(B + "/invoices"); const t = await priya.locator("nav, .side").first().innerText(); must(/Counter sale/.test(t) && /Cash closing/.test(t), "menu items missing"); return "ok";
});
(await import("node:fs")).writeFileSync(process.env.P3_RESULTS || "/tmp/p3-results.json", JSON.stringify(results, null, 1));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
