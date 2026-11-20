"use server";
import { requireCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { quickSave, type QuickKind, type QuickResult } from "@/lib/services/quick-add";

const KINDS: QuickKind[] = ["customer", "vehicle", "items", "services", "suppliers"];

/** "+ New" from a picker: saves the record and returns it, so the picker selects it without leaving the page. */
export async function quickAddAction(kind: string, values: Record<string, string>): Promise<QuickResult> {
  const ctx = await requireCtx();
  if (!KINDS.includes(kind as QuickKind)) return { ok: false, err: "This list cannot be added to here." };
  const f = Object.fromEntries(Object.entries(values ?? {}).filter(([k, v]) => typeof k === "string" && typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, v.slice(0, 500)]));
  try {
    // No page refresh here: the popup the user is filling stays as it is, and the picker gets the new record.
    return await quickSave(ctx, kind as QuickKind, f);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, err: e.message, field: (e.details as { field?: string } | undefined)?.field };
    if (e instanceof Error && /must be|allows at most|cannot exceed|at least|at most|required|not valid|invalid/i.test(e.message)) return { ok: false, err: e.message };
    throw e;
  }
}
