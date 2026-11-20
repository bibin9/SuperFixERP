// Phase 2 workshop flow in the browser: switch prompt, pause, clock out, issue parts, QC fail then pass, clock correction, delivery with signature.
// Needs the app on :3000 and a fresh demo database (npm run db:reset). Run: node tests/uat/phase2-workshop.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import { inlinePopups } from "./inline-popups.mjs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; (await import("node:fs")).mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user, vp = { width: 1366, height: 900 }) {
  const c = await browser.newContext({ viewport: vp }); await c.addInitScript(inlinePopups); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(1200); await p.waitForLoadState("networkidle"); };
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ");
const step = async (name, fn) => { try { const r = await fn(); console.log("PASS", name, r ?? ""); } catch (e) { console.log("FAIL", name, String(e.message).split("\n")[0]); } };
const card = (p, text) => p.locator(".techjob", { hasText: text });

const arjun = await as("arjun", { width: 390, height: 844 });
await step("switch prompt", async () => {
  await arjun.goto(B + "/my-jobs"); await card(arjun, "AC gas").locator("button:has-text('Clock in')").click(); await settle(arjun);
  const t = await card(arjun, "AC gas").innerText(); if (!/Switch to this job/.test(t)) throw new Error("no switch prompt: " + t.slice(0, 200));
  await arjun.screenshot({ path: `${EV}/flow-switch.png` });
  await card(arjun, "AC gas").locator("button:has-text('Yes, switch')").click(); await settle(arjun);
  const a = await card(arjun, "AC gas").innerText(), b = await card(arjun, "Battery").innerText();
  if (!/Working/.test(a) || !/Paused: Switched/i.test(b)) throw new Error(`states ${a.slice(0, 80)} / ${b.slice(0, 120)}`);
  return await flash(arjun);
});
await step("pause needs reason then pauses", async () => {
  await card(arjun, "AC gas").locator("select[name=reason]").selectOption("break"); await card(arjun, "AC gas").locator("button:has-text('Pause')").click(); await settle(arjun);
  if (!/Paused: Break/.test(await card(arjun, "AC gas").innerText())) throw new Error("not paused");
});
await step("clock out both", async () => {
  for (const n of ["AC gas", "Battery"]) { await card(arjun, n).locator("button:has-text('Clock out')").click(); await settle(arjun); }
  return (await arjun.locator(".techjob").allInnerTexts()).map((t) => t.split("\n").slice(3, 5).join(" ")).join(" || ");
});
const ramesh = await as("ramesh", { width: 390, height: 844 });
await step("ramesh clocks AC", async () => {
  await ramesh.goto(B + "/my-jobs"); await card(ramesh, "AC gas").locator("button:has-text('Clock in')").click(); await settle(ramesh);
  await card(ramesh, "AC gas").locator("button:has-text('Clock out')").click(); await settle(ramesh); return await flash(ramesh);
});
const priya = await as("priya");
await priya.goto(B + "/jobs"); await priya.click("a:has-text('YAS-1484')"); await settle(priya); const jobUrl = priya.url();
const anil = await as("anil");
await step("issue parts", async () => { await anil.goto(jobUrl); const btns = anil.locator("button:has-text('Issue')"); const n = await btns.count(); for (let i = 0; i < n; i++) { await anil.locator("button:has-text('Issue')").first().click(); await settle(anil); } return `${n} issue buttons; ${await flash(anil)}`; });
await step("ready/delivered not manual", async () => { await priya.goto(jobUrl); const t = (await priya.locator(".nextstep button[name=to]").allInnerTexts()).join(", "); if (/\bReady\b|Delivered/.test(t)) throw new Error(t); return t.replace(/\n/g, " "); });
await step("to QC", async () => { await priya.locator("button:has-text('Quality check')").first().click(); await settle(priya); return await flash(priya); });
const khalid = await as("khalid");
await step("QC fail", async () => {
  await khalid.goto(jobUrl); const sel = khalid.locator("form select[name^='qc[']"); const n = await sel.count();
  for (let i = 0; i < n; i++) await sel.nth(i).selectOption(i === 1 ? "failed" : "done");
  await khalid.locator("input[name^='qcnote[']").nth(1).fill("Vent temp 14C, should be under 8C");
  await khalid.click("button:has-text('Record check')"); await settle(khalid); return await flash(khalid);
});
await step("technician sees QC failure", async () => { await ramesh.goto(B + "/my-jobs"); const t = await ramesh.locator("body").innerText(); if (!/Quality check failed/.test(t)) throw new Error("not shown"); await ramesh.screenshot({ path: `${EV}/flow-qcfail.png` }); });
await step("QC pass", async () => {
  await priya.goto(jobUrl); await priya.locator("button:has-text('Quality check')").first().click(); await settle(priya);
  await khalid.goto(jobUrl); const sel = khalid.locator("form select[name^='qc[']"); const n = await sel.count(); for (let i = 0; i < n; i++) await sel.nth(i).selectOption("done");
  await khalid.click("button:has-text('Record check')"); await settle(khalid); return await flash(khalid);
});
await step("clock correction", async () => {
  await khalid.goto(jobUrl); await khalid.locator("summary:has-text('Clock events')").click();
  const f = khalid.locator("form:has(button:has-text('Correct'))").first(); await f.locator("input[name=reason]").fill("Forgot to clock out"); await f.locator("button").click(); await settle(khalid); return await flash(khalid);
});
await step("unpaid car: manager releases it on credit (phase 3 release gate)", async () => {
  const yousef = await as("yousef"); await yousef.goto(jobUrl);
  await yousef.fill("form:has(button:has-text('Release on credit')) input[name=reason]", "Fleet-style regular customer, pays on Thursday"); await yousef.click("button:has-text('Release on credit')"); await settle(yousef); return await flash(yousef);
});
await step("deliver with signature", async () => {
  await priya.goto(jobUrl);
  for (const c of await priya.locator("form input[name^='chk_']").all()) await c.check();
  await priya.selectOption("select[name=old_parts]", "returned"); await priya.fill("input[name=odometer_out]", "120415"); await priya.fill("input[name=received_by_name]", "Noura Al Hammadi");
  const box = await priya.locator("form:has(input[name^='chk_']) .sigpad canvas").boundingBox();
  await priya.mouse.move(box.x + 20, box.y + 90); await priya.mouse.down(); for (let i = 0; i < 12; i++) await priya.mouse.move(box.x + 30 + i * 25, box.y + 40 + (i % 2) * 50); await priya.mouse.up();
  await priya.screenshot({ path: `${EV}/flow-deliver-form.png`, fullPage: true });
  await priya.click("button:has-text('Deliver the car')"); await settle(priya);
  const t = await priya.locator("body").innerText(); if (!/Delivered .* to Noura/.test(t)) throw new Error(await flash(priya));
  await priya.screenshot({ path: `${EV}/flow-delivered.png`, fullPage: true }); return await flash(priya);
});
await browser.close();
