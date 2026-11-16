// Browser smoke test against a running app (npm run build && npm start). Run: node tests/e2e-smoke.mjs [outdir]
import { createRequire } from "node:module";
// Uses a globally installed Playwright if present, else the project one (npm i -D playwright && npx playwright install chromium).
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.argv[2] || "shots";
const PW = "Superfix@2026";
const browser = await chromium.launch();
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

async function as(user) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=username]", user);
  await page.fill("input[name=password]", PW);
  await Promise.all([page.waitForURL(`${BASE}/`), page.click("button:has-text('Sign in')")]);
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

// 1. Advisor: home, job card with quotation, the sent link
const priya = await as("priya");
await shot(priya, "01-advisor-home");
await priya.goto(`${BASE}/jobs`);
await priya.click("text=YAS-1483");
await priya.waitForSelector("text=Job lines");
await shot(priya, "02-job-card-advisor");
if (await priya.locator("text=Avg cost").count()) fail("advisor sees cost");
const link = await priya.locator("a[href^='/q/']").first().getAttribute("href");

// 2. Customer approves on the public page (no sign-in)
const pub = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
await pub.goto(`${BASE}${link}`);
await shot(pub, "03-customer-approval-page");
await pub.locator("input[type=checkbox]").last().uncheck();
await pub.click("text=Approve ticked work");
await pub.waitForSelector("text=Your answer has been sent");
await shot(pub, "04-customer-approved");

// 3. Advisor: job is now approved; a big discount needs the manager
await priya.reload();
if (!(await priya.locator(".pill", { hasText: "Approved" }).count())) fail("job not approved after customer answer");
const align = await priya.locator("form:has(input[value=labour]) select[name=service_id] option", { hasText: "Wheel alignment" }).getAttribute("value");
await priya.selectOption("form:has(input[value=labour]) select[name=service_id]", align);
await priya.fill("form:has(input[value=labour]) input[name=discount_amount]", "40");
await priya.click("button:has-text('Add labour')");
await priya.click("button:has-text('Save new revision')");
await priya.waitForSelector("text=sent for manager approval");
await shot(priya, "05-discount-needs-approval");

// 4. Manager approves from the inbox
const yousef = await as("yousef");
await yousef.goto(`${BASE}/approvals`);
await shot(yousef, "06-manager-approvals");
await yousef.click("button:has-text('Approve')");
await yousef.waitForSelector("text=Approved");

// 5. Technician sees no prices; Al Qusais advisor cannot open a Yas job
const ramesh = await as("ramesh");
await ramesh.goto(`${BASE}/jobs`);
await shot(ramesh, "07-technician-my-jobs");
const sara = await as("sara");
const yasJobUrl = priya.url().split("?")[0];
await sara.goto(yasJobUrl);
if (!(await sara.locator("text=could not be shown").count())) fail("QUS advisor opened a YAS job");
await shot(sara, "08-other-branch-blocked");

// 6. Invoice the ready job and take payment
await priya.goto(`${BASE}/jobs?status=ready`);
await priya.click("text=YAS-1484");
await priya.click("text=Prepare tax invoice");
await shot(priya, "09-invoice-draft-checks");
await priya.click("button:has-text('Post tax invoice')");
await priya.waitForSelector("text=Tax Invoice");
await shot(priya, "10-tax-invoice");
await priya.click("button:has-text('Record payment')");
await priya.waitForSelector("text=Receipt");
const owner = await as("saeed");
await owner.goto(`${BASE}/accounts`);
await shot(owner, "11-trial-balance-owner");
await owner.goto(`${BASE}/stock`);
await shot(owner, "12-stock-owner");
const admin = await as("admin");
await admin.goto(`${BASE}/admin/roles`);
await shot(admin, "13-roles-and-field-permissions");
await admin.goto(`${BASE}/admin/audit`);
await shot(admin, "14-audit-log");
await browser.close();
console.log(process.exitCode ? "smoke test FAILED" : "smoke test passed");
