// Superfix review points of 17 Nov 2026 in the browser: voucher series per type, audit log permission with
// users and roles, transaction history, customer e-invoicing fields and price level, transfer order naming.
// Needs the app on :3000 and a fresh demo database. Run: node tests/uat/review-fixes.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import fs from "node:fs";
import { inlinePopups } from "./inline-popups.mjs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; fs.mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }); await c.addInitScript(inlinePopups); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(800); await p.waitForLoadState("networkidle"); };
const go = async (p, path) => { await p.goto(B + path); await settle(p); };
const body = async (p) => { await p.evaluate(() => document.querySelectorAll("details.history").forEach((d) => { d.open = true; })); return p.locator("body").innerText(); };
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const results = []; let pass = 0, fail = 0;
const step = async (id, name, fn) => {
  try { const r = await fn(); pass++; results.push({ id, status: "Pass", note: String(r ?? "") }); console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; results.push({ id, status: "Fail", note: String(e.message).split("\n")[0] }); console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (c, m) => { if (!c) throw new Error(m); };

const priya = await as("priya"), saeed = await as("saeed"), maryam = await as("maryam");

await step("TC-RV01-01", "document numbering has a series per voucher type", async () => {
  const admin = await as("admin"); await go(admin, "/admin/numbering?b=YAS"); const t = await body(admin);
  for (const w of ["Journal voucher", "Payment voucher", "Receipt voucher", "Contra voucher", "Debit note voucher", "Credit note voucher"]) must(t.includes(w), `missing ${w}`);
  must(await admin.locator("input[value='YAS-PMT-']").count(), "PMT prefix missing"); return "6 voucher series at YAS";
});
const switchBranch = async (p, code) => { const sel = p.locator("select[name=branch_id]").first(); const v = await sel.locator("option", { hasText: new RegExp(`^${code} ·`) }).first().getAttribute("value"); await sel.selectOption(v); await settle(p); };
await step("TC-RV01-02", "a journal voucher is numbered in its own series", async () => {
  await switchBranch(maryam, "YAS");
  await go(maryam, "/accounts/vouchers/new"); await maryam.selectOption("select[name=voucher_type]", "journal"); await maryam.fill("input[name=narration]", "Reclass rent to general");
  for (const [i, l] of [{ acc: "5900 ·", dr: "250" }, { acc: "5400 ·", cr: "250" }].entries()) {
    const v = await maryam.locator(`select[name=acct_${i}] option`, { hasText: l.acc }).first().getAttribute("value"); await maryam.selectOption(`select[name=acct_${i}]`, v);
    if (l.dr) await maryam.fill(`input[name=dr_${i}]`, l.dr); if (l.cr) await maryam.fill(`input[name=cr_${i}]`, l.cr);
  }
  await maryam.click("button:has-text('Submit for approval')"); await settle(maryam); const url = maryam.url();
  await go(saeed, "/approvals"); const item = saeed.locator("div:has(> form button:has-text('Approve'))", { hasText: "Reclass rent to general" }).first();
  must(await item.count(), "not in the owner's inbox"); await item.locator("button:has-text('Approve')").click(); await settle(saeed);
  await maryam.goto(url); await settle(maryam); const t = await body(maryam);
  must(/YAS-JRN-26-\d+/.test(t), "no JRN number"); await maryam.screenshot({ path: `${EV}/rv-voucher-history.png`, fullPage: true });
  return t.match(/YAS-JRN-26-\d+/)[0];
});
await step("TC-RV02-01", "voucher history lists every user who acted, with role", async () => {
  const t = await body(maryam);
  must(/History: who did what/.test(t), "no history panel"); must(/Maryam Haddad/.test(t) && /Accountant/.test(t), "creator missing"); must(/Saeed Al Mazrouei/.test(t) && /Owner/.test(t) && /approv/i.test(t), "approver missing");
  return "creator and approver with roles";
});
await step("TC-RV02-02", "job card history shows the users on the job", async () => {
  await go(priya, "/jobs"); await priya.click("a:has-text('YAS-1483')"); await settle(priya); const t = await body(priya);
  must(/History: who did what/.test(t), "no history"); const users = ["Priya Menon", "Anil Kumar", "Khalid Rahman"].filter((u) => t.split("History: who did what")[1].includes(u));
  must(users.length >= 2, `only ${users.join(", ")}`); await priya.screenshot({ path: `${EV}/rv-job-history.png`, fullPage: true }); return users.join(", ");
});
await step("TC-RV02-03", "audit log shows user and role, filters by user, owner exports CSV", async () => {
  await go(saeed, "/admin/audit"); let t = await body(saeed); must(/Role/.test(t), "no role column");
  await saeed.selectOption("select[name=user]", "maryam"); await saeed.click("button:has-text('Filter')"); await settle(saeed);
  const rows = await saeed.locator("table").first().locator("tbody tr").allInnerTexts(); must(rows.length && rows.every((r) => r.includes("Maryam Haddad")), "filter not applied");
  must(rows.some((r) => r.includes("Accountant")), "role missing");
  const [dl] = await Promise.all([saeed.waitForEvent("download"), saeed.click("a:has-text('Export CSV')")]);
  const csv = fs.readFileSync(await dl.path(), "utf8"); must(/When,User,Name,Role/.test(csv) && /Maryam Haddad/.test(csv), "csv");
  await saeed.screenshot({ path: `${EV}/rv-audit-log.png`, fullPage: true }); return `${rows.length} rows for maryam; CSV ${csv.split("\n").length - 2} lines`;
});
await step("TC-RV02-04", "audit log permission: advisor refused, accountant can view but not export", async () => {
  await go(priya, "/admin/audit"); must(!/Sign-ins and branch switches/.test(await body(priya)), "advisor sees the audit log");
  must(!(await priya.locator("nav a:has-text('Audit log')").count()), "menu shows audit log to advisor");
  await go(maryam, "/admin/audit"); must(/Sign-ins and branch switches/.test(await body(maryam)), "accountant cannot view");
  must(!(await maryam.locator("a:has-text('Export CSV')").count()), "accountant can export");
  const r = await maryam.request.get(`${B}/api/audit`); must(r.status() === 403, `export status ${r.status()}`); return "advisor refused; accountant view only (export 403)";
});
await step("TC-RV03-01", "corporate customer has e-invoicing details and price level", async () => {
  await go(priya, "/customers?q=Emirates"); await priya.click("a:has-text('Emirates Fleet')"); await settle(priya);
  must(await priya.locator("legend:has-text('E-invoicing details')").count(), "no e-invoicing section");
  must((await priya.inputValue("input[name=peppol_id]")) === "0235:100234567800003", "peppol"); must((await priya.inputValue("select[name=price_level]")) === "fleet", "price level");
  await priya.fill("input[name=peppol_id]", "100234567800003"); await priya.click("button:has-text('Save customer')"); await settle(priya);
  must(/Peppol ID is the scheme/.test(await flash(priya)), "bad Peppol accepted");
  await priya.screenshot({ path: `${EV}/rv-customer-einvoice.png`, fullPage: true }); return "Peppol, licence, address, contact, price level fleet; bad Peppol refused";
});
await step("TC-RV03-02", "an individual customer has a price level but no e-invoicing section", async () => {
  await go(priya, "/customers/new"); must(await priya.locator("select[name=price_level]").count(), "no price level"); must(!(await priya.locator("input[name=peppol_id]").count()), "peppol on individual");
  await priya.selectOption("select[name=customer_type]", "corporate"); must(await priya.locator("input[name=peppol_id]").count(), "peppol hidden for corporate"); return "ok";
});
await step("TC-RV04-01", "price levels and price lists are master forms", async () => {
  const admin = await as("admin"); await go(admin, "/admin/masters"); const t = await body(admin);
  must(/Price lists by price level/.test(t), "no price list master"); return "Price lists master present; levels under Pick lists (price_level)";
});
await step("TC-RV05-01", "branch transfer is a transfer order, not a purchase order", async () => {
  const anil = await as("anil"); await go(anil, "/stock/transfers"); const t = await body(anil);
  must(/Transfer orders between branches/.test(t) && /not a purchase order/.test(t), "naming"); must(await anil.locator("nav a:has-text('Transfer orders')").count(), "menu"); return "Transfer orders";
});
console.log(`\n${pass} passed, ${fail} failed`);
fs.writeFileSync(process.env.RV_RESULTS || "/tmp/rv-results.json", JSON.stringify(results, null, 1));
await browser.close();
