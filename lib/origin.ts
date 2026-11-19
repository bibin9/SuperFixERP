import "server-only";
import { headers } from "next/headers";

/**
 * This site's own address, for links sent to customers (quotation approval, feedback). Never taken from a form
 * (PEN-04): PUBLIC_URL when set, otherwise the host the request came in on.
 */
export async function siteOrigin(): Promise<string> {
  const env = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (env && /^https?:\/\/[^/\s]+$/.test(env)) return env;
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim() === "https" ? "https" : "http";
  return /^[A-Za-z0-9.-]+(:\d+)?$/.test(host) ? `${proto}://${host}` : "http://localhost:3000";
}
