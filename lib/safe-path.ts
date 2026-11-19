/**
 * Redirect targets that come from a form ($back) must stay on this site (PEN-01: open redirect). Only a path on
 * this site is kept: it starts with one "/", not "//" or "/\" (which browsers read as another site), and has no
 * control characters. Anything else goes to the home page.
 */
export function safePath(target: unknown, fallback = "/"): string {
  const t = typeof target === "string" ? target : "";
  if (!t.startsWith("/") || t.startsWith("//") || t.startsWith("/\\") || /[\u0000-\u001f\u007f]/.test(t)) return fallback;
  return t;
}
