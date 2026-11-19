import { Ctx, canSee } from "../access";
import { withTx } from "../db";
import { forbidden } from "../errors";
import { getSetting } from "./settings";
import { canOpenReport, reportBranches } from "./reports";

export type Range = "today" | "7d" | "30d";
const RANGE_DAYS: Record<Range, number> = { today: 1, "7d": 7, "30d": 30 };

/**
 * Owner dashboard (demo): today, last 7 or last 30 days across the branches this person can see.
 * Tiles with comparisons, sales by branch, cars on site by status, delays by reason, on-time by branch,
 * late jobs now, stock running low and figures by emirate. Money is shown only to roles that may see prices.
 */
export async function ownerOverview(ctx: Ctx, range: Range, branchSel?: string | string[]) {
  if (!canOpenReport(ctx, { module: "jobs" })) throw forbidden("You do not have access to the owner dashboard.");
  return withTx(ctx, async (c) => {
    const br = await reportBranches(c, ctx, { module: "jobs" }, branchSel);
    const ids = br.chosen.map((b) => b.id);
    const showMoney = ids.every((b) => canSee(ctx, "selling_price", b));
    const days = RANGE_DAYS[range] ?? 1;
    const target = Number(await getSetting(c, "ontime.target_pct", null, 92));
    const d = (await c.query(`SELECT (now() AT TIME ZONE 'Asia/Dubai')::date t, ((now() AT TIME ZONE 'Asia/Dubai')::date - $1::int + 1) f, to_char(now() AT TIME ZONE 'Asia/Dubai', 'Dy') dow`, [days])).rows[0];
    const t = d.t, f = d.f;
    const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
    const ontimeSql = `WITH s AS (SELECT coalesce((SELECT value #>> '{}' FROM setting WHERE key = 'ontime.measured_at' AND branch_id IS NULL), 'ready') m)
      SELECT j.branch_id, count(*) FILTER (WHERE x.done <= j.promised_at)::int ok, count(*)::int n
        FROM job_card j CROSS JOIN s CROSS JOIN LATERAL (SELECT CASE WHEN s.m = 'delivered' THEN j.delivered_at ELSE coalesce(j.ready_at, j.delivered_at) END done) x
       WHERE j.branch_id = ANY($1) AND j.promised_at IS NOT NULL AND x.done IS NOT NULL AND (x.done AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3 GROUP BY j.branch_id`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = async (fs: (() => Promise<any[]>)[]) => { const out: any[][] = []; for (const f of fs) out.push(await f()); return out; };
    const [perBranch, prevSales, ontime, onSite, delays, late, cash, low, funnel] = await run([
      () => q(`SELECT b.id, b.code, b.name_en, b.emirate,
           (SELECT coalesce(sum(i.taxable_total), 0) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date BETWEEN $2 AND $3) sales,
           (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND (j.created_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3)::int cars_in,
           (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND (j.delivered_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3)::int cars_out
         FROM branch b WHERE b.id = ANY($1) ORDER BY b.branch_type <> 'head_office', b.code`, [ids, f, t]),
      // Comparison: the same span a week earlier (today against the same weekday last week).
      () => q(`SELECT coalesce(sum(taxable_total), 0) s FROM sales_invoice WHERE branch_id = ANY($1) AND doc_date BETWEEN $2::date - 7 AND $3::date - 7`, [ids, f, t]),
      () => q(ontimeSql, [ids, f, t]),
      () => q(`SELECT status, count(*)::int n FROM job_card WHERE branch_id = ANY($1) AND status IN ('approved','awaiting_parts','in_progress','quality_check','ready') GROUP BY status`, [ids]),
      () => q(`SELECT coalesce(lv.name_en, j.delay_reason) reason, count(*)::int n FROM job_card j LEFT JOIN lookup_value lv ON lv.list = 'delay_reason' AND lv.code = j.delay_reason
          WHERE j.branch_id = ANY($1) AND j.delay_reason IS NOT NULL AND (j.promised_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2::date - 6 AND $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, [ids, t, t]),
      () => q(`SELECT j.id, j.doc_no, coalesce(lv.name_en, j.delay_reason) reason, (SELECT l.description FROM job_line l WHERE l.job_card_id = j.id AND NOT l.removed ORDER BY l.line_no LIMIT 1) what,
                round(extract(epoch FROM now() - j.promised_at) / 3600, 1) hours_late
           FROM job_card j LEFT JOIN lookup_value lv ON lv.list = 'delay_reason' AND lv.code = j.delay_reason
          WHERE j.branch_id = ANY($1) AND j.promised_at < now() AND j.status IN ('approved','awaiting_parts','in_progress','quality_check') ORDER BY j.promised_at LIMIT 8`, [ids]),
      () => q(`SELECT method, coalesce(sum(amount), 0) a FROM receipt WHERE branch_id = ANY($1) AND doc_date BETWEEN $2 AND $3 GROUP BY method`, [ids, f, t]),
      () => q(`SELECT i.description, b.code, coalesce(sb.on_hand - sb.committed - sb.reserved, 0) free, ib.reorder_level
           FROM item_branch ib JOIN item i ON i.id = ib.item_id JOIN branch b ON b.id = ib.branch_id
           LEFT JOIN stock_balance sb ON sb.item_id = ib.item_id AND sb.branch_id = ib.branch_id
          WHERE ib.branch_id = ANY($1) AND ib.reorder_level > 0 AND coalesce(sb.on_hand - sb.committed - sb.reserved, 0) <= ib.reorder_level
          ORDER BY coalesce(sb.on_hand - sb.committed - sb.reserved, 0) / ib.reorder_level, i.description LIMIT 6`, [ids]),
      () => q(`SELECT count(*)::int enquiries,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM quotation q WHERE q.enquiry_id = e.id AND q.status NOT IN ('draft','ready_to_send','pending_internal_approval')))::int quoted,
           count(*) FILTER (WHERE e.status IN ('approved','converted'))::int approved,
           count(*) FILTER (WHERE e.converted_job_id IS NOT NULL)::int job_cards,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_invoice i WHERE i.job_card_id = e.converted_job_id UNION ALL SELECT 1 FROM sales_invoice_job x WHERE x.job_card_id = e.converted_job_id))::int invoiced
         FROM enquiry e WHERE e.branch_id = ANY($1) AND e.doc_date BETWEEN $2 AND $3`, [ids, f, t]),
    ]);
    const sum = (rows: Record<string, unknown>[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const sales = sum(perBranch, "sales"), prev = Number(prevSales[0].s);
    const ok = sum(ontime, "ok"), n = sum(ontime, "n");
    const cashTotal = sum(cash, "a");
    const byId = new Map(ontime.map((o) => [o.branch_id, o]));
    const branches = perBranch.map((b) => { const o = byId.get(b.id); return { ...b, sales: Number(b.sales), on_time: o && o.n ? Math.round((100 * o.ok) / o.n) : null }; });
    const emirates = [...new Set(branches.map((b) => b.emirate))].map((e) => {
      const bs = branches.filter((b) => b.emirate === e);
      const oo = bs.map((b) => byId.get(b.id)).filter(Boolean) as { ok: number; n: number }[];
      const on = oo.reduce((s, o) => s + o.n, 0);
      return { emirate: e, branches: bs.length, sales: bs.reduce((s, b) => s + b.sales, 0), cars_in: bs.reduce((s, b) => s + b.cars_in, 0), on_time: on ? Math.round((100 * oo.reduce((s, o) => s + o.ok, 0)) / on) : null };
    }).sort((a, b) => b.sales - a.sales);
    const hide = <T,>(v: T) => (showMoney ? v : null);
    return {
      range, from: f as string, to: t as string, dow: d.dow as string, showMoney, target, chosen: br.chosen, all: br.all,
      tiles: {
        sales: hide(sales), salesChange: showMoney && prev > 0 ? Math.round(((sales - prev) / prev) * 1000) / 10 : null,
        carsIn: sum(perBranch, "cars_in"), carsOut: sum(perBranch, "cars_out"), onSite: sum(onSite, "n"),
        onTime: n ? Math.round((100 * ok) / n) : null, late: late.length, lateNoReason: late.filter((l) => !l.reason).length,
        cash: hide(cashTotal), cashSplit: showMoney && cashTotal > 0 ? cash.map((x) => ({ method: x.method as string, pct: Math.round((100 * Number(x.a)) / cashTotal) })).sort((a, b) => b.pct - a.pct) : [],
      },
      branches: branches.map((b) => ({ ...b, sales: hide(b.sales) })),
      onSite: onSite as { status: string; n: number }[],
      delays: delays as { reason: string; n: number }[],
      lowestOnTime: branches.filter((b) => b.on_time !== null).sort((a, b) => a.on_time! - b.on_time!).slice(0, 6),
      late, low, emirates: emirates.map((e) => ({ ...e, sales: hide(e.sales) })), funnel: funnel[0],
    };
  });
}

async function ownerScope<R extends object>(ctx: Ctx, range: Range, branchSel: string | string[] | undefined, fn: (c: import("pg").PoolClient, x: { ids: string[]; f: string; t: string; showMoney: boolean; br: Awaited<ReturnType<typeof reportBranches>> }) => Promise<R>) {
  if (!canOpenReport(ctx, { module: "jobs" })) throw forbidden("You do not have access to the owner dashboard.");
  return withTx(ctx, async (c) => {
    const br = await reportBranches(c, ctx, { module: "jobs" }, branchSel);
    const ids = br.chosen.map((b) => b.id);
    const days = RANGE_DAYS[range] ?? 1;
    const d = (await c.query(`SELECT (now() AT TIME ZONE 'Asia/Dubai')::date::text t, ((now() AT TIME ZONE 'Asia/Dubai')::date - $1::int + 1)::text f`, [days])).rows[0];
    const showMoney = ids.every((b) => canSee(ctx, "selling_price", b));
    return { range, from: d.f as string, to: d.t as string, showMoney, chosen: br.chosen, all: br.all, ...(await fn(c, { ids, f: d.f, t: d.t, showMoney, br })) };
  });
}

/** Enquiries by branch: sources, conversion against the target, lost, first reply time and still open. */
export async function ownerEnquiries(ctx: Ctx, range: Range, branchSel?: string | string[]) {
  return ownerScope(ctx, range, branchSel, async (c, { ids, f, t, showMoney }) => {
    const target = Number(await getSetting(c, "enquiry.conversion_target_pct", null, 60));
    const rows = (await c.query(
      `SELECT b.id, b.code, b.name_en, b.emirate,
         count(e.id)::int enquiries,
         count(e.id) FILTER (WHERE e.source = 'whatsapp')::int whatsapp,
         count(e.id) FILTER (WHERE e.source = 'phone')::int phone,
         count(e.id) FILTER (WHERE e.source = 'walk_in')::int walk_in,
         count(e.id) FILTER (WHERE e.source = 'website')::int website,
         count(e.id) FILTER (WHERE e.source NOT IN ('whatsapp','phone','walk_in','website'))::int other,
         count(e.id) FILTER (WHERE e.converted_job_id IS NOT NULL)::int converted,
         count(e.id) FILTER (WHERE e.status = 'lost')::int lost,
         count(e.id) FILTER (WHERE e.status NOT IN ('lost','converted','closed','cancelled') AND e.converted_job_id IS NULL)::int open,
         round(avg(extract(epoch FROM r.first_at - e.created_at) / 60) FILTER (WHERE r.first_at >= e.created_at))::int reply_min,
         coalesce(sum(v.value), 0) job_value
       FROM branch b
       LEFT JOIN enquiry e ON e.branch_id = b.id AND e.doc_date BETWEEN $2 AND $3
       LEFT JOIN LATERAL (SELECT min(m.at) first_at FROM message_log m WHERE m.enquiry_id = e.id) r ON true
       LEFT JOIN LATERAL (SELECT sum(sil.taxable_amount) value FROM sales_invoice_line sil JOIN job_line jl ON jl.id = sil.job_line_id WHERE e.converted_job_id IS NOT NULL AND jl.job_card_id = e.converted_job_id) v ON true
       WHERE b.id = ANY($1) GROUP BY b.id ORDER BY b.branch_type <> 'head_office', b.code`, [ids, f, t])).rows
      .map((r) => ({ ...r, job_value: showMoney ? Number(r.job_value) : null, conversion: r.enquiries ? Math.round((100 * r.converted) / r.enquiries) : null }));
    const asked = (await c.query(`SELECT coalesce(nullif(trim(service_asked), ''), 'Not said') what, count(*)::int n FROM enquiry WHERE branch_id = ANY($1) AND doc_date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, [ids, f, t])).rows;
    const lost = (await c.query(`SELECT coalesce(lv.name_en, e.lost_reason, 'No reason given') reason, count(*)::int n FROM enquiry e LEFT JOIN lookup_value lv ON lv.list = 'lost_reason' AND lv.code = e.lost_reason
       WHERE e.branch_id = ANY($1) AND e.doc_date BETWEEN $2 AND $3 AND e.status = 'lost' GROUP BY 1 ORDER BY 2 DESC`, [ids, f, t])).rows;
    const openList = ids.length === 1 ? (await c.query(`SELECT e.id, e.doc_no, coalesce(e.contact_name, '') who, coalesce(e.service_asked, '') what, e.source, e.status, to_char(e.created_at AT TIME ZONE 'Asia/Dubai', 'DD/MM HH24:MI') at
       FROM enquiry e WHERE e.branch_id = $1 AND e.status NOT IN ('lost','converted','closed','cancelled') AND e.converted_job_id IS NULL ORDER BY e.created_at DESC LIMIT 8`, [ids[0]])).rows : [];
    const tot = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const replies = rows.filter((r) => r.reply_min !== null);
    return {
      target, rows, asked, lost, openList,
      totals: { enquiries: tot("enquiries"), converted: tot("converted"), lost: tot("lost"), open: tot("open"),
        conversion: tot("enquiries") ? Math.round((100 * tot("converted")) / tot("enquiries")) : null,
        reply_min: replies.length ? Math.round(replies.reduce((s, r) => s + Number(r.reply_min), 0) / replies.length) : null },
    };
  });
}

/** Branch details: bays, technicians, bay use, customers (active, new, returning) and average spend. */
export async function ownerBranchDetails(ctx: Ctx, range: Range, branchSel?: string | string[]) {
  return ownerScope(ctx, range, branchSel, async (c, { ids, f, t, showMoney }) => {
    const days = RANGE_DAYS[range] ?? 1;
    const rows = (await c.query(
      `WITH s AS (SELECT coalesce((SELECT value #>> '{}' FROM setting WHERE key = 'ontime.measured_at' AND branch_id IS NULL), 'ready') m)
       SELECT b.id, b.code, b.name_en, b.emirate, b.opening_hours,
         (SELECT count(*) FROM bay WHERE bay.branch_id = b.id AND bay.active)::int bays,
         (SELECT coalesce(sum(capacity_hours), 0) FROM bay WHERE bay.branch_id = b.id AND bay.active) bay_hours,
         (SELECT count(DISTINCT ubr.user_id) FROM user_branch_role ubr JOIN role r ON r.id = ubr.role_id JOIN app_user u ON u.id = ubr.user_id
            WHERE ubr.branch_id = b.id AND u.status = 'active' AND r.code IN ('technician','foreman'))::int technicians,
         (SELECT coalesce(sum(taxable_total), 0) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date BETWEEN $2 AND $3) sales,
         (SELECT count(*) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date BETWEEN $2 AND $3)::int invoices,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND (j.created_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3)::int cars_in,
         (SELECT coalesce(sum(extract(epoch FROM coalesce(x.nx, now()) - x.at)), 0) / 3600 FROM (SELECT e.kind, e.at, lead(e.at) OVER (PARTITION BY e.technician_id, e.job_line_id ORDER BY e.at) nx
            FROM time_event e WHERE e.branch_id = b.id AND (e.at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3) x WHERE x.kind IN ('clock_in','resume')) worked_h,
         (SELECT count(DISTINCT i.customer_id) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date BETWEEN $2 AND $3)::int active_customers,
         (SELECT count(DISTINCT i.customer_id) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM sales_invoice p WHERE p.customer_id = i.customer_id AND p.doc_date < $2))::int new_customers,
         (SELECT round(100.0 * count(*) FILTER (WHERE x.done <= x.promised_at) / nullif(count(*), 0))
            FROM (SELECT j.promised_at, CASE WHEN s.m = 'delivered' THEN j.delivered_at ELSE coalesce(j.ready_at, j.delivered_at) END done FROM job_card j, s
                   WHERE j.branch_id = b.id AND j.promised_at IS NOT NULL) x WHERE x.done IS NOT NULL AND (x.done AT TIME ZONE 'Asia/Dubai')::date BETWEEN $2 AND $3)::int on_time,
         (SELECT string_agg(DISTINCT left(j.doc_no, position('-' IN j.doc_no)), ', ') FROM job_card j WHERE j.branch_id = b.id) series
       FROM branch b WHERE b.id = ANY($1) ORDER BY b.branch_type <> 'head_office', b.code`, [ids, f, t])).rows
      .map((r) => {
        const cap = Number(r.bay_hours) * days;
        return { ...r, sales: showMoney ? Number(r.sales) : null, bay_hours: undefined, worked_h: undefined, _cap: cap, _worked: Number(r.worked_h),
          bay_use: cap > 0 ? Math.min(100, Math.round((100 * Number(r.worked_h)) / cap)) : null,
          returning: r.active_customers ? Math.round((100 * (r.active_customers - r.new_customers)) / r.active_customers) : null,
          avg_spend: showMoney && r.invoices ? Math.round(Number(r.sales) / r.invoices) : null };
      });
    const raw = rows as unknown as { _cap: number; _worked: number }[];
    const capAll = raw.reduce((s, r) => s + r._cap, 0), workedAll = raw.reduce((s, r) => s + r._worked, 0);
    const tot = (k: string) => rows.reduce((s, r) => s + Number((r as Record<string, unknown>)[k] ?? 0), 0);
    const avgOf = (k: "bay_use" | "on_time" | "returning" | "avg_spend") => { const v = rows.map((r) => r[k]).filter((x) => x !== null && x !== undefined) as number[]; return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
    return {
      rows,
      totals: { bays: tot("bays"), technicians: tot("technicians"), active: tot("active_customers"), new: tot("new_customers"),
        bay_use: capAll > 0 ? Math.min(100, Math.round((100 * workedAll) / capAll)) : null, returning: tot("active_customers") ? Math.round((100 * (tot("active_customers") - tot("new_customers"))) / tot("active_customers")) : null, on_time: avgOf("on_time"),
        avg_spend: showMoney && tot("invoices") ? Math.round(rows.reduce((s, r) => s + Number(r.sales ?? 0), 0) / tot("invoices")) : null },
    };
  });
}
