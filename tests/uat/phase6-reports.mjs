// Phase 6 reports in the browser, one test case at a time: owner dashboard and funnel, standard and Tally
// reports (TR-01 to TR-06), branch scope and hidden fields, export and print, copies, the report builder
// (columns, totals, calculations, pivot, chart, prompts), sharing, pinning, schedules and the inbox, and the archive.
// Needs the app on :3000 and a fresh demo database (npm run db:reset). Run: node tests/uat/phase6-reports.mjs
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
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(500); await p.waitForLoadState("networkidle"); };
const go = async (p, path) => { await p.goto(B + path); await settle(p); };
const body = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const heads = async (p, sel = "[data-testid=report-table]") => (await p.locator(`${sel} thead th`).evaluateAll((els) => els.map((e) => (e.textContent || "").trim()))).filter(Boolean);
const rowsText = async (p, sel = "[data-testid=report-table]") => (await p.locator(`${sel} tbody tr`).allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
const results = []; let pass = 0, fail = 0;
const step = async (id, name, fn) => {
  try { const r = await fn(); pass++; results.push({ id, name, status: "Pass", note: String(r ?? "") }); console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; results.push({ id, name, status: "Fail", note: String(e.message).split("\n")[0] }); console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const shot = (p, n) => p.screenshot({ path: `${EV}/${n}.png`, fullPage: true });
const dubai = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + days * 86400000));
const TODAY = dubai(0);
const dl = async (p, sel) => { const [d] = await Promise.all([p.waitForEvent("download"), p.click(sel)]); const f = await d.path(); return { name: d.suggestedFilename(), buf: fs.readFileSync(f) }; };

const saeed = await as("saeed"), priya = await as("priya"), yousef = await as("yousef"), fatima = await as("fatima.hr"), anil = await as("anil"), khalid = await as("khalid"), ramesh = await as("ramesh");

// ---------------------------------------------------------------- data for the period (through the normal screens)
await step("TC-RP00-01", "Setup: Priya invoices the ready job and takes payment by card and cash; a counter sale; Anil raises a PO and asks QUS for parts", async () => {
  await go(priya, "/jobs"); await priya.click("a:has-text('YAS-1483')"); await settle(priya);
  await priya.click("a:has-text('Prepare the invoice')"); await settle(priya); await priya.click("button:has-text('Post invoice')"); await settle(priya);
  await priya.selectOption("select[name=method]", "card"); await priya.fill("input[name=amount]", "200"); await priya.fill("input[name=reference]", "SLIP-6001");
  await priya.click("button:has-text('Record payment')"); await settle(priya);
  await priya.selectOption("select[name=method]", "cash"); await priya.click("button:has-text('Record payment')"); await settle(priya);
  must(!(await priya.locator("button:has-text('Record payment')").count()), "invoice still open: " + (await flash(priya)));
  await go(priya, "/billing/counter-sale"); const v = await priya.locator("select[name=item_id] option", { hasText: "OIL-5W30-L" }).first().getAttribute("value");
  await priya.locator("select[name=item_id]").first().selectOption(v); await priya.locator("input[name=qty]").first().fill("2");
  await priya.fill("input[name=bill_to_name]", "Ali"); await priya.selectOption("select[name=method]", "cash"); await priya.click("button:has-text('Post sale')"); await settle(priya);
  must(/67\.20/.test(await body(priya)), "counter sale not posted: " + (await flash(priya)));
  await go(anil, "/purchasing"); await anil.click("summary:has-text('New purchase order')"); await anil.selectOption("select[name=supplier_id]", { label: "Bridgestone Middle East" });
  await anil.click("button:has-text('Create and add lines')"); await settle(anil);
  const t = await anil.locator("select[name=item_id] option", { hasText: "TYR-2656517" }).getAttribute("value"); await anil.selectOption("select[name=item_id]", t);
  await anil.fill("input[name=qty]", "8"); await anil.fill("input[name=unit_price]", "285"); await anil.click("button:has-text('Add line')"); await settle(anil);
  await anil.click("button:has-text('Submit for approval')"); await settle(anil);
  await go(anil, "/stock/transfers"); await anil.click("summary:has-text('Ask another branch for parts')");
  const f = anil.locator("form:has(button:has-text('Send request'))"); await f.locator("select[name=from_branch_id]").selectOption({ label: "QUS · Al Quoz" }).catch(async () => {
    const o = await f.locator("select[name=from_branch_id] option", { hasText: "QUS" }).first().getAttribute("value"); await f.locator("select[name=from_branch_id]").selectOption(o); });
  const it = await f.locator("select[name=item_id] option", { hasText: "OIL-5W30-L" }).first().getAttribute("value"); await f.locator("select[name=item_id]").first().selectOption(it);
  await f.locator("input[name=qty]").first().fill("4"); await f.locator("input[name=note]").fill("Stock for weekend"); await f.locator("button:has-text('Send request')").click(); await settle(anil);
  return `invoice paid, counter sale 67.20, PO submitted, transfer requested (${await flash(anil)})`;
});

// ---------------------------------------------------------------- owner dashboard
await step("TC-RP01-01", "Owner dashboard: today's sales, cars, cash and the enquiry-to-invoice funnel by branch", async () => {
  await go(saeed, "/reports"); const t = await body(saeed);
  must(/Sales today \(net\)/.test(t) && /Cars on site now/.test(t) && /Receivables open/.test(t), "KPIs missing");
  const sales = await saeed.locator("[data-testid=kpis] .kpi").first().locator(".v").innerText(); must(Number(sales.replace(/,/g, "")) > 0, "sales today is " + sales);
  const inv = await saeed.locator("[data-testid=funnel-invoiced] .v").innerText(), enq = await saeed.locator("[data-testid=funnel-enquiries] .v").innerText();
  must(inv === "1" && enq === "4", `funnel ${enq} -> ${inv}`);
  const yas = (await rowsText(saeed, "[data-testid=by-branch]")).find((r) => r.startsWith("YAS")); must(yas, "YAS row missing");
  await shot(saeed, "p6-owner-dashboard"); return `sales today ${sales}; funnel 4 enquiries -> 1 invoiced; ${yas.slice(0, 60)}`;
});
await step("TC-RP01-02", "Drill-down: the YAS cars-in figure opens the job card list for YAS only", async () => {
  await go(saeed, "/reports"); const row = saeed.locator("[data-testid=by-branch] tbody tr", { hasText: "YAS" }).first();
  await row.locator("td").nth(3).locator("a").click(); await settle(saeed);
  must(/\/reports\/run\/job_list/.test(saeed.url()), "not job list: " + saeed.url());
  const rs = await rowsText(saeed); must(rs.length === 2 && rs.every((r) => /YAS-14/.test(r)), "rows: " + rs.join(" / "));
  must(/Branches: YAS/.test(await saeed.locator("[data-testid=report-sub]").innerText()), "branch not narrowed"); return rs.map((r) => r.split(" ")[0]).join(", ");
});

// ---------------------------------------------------------------- Tally reports
await step("TC-RP02-01", "TR-02 sales report: each invoice with net, VAT, gross; summary by customer, item and service", async () => {
  await go(saeed, "/reports/run/sales_register"); let rs = await rowsText(saeed);
  must(rs.length === 2, "invoices " + rs.length); const h = await heads(saeed); must(["Net", "VAT", "Gross", "Paid", "Open"].every((x) => h.includes(x)), "heads " + h);
  const total = await saeed.locator("[data-testid=report-table] tfoot").textContent(); must(/Total/.test(total), "no totals");
  await go(saeed, "/reports/run/sales_register?by=item"); rs = await rowsText(saeed); must(rs.some((r) => /OIL-5W30-L/.test(r)), "item summary: " + rs.join(" / "));
  await go(saeed, "/reports/run/sales_register?by=service"); rs = await rowsText(saeed); must(rs.length >= 1 && !/Nothing/.test(rs[0]), "service summary empty");
  await go(saeed, "/reports/run/sales_register?by=customer"); rs = await rowsText(saeed); must(rs.some((r) => /Ali/.test(r)) && rs.some((r) => /Fatima/.test(r)), "customer summary: " + rs.join(" / "));
  await shot(saeed, "p6-sales-by-customer"); return rs.join(" / ");
});
await step("TC-RP02-02", "TR-02 advisor filter: Priya's invoices only; by advisor shows the counter sale separately", async () => {
  await go(saeed, "/reports/run/sales_register"); const o = await saeed.locator("select[name=advisor] option", { hasText: "Priya" }).first().getAttribute("value");
  await saeed.selectOption("select[name=advisor]", o); await saeed.click("[data-testid=report-filters] button:has-text('Show')"); await settle(saeed);
  const rs = await rowsText(saeed); must(rs.length === 1 && /Priya/.test(rs[0]), "advisor filter: " + rs.join(" / "));
  await go(saeed, "/reports/run/sales_register?by=advisor"); const r2 = await rowsText(saeed); must(r2.some((r) => /Counter sale/.test(r)) && r2.some((r) => /Priya/.test(r)), r2.join(" / "));
  return r2.join(" / ");
});
await step("TC-RP04-01", "TR-01 next service: vehicles due and overdue; Prepare WhatsApp gives the text to send yourself, then mark as sent", async () => {
  await go(priya, "/reports/run/next_service"); const rs = await rowsText(priya);
  must(rs.some((r) => /11024/.test(r) && /Due/.test(r)), "due vehicle missing"); must(rs.some((r) => /11021/.test(r) && /Overdue/.test(r)), "overdue vehicle missing");
  must(!rs.some((r) => /11028/.test(r)), "QUS vehicle shown to a YAS advisor");
  await priya.locator("[data-testid=report-table] tbody tr", { hasText: "11024" }).locator("[data-testid=prepare-reminder]").click(); await settle(priya);
  const msg = await priya.locator("pre.msg").innerText(); must(/11024/.test(msg) && /next service/.test(msg) && /41,000/.test(msg), "message: " + msg);
  must(await priya.locator("a:has-text('Open WhatsApp')").count(), "no WhatsApp link");
  await priya.click("button:has-text('Mark as sent')"); await settle(priya);
  const r2 = (await rowsText(priya)).find((r) => /11024/.test(r)); must(/\d{2}\/\d{2}\/\d{4}\s*$/.test(r2.trim()), "reminder date not shown: " + r2);
  await shot(priya, "p6-next-service"); return msg.slice(0, 120);
});
await step("TC-RP04-02", "TR-04 pending LPO and TR-05 pending transfer notes list what waits, with approver and age", async () => {
  await go(saeed, "/reports/run/pending_lpo"); let rs = await rowsText(saeed); must(rs.some((r) => /Bridgestone/.test(r) && /Pending approval|Waiting|Approved/i.test(r)), "LPO: " + rs.join(" / "));
  await go(saeed, "/reports/run/pending_transfers"); rs = await rowsText(saeed); must(rs.some((r) => /QUS/.test(r) && /YAS/.test(r)), "transfer: " + rs.join(" / "));
  return rs.join(" / ");
});
await step("TC-RP06-01", "TR-06 insurance register: Ramesh's policy in the 60-day band; the 30-day view is empty", async () => {
  await go(fatima, "/reports/run/insurance_register"); let rs = await rowsText(fatima); must(rs.some((r) => /Ramesh/.test(r) && /Daman/.test(r) && /60 days/.test(r)), rs.join(" / "));
  const h = await heads(fatima); must(h.includes("Premium"), "HR should see the premium");
  await go(fatima, "/reports/run/insurance_register?within=30"); rs = await rowsText(fatima); must(/Nothing/.test(rs[0]), "30-day: " + rs[0]);
  return "Daman DM-77-1203 in 60 days band";
});
await step("TC-RP06-02", "Document expiries: 30 days lists Ramesh's passport and Khalid's visa (seeded for the renewal demo); 60 days adds the two other visas", async () => {
  await go(fatima, "/reports/run/document_expiries?within=30"); let rs = await rowsText(fatima);
  must(rs.length === 2 && rs.some((r) => /Ramesh/.test(r) && /Passport/i.test(r)) && rs.some((r) => /Khalid/.test(r) && /Visa/i.test(r)), "30: " + rs.join(" / "));
  await go(fatima, "/reports/run/document_expiries?within=60"); rs = await rowsText(fatima);
  must(rs.filter((r) => /Visa/i.test(r)).length === 3 && rs.some((r) => /Passport/i.test(r)), "60: " + rs.join(" / ")); return rs.map((r) => r.slice(0, 50)).join(" / ");
});

// ---------------------------------------------------------------- access: branch scope and hidden fields (RB-11)
await step("TC-RP03-01", "Hidden fields: the foreman sees selling prices but no cost or stock value; HR sees no sales reports; a technician has no Reports menu", async () => {
  await go(khalid, "/reports/run/quote_conversion"); let h = await heads(khalid); must(h.includes("Quoted") && h.includes("Conversion %"), "foreman quote heads " + h);
  await go(khalid, "/reports/run/stock_by_branch"); h = await heads(khalid); must(!h.some((x) => /Average cost|^Value$/.test(x)) && h.length > 2, "foreman stock heads " + h);
  await go(fatima, "/reports/all"); const t = await body(fatima); must(!/Sales report/.test(t) && /Employee insurance register/.test(t), "HR index wrong");
  await go(fatima, "/reports/run/sales_register"); must(/could not be shown/.test(await body(fatima)), "HR opened sales");
  await go(ramesh, "/"); must(!/Reports dashboard/.test(await ramesh.locator("aside").innerText()), "technician has Reports menu");
  await go(ramesh, "/reports"); must(/could not be shown/.test(await body(ramesh)), "technician opened reports"); return "foreman: " + h.join(", ");
});
await step("TC-RP03-02", "Branch scope: the YAS manager only reports on YAS; asking for QUS in the address is refused", async () => {
  await go(yousef, "/reports/run/stock_by_branch"); const rs = await rowsText(yousef); must(rs.every((r) => r.startsWith("YAS")), "other branch rows");
  const sub = await yousef.locator("[data-testid=report-sub]").innerText(); must(/Branches: YAS$|Branches: YAS ·|Branches: YAS /.test(sub), sub);
  await go(saeed, "/reports/run/stock_by_branch"); const qus = await saeed.locator("input[name=branches]").evaluateAll((els) => els.find((e) => e.parentElement.textContent.includes("QUS")).value);
  await go(yousef, `/reports/run/stock_by_branch?branches=${qus}`); must(/could not be shown/.test(await body(yousef)), "QUS allowed");
  const r = await yousef.request.get(`${B}/api/reports/export?ref=std:stock_by_branch&branches=${qus}&format=csv`); must(r.status() === 403, "export status " + r.status());
  return `${rs.length} YAS rows; QUS refused on screen and export`;
});
await step("TC-RP03-03", "Stock report: the advisor sees no cost or value columns; the stock keeper does", async () => {
  await go(priya, "/reports/run/stock_by_branch"); const h1 = await heads(priya); must(!h1.includes("Value") && !h1.includes("Average cost"), "advisor sees cost");
  await go(anil, "/reports/run/stock_by_branch"); const h2 = await heads(anil); must(h2.includes("Value"), "stock keeper misses value"); return `advisor: ${h1.length} cols, stock keeper: ${h2.length} cols`;
});

// ---------------------------------------------------------------- export and print (RB-09)
await step("TC-RP07-01", "Export: the owner downloads Excel and CSV of the sales report; the advisor has no export and the link is refused", async () => {
  await go(saeed, "/reports/run/sales_register"); const x = await dl(saeed, "[data-testid=export-xlsx]");
  must(x.name.endsWith(".xlsx") && x.buf.slice(0, 2).toString() === "PK" && x.buf.includes(Buffer.from("xl/worksheets/sheet1.xml")), "xlsx " + x.name);
  const c = await dl(saeed, "[data-testid=export-csv]"); const csv = c.buf.toString("utf8"); must(/Invoice,Date,Branch,Customer/.test(csv) && /Total/.test(csv), "csv " + csv.slice(0, 120));
  fs.writeFileSync(`${EV}/p6-sales.xlsx`, x.buf); fs.writeFileSync(`${EV}/p6-sales.csv`, c.buf);
  await go(priya, "/reports/run/sales_register"); must(!(await priya.locator("[data-testid=export-xlsx]").count()), "advisor sees Excel");
  const r = await priya.request.get(`${B}/api/reports/export?ref=std:sales_register&format=xlsx`); must(r.status() === 403, "status " + r.status());
  return `${x.name} ${x.buf.length} bytes; CSV ${csv.split("\n").length} lines; advisor 403`;
});
await step("TC-RP07-02", "Print or PDF: the letterhead appears only when printing, filters and buttons are hidden", async () => {
  await go(saeed, "/reports/run/sales_summary"); must(!(await saeed.locator(".letterhead").isVisible()), "letterhead on screen");
  await saeed.emulateMedia({ media: "print" }); const lh = await saeed.locator(".letterhead").isVisible(), fl = await saeed.locator("[data-testid=report-filters]").isVisible();
  await saeed.pdf?.({ path: `${EV}/p6-sales-summary.pdf` }).catch(() => {}); await shot(saeed, "p6-print-view"); await saeed.emulateMedia({ media: "screen" });
  must(lh && !fl, `letterhead ${lh}, filters ${fl}`); return "letterhead shown in print, filters hidden";
});
await step("TC-RP13-01", "Wrong filters are explained: start after end, and attendance over 62 days", async () => {
  await go(saeed, `/reports/run/job_list?from=${TODAY}&to=2026-01-01`); const e1 = await saeed.locator("[data-testid=report-error]").innerText(); must(/start date is after the end date/.test(e1), e1);
  await go(fatima, "/reports/run/attendance_exceptions?from=2026-01-01&to=2026-06-30"); const e2 = await fatima.locator("[data-testid=report-error]").innerText(); must(/62 days/.test(e2), e2);
  return `${e1} | ${e2}`;
});

// ---------------------------------------------------------------- workshop, finance, HR, approvals
await step("TC-RP15-01", "Workshop: jobs by status, technician efficiency with Ramesh's clocked time, bill settlement with both receipts", async () => {
  await go(yousef, "/reports/run/jobs_by_status"); let rs = await rowsText(yousef); must(rs.length >= 2, "status rows " + rs.join(" / "));
  must(await yousef.locator("figure.chart svg").count(), "chart missing");
  await go(yousef, "/reports/run/tech_efficiency"); rs = await rowsText(yousef); must(rs.some((r) => /Ramesh/.test(r)), "efficiency: " + rs.join(" / "));
  await go(saeed, "/reports/run/bill_settlement"); rs = await rowsText(saeed); const yas = rs.find((r) => /YAS-INV|YAS/.test(r) && /RCT|,/.test(r)) ?? rs[0];
  must(rs.some((r) => (r.match(/RC|RCT|REC/g) ?? []).length >= 2 || /, /.test(r)), "receipts not listed: " + rs.join(" / "));
  await shot(saeed, "p6-bill-settlement"); return yas.slice(0, 120);
});
await step("TC-RP17-01", "Approvals waiting shows Ramesh's sick leave at the line manager; cash by method shows card and cash", async () => {
  await go(saeed, "/reports/run/approvals_pending"); let rs = await rowsText(saeed); must(rs.some((r) => /Leave request/.test(r) && /Line manager/.test(r)), rs.join(" / "));
  await go(saeed, "/reports/run/receipts_by_method"); rs = await rowsText(saeed); must(rs.some((r) => /Card/.test(r)) && rs.some((r) => /Cash/.test(r)), rs.join(" / "));
  return rs.join(" / ");
});
await step("TC-RP14-01", "HR reports: headcount by department; payroll cost visible to HR and the owner, hidden from the branch manager", async () => {
  await go(fatima, "/reports/run/headcount"); const rs = await rowsText(fatima); must(rs.some((r) => /Workshop|Service|Finance/.test(r)), rs.join(" / "));
  await go(fatima, "/reports/run/payroll_by_branch"); must(!/could not be shown/.test(await body(fatima)), "HR cannot open payroll cost");
  await go(yousef, "/reports/run/payroll_by_branch"); must(/could not be shown/.test(await body(yousef)), "branch manager opened payroll cost");
  return rs.slice(0, 3).join(" / ");
});

// ---------------------------------------------------------------- copy, builder, share, pin, schedule
let copyUrl, builtUrl;
await step("TC-RP09-01", "RB-08 copy: Priya copies the job card list without the customer column, renames Plate and moves it first", async () => {
  await go(priya, "/reports/run/job_list"); await priya.click("[data-testid=copy-box] summary");
  const box = priya.locator("[data-testid=copy-box]"); await box.locator("input[name=name]").fill("My open jobs");
  await box.locator("input[aria-label='Keep Customer']").uncheck(); await box.locator("input[aria-label='Label for Plate']").fill("Reg no");
  await box.locator("input[aria-label='Order of Plate']").fill("0"); await box.locator("button:has-text('Save copy')").click(); await settle(priya);
  copyUrl = priya.url(); must(/\/reports\/saved\//.test(copyUrl), "not saved: " + (await flash(priya)));
  const h = await heads(priya); must(h[0] === "Reg no" && !h.includes("Customer"), "heads " + h.join(","));
  await go(priya, "/reports/all"); must(/My open jobs/.test(await priya.locator("[data-testid=saved-list]").innerText()), "not listed");
  return h.join(", ");
});
await step("TC-RP10-01", "RB-01..06 builder: sales lines by branch and line type with net and cost totals, a gross profit calculation and a bar chart; saved", async () => {
  await go(saeed, "/reports/builder?source=sales"); const f = saeed.locator("[data-testid=builder]");
  await f.locator("select[name=col_field_0]").selectOption("branch"); await f.locator("select[name=col_field_1]").selectOption("line_type");
  await f.locator("select[name=col_field_2]").selectOption("net"); await f.locator("select[name=col_agg_2]").selectOption("sum");
  await f.locator("select[name=col_field_3]").selectOption("cost"); await f.locator("select[name=col_agg_3]").selectOption("sum");
  await f.locator("input[name=k_label_0]").fill("Gross profit"); await f.locator("select[name=k_op_0]").selectOption("diff"); await f.locator("select[name=k_a_0]").selectOption("c2"); await f.locator("select[name=k_b_0]").selectOption("c3");
  await f.locator("select[name=chart_type]").selectOption("bar"); await f.locator("select[name=chart_x]").selectOption("c1"); await f.locator("select[name=chart_y]").selectOption("k0");
  await f.locator("[data-testid=preview]").click(); await settle(saeed);
  const h = await heads(saeed, "[data-testid=preview-table]"); must(h.includes("Gross profit") && h.includes("Total of net"), "preview heads " + h.join(","));
  must(await saeed.locator("figure.chart svg").count(), "no chart");
  const rs = await rowsText(saeed, "[data-testid=preview-table]"); must(rs.some((r) => /Labour/.test(r)) && rs.some((r) => /Part/.test(r)), rs.join(" / "));
  await shot(saeed, "p6-builder-preview");
  await saeed.locator("input[name=name]").fill("Gross profit by line type"); await saeed.click("[data-testid=save-report]"); await settle(saeed);
  builtUrl = saeed.url(); must(/\/reports\/saved\//.test(builtUrl), "not saved: " + (await flash(saeed))); return rs.join(" / ");
});
await step("TC-RP10-02", "RB-04 pivot: branches down, line types across, net totals", async () => {
  await go(saeed, "/reports/builder?source=sales&col_field_0=branch&pv_row=branch&pv_col=line_type&pv_value=net&pv_agg=sum");
  const h = await heads(saeed, "[data-testid=preview-table]"); must(h.includes("Labour") && h.includes("Part") && h.includes("Total"), "pivot heads " + h.join(","));
  return h.join(" | ");
});
await step("TC-RP10-03", "RB-11: the advisor is not offered Cost in the builder, and a hand-made address with it is refused", async () => {
  await go(priya, "/reports/builder?source=sales"); const opts = await priya.locator("select[name=col_field_0] option").allInnerTexts();
  must(!opts.includes("Cost") && !opts.includes("Margin") && opts.includes("Net"), "options " + opts.join(","));
  await go(priya, "/reports/builder?source=sales&col_field_0=cost"); const e = await priya.locator("[data-testid=builder-error]").innerText(); must(/not available to you/.test(e), e);
  return e;
});
await step("TC-RP10-04", "RB-03 prompt: a builder report on invoices asks for the branch when run", async () => {
  await go(saeed, "/reports/builder?source=invoices&col_field_0=doc_no&col_field_1=branch&col_field_2=gross&f_field_0=branch&f_op_0=eq&f_prompt_0=1");
  await saeed.locator("input[name=name]").fill("Invoices for one branch"); await saeed.click("[data-testid=save-report]"); await settle(saeed);
  const url = saeed.url(); must(/\/reports\/saved\//.test(url), await flash(saeed));
  await saeed.fill("[data-testid=prompt-0]", "QUS"); await saeed.click("[data-testid=report-filters] button:has-text('Show')"); await settle(saeed);
  let rs = await rowsText(saeed); must(/Nothing/.test(rs[0]), "QUS should have none: " + rs.join(" / "));
  await saeed.fill("[data-testid=prompt-0]", "YAS"); await saeed.click("[data-testid=report-filters] button:has-text('Show')"); await settle(saeed);
  rs = await rowsText(saeed); must(rs.length === 2, "YAS invoices " + rs.length); return rs.join(" / ");
});
await step("TC-RP11-01", "RB-07 share: Priya shares her copy with Yousef and the menu; he sees it under All reports and in his Reports menu", async () => {
  await go(priya, copyUrl.replace(B, "")); const box = priya.locator("[data-testid=share-box]");
  await box.locator("label", { hasText: "Yousef" }).locator("input").check(); await box.locator("input[name=in_menu]").check(); await box.locator("button:has-text('Save sharing')").click(); await settle(priya);
  must(/Sharing saved/.test(await flash(priya)), await flash(priya));
  await go(yousef, "/reports/all"); must(/My open jobs/.test(await yousef.locator("[data-testid=saved-list]").innerText()) && /Shared by Priya/.test(await yousef.locator("[data-testid=saved-list]").innerText()), "not shared");
  await go(yousef, "/reports"); must(/My open jobs/.test(await yousef.locator("aside").innerText()), "not in menu");
  await go(yousef, copyUrl.replace(B, "")); must(!(await yousef.locator("[data-testid=share-box]").count()), "Yousef can re-share");
  return "shared, in menu, read only for Yousef";
});
await step("TC-RP11-02", "RB-11 on sharing: the owner's report with cost, shared with advisors, opens for Priya with a clear message instead of the cost", async () => {
  await go(saeed, builtUrl.replace(B, "")); const box = saeed.locator("[data-testid=share-box]");
  await box.locator("label", { hasText: /^\s*Service advisor|Advisor/ }).first().locator("input").check(); await box.locator("button:has-text('Save sharing')").click(); await settle(saeed);
  await go(priya, builtUrl.replace(B, "")); const e = await priya.locator("[data-testid=report-error]").innerText(); must(/not available to you/.test(e), e); return e;
});
await step("TC-RP12-01", "Pin: the owner pins the sales summary as a bar chart to the reports dashboard, then unpins it", async () => {
  await go(saeed, "/reports/run/sales_summary"); await saeed.click("[data-testid=pin-box] summary"); await saeed.locator("[data-testid=pin-box] select[name=chart]").selectOption("bar");
  await saeed.locator("[data-testid=pin-box] button:has-text('Pin')").click(); await settle(saeed); must(/Pinned/.test(await flash(saeed)), await flash(saeed));
  await go(saeed, "/reports"); const w = saeed.locator("[data-testid=widgets] .card", { hasText: "Sales summary" }); must(await w.count(), "widget missing"); must(await w.locator("svg").count(), "no chart in widget");
  await shot(saeed, "p6-pinned"); await w.locator("button:has-text('Unpin')").click(); await settle(saeed); must(await saeed.locator("[data-testid=no-widgets]").count(), "not unpinned"); return "pinned and unpinned";
});
await step("TC-RP12-02", "RB-10 schedule: weekly cash by method goes to the report inbox; Prepare now makes an Excel file to download", async () => {
  await go(saeed, "/reports/run/receipts_by_method"); await saeed.click("[data-testid=schedule-box] summary"); await saeed.locator("[data-testid=schedule-box] select[name=frequency]").selectOption("weekly");
  await saeed.locator("[data-testid=schedule-box] button:has-text('Schedule')").click(); await settle(saeed); must(/Scheduled/.test(await flash(saeed)), await flash(saeed));
  await go(saeed, "/reports/inbox"); must(/Cash collected by method/.test(await saeed.locator("[data-testid=schedules]").innerText()), "schedule missing");
  await saeed.click("[data-testid=prepare-now]"); await settle(saeed); must(/1 report file/.test(await flash(saeed)), await flash(saeed));
  const f = await dl(saeed, "[data-testid=inbox-download]"); must(f.name.endsWith(".xlsx") && f.buf.slice(0, 2).toString() === "PK", f.name);
  fs.writeFileSync(`${EV}/p6-inbox.xlsx`, f.buf); await shot(saeed, "p6-inbox"); return f.name;
});

// ---------------------------------------------------------------- archive (AR-01 to AR-06)
await step("TC-RP08-01", "Archive: only the owner can run it; the run archives 4 old closed job cards and records a balanced ledger check", async () => {
  await go(yousef, "/reports/archive"); must(/Only the owner/.test(await body(yousef)), "manager can run");
  await go(saeed, "/reports/archive"); const n = await saeed.locator("[data-testid=pending-job_card]").innerText(); must(n === "4", "eligible job cards " + n);
  await saeed.fill("input[name=note]", "UAT archive"); await saeed.click("button:has-text('Run the archive now')"); await settle(saeed);
  const f = await flash(saeed); must(/Archive run 1 done/.test(f), f);
  const runs = await saeed.locator("[data-testid=archive-runs]").innerText(); must(/Balanced/.test(runs), runs);
  await shot(saeed, "p6-archive"); return f;
});
await step("TC-RP08-02", "AR-04 data source: Live hides the archived job cards; Archived and the run show only them; next service still uses the history", async () => {
  const q = `/reports/run/job_list?from=2024-01-01&to=${TODAY}`;
  await go(saeed, q); let rs = await rowsText(saeed); must(!rs.some((r) => /HIST-0[123]/.test(r)) && rs.some((r) => /HIST-04/.test(r)), "live: " + rs.map((r) => r.split(" ")[0]).join(","));
  await go(saeed, q + "&source=archived"); rs = await rowsText(saeed); must(rs.length === 4 && rs.every((r) => /HIST-0[123]/.test(r)), "archived: " + rs.map((r) => r.split(" ")[0]).join(","));
  const run = await saeed.locator("select[name=source] option", { hasText: "Archive run 1" }).getAttribute("value");
  await go(saeed, `${q}&source=${run}`); must((await rowsText(saeed)).length === 4, "by run");
  await go(saeed, "/reports/run/next_service"); must((await rowsText(saeed)).some((r) => /11021/.test(r)), "history lost in next service");
  return "live / archived / run 1 all correct";
});

console.log(`\n${pass} passed, ${fail} failed`);
fs.writeFileSync(`${EV}/phase6-results.json`, JSON.stringify(results, null, 2));
await browser.close();
process.exit(fail ? 1 : 0);
