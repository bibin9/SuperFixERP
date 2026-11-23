"use server";
import { requireCtx } from "@/lib/session";
import { obj, keyed, run } from "@/lib/action-run";
import * as so from "@/lib/services/stock-ops";
import * as pu from "@/lib/services/purchasing";
import * as ws from "@/lib/services/workshop";

const back = (fd: FormData, fallback = "/") => String(fd.get("$back") || fallback);
const lines = (fd: FormData, fields: string[]) => {
  const cols = fields.map((f) => fd.getAll(f).map(String));
  return cols[0].map((_, i) => Object.fromEntries(fields.map((f, k) => [f, cols[k][i]])));
};

// ---------- transfers ----------
export async function requestTransferAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/stock/transfers"), async () => {
    const t = await so.requestTransfer(ctx, { from_branch_id: String(fd.get("from_branch_id")), note: String(fd.get("note") ?? ""), lines: lines(fd, ["item_id", "qty"]) as { item_id: string; qty: string }[] });
    return `/stock/transfers/${t.id}?ok=${encodeURIComponent(`${t.docNo} ${t.status === "approved" ? "approved" : "sent to the supplying branch for approval"}`)}`;
  });
}
export async function transferStepAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  const step = String(fd.get("step"));
  await run(`/stock/transfers/${id}`, async () => {
    if (step === "dispatch") await so.dispatchTransfer(ctx, id);
    else if (step === "receive") await so.receiveTransfer(ctx, id, keyed(fd, "recv"), keyed(fd, "why"));
    else if (step === "cancel") await so.cancelTransfer(ctx, id, String(fd.get("reason") ?? ""));
  }, step === "dispatch" ? "Dispatched" : step === "receive" ? "Received into stock" : "Cancelled");
}
export async function requestFromBranchAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/planning", async () => {
    const t = await so.requestFromBranch(ctx, String(fd.get("commitment_id")), String(fd.get("from_branch_id")));
    return `/stock/planning?ok=${encodeURIComponent(`Transfer ${t.docNo} requested`)}`;
  });
}
export async function raisePoAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/planning", async () => {
    const po = await pu.raisePoForBackOrder(ctx, String(fd.get("commitment_id")), String(fd.get("supplier_id") || "") || undefined);
    return `/purchasing/${po.id}?ok=${encodeURIComponent(`Draft ${po.docNo} created. Check the price and submit it.`)}`;
  });
}
export async function expectedDateAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/planning", () => so.setExpectedDate(ctx, String(fd.get("commitment_id")), String(fd.get("expected_date"))), "Expected date saved");
}
export async function partRequestCloseAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/stock/queue"), () => so.closePartRequest(ctx, String(fd.get("id")), String(fd.get("status")) === "issued" ? "issued" : "cancelled"), "Updated");
}

// ---------- adjustments and counts ----------
export async function adjustmentAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/adjustments", async () => {
    const a = await so.createAdjustment(ctx, { reason: String(fd.get("reason")), note: String(fd.get("note") ?? ""), lines: lines(fd, ["item_id", "qty_change"]) as { item_id: string; qty_change: string }[] });
    return `/stock/adjustments?ok=${encodeURIComponent(a.status === "approved" ? `${a.docNo} posted` : `${a.docNo} sent to the branch manager for approval`)}`;
  });
}
export async function startCountAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/adjustments", async () => { const c = await so.startCount(ctx, String(fd.get("category") ?? "")); return `/stock/counts/${c.id}`; });
}
export async function countAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  const submit = fd.get("submit") === "1";
  await run(`/stock/counts/${id}`, async () => {
    const r = await so.saveCountLines(ctx, id, keyed(fd, "qty"), submit);
    if (!submit) return `/stock/counts/${id}?ok=Saved`;
    return `/stock/counts/${id}?ok=${encodeURIComponent(r.status === "no_difference" ? "Submitted: no differences" : `Submitted: differences sent for approval as ${r.adjustment}`)}`;
  });
}

// ---------- purchasing ----------
export async function createPoAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/purchasing", async () => { const po = await pu.createPo(ctx, obj(fd)); return `/purchasing/${po.id}`; });
}
export async function poLineAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("po_id"));
  await run(`/purchasing/${id}`, async () => {
    if (fd.get("remove")) await pu.removePoLine(ctx, String(fd.get("remove")));
    else await pu.addPoLine(ctx, id, obj(fd));
  });
}
export async function poStepAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("po_id"));
  const step = String(fd.get("step"));
  await run(`/purchasing/${id}`, async () => {
    if (step === "submit") { const s = await pu.submitPo(ctx, id); return `/purchasing/${id}?ok=${s === "approved" ? "Approved (within the limit that needs no approval)" : "Sent for approval"}`; }
    if (step === "cancel") await pu.cancelPo(ctx, id);
    if (step === "return") { const r = await pu.returnToSupplier(ctx, String(fd.get("grn_id")), { reason: String(fd.get("reason") ?? ""), note: String(fd.get("note") ?? ""), qty: keyed(fd, "rq") }); return `/purchasing/${id}?ok=${encodeURIComponent(`${r.docNo}: parts returned to the supplier`)}`; }
    if (step === "receive") { const g = await pu.receiveGoods(ctx, id, { delivery_note: String(fd.get("delivery_note") ?? ""), qty: keyed(fd, "qty"), damaged: keyed(fd, "damaged") }); return `/purchasing/${id}?ok=${encodeURIComponent(`${g.docNo} received into stock`)}`; }
  }, step === "cancel" ? "Cancelled" : undefined);
}
export async function billAction(fd: FormData) {
  const ctx = await requireCtx();
  const sup = String(fd.get("supplier_id"));
  await run(`/purchasing/bills/new?supplier_id=${sup}`, async () => {
    const recv = keyed(fd, "bq");
    const price = keyed(fd, "bp");
    const ls: { grn_line_id?: string; description?: string; expense_type?: string; qty: string; unit_price: string; vat_code?: string }[] =
      Object.keys(recv).filter((k) => recv[k]).map((k) => ({ grn_line_id: k, qty: recv[k], unit_price: price[k] }));
    for (const x of lines(fd, ["x_description", "x_expense_type", "x_qty", "x_unit_price", "x_vat_code"])) {
      if (x.x_description) ls.push({ description: x.x_description, expense_type: x.x_expense_type, qty: x.x_qty || "1", unit_price: x.x_unit_price, vat_code: x.x_vat_code });
    }
    const b = await pu.createBill(ctx, { supplier_id: sup, supplier_invoice_no: String(fd.get("supplier_invoice_no")), invoice_date: String(fd.get("invoice_date")), lines: ls });
    return `/purchasing/bills/${b.id}?ok=${encodeURIComponent(b.match === "mismatch" ? `${b.docNo} does not match the order or receipt; sent to the accountant` : `${b.docNo} posted`)}`;
  });
}
export async function pettyCashAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/purchasing/petty-cash", async () => {
    if (fd.get("kind") === "top_up") { await pu.pettyCashTopUp(ctx, fd.get("amount"), fd.get("note")); return "/purchasing/petty-cash?ok=Topped%20up"; }
    const f = fd.get("photo");
    const photo = f instanceof File && f.size ? { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) } : null;
    const r = await pu.pettyCashSpend(ctx, obj(fd), photo);
    return `/purchasing/petty-cash?ok=${encodeURIComponent(`${r.docNo} recorded`)}`;
  });
}

export async function directPurchaseAction(fd: FormData) {
  const ctx = await requireCtx();
  const job = String(fd.get("job_id") || "");
  await run(`/purchasing/direct${job ? `?job=${job}` : ""}`, async () => {
    const f = fd.get("photo");
    const photo = f instanceof File && f.size ? { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) } : null;
    const r = await pu.directPurchase(ctx, obj(fd), photo);
    return `/purchasing/direct?ok=${encodeURIComponent(`${r.docNo} recorded on job ${r.job}`)}`;
  });
}

export async function reorderPoAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/reorder", async () => {
    const po = await pu.raiseReorderPo(ctx, String(fd.get("item_id")), fd.get("qty"), String(fd.get("supplier_id") || "") || undefined);
    return `/purchasing/${po.id}?ok=${encodeURIComponent(`${po.docNo} created as a draft. Check the price and submit it.`)}`;
  });
}

export async function reorderTransferAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/reorder", async () => {
    const t = await so.requestTransfer(ctx, { from_branch_id: String(fd.get("from_branch_id")), note: "Reorder: stock at or below the reorder level", lines: [{ item_id: String(fd.get("item_id")), qty: fd.get("qty") }] });
    return `/stock/reorder?ok=${encodeURIComponent(`Transfer ${t.docNo} requested`)}`;
  });
}

export async function reorderLevelAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/stock/reorder?all=1", () => so.setReorder(ctx, String(fd.get("item_id")), fd.get("reorder_level"), fd.get("reorder_qty")), "Reorder level saved");
}

// ---------- workshop ----------
export async function assignAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd), () => ws.setAssignments(ctx, String(fd.get("line_id")), fd.getAll("technician_id").map(String), String(fd.get("bay_id") || "") || null), "Assigned");
}
export async function clockAction(fd: FormData) {
  const ctx = await requireCtx();
  const kind = String(fd.get("kind")) as "clock_in" | "pause" | "resume" | "clock_out";
  await run(back(fd, "/my-jobs"), async () => {
    await ws.clock(ctx, String(fd.get("line_id")), kind, { reason: String(fd.get("reason") ?? ""), confirmSwitch: fd.get("confirm") === "1", device: "web" });
  }, { clock_in: "Clocked in", resume: "Resumed", pause: "Paused", clock_out: "Clocked out" }[kind]);
}
export async function correctClockAction(fd: FormData) {
  const ctx = await requireCtx();
  const at = String(fd.get("at"));
  await run(back(fd), () => ws.correctEvent(ctx, String(fd.get("event_id")), at.length === 16 ? `${at}:00+04:00` : at, String(fd.get("reason") ?? "")), "Clock event corrected");
}
export async function partRequestAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd), async () => {
    const s = await ws.requestPart(ctx, String(fd.get("job_id")), obj(fd));
    return `${back(fd)}${back(fd).includes("?") ? "&" : "?"}ok=${encodeURIComponent(s === "open" ? "Sent to the store" : "Part request saved. This part is not in the approved work yet, so the store will wait: add it under Job lines with + Add part so the customer can approve it")}`;
  });
}
export async function qcAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("job_id"));
  await run(`/jobs/${id}`, async () => {
    const pass = await ws.recordQc(ctx, id, keyed(fd, "qc"), keyed(fd, "qcnote"), String(fd.get("note") ?? ""));
    return `/jobs/${id}?ok=${pass ? "Quality check passed: the car is Ready" : "Quality check failed: sent back to the technician"}`;
  });
}
export async function deliverAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("job_id"));
  await run(`/jobs/${id}`, () => ws.deliver(ctx, id, obj(fd)), "Delivered to the customer");
}
export async function newBoardLinkAction() {
  const ctx = await requireCtx();
  await run("/workshop", () => ws.newBoardLink(ctx), "New wall-screen link made; the old one no longer works");
}
