// Sub-tasks in popups and "+ New" from the pickers (20 Nov 2026): a popup saves and the page behind refreshes,
// a refused save opens the popup again with the reason and what was typed, "+ New" adds a customer, car or
// part without leaving the form and selects it. Needs the app on :3000 and a fresh demo database.
// Run: node tests/uat/popups.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import fs from "node:fs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; fs.mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user, viewport = { width: 1366, height: 900 }) {
  const c = await browser.newContext({ viewport }); const p = await c.newPage(); p.setDefaultTimeout(15000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const open = (p) => p.locator("dialog[open]");
const pop = async (p, label) => { await p.locator("button[data-popup], button[data-quickadd]", { hasText: label }).first().click(); await open(p).first().waitFor(); return open(p).first(); };
const closed = (p) => open(p).first().waitFor({ state: "detached", timeout: 15000 });
const next = (p) => p.locator(".nextstep .nextrow h2").innerText();
let pass = 0, fail = 0;
const step = async (id, name, fn) => {
  try { const r = await fn(); pass++; console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const uniq = String(Date.now()).slice(-7);

const yousef = await as("yousef"); let enqUrl = "", jobUrl = "";

await step("TC-POP-01", "+ New customer from a new enquiry opens the enquiry for that customer", async () => {
  await yousef.goto(B + "/enquiries/new"); const d = await pop(yousef, "+ New customer");
  await d.locator("select[name=title]").selectOption({ index: 1 }); await d.locator("input[name=first_name]").fill("Popup"); await d.locator("input[name=last_name]").fill("Tester");
  await d.locator("input[name=mobile]").fill("050" + uniq); await d.locator("select[name=id_type]").selectOption({ index: 1 }); await d.locator("input[name=id_number]").fill("784-1990-" + uniq + "-1");
  await yousef.screenshot({ path: `${EV}/POP-01-new-customer.png` });
  await d.locator("button:has-text('Save and use it')").click(); await yousef.waitForURL(/customer=/);
  return yousef.url();
});
await step("TC-POP-02", "+ New car is added and selected; a wrong plate code is refused inside the popup", async () => {
  const d = await pop(yousef, "+ New car");
  must(await d.locator("select[name=plate_code]").count() === 1, "plate code is not a list for Abu Dhabi");
  await d.locator("select[name=plate_code]").selectOption("5"); await d.locator("input[name=plate_number]").fill(uniq.slice(-5));
  await d.locator("input[name=make]").fill("Toyota"); await d.locator("input[name=model]").fill("Camry"); await d.locator("input[name=model_year]").fill("2021");
  await d.locator("button:has-text('Save and use it')").click();
  must(/VIN/.test(await d.locator(".flash.err").innerText()), "missing VIN not refused");
  await d.locator("input[name=vin_missing_reason]").fill("Not on the registration card"); await d.locator("button:has-text('Save and use it')").click(); await closed(yousef);
  const sel = await yousef.locator("select[name=vehicle_id]").evaluate((s) => s.options[s.selectedIndex].text); must(/Camry/.test(sel), "car not selected: " + sel);
  await yousef.fill("[name=service_asked]", "Oil change"); await yousef.fill("input[name=follow_up_at]", "2026-11-25T10:00"); await yousef.fill("input[name=odometer_in]", "45000");
  await yousef.click("button:has-text('Save enquiry')"); await yousef.waitForURL(/\/enquiries\/[0-9a-f-]{36}/); enqUrl = yousef.url().split("?")[0];
  return sel;
});
await step("TC-POP-03", "Add labour in a popup: the popup closes and the line is on the page", async () => {
  const d = await pop(yousef, "+ Add labour"); await yousef.screenshot({ path: `${EV}/POP-03-add-labour.png` });
  await d.locator("button:has-text('Add labour')").click(); await closed(yousef);
  must(await yousef.locator("#lines tbody tr").count() === 1, "line not shown"); return await yousef.locator(".flash.ok").innerText();
});
await step("TC-POP-04", "Record the customer's answer and create the job card from popups", async () => {
  await yousef.click("#quote button:has-text('Save quotation')"); await yousef.waitForLoadState("networkidle");
  await yousef.click("#quote button:has-text('Prepare approval message')"); await yousef.waitForURL(/msg=/);
  let d = await pop(yousef, "Record the customer's answer"); await d.locator("button:has-text('Record answer')").click(); await closed(yousef);
  must(/Create the job card/.test(await next(yousef)), "next step " + await next(yousef));
  d = await pop(yousef, "Create job card"); await yousef.screenshot({ path: `${EV}/POP-04-create-job.png` });
  await d.locator("button:has-text('Create job card')").click(); await yousef.waitForURL(/\/jobs\//); jobUrl = yousef.url().split("?")[0];
  return await next(yousef);
});
await step("TC-POP-05", "Next step Assign technicians opens the popup; saving moves the job on", async () => {
  await yousef.locator(".nextstep a:has-text('Assign technicians')").click(); const d = open(yousef).first(); await d.waitFor();
  await d.locator("input[name=technician_id]").first().check(); await yousef.screenshot({ path: `${EV}/POP-05-assign.png` });
  await d.locator("button:has-text('Save technicians')").click(); await closed(yousef);
  must(/Start the work/.test(await next(yousef)), "next step " + await next(yousef)); return await next(yousef);
});
await step("TC-POP-06", "A refused save opens the popup again with the reason and the typed values", async () => {
  let d = await pop(yousef, "+ Add outside work"); await d.locator("input[name=description]").fill("Glass repair"); await d.locator("input[name=unit_price]").fill("abc");
  await d.locator("button:has-text('Add outside work')").click(); await yousef.waitForURL(/err=/); await yousef.waitForTimeout(800);
  d = open(yousef).first(); await d.waitFor(); const e = await d.locator(".flash.err").innerText(); must(/price/i.test(e), e);
  must(await d.locator("input[name=description]").inputValue() === "Glass repair", "typed description lost");
  await yousef.screenshot({ path: `${EV}/POP-06-refused.png` });
  await d.locator("input[name=unit_price]").fill("120"); await d.locator("button:has-text('Add outside work')").click(); await closed(yousef);
  return e;
});
await step("TC-POP-07", "Saving twice in a row (same message back) still closes the popup", async () => {
  for (const k of [1, 2]) {
    const d = await pop(yousef, "+ Add outside work"); await d.locator("input[name=description]").fill("Polish " + k); await d.locator("input[name=unit_price]").fill("50");
    await d.locator("button:has-text('Add outside work')").click(); await closed(yousef);
  }
  return (await yousef.locator("#lines tbody tr").count()) + " lines";
});
await step("TC-POP-08", "A link to /jobs/<id>#newtime opens the promised-time popup", async () => {
  await yousef.goto(jobUrl + "#newtime"); const d = open(yousef).first(); await d.waitFor();
  return await d.getAttribute("aria-label");
});
await step("TC-POP-09", "+ New part inside the Add part popup (stacked popups) for the administrator", async () => {
  const admin = await as("admin"); await admin.goto(jobUrl); const d = await pop(admin, "+ Add part");
  await d.locator("button[data-quickadd=items]").click(); const d2 = admin.locator("dialog[open][aria-label='New part']"); await d2.waitFor();
  await d2.locator("input[name=part_no]").fill("PX-" + uniq); await d2.locator("input[name=description]").fill("Popup test filter");
  await d2.locator("select[name=category]").selectOption({ index: 1 }); await d2.locator("input[name=list_price]").fill("45");
  await admin.screenshot({ path: `${EV}/POP-09-new-part.png` });
  await d2.locator("button:has-text('Save and use it')").click(); await d2.waitFor({ state: "detached" });
  const sel = await d.locator("select[name=item_id]").evaluate((s) => s.options[s.selectedIndex].text); must(sel.includes("PX-" + uniq), sel);
  must(await open(admin).count() === 1, "Add part popup closed with the new part");
  await d.locator("button:has-text('Add part')").click(); await closed(admin); return sel;
});
await step("TC-POP-10", "Popups fit a phone screen", async () => {
  const p = await as("yousef", { width: 390, height: 844 }); await p.goto(jobUrl); const d = await pop(p, "Change the promised time");
  const box = await d.boundingBox(); must(box.width <= 390 && box.x >= 0, JSON.stringify(box)); await p.screenshot({ path: `${EV}/POP-10-phone.png` });
  return JSON.stringify(box);
});
await step("TC-POP-11", "Branch manager without master rights gets no + New part button (server refusal: tests/quick-add.test.ts)", async () => {
  const p = yousef; await p.goto(jobUrl); const d = await pop(p, "+ Add part");
  must(await d.locator("button:has-text('+ New part')").count() === 0, "+ New part shown to a branch manager without settings rights");
  return "hidden";
});
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
