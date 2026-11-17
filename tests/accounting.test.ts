import "./env";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery, id, branchId, appQueryAs } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { inbox, act } from "../lib/services/workflow";
import { today } from "../lib/services/stock";
import * as ac from "../lib/services/accounting";
import * as cl from "../lib/services/accounting-close";
import * as fin from "../lib/services/financials";
import "../lib/services/workflow-handlers";

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code && (!msg || msg.test(e.message)));
const key = () => crypto.randomUUID();
const one = async (sql: string, p: unknown[] = []) => (await adminQuery(sql, p))[0];
const balancedPerBranch = async () => assert.equal((await adminQuery("SELECT journal_id FROM journal_line GROUP BY journal_id, branch_id HAVING sum(debit) <> sum(credit)")).length, 0);
let acc: Record<string, string>, YAS: string, QUS: string, HQ: string, cust: string, agmc: string, bank: string;

// Dates relative to "today" so the suite keeps working: the cut-over is the last day of two months ago.
const T = today();
const firstOf = (offset: number) => { const d = new Date(Date.UTC(Number(T.slice(0, 4)), Number(T.slice(5, 7)) - 1 + offset, 1)); return d.toISOString().slice(0, 10); };
const lastOf = (offset: number) => { const d = new Date(Date.UTC(Number(T.slice(0, 4)), Number(T.slice(5, 7)) + offset, 0)); return d.toISOString().slice(0, 10); };
const CUTOVER = lastOf(-2), PREV = firstOf(-1), THIS = firstOf(0);

before(async () => {
  await resetTestDb(true);
  acc = Object.fromEntries((await adminQuery("SELECT code, id FROM account")).map((r) => [r.code, r.id]));
  [YAS, QUS, HQ] = [await branchId("YAS"), await branchId("QUS"), await branchId("HQ")];
  cust = await id("customer", "first_name = $1", ["Fatima"]);
  agmc = await id("supplier", "code = $1", ["AGMC"]);
  bank = await id("bank_account", "name = $1", ["Main current account"]);
});
after(async () => { await closePool(); });

/** Creates a voucher and, when it waits for the owner, approves it as the owner. */
async function voucherPosted(ctx: Awaited<ReturnType<typeof ctxFor>>, f: Parameters<typeof ac.createVoucher>[1]) {
  const v = await ac.createVoucher(ctx, f);
  if (v.status === "pending_approval") { 
    const code = (await one("SELECT code FROM branch WHERE id = $1", [ctx.currentBranchId])).code;
    for (const u of ["saeed", "maryam"]) { const who = await ctxFor(u, code); const t = (await inbox(who)).find((x) => x.doc_id === v.id); if (t) { await act(who, t.task_id, "approved"); break; } }
  }
  assert.equal((await one("SELECT status FROM voucher WHERE id = $1", [v.id])).status, "posted");
  return v.id;
}
const custNo = async () => (await one("SELECT customer_no FROM customer WHERE id = $1", [cust])).customer_no;
const ledgerCsv = (extra = "") => `Branch,Account code,Debit,Credit
YAS,1120,50000.00,
YAS,1200,3150.00,
YAS,1300,20000.00,
YAS,2000,,4200.00
YAS,3900,,68950.00
${extra}`;
const billsCsv = async () => `Branch,Party type,Party code,Bill no,Bill date,Due date,Amount
YAS,customer,${await custNo()},TLY-S-881,01/${CUTOVER.slice(5, 7)}/${CUTOVER.slice(0, 4)},${CUTOVER.slice(8)}/${CUTOVER.slice(5, 7)}/${CUTOVER.slice(0, 4)},3150.00
YAS,supplier,AGMC,AG-5531,${CUTOVER},${CUTOVER},4200.00`;
const tallyCsv = `Account code,Debit,Credit
1120,50000,
1200,3150,
1300,20000,
2000,,4200
3900,,68950`;

test("opening balances: the check lists every problem, the load posts by branch and party, and sign-off compares with Tally (TM-02, TM-03)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const bad = await cl.checkOpening(maryam, { cutover_date: CUTOVER, ledger_csv: ledgerCsv("YAS,9999,10,\nZZZ,1120,5,"), bills_csv: await billsCsv(), tally_csv: tallyCsv });
  assert.ok(bad.errors.some((e) => /9999/.test(e)) && bad.errors.some((e) => /ZZZ/.test(e)), bad.errors.join(" "));
  const unbalanced = await cl.checkOpening(maryam, { cutover_date: CUTOVER, ledger_csv: ledgerCsv().replace("68950.00", "68000.00"), bills_csv: await billsCsv() });
  assert.ok(unbalanced.errors.some((e) => /do not balance/.test(e)));
  const wrongControl = await cl.checkOpening(maryam, { cutover_date: CUTOVER, ledger_csv: ledgerCsv().replace("3150.00", "3000.00").replace("68950.00", "68800.00"), bills_csv: await billsCsv() });
  assert.ok(wrongControl.errors.some((e) => /trade receivables/.test(e)));
  const ok = await cl.checkOpening(maryam, { cutover_date: CUTOVER, ledger_csv: ledgerCsv(), bills_csv: await billsCsv(), tally_csv: tallyCsv.replace("20000", "19000") });
  assert.deepEqual(ok.errors, []); assert.equal(ok.tbMatches, false);
  await rejects(cl.loadOpening(await ctxFor("priya", "YAS"), { cutover_date: CUTOVER, ledger_csv: ledgerCsv(), bills_csv: await billsCsv(), tally_csv: tallyCsv }), "forbidden");
  const batch = await cl.loadOpening(maryam, { cutover_date: CUTOVER, ledger_csv: ledgerCsv(), bills_csv: await billsCsv(), tally_csv: tallyCsv });
  await rejects(cl.loadOpening(maryam, { cutover_date: CUTOVER, ledger_csv: ledgerCsv(), bills_csv: await billsCsv(), tally_csv: tallyCsv }), "conflict");
  const cmp = await cl.openingComparison(maryam, batch);
  assert.equal(cmp.matches, true);
  // the receivable is posted against the customer and the payable against the supplier
  assert.equal(Number((await one("SELECT sum(debit) v FROM journal_line WHERE customer_id = $1 AND account_id = $2", [cust, acc["1200"]])).v), 3150);
  assert.equal(Number((await one("SELECT sum(credit) v FROM journal_line WHERE supplier_id = $1 AND account_id = $2", [agmc, acc["2000"]])).v), 4200);
  await cl.signOffOpening(maryam, batch, "");
  assert.equal((await one("SELECT status FROM migration_batch WHERE id = $1", [batch])).status, "signed_off");
  await balancedPerBranch();
});

test("manual vouchers: balanced, party required on party ledgers, approved by the owner before they post (AC-03)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const rent = { voucher_type: "payment", voucher_date: T, narration: "Workshop rent for the month", lines: [{ account_id: acc["5900"], debit: "1000" }, { account_id: acc["1120"], credit: "1000" }] };
  await rejects(ac.createVoucher(maryam, { ...rent, lines: [{ account_id: acc["5900"], debit: "1000" }, { account_id: acc["1120"], credit: "900" }] }), "validation", /equal/);
  await rejects(ac.createVoucher(maryam, { ...rent, lines: [{ account_id: acc["2000"], debit: "1000" }, { account_id: acc["1120"], credit: "1000" }] }), "validation", /needs the supplier/);
  await rejects(ac.createVoucher(maryam, { ...rent, voucher_type: "receipt" }), "validation", /cash or bank/);
  await rejects(ac.createVoucher(await ctxFor("priya", "YAS"), rent), "forbidden");
  const v = await ac.createVoucher(maryam, rent);
  assert.equal(v.status, "pending_approval");
  assert.equal((await one("SELECT doc_no FROM voucher WHERE id = $1", [v.id])).doc_no, null);
  const saeed = await ctxFor("saeed", "YAS");
  const task = (await inbox(saeed)).find((t) => t.doc_id === v.id)!;
  await act(saeed, task.task_id, "approved");
  const row = await one("SELECT status, doc_no, journal_id FROM voucher WHERE id = $1", [v.id]);
  assert.equal(row.status, "posted"); assert.match(row.doc_no, /^YAS-VCH-/); assert.ok(row.journal_id);
  // revenue at two branches for the allocation test below
  for (const [b, amt] of [["YAS", "6000"], ["QUS", "2000"]] as const) {
    await voucherPosted(await ctxFor("maryam", b), { voucher_type: "receipt", voucher_date: T, narration: "Cash sales brought in", lines: [{ account_id: acc["1100"], debit: amt }, { account_id: acc["4100"], credit: amt }] });
  }
});

test("supplier payment by cheque: bill-by-bill, held as cheques issued until cleared; a cancelled cheque re-opens the bill (AC-04, AC-13, AC-17)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const open = await ac.supplierOpenItems(maryam, agmc);
  const item = open.items.find((i) => i.kind === "opening")!;
  assert.equal(Number(item.open), 4200);
  await rejects(ac.paySupplier(maryam, { supplier_id: agmc, method: "cheque", bank_account_id: bank, amount: "1000", cheque_no: "000123", cheque_date: T, allocations: [{ kind: "opening", id: item.id, amount: "1500" }], idempotency_key: key() }), "validation", /more than the payment/);
  const k = key();
  const p = await ac.paySupplier(maryam, { supplier_id: agmc, method: "cheque", bank_account_id: bank, amount: "1500", cheque_no: "000123", cheque_date: T, allocations: [{ kind: "opening", id: item.id, amount: "1500" }], idempotency_key: k });
  const again = await ac.paySupplier(maryam, { supplier_id: agmc, method: "cheque", bank_account_id: bank, amount: "1500", cheque_no: "000123", cheque_date: T, allocations: [{ kind: "opening", id: item.id, amount: "1500" }], idempotency_key: k });
  assert.equal(again.duplicate, true);
  assert.equal(Number((await one("SELECT settled_amount FROM opening_item WHERE id = $1", [item.id])).settled_amount), 1500);
  assert.equal(Number((await one("SELECT coalesce(sum(credit - debit),0) v FROM journal_line WHERE account_id = $1", [acc["2050"]])).v), 1500);
  await ac.clearIssuedCheque(maryam, p.id);
  assert.equal(Number((await one("SELECT coalesce(sum(credit - debit),0) v FROM journal_line WHERE account_id = $1", [acc["2050"]])).v), 0);
  await rejects(ac.cancelIssuedCheque(maryam, p.id, "lost"), "validation", /still out/);
  const p2 = await ac.paySupplier(maryam, { supplier_id: agmc, method: "cheque", bank_account_id: bank, amount: "700", cheque_no: "000124", cheque_date: T, allocations: [{ kind: "opening", id: item.id, amount: "700" }], idempotency_key: key() });
  await ac.cancelIssuedCheque(maryam, p2.id, "Stopped at the bank");
  assert.equal(Number((await one("SELECT settled_amount FROM opening_item WHERE id = $1", [item.id])).settled_amount), 1500);
  await balancedPerBranch();
});

test("a payment made at one branch for another branch's bill posts through inter-branch clearing, each branch balanced (FSD M12 rule 2)", async () => {
  const maryamQ = await ctxFor("maryam", "QUS");
  const item = (await ac.supplierOpenItems(maryamQ, agmc)).items.find((i) => i.kind === "opening")!;
  const p = await ac.paySupplier(maryamQ, { supplier_id: agmc, method: "bank_transfer", bank_account_id: bank, amount: "500", reference: "TT-77881", allocations: [{ kind: "opening", id: item.id, amount: "500" }], idempotency_key: key() });
  const lines = await adminQuery("SELECT b.code, a.code acc, debit, credit FROM journal_line l JOIN branch b ON b.id = l.branch_id JOIN account a ON a.id = l.account_id WHERE journal_id = (SELECT journal_id FROM supplier_payment WHERE id = $1)", [p.id]);
  assert.ok(lines.some((l) => l.code === "YAS" && l.acc === "2000" && Number(l.debit) === 500));
  assert.ok(lines.some((l) => l.code === "QUS" && l.acc === "2900" && Number(l.debit) === 500));
  assert.ok(lines.some((l) => l.code === "YAS" && l.acc === "2900" && Number(l.credit) === 500));
  await balancedPerBranch();
});

test("customer opening bill is collected with a receipt and leaves the ageing (AC-16)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const before = await fin.receivablesAgeing(maryam, {});
  const yas = before.branches.find((b) => b.code === "YAS")!;
  assert.ok(yas.parties.some((p) => p.customer_id === cust && Number(p.total) >= 3150));
  const item = await one("SELECT id FROM opening_item WHERE customer_id = $1", [cust]);
  await ac.receiveOnOpeningItem(await ctxFor("priya", "YAS"), item.id, { method: "bank_transfer", amount: "3150", reference: "TT-9001", idempotency_key: key() } as never);
  const after = await fin.receivablesAgeing(maryam, {});
  const p = after.branches.find((b) => b.code === "YAS")?.parties.find((x) => x.customer_id === cust);
  assert.ok(!p || Number(p.total) < Number(yas.parties.find((x) => x.customer_id === cust)!.total));
  const st = await fin.partyStatement(maryam, { party: "customer", id: cust, from: CUTOVER, to: T });
  assert.ok(st.rows.some((r) => /TLY-S-881/.test(r.narration ?? "")));
});

test("bank reconciliation: statement import auto-matches by amount, date and reference; bank charges are posted from the line; finish needs every line matched (AC-06)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const d = T.split("-").reverse().join("/");
  const csv = `Date,Description,Reference,Debit,Credit\n${d},TRANSFER AGMC,TT-77881,500.00,\n${d},Opening bill receipt,TT-9001,,3150.00\n${d},MONTHLY ACCOUNT FEE,,25.00,\n`;
  const r = await ac.importStatement(maryam, { bank_account_id: bank, file_name: "enbd.csv", text: csv });
  assert.equal(r.lines, 3); assert.equal(r.matched, 2);
  await rejects(ac.importStatement(maryam, { bank_account_id: bank, file_name: "enbd.csv", text: csv }), "validation", /imported before/);
  await rejects(ac.finishStatement(maryam, r.id), "validation", /not matched/);
  const st = await ac.getStatement(maryam, r.id);
  const fee = st.lines.find((l) => /FEE/.test(l.description))!;
  await ac.postFromStatementLine(maryam, fee.id, acc["5810"], "Bank fee");
  await ac.finishStatement(maryam, r.id);
  await rejects(ac.unmatchLine(maryam, fee.id), "validation", /finished/);
  assert.equal(Number((await one("SELECT sum(debit) v FROM journal_line WHERE account_id = $1", [acc["5810"]])).v), 25);
});

test("fixed asset: bought from the bank, depreciated straight-line once a month, sold at a loss (AC-11)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  await rejects(cl.addAsset(maryam, { branch_id: YAS, name: "Lift", category: "tools", acquired_on: T, cost: "1000", salvage: "1000", life_months: "12", paid_from: bank }), "validation", /less than the cost/);
  const a = await cl.addAsset(maryam, { branch_id: YAS, name: "Two-post lift", category: "tools", acquired_on: CUTOVER, cost: "12600", salvage: "600", life_months: "12", paid_from: bank });
  assert.match(a.no, /-FA-/);
  await rejects(cl.runDepreciation(maryam, firstOf(1)), "validation", /future/);
  assert.equal(await cl.runDepreciation(maryam, PREV), "1000.00");
  await rejects(cl.runDepreciation(maryam, PREV), "conflict");
  await rejects(cl.runDepreciation(maryam, cl.monthStart(CUTOVER)), "validation", /in order/);
  await rejects(cl.disposeAsset(await ctxFor("yousef", "YAS"), a.id, { date: T, amount: "0" }), "forbidden");
  const gain = await cl.disposeAsset(maryam, a.id, { date: T, amount: "10000", bank_account_id: bank });
  assert.equal(gain, "-1600.00"); // book 11600, sold for 10000
  assert.equal(Number((await one("SELECT coalesce(sum(debit - credit),0) v FROM journal_line WHERE account_id = $1", [acc["1500"]])).v), 0);
  await balancedPerBranch();
});

test("head-office allocation by revenue: HQ costs are charged to branches through inter-branch clearing, last branch takes the rounding (AC-10)", async () => {
  const saeedHq = await ctxFor("saeed", "HQ");
  await voucherPosted(saeedHq, { voucher_type: "payment", voucher_date: T, narration: "Head office utilities", lines: [{ account_id: acc["5910"], debit: "1000" }, { account_id: acc["1120"], credit: "1000" }] });
  const maryam = await ctxFor("maryam", "HQ");
  const pv = await cl.hoPreview(maryam, THIS);
  assert.equal(pv.problem, null); assert.equal(pv.cost, "1000.00");
  const sum = pv.shares.reduce((s, x) => s + Number(x.amount), 0);
  assert.equal(sum.toFixed(2), "1000.00");
  assert.ok(Number(pv.shares.find((s) => s.code === "YAS")!.amount) > Number(pv.shares.find((s) => s.code === "QUS")!.amount));
  await cl.hoPost(maryam, THIS);
  await rejects(cl.hoPost(maryam, THIS), "conflict");
  const pl = await fin.profitAndLoss(maryam, { from: THIS, to: lastOf(0), branches: HQ });
  assert.equal(pl.net.total, "0.00"); // HQ is left with nothing after charging its costs out
  await balancedPerBranch();
});

test("statements agree: trial balance balances, the balance sheet balances, the P&L profit is the balance-sheet profit, and cash flow explains the change in cash (AC-08)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const tb = await fin.trialBalanceAsOf(maryam, {});
  assert.ok(tb.balanced, `TB ${tb.debit} / ${tb.credit}`);
  const side = await fin.trialBalanceAsOf(maryam, { branches: `${YAS},${QUS}`, side: "1" });
  assert.deepEqual(side.cols.map((c) => c.label), ["QUS", "YAS", "Total"]);
  const bs = await fin.balanceSheet(maryam, {});
  assert.ok(bs.balanced, JSON.stringify({ a: bs.totalAssets, le: bs.totalLE }));
  const pl = await fin.profitAndLoss(maryam, { from: "2000-01-01", to: T });
  assert.equal(pl.net.total, bs.profit.total);
  const cf = await fin.cashFlow(maryam, { from: THIS, to: T });
  assert.equal(cf.rounding, "0.00");
  const led = await fin.ledgerReport(maryam, { account: "1120", from: CUTOVER, to: T, branches: YAS });
  assert.equal(led.opening, "0.00"); assert.equal(led.rows[0].balance, "50000.00");
  const j = await fin.getJournal(maryam, led.rows[0].journal_id);
  assert.equal(j.journal.source_type, "opening");
});

test("branch access: a branch manager reports on their own branch only; an advisor cannot open the accounts (RBAC)", async () => {
  const yousef = await ctxFor("yousef", "YAS");
  const s = await fin.finScope(yousef, undefined);
  assert.deepEqual(s.branches.map((b) => b.code), ["YAS"]);
  await rejects(fin.trialBalanceAsOf(yousef, { branches: QUS }), "forbidden");
  await rejects(fin.balanceSheet(yousef, {}), "forbidden", /bank/); // bank balances are hidden from branch managers
  const pl = await fin.profitAndLoss(yousef, { from: THIS, to: T });
  assert.ok(pl.cols.length === 1);
  await rejects(fin.trialBalanceAsOf(await ctxFor("priya", "YAS"), {}), "forbidden");
  await rejects(ac.createVoucher(yousef, { voucher_type: "journal", voucher_date: T, narration: "x x x", lines: [] }), "forbidden");
  // and the database itself keeps QUS ledger lines away from a YAS-only session
  const rows = await appQueryAs([YAS], "SELECT DISTINCT branch_id FROM journal_line");
  assert.ok(rows.every((r) => r.branch_id === YAS));
});

test("budget against actual by branch and month (AC-12)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const m = Number(THIS.slice(5, 7)), y = Number(THIS.slice(0, 4));
  await rejects(cl.saveBudget(await ctxFor("yousef", "YAS"), YAS, y, { [`${acc["5900"]}:${m}`]: "2000" }), "forbidden");
  await cl.saveBudget(maryam, YAS, y, { [`${acc["5900"]}:${m}`]: "2000", [`${acc["4100"]}:${m}`]: "5000" });
  const g = await cl.budgetGrid(maryam, YAS, y);
  const rent = g.rows.find((r) => r.code === "5900")!;
  assert.equal(rent.budget, "2000.00"); assert.equal(rent.actual, "1000.00"); assert.equal(rent.variance, "1000.00");
  const sales = g.rows.find((r) => r.code === "4100")!;
  assert.equal(sales.variance, (Number(sales.actual) - 5000).toFixed(2));
});

test("period close: checklist must pass, months close in order, a closed month refuses postings, only the owner reopens with a reason (AC-09)", async () => {
  const maryam = await ctxFor("maryam", "YAS");
  const co = cl.monthStart(CUTOVER);
  await rejects(cl.closePeriod(maryam, PREV), "validation", /first/); // the cut-over month has journals and is still open
  await rejects(cl.closePeriod(maryam, co), "validation", /VAT/);
  await cl.tickPeriodItem(maryam, co, "vat", true);
  await rejects(cl.closePeriod(await ctxFor("yousef", "YAS"), co), "forbidden");
  await cl.closePeriod(maryam, co);
  await rejects(ac.createVoucher(maryam, { voucher_type: "journal", voucher_date: CUTOVER, narration: "Late accrual", lines: [{ account_id: acc["5400"], debit: "10" }, { account_id: acc["3900"], credit: "10" }] }), "validation", /closed/);
  await assert.rejects(adminQuery(`INSERT INTO journal (branch_id, doc_no, journal_date, source_type) VALUES ($1, 'X-1', $2, 'test')`, [YAS, CUTOVER]), /closed/);
  await rejects(cl.reopenPeriod(maryam, co, "Late supplier bill found"), "forbidden");
  await rejects(cl.reopenPeriod(await ctxFor("saeed", "YAS"), co, ""), "validation");
  await cl.reopenPeriod(await ctxFor("saeed", "YAS"), co, "Late supplier bill found");
  assert.ok(await one("SELECT 1 x FROM audit_log WHERE entity = 'accounting_period' AND action = 'reopened'"));
  const list = await cl.periodChecklist(maryam, co);
  assert.equal(list.status, "open");
  await rejects(cl.yearEndClose(maryam, Number(T.slice(0, 4)) + (T.slice(5) === "12-31" ? 1 : 0)), "validation", /31 December/);
});
