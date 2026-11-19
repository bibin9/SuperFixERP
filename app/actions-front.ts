"use server";
import { requireCtx } from "@/lib/session";
import { obj, run, withQ } from "@/lib/action-run";
import { bookEnquiry, closeBooking } from "@/lib/services/bookings";
import { addRun, runStep } from "@/lib/services/runs";

const back = (fd: FormData, fallback = "/") => String(fd.get("$back") || fallback);

// ---------- bookings ----------
export async function bookAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  await run(back(fd, `/enquiries/${id}`), async () => {
    const r = await bookEnquiry(ctx, id, obj(fd));
    return withQ(back(fd, `/enquiries/${id}`), "ok", r.overbooked ? `Booked for ${r.hours} h on ${r.day}, over capacity. Your reason is kept.` : `Booked for ${r.hours} h on ${r.day}`);
  });
}
export async function closeBookingAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  const outcome = String(fd.get("outcome")) === "no_show" ? "no_show" : "cancelled";
  await run(back(fd, `/enquiries/${id}`), () => closeBooking(ctx, id, outcome, String(fd.get("reason") ?? "")), outcome === "no_show" ? "Marked as did not come" : "Booking cancelled");
}

// ---------- vehicle runs ----------
export async function addRunAction(fd: FormData) {
  const ctx = await requireCtx();
  await run(back(fd, "/workshop/runs"), async () => {
    const r = await addRun(ctx, obj(fd));
    return withQ(back(fd, "/workshop/runs"), "ok", `${r.docNo} scheduled${r.chargeAdded ? ". The charge is added to the work lines for the customer to approve." : ""}`);
  });
}
export async function runStepAction(fd: FormData) {
  const ctx = await requireCtx();
  const step = String(fd.get("step"));
  await run(back(fd, "/workshop/runs"), () => runStep(ctx, String(fd.get("id")), step, obj(fd)),
    step === "start" ? "Driver on the way" : step === "complete" ? "Run completed" : "Run cancelled");
}

// ---------- vehicle ----------
export async function serviceIntervalAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  const { setServiceInterval } = await import("@/lib/services/vehicle-view");
  await run(`/vehicles/${id}`, () => setServiceInterval(ctx, id, obj(fd)), "Service interval saved");
}

// ---------- customer feedback after delivery ----------
export async function askFeedbackAction(fd: FormData) {
  const ctx = await requireCtx();
  const jobId = String(fd.get("job_id"));
  const back = `/jobs/${jobId}`;
  await run(back, async () => {
    const { askFeedback } = await import("@/lib/services/feedback");
    const msg = await askFeedback(ctx, jobId, await (await import("@/lib/origin")).siteOrigin());
    return withQ(back, "msg", msg.id);
  });
}

export async function publicFeedbackAction(fd: FormData) {
  const { submitFeedback } = await import("@/lib/services/feedback");
  const { AppError } = await import("@/lib/errors");
  const { redirect } = await import("next/navigation");
  const token = String(fd.get("token"));
  let target = `/f/${encodeURIComponent(token)}`;
  const { allow } = await import("@/lib/rate-limit"); const { requestMeta } = await import("@/lib/session");
  if (!allow("feedback", (await requestMeta()).ip, 20, 60 * 60_000)) redirect(`${target}?err=${encodeURIComponent("Too many tries. Please try again later.")}`);
  try { await submitFeedback(token, fd.get("rating"), fd.get("comment")); }
  catch (e) { if (e instanceof AppError) target = `/f/${encodeURIComponent(token)}?err=${encodeURIComponent(e.message)}`; else throw e; }
  redirect(target);
}

export async function followUpFeedbackAction(fd: FormData) {
  const ctx = await requireCtx();
  const { followUpFeedback } = await import("@/lib/services/feedback");
  await run("/feedback?show=low", () => followUpFeedback(ctx, String(fd.get("id")), fd.get("note")), "Follow-up saved");
}

// ---------- after-hours key drop ----------
/** The customer's phone form. Returns the result to the page, so nothing they typed is lost on a mistake. */
export async function keyDropSubmitAction(fd: FormData): Promise<{ ok?: { docNo: string; name: string; branch: string }; err?: string; field?: string }> {
  const { submitKeyDrop } = await import("@/lib/services/keydrop");
  const { AppError } = await import("@/lib/errors");
  const photos = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const { allow } = await import("@/lib/rate-limit"); const { requestMeta } = await import("@/lib/session");
  if (!allow("keydrop", (await requestMeta()).ip, 6, 60 * 60_000)) return { err: "Too many key drops from this phone in the last hour. Please call the branch." };
  if (photos.length > 6) return { err: "Attach up to 6 photos.", field: "photos" };
  try {
    const files = await Promise.all(photos.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
    const f = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));
    return { ok: await submitKeyDrop(String(fd.get("code") ?? ""), f, files) };
  } catch (e) {
    if (e instanceof AppError) return { err: e.message, field: (e.details as { field?: string } | undefined)?.field };
    throw e;
  }
}

export async function completeKeyDropAction(fd: FormData) {
  const ctx = await requireCtx();
  const { completeKeyDrop } = await import("@/lib/services/keydrop");
  const id = String(fd.get("id"));
  await run(`/workshop/keys/${id}`, async () => {
    const e = await completeKeyDrop(ctx, id, { customer_id: String(fd.get("customer_id") ?? ""), vehicle_id: String(fd.get("vehicle_id") ?? "") });
    return withQ(`/enquiries/${e.id}`, "ok", `Checked in from the key drop. Enquiry ${e.docNo} started: add the work and send the quotation.`);
  });
}

export async function cancelKeyDropAction(fd: FormData) {
  const ctx = await requireCtx();
  const { cancelKeyDrop } = await import("@/lib/services/keydrop");
  await run("/workshop/keys", () => cancelKeyDrop(ctx, String(fd.get("id")), String(fd.get("reason") ?? "")), "Key drop cancelled");
}

export async function newKeydropCodeAction() {
  const ctx = await requireCtx();
  const { newKeydropCode } = await import("@/lib/services/keydrop");
  await run("/workshop/keys", () => newKeydropCode(ctx), "New QR code made. Print it and replace the one on the key box.");
}
