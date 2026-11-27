import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { withAnonTx, withTx } from "../db";
import { Ctx, loadCtx, assertCan } from "../access";
import { AppError, forbidden, invalid } from "../errors";
import { getSetting } from "./settings";
import { checkPassword } from "../password-check";
import { audit } from "./audit";

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const hashPassword = (p: string) => bcrypt.hashSync(p, 10);

type Meta = { ip?: string; device?: string };

/** Sign-in with user name and password (FSD 2.3). Lock-out after N failures (NFR security). */
/** Failed sign-ins allowed from one network address in 15 minutes, across all users. */
const IP_MAX_FAILS = 30;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export async function login(username: string, password: string, meta: Meta = {}, viaPin = false, tablet?: { id: string; branchId: string }): Promise<{ token: string; userId: string }> {
  const uname = String(username || "").trim().toLowerCase();
  // Failures are recorded and committed, then reported after the transaction.
  const out = await withAnonTx(async (c): Promise<{ token: string; userId: string } | { error: string }> => {
    const u = await c.query("SELECT * FROM app_user WHERE username = $1 FOR UPDATE", [uname]);
    const user = u.rows[0];
    const fail = async (msg: string) => {
      await c.query("INSERT INTO login_event (user_id, username, event, ip, device) VALUES ($1,$2,'login_failed',$3,$4)", [user?.id ?? null, uname, meta.ip, meta.device]);
      return { error: msg };
    };
    // PEN-03: one network may fail only so many sign-ins in 15 minutes (password guessing across many users),
    // checked before the user is looked at, so it cannot be used to tell real user names apart.
    const ipFails = meta.ip ? Number((await c.query(
      "SELECT count(*) n FROM login_event WHERE ip = $1 AND event = 'login_failed' AND at > now() - interval '15 minutes'", [meta.ip])).rows[0].n) : 0;
    if (ipFails >= IP_MAX_FAILS) return fail("Too many failed sign-ins from this network. Wait 15 minutes, then try again.");
    // PEN-02: an unknown or switched-off user takes as long as a wrong password, so timing does not reveal user names.
    if (!user || user.status !== "active") { await checkPassword(String(password || ""), DUMMY_HASH); return fail("Wrong user name or password."); }
    if (user.locked_until && new Date(user.locked_until) > new Date()) return fail("This account is locked after too many failed sign-ins. Try again later or ask the admin.");
    const maxFails = Number(await getSetting(c, "security.max_failed_logins", null, 5));
    const lockMins = Number(await getSetting(c, "security.lockout_minutes", null, 15));
    // SEC-03: wrong passwords lock the user only on the network they came from, so someone elsewhere cannot lock
    // out the admin by guessing. The whole account still locks after many failures from all networks together.
    const netLocked = (await c.query(
      "SELECT 1 FROM login_event WHERE user_id = $1 AND event = 'locked' AND ip IS NOT DISTINCT FROM $2 AND at > now() - make_interval(mins => $3) LIMIT 1",
      [user.id, meta.ip ?? null, lockMins])).rowCount;
    if (netLocked) return fail("This account is locked after too many failed sign-ins. Try again later or ask the admin.");
    const secret = viaPin ? user.pin_hash : user.password_hash;
    // SEC-02: checked in a worker thread, so other people's pages keep loading while a sign-in is checked.
    const ok = !!secret && await checkPassword(String(password || ""), secret);
    if (!ok) {
      const accountMax = Number(await getSetting(c, "security.max_failed_logins_all_networks", null, 25));
      const fails = user.failed_attempts + 1;
      const netFails = 1 + Number((await c.query(
        "SELECT count(*) n FROM login_event WHERE user_id = $1 AND event = 'login_failed' AND ip IS NOT DISTINCT FROM $2 AND at > greatest(now() - make_interval(mins => $3), coalesce((SELECT max(at) FROM login_event WHERE user_id = $1 AND event IN ('login', 'pin_login', 'locked') AND ip IS NOT DISTINCT FROM $2), '-infinity'))",
        [user.id, meta.ip ?? null, lockMins])).rows[0].n);
      if (fails >= accountMax) {
        await c.query("UPDATE app_user SET failed_attempts = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1", [user.id, lockMins]);
        await c.query("INSERT INTO login_event (user_id, username, event, ip, device) VALUES ($1,$2,'locked',$3,$4)", [user.id, uname, meta.ip, meta.device]);
      } else {
        await c.query("UPDATE app_user SET failed_attempts = $2 WHERE id = $1", [user.id, fails]);
        if (netFails >= maxFails) await c.query("INSERT INTO login_event (user_id, username, event, ip, device) VALUES ($1,$2,'locked',$3,$4)", [user.id, uname, meta.ip, meta.device]);
      }
      return fail("Wrong user name or password.");
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await c.query("UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [user.id]);
    const branch = tablet ? tablet.branchId : user.default_branch_id;
    await c.query("INSERT INTO session (token_hash, user_id, current_branch_id, ip, device, pin_only, tablet_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [hashToken(token), user.id, branch, meta.ip, meta.device, viaPin, tablet?.id ?? null]);
    await c.query("INSERT INTO login_event (user_id, username, event, branch_id, ip, device) VALUES ($1,$2,$3,$4,$5,$6)", [user.id, uname, viaPin ? "pin_login" : "login", branch, meta.ip, meta.device]);
    return { token, userId: user.id };
  });
  if ("error" in out) throw new AppError("unauthenticated", out.error);
  return out;
}

/** Resolves a session token to a fresh context; enforces idle timeout and disabled users. */
export async function sessionCtx(token: string | undefined, meta: Meta = {}): Promise<Ctx | null> {
  if (!token) return null;
  return withAnonTx(async (c) => {
    const s = await c.query("SELECT * FROM session WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]);
    if (!s.rowCount) return null;
    const sess = s.rows[0];
    // A quick-PIN session on a bay tablet locks after a short idle time (2 minutes by default).
    const idle = sess.pin_only
      ? Number(await getSetting(c, "security.tablet_idle_minutes", null, 2))
      : Number(await getSetting(c, "security.session_idle_minutes", null, 30));
    const tabletBranch = sess.pin_only ? (await c.query("SELECT tablet_branch($1) b", [sess.tablet_id])).rows[0].b as string | null : null;
    // SEC-07: a session also ends a fixed time after sign-in, however busy it is (12 hours by default).
    const maxHours = Number(await getSetting(c, "security.session_max_hours", null, 12));
    if (Date.now() - new Date(sess.created_at).getTime() > maxHours * 3_600_000 ||
        Date.now() - new Date(sess.last_seen_at).getTime() > idle * 60_000 || (sess.pin_only && tabletBranch !== sess.current_branch_id)) {
      await c.query("UPDATE session SET revoked_at = now() WHERE id = $1", [sess.id]);
      return null;
    }
    await c.query("UPDATE session SET last_seen_at = now() WHERE id = $1", [sess.id]);
    const ctx = await loadCtx(c, sess.user_id, sess.current_branch_id, { sessionId: sess.id, ip: meta.ip, device: meta.device });
    if (!ctx || !sess.pin_only) return ctx;
    // PIN sign-in opens only the technician screens of the tablet's branch, whatever else the person can do.
    const grants = ctx.grants.filter((g) => g.branchId === tabletBranch && g.roleCode === "technician");
    if (!grants.length) { await c.query("UPDATE session SET revoked_at = now() WHERE id = $1", [sess.id]); return null; }
    const keep = new Set(grants.map((g) => g.roleId));
    return { ...ctx, grants, allBranches: false, branchIds: [tabletBranch!], currentBranchId: tabletBranch,
      perms: new Map([...ctx.perms].filter(([k]) => keep.has(k))), fields: new Map([...ctx.fields].filter(([k]) => keep.has(k))), pinOnly: true };
  });
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await withAnonTx(async (c) => {
    const r = await c.query("UPDATE session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id", [hashToken(token)]);
    if (r.rowCount) await c.query("INSERT INTO login_event (user_id, event) VALUES ($1,'logout')", [r.rows[0].user_id]);
  });
}

/** Branch switcher (BR-07). The target must be one of the user's branches. */
export async function switchBranch(ctx: Ctx, branchId: string) {
  if (!ctx.branchIds.includes(branchId)) throw forbidden("You do not have access to that branch.");
  await withAnonTx(async (c) => {
    await c.query("UPDATE session SET current_branch_id = $2 WHERE id = $1", [ctx.sessionId, branchId]);
    await c.query("INSERT INTO login_event (user_id, username, event, branch_id, ip, device) VALUES ($1,$2,'branch_switch',$3,$4,$5)", [ctx.userId, ctx.username, branchId, ctx.ip, ctx.device]);
  });
}

/** "Disable user" (BR-08): ends every session and removes access at all branches in one step. */
export async function disableUser(ctx: Ctx, userId: string) {
  assertCan(ctx, "admin", "edit");
  if (userId === ctx.userId) throw invalid("You cannot disable yourself.");
  await withTx(ctx, async (c) => {
    const target = await c.query("SELECT id, username, status FROM app_user WHERE id = $1 FOR UPDATE", [userId]);
    if (!target.rowCount) throw invalid("User not found.");
    // Rule M01-3: the last active admin cannot be disabled.
    const admins = await c.query(
      `SELECT DISTINCT u.id FROM app_user u JOIN user_branch_role ubr ON ubr.user_id = u.id JOIN role r ON r.id = ubr.role_id
        WHERE r.is_admin AND u.status = 'active'`,
    );
    const ids = admins.rows.map((r) => r.id);
    if (ids.includes(userId) && ids.length === 1) throw invalid("This is the last active admin and cannot be disabled.");
    const roles = await c.query("SELECT ubr.branch_id, r.code FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id WHERE ubr.user_id = $1", [userId]);
    await c.query("UPDATE app_user SET status = 'disabled', updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1", [userId, ctx.userId]);
    await c.query("DELETE FROM user_branch_role WHERE user_id = $1", [userId]);
    await c.query("UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await c.query("INSERT INTO login_event (user_id, username, event) VALUES ($1,$2,'disabled')", [userId, target.rows[0].username]);
    await audit(c, ctx, "app_user", userId, "disable", { status: { old: target.rows[0].status, new: "disabled" }, removed_roles: roles.rows });
  });
}
