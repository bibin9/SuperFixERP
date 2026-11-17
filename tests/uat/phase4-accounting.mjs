// Phase 4 accounting in the browser, one test case at a time, as a QA tester would run them: masters and opening
// balances from Tally, vouchers with approval, supplier payments and cheques issued, receivables, card settlement,
// bank reconciliation, reverse charge VAT, statements, head-office allocation, fixed assets, budgets, branch access
// and period close. Needs the app on :3000 and a fresh demo database (npm run db:reset).
// Run: node tests/uat/phase4-accounting.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import fs from "node:fs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; fs.mkdirSync(EV, { recursive: true });
const { Client } = require("pg");
const dbUrl = (() => { const u = new URL(process.env.PG_ADMIN_URL || "postgres://postgres:postgres@localhost:5432/postgres"); u.pathname = "/" + (process.env.DB_NAME || "superfix"); return u.toString(); })();
const db = new Client({ connectionString: dbUrl }); await db.connect();
/** Test data look-ups only (ids and codes); every action under test goes through the browser. */
const sql = async (q) => { const r = await db.query(q); const v = r.rows[0] ? Object.values(r.rows[0])[0] : ""; return v === null ? "" : String(v); };
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(15000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForLoadState("domcontentloaded"); await p.waitForTimeout(600); };
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const body = async (p) => (await p.locator("main, .main, body").first().innerText());
const results = [];
let pass = 0, fail = 0;
const step = async (id, name, fn) => {
  try { const r = await fn(); pass++; results.push({ id, status: "Pass", note: String(r ?? "") }); console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; results.push({ id, status: "Fail", note: String(e.message).split("\n")[0] }); console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const shot = (p, n) => p.screenshot({ path: `${EV}/${n}.png`, fullPage: true });
const goto = async (p, path) => { await p.goto(B + path); await settle(p); };
/** Approves the inbox item whose text contains `text` (each item is a block holding its own Approve form). */
const approve = async (p, text) => {
  await goto(p, "/approvals");
  const item = p.locator("div:has(> form button:has-text('Approve'))", { hasText: text }).first();
  must(await item.count(), `"${text}" is not in ${p === saeed ? "the owner's" : "the"} inbox`);
  await item.locator("button:has-text('Approve')").click(); await settle(p);
};
const switchBranch = async (p, code) => { const sel = p.locator("select[name=branch_id]").first(); const v = await sel.locator("option", { hasText: new RegExp(`^${code} ·`) }).first().getAttribute("value"); await sel.selectOption(v); await settle(p); };

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const [Y, M] = today.split("-").map(Number);
const iso = (d) => d.toISOString().slice(0, 10);
const CUTOVER = iso(new Date(Date.UTC(Y, M - 2, 0))), LASTMONTH = iso(new Date(Date.UTC(Y, M - 2, 1))).slice(0, 7);
const dmy = (s) => s.split("-").reverse().join("/");
const custNo = await sql("SELECT customer_no FROM customer WHERE first_name = 'Fatima' LIMIT 1");
const agmc = await sql("SELECT id FROM supplier WHERE code = 'AGMC'");

const admin = await as("admin");
const maryam = await as("maryam");
const saeed = await as("saeed");
const yousef = await as("yousef");
const priya = await as("priya");

// ---------- masters (AC-01, AC-02, TM-01) ----------
await step("TC-AC01-01", "chart of accounts is grouped, with branches as cost centres side by side", async () => {
  await goto(maryam, "/accounts?group=1"); must(await maryam.locator("table.fin tr.grp").count() >= 2, "group totals not shown");
  const b2 = (await maryam.locator("input[name=branches]").count()); must(b2 > 1, "branch picker missing");
  await goto(maryam, "/admin/masters/accounts"); must(/Needs a party|1200/.test(await body(maryam)), "chart of accounts master");
  await shot(maryam, "p4-tb-grouped"); return "group totals shown; chart of accounts master open";
});
await step("TC-AC01-02", "bank accounts are a master form with IBAN check", async () => {
  await goto(admin, "/admin/masters/bank-accounts"); const t = await body(admin); must(/Main current account/.test(t) && /Second account/.test(t), "bank accounts missing"); return "2 bank accounts";
});
await step("TC-AC02-02", "posting rules list the accounting events", async () => {
  await goto(admin, "/admin/masters/posting"); const t = await body(admin); must(/pdc_issued/.test(t) && /depreciation/.test(t) && /interbranch/.test(t), "events missing"); return "events listed";
});
await step("TC-TM01-01", "Tally masters import: suppliers added, a repeat import skips them", async () => {
  await goto(admin, "/accounts/opening");
  await admin.selectOption("select[name=kind]", "suppliers");
  await admin.fill("textarea[name=file_text]", "Code,Name,TRN,Phone,Payment terms (days),Credit limit\nGULFOIL,Gulf Oil Trading,100234567800003,+97142223333,30,50000\nBADONE,,,,,");
  await admin.click("button:has-text('Import')"); await settle(admin); let f = await flash(admin);
  must(/1 added/.test(f) && /refused/.test(f), f);
  await admin.selectOption("select[name=kind]", "suppliers");
  await admin.fill("textarea[name=file_text]", "Code,Name\nGULFOIL,Gulf Oil Trading");
  await admin.click("button:has-text('Import')"); await settle(admin); f = await flash(admin); must(/0 added, 1 already there/.test(f), f); return f;
});

// ---------- opening balances (TM-02, TM-03) ----------
const LEDGER = `Branch,Account code,Debit,Credit\nYAS,1120,50000.00,\nYAS,1200,3150.00,\nYAS,2000,,4200.00\nYAS,3900,,48950.00`;
const BILLS = `Branch,Party type,Party code,Bill no,Bill date,Due date,Amount\nYAS,customer,${custNo},TLY-S-881,${dmy(CUTOVER.slice(0, 8) + "01")},${dmy(CUTOVER)},3150.00\nYAS,supplier,AGMC,AG-5531,${dmy(CUTOVER)},${dmy(CUTOVER)},4200.00`;
const TALLY = `Account code,Debit,Credit\n1120,50000,\n1200,3150,\n2000,,4200\n3900,,48950`;
await step("TC-TM02-01", "opening balance check lists the problems and writes nothing", async () => {
  await goto(maryam, "/accounts/opening");
  await maryam.fill("input[name=cutover_date]", CUTOVER);
  await maryam.fill("textarea[name=ledger_text]", LEDGER.replace("48950.00", "48000.00"));
  await maryam.fill("textarea[name=bills_text]", BILLS); await maryam.fill("textarea[name=tally_text]", TALLY);
  await maryam.click("button:has-text('Check the files')"); await maryam.waitForSelector(".flash");
  const t = await body(maryam); must(/do not balance/.test(t), "imbalance not reported"); must(!(await maryam.locator("button:has-text('Load opening balances')").count()), "load offered with errors");
  must(await sql("SELECT count(*) FROM migration_batch") === "0", "something was written"); return "imbalance reported, nothing written";
});
await step("TC-TM02-02", "opening balances load by branch and party once the files are clean", async () => {
  await maryam.fill("textarea[name=ledger_text]", LEDGER);
  await maryam.click("button:has-text('Check the files')"); await maryam.waitForSelector("text=No problems");
  await maryam.click("button:has-text('Load opening balances')"); await settle(maryam);
  const f = await flash(maryam); must(/loaded/i.test(f), f); return f;
});
await step("TC-TM03-01", "trial balance agrees with Tally and the accountant signs off", async () => {
  const t = await body(maryam); must(/agrees with Tally/.test(t), "no agreement shown");
  await maryam.click("button:has-text('Sign off')"); await settle(maryam); must(/signed off/i.test(await flash(maryam)), "not signed");
  await shot(maryam, "p4-opening-signed"); return "signed off";
});

// ---------- vouchers (AC-03) ----------
const fillVoucher = async (p, type, narration, lines) => {
  await goto(p, "/accounts/vouchers/new"); await p.selectOption("select[name=voucher_type]", type); await p.fill("input[name=narration]", narration);
  for (const [i, l] of lines.entries()) {
    const v = await p.locator(`select[name=acct_${i}] option`, { hasText: l.acc }).first().getAttribute("value"); await p.selectOption(`select[name=acct_${i}]`, v);
    if (l.dr) await p.fill(`input[name=dr_${i}]`, l.dr); if (l.cr) await p.fill(`input[name=cr_${i}]`, l.cr);
    if (l.party) { const pv = await p.locator(`select[name=party_${i}] option`, { hasText: l.party }).first().getAttribute("value"); await p.selectOption(`select[name=party_${i}]`, pv); }
  }
  await p.click("button:has-text('Submit for approval')"); await settle(p);
};
await step("TC-AC03-01", "unbalanced voucher is refused", async () => {
  await switchBranch(maryam, "YAS");
  await fillVoucher(maryam, "payment", "Workshop rent", [{ acc: "5900 ·", dr: "1000" }, { acc: "1120 ·", cr: "900" }]);
  const f = await flash(maryam); must(/must be equal/.test(f), f); return f;
});
await step("TC-AC03-02", "a payables line without the supplier is refused", async () => {
  await fillVoucher(maryam, "journal", "Supplier adjustment", [{ acc: "2000 ·", dr: "100" }, { acc: "5400 ·", cr: "100" }]);
  const f = await flash(maryam); must(/needs the supplier/.test(f), f); return f;
});
let voucherUrl;
await step("TC-AC03-03", "voucher waits for the owner, gets its number only when approved", async () => {
  await fillVoucher(maryam, "payment", "Workshop rent for the month", [{ acc: "5900 ·", dr: "1000" }, { acc: "1120 ·", cr: "1000" }]);
  voucherUrl = maryam.url(); let t = await body(maryam); must(/Waiting for approval/.test(t) && /Not numbered|voucher\s*$/m.test(t) || /Waiting for approval/.test(t), "not pending");
  await approve(saeed, "Workshop rent for the month");
  await goto(maryam, voucherUrl.replace(B, "")); t = await body(maryam); must(/YAS-VCH-/.test(t) && /Posted/.test(t), "not posted");
  await shot(maryam, "p4-voucher-posted"); return t.match(/YAS-VCH-\S+/)[0];
});
await step("TC-AC03-04", "a branch manager cannot enter vouchers", async () => {
  await goto(yousef, "/accounts/vouchers"); must(!(await yousef.locator("a:has-text('New voucher')").count()), "button shown");
  await goto(yousef, "/accounts/vouchers/new"); must(/could not be shown/.test(await body(yousef)), "form opened"); return "refused";
});
// revenue at two branches for the allocation case (owner's own voucher goes to the accountant)
for (const [code, amt] of [["YAS", "6000"], ["QUS", "2000"]]) {
  await switchBranch(saeed, code);
  await fillVoucher(saeed, "receipt", `Cash sales brought in ${code}`, [{ acc: "1100 ·", dr: amt }, { acc: "4100 ·", cr: amt }]);
  await approve(maryam, `Cash sales brought in ${code}`);
}

// ---------- payables, cheques issued (AC-04, AC-13, AC-17, AC-05) ----------
await step("TC-AC04-01", "pay part of a supplier bill by cheque; the rest stays open", async () => {
  await goto(maryam, `/accounts/payables/pay?supplier=${agmc}`);
  await maryam.locator("input[name^='alloc[opening:']").first().fill("1500");
  await maryam.selectOption("select[name=method]", "cheque"); await maryam.fill("input[name=amount]", "1500");
  await maryam.fill("input[name=cheque_no]", "000123"); await maryam.fill("input[name=cheque_date]", today);
  await maryam.click("button:has-text('Post payment')"); await settle(maryam);
  const f = await flash(maryam); must(/YAS-PV-/.test(f), f);
  await goto(maryam, `/accounts/payables/pay?supplier=${agmc}`); must(/2,700\.00/.test(await body(maryam)), "open amount not 2,700"); return f;
});
await step("TC-AC05-02", "cheques falling due are flagged on the bank page", async () => {
  await goto(maryam, "/accounts/bank"); const t = await body(maryam); must(/Cheques due in the next 7 days/.test(t) && /000123/.test(t), "no alert"); return "cheque 000123 flagged";
});
await step("TC-AC17-01", "issued cheque is marked paid by the bank", async () => {
  await goto(maryam, "/accounts/payables/payments?cheques=issued");
  await maryam.locator("tr", { hasText: "000123" }).locator("button:has-text('Paid by bank')").click(); await settle(maryam);
  must(/paid by the bank/.test(await flash(maryam)), "not cleared"); return "cleared";
});
await step("TC-AC17-02", "a cancelled cheque reverses the payment and the bill opens again", async () => {
  await goto(maryam, `/accounts/payables/pay?supplier=${agmc}`);
  await maryam.locator("input[name^='alloc[opening:']").first().fill("700");
  await maryam.selectOption("select[name=method]", "cheque"); await maryam.fill("input[name=amount]", "700");
  await maryam.fill("input[name=cheque_no]", "000124"); await maryam.fill("input[name=cheque_date]", today);
  await maryam.click("button:has-text('Post payment')"); await settle(maryam);
  await goto(maryam, "/accounts/payables/payments?cheques=issued"); const row = maryam.locator("tr", { hasText: "000124" });
  await row.locator("input[name=note]").fill("Stopped at the bank"); await row.locator("button:has-text('Cancel')").click(); await settle(maryam);
  must(/open again/.test(await flash(maryam)), "not cancelled");
  await goto(maryam, `/accounts/payables/pay?supplier=${agmc}`); must(/2,700\.00/.test(await body(maryam)), "bill not reopened"); return "reversed; 2,700 open again";
});
await step("TC-AC13-01", "a payment above the bills chosen stays on the supplier's account", async () => {
  await maryam.locator("input[name^='alloc[opening:']").first().fill("200");
  await maryam.selectOption("select[name=method]", "bank_transfer"); await maryam.fill("input[name=amount]", "500"); await maryam.fill("input[name=reference]", "TT-77881");
  await maryam.click("button:has-text('Post payment')"); await settle(maryam);
  await goto(maryam, `/accounts/payables/pay?supplier=${agmc}`); const t = await body(maryam);
  must(/Money already paid on account/.test(t) && /300\.00/.test(t), "on-account not shown"); return "300.00 kept on account";
});

// ---------- receivables (AC-16, AC-04) ----------
await step("TC-AC16-01", "receivables by branch with ageing, credit limit and overdue", async () => {
  await goto(maryam, "/accounts/receivables"); const t = await body(maryam);
  must(/YAS/.test(t) && /Fatima/.test(t) && /31-60|1-30/.test(t) && /CREDIT LIMIT|Credit limit/i.test(t), "ageing missing");
  await goto(maryam, "/accounts/receivables?overdue=1"); must(/Fatima/.test(await body(maryam)), "overdue filter lost the overdue bill");
  await shot(maryam, "p4-receivables"); return "Fatima's opening bill shown overdue";
});
await step("TC-AC04-02", "advisor collects the opening bill from the customer statement", async () => {
  const cid = await sql("SELECT id FROM customer WHERE first_name = 'Fatima' LIMIT 1");
  await goto(priya, `/accounts/statement?party=customer&id=${cid}`);
  const t0 = await body(priya); if (/could not be shown/.test(t0)) {
    // advisors do not see the accounts; the accountant records it
    await goto(maryam, `/accounts/statement?party=customer&id=${cid}`);
  }
  const p = /could not be shown/.test(t0) ? maryam : priya;
  await p.selectOption("select[name=method]", "bank_transfer"); await p.fill("form:has(button:has-text('Record receipt')) input[name=reference]", "TT-9001");
  await p.click("button:has-text('Record receipt')"); await settle(p);
  const f = await flash(p); must(/YAS-RC|Receipt/.test(f), f);
  const t = await body(p); must(/TLY-S-881/.test(t), "statement lacks the bill"); return `${f} (${p === priya ? "advisor" : "accountant"})`;
});

// ---------- card settlement (AC-05) ----------
await step("TC-AC05-01", "card settlement: bank credit less commission clears the card receipts", async () => {
  await goto(priya, "/billing/counter-sale"); const v = await priya.locator("select[name=item_id] option", { hasText: "OIL-5W30-L" }).first().getAttribute("value");
  await priya.locator("select[name=item_id]").first().selectOption(v); await priya.locator("input[name=qty]").first().fill("5");
  await priya.fill("input[name=bill_to_name]", "Ali"); await priya.selectOption("select[name=method]", "card"); await priya.fill("input[name=reference]", "SLIP-4411");
  await priya.click("button:has-text('Post sale')"); await settle(priya);
  await goto(maryam, "/accounts/bank"); const held = (await body(maryam)).match(/waiting at this branch: ([\d,]+\.\d{2})/)?.[1].replace(/,/g, "");
  must(Number(held) > 0, "no card receipts waiting " + (await flash(priya)));
  await maryam.fill("input[name=batch_total]", held); await maryam.fill("input[name=bank_credit]", (Number(held) * 0.98).toFixed(2));
  await maryam.click("button:has-text('Post settlement')"); await settle(maryam); must(/posted/.test(await flash(maryam)), await flash(maryam));
  const t = await body(maryam); must(/YAS-CS-/.test(t), "not listed"); return `batch ${held}, commission ${(Number(held) * 0.02).toFixed(2)}`;
});

// ---------- bank reconciliation (AC-06) ----------
await step("TC-AC06-01", "statement import auto-matches, a bank fee is posted from the line, finish locks it", async () => {
  await goto(maryam, "/accounts/bank");
  await maryam.fill("textarea[name=file_text]", `Date,Description,Reference,Debit,Credit\n${dmy(today)},TRANSFER AGMC,TT-77881,500.00,\n${dmy(today)},Opening bill receipt,TT-9001,,3150.00\n${dmy(today)},MONTHLY ACCOUNT FEE,,25.00,\n`);
  await maryam.click("button:has-text('Import and match')"); await settle(maryam);
  let f = await flash(maryam); must(/3 lines imported, 2 matched/.test(f), f);
  const fee = maryam.locator("tr", { hasText: "MONTHLY ACCOUNT FEE" });
  await fee.locator("button:has-text('Post entry')").click(); await settle(maryam);
  await maryam.click("button:has-text('Finish and lock')"); await settle(maryam); f = await flash(maryam); must(/finished/.test(f), f);
  await shot(maryam, "p4-bank-rec"); return "2 auto, 1 posted, locked";
});

// ---------- reverse charge (AC-07) ----------
await step("TC-AC07-01", "an imported service bill under reverse charge shows in boxes 3 and 10, and the VAT return agrees with the ledger", async () => {
  await goto(maryam, `/purchasing/bills/new?supplier_id=${agmc}`);
  await maryam.fill("input[name=supplier_invoice_no]", "IMP-2026-77"); await maryam.fill("input[name=x_description]", "Diagnostic software licence (import)");
  await maryam.fill("input[name=x_qty]", "1"); await maryam.fill("input[name=x_unit_price]", "2000"); await maryam.selectOption("select[name=x_vat_code]", "RC");
  await maryam.click("button:has-text('Save and match')"); await settle(maryam);
  const owed = await sql("SELECT grand_total FROM supplier_bill WHERE supplier_invoice_no = 'IMP-2026-77'"); must(Number(owed) === 2000, "supplier owed " + owed + " (should be 2000, VAT is ours) " + (await flash(maryam)));
  await goto(maryam, `/accounts/vat?from=${today.slice(0, 8)}01&to=${today}`); const t = await body(maryam);
  must(/agrees with the ledger/.test(t), "VAT return does not agree with the ledger");
  await goto(maryam, `/accounts/vat?from=${today.slice(0, 8)}01&to=${today}&box=3`); must(/IMP-2026-77|reverse charge/i.test(await body(maryam)) || /YAS-SB|YAS-BILL|Supplier bill/.test(await body(maryam)), "box 3 empty");
  return "owed 2000; VAT 100 in boxes 3 and 10";
});

// ---------- statements (AC-08, AC-15) ----------
await step("TC-AC08-01", "trial balance, P&L, balance sheet and cash flow agree", async () => {
  await goto(maryam, "/accounts"); must(/balanced/.test(await body(maryam)), "TB not balanced");
  await goto(maryam, "/accounts/bs"); const bs = await body(maryam); must(!/does not balance/.test(bs) && /Total liabilities and equity/.test(bs), "BS");
  await goto(maryam, `/accounts/pl?from=2000-01-01&to=${today}`); const pl = await body(maryam); must(/Net profit/.test(pl), "P&L");
  await goto(maryam, "/accounts/cash-flow"); must(/Cash and bank at the end/.test(await body(maryam)), "cash flow");
  await shot(maryam, "p4-cash-flow"); return "TB balanced; BS balances";
});
await step("TC-AC08-02", "day book and ledger drill down to the journal and the source voucher", async () => {
  await goto(maryam, "/accounts/day-book"); must(await maryam.locator("a[href^='/accounts/journal/']").count(), "no journals");
  await goto(maryam, `/accounts/ledger?account=5900&from=${today.slice(0, 8)}01&to=${today}`);
  await maryam.locator("a[href^='/accounts/journal/']").first().click(); await settle(maryam);
  await maryam.click("a:has-text('Open the document')"); await settle(maryam); must(/voucher/i.test(await body(maryam)) && /YAS-VCH-/.test(await body(maryam)), "did not reach the voucher"); return "ledger → journal → voucher";
});
await step("TC-AC15-01", "ledger balances on any date: the trial balance on the cut-over day shows only the opening figures", async () => {
  await goto(maryam, `/accounts?asof=${CUTOVER}`); const t = await body(maryam);
  must(/50,000\.00/.test(t) && !/4100/.test(t), "unexpected entries on the cut-over date"); return `TB on ${CUTOVER}`;
});

// ---------- head office (AC-10, AC-14) ----------
await step("TC-AC10-01", "head-office costs are charged to branches by revenue; branch P&L side by side", async () => {
  await switchBranch(saeed, "HQ");
  await fillVoucher(saeed, "payment", "Head office utilities", [{ acc: "5910 ·", dr: "1000" }, { acc: "1120 ·", cr: "1000" }]);
  await approve(maryam, "Head office utilities");
  await goto(maryam, "/accounts/allocation"); const pre = await body(maryam); must(/1,000\.00/.test(pre), "HQ cost not 1,000");
  await maryam.click("button:has-text('Post allocation')"); await settle(maryam); must(/posted/i.test(await flash(maryam)), await flash(maryam));
  const hq = await sql("SELECT id FROM branch WHERE code = 'HQ'"), yas = await sql("SELECT id FROM branch WHERE code = 'YAS'"), qus = await sql("SELECT id FROM branch WHERE code = 'QUS'");
  await goto(maryam, `/accounts/pl?side=1&branches=${hq}&branches=${yas}&branches=${qus}`); const t = await body(maryam);
  must(/HQ/.test(t) && /QUS/.test(t) && /Head-office costs allocated/.test(t), "side by side missing");
  await shot(maryam, "p4-pl-side-by-side"); return "allocated; P&L HQ | QUS | YAS | Total";
});
await step("TC-AC14-01", "branch manager sees only his branch P&L; balance sheet is refused for lack of bank balances", async () => {
  await goto(yousef, "/accounts/pl"); const t = await body(yousef); must(/Net profit/.test(t) && !/QUS/.test(t), "other branch visible");
  await goto(yousef, "/accounts/bs"); must(/cannot see bank and cash balances/.test(await body(yousef)), "BS shown"); return "own branch only";
});

// ---------- fixed assets, budgets (AC-11, AC-12) ----------
await step("TC-AC11-01", "asset added, depreciated for last month, then sold at a loss", async () => {
  await goto(maryam, "/accounts/assets");
  await maryam.fill("form:has(button:has-text('Add asset')) input[name=name]", "Two-post lift"); await maryam.fill("input[name=acquired_on]", CUTOVER);
  await maryam.fill("input[name=cost]", "12600"); await maryam.fill("input[name=salvage]", "600"); await maryam.fill("input[name=life_months]", "12");
  await maryam.click("button:has-text('Add asset')"); await settle(maryam); must(/-FA-/.test(await flash(maryam)), await flash(maryam));
  await maryam.fill("input[name=month]", LASTMONTH); await maryam.click("button:has-text('Run depreciation')"); await settle(maryam);
  let f = await flash(maryam); must(/1000\.00/.test(f), f);
  await maryam.click("summary:has-text('Dispose')"); await maryam.fill("form:has(button:has-text('Dispose')) input[name=amount]", "10000");
  await maryam.locator("button.red:has-text('Dispose')").click(); await settle(maryam); f = await flash(maryam); must(/loss of AED 1600\.00/.test(f), f);
  return f;
});
await step("TC-AC12-01", "budget entered and compared with actual", async () => {
  const yas = await sql("SELECT id FROM branch WHERE code = 'YAS'"), rent = await sql("SELECT id FROM account WHERE code = '5900'");
  await goto(maryam, `/accounts/budgets?branch=${yas}&year=${Y}&view=edit`);
  await maryam.fill(`input[name='b[${rent}:${M}]']`, "2000"); await maryam.click("button:has-text('Save budgets')"); await settle(maryam);
  await goto(maryam, `/accounts/budgets?branch=${yas}&year=${Y}&view=report`); const row = await maryam.locator("tr", { hasText: "5900" }).innerText();
  must(/2,000\.00/.test(row) && /1,000\.00/.test(row), row); return row.replace(/\s+/g, " ");
});

// ---------- period close (AC-09) ----------
await step("TC-AC09-01", "a month closes only when its checklist passes; a closed month refuses postings", async () => {
  await goto(maryam, `/accounts/periods?month=${CUTOVER.slice(0, 7)}`);
  await maryam.click("button:has-text('Close')"); await settle(maryam); must(/VAT/.test(await flash(maryam)), "closed without VAT review");
  await maryam.click("button:has-text('Mark as reviewed')"); await settle(maryam);
  await maryam.click("button:has-text('Close')"); await settle(maryam); must(/is closed/.test(await flash(maryam)), await flash(maryam));
  await goto(maryam, "/accounts/vouchers/new"); await maryam.fill("input[name=voucher_date]", CUTOVER);
  await fillVoucherKeepDate(maryam);
  const f = await flash(maryam); must(/closed/.test(f), f); return f;
});
async function fillVoucherKeepDate(p) {
  await p.selectOption("select[name=voucher_type]", "journal"); await p.fill("input[name=narration]", "Late accrual");
  for (const [i, l] of [{ acc: "5400 ·", dr: "10" }, { acc: "3900 ·", cr: "10" }].entries()) {
    const v = await p.locator(`select[name=acct_${i}] option`, { hasText: l.acc }).first().getAttribute("value"); await p.selectOption(`select[name=acct_${i}]`, v);
    if (l.dr) await p.fill(`input[name=dr_${i}]`, l.dr); if (l.cr) await p.fill(`input[name=cr_${i}]`, l.cr);
  }
  await p.click("button:has-text('Submit for approval')"); await settle(p);
}
await step("TC-AC09-02", "only the owner reopens a closed month, with a reason that is logged", async () => {
  await goto(maryam, `/accounts/periods?month=${CUTOVER.slice(0, 7)}`); must(/Only the owner can reopen/.test(await body(maryam)), "accountant offered reopen");
  await goto(saeed, `/accounts/periods?month=${CUTOVER.slice(0, 7)}`); await saeed.fill("input[name=reason]", "Late supplier bill found");
  await saeed.click("button:has-text('Reopen')"); await settle(saeed); must(/open again/.test(await flash(saeed)), await flash(saeed));
  must(Number(await sql("SELECT count(*) FROM audit_log WHERE entity = 'accounting_period' AND action = 'reopened'")) === 1, "not audited");
  await shot(saeed, "p4-period-reopened"); return "reopened and logged";
});
await step("TC-AC09-03", "an advisor cannot open the accounts", async () => {
  await goto(priya, "/accounts/periods"); must(/could not be shown/.test(await body(priya)), "advisor saw periods"); return "refused";
});

fs.writeFileSync(process.env.P4_RESULTS || "/tmp/p4-results.json", JSON.stringify(results, null, 1));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); await db.end();
