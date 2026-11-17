import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Ctx, assertCan, can } from "../access";
import { withTx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal, type PostLine } from "./ledger";
import { history, registerHandler, submitForApproval } from "./workflow";
import { getSetting } from "./settings";
import { D, Decimal, parseDec } from "../money";
import { today } from "./stock";
import { optStr, str } from "../validate";
import { paymentMethod, assertCashOpen, type PayIn } from "./billing";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(str(v));
const here = (ctx: Ctx) => { if (!ctx.currentBranchId) throw invalid("Choose a branch first."); return ctx.currentBranchId; };

/** Refuses a date in a closed month before any work is done (the database refuses it too). */
export async function assertOpenPeriod(c: PoolClient, date: string) {
  const p = (await c.query("SELECT status FROM accounting_period WHERE period_month = date_trunc('month', $1::date)::date", [date])).rows[0];
  if (p?.status === "closed") throw invalid(`${date.slice(0, 7)} is closed. Use a date in an open month, or ask the owner to reopen it.`);
}

/** Copies a journal with debits and credits swapped (used to cancel a cheque or a document). */
export async function reverseJournal(c: PoolClient, ctx: Ctx, journalId: string, f: { date: string; sourceType: string; sourceId: string; narration: string }) {
  const j = (await c.query("SELECT * FROM journal WHERE id = $1", [journalId])).rows[0];
  if (!j) throw notFound("Journal");
  const lines = (await c.query("SELECT * FROM journal_line WHERE journal_id = $1 ORDER BY id", [journalId])).rows;
  return postJournal(c, ctx, {
    branchId: j.branch_id, date: f.date, sourceType: f.sourceType, sourceId: f.sourceId, narration: f.narration,
    lines: lines.map((l) => ({ accountId: l.account_id, debit: l.credit, credit: l.debit, customerId: l.customer_id, supplierId: l.supplier_id, branchId: l.branch_id, narration: l.narration })),
  });
}

export async function accountsList(ctx: Ctx) {
  return withTx(ctx, async (c) => (await c.query("SELECT id, code, name, account_group, account_type, sub_type, party_type FROM account WHERE active ORDER BY code")).rows);
}
export async function bankAccounts(ctx: Ctx) {
  return withTx(ctx, async (c) => (await c.query("SELECT b.*, a.code account_code FROM bank_account b JOIN account a ON a.id = b.account_id WHERE b.active ORDER BY b.name")).rows);
}

// =====================================================================================
// Manual vouchers (AC-03): journal, payment, receipt, contra, debit and credit notes
// =====================================================================================

export type VoucherLineIn = { account_id: string; debit?: unknown; credit?: unknown; party_id?: string; narration?: string };
export const VOUCHER_TYPES: Record<string, string> = { journal: "Journal", payment: "Payment", receipt: "Receipt", contra: "Contra (cash and bank)", debit_note: "Debit note", credit_note: "Credit note" };

export async function createVoucher(ctx: Ctx, f: { voucher_type: string; voucher_date: string; narration: string; lines: VoucherLineIn[]; attachment_id?: string | null }) {
  const b = here(ctx);
  assertCan(ctx, "accounting", "create", b);
  if (!VOUCHER_TYPES[f.voucher_type]) throw invalid("Choose the voucher type.");
  if (!isDate(f.voucher_date)) throw invalid("Enter the voucher date.");
  if (f.voucher_date > today()) throw invalid("A voucher cannot be dated in the future.");
  const narration = str(f.narration);
  if (narration.length < 3) throw invalid("Write what the voucher is for.");
  return withTx(ctx, async (c) => {
    await assertOpenPeriod(c, f.voucher_date);
    const lines: { acc: Row; debit: Decimal; credit: Decimal; customerId: string | null; supplierId: string | null; narration: string | null }[] = [];
    for (const x of f.lines) {
      if (!str(x.account_id) && !str(x.debit) && !str(x.credit)) continue;
      const acc = (await c.query("SELECT * FROM account WHERE id = $1 AND active", [x.account_id])).rows[0];
      if (!acc) throw invalid("Choose the account on every line.");
      const debit = str(x.debit) ? parseDec(x.debit, "Debit", { min: 0, dp: 2 }) : D(0);
      const credit = str(x.credit) ? parseDec(x.credit, "Credit", { min: 0, dp: 2 }) : D(0);
      if (debit.gt(0) === credit.gt(0)) throw invalid(`${acc.code} ${acc.name}: enter a debit or a credit, not both.`);
      let customerId: string | null = null, supplierId: string | null = null;
      if (acc.party_type === "customer") {
        if (!str(x.party_id) || !(await c.query("SELECT 1 FROM customer WHERE id = $1", [x.party_id])).rowCount) throw invalid(`${acc.code} ${acc.name} needs the customer.`);
        customerId = x.party_id!;
      } else if (acc.party_type === "supplier") {
        if (!str(x.party_id) || !(await c.query("SELECT 1 FROM supplier WHERE id = $1", [x.party_id])).rowCount) throw invalid(`${acc.code} ${acc.name} needs the supplier.`);
        supplierId = x.party_id!;
      }
      lines.push({ acc, debit, credit, customerId, supplierId, narration: optStr(x.narration) });
    }
    if (lines.length < 2) throw invalid("A voucher needs at least two lines.");
    const dr = lines.reduce((s, l) => s.plus(l.debit), D(0)), cr = lines.reduce((s, l) => s.plus(l.credit), D(0));
    if (!dr.eq(cr)) throw invalid(`Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal.`);
    const cashBank = (l: (typeof lines)[number]) => ["cash", "bank"].includes(l.acc.sub_type);
    if (f.voucher_type === "payment" && !lines.some((l) => cashBank(l) && l.credit.gt(0))) throw invalid("A payment voucher pays out of a cash or bank account (credit it).");
    if (f.voucher_type === "receipt" && !lines.some((l) => cashBank(l) && l.debit.gt(0))) throw invalid("A receipt voucher goes into a cash or bank account (debit it).");
    if (f.voucher_type === "contra" && !lines.every(cashBank)) throw invalid("A contra moves money between cash and bank accounts only.");
    const v = (await c.query(
      "INSERT INTO voucher (branch_id, voucher_type, voucher_date, narration, total, attachment_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [b, f.voucher_type, f.voucher_date, narration, dr.toFixed(2), optStr(f.attachment_id), ctx.userId])).rows[0];
    for (const [i, l] of lines.entries()) {
      await c.query("INSERT INTO voucher_line (voucher_id, branch_id, line_no, account_id, debit, credit, customer_id, supplier_id, narration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [v.id, b, i + 1, l.acc.id, l.debit.toFixed(2), l.credit.toFixed(2), l.customerId, l.supplierId, l.narration]);
    }
    await audit(c, ctx, "voucher", v.id, "submitted", { type: f.voucher_type, total: dr.toFixed(2) }, b);
    const r = await submitForApproval(c, ctx, { docType: "voucher", docId: v.id, docRef: `${VOUCHER_TYPES[f.voucher_type]} voucher: ${narration.slice(0, 60)}`, branchId: b, amount: dr.toFixed(2), summary: { reason: narration } });
    if (r.status === "approved") await postVoucher(c, ctx, v.id);
    return { id: v.id as string, status: r.status === "approved" ? "posted" : "pending_approval" };
  });
}

async function postVoucher(c: PoolClient, ctx: Ctx, id: string) {
  const v = (await c.query("SELECT * FROM voucher WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!v || v.status !== "pending_approval") return;
  const lines = (await c.query("SELECT * FROM voucher_line WHERE voucher_id = $1 ORDER BY line_no", [id])).rows;
  const date = ymd(v.voucher_date);
  await assertOpenPeriod(c, date);
  // Each voucher type has its own series (Document numbering), as in Tally.
  const docNo = await nextDocNo(c, v.branch_id, `voucher_${v.voucher_type}`);
  const jr = await postJournal(c, ctx, {
    branchId: v.branch_id, date, sourceType: "voucher", sourceId: id, narration: `${docNo}: ${v.narration}`,
    lines: lines.map((l) => ({ accountId: l.account_id, debit: l.debit, credit: l.credit, customerId: l.customer_id, supplierId: l.supplier_id, narration: l.narration })),
  });
  await c.query("UPDATE voucher SET status = 'posted', doc_no = $2, journal_id = $3, posted_at = now() WHERE id = $1", [id, docNo, jr!.id]);
  await audit(c, ctx, "voucher", id, "posted", { doc_no: docNo }, v.branch_id);
}

registerHandler("voucher", {
  onApproved: async (c, ctx, req) => postVoucher(c, ctx, req.doc_id),
  onRejected: async (c, _ctx, req, comment) => { await c.query("UPDATE voucher SET status = 'rejected', reject_reason = $2 WHERE id = $1 AND status = 'pending_approval'", [req.doc_id, comment]); },
});

export async function listVouchers(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT v.*, b.code branch_code, u.full_name created_by_name FROM voucher v JOIN branch b ON b.id = v.branch_id LEFT JOIN app_user u ON u.id = v.created_by
      ORDER BY v.created_at DESC LIMIT 300`)).rows);
}
export async function getVoucher(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const v = (await c.query("SELECT v.*, b.code branch_code, u.full_name created_by_name FROM voucher v JOIN branch b ON b.id = v.branch_id LEFT JOIN app_user u ON u.id = v.created_by WHERE v.id = $1", [id])).rows[0];
    if (!v) throw notFound("Voucher");
    assertCan(ctx, "accounting", "view", v.branch_id);
    const lines = (await c.query(
      `SELECT l.*, a.code, a.name, coalesce(s.name_en, CASE WHEN cu.customer_type = 'individual' THEN concat_ws(' ', cu.first_name, cu.last_name) ELSE cu.company_name END) party
         FROM voucher_line l JOIN account a ON a.id = l.account_id LEFT JOIN supplier s ON s.id = l.supplier_id LEFT JOIN customer cu ON cu.id = l.customer_id
        WHERE l.voucher_id = $1 ORDER BY l.line_no`, [id])).rows;
    return { voucher: v, lines, history: await history(c, "voucher", id) };
  });
}

// =====================================================================================
// Supplier payments and cheques issued (AC-04, AC-13, AC-17)
// =====================================================================================

export async function supplierOpenItems(ctx: Ctx, supplierId: string) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => {
    const bills = (await c.query(
      `SELECT 'bill' kind, sb.id, sb.doc_no, sb.supplier_invoice_no ref, sb.invoice_date doc_date, coalesce(sb.due_date, sb.invoice_date) due_date, sb.grand_total amount,
              sb.grand_total - sb.paid_amount open, b.code branch_code, sb.branch_id
         FROM supplier_bill sb JOIN branch b ON b.id = sb.branch_id WHERE sb.supplier_id = $1 AND sb.status = 'posted' AND sb.paid_amount < sb.grand_total
       UNION ALL
       SELECT 'opening', o.id, o.bill_no, 'Opening balance', o.bill_date, o.due_date, o.amount, o.amount - o.settled_amount, b.code, o.branch_id
         FROM opening_item o JOIN branch b ON b.id = o.branch_id WHERE o.supplier_id = $1 AND o.settled_amount < o.amount
       ORDER BY due_date`, [supplierId])).rows;
    const credit = (await c.query("SELECT coalesce(sum(on_account),0) v FROM supplier_payment WHERE supplier_id = $1 AND (cheque_status IS NULL OR cheque_status <> 'cancelled')", [supplierId])).rows[0].v;
    return { items: bills, onAccount: String(credit) };
  });
}

export type SupplierPayIn = { supplier_id: string; method: string; bank_account_id?: string; amount: unknown; reference?: string; cheque_no?: string; cheque_date?: string;
  allocations: { kind: "bill" | "opening"; id: string; amount: unknown }[]; idempotency_key: string };

/**
 * Pays a supplier, allocated bill by bill (any rest stays on account). Bills of other branches are
 * settled through inter-branch clearing so each branch's books still balance. A cheque is a liability
 * ("cheques issued") until the bank clears it.
 */
export async function paySupplier(ctx: Ctx, f: SupplierPayIn) {
  const b = here(ctx);
  assertCan(ctx, "accounting", "create", b);
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  const amount = parseDec(f.amount, "Amount", { min: "0.01", dp: 2 });
  if (!["bank_transfer", "cheque", "cash"].includes(f.method)) throw invalid("Choose how the supplier is paid.");
  return withTx(ctx, async (c) => {
    const prior = (await c.query("SELECT id, doc_no FROM supplier_payment WHERE idempotency_key = $1", [f.idempotency_key])).rows[0];
    if (prior) return { id: prior.id as string, docNo: prior.doc_no as string, duplicate: true };
    const sup = (await c.query("SELECT * FROM supplier WHERE id = $1", [f.supplier_id])).rows[0];
    if (!sup) throw invalid("Choose the supplier.");
    let creditLine: PostLine;
    let bankId: string | null = null;
    if (f.method === "cash") creditLine = { event: "petty_cash", credit: amount };
    else {
      const ba = (await c.query("SELECT * FROM bank_account WHERE id = $1 AND active", [f.bank_account_id])).rows[0];
      if (!ba) throw invalid("Choose the bank account the payment comes from.");
      bankId = ba.id;
      if (f.method === "cheque") {
        if (!str(f.cheque_no)) throw invalid("Enter the cheque number.");
        if (!isDate(f.cheque_date)) throw invalid("Enter the cheque date.");
        creditLine = { event: "pdc_issued", credit: amount, supplierId: sup.id };
      } else {
        if (!str(f.reference)) throw invalid("Enter the bank transfer reference.");
        creditLine = { accountId: ba.account_id, credit: amount };
      }
    }
    const date = today();
    await assertOpenPeriod(c, date);
    // allocations
    let allocated = D(0);
    const byBranch = new Map<string, Decimal>();
    const allocs: { kind: string; id: string; amt: Decimal; branchId: string }[] = [];
    for (const a of f.allocations) {
      if (!str(a.amount)) continue;
      const amt = parseDec(a.amount, "Amount to settle", { min: "0.01", dp: 2 });
      const row = a.kind === "bill"
        ? (await c.query("SELECT id, branch_id, doc_no, grand_total - paid_amount open, supplier_id, status FROM supplier_bill WHERE id = $1 FOR UPDATE", [a.id])).rows[0]
        : (await c.query("SELECT id, branch_id, bill_no doc_no, amount - settled_amount open, supplier_id, 'posted' status FROM opening_item WHERE id = $1 AND party_type = 'supplier' FOR UPDATE", [a.id])).rows[0];
      if (!row || row.supplier_id !== sup.id || row.status !== "posted") throw invalid("A chosen bill is not an open bill of this supplier.");
      if (amt.gt(row.open)) throw invalid(`${row.doc_no}: only AED ${D(row.open).toFixed(2)} is open.`);
      allocated = allocated.plus(amt);
      byBranch.set(row.branch_id, (byBranch.get(row.branch_id) ?? D(0)).plus(amt));
      allocs.push({ kind: a.kind, id: a.id, amt, branchId: row.branch_id });
    }
    if (allocated.gt(amount)) throw invalid(`The bills chosen (AED ${allocated.toFixed(2)}) are more than the payment.`);
    const onAccount = amount.minus(allocated);
    const docNo = await nextDocNo(c, b, "supplier_payment");
    const lines: PostLine[] = [creditLine];
    const homeShare = (byBranch.get(b) ?? D(0)).plus(onAccount);
    lines.push({ event: "trade_payable", debit: homeShare, supplierId: sup.id });
    for (const [br, amt] of byBranch) {
      if (br === b) continue;
      lines.push({ event: "interbranch", debit: amt, narration: "Paid for another branch" });
      lines.push({ event: "trade_payable", debit: amt, supplierId: sup.id, branchId: br });
      lines.push({ event: "interbranch", credit: amt, branchId: br, narration: "Paid by another branch" });
    }
    const pid = crypto.randomUUID();
    const jr = await postJournal(c, ctx, { branchId: b, date, sourceType: "supplier_payment", sourceId: pid, narration: `Payment ${docNo} to ${sup.name_en}`, lines });
    await c.query(
      `INSERT INTO supplier_payment (id, branch_id, doc_no, doc_date, supplier_id, method, bank_account_id, amount, on_account, reference, cheque_no, cheque_date, cheque_status, idempotency_key, journal_id, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [pid, b, docNo, date, sup.id, f.method, bankId, amount.toFixed(2), onAccount.toFixed(2), optStr(f.reference), f.method === "cheque" ? str(f.cheque_no) : null,
        f.method === "cheque" ? f.cheque_date : null, f.method === "cheque" ? "issued" : null, f.idempotency_key, jr!.id, ctx.userId]);
    for (const a of allocs) {
      await c.query("INSERT INTO supplier_payment_allocation (branch_id, payment_id, bill_id, opening_item_id, amount) VALUES ($1,$2,$3,$4,$5)",
        [a.branchId, pid, a.kind === "bill" ? a.id : null, a.kind === "opening" ? a.id : null, a.amt.toFixed(2)]);
      if (a.kind === "bill") await c.query("UPDATE supplier_bill SET paid_amount = paid_amount + $2 WHERE id = $1", [a.id, a.amt.toFixed(2)]);
      else await c.query("UPDATE opening_item SET settled_amount = settled_amount + $2 WHERE id = $1", [a.id, a.amt.toFixed(2)]);
    }
    await audit(c, ctx, "supplier_payment", pid, "post", { doc_no: docNo, amount: amount.toFixed(2), on_account: onAccount.toFixed(2), method: f.method }, b);
    return { id: pid, docNo, duplicate: false };
  });
}

export async function listSupplierPayments(ctx: Ctx, filter: { cheques?: string } = {}) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT p.*, s.name_en supplier_name, b.code branch_code, ba.name bank_name FROM supplier_payment p JOIN supplier s ON s.id = p.supplier_id JOIN branch b ON b.id = p.branch_id
       LEFT JOIN bank_account ba ON ba.id = p.bank_account_id
      WHERE ($1 = '' OR p.cheque_status = $1) ORDER BY p.posted_at DESC LIMIT 300`, [filter.cheques ?? ""])).rows);
}

/** The bank has paid our cheque: Dr cheques issued, Cr the bank. Not before the cheque date. */
export async function clearIssuedCheque(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const p = (await c.query("SELECT p.*, ba.account_id bank_ledger FROM supplier_payment p JOIN bank_account ba ON ba.id = p.bank_account_id WHERE p.id = $1 FOR UPDATE OF p", [id])).rows[0];
    if (!p) throw notFound("Payment");
    assertCan(ctx, "accounting", "create", p.branch_id);
    if (p.cheque_status !== "issued") throw invalid("Only a cheque that is still out can be cleared.");
    if (ymd(p.cheque_date) > today()) throw invalid(`This cheque is dated ${ymd(p.cheque_date)}; the bank cannot pay it before then.`);
    await postJournal(c, ctx, { branchId: p.branch_id, date: today(), sourceType: "cheque_issued_cleared", sourceId: id, narration: `Cheque ${p.cheque_no} (${p.doc_no}) paid by the bank`,
      lines: [{ event: "pdc_issued", debit: p.amount, supplierId: p.supplier_id }, { accountId: p.bank_ledger, credit: p.amount }] });
    await c.query("UPDATE supplier_payment SET cheque_status = 'cleared', cheque_event_at = now() WHERE id = $1", [id]);
    await audit(c, ctx, "supplier_payment", id, "cheque_cleared", { cheque_no: p.cheque_no }, p.branch_id);
  });
}

/** A cheque we issued is cancelled (lost, stopped, replaced): the payment is reversed and the bills open again. */
export async function cancelIssuedCheque(ctx: Ctx, id: string, note: string) {
  const why = str(note);
  if (!why) throw invalid("Say why the cheque is cancelled.");
  return withTx(ctx, async (c) => {
    const p = (await c.query("SELECT * FROM supplier_payment WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!p) throw notFound("Payment");
    assertCan(ctx, "accounting", "approve", p.branch_id);
    if (p.cheque_status !== "issued") throw invalid("Only a cheque that is still out can be cancelled.");
    await reverseJournal(c, ctx, p.journal_id, { date: today(), sourceType: "cheque_issued_cancelled", sourceId: id, narration: `Cheque ${p.cheque_no} (${p.doc_no}) cancelled: ${why}` });
    for (const a of (await c.query("SELECT * FROM supplier_payment_allocation WHERE payment_id = $1 AND NOT reversed", [id])).rows) {
      await c.query("UPDATE supplier_payment_allocation SET reversed = true WHERE id = $1", [a.id]);
      if (a.bill_id) await c.query("UPDATE supplier_bill SET paid_amount = paid_amount - $2 WHERE id = $1", [a.bill_id, a.amount]);
      else await c.query("UPDATE opening_item SET settled_amount = settled_amount - $2 WHERE id = $1", [a.opening_item_id, a.amount]);
    }
    await c.query("UPDATE supplier_payment SET cheque_status = 'cancelled', cheque_event_at = now(), cheque_note = $2, on_account = 0 WHERE id = $1", [id, why]);
    await audit(c, ctx, "supplier_payment", id, "cheque_cancelled", { cheque_no: p.cheque_no, reason: why }, p.branch_id);
  });
}

/** Uses money paid on account to settle a later bill at the same branch (bill-by-bill settlement, AC-13). */
export async function allocateSupplierCredit(ctx: Ctx, paymentId: string, billId: string, amount: unknown) {
  return withTx(ctx, async (c) => {
    const p = (await c.query("SELECT * FROM supplier_payment WHERE id = $1 FOR UPDATE", [paymentId])).rows[0];
    if (!p) throw notFound("Payment");
    assertCan(ctx, "accounting", "create", p.branch_id);
    if (p.cheque_status === "cancelled") throw invalid("This payment was cancelled.");
    const bill = (await c.query("SELECT * FROM supplier_bill WHERE id = $1 FOR UPDATE", [billId])).rows[0];
    if (!bill || bill.supplier_id !== p.supplier_id || bill.status !== "posted") throw invalid("Choose an open bill of the same supplier.");
    if (bill.branch_id !== p.branch_id) throw invalid("The bill belongs to another branch. Settle it with a payment from that branch, or a journal voucher.");
    const open = D(bill.grand_total).minus(bill.paid_amount);
    const amt = str(amount) ? parseDec(amount, "Amount", { min: "0.01", dp: 2 }) : Decimal.min(open, p.on_account);
    if (amt.gt(p.on_account) || amt.gt(open)) throw invalid(`You can settle up to AED ${Decimal.min(open, p.on_account).toFixed(2)}.`);
    await c.query("INSERT INTO supplier_payment_allocation (branch_id, payment_id, bill_id, amount) VALUES ($1,$2,$3,$4)", [p.branch_id, paymentId, billId, amt.toFixed(2)]);
    await c.query("UPDATE supplier_bill SET paid_amount = paid_amount + $2 WHERE id = $1", [billId, amt.toFixed(2)]);
    await c.query("UPDATE supplier_payment SET on_account = on_account - $2 WHERE id = $1", [paymentId, amt.toFixed(2)]);
    await audit(c, ctx, "supplier_payment", paymentId, "allocated", { bill: bill.doc_no, amount: amt.toFixed(2) }, p.branch_id);
  });
}

// =====================================================================================
// Customer opening bills settled by a receipt (opening balances from Tally)
// =====================================================================================

export async function receiveOnOpeningItem(ctx: Ctx, itemId: string, f: PayIn) {
  const amount = parseDec(f.amount, "Amount", { min: "0.01", dp: 2 });
  if (!f.idempotency_key || f.idempotency_key.length < 16) throw invalid("Missing idempotency key.");
  return withTx(ctx, async (c) => {
    const prior = (await c.query("SELECT id, doc_no FROM receipt WHERE idempotency_key = $1", [f.idempotency_key])).rows[0];
    if (prior) return { id: prior.id as string, docNo: prior.doc_no as string, duplicate: true };
    const o = (await c.query("SELECT * FROM opening_item WHERE id = $1 AND party_type = 'customer' FOR UPDATE", [itemId])).rows[0];
    if (!o) throw notFound("Opening bill");
    assertCan(ctx, "invoices", "create", o.branch_id);
    const open = D(o.amount).minus(o.settled_amount);
    if (amount.gt(open)) throw invalid(`Only AED ${open.toFixed(2)} is open on ${o.bill_no}.`);
    const { pm, isCheque } = await paymentMethod(c, f);
    await assertCashOpen(c, ctx, o.branch_id, pm);
    const docNo = await nextDocNo(c, o.branch_id, "receipt");
    const rid = crypto.randomUUID();
    const jr = await postJournal(c, ctx, { branchId: o.branch_id, date: today(), sourceType: "receipt", sourceId: rid, narration: `Receipt ${docNo} for opening bill ${o.bill_no}`,
      lines: [{ event: pm.posting_event, debit: amount }, { event: "trade_receivable", credit: amount, customerId: o.customer_id }] });
    await c.query(
      `INSERT INTO receipt (id, branch_id, doc_no, doc_date, customer_id, method, amount, reference, idempotency_key, request_hash, journal_id, posted_by, kind, cheque_no, cheque_bank, cheque_date, cheque_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'opening',$13,$14,$15,$16)`,
      [rid, o.branch_id, docNo, today(), o.customer_id, f.method, amount.toFixed(2), optStr(f.reference), f.idempotency_key, "opening:" + itemId, jr!.id, ctx.userId,
        isCheque ? str(f.cheque_no) : null, isCheque ? str(f.cheque_bank) : null, isCheque ? f.cheque_date : null, isCheque ? "held" : null]);
    await c.query("INSERT INTO receipt_allocation (receipt_id, opening_item_id, branch_id, amount) VALUES ($1,$2,$3,$4)", [rid, itemId, o.branch_id, amount.toFixed(2)]);
    await c.query("UPDATE opening_item SET settled_amount = settled_amount + $2 WHERE id = $1", [itemId, amount.toFixed(2)]);
    await audit(c, ctx, "receipt", rid, "post", { doc_no: docNo, opening_bill: o.bill_no, amount: amount.toFixed(2) }, o.branch_id);
    return { id: rid, docNo, duplicate: false };
  });
}

// =====================================================================================
// Card settlements (AC-05)
// =====================================================================================

export async function settleCards(ctx: Ctx, f: { bank_account_id: string; settle_date?: string; batch_total: unknown; bank_credit: unknown; reference?: string }) {
  const b = here(ctx);
  assertCan(ctx, "accounting", "create", b);
  const batch = parseDec(f.batch_total, "Terminal batch total", { min: "0.01", dp: 2 });
  const credit = parseDec(f.bank_credit, "Amount the bank credited", { min: "0.01", dp: 2 });
  if (credit.gt(batch)) throw invalid("The bank credit cannot be more than the batch total.");
  const date = isDate(f.settle_date) ? f.settle_date! : today();
  return withTx(ctx, async (c) => {
    await assertOpenPeriod(c, date);
    const ba = (await c.query("SELECT * FROM bank_account WHERE id = $1 AND active", [f.bank_account_id])).rows[0];
    if (!ba) throw invalid("Choose the bank account credited.");
    const held = D((await c.query(
      `SELECT coalesce(sum(jl.debit - jl.credit),0) v FROM journal_line jl JOIN account_mapping m ON m.account_id = jl.account_id WHERE m.event_key = 'card_clearing' AND jl.branch_id = $1`, [b])).rows[0].v);
    if (batch.gt(held)) throw invalid(`Only AED ${held.toFixed(2)} of card receipts is waiting at this branch.`);
    const docNo = await nextDocNo(c, b, "card_settlement");
    const id = crypto.randomUUID();
    const commission = batch.minus(credit);
    const jr = await postJournal(c, ctx, { branchId: b, date, sourceType: "card_settlement", sourceId: id, narration: `Card settlement ${docNo}${f.reference ? ` (${f.reference})` : ""}`,
      lines: [{ accountId: ba.account_id, debit: credit }, { event: "bank_charges", debit: commission }, { event: "card_clearing", credit: batch }] });
    await c.query("INSERT INTO card_settlement (id, branch_id, doc_no, settle_date, bank_account_id, batch_total, bank_credit, commission, reference, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id, b, docNo, date, ba.id, batch.toFixed(2), credit.toFixed(2), commission.toFixed(2), optStr(f.reference), jr!.id, ctx.userId]);
    await audit(c, ctx, "card_settlement", id, "post", { doc_no: docNo, batch: batch.toFixed(2), commission: commission.toFixed(2) }, b);
    return { id, docNo, commission: commission.toFixed(2) };
  });
}
export async function listCardSettlements(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT s.*, b.code branch_code, ba.name bank_name FROM card_settlement s JOIN branch b ON b.id = s.branch_id JOIN bank_account ba ON ba.id = s.bank_account_id ORDER BY s.created_at DESC LIMIT 100")).rows);
}

// =====================================================================================
// Bank reconciliation (AC-06)
// =====================================================================================

/** Reads a bank statement CSV: Date, Description, Reference, and either Amount or Debit and Credit columns. */
export function parseStatementCsv(text: string) {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out.map((x) => x.trim());
  });
  if (rows.length < 2) throw invalid("The file has no statement lines.");
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const di = col("date"), de = col("description", "narration", "details"), re = col("reference", "ref"), am = col("amount"), dr = col("debit", "withdrawal"), cr = col("credit", "deposit");
  if (di < 0 || de < 0 || (am < 0 && (dr < 0 || cr < 0))) throw invalid("The file needs Date and Description columns, and Amount or Debit and Credit columns.");
  const num = (v: string) => Number((v || "0").replace(/[, ]/g, "").replace(/^\((.*)\)$/, "-$1"));
  const date = (v: string) => {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    throw invalid(`Cannot read the date "${v}". Use DD/MM/YYYY or YYYY-MM-DD.`);
  };
  return rows.slice(1).map((r, i) => {
    const amount = am >= 0 ? num(r[am]) : num(r[cr]) - num(r[dr]);
    if (!Number.isFinite(amount)) throw invalid(`Line ${i + 2}: the amount is not a number.`);
    return { line_no: i + 1, line_date: date(r[di]), description: r[de] || "-", reference: re >= 0 ? r[re] || null : null, amount: Math.round(amount * 100) / 100 };
  }).filter((r) => r.amount !== 0);
}

export async function importStatement(ctx: Ctx, f: { bank_account_id: string; file_name: string; text: string; closing_balance?: unknown }) {
  assertCan(ctx, "accounting", "create");
  const lines = parseStatementCsv(f.text);
  return withTx(ctx, async (c) => {
    const ba = (await c.query("SELECT * FROM bank_account WHERE id = $1", [f.bank_account_id])).rows[0];
    if (!ba) throw invalid("Choose the bank account.");
    const from = lines.reduce((m, l) => (l.line_date < m ? l.line_date : m), lines[0].line_date);
    const to = lines.reduce((m, l) => (l.line_date > m ? l.line_date : m), lines[0].line_date);
    // the same line (date, amount, reference) already imported for this account is skipped
    const fresh = [];
    for (const l of lines) {
      const dup = await c.query(
        `SELECT 1 FROM bank_statement_line sl JOIN bank_statement s ON s.id = sl.statement_id WHERE s.bank_account_id = $1 AND sl.line_date = $2 AND sl.amount = $3
            AND coalesce(sl.reference,'') = coalesce($4,'') AND sl.description = $5`, [ba.id, l.line_date, l.amount, l.reference, l.description]);
      if (!dup.rowCount) fresh.push(l);
    }
    if (!fresh.length) throw invalid("Every line in this file was imported before.");
    const s = (await c.query("INSERT INTO bank_statement (bank_account_id, file_name, date_from, date_to, closing_balance, imported_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [ba.id, str(f.file_name) || "statement.csv", from, to, str(f.closing_balance) ? parseDec(f.closing_balance, "Closing balance", { dp: 2 }).toFixed(2) : null, ctx.userId])).rows[0];
    for (const [i, l] of fresh.entries()) {
      await c.query("INSERT INTO bank_statement_line (statement_id, line_no, line_date, description, reference, amount) VALUES ($1,$2,$3,$4,$5,$6)", [s.id, i + 1, l.line_date, l.description, l.reference, l.amount.toFixed(2)]);
    }
    const matched = await autoMatch(c, ctx, s.id);
    await audit(c, ctx, "bank_statement", s.id, "imported", { lines: fresh.length, skipped: lines.length - fresh.length, matched }, null);
    return { id: s.id as string, lines: fresh.length, skipped: lines.length - fresh.length, matched };
  });
}

/** Book lines on the bank's ledger that no statement line has claimed yet. */
async function candidates(c: PoolClient, accountId: string, amount: string, date: string, days: number) {
  return (await c.query(
    `SELECT jl.id, j.journal_date, j.narration, j.doc_no, jl.debit - jl.credit amt,
            (SELECT r.reference FROM receipt r WHERE r.journal_id = j.id) receipt_ref, (SELECT p.reference FROM supplier_payment p WHERE p.journal_id = j.id) payment_ref
       FROM journal_line jl JOIN journal j ON j.id = jl.journal_id
      WHERE jl.account_id = $1 AND jl.debit - jl.credit = $2 AND j.journal_date BETWEEN $3::date - $4::int AND $3::date + $4::int
        AND NOT EXISTS (SELECT 1 FROM bank_statement_line sl WHERE sl.journal_line_id = jl.id)
      ORDER BY abs(j.journal_date - $3::date), jl.id`, [accountId, amount, date, days])).rows;
}

async function autoMatch(c: PoolClient, ctx: Ctx, statementId: string) {
  const s = (await c.query("SELECT s.*, ba.account_id FROM bank_statement s JOIN bank_account ba ON ba.id = s.bank_account_id WHERE s.id = $1", [statementId])).rows[0];
  const days = Number(await getSetting(c, "accounting.bank_match_days", null, 3));
  let n = 0;
  for (const l of (await c.query("SELECT * FROM bank_statement_line WHERE statement_id = $1 AND journal_line_id IS NULL ORDER BY line_no", [statementId])).rows) {
    const cand = await candidates(c, s.account_id, l.amount, ymd(l.line_date), days);
    const ref = str(l.reference).toLowerCase();
    const byRef = ref ? cand.filter((x) => [x.receipt_ref, x.payment_ref, x.narration].some((t) => t && String(t).toLowerCase().includes(ref))) : [];
    const pick = byRef.length === 1 ? byRef[0] : cand.length === 1 ? cand[0] : null;
    if (!pick) continue;
    await c.query("UPDATE bank_statement_line SET journal_line_id = $2, match_kind = 'auto', matched_by = $3, matched_at = now() WHERE id = $1", [l.id, pick.id, ctx.userId]);
    n++;
  }
  return n;
}

export async function getStatement(ctx: Ctx, id: string) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => {
    const s = (await c.query("SELECT s.*, ba.name bank_name, ba.bank_name bank, ba.account_id FROM bank_statement s JOIN bank_account ba ON ba.id = s.bank_account_id WHERE s.id = $1", [id])).rows[0];
    if (!s) throw notFound("Bank statement");
    const days = Number(await getSetting(c, "accounting.bank_match_days", null, 3));
    const lines = (await c.query(
      `SELECT sl.*, j.doc_no journal_no, j.narration journal_narration, j.journal_date FROM bank_statement_line sl
         LEFT JOIN journal_line jl ON jl.id = sl.journal_line_id LEFT JOIN journal j ON j.id = jl.journal_id WHERE sl.statement_id = $1 ORDER BY sl.line_no`, [id])).rows;
    const withCand = [];
    for (const l of lines) withCand.push({ ...l, candidates: l.journal_line_id ? [] : (await candidates(c, s.account_id, l.amount, ymd(l.line_date), Math.max(days, 15))).slice(0, 5) });
    // reconciliation statement at the statement end date
    const book = D((await c.query("SELECT coalesce(sum(jl.debit - jl.credit),0) v FROM journal_line jl JOIN journal j ON j.id = jl.journal_id WHERE jl.account_id = $1 AND j.journal_date <= $2", [s.account_id, s.date_to])).rows[0].v);
    const unpresented = (await c.query(
      `SELECT j.doc_no, j.journal_date, j.narration, jl.debit - jl.credit amt FROM journal_line jl JOIN journal j ON j.id = jl.journal_id
        WHERE jl.account_id = $1 AND j.journal_date <= $2 AND NOT EXISTS (SELECT 1 FROM bank_statement_line sl WHERE sl.journal_line_id = jl.id)
        ORDER BY j.journal_date`, [s.account_id, s.date_to])).rows;
    const unpresentedTotal = unpresented.reduce((t, u) => t.plus(u.amt), D(0));
    return { s, lines: withCand, book: book.toFixed(2), unpresented, expectedBank: book.minus(unpresentedTotal).toFixed(2) };
  });
}

export async function listStatements(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT s.*, ba.name bank_name, (SELECT count(*) FROM bank_statement_line l WHERE l.statement_id = s.id) n,
            (SELECT count(*) FROM bank_statement_line l WHERE l.statement_id = s.id AND l.journal_line_id IS NULL) unmatched
       FROM bank_statement s JOIN bank_account ba ON ba.id = s.bank_account_id ORDER BY s.imported_at DESC LIMIT 100`)).rows);
}

async function openLine(c: PoolClient, lineId: string) {
  const l = (await c.query("SELECT sl.*, s.status, s.bank_account_id, ba.account_id FROM bank_statement_line sl JOIN bank_statement s ON s.id = sl.statement_id JOIN bank_account ba ON ba.id = s.bank_account_id WHERE sl.id = $1 FOR UPDATE OF sl", [lineId])).rows[0];
  if (!l) throw notFound("Statement line");
  if (l.status === "finished") throw invalid("This statement is finished and locked.");
  return l;
}

export async function matchLine(ctx: Ctx, lineId: string, journalLineId: string) {
  assertCan(ctx, "accounting", "create");
  return withTx(ctx, async (c) => {
    const l = await openLine(c, lineId);
    if (l.journal_line_id) throw invalid("This line is already matched.");
    const jl = (await c.query("SELECT jl.*, jl.debit - jl.credit amt FROM journal_line jl WHERE jl.id = $1", [journalLineId])).rows[0];
    if (!jl || jl.account_id !== l.account_id) throw invalid("Choose a book entry on this bank account.");
    if (!D(jl.amt).eq(l.amount)) throw invalid(`The amounts differ (statement ${D(l.amount).toFixed(2)}, books ${D(jl.amt).toFixed(2)}). Post the difference first.`);
    if ((await c.query("SELECT 1 FROM bank_statement_line WHERE journal_line_id = $1", [journalLineId])).rowCount) throw conflict("That book entry is already matched to another statement line.");
    await c.query("UPDATE bank_statement_line SET journal_line_id = $2, match_kind = 'manual', matched_by = $3, matched_at = now() WHERE id = $1", [lineId, journalLineId, ctx.userId]);
  });
}
export async function unmatchLine(ctx: Ctx, lineId: string) {
  assertCan(ctx, "accounting", "create");
  return withTx(ctx, async (c) => {
    await openLine(c, lineId);
    await c.query("UPDATE bank_statement_line SET journal_line_id = NULL, match_kind = NULL, matched_by = NULL, matched_at = NULL WHERE id = $1", [lineId]);
  });
}

/** A line the books do not have yet (bank charges, interest, a direct debit): post it and match it in one step. */
export async function postFromStatementLine(ctx: Ctx, lineId: string, accountId: string, narration?: string) {
  const b = here(ctx);
  assertCan(ctx, "accounting", "create", b);
  return withTx(ctx, async (c) => {
    const l = await openLine(c, lineId);
    if (l.journal_line_id) throw invalid("This line is already matched.");
    const acc = (await c.query("SELECT * FROM account WHERE id = $1 AND active", [accountId])).rows[0];
    if (!acc || acc.id === l.account_id) throw invalid("Choose the account for the other side (for example bank charges).");
    if (acc.party_type) throw invalid("Customer and supplier money is posted through receipts and payments, not here.");
    const date = ymd(l.line_date);
    await assertOpenPeriod(c, date);
    const amt = D(l.amount);
    const jr = await postJournal(c, ctx, { branchId: b, date, sourceType: "bank_statement", sourceId: l.statement_id, narration: str(narration) || `Bank: ${l.description}`,
      lines: amt.gt(0) ? [{ accountId: l.account_id, debit: amt }, { accountId: acc.id, credit: amt }] : [{ accountId: acc.id, debit: amt.abs() }, { accountId: l.account_id, credit: amt.abs() }] });
    const jl = (await c.query("SELECT id FROM journal_line WHERE journal_id = $1 AND account_id = $2", [jr!.id, l.account_id])).rows[0];
    await c.query("UPDATE bank_statement_line SET journal_line_id = $2, match_kind = 'created', matched_by = $3, matched_at = now() WHERE id = $1", [lineId, jl.id, ctx.userId]);
  });
}

export async function finishStatement(ctx: Ctx, id: string) {
  assertCan(ctx, "accounting", "approve");
  return withTx(ctx, async (c) => {
    const s = (await c.query("SELECT * FROM bank_statement WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!s) throw notFound("Bank statement");
    if (s.status === "finished") throw invalid("Already finished.");
    const open = Number((await c.query("SELECT count(*) n FROM bank_statement_line WHERE statement_id = $1 AND journal_line_id IS NULL", [id])).rows[0].n);
    if (open) throw invalid(`${open} statement line${open === 1 ? " is" : "s are"} not matched yet.`);
    await c.query("UPDATE bank_statement SET status = 'finished', finished_by = $2, finished_at = now() WHERE id = $1", [id, ctx.userId]);
    await audit(c, ctx, "bank_statement", id, "finished", {}, null);
  });
}

/** Post-dated cheques falling due within the alert window (AC-05): received cheques to deposit and our cheques the bank will present. */
export async function chequesDue(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => {
    const days = Number(await getSetting(c, "accounting.payment_alert_days", null, 7));
    const received = (await c.query(
      `SELECT r.id, r.doc_no, r.cheque_no, r.cheque_bank, r.cheque_date, r.amount, b.code branch_code,
              CASE WHEN cu.customer_type = 'individual' THEN concat_ws(' ', cu.first_name, cu.last_name) ELSE cu.company_name END party
         FROM receipt r JOIN branch b ON b.id = r.branch_id JOIN customer cu ON cu.id = r.customer_id
        WHERE r.cheque_status = 'held' AND r.cheque_date <= current_date + $1::int ORDER BY r.cheque_date`, [days])).rows;
    const issued = (await c.query(
      `SELECT p.id, p.doc_no, p.cheque_no, p.cheque_date, p.amount, b.code branch_code, s.name_en party
         FROM supplier_payment p JOIN branch b ON b.id = p.branch_id JOIN supplier s ON s.id = p.supplier_id
        WHERE p.cheque_status = 'issued' AND p.cheque_date <= current_date + $1::int ORDER BY p.cheque_date`, [days])).rows;
    return { days, received, issued };
  });
}

/** Suppliers and customers for party pickers on vouchers and statements. */
export async function partyOptions(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => ({
    suppliers: (await c.query("SELECT id, code, name_en name FROM supplier WHERE active ORDER BY name_en")).rows,
    customers: (await c.query(
      `SELECT id, customer_no code, CASE WHEN customer_type = 'individual' THEN concat_ws(' ', first_name, last_name) ELSE company_name END name
         FROM customer WHERE active AND NOT is_walk_in ORDER BY customer_type = 'individual', 3 LIMIT 500`)).rows,
  }));
}

export { can, forbidden };
