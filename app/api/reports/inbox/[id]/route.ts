import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { inboxFile } from "@/lib/services/report-saved";

/** Download a prepared report from the user's own inbox. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  try {
    const f = await inboxFile(ctx, (await params).id);
    return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.code === "not_found" ? 404 : 403 });
    throw e;
  }
}
