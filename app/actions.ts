"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { COOKIE, requireCtx, requestMeta } from "@/lib/session";
import { login, logout, switchBranch, disableUser } from "@/lib/services/auth";
import { createCustomer, updateCustomer, createVehicle } from "@/lib/services/customers";
import { addJobLine, addEnquiryLine, removeLine, changeStatus, assignTechnician } from "@/lib/services/jobs";
import { createEnquiry, updateEnquiry, markEnquiryLost, createJobCard } from "@/lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff, submitPublicDecisions, type StaffChannel } from "@/lib/services/quotations";
import { act } from "@/lib/services/workflow";
import { receiveStock, issueToJobLine } from "@/lib/services/stock";
import { prepareMessage, confirmMessageSent } from "@/lib/services/messaging";
import * as admin from "@/lib/services/admin";
import { saveMaster, setMasterActive } from "@/lib/services/master-forms";

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
    (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.COOKIE_SECURE === "true" || (await headers()).get("x-forwarded-proto") === "https" });
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
  await run(String(fd.get("$back") || "/enquiries/new"), async () => {
    const r = await createEnquiry(ctx, obj(fd));
    return `/enquiries/${r.id}?ok=${encodeURIComponent(`Enquiry ${r.docNo} saved`)}`;
  });
}

export async function updateEnquiryAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  await run(`/enquiries/${id}`, () => updateEnquiry(ctx, id, obj(fd)), "Enquiry saved");
}

export async function lostEnquiryAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(String(fd.get("$back") || "/enquiries"), () => markEnquiryLost(ctx, String(fd.get("id")), String(fd.get("reason") || "")), "Marked lost");
}

// ---------- work lines and quotations (enquiry first, job card for extra work) ----------
export async function addLineAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const back = String(fd.get("$back"));
  await run(back, async () => {
    const r = f.owner_kind === "job" ? await addJobLine(ctx, f.owner_id, f) : await addEnquiryLine(ctx, f.owner_id, f);
    return withQ(back, "ok", r.belowMargin ? "Line added. Needs manager approval: price below allowed level" : "Line added");
  });
}

export async function removeLineAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(String(fd.get("$back")), () => removeLine(ctx, String(fd.get("line_id"))), "Line removed");
}

export async function saveQuotationAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = String(fd.get("$back"));
  await run(back, async () => {
    const r = await saveQuotation(ctx, String(fd.get("enquiry_id")), obj(fd));
    return withQ(back, "ok", r.status === "pending_internal_approval" ? `Quotation ${r.docNo} saved and sent for manager approval: ${r.reasons.join("; ")}` : `Quotation ${r.docNo} saved and ready to send`);
  });
}

/** Creates the customer approval link and prepares the WhatsApp text. Staff send it themselves. */
export async function sendQuotationAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = String(fd.get("$back"));
  const base = String(fd.get("$origin") || "http://localhost:3000");
  await run(back, async () => {
    const { token, enquiryId, jobId } = await sendQuotation(ctx, String(fd.get("quotation_id")));
    const msg = await prepareMessage(ctx, jobId ? { jobId } : { enquiryId }, "quotation_for_approval",
      { link: `${base}/q/${token}`, doc_no: String(fd.get("doc_no")), amount: String(fd.get("amount") || "") });
    return withQ(back, "msg", msg.id);
  });
}

export async function staffDecisionAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const decisions = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("d_")).map(([k, v]) => [k.slice(2), v as "approved" | "declined"]));
  await run(String(fd.get("$back")), async () => { await recordDecisionsByStaff(ctx, f.quotation_id, decisions, f.channel as StaffChannel, f.note || null); }, "Customer decision recorded");
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

// ---------- job cards (only from an approved quotation) ----------
export async function createJobAction(fd: FormData) {
  const ctx = await requireCtx();
  const enquiryId = String(fd.get("enquiry_id"));
  await run(`/enquiries/${enquiryId}`, async () => {
    const r = await createJobCard(ctx, enquiryId, obj(fd));
    return `/jobs/${r.id}?ok=${encodeURIComponent(`Job card ${r.docNo} created from the approved quotation${r.backOrdered ? ". A part is back-ordered" : ""}`)}`;
  });
}

export async function statusAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  await run(`/jobs/${f.job_id}`, () => changeStatus(ctx, f.job_id, f.to, f), "Status updated");
}

// ---------- manual messages ----------
export async function whatsappAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = String(fd.get("$back"));
  const jobId = optional(fd, "job_id");
  const enquiryId = optional(fd, "enquiry_id");
  await run(back, async () => {
    const msg = await prepareMessage(ctx, jobId ? { jobId } : { enquiryId: enquiryId! }, String(fd.get("event")));
    return withQ(back, "msg", msg.id);
  });
}

export async function confirmMessageAction(fd: FormData) {
  const ctx = await requireCtx();
  const u = new URL(String(fd.get("$back")), "http://local");
  u.searchParams.delete("msg"); u.searchParams.delete("ok"); u.searchParams.delete("err");
  const back = u.pathname + u.search;
  await run(back, () => confirmMessageSent(ctx, String(fd.get("id"))), "Message marked as sent");
}

const optional = (fd: FormData, k: string) => (fd.get(k) ? String(fd.get(k)) : null);

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
  await run(String(fd.get("$back") || `/jobs/${fd.get("job_id")}`), () => issueToJobLine(ctx, String(fd.get("line_id")), String(fd.get("qty"))), "Parts issued to the job");
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

// ---------- master forms ----------
export async function saveMasterAction(fd: FormData) {
  const ctx = await requireCtx();
  const key = String(fd.get("$master"));
  const editKey = fd.get("$key") ? String(fd.get("$key")) : null;
  const back = editKey ? `/admin/masters/${key}?edit=${encodeURIComponent(editKey)}` : `/admin/masters/${key}`;
  await run(back, async () => { await saveMaster(ctx, key, obj(fd), editKey); return `/admin/masters/${key}?ok=Saved`; });
}
export async function masterActiveAction(fd: FormData) {
  const ctx = await requireCtx();
  const key = String(fd.get("$master"));
  await run(`/admin/masters/${key}`, () => setMasterActive(ctx, key, String(fd.get("$key")), fd.get("active") === "true"), "Updated");
}
