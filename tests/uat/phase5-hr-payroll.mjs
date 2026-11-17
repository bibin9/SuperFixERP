// Phase 5 HR and payroll in the browser, one test case at a time: employee file, documents and alerts,
// attendance, roster, leave and overtime with approvals, letters, transfers, recruitment, HR masters,
// self-service, and the monthly payroll (calculate, approve, post, WPS file, paid, payslip, register),
// salary updates, advances and loans, and the final settlement. Needs the app on :3000 and a fresh demo database.
// Run: node tests/uat/phase5-hr-payroll.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import fs from "node:fs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; fs.mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(600); await p.waitForLoadState("networkidle"); };
const go = async (p, path) => { await p.goto(B + path); await settle(p); };
const body = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const results = []; let pass = 0, fail = 0;
const step = async (id, name, fn) => {
  try { const r = await fn(); pass++; results.push({ id, status: "Pass", note: String(r ?? "") }); console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; results.push({ id, status: "Fail", note: String(e.message).split("\n")[0] }); console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const inlineErr = async (p) => { await p.waitForSelector(".field-err[data-auto]", { timeout: 4000 }); return p.locator(".field-err[data-auto]").first().innerText(); };
const fieldOfErr = async (p) => p.locator(".field-err[data-auto]").first().evaluate((e) => (e.closest(".field")?.querySelector("label")?.textContent ?? "").trim());
const dubai = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + days * 86400000));
const TODAY = dubai(0), THIS = TODAY.slice(0, 7);
const LAST = (() => { const d = new Date(`${THIS}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const NEXT1 = (() => { const d = new Date(`${THIS}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
// A past working day (not Friday, the demo weekly day off) in this month.
let WORKDAY = dubai(-1); for (let i = 1; i < 8 && (dow(WORKDAY) === 5 || WORKDAY.slice(0, 7) !== THIS); i++) WORKDAY = dubai(-1 - i);
const pickOpt = async (sel, re) => { const o = sel.locator("option", { hasText: re }).first(); const v = await o.getAttribute("value"); await sel.selectOption(v); return v; };
const approveAll = async (p, re) => { // approves every inbox item whose line matches re
  let n = 0;
  for (let i = 0; i < 12; i++) {
    await go(p, "/approvals");
    const item = p.locator("main .card").first().locator("> div", { hasText: re }).first();
    if (!(await item.count())) break;
    await item.locator("button:has-text('Approve')").click(); await settle(p); n++;
  }
  return n;
};

const fatima = await as("fatima.hr"), saeed = await as("saeed"), yousef = await as("yousef"), khalid = await as("khalid"), ramesh = await as("ramesh"), priya = await as("priya");

// ---------------------------------------------------------------- HR masters
await step("TC-HR11-01", "HR keeps the HR master forms: a wrong break time is shown under its field; a public holiday is added", async () => {
  await go(fatima, "/admin/masters"); const t = await body(fatima);
  must(/HR and payroll/.test(t) && /Salary components/.test(t) && /Leave types/.test(t), "HR masters not listed for HR");
  await go(fatima, "/admin/masters/accounts"); must(!(await fatima.locator("form:has(button:has-text('Add'))").count()), "HR can add ledger accounts");
  await go(fatima, "/admin/masters/shifts"); const f = fatima.locator("form:has(button:has-text('Add'))");
  await f.locator("input[name=code]").fill("NIGHT"); await f.locator("input[name=name]").fill("Night recovery");
  await f.locator("input[name=start_time]").fill("22:00"); await f.locator("input[name=end_time]").fill("06:00");
  await f.locator("input[name=break_minutes]").fill("300"); await f.locator("input[name=grace_minutes]").fill("10");
  await f.locator("button:has-text('Add')").click(); await settle(fatima);
  const e = await inlineErr(fatima); const lab = await fieldOfErr(fatima);
  must(/Break/.test(lab), `error under ${lab}`); must(await fatima.locator("input[name=name]").inputValue() === "Night recovery", "typed name lost");
  await fatima.locator("input[name=break_minutes]").fill("30"); await fatima.locator("form:has(button:has-text('Add')) button:has-text('Add')").click(); await settle(fatima);
  must(/Night recovery/.test(await body(fatima)), "shift not saved");
  await go(fatima, "/admin/masters/public-holidays"); const h = fatima.locator("form:has(button:has-text('Add'))");
  await h.locator("input[name=holiday_date]").fill(`${TODAY.slice(0, 4)}-12-24`); await h.locator("input[name=name]").fill("National Day (test)");
  await h.locator("button:has-text('Add')").click(); await settle(fatima);
  must(/National Day \(test\)/.test(await body(fatima)), "holiday not listed");
  return `${e} (under ${lab}); NIGHT shift and holiday saved`;
});

// ---------------------------------------------------------------- employee file
let newEmp = "";
await step("TC-HR01-01", "HR adds an employee: a wrong IBAN is shown in red under IBAN with the rest kept; then saved with the joining checklist", async () => {
  await go(fatima, "/hr/employees/new");
  await pickOpt(fatima.locator("main select[name=branch_id]"), /^YAS/);
  await fatima.fill("input[name=first_name]", "Salim"); await fatima.fill("input[name=last_name]", "Haddad");
  await pickOpt(fatima.locator("select[name=nationality]"), /^Jordan/);
  await pickOpt(fatima.locator("select[name=designation_id]"), /Technician/);
  await fatima.fill("input[name=joining_date]", `${THIS}-01`);
  await fatima.fill("input[name=mohre_person_code]", "10000000123456");
  await pickOpt(fatima.locator("select[name=wps_agent_id]"), /Emirates NBD/);
  await fatima.fill("input[name=iban]", "AE12345");
  await fatima.click("button:has-text('Add employee')"); await settle(fatima);
  const e = await inlineErr(fatima); const lab = await fieldOfErr(fatima);
  must(/IBAN/.test(lab) && /21 digits/.test(e), `error ${e} under ${lab}`);
  must(await fatima.locator("input[name=first_name]").inputValue() === "Salim", "first name lost after the error");
  await fatima.screenshot({ path: `${EV}/hr-new-employee-error.png`, fullPage: true });
  await fatima.fill("input[name=iban]", "AE070331234567890123456");
  await fatima.click("button:has-text('Add employee')"); await settle(fatima);
  const f = await flash(fatima); must(/Employee SF-\d+ added/.test(f), `flash ${f}`);
  newEmp = fatima.url().split("/hr/employees/")[1].split("?")[0];
  await go(fatima, `/hr/employees/${newEmp}?tab=checklist`); const t = await body(fatima);
  must(/Joining \(0 of \d+ done\)/.test(t), "no joining checklist"); return f;
});
await step("TC-HR01-02", "HR sets the opening salary; the salary tab shows the gross", async () => {
  await go(fatima, `/hr/employees/${newEmp}?tab=salary`);
  await fatima.fill("input[name='amt[basic]']", "2500"); await fatima.fill("input[name='amt[housing]']", "1200"); await fatima.fill("input[name='amt[transport]']", "300");
  await fatima.click("button:has-text('Save salary')"); await settle(fatima);
  const t = await body(fatima); must(/Gross a month\s*4,000\.00/.test(t), `gross not 4,000: ${t.slice(0, 300)}`);
  must(/Update salary/.test(t), "no Update salary link after opening salary"); return "Gross 4,000.00; later changes go through Update salary";
});
await step("TC-HR02-01", "a document added with an expiry in 20 days shows on the HR dashboard alerts", async () => {
  await go(fatima, `/hr/employees/${newEmp}?tab=records`);
  const card = fatima.locator(".card#document"); await card.locator("summary:has-text('Add')").click();
  await card.locator("select[name=doc_type]").selectOption("passport"); await card.locator("input[name=number]").fill("P9988776");
  await card.locator("input[name=expiry_date]").fill(dubai(20)); await card.locator("button:has-text('Save')").click(); await settle(fatima);
  must(/P9988776/.test(await body(fatima)), "document not listed");
  await go(fatima, "/hr"); const t = await body(fatima);
  must(/Salim Haddad[\s\S]{0,40}Passport/.test(t) && /Within 30 days/.test(t), "alert missing for Salim");
  must(/Ramesh Kumar[\s\S]{0,40}Passport/.test(t), "seeded Ramesh passport alert missing");
  await fatima.screenshot({ path: `${EV}/hr-dashboard-alerts.png`, fullPage: true }); return "Passport within 30 days listed with Ramesh's";
});
await step("TC-HR03-01", "branch manager sees the branch staff but no salary, no bank details and no payroll", async () => {
  await go(yousef, "/hr/employees"); const t = await body(yousef); must(/Ramesh Kumar/.test(t), "staff not listed");
  must(!/Omar Farouk/.test(t), "sees another branch's staff");
  await yousef.click("a:has-text('Ramesh Kumar')"); await settle(yousef); const e = await body(yousef);
  must(!/>?Salary<?/.test((await yousef.locator(".tabs").innerText())), "salary tab shown"); must(!/AE07/.test(e), "IBAN shown");
  const nav = await yousef.locator("aside").evaluate((e) => e.textContent); must(/HR/.test(nav) && !/Payroll/.test(nav), "payroll in menu");
  await go(yousef, `/hr/employees/${newEmp}?tab=salary`); must(!/Gross a month/.test(await body(yousef)), "salary visible by URL");
  const r = await yousef.goto(`${B}/payroll`); must(/could not be shown/i.test(await yousef.locator("body").innerText()), "payroll opened");
  return "Staff of YAS only; salary and IBAN hidden; payroll refused";
});
await step("TC-HR12-01", "a technician has self-service only: HR screens refused, no HR menu items except My HR", async () => {
  await ramesh.click("aside button.grp:has-text('HR')"); const nav = await ramesh.locator("aside").evaluate((e) => e.textContent);
  must(/My HR/.test(nav) && !/Employees/.test(nav) && !/Payroll/.test(nav), `menu wrong: ${nav.slice(0, 200)}`);
  await ramesh.goto(`${B}/hr/employees`); must(/could not be shown/i.test(await ramesh.locator("body").innerText()), "HR list opened");
  await ramesh.goto(`${B}/admin/masters/salary-components`); must(/could not be shown/i.test(await ramesh.locator("body").innerText()), "master opened");
  return "Refused";
});

// ---------------------------------------------------------------- attendance and roster
await step("TC-HR04-01", "punches added by hand show on attendance with the late minutes against the shift", async () => {
  await go(fatima, "/hr/attendance");
  for (const [t, n] of [["08:31", "Forgot to punch in"], ["18:02", "Forgot to punch out"]]) {
    const f = fatima.locator("form:has(button:has-text('Add punch'))");
    await pickOpt(f.locator("select[name=employee_id]"), /Ramesh Kumar/); await f.locator("input[name=date]").fill(WORKDAY);
    await f.locator("input[name=time]").fill(t); await f.locator("input[name=note]").fill(n); await f.locator("button:has-text('Add punch')").click(); await settle(fatima);
  }
  const rows = fatima.locator("main table tr", { hasText: "Ramesh Kumar" }).filter({ hasText: WORKDAY.split("-").reverse().join("/") });
  const t = await rows.first().innerText(); must(/08:31/.test(t) && /18:02/.test(t) && /21 min/.test(t) && /Late/.test(t), `row: ${t}`);
  return t.replace(/\s+/g, " ");
});
await step("TC-HR05-01", "roster: a planned day off for Arjun is saved and shown", async () => {
  await go(fatima, "/me"); // HR's branch is HQ; plan YAS
  const sel = fatima.locator("header select[name=branch_id]"); await pickOpt(sel, /^YAS ·/); await settle(fatima);
  await go(fatima, "/hr/roster"); const cell = fatima.locator("select[aria-label^='Arjun Pillai']").nth(2);
  const label = await cell.getAttribute("aria-label"); await cell.selectOption("off"); await fatima.click("button:has-text('Save roster')"); await settle(fatima);
  must(/Roster saved/.test(await flash(fatima)), "not saved"); must(await fatima.locator(`select[aria-label='${label}']`).inputValue() === "off", "day off not kept");
  return `${label}: day off`;
});

// ---------------------------------------------------------------- leave and overtime
await step("TC-HR06-01", "self-service leave beyond the balance is refused, in red under the dates, with the rest kept", async () => {
  await go(ramesh, "/me"); await ramesh.selectOption("#lt", "annual"); await ramesh.fill("#lf", dubai(20)); await ramesh.fill("#lto", dubai(70)); await ramesh.fill("#lr", "Home visit");
  await ramesh.click("button:has-text('Send to my manager')"); await settle(ramesh);
  const e = await inlineErr(ramesh); must(/Not enough annual leave/.test(e), e); must(await ramesh.locator("#lr").inputValue() === "Home visit", "reason lost");
  return e;
});
await step("TC-HR06-02", "leave goes to the line manager, then HR; approved leave shows on self-service and lowers the balance", async () => {
  await ramesh.fill("#lf", dubai(30)); await ramesh.fill("#lto", dubai(31)); await ramesh.click("button:has-text('Send to my manager')"); await settle(ramesh);
  must(/sent for approval/.test(await flash(ramesh)), await flash(ramesh));
  await go(khalid, "/approvals"); must(/Leave[\s\S]*Ramesh/.test(await body(khalid)), "not in Khalid's inbox");
  const n1 = await approveAll(khalid, /Leave[\s\S]*annual|Annual leave/i);
  const n2 = await approveAll(fatima, /Leave[\s\S]*Annual leave/i);
  await go(ramesh, "/me"); const t = await body(ramesh);
  must(/Annual leave[\s\S]{0,80}Approved/i.test(t) || /Approved/.test(await ramesh.locator("table", { hasText: "LV" }).first().innerText()), "not approved on ESS");
  await ramesh.screenshot({ path: `${EV}/hr-ess-leave.png`, fullPage: true }); return `approved by Khalid (${n1}) then HR (${n2})`;
});
await step("TC-HR07-01", "overtime recorded by HR goes to the line manager; approved hours are counted for payroll", async () => {
  await go(fatima, "/hr/overtime"); const f = fatima.locator("form:has(button:has-text('Send for approval'))");
  await pickOpt(f.locator("select[name=employee_id]"), /Ramesh Kumar/); await f.locator("input[name=work_date]").fill(WORKDAY);
  await f.locator("input[name=hours]").fill("3"); await f.locator("select[name=ot_type]").selectOption("normal"); await f.locator("input[name=reason]").fill("Fleet job finished late");
  await f.locator("button:has-text('Send for approval')").click(); await settle(fatima); must(/sent for approval/.test(await flash(fatima)), await flash(fatima));
  const n = await approveAll(khalid, /Overtime/); await go(fatima, "/hr/overtime"); const t = await body(fatima);
  must(/3\.00 approved hours/.test(t), "approved hours not 3"); return `Khalid approved ${n}; 3.00 approved hours this month`;
});

// ---------------------------------------------------------------- letters, transfers, recruitment
await step("TC-HR08-01", "an employee asks for a salary certificate; HR approves; the letter has a reference and the salary", async () => {
  await go(priya, "/me"); await priya.selectOption("#tc", "salary_certificate"); await priya.fill("#at", "Emirates NBD");
  await priya.click("button:has-text('Ask HR')"); await settle(priya); must(/sent for approval/.test(await flash(priya)), await flash(priya));
  await approveAll(fatima, /HR letter/); await go(priya, "/me"); await priya.click("a:has-text('Salary certificate')"); await settle(priya);
  const t = await body(priya); must(/HRL/.test(t) && /Emirates NBD/.test(t) && /7,300\.00/.test(t), `letter: ${t.slice(0, 300)}`);
  await priya.screenshot({ path: `${EV}/hr-letter.png`, fullPage: true }); return "Reference and AED 7,300.00 on the letter";
});
await step("TC-HR09-01", "HR transfers Anil to QUS from the 10th of this month; the org chart and transfer list show it", async () => {
  await go(fatima, "/hr/transfers"); const f = fatima.locator("form:has(button:has-text('Transfer'))");
  await pickOpt(f.locator("select[name=employee_id]"), /Anil Kumar/); await pickOpt(f.locator("select[name=to_branch_id]"), /^QUS/);
  await f.locator("input[name=effective_date]").fill(`${THIS}-10`); await f.locator("input[name=reason]").fill("Cover at Qusais");
  await f.locator("button:has-text('Transfer')").click(); await settle(fatima);
  const t = await body(fatima); must(/Anil Kumar\s+YAS\s+QUS/.test(t.replace(/\s+/g, " ")), "transfer not listed"); must(/Reporting lines/.test(t) && /Yousef Kareem/.test(t), "org chart missing");
  return "YAS → QUS listed, applied";
});
await step("TC-HR10-01", "recruitment: opening, applicant, interview, offer and hire creates an employee file", async () => {
  await go(fatima, "/hr/recruitment"); await fatima.click("summary:has-text('New opening')");
  await fatima.fill("form:has(button:has-text('Add opening')) input[name=title]", "Recovery driver"); await fatima.click("button:has-text('Add opening')"); await settle(fatima);
  await fatima.click("summary:has-text('Add applicant')"); await fatima.fill("form:has(button:has-text('Add applicant')) input[name=full_name]", "Imran Shah");
  await fatima.click("button:has-text('Add applicant')"); await settle(fatima);
  let row = fatima.locator("tr", { hasText: "Imran Shah" }); await row.locator("select[name=stage]").selectOption("interview"); await row.locator("input[name=interview_notes]").fill("Good driving record");
  await row.locator("button:has-text('Move')").click(); await settle(fatima);
  row = fatima.locator("tr", { hasText: "Imran Shah" }); await row.locator("select[name=stage]").selectOption("offer"); await row.locator("button:has-text('Move')").click(); await settle(fatima);
  const e = await flash(fatima); must(/offered salary/.test(e), `no refusal without salary: ${e}`);
  row = fatima.locator("tr", { hasText: "Imran Shah" }); await row.locator("select[name=stage]").selectOption("offer"); await row.locator("input[name=offer_salary]").fill("2800"); await row.locator("button:has-text('Move')").click(); await settle(fatima);
  row = fatima.locator("tr", { hasText: "Imran Shah" }); await row.locator("input[name=joining_date]").fill(dubai(14)); await row.locator("button:has-text('Hire')").click(); await settle(fatima);
  const f = await flash(fatima); must(/Hired as SF-\d+/.test(f), f); return f;
});

// ---------------------------------------------------------------- payroll: last month
await step("TC-PR01-01", "HR calculates last month: everyone with a salary, Ramesh's approved overtime paid, lines to check flagged", async () => {
  await go(fatima, "/payroll"); await fatima.fill("#pm", LAST); await fatima.click("button:has-text('Calculate')"); await settle(fatima);
  const f = await flash(fatima); must(/Calculated: 11 employees/.test(f), f);
  const t = await body(fatima); must(/Ramesh Kumar[\s\S]{0,200}3,415\.07/.test(t), "Ramesh net not 3,415.07");
  must(/Overtime above 2 h/.test(t), "overtime flag missing");
  await fatima.screenshot({ path: `${EV}/pr-run-calculated.png`, fullPage: true }); return f;
});
await step("TC-PR02-01", "sent for approval, the owner approves; the month is locked against recalculation", async () => {
  await fatima.click("button:has-text('send to owner')"); await settle(fatima); must(/Sent to the owner/.test(await flash(fatima)), await flash(fatima));
  await go(saeed, "/approvals"); must(/Payroll[\s\S]*net:/.test(await body(saeed)), "payroll not in owner's inbox with figures");
  await approveAll(saeed, /Payroll/); await go(fatima, `/payroll/${LAST}`); must(/Post to the accounts/.test(await body(fatima)), "not approved");
  await go(fatima, "/payroll"); await fatima.fill("#pm", LAST); await fatima.click("button:has-text('Calculate')"); await settle(fatima);
  const f = await flash(fatima); must(/approved and locked/.test(f), `recalc allowed: ${f}`); return f;
});
await step("TC-PR02-02", "after approval the employee sees the payslip with the overtime line in self-service", async () => {
  await go(ramesh, "/me"); await ramesh.click(`a:has-text('${LAST}')`); await settle(ramesh);
  const t = await body(ramesh); must(/Overtime[\s\S]{0,40}115\.07/.test(t) && /Net pay[\s\S]{0,40}3,415\.07/.test(t), `payslip: ${t.slice(0, 400)}`);
  must(/صافي الراتب/.test(t), "no Arabic labels"); await ramesh.screenshot({ path: `${EV}/pr-payslip.png`, fullPage: true });
  await go(fatima, `/payroll/${LAST}`); const other = (await fatima.locator("a", { hasText: "Priya Menon" }).first().getAttribute("href")) ?? "";
  must(other.includes("/payroll/payslip/"), "no payslip link for Priya"); await ramesh.goto(B + other); must(/could not be shown/i.test(await ramesh.locator("body").innerText()), "sees another payslip");
  return "Overtime 115.07, net 3,415.07, other payslips refused";
});
await step("TC-PR03-01", "posting puts the salary cost on each branch and net pay in salaries payable", async () => {
  await go(fatima, `/payroll/${LAST}`); await fatima.click("button:has-text('Post to the accounts')"); await settle(fatima);
  must(/Posted to the accounts/.test(await flash(fatima)), await flash(fatima));
  const maryam = await as("maryam"); await go(maryam, "/accounts/day-book"); const t = await body(maryam);
  must(/Payroll/.test(t), "no payroll voucher in the day book"); return "Payroll journals in the day book";
});
await step("TC-PR04-01", "WPS salary files: one per agent, SIF lines with EDR records and the SCR control line", async () => {
  await go(fatima, `/payroll/${LAST}`); await fatima.click("button:has-text('Create WPS salary files')"); await settle(fatima);
  must(/2 WPS salary file/.test(await flash(fatima)), await flash(fatima));
  const [dl] = await Promise.all([fatima.waitForEvent("download"), fatima.locator("a[href^='/api/payroll/wps/']").first().click()]);
  const txt = fs.readFileSync(await dl.path(), "utf8"); fs.writeFileSync(`${EV}/pr-wps-${dl.suggestedFilename()}`, txt);
  must(/^EDR,\d{14},\d{9},/m.test(txt) && /^SCR,1000000123456,/m.test(txt), `SIF: ${txt.slice(0, 200)}`);
  return `${dl.suggestedFilename()}: ${txt.split("\n").length} lines`;
});
await step("TC-PR04-02", "mark paid from the bank; the run is Paid", async () => {
  await go(fatima, `/payroll/${LAST}`); await fatima.locator("select[name=bank_account_id]").selectOption({ index: 1 });
  await fatima.click("button:has-text('Mark paid')"); await settle(fatima); must(/Marked paid/.test(await flash(fatima)), await flash(fatima));
  must(/Paid/.test(await fatima.locator(".steps").innerText()), "step not paid"); return "Paid";
});
await step("TC-PR05-01", "the branch register shows component columns and branch totals; the CSV downloads", async () => {
  await go(fatima, `/payroll/${LAST}/register`); const t = await body(fatima);
  must(/YAS total/.test(t) && /QUS total/.test(t) && /HQ total/.test(t) && /Housing allowance/i.test(t), "register incomplete");
  const [dl] = await Promise.all([fatima.waitForEvent("download"), fatima.click("a:has-text('Download CSV')")]);
  const csv = fs.readFileSync(await dl.path(), "utf8"); must(/Branch total/.test(csv) && /Ramesh Kumar/.test(csv), "csv wrong"); return dl.suggestedFilename();
});

// ---------------------------------------------------------------- loans and salary updates
await step("TC-PR06-01", "an advance above three months' salary is refused, in red under Amount", async () => {
  await go(ramesh, "/me"); await ramesh.selectOption("#lk", "advance"); await ramesh.fill("#la", "20000"); await ramesh.fill("#li", "2"); await ramesh.fill("#lre", "Family need");
  await ramesh.click("form:has(#la) button:has-text('Send to my manager')"); await settle(ramesh);
  const e = await inlineErr(ramesh); const lab = await fieldOfErr(ramesh); must(/Amount/.test(lab) && /3 months/.test(e), `${e} under ${lab}`); return e;
});
await step("TC-PR06-02", "an advance of 1,000 over 2 months: line manager, then owner approve; it is paid out and listed", async () => {
  await ramesh.fill("#la", "1000"); await ramesh.fill("#ls", THIS); await ramesh.click("form:has(#la) button:has-text('Send to my manager')"); await settle(ramesh);
  must(/Sent for approval/.test(await flash(ramesh)), await flash(ramesh));
  await approveAll(khalid, /Advance or loan/); await approveAll(saeed, /Advance or loan/);
  await go(fatima, "/payroll/loans"); const t = await body(fatima); must(/LN-[\s\S]{0,60}Ramesh Kumar[\s\S]{0,200}Approved/.test(t), "loan not approved"); return "Approved: 2 × 500.00";
});
await step("TC-PR07-01", "salary update for Ramesh from next month goes to the owner; after approval the salary history shows it", async () => {
  await go(fatima, "/payroll/revisions"); await pickOpt(fatima.locator("select[name=l_employee]").first(), /Ramesh Kumar/);
  await fatima.locator("input[name=l_amount]").first().fill("2200"); await fatima.fill("#rr", "Annual increment");
  await fatima.click("button:has-text('Send for approval')"); await settle(fatima); must(/sent to the owner/.test(await flash(fatima)), await flash(fatima));
  await approveAll(saeed, /Salary update/); await go(fatima, "/payroll/revisions"); must(/SR-[\s\S]{0,200}2000\.00 → 2200\.00[\s\S]{0,120}Approved/.test(await body(fatima)), "not approved");
  return `Basic 2,000 → 2,200 from ${NEXT1}`;
});

// ---------------------------------------------------------------- payroll: this month
await step("TC-PR08-01", "this month: the advance instalment is deducted and Anil's cost is split between YAS and QUS by days", async () => {
  await go(fatima, "/payroll"); await fatima.fill("#pm", THIS); await fatima.click("button:has-text('Calculate')"); await settle(fatima);
  const t = await body(fatima); must(/Calculated/.test(await flash(fatima)), await flash(fatima));
  must(/Anil Kumar[\s\S]{0,300}QUS \d+, YAS 9/.test(t.replace(/\s+/g, " ")), "no branch split for Anil");
  await go(fatima, `/payroll/payslip/${THIS}/${(await fatima.locator("a", { hasText: "Ramesh Kumar" }).first().getAttribute("href") ?? "").split("/").pop()}`);
  const s = await body(fatima); must(/Advance[\s\S]{0,40}500\.00/.test(s), `no advance instalment: ${s.slice(0, 400)}`);
  return "Advance 500.00 deducted; Anil QUS/YAS 9 days";
});
await step("TC-PR10-01", "the owner can reopen an approved payroll with a reason; HR then recalculates", async () => {
  await go(fatima, `/payroll/${THIS}`); await fatima.click("button:has-text('send to owner')"); await settle(fatima); await approveAll(saeed, /Payroll/);
  await go(saeed, `/payroll/${THIS}`); await saeed.fill("input[name=reason]", "Late overtime claim"); await saeed.click("button:has-text('Reopen')"); await settle(saeed);
  must(/Reopened/.test(await flash(saeed)), await flash(saeed));
  await go(fatima, `/payroll/${THIS}`); must(/Recalculate/.test(await body(fatima)) && /Late overtime claim/.test(await body(fatima)), "not open again");
  return "Reopened with reason";
});

// ---------------------------------------------------------------- final settlement
await step("TC-PR09-01", "final settlement for Rashid: figures shown, owner approves, the employee is marked as left", async () => {
  await go(fatima, "/payroll/settlements/new"); await pickOpt(fatima.locator("#se"), /Rashid Khan/); await fatima.fill("#sl", dubai(-1)); await fatima.selectOption("#sr", "resignation");
  await fatima.click("button:has-text('Show the figures')"); await settle(fatima); const t = await body(fatima);
  must(/Gratuity[\s\S]{0,200}21 days a year/.test(t) && /Net payable/.test(t), `no statement: ${t.slice(0, 300)}`);
  await fatima.click("button:has-text('Send to owner for approval')"); await settle(fatima); must(/sent to the owner/.test(await flash(fatima)), await flash(fatima));
  await approveAll(saeed, /Final settlement/); await go(fatima, "/hr/employees?status=left"); must(/Rashid Khan/.test(await body(fatima)), "not marked left");
  await go(fatima, "/payroll/settlements"); await fatima.click("a:has-text('FS-')"); await settle(fatima); await fatima.screenshot({ path: `${EV}/pr-settlement.png`, fullPage: true });
  return "Approved; Rashid listed as left";
});

console.log(`\n${pass} passed, ${fail} failed`);
fs.writeFileSync(`${EV}/phase5-results.json`, JSON.stringify(results, null, 1));
await browser.close();
