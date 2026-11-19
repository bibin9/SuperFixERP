import { Ctx, canAnywhere } from "../access";
import { withTx } from "../db";
import { invalid, notFound, conflict, forbidden } from "../errors";
import { audit } from "./audit";
import { optStr, required } from "../validate";
import { D, parseDec } from "../money";
import { addLineIn, Owner } from "./jobs";

/** Service bundles (QT-05): a named set of labour and parts added to a quotation in one tap. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type Bundle = Row & { lines: Row[] };

export async function listBundles(ctx: Ctx, opts: { all?: boolean } = {}): Promise<Bundle[]> {
  return withTx(ctx, async (c) => {
    const bundles = (await c.query(
      `SELECT b.*, coalesce(sum(CASE WHEN l.service_id IS NOT NULL THEN l.qty * s.standard_hours * s.labour_rate ELSE l.qty * i.list_price END), 0)::numeric(14,2) price,
              count(l.service_id)::int labour_lines, count(l.item_id)::int part_lines
         FROM service_bundle b LEFT JOIN service_bundle_line l ON l.bundle_id = b.id
         LEFT JOIN service s ON s.id = l.service_id LEFT JOIN item i ON i.id = l.item_id
        WHERE ($1 OR b.active) GROUP BY b.id ORDER BY b.name_en`, [!!opts.all])).rows;
    const lines = (await c.query(
      `SELECT l.*, s.name_en service_name, s.standard_hours, i.part_no, i.description item_name
         FROM service_bundle_line l LEFT JOIN service s ON s.id = l.service_id LEFT JOIN item i ON i.id = l.item_id ORDER BY l.line_no`)).rows;
    return bundles.map((b): Bundle => ({ ...b, lines: lines.filter((l) => l.bundle_id === b.id) }));
  });
}

/** Puts the bundles that fit the car first (make or model named in "for vehicles"). */
export function rankForVehicle<T extends Row>(bundles: T[], v: { make?: string | null; model?: string | null } | null) {
  const words = [v?.make, v?.model].filter(Boolean).map((w) => String(w).toLowerCase());
  const score = (b: T) => { const f = (b.for_vehicles ?? "").toLowerCase(); return words.filter((w) => f.includes(w)).length; };
  return [...bundles].map((b) => ({ ...b, match: score(b) > 0 })).sort((a, b) => score(b) - score(a));
}

/** Adds every line of the bundle to the enquiry's quotation (or the job card as extra work), all or nothing. */
export async function addBundle(ctx: Ctx, owner: Owner, bundleId: string, f: Record<string, unknown> = {}) {
  return withTx(ctx, async (c) => {
    const b = await c.query("SELECT * FROM service_bundle WHERE id = $1 AND active", [required(bundleId, "Service bundle")]);
    if (!b.rowCount) throw notFound("Service bundle");
    const lines = (await c.query(
      `SELECT l.*, s.standard_hours FROM service_bundle_line l LEFT JOIN service s ON s.id = l.service_id WHERE l.bundle_id = $1 ORDER BY l.line_no`, [bundleId])).rows;
    if (!lines.length) throw invalid("This bundle has no lines yet.");
    let below = false;
    for (const l of lines) {
      const r = l.service_id
        ? await addLineIn(c, ctx, owner, { line_type: "labour", service_id: l.service_id, qty: D(l.qty).mul(l.standard_hours ?? 0).gt(0) ? D(l.qty).mul(l.standard_hours).toFixed(3) : "", technician_id: f.technician_id })
        : await addLineIn(c, ctx, owner, { line_type: "part", item_id: l.item_id, qty: D(l.qty).toString() });
      below ||= r.belowMargin;
    }
    return { name: b.rows[0].name_en as string, count: lines.length, belowMargin: below };
  });
}

type LineIn = { kind: string; ref: string; qty: string };

/** Creates or updates a bundle with its lines. Lines are replaced as a whole. */
export async function saveBundle(ctx: Ctx, f: Record<string, string>, lines: LineIn[]) {
  if (!canAnywhere(ctx, "settings", "edit")) throw forbidden();
  return withTx(ctx, async (c) => {
    const vals = [required(f.code, "Code").toUpperCase(), required(f.name_en, "Name"), optStr(f.name_ar), optStr(f.for_vehicles), f.active !== "0"];
    const clean = lines.filter((l) => l.ref).map((l, i) => {
      if (!["labour", "part"].includes(l.kind)) throw invalid(`Line ${i + 1}: choose labour or part.`);
      return { ...l, qty: parseDec(l.qty || "1", `Line ${i + 1} quantity`, { min: "0.001", dp: 3 }).toFixed(3) };
    });
    if (!clean.length) throw invalid("Add at least one labour or part line.");
    let id = f.id;
    if (id) {
      const r = await c.query(
        `UPDATE service_bundle SET code = $2, name_en = $3, name_ar = $4, for_vehicles = $5, active = $6, updated_at = now(), updated_by = $7, version = version + 1
          WHERE id = $1 AND version = $8 RETURNING id`, [id, ...vals, ctx.userId, Number(f.version)]);
      if (!r.rowCount) throw conflict();
      await c.query("DELETE FROM service_bundle_line WHERE bundle_id = $1", [id]);
    } else {
      const dup = await c.query("SELECT 1 FROM service_bundle WHERE code = $1", [vals[0]]);
      if (dup.rowCount) throw invalid("A bundle with this code exists already.", { field: "code" });
      id = (await c.query("INSERT INTO service_bundle (code, name_en, name_ar, for_vehicles, active, updated_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [...vals, ctx.userId])).rows[0].id;
    }
    let n = 0;
    for (const l of clean) {
      await c.query("INSERT INTO service_bundle_line (bundle_id, line_no, service_id, item_id, qty) VALUES ($1,$2,$3,$4,$5)",
        [id, ++n, l.kind === "labour" ? l.ref : null, l.kind === "part" ? l.ref : null, l.qty]);
    }
    await audit(c, ctx, "service_bundle", id, f.id ? "update" : "create", { code: vals[0], lines: clean.length }, null);
    return id;
  });
}

/** Complaint list for check-in and enquiries, with each complaint's suggested service. */
export async function complaintList(ctx: Ctx) {
  return withTx(ctx, async (c) => (await c.query(
    `SELECT cc.group_name, cc.name_en, cc.service_id, s.name_en service_name FROM customer_complaint cc LEFT JOIN service s ON s.id = cc.service_id AND s.active
      WHERE cc.active ORDER BY cc.group_name, cc.sort, cc.name_en`)).rows as { group_name: string; name_en: string; service_id: string | null; service_name: string | null }[]);
}

/** Services suggested by the complaints written on an enquiry (each once). */
export function suggestedServices(complaints: string | null | undefined, list: { name_en: string; service_id: string | null; service_name: string | null }[]) {
  const text = (complaints ?? "").toLowerCase();
  const out = new Map<string, string>();
  for (const c of list) if (c.service_id && c.service_name && text.includes(c.name_en.toLowerCase())) out.set(c.service_id, c.service_name);
  return [...out].map(([id, name]) => ({ id, name }));
}

/** Adds labour lines for the chosen services in one go (suggested from the complaints). */
export async function addServices(ctx: Ctx, owner: Owner, serviceIds: string[]) {
  const ids = [...new Set(serviceIds.filter(Boolean))];
  if (!ids.length) throw invalid("Tick at least one service.");
  return withTx(ctx, async (c) => {
    for (const id of ids) await addLineIn(c, ctx, owner, { line_type: "labour", service_id: id });
    return ids.length;
  });
}
