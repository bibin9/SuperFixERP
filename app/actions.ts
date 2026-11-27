"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { safePath } from "@/lib/safe-path";
import { siteOrigin } from "@/lib/origin";
import { allow } from "@/lib/rate-limit";
import { COOKIE, requireCtx, requestMeta } from "@/lib/session";
import { login, logout, switchBranch, disableUser } from "@/lib/services/auth";
import { createCustomer, updateCustomer, createVehicle, addDriver, setDriverActive } from "@/lib/services/customers";
import { addJobLine, addEnquiryLine, removeLine, changeStatus, assignTechnician, setNewTime, saveCheckin, addCheckinPhoto } from "@/lib/services/jobs";
import { createEnquiry, updateEnquiry, markEnquiryLost, createJobCard } from "@/lib/services/enquiries";
import { saveQuotation, sendQuotation, recordDecisionsByStaff, submitPublicDecisions, type StaffChannel } from "@/lib/services/quotations";
import { act } from "@/lib/services/workflow";
import { receiveStock, issueToJobLine } from "@/lib/services/stock";
import { prepareMessage, confirmMessageSent } from "@/lib/services/messaging";
import { addBundle, saveBundle, addServices } from "@/lib/services/bundles";
import * as admin from "@/lib/services/admin";
import { saveStyle } from "@/lib/services/style";
import * as tablets from "@/lib/services/tablets";
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
  redirect(safePath(target));
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
  redirect(jar.get(tablets.TABLET_COOKIE)?.value ? "/tablet" : "/login");
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

export async function driverAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = String(fd.get("$back"));
  await run(back, async () => {
    if (fd.get("driver_id")) { await setDriverActive(ctx, String(fd.get("driver_id")), fd.get("active") === "1"); return withQ(back, "ok", fd.get("active") === "1" ? "Driver put back on the list" : "Driver taken off the list"); }
    await addDriver(ctx, String(fd.get("customer_id")), obj(fd));
    return withQ(back, "ok", "Driver added");
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

export async function addBundleAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const back = String(fd.get("$back"));
  await run(back, async () => {
    const r = await addBundle(ctx, { kind: f.owner_kind === "job" ? "job" : "enquiry", id: f.owner_id }, f.bundle_id, f);
    return withQ(back, "ok", `${r.name} added: ${r.count} lines${r.belowMargin ? ". Needs manager approval: price below allowed level" : ""}`);
  });
}

export async function addSuggestedAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = String(fd.get("$back"));
  await run(back, async () => {
    const n = await addServices(ctx, { kind: "enquiry", id: String(fd.get("enquiry_id")) }, fd.getAll("service_id").map(String));
    return withQ(back, "ok", `${n} suggested service${n === 1 ? "" : "s"} added`);
  });
}

export async function saveBundleAction(fd: FormData) {
  const ctx = await requireCtx();
  const f = obj(fd);
  const lines = fd.getAll("l_kind").map((k, i) => ({ kind: String(k), ref: String(fd.getAll("l_ref")[i] ?? ""), qty: String(fd.getAll("l_qty")[i] ?? "") }));
  await run("/admin/bundles" + (f.id ? `?id=${f.id}` : "?new=1"), async () => { await saveBundle(ctx, f, lines); return withQ("/admin/bundles", "ok", "Bundle saved"); });
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
  const base = await siteOrigin();
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
  let target = `/q/${encodeURIComponent(token)}?done=1`;
  if (!await allow("quote", (await requestMeta()).ip, 20, 60 * 60_000)) redirect(`/q/${encodeURIComponent(token)}?err=${encodeURIComponent("Too many tries. Please try again later.")}`);
  try { await submitPublicDecisions(token, decisions as Record<string, "approved" | "declined">); }
  catch (e) { if (e instanceof AppError) target = `/q/${encodeURIComponent(token)}?err=${encodeURIComponent(e.message)}`; else throw e; }
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

/** Late job: set the new promised time with a reason, then prepare the WhatsApp message to the customer. */
export async function newTimeAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = String(fd.get("$back"));
  const jobId = String(fd.get("job_id"));
  const f = obj(fd);
  await run(back, async () => {
    const r = await setNewTime(ctx, jobId, f);
    const msg = await prepareMessage(ctx, { jobId }, "new_time", { promised: r.label, reason: r.reason.toLowerCase() });
    return withQ(back, "msg", msg.id);
  });
}

export async function checkinAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  await run(`/jobs/${jobId}`, () => saveCheckin(ctx, jobId, obj(fd)), "Check-in saved");
}

export async function checkinPhotoAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  const f = fd.get("photo");
  const file = f instanceof File && f.size ? { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) } : undefined;
  await run(`/jobs/${jobId}`, async () => { await addCheckinPhoto(ctx, jobId, String(fd.get("label") || ""), file); }, "Photo added");
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
  await run(String(fd.get("$back") || `/jobs/${fd.get("job_id")}`), async () => {
    const r = await issueToJobLine(ctx, String(fd.get("line_id")), String(fd.get("qty")), String(fd.get("request_key") ?? ""));
    if (r.duplicate) return withQ(String(fd.get("$back") || `/jobs/${fd.get("job_id")}`), "ok", "Already issued: this was a repeat of the same request, nothing was issued twice");
  }, "Parts issued to the job");
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

// ---------- quick PIN on bay tablets ----------
const secureCookie = async () => process.env.COOKIE_SECURE === "true" || (await headers()).get("x-forwarded-proto") === "https";

/** A manager, signed in on the tablet itself, makes this browser a bay tablet; they are signed out. */
export async function tabletSetupAction(fd: FormData) {
  const ctx = await requireCtx();
  let token = "";
  let err = "";
  try { token = (await tablets.addTablet(ctx, String(fd.get("name") ?? ""))).token; }
  catch (e) { if (e instanceof AppError) err = e.message; else throw e; }
  if (err) redirect(withQ("/workshop/tablets", "err", err));
  const jar = await cookies();
  jar.set(tablets.TABLET_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 * 3, secure: await secureCookie() });
  await logout(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
  redirect("/tablet");
}

export async function removeTabletAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/workshop/tablets", () => tablets.removeTablet(ctx, String(fd.get("tablet_id"))), "Tablet removed. Its PIN sign-in no longer works.");
}

export async function clearPinAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/workshop/tablets", () => tablets.clearPin(ctx, String(fd.get("user_id"))), "PIN cleared. The technician sets a new one after signing in with the password.");
}

export async function setPinAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/my-jobs", () => tablets.setPin(ctx, String(fd.get("pin") ?? ""), String(fd.get("pin2") ?? "")), "PIN saved. Use it on the bay tablet.");
}

export async function pinLoginAction(fd: FormData) {
  const jar = await cookies();
  const userId = String(fd.get("user_id") ?? "");
  let err = "";
  try {
    const { token } = await tablets.pinLogin(jar.get(tablets.TABLET_COOKIE)?.value, userId, String(fd.get("pin") ?? ""), await requestMeta());
    jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: await secureCookie() });
  } catch (e) { if (e instanceof AppError) err = e.message; else throw e; }
  redirect(err ? `/tablet?u=${encodeURIComponent(userId)}&err=${encodeURIComponent(err.replace("user name or password", "PIN"))}` : "/my-jobs");
}

/** Lock: ends the PIN session and goes back to the names on the tablet. */
export async function tabletLockAction() {
  const jar = await cookies();
  await logout(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
  redirect("/tablet");
}

// ---------- look and night mode ----------
export async function saveStyleAction(fd: FormData) {
  const ctx = await requireCtx();
  const logo = fd.get("logo");
  const fields = Object.fromEntries([...fd.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string"));
  await run("/admin/style", () => saveStyle(ctx, fields, logo instanceof File ? logo : null), "Style saved. Everyone sees it on their next page.");
}
