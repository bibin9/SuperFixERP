"use server";
import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { obj, keyed, run, withQ } from "@/lib/action-run";
import * as bl from "@/lib/services/billing";
import * as bm from "@/lib/services/billing-more";
import { prepareMessage } from "@/lib/services/messaging";
import { notFound } from "@/lib/errors";

const back = (fd: FormData, fallback = "/") => String(fd.get("$back") || fallback);
const pay = (f: Record<string, string>): bl.PayIn => ({
  method: f.method, amount: f.amount, reference: f.reference, cheque_no: f.cheque_no, cheque_bank: f.cheque_bank, cheque_date: f.cheque_date || undefined, idempotency_key: f.idempotency_key,
});
const origin = async () => {
  const h = await headers();
  const host = (h.get("host") ?? "localhost:3000").replace(/[^a-zA-Z0-9.:-]/g, "");
  return `${h.get("x-forwarded-proto") === "https" ? "https" : "http"}://${host}`;
};

// ---------- invoices ----------
export async function postInvoiceAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  const billTo = String(fd.get("bill_to") || "customer") as bl.InvoiceOptions["billTo"];
  await run(`/jobs/${jobId}/invoice`, async () => {
    const r = await bl.postInvoice(ctx, jobId, String(fd.get("idempotency_key")), {
      lineIds: fd.getAll("line_id").map(String), billTo, fleetCustomerId: String(fd.get("fleet_customer_id") || "") || null,
      claimRef: String(fd.get("claim_ref") || "") || null, notes: String(fd.get("notes") || "") || null,
    });
    if (r.kind === "warranty") return `/jobs/${jobId}?ok=${encodeURIComponent(`Warranty claim ${r.docNo} recorded`)}`;
    return `/invoices/${r.id}?ok=${encodeURIComponent(`Invoice ${r.docNo} posted`)}`;
  });
}

export async function receiptAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run(`/invoices/${f.invoice_id}`, async () => {
    const r = await bl.recordReceipt(ctx, { ...pay(f), invoice_id: f.invoice_id });
    return `/invoices/${f.invoice_id}?ok=${encodeURIComponent(`Receipt ${r.docNo} posted${Number(r.onAccount) > 0 ? `; AED ${r.onAccount} kept on the customer's account` : ""}`)}`;
  });
}

export async function applyAdvanceAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("invoice_id"));
  await run(`/invoices/${id}`, () => bl.applyAdvance(ctx, id, String(fd.get("advance_id")), String(fd.get("amount") ?? "")), "Advance applied");
}

export async function invoiceWhatsappAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("invoice_id"));
  await run(`/invoices/${id}`, async () => {
    const { invoice: i } = await bl.getInvoice(ctx, id);
    if (!i.job_card_id) throw notFound("Job card for this invoice");
    const msg = await prepareMessage(ctx, { jobId: i.job_card_id }, "invoice", {
      doc_no: i.doc_no, amount: Number(i.grand_total).toFixed(2), open: Number(i.open_amount).toFixed(2), link: `${await origin()}/i/${i.share_token}`,
    });
    return withQ(`/invoices/${id}`, "msg", msg.id);
  });
}

// ---------- advances ----------
export async function advanceAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run(back(fd, "/billing/advances"), async () => {
    const r = await bl.recordAdvance(ctx, { ...pay(f), customer_id: f.customer_id, job_card_id: f.job_card_id || null });
    return withQ(back(fd, "/billing/advances"), "ok", `Advance ${r.docNo} received${Number(r.vat) > 0 ? ` (VAT AED ${r.vat} included)` : ""}`);
  });
}

export async function refundAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run(back(fd, "/billing/advances"), async () => {
    const r = await bl.refundAdvance(ctx, { advance_id: f.advance_id, amount: f.amount, method: f.method, reference: f.reference, reason: f.reason, idempotency_key: f.idempotency_key });
    return withQ(back(fd, "/billing/advances"), "ok", `Refund ${r.docNo} paid${Number(r.vat) > 0 ? ` (VAT AED ${r.vat} reversed)` : ""}`);
  });
}

// ---------- cheques ----------
export async function chequeAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("receipt_id"));
  const step = String(fd.get("step"));
  await run(back(fd, "/billing/cheques"), () => step === "clear" ? bl.clearCheque(ctx, id) : bl.bounceCheque(ctx, id, String(fd.get("note") ?? "")),
    step === "clear" ? "Cheque cleared into the bank" : "Cheque recorded as returned; the invoice is open again");
}

// ---------- credit notes ----------
export async function creditNoteAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("invoice_id"));
  const qty = keyed(fd, "qty"), amount = keyed(fd, "amount"), action = keyed(fd, "stock");
  await run(`/invoices/${id}/credit-note`, async () => {
    const lines = Object.keys({ ...qty, ...amount }).map((k) => ({ invoice_line_id: k, qty: qty[k], amount: amount[k], stock_action: action[k] }));
    const r = await bm.createCreditNote(ctx, id, { reason: String(fd.get("reason") ?? ""), note: String(fd.get("note") ?? ""), lines });
    return `/billing/credit-notes/${r.id}?ok=${encodeURIComponent(r.status === "posted" ? "Credit note posted" : "Credit note sent to the branch manager for approval")}`;
  });
}

// ---------- release ----------
export async function creditReleaseAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  await run(`/jobs/${jobId}`, () => bl.recordCreditRelease(ctx, jobId, String(fd.get("reason") ?? "")), "Car released on credit; it can be handed over now");
}

// ---------- cash closing ----------
export async function cashCloseAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run("/billing/cash", async () => {
    const r = await bm.submitCashClose(ctx, { opening_float: f.opening_float, handed_over: f.handed_over, card_batch_total: f.card_batch_total, note: f.note, counts: keyed(fd, "count") });
    return withQ("/billing/cash", "ok", Number(r.variance) === 0 ? "Cash closed and balanced" : `Cash closed, AED ${r.variance} difference sent to the manager`);
  });
}
export async function cashSignOffAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/billing/cash", () => bm.signOffCash(ctx, String(fd.get("id")), String(fd.get("note") ?? "")), "Cash signed off");
}

// ---------- counter sale ----------
export async function counterSaleAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const ids = fd.getAll("item_id").map(String), qtys = fd.getAll("qty").map(String), prices = fd.getAll("price").map(String), discs = fd.getAll("discount").map(String);
  const lines = ids.map((item_id, i) => ({ item_id, qty: qtys[i], price: prices[i], discount: discs[i] })).filter((l) => l.item_id);
  const backTo = `/billing/counter-sale${f.customer_id ? `?customer=${encodeURIComponent(f.customer_id)}` : ""}`;
  await run(backTo, async () => {
    const r = await bm.postCounterSale(ctx, {
      customer_id: f.customer_id || null, bill_to_name: f.bill_to_name, lines, idempotency_key: f.idempotency_key,
      payment: f.pay_now === "on" ? { ...pay(f), idempotency_key: f.idempotency_key } : null,
    });
    return `/invoices/${r.id}?ok=${encodeURIComponent(`Counter sale ${r.docNo} posted`)}`;
  });
}

