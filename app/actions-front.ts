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
