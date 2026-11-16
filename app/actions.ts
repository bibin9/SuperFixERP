"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { COOKIE, requireCtx, requestMeta } from "@/lib/session";
import { login, logout, switchBranch, disableUser } from "@/lib/services/auth";
import { createCustomer, updateCustomer, createVehicle } from "@/lib/services/customers";
import { createEnquiry, markEnquiryLost, createJobCard, addJobLine, removeJobLine, changeStatus, assignTechnician } from "@/lib/services/jobs";
import { saveQuotation, sendQuotation, recordDecisionsByStaff, submitPublicDecisions } from "@/lib/services/quotations";
import { act } from "@/lib/services/workflow";
import { receiveStock, issueToJobLine } from "@/lib/services/stock";
import { postInvoice, recordReceipt } from "@/lib/services/billing";
import { whatsappForJob } from "@/lib/services/messaging";
import * as admin from "@/lib/services/admin";

const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
const withQ = (path: string, key: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;

/** Runs a mutation; business errors come back to the same page as a message, never as a crash. */
async function run(back: string, fn: () => Promise<string | void>, okMsg?: string): Promise<never> {
  let target: string;
  try {
    const r = await fn();
    target = typeof r === "string" ? r : okMsg ? withQ(back, "ok", okMsg) : back;
  } catch (e) {
    if (e instanceof AppError) target = withQ(back, "err", e.message);
    else if (e instanceof Error && /must be|allows at most|cannot exceed/.test(e.message)) target = withQ(back, "err", e.message);
    else throw e;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// ---------- session ----------
export async function loginAction(fd: FormData) {
  let ok = false;
  let msg = "";
  try {
    const { token } = await login(String(fd.get("username")), String(fd.get("password")), await requestMeta());
    (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    ok = true;
  } catch (e) {
    if (e instanceof AppError) msg = e.message; else throw e;
  }
  redirect(ok ? "/" : `/login?err=${encodeURIComponent(msg)}`);
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
  redirect("/login");
}

export async function switchBranchAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(String(fd.get("$back") || "/"), () => switchBranch(ctx, String(fd.get("branch_id"))));
}

// ---------- customers, vehicles, enquiries ----------
export async function saveCustomerAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const back = String(fd.get("$back"));
  await run(back, async () => {
    const r = f.id ? await updateCustomer(ctx, f.id, f) : await createCustomer(ctx, f);
    if (r.duplicates) return withQ(withQ(back, "dups", JSON.stringify(r.duplicates)), "form", JSON.stringify(f));
    return `/customers/${r.id}?ok=Saved`;
  });
}

export async function addVehicleAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const back = String(fd.get("$back"));
  await run(back, async () => {
    const r = await createVehicle(ctx, f);
    if (r.duplicates) return withQ(withQ(back, "vdups", JSON.stringify(r.duplicates)), "vform", JSON.stringify(f));
    return withQ(back, "ok", "Vehicle added");
  });
}

export async function createEnquiryAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/enquiries", async () => { const r = await createEnquiry(ctx, obj(fd)); return `/enquiries?ok=${encodeURIComponent(`Enquiry ${r.docNo} saved`)}`; });
}

export async function lostEnquiryAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/enquiries", () => markEnquiryLost(ctx, String(fd.get("id")), String(fd.get("reason") || "")), "Marked lost");
}

// ---------- job cards ----------
export async function createJobAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(String(fd.get("$back") || "/jobs/new"), async () => { const r = await createJobCard(ctx, obj(fd)); return `/jobs/${r.id}?ok=${encodeURIComponent(`Job card ${r.docNo} created`)}`; });
}

export async function addLineAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  await run(`/jobs/${jobId}`, async () => {
    const r = await addJobLine(ctx, jobId, obj(fd));
    return `/jobs/${jobId}?ok=${encodeURIComponent(r.belowMargin ? "Line added. Needs manager approval: price below allowed level" : "Line added")}`;
  });
}

export async function removeLineAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(`/jobs/${fd.get("job_id")}`, () => removeJobLine(ctx, String(fd.get("line_id"))), "Line removed");
}

export async function assignTechAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(`/jobs/${fd.get("job_id")}`, () => assignTechnician(ctx, String(fd.get("line_id")), String(fd.get("technician_id")) || null), "Technician assigned");
}

export async function statusAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run(`/jobs/${f.job_id}`, () => changeStatus(ctx, f.job_id, f.to, f), "Status updated");
}

export async function saveQuotationAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  await run(`/jobs/${jobId}`, async () => {
    const r = await saveQuotation(ctx, jobId, obj(fd));
    const msg = r.status === "pending_internal_approval" ? `Quotation ${r.docNo} saved and sent for manager approval: ${r.reasons.join("; ")}` : `Quotation ${r.docNo} saved and ready to send`;
    return `/jobs/${jobId}?ok=${encodeURIComponent(msg)}`;
  });
}

export async function sendQuotationAction(fd: FormData) {
  const ctx = await requireCtx();
  const qid = String(fd.get("quotation_id"));
  const jobId = String(fd.get("job_id"));
  const base = String(fd.get("$origin") || "http://localhost:3000");
  await run(`/jobs/${jobId}`, async () => {
    const { token } = await sendQuotation(ctx, qid);
    const link = `${base}/q/${token}`;
    const amount = String(fd.get("amount") || "");
    const wa = await whatsappForJob(ctx, jobId, "quotation_for_approval", { link, doc_no: String(fd.get("doc_no")), amount });
    return `/jobs/${jobId}?ok=${encodeURIComponent("Quotation sent. Open WhatsApp to deliver the link.")}&wa=${encodeURIComponent(wa.url)}`;
  });
}

export async function staffDecisionAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const decisions = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("d_")).map(([k, v]) => [k.slice(2), v as "approved" | "declined"]));
  await run(`/jobs/${f.job_id}`, async () => { await recordDecisionsByStaff(ctx, f.quotation_id, decisions, f.channel as "in_person", f.note || null); }, "Customer decision recorded");
}

export async function publicDecisionAction(fd: FormData) {
  const token = String(fd.get("token"));
  const decisions = Object.fromEntries(
    [...fd.entries()].filter(([k]) => k.startsWith("line_")).map(([k]) => [k.slice(5), "approved" as const]),
  );
  for (const k of String(fd.get("all_lines")).split(",")) if (!decisions[k]) (decisions as Record<string, string>)[k] = "declined";
  let target = `/q/${token}?done=1`;
  try { await submitPublicDecisions(token, decisions as Record<string, "approved" | "declined">); }
  catch (e) { if (e instanceof AppError) target = `/q/${token}?err=${encodeURIComponent(e.message)}`; else throw e; }
  redirect(target);
}

export async function whatsappAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  await run(`/jobs/${jobId}`, async () => {
    const wa = await whatsappForJob(ctx, jobId, String(fd.get("event")));
    return `/jobs/${jobId}?wa=${encodeURIComponent(wa.url)}`;
  });
}

// ---------- approvals ----------
export async function approvalAction(fd: FormData) {
  const ctx = await requireCtx();
  const action = String(fd.get("action")) as "approved" | "rejected" | "sent_back";
  await run("/approvals", async () => { await act(ctx, String(fd.get("task_id")), action, String(fd.get("comment") || "")); }, action === "approved" ? "Approved" : action === "rejected" ? "Rejected" : "Sent back");
}

// ---------- stock ----------
export async function receiveStockAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run("/stock", async () => { await receiveStock(ctx, { item_id: f.item_id, qty: f.qty, unit_cost: f.unit_cost, kind: f.kind as "receipt", ref: f.ref }); }, "Stock received");
}

export async function issueAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(`/jobs/${fd.get("job_id")}`, () => issueToJobLine(ctx, String(fd.get("line_id")), String(fd.get("qty"))), "Parts issued to the job");
}

// ---------- billing ----------
export async function postInvoiceAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  await run(`/jobs/${jobId}/invoice`, async () => {
    const r = await postInvoice(ctx, jobId, String(fd.get("idempotency_key")));
    return `/invoices/${r.id}?ok=${encodeURIComponent(`Tax invoice ${r.docNo} posted`)}`;
  });
}

export async function receiptAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run(`/invoices/${f.invoice_id}`, async () => {
    const r = await recordReceipt(ctx, { invoice_id: f.invoice_id, method: f.method, amount: f.amount, reference: f.reference, idempotency_key: f.idempotency_key });
    return `/invoices/${f.invoice_id}?ok=${encodeURIComponent(`Receipt ${r.docNo} posted${Number(r.onAccount) > 0 ? `; AED ${r.onAccount} kept on account` : ""}`)}`;
  });
}

// ---------- admin ----------
export async function saveBranchAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/branches", async () => { await admin.saveBranch(ctx, obj(fd)); }, "Branch saved");
}
export async function branchActiveAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/branches", () => admin.setBranchActive(ctx, String(fd.get("id")), fd.get("active") === "true"), "Branch updated");
}
export async function createUserAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/users", async () => { await admin.createUser(ctx, obj(fd)); }, "User created");
}
export async function userRoleAction(fd: FormData) {
  const ctx = await requireCtx();
  const b = String(fd.get("branch_id"));
  await run("/admin/users", () => admin.setUserBranchRole(ctx, String(fd.get("user_id")), b === "ALL" ? null : b, String(fd.get("role_id")) || null), "Access updated");
}
export async function disableUserAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/users", () => disableUser(ctx, String(fd.get("user_id"))), "User disabled; sessions ended and access removed at every branch");
}
export async function resetPasswordAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/users", () => admin.resetPassword(ctx, String(fd.get("user_id")), String(fd.get("password"))), "Password reset");
}
export async function createRoleAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/roles", async () => { const r = await admin.createRole(ctx, obj(fd)); return `/admin/roles?role=${r.id}&ok=Role%20created`; });
}
export async function saveMatrixAction(fd: FormData) {
  const ctx = await requireCtx();
  const roleId = String(fd.get("role_id"));
  const granted = [...fd.keys()].filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
  const fields = Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("f:")).map(([k, v]) => [k.slice(2), String(v)]));
  await run(`/admin/roles?role=${roleId}`, () => admin.saveRoleMatrix(ctx, roleId, granted, fields), "Permissions saved");
}
export async function seriesAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/numbering", () => admin.updateSeries(ctx, String(fd.get("branch_id")), String(fd.get("doc_type")), obj(fd)), "Series updated");
}
export async function settingAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/settings", () => admin.updateSetting(ctx, String(fd.get("id")), String(fd.get("value"))), "Setting saved");
}
export async function workflowToggleAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/workflows", () => admin.toggleWorkflow(ctx, String(fd.get("id")), fd.get("enabled") === "true"), "Workflow updated");
}
export async function stepAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/admin/workflows", () => admin.saveStepLimits(ctx, String(fd.get("id")), obj(fd)), "Step saved");
}
