import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sessionCtx } from "./services/auth";
import type { Ctx } from "./access";

export const COOKIE = "sf_session";

export async function requestMeta() {
  const h = await headers();
  // PEN-05: the first X-Forwarded-For entry is whatever the browser sent; the last one was added by our own proxy,
  // so it is the only part a caller cannot choose.
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const ip = (xff[xff.length - 1] || h.get("x-real-ip")?.trim() || "127.0.0.1").slice(0, 64);
  return { ip, device: (h.get("user-agent") || "").slice(0, 200) };
}

/** Current user context, re-read from the database on every request (no trust in the browser). */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return sessionCtx(token, await requestMeta());
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  // A bay tablet goes back to its names screen when the PIN session has locked.
  if (!ctx) redirect((await cookies()).get("sf_tablet")?.value ? "/tablet" : "/login");
  return ctx;
}
