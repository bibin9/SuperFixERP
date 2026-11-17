import { getCtx } from "@/lib/session";
import { loadFor } from "@/lib/services/bookings";
import { AppError } from "@/lib/errors";

/** Bay and technician load for one day, for the booking form (hours only, no customer details). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: "Sign in first" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const load = await loadFor(ctx, sp.get("date") ?? "", sp.get("exclude") || null, sp.get("branch") || null);
    return Response.json(load, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.code === "forbidden" ? 403 : 400 });
    throw e;
  }
}
