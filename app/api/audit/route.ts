import { getCtx } from "@/lib/session";
import { auditCsv } from "@/lib/services/admin";
import { AppError } from "@/lib/errors";

/** Audit log export as CSV (FSD 3.12: export for the owner). Needs the Audit log export permission. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    const csv = await auditCsv(ctx, sp);
    return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-log.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    throw e;
  }
}
