"use server";
import { requireCtx } from "@/lib/session";
import { run, withQ } from "@/lib/action-run";
import { prepareServiceReminder } from "@/lib/services/reports";
import * as saved from "@/lib/services/report-saved";
import { runArchive } from "@/lib/services/archive";
import { specFromForm } from "@/lib/report-spec";

/** Server actions for Phase 6: reports, the builder, sharing, pinning, schedules and the archive. */

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const back = (fd: FormData, fallback: string) => s(fd, "$back") || fallback;
const strip = (u: string) => { const x = new URL(u, "http://local"); for (const k of ["ok", "err", "errf", "msg"]) x.searchParams.delete(k); return x.pathname + x.search; };

export async function serviceReminderAction(fd: FormData) {
  const ctx = await requireCtx();
  const to = strip(back(fd, "/reports/run/next_service"));
  await run(to, async () => { const m = await prepareServiceReminder(ctx, s(fd, "job_id")); return withQ(to, "msg", m.id); });
}

/** Filters of the run being copied, kept as the copy's defaults. */
const params = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => k.startsWith("d_") && typeof v === "string" && v).map(([k, v]) => [k.slice(2), String(v)]));

export async function saveCopyAction(fd: FormData) {
  const ctx = await requireCtx();
  const to = strip(back(fd, "/reports"));
  const keys = fd.getAll("col_key").map(String), labels = fd.getAll("col_label").map(String), order = fd.getAll("col_order").map(String), keep = new Set(fd.getAll("col_keep").map(String));
  const columns = keys.map((key, i) => ({ key, label: labels[i] ?? "", o: order[i] !== undefined && order[i].trim() !== "" && Number.isFinite(Number(order[i])) ? Number(order[i]) : i + 1, i })).filter((c) => keep.has(c.key)).sort((a, b) => a.o - b.o || a.i - b.i).map(({ key, label }) => ({ key, label }));
  await run(to, async () => {
    const r = await saved.saveCopy(ctx, { id: s(fd, "id") || undefined, base_code: s(fd, "base_code"), name: s(fd, "name"), columns, params: params(fd) });
    return withQ(`/reports/saved/${r.id}`, "ok", "Report saved");
  });
}

export async function saveBuilderAction(fd: FormData) {
  const ctx = await requireCtx();
  const q = new URLSearchParams();
  for (const [k, v] of fd.entries()) if (!k.startsWith("$") && typeof v === "string") q.append(k, v);
  const to = `/reports/builder?${q.toString()}`;
  await run(to, async () => {
    const r = await saved.saveBuilder(ctx, { id: s(fd, "id") || undefined, name: s(fd, "name"), source: s(fd, "source"), spec: specFromForm((k) => fd.get(k)?.toString() ?? null) });
    return withQ(`/reports/saved/${r.id}`, "ok", "Report saved");
  });
}

export async function shareReportAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "id");
  await run(`/reports/saved/${id}`, () => saved.setShares(ctx, id, { roles: fd.getAll("roles").map(String), users: fd.getAll("users").map(String), in_menu: s(fd, "in_menu") === "1" }), "Sharing saved");
}

export async function deleteReportAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, "id");
  await run(`/reports/saved/${id}`, async () => { await saved.deleteSaved(ctx, id); return withQ("/reports/all", "ok", "Report deleted"); });
}

export async function pinReportAction(fd: FormData) {
  const ctx = await requireCtx();
  const to = strip(back(fd, "/reports"));
  await run(to, () => saved.pinReport(ctx, s(fd, "ref"), s(fd, "title"), s(fd, "chart")), "Pinned to your reports dashboard");
}
export async function unpinReportAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/reports", () => saved.unpinReport(ctx, s(fd, "id")), "Removed from your dashboard");
}

export async function scheduleReportAction(fd: FormData) {
  const ctx = await requireCtx();
  const to = strip(back(fd, "/reports"));
  await run(to, async () => {
    const r = await saved.addSchedule(ctx, { ref: s(fd, "ref"), frequency: s(fd, "frequency"), params: params(fd) });
    return withQ(to, "ok", `Scheduled. The first file will be in your report inbox on ${r.next_due.split("-").reverse().join("/")}.`);
  });
}
export async function stopScheduleAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/reports/inbox", () => saved.stopSchedule(ctx, s(fd, "id")), "Schedule stopped");
}
export async function prepareNowAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/reports/inbox", async () => { const n = await saved.prepareDue(ctx, s(fd, "id")); return withQ("/reports/inbox", "ok", `${n} report file(s) prepared`); });
}

export async function runArchiveAction(fd: FormData) {
  const ctx = await requireCtx();
  await run("/reports/archive", async () => {
    const r = await runArchive(ctx, s(fd, "note"));
    return withQ("/reports/archive", "ok", `Archive run ${r.run_no} done: ${r.total} records before ${r.cutoff.split("-").reverse().join("/")} are now archived and read only.`);
  });
}
