import { requireCtx } from "@/lib/session";
import { registerCsv } from "@/lib/services/payroll";
import { AppError } from "@/lib/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ month: string }> }) {
  const ctx = await requireCtx();
  const { month } = await params;
  try {
    const csv = await registerCsv(ctx, month);
    return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="payroll-register-${month}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    throw e;
  }
}
