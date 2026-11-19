import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Ctx, assertCan } from "../access";
import { withTx, withAnonTx, withBranchSystemTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { login } from "./auth";
import { str } from "../validate";

/**
 * Quick PIN sign-in on shared bay tablets. A manager registers the tablet (it keeps a long secret in a
 * cookie); technicians of that branch tap their name and type their PIN. The PIN works on a registered
 * tablet only, the session opens only the technician screens and locks after a short idle time.
 */
const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const TABLET_COOKIE = "sf_tablet";

export async function listTablets(ctx: Ctx) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "workshop", "edit", b);
  return withTx(ctx, async (c) => ({
    tablets: (await c.query(
      `SELECT t.id, t.name, t.active, to_char(t.created_at, 'DD Mon YYYY') added, to_char(t.last_used_at AT TIME ZONE 'Asia/Dubai', 'DD Mon HH24:MI') last_used, u.full_name added_by
         FROM bay_tablet t LEFT JOIN app_user u ON u.id = t.created_by WHERE t.branch_id = $1 ORDER BY t.active DESC, t.name`, [b])).rows,
    techs: (await c.query(
      `SELECT u.id, u.full_name, u.pin_hash IS NOT NULL has_pin FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id JOIN app_user u ON u.id = ubr.user_id
        WHERE ubr.branch_id = $1 AND r.code = 'technician' AND u.status = 'active' ORDER BY u.full_name`, [b])).rows,
  }));
}

/** Registers a tablet and returns its one-time set-up secret (shown once, never stored in clear). */
export async function addTablet(ctx: Ctx, name: string) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "workshop", "edit", b);
  const n = str(name);
  if (!n) throw invalid("Tablet name is required.", { field: "name" });
  if (n.length > 60) throw invalid("Tablet name is too long.", { field: "name" });
  const token = crypto.randomBytes(32).toString("base64url");
  return withTx(ctx, async (c) => {
    const id = (await c.query("INSERT INTO bay_tablet (branch_id, name, token_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [b, n, hash(token), ctx.userId])).rows[0].id;
    await audit(c, ctx, "bay_tablet", id, "added", { name: n }, b);
    return { id, token };
  });
}

/** Removing a tablet ends its PIN sessions straight away. */
export async function removeTablet(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const t = (await c.query("SELECT id, branch_id, name FROM bay_tablet WHERE id = $1 AND active FOR UPDATE", [id])).rows[0];
    if (!t) throw notFound("Tablet");
    assertCan(ctx, "workshop", "edit", t.branch_id);
    await c.query("UPDATE bay_tablet SET active = false WHERE id = $1", [id]);
    await c.query("UPDATE session SET revoked_at = now() WHERE tablet_id = $1 AND revoked_at IS NULL", [id]);
    await audit(c, ctx, "bay_tablet", id, "removed", { name: t.name }, t.branch_id);
  });
}

export async function tabletByToken(token: string | undefined) {
  if (!token || token.length < 32) return null;
  return withAnonTx(async (c) => (await c.query("SELECT * FROM tablet_by_token_hash($1)", [hash(token)])).rows[0] as { id: string; branch_id: string; name: string } | undefined ?? null);
}

/** The names on the tablet's sign-in screen: technicians of its branch who have set a PIN. */
export async function tabletPeople(tablet: { branch_id: string }) {
  return withBranchSystemTx(tablet.branch_id, async (c) => (await c.query(
    `SELECT u.id, u.full_name FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id JOIN app_user u ON u.id = ubr.user_id
      WHERE ubr.branch_id = $1 AND r.code = 'technician' AND u.status = 'active' AND u.pin_hash IS NOT NULL ORDER BY u.full_name`, [tablet.branch_id])).rows as { id: string; full_name: string }[]);
}

export async function pinLogin(tabletToken: string | undefined, userId: string, pin: string, meta: { ip?: string; device?: string }) {
  const t = await tabletByToken(tabletToken);
  if (!t) throw forbidden("This tablet is not registered for quick PIN sign-in.");
  const people = await tabletPeople(t);
  const who = people.find((p) => p.id === userId);
  if (!who) throw invalid("Tap your name first.");
  const username = await withBranchSystemTx(t.branch_id, async (c) => (await c.query("SELECT username FROM app_user WHERE id = $1", [userId])).rows[0].username as string);
  const out = await login(username, str(pin), { ...meta, device: `${t.name} · ${(meta.device ?? "").slice(0, 120)}` }, true, { id: t.id, branchId: t.branch_id });
  await withAnonTx(async (c) => { await c.query("SELECT tablet_used($1)", [t.id]); });
  return out;
}

const WEAK = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "1212", "0123", "9876", "2580"]);

/** A technician sets their own PIN after signing in with the password (not from a PIN session). */
export async function setPin(ctx: Ctx, pin: string, confirm: string) {
  if (ctx.pinOnly) throw forbidden("Sign in with your password to change the PIN.");
  const p = str(pin);
  if (!/^\d{4}$/.test(p)) throw invalid("PIN must be 4 digits.", { field: "pin" });
  if (WEAK.has(p)) throw invalid("That PIN is too easy to guess. Choose another.", { field: "pin" });
  if (p !== str(confirm)) throw invalid("The two PINs are not the same.", { field: "pin2" });
  await withAnonTx(async (c) => {
    await c.query("UPDATE app_user SET pin_hash = $2, pin_set_at = now(), updated_at = now() WHERE id = $1", [ctx.userId, bcrypt.hashSync(p, 10)]);
  });
  await withTx(ctx, async (c) => { await audit(c, ctx, "app_user", ctx.userId, "pin_set", {}, ctx.currentBranchId); });
}

/** A manager clears a technician's PIN (forgotten, or shared): they set a new one after a password sign-in. */
export async function clearPin(ctx: Ctx, userId: string) {
  const b = ctx.currentBranchId;
  if (!b) throw invalid("Choose a branch first.");
  assertCan(ctx, "workshop", "edit", b);
  await withTx(ctx, async (c) => {
    const ok = (await c.query("SELECT 1 FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = $1 AND ubr.branch_id = $2 AND r.code = 'technician'", [userId, b])).rowCount;
    if (!ok) throw notFound("Technician");
    await c.query("UPDATE app_user SET pin_hash = NULL, pin_set_at = NULL WHERE id = $1", [userId]);
    await c.query("UPDATE session SET revoked_at = now() WHERE user_id = $1 AND pin_only AND revoked_at IS NULL", [userId]);
    await audit(c, ctx, "app_user", userId, "pin_cleared", {}, b);
  });
}
