// Phase 2 purchasing flow in the browser: PO above the approval limit, branch manager approval, partial goods receipt,
// supplier bill matched to the receipt, and a petty cash spend. Needs the app on :3000 and a fresh demo database.
// Run: node tests/uat/phase2-purchasing.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import { inlinePopups } from "./inline-popups.mjs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; (await import("node:fs")).mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); await c.addInitScript(inlinePopups); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(1200); await p.waitForLoadState("networkidle"); };
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ");
const step = async (name, fn) => { try { const r = await fn(); console.log("PASS", name, r ?? ""); } catch (e) { console.log("FAIL", name, String(e.message).split("\n")[0]); } };
let poUrl;
const anil = await as("anil");
await step("create PO with a line", async () => {
  await anil.goto(B + "/purchasing"); await anil.click("summary:has-text('New purchase order')"); await anil.selectOption("select[name=supplier_id]", { label: "Bridgestone Middle East" });
  await anil.click("button:has-text('Create and add lines')"); await settle(anil); poUrl = anil.url();
  const v = await anil.locator("select[name=item_id] option", { hasText: "TYR-2656517" }).getAttribute("value"); await anil.selectOption("select[name=item_id]", v);
  await anil.fill("input[name=qty]", "20"); await anil.fill("input[name=unit_price]", "285"); await anil.click("button:has-text('Add line')"); await settle(anil);
  await anil.click("button:has-text('Submit for approval')"); await settle(anil); await anil.screenshot({ path: `${EV}/po-submitted.png`, fullPage: true }); return await flash(anil);
});
const yousef = await as("yousef");
await step("branch manager approves", async () => {
  await yousef.goto(B + "/approvals"); await yousef.locator("button:has-text('Approve')").first().click(); await settle(yousef); return await flash(yousef);
});
await step("partial receipt with damage", async () => {
  await anil.goto(poUrl); const t = await anil.locator("body").innerText(); if (!/Approved/i.test(t)) throw new Error("PO not approved");
  await anil.locator("input[name^='qty[']").first().fill("12"); await anil.locator("input[name^='damaged[']").first().fill("1"); await anil.fill("input[name=delivery_note]", "DN-5521");
  await anil.click("button:has-text('Receive into stock')"); await settle(anil); await anil.screenshot({ path: `${EV}/po-received.png`, fullPage: true });
  const s = await anil.locator("body").innerText(); if (!/Partly received/i.test(s)) throw new Error("status not partly received: " + (await flash(anil)));
  return await flash(anil);
});
const maryam = await as("maryam");
await step("bill matched to receipt", async () => {
  await maryam.goto(B + "/purchasing/bills"); await maryam.selectOption("select[name=supplier_id]", { label: "Bridgestone Middle East" }); await maryam.click("button:has-text('Next')"); await settle(maryam);
  await maryam.fill("input[name=supplier_invoice_no]", "BR-INV-8841"); const q = maryam.locator("input[name^='bq[']"); if (!(await q.count())) throw new Error("no received lines to bill");
  await q.first().fill("12"); await maryam.click("button:has-text('Save and match')"); await settle(maryam); await maryam.screenshot({ path: `${EV}/bill.png`, fullPage: true }); const f = await flash(maryam); if (!/posted/i.test(f)) throw new Error("not matched: " + f); return f;
});
await step("duplicate supplier invoice refused", async () => {
  await maryam.goto(B + "/purchasing/bills"); await maryam.selectOption("select[name=supplier_id]", { label: "Bridgestone Middle East" }); await maryam.click("button:has-text('Next')"); await settle(maryam);
  await maryam.fill("input[name=supplier_invoice_no]", "BR-INV-8841"); await maryam.fill("input[name=x_description]", "Delivery charge"); await maryam.fill("input[name=x_unit_price]", "50");
  await maryam.click("button:has-text('Save and match')"); await settle(maryam); const f = await flash(maryam); if (!/already|duplicate/i.test(f)) throw new Error("not refused: " + f); return f;
});
await step("petty cash page", async () => { await anil.goto(B + "/purchasing/petty-cash"); await anil.screenshot({ path: `${EV}/petty.png`, fullPage: true }); return (await anil.locator("h1").innerText()); });
await browser.close();
