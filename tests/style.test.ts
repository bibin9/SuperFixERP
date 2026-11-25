import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { getStyle, saveStyle, modeFrom, STYLE_DEFAULTS } from "../lib/services/style";

before(async () => { await resetTestDb(); });
after(async () => { await closePool(); });

const form = { brand_color: "#0F766E", menu_color: "#111827", link_color: "#0369a1", default_mode: "auto", text_size: "large", density: "compact", app_name: "Superfix", app_tagline: "Abu Dhabi" };

test("style: defaults, admin saves, others are refused, bad values rejected", async () => {
  assert.deepEqual(await getStyle(), STYLE_DEFAULTS);
  const priya = await ctxFor("priya", "YAS");
  await assert.rejects(saveStyle(priya, form), AppError);
  assert.equal((await getStyle()).brand_color, STYLE_DEFAULTS.brand_color, "refused save changed nothing");

  const admin = await ctxFor("admin", "YAS");
  await assert.rejects(saveStyle(admin, { ...form, brand_color: "red; background:url(x)" }), AppError);
  await assert.rejects(saveStyle(admin, { ...form, default_mode: "neon" }), AppError);
  await assert.rejects(saveStyle(admin, form, new File([new Uint8Array(10)], "x.svg", { type: "image/svg+xml" })), AppError);
  assert.equal((await getStyle()).brand_color, STYLE_DEFAULTS.brand_color);

  const png = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
  await saveStyle(admin, form, png);
  const s = await getStyle();
  assert.equal(s.brand_color, "#0f766e"); assert.equal(s.default_mode, "auto"); assert.equal(s.density, "compact"); assert.equal(s.app_name, "Superfix");
  assert.match(s.logo, /^data:image\/png;base64,/);
  const a = await adminQuery("SELECT count(*)::int n FROM audit_log WHERE entity = 'setting' AND entity_id = 'style'");
  assert.ok(a[0].n >= 1, "save is audited");

  await saveStyle(admin, { ...form, remove_logo: "on" });
  assert.equal((await getStyle()).logo, "");

  // A bad value written straight into the table never reaches the page.
  await adminQuery(`UPDATE setting SET value = '"</style><script>"' WHERE key = 'style.menu_color'`);
  assert.equal((await getStyle()).menu_color, STYLE_DEFAULTS.menu_color);

  assert.equal(modeFrom("dark", s), "dark"); assert.equal(modeFrom(undefined, s), "auto"); assert.equal(modeFrom("evil", s), "auto");
});
