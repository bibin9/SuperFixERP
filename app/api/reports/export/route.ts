import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { exportRef } from "@/lib/services/report-saved";

/** Report export (RB-09): Excel or CSV, same filters, branch scope and hidden fields as the screen. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  const q: Record<string, string | string[]> = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) { const all = req.nextUrl.searchParams.getAll(k); q[k] = all.length > 1 ? all : all[0]; }
  const ref = String(q.ref ?? ""), format = q.format === "csv" ? "csv" : "xlsx";
  try {
    const f = await exportRef(ctx, ref, q, format);
    return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 400 });
    throw e;
  }
}
