import { getCtx } from "@/lib/session";
import { ftaAuditFile } from "@/lib/services/billing-more";
import { AppError } from "@/lib/errors";

/** VT-03: FTA audit file (FAF) for a period, as CSV. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  try {
    const csv = await ftaAuditFile(ctx, from, to);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="FAF_${from}_${to}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    throw e;
  }
}
