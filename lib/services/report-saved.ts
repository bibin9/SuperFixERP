import type { PoolClient } from "pg";
import { Ctx, can, canAnywhere } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { Col, Row, RunInput, reportDef, runReport, canOpenReport, reportBranches, canExport, reportToday, reportAddDays } from "./reports";
import { SOURCES, sourceDef, sourceFor, cleanSpec, runSpec, Spec } from "./report-builder";
import { toXlsx } from "../xlsx";

/**
 * Saved reports (copies of standard reports and builder reports), sharing with roles or users, the
 * personal reports dashboard, and scheduled preparation into the report inbox (RB-07 to RB-10).
 */

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roleIds = (ctx: Ctx) => [...new Set(ctx.grants.map((g) => g.roleId))];

export type Saved = { id: string; name: string; kind: "builder" | "copy"; base_code: string | null; source: string | null; spec: Record<string, unknown>; owner_id: string; owner: string; in_menu: boolean; mine: boolean; shared: boolean };

/** May the user open this saved report: theirs, or shared with them or one of their roles; and they can see its data. */
function allowed(ctx: Ctx, r: Saved) {
  if (r.kind === "copy") { const d = reportDef(r.base_code!); return !!d && canOpenReport(ctx, d); }
  const s = sourceDef(r.source!); return !!s && canOpenReport(ctx, s);
}
const SAVED_SQL = `SELECT d.id, d.name, d.kind, d.base_code, d.source, d.spec, d.owner_id, u.full_name owner, d.in_menu, d.owner_id = $1 mine,
    EXISTS (SELECT 1 FROM report_share s WHERE s.report_id = d.id) shared
  FROM report_definition d JOIN app_user u ON u.id = d.owner_id
  WHERE d.owner_id = $1 OR EXISTS (SELECT 1 FROM report_share s WHERE s.report_id = d.id AND (s.user_id = $1 OR s.role_id = ANY($2)))`;

export async function listSaved(ctx: Ctx) {
  return withTx(ctx, async (c) => ((await c.query(`${SAVED_SQL} ORDER BY d.name`, [ctx.userId, roleIds(ctx)])).rows as Saved[]).filter((r) => allowed(ctx, r)));
}
async function loadSaved(c: PoolClient, ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw notFound("Report");
  const r = (await c.query(`SELECT * FROM (${SAVED_SQL}) x WHERE x.id = $3`, [ctx.userId, roleIds(ctx), id])).rows[0] as Saved | undefined;
  if (!r) throw notFound("Report");
  if (!allowed(ctx, r)) throw forbidden("You do not have access to this report's data.");
  return r;
}
export async function getSaved(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await loadSaved(c, ctx, id);
    const shares = (await c.query(`SELECT s.id, s.role_id, s.user_id, coalesce(r.name, u.full_name) name FROM report_share s LEFT JOIN role r ON r.id = s.role_id LEFT JOIN app_user u ON u.id = s.user_id WHERE s.report_id = $1 ORDER BY 4`, [id])).rows;
    return { ...r, shares };
  });
}

/** Options for the share form: active roles and users. */
export async function shareOptions(ctx: Ctx) {
  return withTx(ctx, async (c) => ({
    roles: (await c.query("SELECT id, name FROM role WHERE active ORDER BY name")).rows,
    users: (await c.query("SELECT id, full_name FROM app_user WHERE status = 'active' AND id <> $1 ORDER BY full_name", [ctx.userId])).rows,
  }));
}

function assertCanSave(ctx: Ctx) {
  if (!canAnywhere(ctx, "reports", "view")) throw forbidden("You need the reports permission to save reports.");
}

/** RB-08: copy a standard report, keep chosen columns (renamed and in order) and default filters. */
export async function saveCopy(ctx: Ctx, f: { id?: string; base_code: string; name: string; columns: { key: string; label: string }[]; params: Record<string, string> }) {
  assertCanSave(ctx);
  const def = reportDef(f.base_code);
  if (!def || !canOpenReport(ctx, def)) throw forbidden("You do not have access to that report.");
  const name = str(f.name, 120);
  if (!name) throw invalid("Give the report a name.", { field: "name" });
  const all = typeof def.columns === "function" ? null : def.columns.map((x) => x.key);
  const columns = f.columns.filter((x) => str(x.key) && (!all || all.includes(x.key))).map((x) => ({ key: str(x.key, 60), label: str(x.label, 60) }));
  if (!columns.length) throw invalid("Keep at least one column.", { field: "columns" });
  const allowedParams = new Set(["from", "to", "branches", "advisor", "technician", "source", ...(def.extra ?? []).map((e) => e.key)]);
  const params = Object.fromEntries(Object.entries(f.params).filter(([k, v]) => allowedParams.has(k) && v).map(([k, v]) => [k, str(v, 60)]));
  const spec = { columns, params };
  return withTx(ctx, async (c) => {
    if (f.id) {
      const r = await c.query("UPDATE report_definition SET name = $1, spec = $2, updated_at = now(), version = version + 1 WHERE id = $3 AND owner_id = $4 AND kind = 'copy' RETURNING id", [name, spec, f.id, ctx.userId]);
      if (!r.rowCount) throw forbidden("Only the person who saved this report can change it.");
      return { id: f.id };
    }
    const id = (await c.query("INSERT INTO report_definition (name, kind, base_code, spec, owner_id) VALUES ($1,'copy',$2,$3,$4) RETURNING id", [name, def.code, spec, ctx.userId])).rows[0].id;
    await audit(c, ctx, "report_definition", id, "create", { name, base: def.code });
    return { id };
  });
}

/** RB-01 to RB-06: save a builder report. The spec is checked against the fields the user may see. */
export async function saveBuilder(ctx: Ctx, f: { id?: string; name: string; source: string; spec: unknown }) {
  assertCanSave(ctx);
  const name = str(f.name, 120);
  if (!name) throw invalid("Give the report a name.", { field: "name" });
  const src = sourceDef(f.source);
  if (!src) throw invalid("Choose a data source.", { field: "source" });
  return withTx(ctx, async (c) => {
    const br = await reportBranches(c, ctx, src, undefined);
    const spec: Spec = cleanSpec(f.spec, await sourceFor(c, ctx, src.key, br.all.map((b) => b.id)));
    if (f.id) {
      if (!UUID.test(f.id)) throw notFound("Report");
      const r = await c.query("UPDATE report_definition SET name = $1, source = $2, spec = $3, updated_at = now(), version = version + 1 WHERE id = $4 AND owner_id = $5 AND kind = 'builder' RETURNING id", [name, src.key, spec, f.id, ctx.userId]);
      if (!r.rowCount) throw forbidden("Only the person who saved this report can change it.");
      await audit(c, ctx, "report_definition", f.id, "update", { name, source: src.key });
      return { id: f.id };
    }
    const id = (await c.query("INSERT INTO report_definition (name, kind, source, spec, owner_id) VALUES ($1,'builder',$2,$3,$4) RETURNING id", [name, src.key, spec, ctx.userId])).rows[0].id;
    await audit(c, ctx, "report_definition", id, "create", { name, source: src.key });
    return { id };
  });
}

/** RB-07: share with roles and users, and show in the Reports menu of everyone it is shared with. */
export async function setShares(ctx: Ctx, id: string, f: { roles: string[]; users: string[]; in_menu: boolean }) {
  return withTx(ctx, async (c) => {
    const r = await loadSaved(c, ctx, id);
    if (!r.mine) throw forbidden("Only the person who saved this report can share it.");
    const roles = f.roles.filter((x) => UUID.test(x)), users = f.users.filter((x) => UUID.test(x) && x !== ctx.userId);
    if (roles.length && (await c.query("SELECT count(*)::int n FROM role WHERE id = ANY($1)", [roles])).rows[0].n !== roles.length) throw invalid("Choose roles from the list.", { field: "roles" });
    if (users.length && (await c.query("SELECT count(*)::int n FROM app_user WHERE id = ANY($1) AND status = 'active'", [users])).rows[0].n !== users.length) throw invalid("Choose users from the list.", { field: "users" });
    await c.query("DELETE FROM report_share WHERE report_id = $1", [id]);
    for (const x of roles) await c.query("INSERT INTO report_share (report_id, role_id) VALUES ($1,$2)", [id, x]);
    for (const x of users) await c.query("INSERT INTO report_share (report_id, user_id) VALUES ($1,$2)", [id, x]);
    await c.query("UPDATE report_definition SET in_menu = $1, updated_at = now() WHERE id = $2", [f.in_menu, id]);
    await audit(c, ctx, "report_definition", id, "share", { roles: roles.length, users: users.length, in_menu: f.in_menu });
  });
}

export async function deleteSaved(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = await loadSaved(c, ctx, id);
    if (!r.mine) throw forbidden("Only the person who saved this report can delete it.");
    await c.query("DELETE FROM dashboard_widget WHERE report_ref = $1", [`def:${id}`]);
    await c.query("UPDATE report_schedule SET active = false WHERE report_ref = $1", [`def:${id}`]);
    await c.query("DELETE FROM report_definition WHERE id = $1", [id]);
    await audit(c, ctx, "report_definition", id, "delete", { name: r.name });
  });
}

/** Saved reports shown in the Reports menu (accordion) for this user. */
export async function menuReports(ctx: Ctx) {
  return (await listSaved(ctx)).filter((r) => r.in_menu).map((r) => ({ id: r.id, name: r.name }));
}

// ---------------------------------------------------------------- one way to run anything by reference
export type Ran = { ref: string; title: string; columns: Col[]; rows: Row[]; totals: Row; chart: { type: "bar" | "line" | "pie"; x: string; y: string } | null;
  branchCodes: string[]; branchIds: string[]; from?: string; to?: string; canExport: boolean; truncated: boolean };

export async function runRef(ctx: Ctx, ref: string, q: RunInput): Promise<Ran> {
  const [kind, id] = [ref.slice(0, 3), ref.slice(4)];
  if (kind === "std") {
    const r = await runReport(ctx, id, q);
    return { ref, title: r.def.name, columns: r.columns, rows: r.rows, totals: r.totals, chart: r.def.chart ?? null, branchCodes: r.chosen.map((b) => b.code), branchIds: r.filters.branches,
      from: r.def.dates === "range" ? r.filters.from : undefined, to: r.def.dates === "range" ? r.filters.to : undefined, canExport: r.canExport, truncated: r.truncated };
  }
  if (kind !== "def") throw notFound("Report");
  const saved = await withTx(ctx, (c) => loadSaved(c, ctx, id));
  if (saved.kind === "copy") {
    const spec = saved.spec as { columns: { key: string; label: string }[]; params: Record<string, string> };
    const r = await runReport(ctx, saved.base_code!, { ...spec.params, ...q });
    const cols = spec.columns.map((x) => { const col = r.columns.find((y) => y.key === x.key); return col ? { ...col, label: x.label || col.label } : null; }).filter(Boolean) as Col[];
    return { ref, title: saved.name, columns: cols.length ? cols : r.columns, rows: r.rows, totals: r.totals, chart: r.def.chart ?? null, branchCodes: r.chosen.map((b) => b.code), branchIds: r.filters.branches,
      from: r.def.dates === "range" ? r.filters.from : undefined, to: r.def.dates === "range" ? r.filters.to : undefined, canExport: r.canExport, truncated: r.truncated };
  }
  const src = sourceDef(saved.source!)!;
  return withTx(ctx, async (c) => {
    const br = await reportBranches(c, ctx, src, q.branches);
    const ids = br.chosen.map((b) => b.id);
    const res = await runSpec(c, ctx, src.key, saved.spec, q, ids);
    const sp = saved.spec as Spec;
    return { ref, title: saved.name, columns: res.columns, rows: res.rows, totals: res.totals, chart: res.chart ?? null, branchCodes: br.chosen.map((b) => b.code), branchIds: ids,
      from: sp.useDates ? String(q.from ?? "") || undefined : undefined, to: sp.useDates ? String(q.to ?? "") || undefined : undefined, canExport: canExport(ctx, ids), truncated: res.truncated };
  });
}

// ---------------------------------------------------------------- export (CSV, Excel)
const cellText = (col: Col, v: unknown) => (v === null || v === undefined ? "" : col.type === "date" && typeof v === "string" ? v.split("-").reverse().join("/") : String(v));
const isNum = (col: Col) => ["money", "num", "int", "pct", "hours"].includes(col.type ?? "");
const words = (v: string) => (/^[a-z]+(_[a-z]+)*$/.test(v) ? v.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : v);

export function tableFor(r: Ran) {
  const header = r.columns.map((c) => c.label);
  const rows = r.rows.map((row) => r.columns.map((col) => {
    const v = row[col.key];
    if (isNum(col) && v !== null && v !== undefined && v !== "" && !row.$subtotal) return Number(v);
    if (isNum(col) && row.$subtotal && v !== null && v !== undefined && typeof v !== "string") return Number(v);
    return col.type === "status" && typeof v === "string" ? words(v) : cellText(col, v);
  }));
  if (Object.keys(r.totals).length) rows.push(r.columns.map((col, i) => (i === 0 ? "Total" : r.totals[col.key] === undefined ? "" : Math.round(Number(r.totals[col.key]) * 100) / 100)));
  return { header, rows };
}
export function subtitle(r: Ran) {
  return [r.from && r.to ? `${r.from.split("-").reverse().join("/")} to ${r.to.split("-").reverse().join("/")}` : `As on ${reportToday().split("-").reverse().join("/")}`, `Branches: ${r.branchCodes.join(", ")}`].join(" · ");
}
export function toCsv(r: Ran) {
  const t = tableFor(r);
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [[r.title], [subtitle(r)], t.header, ...t.rows].map((row) => row.map(q).join(",")).join("\r\n");
}
export function toExcel(r: Ran) {
  const t = tableFor(r);
  return toXlsx(r.title, t.header, t.rows, `${r.title} · ${subtitle(r)}`);
}

/** Export needs reports:export at every branch in the run (RB-09, RB-11). It is logged. */
export async function exportRef(ctx: Ctx, ref: string, q: RunInput, format: "csv" | "xlsx") {
  const r = await runRef(ctx, ref, q);
  if (!r.canExport) throw forbidden("You do not have permission to export reports for these branches.");
  await withTx(ctx, (c) => audit(c, ctx, "report", null, "export", { ref, format, rows: r.rows.length, branches: r.branchCodes.join(",") }));
  const safe = r.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "report";
  return format === "csv"
    ? { body: Buffer.from(toCsv(r), "utf8"), type: "text/csv; charset=utf-8", name: `${safe}.csv` }
    : { body: toExcel(r), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: `${safe}.xlsx` };
}

// ---------------------------------------------------------------- dashboard (pinned reports)
async function dashboardId(c: PoolClient, ctx: Ctx) {
  const r = await c.query("INSERT INTO dashboard (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET name = dashboard.name RETURNING id", [ctx.userId]);
  return r.rows[0].id as string;
}
export async function pinReport(ctx: Ctx, ref: string, title: string, chart: string) {
  await runRef(ctx, ref, {}); // the user must be able to run it
  return withTx(ctx, async (c) => {
    const dash = await dashboardId(c, ctx);
    const ch = ["table", "bar", "line", "pie"].includes(chart) ? chart : "table";
    await c.query(`INSERT INTO dashboard_widget (dashboard_id, report_ref, title, chart, position) VALUES ($1,$2,$3,$4, (SELECT coalesce(max(position), 0) + 1 FROM dashboard_widget WHERE dashboard_id = $1))
      ON CONFLICT (dashboard_id, report_ref) DO UPDATE SET title = EXCLUDED.title, chart = EXCLUDED.chart`, [dash, ref, str(title, 120) || "Report", ch]);
  });
}
export async function unpinReport(ctx: Ctx, widgetId: string) {
  if (!UUID.test(widgetId)) throw notFound("Pinned report");
  return withTx(ctx, async (c) => {
    const r = await c.query("DELETE FROM dashboard_widget w USING dashboard d WHERE w.id = $1 AND d.id = w.dashboard_id AND d.user_id = $2", [widgetId, ctx.userId]);
    if (!r.rowCount) throw notFound("Pinned report");
  });
}
export async function myWidgets(ctx: Ctx) {
  const ws = await withTx(ctx, async (c) => (await c.query("SELECT w.id, w.report_ref, w.title, w.chart FROM dashboard_widget w JOIN dashboard d ON d.id = w.dashboard_id WHERE d.user_id = $1 ORDER BY w.position", [ctx.userId])).rows);
  const out: { id: string; ref: string; title: string; chart: string; result: Ran | null; error: string | null }[] = [];
  for (const w of ws) {
    try { out.push({ id: w.id, ref: w.report_ref, title: w.title, chart: w.chart, result: await runRef(ctx, w.report_ref, {}), error: null }); }
    catch (e) { out.push({ id: w.id, ref: w.report_ref, title: w.title, chart: w.chart, result: null, error: (e as Error).message }); }
  }
  return out;
}

// ---------------------------------------------------------------- schedules and the report inbox (RB-10)
const FREQ: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
export const frequencies = Object.entries(FREQ);

/** The period a scheduled report covers when prepared on day d. */
export function schedulePeriod(freq: string, d: string) {
  if (freq === "daily") { const y = reportAddDays(d, -1); return { from: y, to: y, label: y.split("-").reverse().join("/") }; }
  if (freq === "weekly") { const f = reportAddDays(d, -7), t = reportAddDays(d, -1); return { from: f, to: t, label: `${f.split("-").reverse().join("/")} to ${t.split("-").reverse().join("/")}` }; }
  const first = `${d.slice(0, 7)}-01`, to = reportAddDays(first, -1), from = `${to.slice(0, 7)}-01`;
  return { from, to, label: to.slice(0, 7) };
}
export function nextDue(freq: string, d: string) {
  if (freq === "daily") return reportAddDays(d, 1);
  if (freq === "weekly") return reportAddDays(d, 7);
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10);
}

export async function addSchedule(ctx: Ctx, f: { ref: string; frequency: string; params: Record<string, string> }) {
  if (!FREQ[f.frequency]) throw invalid("Choose how often.", { field: "frequency" });
  const r = await runRef(ctx, f.ref, { ...f.params });
  if (!r.canExport) throw forbidden("Scheduled reports are prepared as Excel files, so you need the export permission for these branches.");
  const params = Object.fromEntries(Object.entries(f.params).filter(([k, v]) => v && !["from", "to"].includes(k)).map(([k, v]) => [k, str(v, 400)]));
  const t = reportToday();
  const first = f.frequency === "daily" ? reportAddDays(t, 1) : f.frequency === "weekly" ? reportAddDays(t, 7 - ((new Date(`${t}T00:00:00Z`).getUTCDay() + 1) % 7 || 7) + 0) : nextDue("monthly", t);
  return withTx(ctx, async (c) => {
    const id = (await c.query("INSERT INTO report_schedule (report_ref, title, user_id, frequency, params, next_due) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [f.ref, r.title, ctx.userId, f.frequency, params, first])).rows[0].id;
    await audit(c, ctx, "report_schedule", id, "create", { ref: f.ref, frequency: f.frequency });
    return { id, next_due: first };
  });
}
export async function stopSchedule(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw notFound("Schedule");
  return withTx(ctx, async (c) => {
    const r = await c.query("UPDATE report_schedule SET active = false WHERE id = $1 AND user_id = $2 AND active RETURNING id", [id, ctx.userId]);
    if (!r.rowCount) throw notFound("Schedule");
  });
}

/** Prepares every schedule of this user that is due (run when the inbox opens, or with "Prepare now"). */
export async function prepareDue(ctx: Ctx, onlyId?: string) {
  const t = reportToday();
  const due = await withTx(ctx, async (c) => (await c.query(
    `SELECT id, report_ref, title, frequency, params, to_char(next_due, 'YYYY-MM-DD') next_due FROM report_schedule WHERE user_id = $1 AND active AND ($2::uuid IS NULL AND next_due <= $3 OR id = $2::uuid) ORDER BY next_due`,
    [ctx.userId, onlyId && UUID.test(onlyId) ? onlyId : null, t])).rows);
  let made = 0;
  for (const s of due) {
    const day = onlyId ? t : s.next_due;
    const per = schedulePeriod(s.frequency, day);
    let file: Buffer, rows = 0, label = per.label;
    try {
      const r = await runRef(ctx, s.report_ref, { ...s.params, from: per.from, to: per.to });
      if (!r.canExport) throw forbidden("Export permission was removed for these branches.");
      file = toExcel(r); rows = r.rows.length;
    } catch (e) {
      file = toXlsx("Not prepared", ["Message"], [[`This report could not be prepared: ${(e as Error).message}`]], s.title); label = `${per.label} (not prepared)`;
    }
    await withTx(ctx, async (c) => {
      await c.query("INSERT INTO report_inbox (user_id, schedule_id, report_ref, title, period_label, row_count, file) VALUES ($1,$2,$3,$4,$5,$6,$7)", [ctx.userId, s.id, s.report_ref, s.title, label, rows, file]);
      let nd = s.next_due as string;
      if (!onlyId) { while (nd <= t) nd = nextDue(s.frequency, nd); }
      await c.query("UPDATE report_schedule SET last_prepared_at = now(), next_due = $2 WHERE id = $1", [s.id, nd]);
    });
    made++;
  }
  return made;
}

export async function inbox(ctx: Ctx) {
  const prepared = await prepareDue(ctx);
  return withTx(ctx, async (c) => ({
    prepared,
    items: (await c.query("SELECT id, title, period_label, row_count, prepared_at, opened_at, octet_length(file) size FROM report_inbox WHERE user_id = $1 ORDER BY prepared_at DESC LIMIT 200", [ctx.userId])).rows,
    schedules: (await c.query("SELECT id, report_ref, title, frequency, params, to_char(next_due, 'YYYY-MM-DD') next_due, last_prepared_at FROM report_schedule WHERE user_id = $1 AND active ORDER BY title", [ctx.userId])).rows,
  }));
}
export async function inboxFile(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw notFound("Report file");
  return withTx(ctx, async (c) => {
    const r = (await c.query("UPDATE report_inbox SET opened_at = coalesce(opened_at, now()) WHERE id = $1 AND user_id = $2 RETURNING title, period_label, file", [id, ctx.userId])).rows[0];
    if (!r) throw notFound("Report file");
    return { body: r.file as Buffer, name: `${String(r.title).replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-")}-${String(r.period_label ?? "").replace(/[^0-9A-Za-z-]+/g, "-")}.xlsx` };
  });
}
export async function unreadInbox(ctx: Ctx) {
  return withTx(ctx, async (c) => Number((await c.query("SELECT count(*) n FROM report_inbox WHERE user_id = $1 AND opened_at IS NULL", [ctx.userId])).rows[0].n));
}

export { SOURCES, can };
