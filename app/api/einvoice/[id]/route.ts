import { getCtx } from "@/lib/session";
import { einvoiceData } from "@/lib/services/billing-more";
import { AppError } from "@/lib/errors";

/** VT-02: the invoice as PINT AE shaped JSON, ready for an accredited service provider later. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const data = await einvoiceData(ctx, id);
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${String(data.ID).replace(/[^\w.-]/g, "_")}.json"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.code === "forbidden" ? "Not allowed" : "Not found", { status: e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
