import { requireCtx } from "@/lib/session";
import { wpsFile } from "@/lib/services/payroll";
import { AppError } from "@/lib/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  try {
    const f = await wpsFile(ctx, id);
    return new Response(f.content, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${f.file_name}"` } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
