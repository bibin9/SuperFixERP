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

// 1. Advisor: home, then the enquiry with its quotation sent to the customer (no job card yet)
const priya = await as("priya");
await shot(priya, "01-advisor-home");
await priya.goto(`${BASE}/enquiries`);
await priya.click("text=YAS-ENQ-26-00001");
await priya.waitForSelector("text=Work to quote");
await shot(priya, "02-enquiry-quotation-sent");
if (await priya.locator("button:has-text('Create job card')").count()) fail("job card offered before approval");
if (await priya.locator("text=Avg cost").count()) fail("advisor sees cost");
const link = await priya.locator("a[href^='/q/']").first().getAttribute("href");
// Manual messaging: the text is prepared, staff send it themselves and mark it as sent
await priya.click("button:has-text('Prepare the approval message again')");
await priya.waitForSelector("text=Send it yourself");
await shot(priya, "03-manual-whatsapp-message");
await priya.click("button:has-text('Mark as sent')");
await priya.waitForSelector("text=Message marked as sent");

// 2. Customer approves on the public page (no sign-in), declining the brake pads
const pub = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
await pub.goto(`${BASE}${link}`);
await shot(pub, "04-customer-approval-page");
await pub.locator("input[type=checkbox]").last().uncheck();
await pub.click("text=Approve ticked work");
await pub.waitForSelector("text=Your answer has been sent");

// 3. Advisor creates the job card from the approved quotation
await priya.reload();
await priya.waitForSelector("button:has-text('Create job card')");
await shot(priya, "05-enquiry-approved-create-job");
await priya.click("button:has-text('Create job card')");
await priya.waitForSelector("text=created from the approved quotation");
await shot(priya, "06-job-card-from-approved-quote");
const jobUrl = priya.url().split("?")[0];

// 4. Extra work on the job with a big discount needs the manager
const align = await priya.locator("form:has(input[value=labour]) select[name=service_id] option", { hasText: "Wheel alignment" }).getAttribute("value");
await priya.selectOption("form:has(input[value=labour]) select[name=service_id]", align);
await priya.fill("form:has(input[value=labour]) input[name=discount_amount]", "40");
await priya.click("button:has-text('Add labour')");
await priya.click("button:has-text('Save new revision')");
await priya.waitForSelector("text=sent for manager approval");
await shot(priya, "07-extra-work-needs-approval");

// 5. Manager approves from the inbox
const yousef = await as("yousef");
await yousef.goto(`${BASE}/approvals`);
await shot(yousef, "08-manager-approvals");
await yousef.click("button:has-text('Approve')");
await yousef.waitForSelector("text=Approved");

// 6. Technician sees no prices; Al Qusais advisor cannot open a Yas job
const ramesh = await as("ramesh");
await ramesh.goto(`${BASE}/jobs`);
await shot(ramesh, "09-technician-my-jobs");
const sara = await as("sara");
await sara.goto(jobUrl);
await sara.waitForSelector("text=could not be shown", { timeout: 8000 }).catch(() => fail("QUS advisor opened a YAS job"));
await shot(sara, "10-other-branch-blocked");

// 7. Invoice the ready job and take payment
await priya.goto(`${BASE}/jobs?status=ready`);
await priya.click("text=YAS-1483");
await priya.click("text=Prepare tax invoice");
await shot(priya, "11-invoice-draft-checks");
await priya.click("button:has-text('Post tax invoice')");
await priya.waitForSelector("text=Tax Invoice");
await shot(priya, "12-tax-invoice");
await priya.click("button:has-text('Record payment')");
await priya.waitForSelector("text=Receipt");

// 8. Master forms
const admin = await as("admin");
await admin.goto(`${BASE}/admin/masters`);
await shot(admin, "13-master-forms");
await admin.goto(`${BASE}/admin/masters/payment-methods`);
await shot(admin, "14-payment-methods-master");
const owner = await as("saeed");
await owner.goto(`${BASE}/accounts`);
await shot(owner, "15-trial-balance-owner");
await owner.goto(`${BASE}/stock`);
await shot(owner, "16-stock-owner");
await admin.goto(`${BASE}/admin/roles`);
await shot(admin, "17-roles-and-field-permissions");
await admin.goto(`${BASE}/admin/audit`);
await shot(admin, "18-audit-log");
await browser.close();
console.log(process.exitCode ? "smoke test FAILED" : "smoke test passed");
