import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sessionCtx } from "./services/auth";
import type { Ctx } from "./access";

export const COOKIE = "sf_session";

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1", device: (h.get("user-agent") || "").slice(0, 200) };
}

/** Current user context, re-read from the database on every request (no trust in the browser). */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return sessionCtx(token, await requestMeta());
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}
