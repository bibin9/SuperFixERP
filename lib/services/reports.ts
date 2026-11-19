import type { PoolClient } from "pg";
import { Ctx, Screen, can, canSee } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { getSetting } from "./settings";
import { clockedMinutes } from "./workshop";
import { attendanceDays } from "./hr-time";

/**
 * M16 standard reports (FSD 4.16). Each report is a definition in the registry below: its columns, the
 * filters that apply (branch, dates, advisor, technician, extra choices), the module it belongs to, and a
 * parameterised query. One runner applies the rules every report shares:
 *  - branch access: only branches where the user may view reports AND the report's module;
 *  - field permissions: a column in a hidden field group (selling price, cost, salary...) is dropped
 *    from the rows before they leave the server, for screen, print and export alike (RB-11);
 *  - the data source selector: Live (default), Archived, or one archive run (AR-04).
 */

export type ColType = "text" | "money" | "num" | "int" | "date" | "pct" | "status" | "hours";
export type Col = { key: string; label: string; type?: ColType; group?: string; total?: boolean };
export type Row = Record<string, unknown>;
export type Area = "Owner" | "Workshop" | "Technicians" | "Sales" | "Customers" | "Parts" | "Purchasing" | "Finance" | "HR and payroll" | "Approvals";
export type Filters = { from: string; to: string; branches: string[]; advisor: string; technician: string; source: string; x: Record<string, string> };
type Extra = { key: string; label: string; options: [string, string][]; def: string };

class P {
  v: unknown[] = [];
  add(x: unknown) { this.v.push(x); return `$${this.v.length}`; }
}

export type ReportDef = {
  code: string; area: Area; name: string; desc: string; trace?: string;
  module: Screen; salary?: boolean;
  dates: "range" | "none"; dateLabel?: string; defaultRange?: "month" | "next_service" | "year";
  people?: ("advisor" | "technician")[];
  archive?: string;
  extra?: Extra[];
  columns: Col[] | ((f: Filters) => Col[]);
  query?: (f: Filters, p: P) => string;
  compute?: (c: PoolClient, f: Filters) => Promise<Row[]>;
  link?: (r: Row) => string | null;
  rowAction?: "service_due";
  chart?: { x: string; y: string; type: "bar" | "line" | "pie" };
};

// ---------------------------------------------------------------- SQL fragments
const CUST = (c = "c") => `CASE WHEN ${c}.customer_type = 'individual' THEN concat_ws(' ', ${c}.title, ${c}.first_name, ${c}.last_name) ELSE ${c}.company_name END`;
const PLATE = (v = "v") => `concat_ws(' ', ${v}.registered_in, ${v}.plate_code, ${v}.plate_number)`;
const EMP = (e = "e") => `concat_ws(' ', ${e}.first_name, ${e}.last_name)`;
const D = (x: string) => `to_char(${x}, 'YYYY-MM-DD')`;

/** Live / Archived / one archive run (AR-04). */
function arch(f: Filters, p: P, tbl: string, idExpr: string) {
  const sub = `SELECT 1 FROM archive_member am WHERE am.tbl = '${tbl}' AND am.row_id = ${idExpr}::text`;
  if (!f.source || f.source === "live") return `NOT EXISTS (${sub})`;
  if (f.source === "archived") return `EXISTS (${sub})`;
  return `EXISTS (${sub} AND am.run_id = ${p.add(f.source)})`;
}
type W = { date?: string; branch?: string; advisor?: string; technician?: string; arch?: [string, string] };
function where(f: Filters, p: P, w: W, more: string[] = []) {
  const out: string[] = [];
  if (w.date) out.push(`${w.date} BETWEEN ${p.add(f.from)}::date AND ${p.add(f.to)}::date`);
  if (w.branch) out.push(`${w.branch} = ANY(${p.add(f.branches)}::uuid[])`);
  if (w.advisor && f.advisor) out.push(`${w.advisor} = ${p.add(f.advisor)}`);
  if (w.technician && f.technician) out.push(w.technician.replace(/\$T/g, p.add(f.technician)));
  if (w.arch) out.push(arch(f, p, w.arch[0], w.arch[1]));
  return [...out, ...more].join(" AND ") || "true";
}
const JOB_TECH = "EXISTS (SELECT 1 FROM job_assignment ja JOIN job_line jl ON jl.id = ja.job_line_id WHERE jl.job_card_id = j.id AND ja.technician_id = $T)";
const money = (key: string, label: string, group = "selling_price"): Col => ({ key, label, type: "money", group, total: true });
const int = (key: string, label: string): Col => ({ key, label, type: "int", total: true });

// ---------------------------------------------------------------- the registry
const REPORTS: ReportDef[] = [
  // ---------------- Workshop
  {
    code: "jobs_by_status", area: "Workshop", name: "Jobs by status", desc: "Job cards opened in the period by branch and status, with their average age.",
    module: "jobs", dates: "range", people: ["advisor", "technician"], archive: "job_card",
    columns: [{ key: "branch", label: "Branch" }, { key: "status", label: "Status", type: "status" }, int("jobs", "Jobs"), { key: "avg_age_days", label: "Average age (days)", type: "num" }],
    query: (f, p) => `SELECT b.code branch, j.status, count(*)::int jobs, round(avg(extract(epoch FROM coalesce(j.delivered_at, now()) - j.created_at) / 86400)::numeric, 1) avg_age_days
      FROM job_card j JOIN branch b ON b.id = j.branch_id
      WHERE ${where(f, p, { date: "j.doc_date", branch: "j.branch_id", advisor: "j.advisor_id", technician: JOB_TECH, arch: ["job_card", "j.id"] })}
      GROUP BY b.code, j.status ORDER BY b.code, j.status`,
    chart: { x: "status", y: "jobs", type: "bar" },
  },
  {
    code: "job_list", area: "Workshop", name: "Job card list", desc: "Every job card in the period with promised, ready and delivered times and whether it was on time.",
    module: "jobs", dates: "range", people: ["advisor", "technician"], archive: "job_card",
    extra: [{ key: "status", label: "Status", def: "", options: [["", "Any status"], ["open", "Open (not delivered)"], ["late", "Late now"], ["delivered", "Delivered or closed"]] }],
    columns: [{ key: "doc_no", label: "Job card" }, { key: "doc_date", label: "Date", type: "date" }, { key: "branch", label: "Branch" }, { key: "plate", label: "Plate" },
      { key: "customer", label: "Customer" }, { key: "advisor", label: "Advisor" }, { key: "status", label: "Status", type: "status" },
      { key: "promised", label: "Promised" }, { key: "ready", label: "Ready" }, { key: "delivered", label: "Delivered" }, { key: "on_time", label: "On time" }],
    query: (f, p) => {
      const st = f.x.status === "open" ? "j.status NOT IN ('delivered','invoiced','closed','cancelled')" : f.x.status === "late" ? "j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled')"
        : f.x.status === "delivered" ? "j.status IN ('delivered','invoiced','closed')" : "true";
      return `SELECT j.id, j.doc_no, ${D("j.doc_date")} doc_date, b.code branch, ${PLATE()} plate, ${CUST()} customer, u.full_name advisor, j.status,
        to_char(j.promised_at, 'DD/MM HH24:MI') promised, to_char(j.ready_at, 'DD/MM HH24:MI') ready, to_char(j.delivered_at, 'DD/MM HH24:MI') delivered,
        CASE WHEN j.promised_at IS NULL OR coalesce(j.ready_at, j.delivered_at) IS NULL THEN '' WHEN coalesce(j.ready_at, j.delivered_at) <= j.promised_at THEN 'Yes' ELSE 'No' END on_time
        FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id LEFT JOIN app_user u ON u.id = j.advisor_id
        WHERE ${where(f, p, { date: "j.doc_date", branch: "j.branch_id", advisor: "j.advisor_id", technician: JOB_TECH, arch: ["job_card", "j.id"] }, [st])}
        ORDER BY j.doc_date DESC, j.doc_no DESC`;
    },
    link: (r) => `/jobs/${r.id}`,
  },
  {
    code: "turnaround", area: "Workshop", name: "Turnaround and on-time delivery", desc: "Hours from job card to ready (or delivered, per the on-time setting) and the share finished by the promised time.",
    module: "jobs", dates: "range", people: ["advisor"], archive: "job_card",
    columns: [{ key: "branch", label: "Branch" }, int("jobs", "Jobs"), int("completed", "Completed"), { key: "avg_hours", label: "Average hours", type: "num" },
      int("on_time", "On time"), int("late", "Late"), { key: "on_time_pct", label: "On time %", type: "pct" }],
    query: (f, p) => `WITH s AS (SELECT coalesce((SELECT value #>> '{}' FROM setting WHERE key = 'ontime.measured_at' AND branch_id IS NULL), 'ready') m),
      x AS (SELECT j.branch_id, j.created_at, j.promised_at, CASE WHEN s.m = 'delivered' THEN j.delivered_at ELSE coalesce(j.ready_at, j.delivered_at) END done_at
              FROM job_card j, s WHERE j.status <> 'cancelled' AND ${where(f, p, { date: "j.doc_date", branch: "j.branch_id", advisor: "j.advisor_id", arch: ["job_card", "j.id"] })})
      SELECT b.code branch, count(*)::int jobs, count(x.done_at)::int completed, round(avg(extract(epoch FROM x.done_at - x.created_at) / 3600)::numeric, 1) avg_hours,
        count(*) FILTER (WHERE done_at <= promised_at)::int on_time, count(*) FILTER (WHERE done_at > promised_at OR (done_at IS NULL AND promised_at < now()))::int late,
        round(100.0 * count(*) FILTER (WHERE done_at <= promised_at) / nullif(count(*) FILTER (WHERE done_at IS NOT NULL AND promised_at IS NOT NULL), 0), 1) on_time_pct
      FROM x JOIN branch b ON b.id = x.branch_id GROUP BY b.code ORDER BY b.code`,
    chart: { x: "branch", y: "on_time_pct", type: "bar" },
  },
  {
    code: "delays", area: "Workshop", name: "Delays by reason", desc: "Job cards that passed their promised time, grouped by the delay reason recorded.",
    module: "jobs", dates: "range", people: ["advisor"], archive: "job_card",
    columns: [{ key: "branch", label: "Branch" }, { key: "reason", label: "Delay reason", type: "status" }, int("jobs", "Jobs"), { key: "avg_hours_late", label: "Average hours late", type: "num" }],
    query: (f, p) => `SELECT b.code branch, coalesce(j.delay_reason, 'not_given') reason, count(*)::int jobs,
        round(avg(extract(epoch FROM coalesce(j.ready_at, j.delivered_at, now()) - j.promised_at) / 3600)::numeric, 1) avg_hours_late
      FROM job_card j JOIN branch b ON b.id = j.branch_id
      WHERE ${where(f, p, { date: "j.doc_date", branch: "j.branch_id", advisor: "j.advisor_id", arch: ["job_card", "j.id"] },
        ["(j.delay_reason IS NOT NULL OR coalesce(j.ready_at, j.delivered_at, now()) > j.promised_at)", "j.status <> 'cancelled'"])}
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    chart: { x: "reason", y: "jobs", type: "pie" },
  },
  {
    code: "comebacks", area: "Workshop", name: "Comebacks", desc: "Job cards opened as a comeback on an earlier job, and how many days after it.",
    module: "jobs", dates: "range", people: ["advisor"], archive: "job_card",
    columns: [{ key: "doc_no", label: "Job card" }, { key: "doc_date", label: "Date", type: "date" }, { key: "branch", label: "Branch" }, { key: "plate", label: "Plate" },
      { key: "original_job", label: "Earlier job" }, { key: "original_date", label: "Earlier date", type: "date" }, { key: "days_after", label: "Days after", type: "int" },
      { key: "advisor", label: "Advisor" }, { key: "complaints", label: "Complaint" }],
    query: (f, p) => `SELECT j.id, j.doc_no, ${D("j.doc_date")} doc_date, b.code branch, ${PLATE()} plate, o.doc_no original_job, ${D("o.doc_date")} original_date,
        (j.doc_date - o.doc_date)::int days_after, u.full_name advisor, j.complaints
      FROM job_card j JOIN job_card o ON o.id = j.original_job_id JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id LEFT JOIN app_user u ON u.id = j.advisor_id
      WHERE ${where(f, p, { date: "j.doc_date", branch: "j.branch_id", advisor: "j.advisor_id", arch: ["job_card", "j.id"] })} ORDER BY j.doc_date DESC`,
    link: (r) => `/jobs/${r.id}`,
  },
  {
    code: "jobs_by_complaint", area: "Workshop", name: "Jobs by customer complaint", desc: "How many job cards came in with each complaint from the complaint list, by branch, and how many of them were comebacks.",
    module: "jobs", dates: "range", people: ["advisor"], archive: "job_card",
    columns: [{ key: "complaint_group", label: "Group" }, { key: "complaint", label: "Complaint" }, { key: "branch", label: "Branch" }, int("jobs", "Job cards"), int("comebacks", "Comebacks"),
      { key: "last_date", label: "Last seen", type: "date" }],
    query: (f, p) => `SELECT cc.group_name complaint_group, cc.name_en complaint, b.code branch, count(*)::int jobs, count(*) FILTER (WHERE j.original_job_id IS NOT NULL)::int comebacks,
        ${D("max(j.doc_date)")} last_date
      FROM job_card j JOIN branch b ON b.id = j.branch_id JOIN customer_complaint cc ON j.complaints ILIKE '%' || cc.name_en || '%'
      WHERE ${where(f, p, { date: "j.doc_date", branch: "j.branch_id", advisor: "j.advisor_id", arch: ["job_card", "j.id"] }, ["j.status <> 'cancelled'"])}
      GROUP BY 1, 2, 3 ORDER BY 4 DESC, 2`,
    chart: { x: "complaint", y: "jobs", type: "bar" },
  },
  {
    code: "bay_use", area: "Workshop", name: "Bay use", desc: "Hours planned and booked on each bay against its capacity for the days chosen.",
    module: "workshop", dates: "range",
    columns: [{ key: "branch", label: "Branch" }, { key: "bay", label: "Bay" }, { key: "bay_type", label: "Type", type: "status" }, { key: "capacity_h", label: "Capacity hours", type: "hours", total: true },
      { key: "planned_h", label: "Job hours planned", type: "hours", total: true }, { key: "booked_h", label: "Booking hours", type: "hours", total: true }, int("jobs", "Jobs"), { key: "use_pct", label: "Use %", type: "pct" }],
    query: (f, p) => {
      const fr = p.add(f.from), to = p.add(f.to);
      return `WITH pl AS (SELECT DISTINCT ja.bay_id, jl.id, jl.job_card_id, coalesce(jl.standard_hours, 0) h FROM job_assignment ja JOIN job_line jl ON jl.id = ja.job_line_id
                 WHERE ja.bay_id IS NOT NULL AND NOT jl.removed AND coalesce(ja.planned_start, ja.assigned_at)::date BETWEEN ${fr}::date AND ${to}::date),
        bk AS (SELECT booking_bay_id bay_id, sum(booking_hours) h FROM enquiry WHERE booking_status IN ('booked','checked_in') AND booked_for::date BETWEEN ${fr}::date AND ${to}::date GROUP BY 1)
      SELECT b.code branch, y.code bay, y.bay_type, y.capacity_hours * (${to}::date - ${fr}::date + 1) capacity_h, coalesce(sum(pl.h), 0) planned_h, coalesce(max(bk.h), 0) booked_h,
        count(DISTINCT pl.job_card_id)::int jobs, round(100 * (coalesce(sum(pl.h), 0) + coalesce(max(bk.h), 0)) / nullif(y.capacity_hours * (${to}::date - ${fr}::date + 1), 0), 1) use_pct
      FROM bay y JOIN branch b ON b.id = y.branch_id LEFT JOIN pl ON pl.bay_id = y.id LEFT JOIN bk ON bk.bay_id = y.id
      WHERE y.active AND y.branch_id = ANY(${p.add(f.branches)}::uuid[]) GROUP BY b.code, y.id ORDER BY b.code, y.code`;
    },
    chart: { x: "bay", y: "use_pct", type: "bar" },
  },
  // ---------------- Technicians
  {
    code: "tech_efficiency", area: "Technicians", name: "Technician efficiency and productivity", desc: "Standard hours of the work done against hours clocked (efficiency), and hours clocked against hours available (productivity).",
    module: "workshop", dates: "range", people: ["technician"],
    columns: [{ key: "technician", label: "Technician" }, { key: "branch", label: "Branch" }, int("lines", "Job lines"), { key: "standard_h", label: "Standard hours", type: "hours", total: true },
      { key: "actual_h", label: "Clocked hours", type: "hours", total: true }, { key: "efficiency_pct", label: "Efficiency %", type: "pct" },
      { key: "available_h", label: "Hours available", type: "hours", total: true }, { key: "productivity_pct", label: "Productivity %", type: "pct" }, { key: "idle_h", label: "Paused hours", type: "hours", total: true }],
    compute: (c, f) => techTime(c, f, "efficiency"),
    chart: { x: "technician", y: "efficiency_pct", type: "bar" },
  },
  {
    code: "tech_idle", area: "Technicians", name: "Idle time by reason", desc: "Time technicians paused work, by the reason they chose when pausing.",
    module: "workshop", dates: "range", people: ["technician"],
    columns: [{ key: "technician", label: "Technician" }, { key: "reason", label: "Reason", type: "status" }, { key: "hours", label: "Hours", type: "hours", total: true }],
    compute: (c, f) => techTime(c, f, "idle"),
    chart: { x: "reason", y: "hours", type: "pie" },
  },
  // ---------------- Sales
  {
    code: "sales_register", area: "Sales", name: "Sales report", trace: "TR-02", desc: "Sales by date, branch, customer, item, service or advisor with net, VAT and gross, in detail or summary.",
    module: "invoices", dates: "range", people: ["advisor"], archive: "sales_invoice",
    extra: [{ key: "by", label: "Show", def: "detail", options: [["detail", "Each invoice"], ["day", "By day"], ["branch", "By branch"], ["customer", "By customer"], ["advisor", "By advisor"], ["item", "By item (parts)"], ["service", "By service (labour)"]] }],
    columns: (f) => {
      const by = f.x.by || "detail";
      const amts = [money("net", "Net"), money("vat", "VAT"), money("gross", "Gross")];
      if (by === "detail") return [{ key: "doc_no", label: "Invoice" }, { key: "doc_date", label: "Date", type: "date" }, { key: "branch", label: "Branch" }, { key: "customer", label: "Customer" },
        { key: "advisor", label: "Advisor" }, ...amts, money("paid", "Paid"), money("open", "Open")];
      if (by === "item") return [{ key: "part_no", label: "Part no." }, { key: "label", label: "Item" }, { key: "qty", label: "Quantity", type: "num", total: true }, ...amts];
      if (by === "service") return [{ key: "label", label: "Service" }, { key: "qty", label: "Hours or quantity", type: "num", total: true }, ...amts];
      return [{ key: "label", label: by === "day" ? "Date" : by === "branch" ? "Branch" : by === "customer" ? "Customer" : "Advisor", type: by === "day" ? "date" : "text" }, int("invoices", "Invoices"), ...amts];
    },
    query: (f, p) => {
      const by = f.x.by || "detail";
      const w = where(f, p, { date: "i.doc_date", branch: "i.branch_id", advisor: "j.advisor_id", arch: ["sales_invoice", "i.id"] });
      const base = `FROM sales_invoice i JOIN branch b ON b.id = i.branch_id LEFT JOIN customer c ON c.id = i.customer_id LEFT JOIN job_card j ON j.id = i.job_card_id LEFT JOIN app_user u ON u.id = j.advisor_id`;
      if (by === "detail") return `SELECT i.id, i.doc_no, ${D("i.doc_date")} doc_date, b.code branch, coalesce(i.bill_to_name, ${CUST()}) customer, u.full_name advisor,
          i.taxable_total net, i.vat_total vat, i.grand_total gross, i.paid_amount paid, i.grand_total - i.paid_amount - i.credited_amount open ${base} WHERE ${w} ORDER BY i.doc_date, i.doc_no`;
      if (by === "item" || by === "service") {
        const lb = by === "item" ? "it.description" : "coalesce(s.name_en, l.description)";
        return `SELECT ${by === "item" ? "it.part_no," : ""} ${lb} label, sum(l.qty) qty, sum(l.taxable_amount) net, sum(l.vat_amount) vat, sum(l.line_total) gross
          ${base} JOIN sales_invoice_line l ON l.invoice_id = i.id LEFT JOIN item it ON it.id = l.item_id LEFT JOIN job_line jl ON jl.id = l.job_line_id LEFT JOIN service s ON s.id = jl.service_id
          WHERE ${w} AND ${by === "item" ? "l.item_id IS NOT NULL" : "l.line_type = 'labour'"} GROUP BY ${by === "item" ? "it.part_no, " : ""}${lb} ORDER BY net DESC`;
      }
      const g = by === "day" ? D("i.doc_date") : by === "branch" ? "b.code" : by === "customer" ? `coalesce(i.bill_to_name, ${CUST()})` : "coalesce(u.full_name, 'Counter sale')";
      return `SELECT ${g} label, count(*)::int invoices, sum(i.taxable_total) net, sum(i.vat_total) vat, sum(i.grand_total) gross ${base} WHERE ${w} GROUP BY 1 ORDER BY 1`;
    },
    link: (r) => (r.id ? `/invoices/${r.id}` : null),
    chart: { x: "label", y: "net", type: "bar" },
  },
  {
    code: "sales_summary", area: "Sales", name: "Sales summary, labour and parts mix", desc: "Per branch: invoices, net sales, average invoice, labour against parts and other.",
    module: "invoices", dates: "range", people: ["advisor"], archive: "sales_invoice",
    columns: [{ key: "branch", label: "Branch" }, int("invoices", "Invoices"), money("net", "Net sales"), money("avg_invoice", "Average invoice"), money("labour", "Labour"),
      money("parts", "Parts"), money("other", "Outside work and consumables"), { key: "labour_pct", label: "Labour %", type: "pct" }],
    query: (f, p) => `SELECT b.code branch, count(DISTINCT i.id)::int invoices, sum(l.taxable_amount) net, round(sum(l.taxable_amount) / nullif(count(DISTINCT i.id), 0), 2) avg_invoice,
        coalesce(sum(l.taxable_amount) FILTER (WHERE l.line_type = 'labour'), 0) labour, coalesce(sum(l.taxable_amount) FILTER (WHERE l.line_type = 'part'), 0) parts,
        coalesce(sum(l.taxable_amount) FILTER (WHERE l.line_type NOT IN ('labour','part')), 0) other,
        round(100 * coalesce(sum(l.taxable_amount) FILTER (WHERE l.line_type = 'labour'), 0) / nullif(sum(l.taxable_amount), 0), 1) labour_pct
      FROM sales_invoice i JOIN sales_invoice_line l ON l.invoice_id = i.id JOIN branch b ON b.id = i.branch_id LEFT JOIN job_card j ON j.id = i.job_card_id
      WHERE ${where(f, p, { date: "i.doc_date", branch: "i.branch_id", advisor: "j.advisor_id", arch: ["sales_invoice", "i.id"] })} GROUP BY b.code ORDER BY b.code`,
    chart: { x: "branch", y: "net", type: "bar" },
  },
  {
    code: "revenue_by_service", area: "Sales", name: "Revenue by service", desc: "Labour sales by service with its share of all labour.",
    module: "invoices", dates: "range", people: ["advisor"], archive: "sales_invoice",
    columns: [{ key: "service", label: "Service" }, { key: "category", label: "Category" }, int("invoices", "Invoices"), { key: "hours", label: "Hours", type: "num", total: true }, money("net", "Net"), { key: "share_pct", label: "Share %", type: "pct" }],
    query: (f, p) => `SELECT coalesce(s.name_en, l.description) service, coalesce(s.category, '') category, count(DISTINCT i.id)::int invoices, sum(l.qty) hours, sum(l.taxable_amount) net,
        round(100 * sum(l.taxable_amount) / nullif(sum(sum(l.taxable_amount)) OVER (), 0), 1) share_pct
      FROM sales_invoice i JOIN sales_invoice_line l ON l.invoice_id = i.id LEFT JOIN job_line jl ON jl.id = l.job_line_id LEFT JOIN service s ON s.id = jl.service_id LEFT JOIN job_card j ON j.id = i.job_card_id
      WHERE ${where(f, p, { date: "i.doc_date", branch: "i.branch_id", advisor: "j.advisor_id", arch: ["sales_invoice", "i.id"] }, ["l.line_type = 'labour'"])} GROUP BY 1, 2 ORDER BY net DESC`,
    chart: { x: "service", y: "net", type: "pie" },
  },
  {
    code: "quote_conversion", area: "Sales", name: "Quotation conversion", desc: "Quotations by branch and advisor: approved, declined and open, with the value quoted and approved.",
    module: "jobs", dates: "range", people: ["advisor"], archive: "quotation",
    columns: [{ key: "branch", label: "Branch" }, { key: "advisor", label: "Advisor" }, int("quotations", "Quotations"), int("approved", "Approved"), int("declined", "Declined"), int("open", "Open"),
      { key: "conversion_pct", label: "Conversion %", type: "pct" }, money("quoted_value", "Quoted"), money("approved_value", "Approved value")],
    query: (f, p) => `SELECT b.code branch, coalesce(u.full_name, '') advisor, count(*)::int quotations,
        count(*) FILTER (WHERE q.status IN ('approved','partly_approved'))::int approved, count(*) FILTER (WHERE q.status = 'declined')::int declined,
        count(*) FILTER (WHERE q.status IN ('draft','ready_to_send','sent','pending_internal_approval'))::int open,
        round(100.0 * count(*) FILTER (WHERE q.status IN ('approved','partly_approved')) / nullif(count(*) FILTER (WHERE q.status NOT IN ('draft','ready_to_send','pending_internal_approval')), 0), 1) conversion_pct,
        sum(q.grand_total) quoted_value, coalesce(sum(q.approved_total), 0) approved_value
      FROM quotation q JOIN branch b ON b.id = q.branch_id LEFT JOIN app_user u ON u.id = q.created_by
      WHERE ${where(f, p, { date: "q.doc_date", branch: "q.branch_id", advisor: "q.created_by", arch: ["quotation", "q.id"] }, ["q.status <> 'superseded'"])} GROUP BY 1, 2 ORDER BY 1, 2`,
    chart: { x: "advisor", y: "conversion_pct", type: "bar" },
  },
  {
    code: "discounts", area: "Sales", name: "Discounts given", desc: "Invoice lines sold with a discount, the amount and the discount %.",
    module: "invoices", dates: "range", people: ["advisor"], archive: "sales_invoice",
    columns: [{ key: "doc_no", label: "Invoice" }, { key: "doc_date", label: "Date", type: "date" }, { key: "branch", label: "Branch" }, { key: "customer", label: "Customer" }, { key: "advisor", label: "Advisor" },
      { key: "description", label: "Line" }, money("before_discount", "Before discount"), money("discount", "Discount", "discount"), { key: "discount_pct", label: "Discount %", type: "pct", group: "discount" }],
    query: (f, p) => `SELECT i.id, i.doc_no, ${D("i.doc_date")} doc_date, b.code branch, coalesce(i.bill_to_name, ${CUST()}) customer, u.full_name advisor, l.description,
        round(l.qty * l.unit_price, 2) before_discount, l.discount_amount discount, round(100 * l.discount_amount / nullif(l.qty * l.unit_price, 0), 1) discount_pct
      FROM sales_invoice i JOIN sales_invoice_line l ON l.invoice_id = i.id JOIN branch b ON b.id = i.branch_id LEFT JOIN customer c ON c.id = i.customer_id
        LEFT JOIN job_card j ON j.id = i.job_card_id LEFT JOIN app_user u ON u.id = j.advisor_id
      WHERE ${where(f, p, { date: "i.doc_date", branch: "i.branch_id", advisor: "j.advisor_id", arch: ["sales_invoice", "i.id"] }, ["l.discount_amount > 0"])} ORDER BY i.doc_date, i.doc_no`,
    link: (r) => `/invoices/${r.id}`,
  },
  {
    code: "enquiry_conversion", area: "Sales", name: "Enquiry conversion", desc: "Enquiries by branch and source: quoted, approved, turned into job cards, and lost.",
    module: "customers", dates: "range", people: ["advisor"],
    columns: [{ key: "branch", label: "Branch" }, { key: "source", label: "Source", type: "status" }, int("enquiries", "Enquiries"), int("quoted", "Quoted"), int("approved", "Approved"),
      int("job_cards", "Job cards"), int("lost", "Lost"), { key: "conversion_pct", label: "Conversion %", type: "pct" }],
    query: (f, p) => `SELECT b.code branch, coalesce(e.source, '') source, count(*)::int enquiries,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM quotation q WHERE q.enquiry_id = e.id))::int quoted,
        count(*) FILTER (WHERE e.status IN ('approved','converted'))::int approved, count(*) FILTER (WHERE e.status = 'converted')::int job_cards,
        count(*) FILTER (WHERE e.status = 'lost')::int lost, round(100.0 * count(*) FILTER (WHERE e.status = 'converted') / nullif(count(*), 0), 1) conversion_pct
      FROM enquiry e JOIN branch b ON b.id = e.branch_id WHERE ${where(f, p, { date: "e.doc_date", branch: "e.branch_id", advisor: "e.assigned_to" })} GROUP BY 1, 2 ORDER BY 1, 2`,
    chart: { x: "source", y: "enquiries", type: "pie" },
  },
  // ---------------- Customers
  {
    code: "next_service", area: "Customers", name: "Next service due", trace: "TR-01", desc: "Vehicles due for their next service by date or km, from the last job card and the service interval. Prepare a WhatsApp reminder for each; you send it yourself.",
    module: "customers", dates: "range", dateLabel: "Due between", defaultRange: "next_service",
    extra: [{ key: "state", label: "Show", def: "", options: [["", "Due in the dates, and overdue"], ["due", "Due in the dates only"], ["overdue", "Overdue only"]] }],
    columns: [{ key: "plate", label: "Plate" }, { key: "vehicle", label: "Vehicle" }, { key: "customer", label: "Customer" }, { key: "mobile", label: "Mobile" }, { key: "branch", label: "Branch" },
      { key: "last_job", label: "Last job" }, { key: "last_date", label: "Last service", type: "date" }, { key: "last_km", label: "Last km", type: "int" },
      { key: "due_date", label: "Due date", type: "date" }, { key: "due_km", label: "Due km", type: "int" }, { key: "days_left", label: "Days left", type: "int" }, { key: "state", label: "State", type: "status" }, { key: "reminded", label: "Reminder prepared" }],
    query: (f, p) => {
      const fr = p.add(f.from), to = p.add(f.to);
      const both = `${fr}::date <= ${to}::date`;
      const st = f.x.state === "due" ? `x.due_date BETWEEN ${fr}::date AND ${to}::date` : f.x.state === "overdue" ? `x.state = 'overdue' AND ${both}` : `(x.due_date BETWEEN ${fr}::date AND ${to}::date OR x.state = 'overdue')`;
      return `WITH iv AS (SELECT coalesce((SELECT (value #>> '{}')::int FROM setting WHERE key = 'vehicle.service_interval_months' AND branch_id IS NULL), 6) m,
                          coalesce((SELECT (value #>> '{}')::int FROM setting WHERE key = 'vehicle.service_interval_km' AND branch_id IS NULL), 10000) km),
        last AS (SELECT DISTINCT ON (j.vehicle_id) j.vehicle_id, j.id job_id, j.doc_no, j.branch_id, j.customer_id, coalesce(j.delivered_at::date, j.doc_date) last_date, j.odometer_in last_km
                   FROM job_card j WHERE j.status IN ('delivered','invoiced','closed') ORDER BY j.vehicle_id, coalesce(j.delivered_at::date, j.doc_date) DESC, j.created_at DESC),
        x AS (SELECT l.*, v.make, v.model, v.registered_in, v.plate_code, v.plate_number, v.odometer,
                (l.last_date + make_interval(months => coalesce(v.service_interval_months, iv.m)))::date due_date, l.last_km + coalesce(v.service_interval_km, iv.km) due_km,
                CASE WHEN (l.last_date + make_interval(months => coalesce(v.service_interval_months, iv.m)))::date < current_date OR v.odometer >= l.last_km + coalesce(v.service_interval_km, iv.km)
                     THEN 'overdue' ELSE 'due' END state
              FROM last l JOIN vehicle v ON v.id = l.vehicle_id, iv WHERE v.active)
      SELECT x.job_id id, ${PLATE("x")} plate, concat_ws(' ', x.make, x.model) vehicle, ${CUST()} customer, c.mobile, b.code branch, x.doc_no last_job, ${D("x.last_date")} last_date, x.last_km,
        ${D("x.due_date")} due_date, x.due_km, (x.due_date - current_date)::int days_left, x.state,
        (SELECT to_char(max(m.at), 'DD/MM/YYYY') FROM message_log m WHERE m.event = 'service_due' AND m.job_card_id = x.job_id) reminded
      FROM x JOIN customer c ON c.id = x.customer_id JOIN branch b ON b.id = x.branch_id
      WHERE x.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND ${st} ORDER BY x.due_date`;
    },
    rowAction: "service_due",
  },
  // ---------------- Parts
  {
    code: "stock_by_branch", area: "Parts", name: "Stock by branch", desc: "On hand, committed to jobs, available and back-ordered quantity for each item at each branch, with value at average cost.",
    module: "stock", dates: "none",
    columns: [{ key: "branch", label: "Branch" }, { key: "part_no", label: "Part no." }, { key: "description", label: "Item" }, { key: "category", label: "Category" },
      { key: "on_hand", label: "On hand", type: "num", total: true }, { key: "committed", label: "Committed", type: "num", total: true }, { key: "available", label: "Available", type: "num", total: true },
      { key: "back_ordered", label: "Back-ordered", type: "num", total: true }, money("avg_cost", "Average cost", "purchase_cost"), money("value", "Value", "purchase_cost"), { key: "last_move", label: "Last movement", type: "date" }],
    query: (f, p) => `SELECT b.code branch, it.part_no, it.description, coalesce(it.category, '') category, sb.on_hand, sb.committed, sb.on_hand - sb.committed available,
        coalesce((SELECT sum(sc.back_ordered) FROM stock_commitment sc WHERE sc.item_id = sb.item_id AND sc.branch_id = sb.branch_id AND sc.status = 'active'), 0) back_ordered,
        round(sb.avg_cost, 2) avg_cost, round(sb.on_hand * sb.avg_cost, 2) value, ${D("sb.last_move_at::date")} last_move
      FROM stock_balance sb JOIN item it ON it.id = sb.item_id JOIN branch b ON b.id = sb.branch_id
      WHERE sb.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND (sb.on_hand <> 0 OR sb.committed <> 0) ORDER BY b.code, it.part_no`,
  },
  {
    code: "back_orders", area: "Parts", name: "Back orders", desc: "Parts committed to jobs that are not in stock yet, with the expected date and age.",
    module: "stock", dates: "none",
    columns: [{ key: "branch", label: "Branch" }, { key: "part_no", label: "Part no." }, { key: "description", label: "Item" }, { key: "job", label: "Job card" },
      { key: "qty", label: "Needed", type: "num", total: true }, { key: "back_ordered", label: "Back-ordered", type: "num", total: true }, { key: "expected_date", label: "Expected", type: "date" }, { key: "age_days", label: "Age (days)", type: "int" }, { key: "source", label: "Being sourced by" }],
    query: (f, p) => `SELECT j.id, b.code branch, it.part_no, it.description, j.doc_no job, sc.qty, sc.back_ordered, ${D("sc.expected_date")} expected_date,
        (current_date - sc.created_at::date)::int age_days, concat_ws(' ', sc.source_type, sc.source_ref) source
      FROM stock_commitment sc JOIN item it ON it.id = sc.item_id JOIN branch b ON b.id = sc.branch_id LEFT JOIN job_line jl ON jl.id = sc.job_line_id LEFT JOIN job_card j ON j.id = jl.job_card_id
      WHERE sc.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND sc.status = 'active' AND sc.back_ordered > 0 ORDER BY sc.created_at`,
    link: (r) => (r.id ? `/jobs/${r.id}` : null),
  },
  {
    code: "slow_dead_stock", area: "Parts", name: "Slow and dead stock", desc: "Items in stock with no movement for the slow (default 90 days) or dead (default 180 days) period in Settings.",
    module: "stock", dates: "none",
    columns: [{ key: "branch", label: "Branch" }, { key: "part_no", label: "Part no." }, { key: "description", label: "Item" }, { key: "on_hand", label: "On hand", type: "num", total: true },
      { key: "last_move", label: "Last movement", type: "date" }, { key: "days_idle", label: "Days without movement", type: "int" }, { key: "class", label: "Class", type: "status" }, money("value", "Value", "purchase_cost")],
    query: (f, p) => `WITH s AS (SELECT coalesce((SELECT (value #>> '{}')::int FROM setting WHERE key = 'reports.slow_stock_days' AND branch_id IS NULL), 90) slow,
                         coalesce((SELECT (value #>> '{}')::int FROM setting WHERE key = 'reports.dead_stock_days' AND branch_id IS NULL), 180) dead)
      SELECT b.code branch, it.part_no, it.description, sb.on_hand, ${D("sb.last_move_at::date")} last_move, (current_date - coalesce(sb.last_move_at::date, '2000-01-01'))::int days_idle,
        CASE WHEN current_date - coalesce(sb.last_move_at::date, '2000-01-01') >= s.dead THEN 'dead' ELSE 'slow' END class, round(sb.on_hand * sb.avg_cost, 2) value
      FROM stock_balance sb JOIN item it ON it.id = sb.item_id JOIN branch b ON b.id = sb.branch_id, s
      WHERE sb.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND sb.on_hand > 0 AND current_date - coalesce(sb.last_move_at::date, '2000-01-01') >= s.slow ORDER BY days_idle DESC`,
  },
  {
    code: "pending_transfers", area: "Parts", name: "Pending transfer notes", trace: "TR-05", desc: "Transfers waiting for approval, dispatch or receipt, by branch and age.",
    module: "stock", dates: "none", archive: "transfer",
    columns: [{ key: "doc_no", label: "Transfer" }, { key: "requested", label: "Requested", type: "date" }, { key: "from_branch", label: "From" }, { key: "to_branch", label: "To" },
      { key: "status", label: "Waiting for", type: "status" }, { key: "age_days", label: "Age (days)", type: "int" }, int("lines", "Lines"), { key: "qty", label: "Quantity", type: "num", total: true },
      money("value", "Value", "purchase_cost"), { key: "requested_by", label: "Requested by" }],
    query: (f, p) => {
      const b = p.add(f.branches);
      return `SELECT t.id, t.doc_no, ${D("t.created_at::date")} requested, fb.code from_branch, tb.code to_branch,
          CASE t.status WHEN 'requested' THEN 'pending_approval' WHEN 'approved' THEN 'dispatch' WHEN 'dispatched' THEN 'receipt' END status,
          (current_date - t.created_at::date)::int age_days, count(l.id)::int lines, sum(l.qty) qty, round(sum(l.qty * coalesce(l.unit_cost, 0)), 2) value, u.full_name requested_by
        FROM transfer t JOIN branch fb ON fb.id = t.from_branch_id JOIN branch tb ON tb.id = t.to_branch_id LEFT JOIN transfer_line l ON l.transfer_id = t.id LEFT JOIN app_user u ON u.id = t.requested_by
        WHERE t.status IN ('requested','approved','dispatched') AND (t.from_branch_id = ANY(${b}::uuid[]) OR t.to_branch_id = ANY(${b}::uuid[])) AND ${arch(f, p, "transfer", "t.id")}
        GROUP BY t.id, fb.code, tb.code, u.full_name ORDER BY t.created_at`;
    },
    link: (r) => `/stock/transfers/${r.id}`,
  },
  // ---------------- Purchasing
  {
    code: "purchase_register", area: "Purchasing", name: "Purchase report", trace: "TR-03", desc: "Supplier bills by supplier, item, branch or PO with net, VAT and gross, in detail or summary.",
    module: "purchasing", dates: "range", archive: "supplier_bill",
    extra: [{ key: "by", label: "Show", def: "detail", options: [["detail", "Each bill"], ["supplier", "By supplier"], ["item", "By item"], ["branch", "By branch"], ["po", "By PO"]] }],
    columns: (f) => {
      const by = f.x.by || "detail";
      const amts = [money("net", "Net", "purchase_cost"), money("vat", "VAT", "purchase_cost"), money("gross", "Gross", "purchase_cost")];
      if (by === "detail") return [{ key: "doc_no", label: "Bill" }, { key: "invoice_no", label: "Supplier invoice" }, { key: "invoice_date", label: "Date", type: "date" }, { key: "branch", label: "Branch" },
        { key: "supplier", label: "Supplier" }, { key: "status", label: "Status", type: "status" }, ...amts];
      if (by === "item") return [{ key: "part_no", label: "Part no." }, { key: "label", label: "Item or expense" }, { key: "qty", label: "Quantity", type: "num", total: true }, ...amts];
      return [{ key: "label", label: by === "supplier" ? "Supplier" : by === "branch" ? "Branch" : "Purchase order" }, int("bills", "Bills"), ...amts];
    },
    query: (f, p) => {
      const by = f.x.by || "detail";
      const w = where(f, p, { date: "sb.invoice_date", branch: "sb.branch_id", arch: ["supplier_bill", "sb.id"] }, ["sb.status <> 'rejected'"]);
      const base = `FROM supplier_bill sb JOIN branch b ON b.id = sb.branch_id JOIN supplier s ON s.id = sb.supplier_id`;
      if (by === "detail") return `SELECT sb.id, sb.doc_no, sb.supplier_invoice_no invoice_no, ${D("sb.invoice_date")} invoice_date, b.code branch, s.name_en supplier, sb.status,
          sb.net_total net, sb.vat_total vat, sb.grand_total gross ${base} WHERE ${w} ORDER BY sb.invoice_date, sb.doc_no`;
      const lines = `${base} JOIN supplier_bill_line l ON l.bill_id = sb.id LEFT JOIN grn_line gl ON gl.id = l.grn_line_id LEFT JOIN item it ON it.id = gl.item_id
        LEFT JOIN po_line pl ON pl.id = gl.po_line_id LEFT JOIN purchase_order po ON po.id = pl.po_id`;
      const amt = "sum(l.net_amount) net, sum(l.vat_amount) vat, sum(l.net_amount + l.vat_amount) gross";
      if (by === "item") return `SELECT coalesce(it.part_no, '') part_no, coalesce(it.description, l.description) label, sum(l.qty) qty, ${amt} ${lines} WHERE ${w} GROUP BY 1, 2 ORDER BY net DESC`;
      if (by === "po") return `SELECT coalesce(po.doc_no, 'No PO') label, count(DISTINCT sb.id)::int bills, ${amt} ${lines} WHERE ${w} GROUP BY 1 ORDER BY 1`;
      return `SELECT ${by === "supplier" ? "s.name_en" : "b.code"} label, count(*)::int bills, sum(sb.net_total) net, sum(sb.vat_total) vat, sum(sb.grand_total) gross ${base} WHERE ${w} GROUP BY 1 ORDER BY 1`;
    },
    link: (r) => (r.id ? `/purchasing/bills/${r.id}` : null),
    chart: { x: "label", y: "net", type: "bar" },
  },
  {
    code: "pending_lpo", area: "Purchasing", name: "Pending LPO", trace: "TR-04", desc: "Purchase orders waiting for approval, approved or rejected and not fully received, by branch, approver, amount and age.",
    module: "purchasing", dates: "none", archive: "purchase_order",
    extra: [{ key: "status", label: "Status", def: "", options: [["", "All pending"], ["pending_approval", "Waiting for approval"], ["approved", "Approved, not received"], ["partly_received", "Partly received"], ["rejected", "Rejected"]] }],
    columns: [{ key: "doc_no", label: "PO" }, { key: "raised", label: "Raised", type: "date" }, { key: "branch", label: "Branch" }, { key: "supplier", label: "Supplier" }, { key: "status", label: "Status", type: "status" },
      { key: "approver", label: "Approver" }, money("amount", "Amount", "purchase_cost"), { key: "received_pct", label: "Received %", type: "pct" }, { key: "age_days", label: "Age (days)", type: "int" }],
    query: (f, p) => `SELECT po.id, po.doc_no, ${D("po.created_at::date")} raised, b.code branch, s.name_en supplier, po.status,
        coalesce((SELECT string_agg(DISTINCT coalesce(au.full_name, r.name), ', ') FROM approval_request ar JOIN approval_task t ON t.request_id = ar.id
                    LEFT JOIN approval_action aa ON aa.task_id = t.id AND aa.action IN ('approved','rejected') LEFT JOIN app_user au ON au.id = aa.user_id LEFT JOIN role r ON r.id = t.approver_role_id
                   WHERE ar.doc_type = 'purchase_order' AND ar.doc_id = po.id), '') approver,
        po.grand_total amount, round(100 * coalesce((SELECT sum(least(pl.received_qty, pl.qty)) / nullif(sum(pl.qty), 0) FROM po_line pl WHERE pl.po_id = po.id), 0), 1) received_pct,
        (current_date - po.created_at::date)::int age_days
      FROM purchase_order po JOIN branch b ON b.id = po.branch_id JOIN supplier s ON s.id = po.supplier_id
      WHERE po.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND ${f.x.status ? `po.status = ${p.add(f.x.status)}` : "po.status IN ('pending_approval','approved','partly_received','rejected')"} AND ${arch(f, p, "purchase_order", "po.id")}
      ORDER BY po.created_at`,
    link: (r) => `/purchasing/${r.id}`,
  },
  // ---------------- Finance
  {
    code: "receipts_by_method", area: "Finance", name: "Cash collected by method", desc: "Receipts and deposits taken in the period by branch and payment method.",
    module: "invoices", dates: "range", archive: "receipt",
    columns: [{ key: "branch", label: "Branch" }, { key: "method", label: "Method", type: "status" }, int("receipts", "Receipts"), money("amount", "Amount")],
    query: (f, p) => `SELECT b.code branch, r.method, count(*)::int receipts, sum(r.amount) amount FROM receipt r JOIN branch b ON b.id = r.branch_id
      WHERE ${where(f, p, { date: "r.doc_date", branch: "r.branch_id", arch: ["receipt", "r.id"] })} GROUP BY 1, 2 ORDER BY 1, 2`,
    chart: { x: "method", y: "amount", type: "pie" },
  },
  {
    code: "branch_outstanding", area: "Finance", name: "Branch-wise outstanding", desc: "Customer invoices still open at each branch today: total open, overdue and over 90 days.",
    module: "invoices", dates: "none",
    columns: [{ key: "branch", label: "Branch" }, int("invoices", "Open invoices"), int("customers", "Customers"), money("outstanding", "Outstanding"), money("overdue", "Overdue"), money("over_90", "Over 90 days")],
    query: (f, p) => `SELECT b.code branch, count(*)::int invoices, count(DISTINCT i.customer_id)::int customers, sum(i.grand_total - i.paid_amount - i.credited_amount) outstanding,
        coalesce(sum(i.grand_total - i.paid_amount - i.credited_amount) FILTER (WHERE i.due_date < current_date), 0) overdue,
        coalesce(sum(i.grand_total - i.paid_amount - i.credited_amount) FILTER (WHERE i.due_date < current_date - 90), 0) over_90
      FROM sales_invoice i JOIN branch b ON b.id = i.branch_id
      WHERE i.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND i.grand_total - i.paid_amount - i.credited_amount > 0.005 GROUP BY b.code ORDER BY b.code`,
    chart: { x: "branch", y: "outstanding", type: "bar" },
  },
  {
    code: "bill_settlement", area: "Finance", name: "Bill settlement", desc: "Each invoice of the period with what was received against it, credit notes, what is still open and the receipts that settled it.",
    module: "invoices", dates: "range", archive: "sales_invoice",
    extra: [{ key: "open", label: "Show", def: "", options: [["", "All invoices"], ["open", "Still open"], ["settled", "Settled"]] }],
    columns: [{ key: "doc_no", label: "Invoice" }, { key: "doc_date", label: "Date", type: "date" }, { key: "branch", label: "Branch" }, { key: "customer", label: "Customer" },
      money("gross", "Invoice total"), money("received", "Received"), money("credited", "Credit notes"), money("open", "Open"), { key: "receipts", label: "Receipts" }, { key: "settled_on", label: "Settled on", type: "date" }],
    query: (f, p) => {
      const o = f.x.open === "open" ? "i.grand_total - i.paid_amount - i.credited_amount > 0.005" : f.x.open === "settled" ? "i.grand_total - i.paid_amount - i.credited_amount <= 0.005" : "true";
      return `SELECT i.id, i.doc_no, ${D("i.doc_date")} doc_date, b.code branch, coalesce(i.bill_to_name, ${CUST()}) customer, i.grand_total gross, i.paid_amount received, i.credited_amount credited,
          i.grand_total - i.paid_amount - i.credited_amount open,
          (SELECT string_agg(r.doc_no, ', ' ORDER BY r.doc_date) FROM receipt_allocation a JOIN receipt r ON r.id = a.receipt_id WHERE a.invoice_id = i.id AND NOT a.reversed) receipts,
          CASE WHEN i.grand_total - i.paid_amount - i.credited_amount <= 0.005 THEN (SELECT ${D("max(a.at)::date")} FROM receipt_allocation a WHERE a.invoice_id = i.id AND NOT a.reversed) END settled_on
        FROM sales_invoice i JOIN branch b ON b.id = i.branch_id LEFT JOIN customer c ON c.id = i.customer_id
        WHERE ${where(f, p, { date: "i.doc_date", branch: "i.branch_id", arch: ["sales_invoice", "i.id"] }, [o])} ORDER BY i.doc_date, i.doc_no`;
    },
    link: (r) => `/invoices/${r.id}`,
  },
  // ---------------- HR and payroll
  {
    code: "headcount", area: "HR and payroll", name: "Headcount", desc: "Staff on the last day of the period by branch, department and designation, with joiners and leavers in the period.",
    module: "hr", dates: "range", defaultRange: "year",
    columns: [{ key: "branch", label: "Branch" }, { key: "department", label: "Department" }, { key: "designation", label: "Designation" }, int("headcount", "Headcount"), int("joined", "Joined"), int("left_count", "Left")],
    query: (f, p) => {
      const fr = p.add(f.from), to = p.add(f.to);
      return `SELECT b.code branch, coalesce(d.name_en, '') department, coalesce(g.name_en, '') designation,
          count(*) FILTER (WHERE e.joining_date <= ${to}::date AND (e.leaving_date IS NULL OR e.leaving_date > ${to}::date))::int headcount,
          count(*) FILTER (WHERE e.joining_date BETWEEN ${fr}::date AND ${to}::date)::int joined, count(*) FILTER (WHERE e.leaving_date BETWEEN ${fr}::date AND ${to}::date)::int left_count
        FROM employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN department d ON d.id = e.department_id LEFT JOIN designation g ON g.id = e.designation_id
        WHERE e.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND e.joining_date <= ${to}::date AND (e.leaving_date IS NULL OR e.leaving_date >= ${fr}::date)
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
    },
    chart: { x: "department", y: "headcount", type: "bar" },
  },
  {
    code: "document_expiries", area: "HR and payroll", name: "Document and contract expiries", desc: "Passports, visas, Emirates IDs, labour cards, insurance and contracts expiring within the days chosen, and those already expired.",
    module: "hr", dates: "none",
    extra: [{ key: "within", label: "Expiring within", def: "90", options: [["30", "30 days"], ["60", "60 days"], ["90", "90 days"], ["180", "180 days"]] }],
    columns: [{ key: "employee", label: "Employee" }, { key: "emp_no", label: "Emp. no." }, { key: "branch", label: "Branch" }, { key: "document", label: "Document", type: "status" },
      { key: "number", label: "Number" }, { key: "expiry", label: "Expires", type: "date" }, { key: "days_left", label: "Days left", type: "int" }],
    query: (f, p) => {
      const within = p.add(Number(f.x.within) || 90), b = p.add(f.branches);
      return `SELECT * FROM (
          SELECT e.id, ${EMP()} employee, e.emp_no, bb.code branch, CASE WHEN r.kind = 'document' THEN coalesce(r.data ->> 'doc_type', 'document') ELSE r.kind END document,
            coalesce(r.data ->> 'number', r.data ->> 'policy_no', '') number, ${D("r.expiry_date")} expiry, (r.expiry_date - current_date)::int days_left
          FROM employee_record r JOIN employee e ON e.id = r.employee_id JOIN branch bb ON bb.id = e.branch_id
          WHERE r.expiry_date IS NOT NULL AND r.status = 'active' AND e.status = 'active' AND e.branch_id = ANY(${b}::uuid[]) AND r.expiry_date <= current_date + ${within}::int
          UNION ALL
          SELECT e.id, ${EMP()}, e.emp_no, bb.code, 'contract', coalesce(e.labour_card_no, ''), ${D("e.contract_end")}, (e.contract_end - current_date)::int
          FROM employee e JOIN branch bb ON bb.id = e.branch_id WHERE e.status = 'active' AND e.contract_end IS NOT NULL AND e.branch_id = ANY(${b}::uuid[]) AND e.contract_end <= current_date + ${within}::int
        ) x ORDER BY days_left`;
    },
    link: (r) => `/hr/employees/${r.id}?tab=records`,
  },
  {
    code: "insurance_register", area: "HR and payroll", name: "Employee insurance register", trace: "TR-06", desc: "Every employee medical insurance policy, with those expiring in the next 30, 60 or 90 days marked.",
    module: "hr", dates: "none",
    extra: [{ key: "within", label: "Show", def: "", options: [["", "All policies"], ["30", "Expiring in 30 days"], ["60", "Expiring in 60 days"], ["90", "Expiring in 90 days"]] }],
    columns: [{ key: "employee", label: "Employee" }, { key: "emp_no", label: "Emp. no." }, { key: "branch", label: "Branch" }, { key: "provider", label: "Insurer" }, { key: "policy_no", label: "Policy no." },
      { key: "card_no", label: "Card no." }, { key: "category", label: "Category" }, { key: "start_date", label: "From", type: "date" }, { key: "expiry", label: "Expires", type: "date" },
      { key: "days_left", label: "Days left", type: "int" }, { key: "band", label: "Expiry band" }, money("premium", "Premium", "salary")],
    query: (f, p) => `SELECT e.id, ${EMP()} employee, e.emp_no, b.code branch, r.data ->> 'provider' provider, r.data ->> 'policy_no' policy_no, r.data ->> 'card_no' card_no, r.data ->> 'category' category,
        r.data ->> 'start_date' start_date, ${D("r.expiry_date")} expiry, (r.expiry_date - current_date)::int days_left,
        CASE WHEN r.expiry_date < current_date THEN 'Expired' WHEN r.expiry_date <= current_date + 30 THEN '30 days' WHEN r.expiry_date <= current_date + 60 THEN '60 days'
             WHEN r.expiry_date <= current_date + 90 THEN '90 days' ELSE 'Later' END band, nullif(r.data ->> 'premium', '')::numeric premium
      FROM employee_record r JOIN employee e ON e.id = r.employee_id JOIN branch b ON b.id = e.branch_id
      WHERE r.kind = 'insurance' AND r.status = 'active' AND e.branch_id = ANY(${p.add(f.branches)}::uuid[])
        ${f.x.within ? `AND r.expiry_date <= current_date + ${p.add(Number(f.x.within) || 90)}::int` : ""} ORDER BY r.expiry_date`,
    link: (r) => `/hr/employees/${r.id}?tab=records`,
  },
  {
    code: "leave_report", area: "HR and payroll", name: "Leave taken and requested", desc: "Leave requests that fall in the period, with type, days and status.",
    module: "hr", dates: "range",
    extra: [{ key: "status", label: "Status", def: "", options: [["", "Any status"], ["approved", "Approved"], ["pending", "Waiting for approval"], ["rejected", "Rejected"], ["cancelled", "Cancelled"]] }],
    columns: [{ key: "doc_no", label: "Request" }, { key: "employee", label: "Employee" }, { key: "branch", label: "Branch" }, { key: "leave_type", label: "Type" },
      { key: "from_date", label: "From", type: "date" }, { key: "to_date", label: "To", type: "date" }, { key: "days", label: "Days", type: "num", total: true }, { key: "status", label: "Status", type: "status" }],
    query: (f, p) => `SELECT e.id, l.doc_no, ${EMP()} employee, b.code branch, coalesce(lt.name_en, l.leave_type) leave_type, ${D("l.from_date")} from_date, ${D("l.to_date")} to_date, l.days, l.status
      FROM leave_request l JOIN employee e ON e.id = l.employee_id JOIN branch b ON b.id = l.branch_id LEFT JOIN leave_type lt ON lt.code = l.leave_type
      WHERE l.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND l.to_date >= ${p.add(f.from)}::date AND l.from_date <= ${p.add(f.to)}::date ${f.x.status ? `AND l.status = ${p.add(f.x.status)}` : ""}
      ORDER BY l.from_date`,
    link: (r) => `/hr/employees/${r.id}?tab=leave`,
  },
  {
    code: "overtime_report", area: "HR and payroll", name: "Overtime", desc: "Overtime worked in the period by employee, type and status, and whether it has been paid in a payroll run.",
    module: "hr", dates: "range",
    columns: [{ key: "employee", label: "Employee" }, { key: "branch", label: "Branch" }, { key: "work_date", label: "Date", type: "date" }, { key: "hours", label: "Hours", type: "hours", total: true },
      { key: "ot_type", label: "Type", type: "status" }, { key: "status", label: "Status", type: "status" }, { key: "paid", label: "In payroll" }],
    query: (f, p) => `SELECT ${EMP()} employee, b.code branch, ${D("o.work_date")} work_date, o.hours, o.ot_type, o.status, CASE WHEN o.payroll_run_id IS NULL THEN 'No' ELSE 'Yes' END paid
      FROM overtime_request o JOIN employee e ON e.id = o.employee_id JOIN branch b ON b.id = o.branch_id
      WHERE ${where(f, p, { date: "o.work_date", branch: "o.branch_id" })} ORDER BY o.work_date`,
  },
  {
    code: "attendance_exceptions", area: "HR and payroll", name: "Attendance exceptions", desc: "Absent, late, left early, missing check-out, and work on days off or holidays, day by day (at most 62 days at a time).",
    module: "hr", dates: "range",
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "full_name", label: "Employee" }, { key: "branch_code", label: "Branch" }, { key: "status", label: "Exception", type: "status" },
      { key: "first_in", label: "First in" }, { key: "last_out", label: "Last out" }, { key: "late_min", label: "Minutes late", type: "int", total: true }, { key: "early_min", label: "Minutes early", type: "int", total: true }],
    compute: async (c, f) => {
      if ((Date.parse(f.to) - Date.parse(f.from)) / 86400000 > 62) throw invalid("Choose at most 62 days for attendance exceptions.", { field: "to" });
      const out: Row[] = [];
      for (const b of f.branches) out.push(...(await attendanceDays(c, { from: f.from, to: f.to, branchId: b })).filter((r) => ["absent", "late", "early_leave", "missing_out", "worked_off_day", "worked_holiday"].includes(r.status)));
      return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    },
    chart: { x: "status", y: "late_min", type: "bar" },
  },
  {
    code: "payroll_by_branch", area: "HR and payroll", name: "Branch-wise payroll cost", desc: "Payroll cost by month and branch: gross, deductions, net and the month's end-of-service, leave and ticket accruals.",
    module: "hr", salary: true, dates: "range", defaultRange: "year", archive: "payroll_run",
    columns: [{ key: "month", label: "Month" }, { key: "branch", label: "Branch" }, { key: "status", label: "Run status", type: "status" }, int("employees", "Employees"), money("gross", "Gross", "salary"),
      money("deductions", "Deductions", "salary"), money("net", "Net", "salary"), money("accruals", "Accruals", "salary")],
    query: (f, p) => `SELECT to_char(r.period_month, 'YYYY-MM') AS month, b.code branch, r.status, count(*)::int employees, sum(pe.gross) gross, sum(pe.total_deductions) deductions, sum(pe.net) net,
        sum(pe.accrual_gratuity + pe.accrual_leave + pe.accrual_ticket) accruals
      FROM payroll_employee pe JOIN payroll_run r ON r.id = pe.run_id JOIN branch b ON b.id = pe.branch_id
      WHERE pe.branch_id = ANY(${p.add(f.branches)}::uuid[]) AND r.period_month BETWEEN date_trunc('month', ${p.add(f.from)}::date) AND ${p.add(f.to)}::date AND ${arch(f, p, "payroll_run", "r.id")}
      GROUP BY r.period_month, b.code, r.status ORDER BY r.period_month, b.code`,
    chart: { x: "branch", y: "gross", type: "bar" },
  },
  {
    code: "gratuity_liability", area: "HR and payroll", name: "Gratuity liability", desc: "End-of-service gratuity each employee had earned at the last payroll run, with any loan still owed.",
    module: "hr", salary: true, dates: "none",
    columns: [{ key: "employee", label: "Employee" }, { key: "emp_no", label: "Emp. no." }, { key: "branch", label: "Branch" }, { key: "joining_date", label: "Joined", type: "date" },
      { key: "month", label: "As at payroll" }, money("gratuity", "Gratuity liability", "salary"), money("loan_balance", "Loan still owed", "salary")],
    query: (f, p) => `SELECT DISTINCT ON (e.id) e.id, ${EMP()} employee, e.emp_no, b.code branch, ${D("e.joining_date")} joining_date, to_char(r.period_month, 'YYYY-MM') AS month,
        pe.gratuity_liability gratuity, pe.loan_balance
      FROM payroll_employee pe JOIN payroll_run r ON r.id = pe.run_id JOIN employee e ON e.id = pe.employee_id JOIN branch b ON b.id = e.branch_id
      WHERE e.status = 'active' AND e.branch_id = ANY(${p.add(f.branches)}::uuid[]) ORDER BY e.id, r.period_month DESC`,
  },
  {
    code: "loans", area: "HR and payroll", name: "Salary advances and loans", desc: "Every advance and loan, amount, monthly instalment, recovered so far and still owed.",
    module: "hr", salary: true, dates: "none",
    extra: [{ key: "status", label: "Show", def: "open", options: [["open", "Still being recovered"], ["", "All"]] }],
    columns: [{ key: "doc_no", label: "Document" }, { key: "employee", label: "Employee" }, { key: "branch", label: "Branch" }, { key: "kind", label: "Kind", type: "status" },
      money("amount", "Amount", "salary"), { key: "instalments", label: "Instalments", type: "int" }, money("instalment_amount", "Monthly", "salary"), { key: "start_month", label: "From month" },
      money("recovered", "Recovered", "salary"), money("balance", "Still owed", "salary"), { key: "status", label: "Status", type: "status" }],
    query: (f, p) => `SELECT l.doc_no, ${EMP()} employee, b.code branch, l.kind, l.amount, l.instalments, l.instalment_amount, to_char(l.start_month, 'YYYY-MM') start_month, l.recovered,
        l.amount - l.recovered balance, l.status
      FROM loan l JOIN employee e ON e.id = l.employee_id JOIN branch b ON b.id = l.branch_id
      WHERE l.branch_id = ANY(${p.add(f.branches)}::uuid[]) ${f.x.status === "open" ? "AND l.status = 'approved' AND l.amount > l.recovered" : ""} ORDER BY l.created_at`,
  },
  // ---------------- Approvals
  {
    code: "approvals_pending", area: "Approvals", name: "Approvals waiting", desc: "Every request still waiting for approval, what it is, who asked, where it waits and for how long.",
    module: "approvals", dates: "none",
    columns: [{ key: "doc_type", label: "Request", type: "status" }, { key: "doc_ref", label: "Reference" }, { key: "branch", label: "Branch" }, { key: "requested_by", label: "Requested by" },
      { key: "requested", label: "Requested", type: "date" }, { key: "waiting_at", label: "Waiting at" }, { key: "age_days", label: "Age (days)", type: "int" }],
    query: (f, p) => `SELECT ar.doc_type, ar.doc_ref, b.code branch, u.full_name requested_by, ${D("ar.created_at::date")} requested,
        (SELECT string_agg(t.step_name, ', ') FROM approval_task t WHERE t.request_id = ar.id AND t.seq = ar.current_seq AND t.status = 'pending') waiting_at,
        (current_date - ar.created_at::date)::int age_days
      FROM approval_request ar JOIN branch b ON b.id = ar.branch_id LEFT JOIN app_user u ON u.id = ar.requested_by
      WHERE ar.status = 'pending' AND ar.branch_id = ANY(${p.add(f.branches)}::uuid[]) ORDER BY ar.created_at`,
  },
  {
    code: "approval_turnaround", area: "Approvals", name: "Approval turnaround", desc: "Requests decided in the period by type: approved, rejected and the average hours to decide.",
    module: "approvals", dates: "range",
    columns: [{ key: "doc_type", label: "Request", type: "status" }, int("decided", "Decided"), int("approved", "Approved"), int("rejected", "Rejected"), { key: "avg_hours", label: "Average hours to decide", type: "num" }],
    query: (f, p) => `SELECT ar.doc_type, count(*)::int decided, count(*) FILTER (WHERE ar.status = 'approved')::int approved, count(*) FILTER (WHERE ar.status = 'rejected')::int rejected,
        round(avg(extract(epoch FROM ar.decided_at - ar.created_at) / 3600)::numeric, 1) avg_hours
      FROM approval_request ar WHERE ar.decided_at IS NOT NULL AND ${where(f, p, { date: "ar.decided_at::date", branch: "ar.branch_id" })} GROUP BY 1 ORDER BY 1`,
    chart: { x: "doc_type", y: "avg_hours", type: "bar" },
  },
];

/** Reports that already exist as accounting screens, listed in the index so everything is in one place. */
export const LINKED_REPORTS: { area: Area; name: string; href: string; module: Screen; trace?: string }[] = [
  { area: "Finance", name: "Cash closing", href: "/billing/cash", module: "invoices" },
  { area: "Finance", name: "VAT return (VAT 201)", href: "/accounts/vat", module: "accounting" },
  { area: "Finance", name: "Receivables ageing", href: "/accounts/receivables", module: "accounting" },
  { area: "Finance", name: "Payables ageing", href: "/accounts/payables", module: "accounting" },
  { area: "Finance", name: "Ledger balance and trial balance", href: "/accounts/ledger", module: "accounting" },
  { area: "Finance", name: "Profit and loss, cost centre P&L (branches side by side)", href: "/accounts", module: "accounting" },
  { area: "Finance", name: "Balance sheet and cash flow", href: "/accounts", module: "accounting" },
];

export const REPORT_AREAS: Area[] = ["Workshop", "Technicians", "Sales", "Customers", "Parts", "Purchasing", "Finance", "HR and payroll", "Approvals"];
export const allReports = () => REPORTS;
export const reportDef = (code: string) => REPORTS.find((r) => r.code === code);

// ---------------------------------------------------------------- technician time (FSD 5.4)
async function techTime(c: PoolClient, f: Filters, mode: "efficiency" | "idle"): Promise<Row[]> {
  const p = new P();
  const ev = (await c.query(
    `SELECT te.technician_id, te.job_line_id, te.kind, te.at, te.reason, te.at::date d, te.branch_id, u.full_name, b.code branch, jl.standard_hours
       FROM time_event te JOIN app_user u ON u.id = te.technician_id JOIN branch b ON b.id = te.branch_id JOIN job_line jl ON jl.id = te.job_line_id
      WHERE ${where(f, p, { date: "te.at::date", branch: "te.branch_id", technician: "te.technician_id = $T" })} ORDER BY te.at`, p.v)).rows;
  const lines = new Map<string, typeof ev>();
  for (const e of ev) { const k = `${e.technician_id}:${e.job_line_id}`; lines.set(k, [...(lines.get(k) ?? []), e]); }
  const techsOnLine = new Map<string, Set<string>>();
  for (const e of ev) { if (!techsOnLine.has(e.job_line_id)) techsOnLine.set(e.job_line_id, new Set()); techsOnLine.get(e.job_line_id)!.add(e.technician_id); }
  const dayHours = Number(await getSetting(c, "workshop.technician_day_hours", null, 8));
  const cap = new Map((await c.query("SELECT user_id, daily_hours FROM technician_capacity WHERE active")).rows.map((r) => [r.user_id, Number(r.daily_hours)]));
  const per = new Map<string, { technician: string; branch: string; lines: number; std: number; min: number; days: Set<string>; pauses: Record<string, number> }>();
  for (const [k, es] of lines) {
    const tid = k.split(":")[0];
    const t = per.get(tid) ?? { technician: es[0].full_name, branch: es[0].branch, lines: 0, std: 0, min: 0, days: new Set<string>(), pauses: {} as Record<string, number> };
    const cm = clockedMinutes(es);
    t.lines += 1; t.min += cm.minutes; t.std += Number(es[0].standard_hours ?? 0) / (techsOnLine.get(es[0].job_line_id)?.size || 1);
    for (const e of es) t.days.add(String(e.d));
    for (const [r, m] of Object.entries(cm.pauses)) t.pauses[r] = (t.pauses[r] ?? 0) + m;
    per.set(tid, t);
  }
  const h = (m: number) => Math.round((m / 60) * 100) / 100;
  if (mode === "idle") {
    const out: Row[] = [];
    for (const t of per.values()) for (const [reason, m] of Object.entries(t.pauses)) out.push({ technician: t.technician, reason, hours: h(m) });
    return out.sort((a, b) => String(a.technician).localeCompare(String(b.technician)) || Number(b.hours) - Number(a.hours));
  }
  return [...per.entries()].map(([tid, t]) => {
    const actual = h(t.min), avail = t.days.size * (cap.get(tid) ?? dayHours), std = Math.round(t.std * 100) / 100;
    return { technician: t.technician, branch: t.branch, lines: t.lines, standard_h: std, actual_h: actual, efficiency_pct: actual ? Math.round((std / actual) * 1000) / 10 : null,
      available_h: avail, productivity_pct: avail ? Math.round((actual / avail) * 1000) / 10 : null, idle_h: h(Object.values(t.pauses).reduce((s, m) => s + m, 0)) };
  }).sort((a, b) => a.technician.localeCompare(b.technician));
}

// ---------------------------------------------------------------- access and the runner
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the user may open the report at this branch: reports view, the module's view, and salary sight for payroll reports. */
export function canReportAt(ctx: Ctx, def: Pick<ReportDef, "module" | "salary">, branchId: string) {
  return can(ctx, "reports", "view", branchId) && can(ctx, def.module, "view", branchId) && (!def.salary || canSee(ctx, "salary", branchId));
}
export const canOpenReport = (ctx: Ctx, def: Pick<ReportDef, "module" | "salary">) => ctx.branchIds.some((b) => canReportAt(ctx, def, b));
export const canExport = (ctx: Ctx, branches: string[]) => branches.length > 0 && branches.every((b) => can(ctx, "reports", "export", b));

export const visibleReports = (ctx: Ctx) => REPORTS.filter((r) => canOpenReport(ctx, r));
export const visibleLinks = (ctx: Ctx) => LINKED_REPORTS.filter((l) => ctx.branchIds.some((b) => can(ctx, "reports", "view", b) && can(ctx, l.module, "view", b)));

export type BranchOpt = { id: string; code: string; name_en: string };
/** Branches this user may run the report for, and the ones chosen. Asking for a branch outside them is refused. */
export async function reportBranches(c: PoolClient, ctx: Ctx, def: Pick<ReportDef, "module" | "salary">, sel: string | string[] | undefined) {
  const rows: BranchOpt[] = (await c.query("SELECT id, code, name_en FROM branch WHERE active AND id = ANY($1) ORDER BY branch_type <> 'head_office', code", [ctx.branchIds])).rows;
  const all = rows.filter((b) => canReportAt(ctx, def, b.id));
  if (!all.length) throw forbidden("You do not have access to this report.");
  const want = (Array.isArray(sel) ? sel : typeof sel === "string" && sel ? sel.split(",") : []).filter((x) => x && x !== "all");
  if (want.some((w) => !all.some((b) => b.id === w))) throw forbidden("You cannot report on one of the branches chosen.");
  return { all, chosen: want.length ? all.filter((b) => want.includes(b.id)) : all };
}

export type RunInput = Record<string, string | string[] | undefined>;
const s1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

export function defaultDates(def: Pick<ReportDef, "defaultRange">, windowDays = 30) {
  const t = today();
  if (def.defaultRange === "next_service") return { from: addDays(t, -30), to: addDays(t, windowDays) };
  if (def.defaultRange === "year") return { from: `${t.slice(0, 4)}-01-01`, to: t };
  return { from: `${t.slice(0, 7)}-01`, to: t };
}

/** Reads and checks the filters for a run (branch, dates, people, data source and the report's own choices). */
async function readFilters(c: PoolClient, ctx: Ctx, def: ReportDef, q: RunInput) {
  const br = await reportBranches(c, ctx, def, q.branches);
  const win = Number(await getSetting(c, "reports.next_service_window_days", null, 30));
  const dd = defaultDates(def, win);
  const from = s1(q.from) || dd.from, to = s1(q.to) || dd.to;
  if (def.dates === "range") {
    if (!isDate(from)) throw invalid("Enter a valid start date.", { field: "from" });
    if (!isDate(to)) throw invalid("Enter a valid end date.", { field: "to" });
    if (from > to) throw invalid("The start date is after the end date.", { field: "to" });
  }
  const advisor = def.people?.includes("advisor") ? s1(q.advisor) : "";
  const technician = def.people?.includes("technician") ? s1(q.technician) : "";
  if (advisor && !UUID.test(advisor)) throw invalid("Choose an advisor from the list.", { field: "advisor" });
  if (technician && !UUID.test(technician)) throw invalid("Choose a technician from the list.", { field: "technician" });
  let source = def.archive ? s1(q.source) || "live" : "live";
  if (!["live", "archived"].includes(source)) {
    if (!UUID.test(source) || !(await c.query("SELECT 1 FROM archive_run WHERE id = $1", [source])).rowCount) source = "live";
  }
  const x: Record<string, string> = {};
  for (const e of def.extra ?? []) {
    const v = q[e.key] === undefined ? e.def : s1(q[e.key]);
    if (!e.options.some(([o]) => o === v)) throw invalid(`Choose a valid option for ${e.label.toLowerCase()}.`, { field: e.key });
    x[e.key] = v;
  }
  const f: Filters = { from, to, branches: br.chosen.map((b) => b.id), advisor, technician, source, x };
  return { f, br };
}

export function columnsFor(ctx: Ctx, def: ReportDef, f: Filters) {
  const cols = typeof def.columns === "function" ? def.columns(f) : def.columns;
  return cols.filter((col) => !col.group || f.branches.every((b) => canSee(ctx, col.group!, b)));
}

export type ReportResult = Awaited<ReturnType<typeof runReport>>;

/** Runs a standard report with the shared rules (branch scope, hidden fields, data source, row cap). */
export async function runReport(ctx: Ctx, code: string, q: RunInput) {
  const def = reportDef(code);
  if (!def) throw notFound("Report");
  if (!canOpenReport(ctx, def)) throw forbidden("You do not have access to this report.");
  return withTx(ctx, async (c) => {
    const { f, br } = await readFilters(c, ctx, def, q);
    const cols = columnsFor(ctx, def, f);
    const max = Number(await getSetting(c, "reports.max_rows", null, 5000));
    let rows: Row[];
    if (def.compute) rows = await def.compute(c, f);
    else { const p = new P(); const sql = def.query!(f, p); rows = (await c.query(`${sql} LIMIT ${max + 1}`, p.v)).rows; }
    const truncated = rows.length > max;
    if (truncated) rows = rows.slice(0, max);
    const keep = new Set([...cols.map((x) => x.key), "id"]);
    const clean = rows.map((r) => {
      const o: Row = {};
      for (const k of Object.keys(r)) if (keep.has(k)) o[k] = r[k];
      if (def.link) o.$link = def.link(r);
      return o;
    });
    const totals: Row = {};
    for (const col of cols) if (col.total) totals[col.key] = clean.reduce((s, r) => s + (Number(r[col.key]) || 0), 0);
    const people = def.people?.length ? await peopleOptions(c, f.branches) : { advisors: [], technicians: [] };
    const runs = def.archive ? (await c.query("SELECT id, run_no, to_char(cutoff, 'DD/MM/YYYY') cutoff FROM archive_run ORDER BY run_no DESC")).rows : [];
    return { def: { ...def, columns: cols }, filters: f, branches: br.all, chosen: br.chosen, columns: cols, rows: clean, totals, truncated, max, people, runs,
      canExport: canExport(ctx, f.branches) };
  });
}

async function peopleOptions(c: PoolClient, branches: string[]) {
  const q = (codes: string[]) => c.query(`SELECT DISTINCT u.id, u.full_name FROM app_user u JOIN user_branch_role ubr ON ubr.user_id = u.id JOIN role r ON r.id = ubr.role_id
    WHERE u.status = 'active' AND r.code = ANY($1) AND (ubr.branch_id IS NULL OR ubr.branch_id = ANY($2)) ORDER BY u.full_name`, [codes, branches]);
  return { advisors: (await q(["advisor", "branch_manager"])).rows, technicians: (await q(["technician", "foreman"])).rows };
}

// ---------------------------------------------------------------- owner dashboard (FSD 4.16 "Owner dashboard")
/** Today and the period by branch, plus the enquiry-to-invoice funnel. Money needs the selling price permission. */
export async function ownerDashboard(ctx: Ctx, q: RunInput) {
  const dash = { module: "jobs" as Screen };
  if (!canOpenReport(ctx, dash)) throw forbidden("You do not have access to the owner dashboard.");
  return withTx(ctx, async (c) => {
    const br = await reportBranches(c, ctx, dash, q.branches);
    const t = today();
    const from = s1(q.from) || `${t.slice(0, 7)}-01`, to = s1(q.to) || t;
    if (!isDate(from)) throw invalid("Enter a valid start date.", { field: "from" });
    if (!isDate(to)) throw invalid("Enter a valid end date.", { field: "to" });
    if (from > to) throw invalid("The start date is after the end date.", { field: "to" });
    const ids = br.chosen.map((b) => b.id);
    const showMoney = ids.every((b) => canSee(ctx, "selling_price", b));
    const per = (await c.query(
      `WITH s AS (SELECT coalesce((SELECT value #>> '{}' FROM setting WHERE key = 'ontime.measured_at' AND branch_id IS NULL), 'ready') m)
       SELECT b.id, b.code, b.name_en,
         (SELECT coalesce(sum(taxable_total), 0) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date = $2) sales_today,
         (SELECT coalesce(sum(taxable_total), 0) FROM sales_invoice i WHERE i.branch_id = b.id AND i.doc_date BETWEEN $3 AND $4) sales_period,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND j.created_at::date = $2)::int cars_in_today,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND j.created_at::date BETWEEN $3 AND $4)::int cars_in_period,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND j.delivered_at::date = $2)::int cars_out_today,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND j.delivered_at::date BETWEEN $3 AND $4)::int cars_out_period,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND j.status IN ('approved','awaiting_parts','in_progress','quality_check','ready'))::int on_site,
         (SELECT count(*) FROM job_card j WHERE j.branch_id = b.id AND j.promised_at < now() AND j.status IN ('approved','awaiting_parts','in_progress','quality_check'))::int late,
         (SELECT coalesce(sum(amount), 0) FROM receipt r WHERE r.branch_id = b.id AND r.doc_date = $2) cash_today,
         (SELECT coalesce(sum(amount), 0) FROM receipt r WHERE r.branch_id = b.id AND r.doc_date BETWEEN $3 AND $4) cash_period,
         (SELECT coalesce(sum(grand_total - paid_amount - credited_amount), 0) FROM sales_invoice i WHERE i.branch_id = b.id) receivables,
         (SELECT count(*) FROM enquiry e WHERE e.branch_id = b.id AND e.doc_date = $2)::int enquiries_today,
         (SELECT count(*) FROM enquiry e WHERE e.branch_id = b.id AND e.doc_date BETWEEN $3 AND $4)::int enquiries_period,
         (SELECT round(100.0 * count(*) FILTER (WHERE x.done <= x.promised_at) / nullif(count(*), 0), 1)
            FROM (SELECT j.promised_at, CASE WHEN s.m = 'delivered' THEN j.delivered_at ELSE coalesce(j.ready_at, j.delivered_at) END done FROM job_card j, s
                   WHERE j.branch_id = b.id AND j.promised_at IS NOT NULL AND j.doc_date BETWEEN $3 AND $4) x WHERE x.done IS NOT NULL) on_time_pct
       FROM branch b WHERE b.id = ANY($1) ORDER BY b.branch_type <> 'head_office', b.code`, [ids, t, from, to])).rows;
    const funnel = (await c.query(
      `SELECT b.code,
         count(*)::int enquiries,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM quotation q WHERE q.enquiry_id = e.id AND q.status NOT IN ('draft','ready_to_send','pending_internal_approval')))::int quoted,
         count(*) FILTER (WHERE e.status IN ('approved','converted'))::int approved,
         count(*) FILTER (WHERE e.converted_job_id IS NOT NULL)::int job_cards,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_invoice i WHERE i.job_card_id = e.converted_job_id UNION ALL SELECT 1 FROM sales_invoice_job x WHERE x.job_card_id = e.converted_job_id))::int invoiced,
         count(*) FILTER (WHERE e.status = 'lost')::int lost
       FROM enquiry e JOIN branch b ON b.id = e.branch_id WHERE e.branch_id = ANY($1) AND e.doc_date BETWEEN $2 AND $3 GROUP BY b.code ORDER BY b.code`, [ids, from, to])).rows;
    const sum = (k: string) => per.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const totals: Row = Object.fromEntries(["sales_today", "sales_period", "cars_in_today", "cars_in_period", "cars_out_today", "cars_out_period", "on_site", "late", "cash_today", "cash_period", "receivables", "enquiries_today", "enquiries_period"].map((k) => [k, sum(k)]));
    const ot = per.filter((r) => r.on_time_pct !== null);
    totals.on_time_pct = ot.length ? Math.round((ot.reduce((s, r) => s + Number(r.on_time_pct), 0) / ot.length) * 10) / 10 : null;
    const fTot = ["enquiries", "quoted", "approved", "job_cards", "invoiced", "lost"].reduce<Record<string, number>>((o, k) => ({ ...o, [k]: funnel.reduce((s, r) => s + Number(r[k]), 0) }), {});
    const strip = (r: Row) => (showMoney ? r : Object.fromEntries(Object.entries(r).filter(([k]) => !["sales_today", "sales_period", "cash_today", "cash_period", "receivables"].includes(k))));
    return { from, to, today: t, branches: br.all, chosen: br.chosen, showMoney, per: per.map(strip), totals: strip(totals), funnel, funnelTotal: fTot };
  });
}

export { today as reportToday, addDays as reportAddDays, s1 };

/** TR-01: prepares the "service due" WhatsApp for the vehicle of this last job card. Staff send it themselves. */
export async function prepareServiceReminder(ctx: Ctx, jobId: string) {
  if (!UUID.test(jobId)) throw notFound("Job card");
  const def = reportDef("next_service")!;
  const r = await withTx(ctx, async (c) => {
    const x = (await c.query(
      `SELECT j.branch_id, to_char(coalesce(j.delivered_at::date, j.doc_date), 'DD/MM/YYYY') last_date, j.odometer_in last_km,
         to_char((coalesce(j.delivered_at::date, j.doc_date) + make_interval(months => coalesce(v.service_interval_months, (SELECT (value #>> '{}')::int FROM setting WHERE key = 'vehicle.service_interval_months' AND branch_id IS NULL), 6)))::date, 'DD/MM/YYYY') due_date
       FROM job_card j JOIN vehicle v ON v.id = j.vehicle_id WHERE j.id = $1 AND j.status IN ('delivered','invoiced','closed')`, [jobId])).rows[0];
    if (!x) throw notFound("Job card");
    if (!canReportAt(ctx, def, x.branch_id)) throw forbidden("You do not have access to this branch's report.");
    return x;
  });
  const { prepareMessage } = await import("./messaging");
  return prepareMessage(ctx, { jobId }, "service_due", { due_date: r.due_date, last_date: r.last_date, last_km: r.last_km ? Number(r.last_km).toLocaleString("en-US") : "" });
}
