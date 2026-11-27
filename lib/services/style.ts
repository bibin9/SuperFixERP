import { cache } from "react";
import { Ctx, assertCan } from "../access";
import { withAnonTx, withTx } from "../db";
import { invalid } from "../errors";
import { audit } from "./audit";
import { str } from "../validate";

/**
 * Night mode and the company's own look. The admin sets the colours, logo, text size and spacing on
 * the Style page; each user chooses light, dark or automatic for their own device (a cookie), starting
 * from the company default. Printed documents always print in their normal light colours.
 */
export type Mode = "light" | "dark" | "auto";
export type Style = {
  brand_color: string; menu_color: string; link_color: string; default_mode: Mode;
  text_size: "small" | "normal" | "large"; density: "comfortable" | "compact";
  app_name: string; app_tagline: string; logo: string;
};
export const STYLE_DEFAULTS: Style = {
  brand_color: "#EC3542", menu_color: "#0d1b2e", link_color: "#1f4fbf", default_mode: "light",
  text_size: "normal", density: "comfortable", app_name: "AUTOVIQO", app_tagline: "for Superfix Auto Centers", logo: "",
};
const KEYS = Object.keys(STYLE_DEFAULTS) as (keyof Style)[];
const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO = 300_000;

function clean(raw: Record<string, unknown>): Style {
  const s = { ...STYLE_DEFAULTS };
  for (const k of KEYS) if (typeof raw[k] === "string") (s as Record<string, string>)[k] = raw[k] as string;
  if (!HEX.test(s.brand_color)) s.brand_color = STYLE_DEFAULTS.brand_color;
  if (!HEX.test(s.menu_color)) s.menu_color = STYLE_DEFAULTS.menu_color;
  if (!HEX.test(s.link_color)) s.link_color = STYLE_DEFAULTS.link_color;
  if (!["light", "dark", "auto"].includes(s.default_mode)) s.default_mode = "light";
  if (!["small", "normal", "large"].includes(s.text_size)) s.text_size = "normal";
  if (!["comfortable", "compact"].includes(s.density)) s.density = "comfortable";
  if (s.logo && !LOGO.test(s.logo)) s.logo = "";
  return s;
}

/** Read on every page (no user needed: it is also used on the sign-in page). Read once per request (PERF-01). */
export const getStyle = cache(readStyle);
async function readStyle(): Promise<Style> {
  try {
    return await withAnonTx(async (c) => {
      const rows = (await c.query("SELECT key, value FROM setting WHERE branch_id IS NULL AND key LIKE 'style.%'")).rows;
      return clean(Object.fromEntries(rows.map((r) => [String(r.key).slice(6), r.value])));
    });
  } catch {
    return STYLE_DEFAULTS;
  }
}

/** Admin: saves the company style. A logo comes in as a picture file; "remove_logo" clears it. */
export async function saveStyle(ctx: Ctx, f: Record<string, unknown>, logoFile?: File | null) {
  assertCan(ctx, "settings", "edit");
  const next: Record<string, string> = {};
  for (const k of ["brand_color", "menu_color", "link_color"] as const) {
    const v = str(f[k]);
    if (!HEX.test(v)) throw invalid("Choose a colour.", { field: k });
    next[k] = v.toLowerCase();
  }
  const pick = (k: keyof Style, allowed: string[]) => {
    const v = str(f[k]);
    if (!allowed.includes(v)) throw invalid("Choose one of the options.", { field: k });
    next[k] = v;
  };
  pick("default_mode", ["light", "dark", "auto"]);
  pick("text_size", ["small", "normal", "large"]);
  pick("density", ["comfortable", "compact"]);
  const name = str(f.app_name), tag = str(f.app_tagline);
  if (!name) throw invalid("Type the name shown in the menu.", { field: "app_name" });
  if (name.length > 30 || tag.length > 60) throw invalid("The name can be 30 characters and the line under it 60.", { field: "app_name" });
  next.app_name = name; next.app_tagline = tag;
  if (logoFile && logoFile.size > 0) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(logoFile.type)) throw invalid("The logo must be a PNG, JPG or WEBP picture.", { field: "logo" });
    if (logoFile.size > MAX_LOGO) throw invalid("The logo can be at most 300 KB. Make the picture smaller first.", { field: "logo" });
    next.logo = `data:${logoFile.type};base64,${Buffer.from(await logoFile.arrayBuffer()).toString("base64")}`;
  } else if (str(f.remove_logo) === "on") next.logo = "";
  return withTx(ctx, async (c) => {
    const before = await getStyleIn(c);
    for (const [k, v] of Object.entries(next)) {
      await c.query(
        `INSERT INTO setting (key, value, grp, updated_by) VALUES ($1, $2, 'Style', $3)
         ON CONFLICT (key, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [`style.${k}`, JSON.stringify(v), ctx.userId]);
    }
    const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => (before as Record<string, string>)[k] !== v).map(([k, v]) => [k, k === "logo" ? { new: v ? "picture" : "none" } : { old: (before as Record<string, string>)[k], new: v }]));
    await audit(c, ctx, "setting", "style", "update", changes, null);
  });
}

async function getStyleIn(c: import("pg").PoolClient) {
  const rows = (await c.query("SELECT key, value FROM setting WHERE branch_id IS NULL AND key LIKE 'style.%'")).rows;
  return clean(Object.fromEntries(rows.map((r) => [String(r.key).slice(6), r.value])));
}

export const modeFrom = (cookie: string | undefined, s: Style): Mode => (cookie === "light" || cookie === "dark" || cookie === "auto" ? cookie : s.default_mode);
