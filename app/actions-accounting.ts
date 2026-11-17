"use server";
import { requireCtx } from "@/lib/session";
import { obj, keyed, run, withQ } from "@/lib/action-run";
import * as ac from "@/lib/services/accounting";
import * as cl from "@/lib/services/accounting-close";
import type { PayIn } from "@/lib/services/billing";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const fileText = async (fd: FormData, k: string) => {
  const f = fd.get(k);
  if (f && typeof f === "object" && "text" in f && (f as File).size > 0) {
    if ((f as File).size > 5_000_000) throw new Error("The file must be at most 5 MB.");
    return { text: await (f as File).text(), name: (f as File).name };
  }
  return { text: s(fd, `${k}_text`), name: "" };
};

// ---------- vouchers ----------
export async function voucherAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const n = Number(f.lines || 8);
  const lines = Array.from({ length: Math.min(n, 30) }, (_, i) => ({ account_id: f[`acct_${i}`], debit: f[`dr_${i}`], credit: f[`cr_${i}`], party_id: f[`party_${i}`] || undefined, narration: f[`nar_${i}`] }));
  await run("/accounts/vouchers/new", async () => {
    const r = await ac.createVoucher(ctx, { voucher_type: f.voucher_type, voucher_date: f.voucher_date, narration: f.narration, lines });
    return withQ(`/accounts/vouchers/${r.id}`, "ok", r.status === "posted" ? "Voucher posted" : "Voucher sent for approval. It gets its number when approved.");
  });
}

// ---------- supplier payments ----------
export async function paySupplierAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const amounts = keyed(fd, "alloc");
  const allocations = Object.entries(amounts).filter(([, v]) => v.trim()).map(([k, v]) => { const [kind, id] = k.split(":"); return { kind: kind as "bill" | "opening", id, amount: v }; });
  await run(`/accounts/payables/pay?supplier=${f.supplier_id}`, async () => {
    const r = await ac.paySupplier(ctx, { supplier_id: f.supplier_id, method: f.method, bank_account_id: f.bank_account_id, amount: f.amount, reference: f.reference,
      cheque_no: f.cheque_no, cheque_date: f.cheque_date, allocations, idempotency_key: f.idempotency_key });
    return withQ("/accounts/payables/payments", "ok", r.duplicate ? `Payment ${r.docNo} was already recorded` : `Payment ${r.docNo} posted`);
  });
}
export async function issuedChequeAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "payment_id");
  await run("/accounts/payables/payments", async () => {
    if (s(fd, "do") === "clear") { await ac.clearIssuedCheque(ctx, id); return withQ("/accounts/payables/payments", "ok", "Cheque marked as paid by the bank"); }
    await ac.cancelIssuedCheque(ctx, id, s(fd, "note"));
    return withQ("/accounts/payables/payments", "ok", "Cheque cancelled; the payment is reversed and the bills are open again");
  });
}
export async function allocateCreditAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(`/accounts/payables/pay?supplier=${s(fd, "supplier_id")}`, () => ac.allocateSupplierCredit(ctx, s(fd, "payment_id"), s(fd, "bill_id"), s(fd, "amount")), "Money on account used against the bill");
}
export async function openingReceiptAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const pay: PayIn = { method: f.method, amount: f.amount, reference: f.reference, cheque_no: f.cheque_no, cheque_bank: f.cheque_bank, cheque_date: f.cheque_date || undefined, idempotency_key: f.idempotency_key };
  await run(`/accounts/statement?party=customer&id=${f.customer_id}`, async () => {
    const r = await ac.receiveOnOpeningItem(ctx, f.item_id, pay);
    return withQ(`/accounts/statement?party=customer&id=${f.customer_id}`, "ok", `Receipt ${r.docNo} posted`);
  });
}

// ---------- bank ----------
export async function cardSettlementAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run("/accounts/bank", () => ac.settleCards(ctx, { bank_account_id: f.bank_account_id, settle_date: f.settle_date, batch_total: f.batch_total, bank_credit: f.bank_credit, reference: f.reference }).then(() => undefined), "Card settlement posted");
}
export async function importStatementAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/accounts/bank", async () => {
    const file = await fileText(fd, "file");
    const r = await ac.importStatement(ctx, { bank_account_id: s(fd, "bank_account_id"), file_name: file.name || "pasted.csv", text: file.text, closing_balance: s(fd, "closing_balance") });
    return withQ(`/accounts/bank/statements/${r.id}`, "ok", `${r.lines} lines imported, ${r.matched} matched automatically${r.skipped ? `, ${r.skipped} skipped as already imported` : ""}`);
  });
}
export async function statementLineAction(fd: FormData) {
  const ctx = await requireCtx();
  const sid = s(fd, "statement_id"), line = s(fd, "line_id"), back = `/accounts/bank/statements/${sid}`;
  const what = s(fd, "do");
  await run(back, async () => {
    if (what === "match") await ac.matchLine(ctx, line, s(fd, "journal_line_id"));
    else if (what === "unmatch") await ac.unmatchLine(ctx, line);
    else if (what === "post") await ac.postFromStatementLine(ctx, line, s(fd, "account_id"), s(fd, "narration"));
    else if (what === "finish") { await ac.finishStatement(ctx, sid); return withQ(back, "ok", "Statement finished and locked"); }
    return withQ(back, "ok", what === "post" ? "Entry posted and matched" : what === "match" ? "Matched" : "Match removed");
  });
}

// ---------- month end ----------
export async function periodAction(fd: FormData) {
  const ctx = await requireCtx();
  const m = s(fd, "month"), back = `/accounts/periods?month=${m.slice(0, 7)}`;
  await run(back, async () => {
    const what = s(fd, "do");
    if (what === "tick") await cl.tickPeriodItem(ctx, m, s(fd, "key"), s(fd, "on") === "1");
    else if (what === "close") { await cl.closePeriod(ctx, m); return withQ(back, "ok", `${m.slice(0, 7)} is closed. Nothing can be posted into it now.`); }
    else if (what === "reopen") { await cl.reopenPeriod(ctx, m, s(fd, "reason")); return withQ(back, "ok", `${m.slice(0, 7)} is open again. The reason is in the audit log.`); }
    else if (what === "year_end") { const r = await cl.yearEndClose(ctx, Number(s(fd, "year"))); return withQ(back, "ok", `Year closed: AED ${r.profit} moved to retained earnings (${r.journal})`); }
    return back;
  });
}
export async function hoAllocationAction(fd: FormData) {
  const ctx = await requireCtx();
  const m = s(fd, "month");
  await run(`/accounts/allocation?month=${m.slice(0, 7)}`, async () => withQ(`/accounts/allocation?month=${m.slice(0, 7)}`, "ok", `Allocation posted (${await cl.hoPost(ctx, m)})`));
}
export async function assetAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run("/accounts/assets", async () => {
    if (f.do === "add") { const r = await cl.addAsset(ctx, { branch_id: f.branch_id, name: f.name, category: f.category, acquired_on: f.acquired_on, cost: f.cost, salvage: f.salvage, life_months: f.life_months, paid_from: f.paid_from }); return withQ("/accounts/assets", "ok", `Asset ${r.no} added`); }
    if (f.do === "depreciate") return withQ("/accounts/assets", "ok", `Depreciation of AED ${await cl.runDepreciation(ctx, f.month)} posted for ${f.month}`);
    if (f.do === "dispose") { const g = Number(await cl.disposeAsset(ctx, f.asset_id, { date: f.date, amount: f.amount, bank_account_id: f.bank_account_id })); return withQ("/accounts/assets", "ok", `Asset disposed: ${g >= 0 ? "gain" : "loss"} of AED ${Math.abs(g).toFixed(2)}`); }
    return "/accounts/assets";
  });
}
export async function budgetAction(fd: FormData) {
  const ctx = await requireCtx();
  const b = s(fd, "branch_id"), y = Number(s(fd, "year"));
  await run(`/accounts/budgets?branch=${b}&year=${y}`, async () => withQ(`/accounts/budgets?branch=${b}&year=${y}`, "ok", `${await cl.saveBudget(ctx, b, y, keyed(fd, "b"))} budget figures saved`));
}
export async function openingAction(fd: FormData) {
  const ctx = await requireCtx();
  const what = s(fd, "do");
  await run("/accounts/opening", async () => {
    if (what === "sign") { await cl.signOffOpening(ctx, s(fd, "batch_id"), s(fd, "note")); return withQ("/accounts/opening", "ok", "Opening balances signed off"); }
    const [ledger, bills, tally] = [await fileText(fd, "ledger"), await fileText(fd, "bills"), await fileText(fd, "tally")];
    const id = await cl.loadOpening(ctx, { cutover_date: s(fd, "cutover_date"), ledger_csv: ledger.text, bills_csv: bills.text, tally_csv: tally.text });
    return withQ(`/accounts/opening?batch=${id}`, "ok", "Opening balances loaded. Compare with Tally below, then sign off.");
  });
}

/** Step 2 of the cut-over: reads the templates and reports problems without writing anything. */
export async function checkOpeningAction(_prev: unknown, fd: FormData) {
  const ctx = await requireCtx();
  try {
    const [ledger, bills, tally] = [await fileText(fd, "ledger"), await fileText(fd, "bills"), await fileText(fd, "tally")];
    return { ok: true as const, plan: await cl.checkOpening(ctx, { cutover_date: s(fd, "cutover_date"), ledger_csv: ledger.text, bills_csv: bills.text, tally_csv: tally.text }) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "The files could not be read." };
  }
}

/** Step 1 of the cut-over: import masters from Tally (TM-01). */
export async function importMastersAction(fd: FormData) {
  const ctx = await requireCtx();
  const { importMasters } = await import("@/lib/services/migration");
  await run("/accounts/opening", async () => {
    const file = await fileText(fd, "file");
    const r = await importMasters(ctx, s(fd, "kind") as never, file.text);
    const msg = `${r.created} added, ${r.skipped} already there${r.errors.length ? `; ${r.errors.length} line(s) refused: ${r.errors.slice(0, 5).join(" ")}` : ""}`;
    return withQ("/accounts/opening", r.errors.length && !r.created ? "err" : "ok", msg);
  });
}
