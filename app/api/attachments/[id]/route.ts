import { getCtx } from "@/lib/session";
import { getAttachment } from "@/lib/services/purchasing";
import { AppError } from "@/lib/errors";

/** Serves an attachment to a signed-in user who can see its branch (row security applies). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const a = await getAttachment(ctx, id);
    return new Response(new Uint8Array(a.content), { headers: { "Content-Type": a.mime, "Content-Disposition": `inline; filename="${a.file_name.replace(/[^\w.-]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
