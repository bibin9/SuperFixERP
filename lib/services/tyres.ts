import { Ctx, assertCan, can } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { D } from "../money";
import { str } from "../validate";
import { getSetting } from "./settings";

/** IN-03: the year and week a DOT code (WWYY) was made, as a date (Monday of that ISO week, roughly). */
export function dotDate(dot: string) {
  const w = Number(dot.slice(0, 2)), y = 2000 + Number(dot.slice(2));
  const d = new Date(Date.UTC(y, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return d;
}

/**
 * IN-03: records the serial number of a battery or tyre fitted on a job line, so warranty can be checked
 * later by serial. Warranty runs from today for the part's warranty months. The parts must be issued first.
 */
export async function recordSerial(ctx: Ctx, lineId: string, serialIn: unknown) {
  const serials = str(serialIn).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (!serials.length) throw invalid("Enter the serial number.", { field: "serial_no" });
  return withTx(ctx, async (c) => {
    const l = (await c.query(
      `SELECT l.id, l.branch_id, l.item_id, l.issued_qty, l.job_card_id, j.customer_id, j.vehicle_id, j.status, i.warranty_months, i.part_no
         FROM job_line l JOIN job_card j ON j.id = l.job_card_id JOIN item i ON i.id = l.item_id WHERE l.id = $1 AND NOT l.removed FOR UPDATE OF l`, [lineId])).rows[0];
    if (!l) throw notFound("Job line");
    if (!can(ctx, "stock", "edit", l.branch_id) && !can(ctx, "jobs", "edit", l.branch_id)) throw forbidden();
    if (D(l.issued_qty).lte(0)) throw invalid("Issue the part to the job first.");
    const have = Number((await c.query("SELECT count(*) n FROM part_serial WHERE job_line_id = $1", [lineId])).rows[0].n);
    if (have + serials.length > D(l.issued_qty).toNumber()) throw invalid(`Only ${D(l.issued_qty).toString()} issued on this line: one serial per part.`, { field: "serial_no" });
    for (const s of serials) {
      const dup = (await c.query("SELECT 1 FROM part_serial WHERE item_id = $1 AND upper(btrim(serial_no)) = upper(btrim($2))", [l.item_id, s])).rowCount;
      if (dup) throw invalid(`Serial ${s} is already recorded for ${l.part_no}.`, { field: "serial_no" });
      await c.query(
        `INSERT INTO part_serial (branch_id, item_id, serial_no, job_card_id, job_line_id, customer_id, vehicle_id, warranty_until, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::int > 0 THEN current_date + make_interval(months => $8::int) END, $9)`,
        [l.branch_id, l.item_id, s, l.job_card_id, l.id, l.customer_id, l.vehicle_id, l.warranty_months ?? 0, ctx.userId]);
    }
    await audit(c, ctx, "job_line", lineId, "serial_recorded", { serials });
    return { count: serials.length };
  });
}

/** IN-03: looks up a battery or tyre by serial: who has it and whether it is still under warranty. */
export async function findSerial(ctx: Ctx, q: string) {
  const s = q.trim();
  if (s.length < 3) return [];
  return withTx(ctx, async (c) => (await c.query(
    `SELECT ps.serial_no, ps.fitted_on, ps.warranty_until, ps.warranty_until >= current_date under_warranty, i.part_no, i.description,
            j.id job_id, j.doc_no job_no, v.plate_code, v.plate_number, v.make, v.model,
            coalesce(cu.company_name, concat_ws(' ', cu.first_name, cu.last_name)) customer_name
       FROM part_serial ps JOIN item i ON i.id = ps.item_id LEFT JOIN job_card j ON j.id = ps.job_card_id
       LEFT JOIN vehicle v ON v.id = ps.vehicle_id LEFT JOIN customer cu ON cu.id = ps.customer_id
      WHERE upper(ps.serial_no) LIKE upper($1) || '%' ORDER BY ps.fitted_on DESC LIMIT 20`, [s])).rows);
}

type TyreRow = { id: string; part_no: string; description: string; brand: string | null; tyre_size: string | null; load_index: string | null; speed_index: string | null; warranty_months: number | null; on_hand: string };

/** IN-03: tyre stock at this branch by size and DOT, oldest first, flagging tyres past the age limit. */
export async function tyreStock(ctx: Ctx) {
  const b = ctx.currentBranchId;
  assertCan(ctx, "stock", "view", b);
  return withTx(ctx, async (c) => {
    const maxYears = Number(await getSetting(c, "tyres.max_age_years", b, 3)) || 3;
    const items = (await c.query(
      `SELECT i.id, i.part_no, i.description, i.brand, i.tyre_size, i.load_index, i.speed_index, i.warranty_months, coalesce(sb.on_hand, 0) on_hand
         FROM item i LEFT JOIN stock_balance sb ON sb.item_id = i.id AND sb.branch_id = $1
        WHERE i.category = 'tyres' AND i.active ORDER BY i.tyre_size NULLS LAST, i.part_no`, [b])).rows;
    const dots = (await c.query("SELECT item_id, dot_code, qty FROM tyre_dot_stock WHERE branch_id = $1 AND qty > 0 ORDER BY right(dot_code, 2), left(dot_code, 2)", [b])).rows;
    const limit = Date.now() - maxYears * 365.25 * 864e5;
    return {
      maxYears,
      items: items.map((i) => {
        const mine = dots.filter((d) => d.item_id === i.id).map((d) => ({ dot: d.dot_code as string, qty: D(d.qty).toString(), old: dotDate(d.dot_code).getTime() < limit }));
        const tracked = mine.reduce((a, d) => a.plus(d.qty), D(0));
        return { ...(i as TyreRow), dots: mine, untracked: D(i.on_hand).minus(tracked).gt(0) ? D(i.on_hand).minus(tracked).toString() : "0", old: mine.some((d) => d.old) };
      }),
    };
  });
}
