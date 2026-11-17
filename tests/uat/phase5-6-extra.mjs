// Remaining HR and report requirements in the browser: employee records (air ticket, visa process, assets,
// warnings, reviews, training), QR check-in, and the purchase report. Needs the app on :3000 and a fresh demo database
// with tests/uat/phase2-purchasing.mjs run first (it posts the supplier bill the purchase report lists).
// Run: npm run db:reset; node tests/uat/phase2-purchasing.mjs; node tests/uat/phase5-6-extra.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import fs from "node:fs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; fs.mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(500); await p.waitForLoadState("networkidle"); };
const go = async (p, path) => { await p.goto(B + path); await settle(p); };
const body = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const results = []; let pass = 0, fail = 0;
const step = async (id, name, fn, evidence = "") => {
  try { const r = await fn(); pass++; results.push({ id, name, status: "Pass", note: String(r ?? ""), evidence }); console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; results.push({ id, name, status: "Fail", note: String(e.message).split("\n")[0], evidence }); console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const dubai = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + days * 86400000));
const TODAY = dubai(0);

const fatima = await as("fatima.hr"), ramesh = await as("ramesh"), saeed = await as("saeed"), yousef = await as("yousef");
await go(fatima, "/hr/employees?q=Ramesh");
const empHref = await fatima.locator("main a[href^='/hr/employees/']", { hasText: /Ramesh/ }).first().getAttribute("href");
const recs = `${empHref.split("?")[0]}?tab=records`;
const add = async (kind, fill) => {
  await go(fatima, recs);
  const card = fatima.locator(`#${kind}`);
  await card.locator("summary", { hasText: "Add" }).click();
  for (const [name, v] of Object.entries(fill)) {
    const el = card.locator(`[name=${name}]`); const tag = await el.evaluate((e) => e.tagName);
    if (tag === "SELECT") { if (v === "*") { const o = await el.locator("option").nth(1).getAttribute("value"); await el.selectOption(o); } else await el.selectOption(v); } else await el.fill(v);
  }
  await card.locator("button:has-text('Save')").click(); await settle(fatima);
  const f = await flash(fatima); must(!/could not|must|required|not /i.test(f) || /saved|added/i.test(f), "save: " + f);
  return fatima.locator(`#${kind}`).innerText();
};

await step("TC-HR08-01", "Air ticket entitlement: HR records sector, cycle and amount on Ramesh's file", async () => {
  const t = await add("air_ticket", { cycle_years: "2", sector: "Dubai - Kochi", ticket_amount: "1800" });
  must(/Dubai - Kochi, every 2 year/.test(t) && /1,800\.00/.test(t), t); return t.split("\n").find((l) => /Kochi/.test(l));
});
await step("TC-HR16-01", "Visa process: a renewal at the medical step with cost and person responsible, then marked completed", async () => {
  let t = await add("visa", { process_type: "renewal", step: "medical", cost: "650", responsible: "PRO Hassan", expiry_date: dubai(700) });
  must(/Renewal: Medical/.test(t), t);
  const card = fatima.locator("#visa"); await card.locator("input[name=note]").first().fill("Stamped"); await card.locator("button:has-text('Completed')").first().click(); await settle(fatima);
  t = await fatima.locator("#visa").innerText(); must(/Closed: Stamped/.test(t), "not completed: " + t); return "Renewal: Medical, 650.00, completed with note";
});
await step("TC-HR17-01", "Company assets: a tool issued to Ramesh, then returned and checked", async () => {
  let t = await add("asset", { asset_name: "*", serial: "TQ-0042", issue_date: TODAY, condition: "New" });
  must(/TQ-0042/.test(t), t);
  const card = fatima.locator("#asset"); await card.locator("input[name=note]").first().fill("Returned in good order"); await card.locator("button:has-text('Returned and checked')").first().click(); await settle(fatima);
  t = await fatima.locator("#asset").innerText(); must(/Returned in good order/.test(t), t); return t.split("\n").find((l) => /TQ-0042/.test(l));
});
await step("TC-HR18-01", "Warnings: a written warning with a 100 deduction in this month is recorded", async () => {
  const t = await add("disciplinary", { warning_type: "written", incident_date: TODAY, details: "Left the bay without handing over", deduction: "100", deduct_month: TODAY.slice(0, 7) });
  must(/Written warning on \d{2}\/\d{2}\/\d{4}/.test(t) && /100\.00/.test(t), t); return t.split("\n").find((l) => /Written/.test(l));
});
await step("TC-HR19-01", "Performance review: half-yearly review with KPIs and a rating", async () => {
  const t = await add("review", { period: "H2 2026", kpis: "Efficiency 92%, comebacks 0", rating: "4", comments: "Good year" });
  must(/H2 2026: rating 4/.test(t), t); return "H2 2026: rating 4";
});
await step("TC-HR20-01", "Training: an AC certificate expiring in 15 days shows in the 30-day expiry report", async () => {
  const t = await add("training", { course: "R134a handling", provider: "Daikin", completed_on: dubai(-350), expiry_date: dubai(15) });
  must(/R134a handling \(Daikin\)/.test(t), t);
  await go(fatima, "/reports/run/document_expiries?within=30"); const b = await body(fatima); must(/training/i.test(b), "training not in expiries");
  await fatima.screenshot({ path: `${EV}/hr-records.png`, fullPage: true }); return "certificate listed in document expiries within 30 days";
}, "hr-records.png");
await step("TC-HR11-01", "QR check-in: today's branch code checks Ramesh in; a wrong code is refused with a plain message", async () => {
  await go(yousef, "/hr/qr"); const code = (await yousef.locator("main p.small", { hasText: "Code" }).innerText()).replace("Code", "").trim();
  must(/^[0-9a-f]{10}$/.test(code), "code " + code);
  await yousef.screenshot({ path: `${EV}/hr-qr.png` });
  await go(ramesh, "/me/check-in?branch=YAS&code=0000000000"); await ramesh.click("button:has-text('Check in or out now')"); await settle(ramesh);
  const bad = await flash(ramesh); must(/not today's code/.test(bad), "wrong code: " + bad);
  await go(ramesh, `/me/check-in?branch=YAS&code=${code}`); await ramesh.click("button:has-text('Check in or out now')"); await settle(ramesh);
  const ok = await flash(ramesh); must(!/not today's code|could not/i.test(ok) && ok.length > 0, "check-in: " + ok);
  return ok;
}, "hr-qr.png");
await step("TC-TR03-01", "TR-03 purchase report: supplier bills with net, VAT and gross; summary by supplier", async () => {
  await go(saeed, "/reports/run/purchase_register?from=2020-01-01&to=2030-12-31"); let b = await body(saeed);
  const heads = await saeed.locator("[data-testid=report-table] thead th").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  must(["Net", "VAT", "Gross"].every((h) => heads.includes(h)), "heads " + heads);
  const rows = await saeed.locator("[data-testid=report-table] tbody tr").allInnerTexts();
  must(rows.length >= 1, "no rows");
  await go(saeed, "/reports/run/purchase_register?from=2020-01-01&to=2030-12-31&by=supplier"); const rs = await saeed.locator("[data-testid=report-table] tbody tr").allInnerTexts();
  await saeed.screenshot({ path: `${EV}/p6-purchases.png`, fullPage: true });
  must(!/Nothing/.test(rows[0]), "no supplier bills: run phase2-purchasing first"); return `${rows.length} bill(s); by supplier: ` + rs.map((r) => r.replace(/\s+/g, " ").slice(0, 60)).join(" / ");
}, "p6-purchases.png");

fs.writeFileSync(`${EV}/phase5x-results.json`, JSON.stringify(results, null, 1));
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
