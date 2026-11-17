import type { PoolClient } from "pg";
import { Ctx, Screen, canSee, roleAt } from "../access";
import { withTx } from "../db";
import { forbidden, invalid } from "../errors";
import { getSetting } from "./settings";
import { Col, ColType, Row, RunInput, reportBranches, s1, defaultDates, canExport } from "./reports";

/**
 * Report builder (RB-01 to RB-11). Users pick a curated data source, then columns, filters, grouping,
 * pivot, safe calculated columns and a chart. There is no free SQL: every field is a fixed expression
 * from the list below, every value is a bound parameter, and fields in a hidden field group (or custom
 * fields hidden from the user's role) are neither offered nor accepted (RB-11).
 */

export type Field = { key: string; label: string; expr: string; type: ColType; group?: string; cfRoles?: string };
export type Source = { key: string; label: string; module: Screen; salary?: boolean; from: string; branch: string | null; date?: string; dateLabel?: string; archive?: [string, string]; fields: Field[] };

const CUST = (c = "c") => `CASE WHEN ${c}.customer_type = 'individual' THEN concat_ws(' ', ${c}.first_name, ${c}.last_name) ELSE ${c}.company_name END`;
const PLATE = (v = "v") => `concat_ws(' ', ${v}.registered_in, ${v}.plate_code, ${v}.plate_number)`;
const EMP = (e = "e") => `concat_ws(' ', ${e}.first_name, ${e}.last_name)`;
const t = (key: string, label: string, expr: string, group?: string): Field => ({ key, label, expr, type: "text", group });
const m = (key: string, label: string, expr: string, group = "selling_price"): Field => ({ key, label, expr, type: "money", group });
const n = (key: string, label: string, expr: string, group?: string): Field => ({ key, label, expr, type: "num", group });
const d = (key: string, label: string, expr: string): Field => ({ key, label, expr, type: "date" });
const st = (key: string, label: string, expr: string): Field => ({ key, label, expr, type: "status" });

export const SOURCES: Source[] = [
  { key: "job_cards", label: "Job cards", module: "jobs", branch: "j.branch_id", date: "j.doc_date", archive: ["job_card", "j.id"],
    from: "job_card j JOIN branch b ON b.id = j.branch_id JOIN vehicle v ON v.id = j.vehicle_id JOIN customer c ON c.id = j.customer_id LEFT JOIN app_user u ON u.id = j.advisor_id",
    fields: [t("doc_no", "Job card", "j.doc_no"), d("doc_date", "Date", "j.doc_date"), t("branch", "Branch", "b.code"), st("status", "Status", "j.status"), st("job_type", "Job type", "j.job_type"),
      t("plate", "Plate", PLATE()), t("make", "Make", "v.make"), t("model", "Model", "v.model"), t("customer", "Customer", CUST()), t("advisor", "Advisor", "u.full_name"),
      n("odometer", "Odometer in", "j.odometer_in"), d("promised", "Promised date", "j.promised_at::date"), d("delivered", "Delivered date", "j.delivered_at::date"),
      t("delay_reason", "Delay reason", "j.delay_reason"), n("hours_to_ready", "Hours to ready", "round(extract(epoch FROM j.ready_at - j.created_at) / 3600, 1)"),
      t("on_time", "On time", "CASE WHEN j.promised_at IS NULL OR coalesce(j.ready_at, j.delivered_at) IS NULL THEN '' WHEN coalesce(j.ready_at, j.delivered_at) <= j.promised_at THEN 'Yes' ELSE 'No' END")] },
  { key: "job_lines", label: "Job card lines", module: "jobs", branch: "j.branch_id", date: "j.doc_date", archive: ["job_card", "j.id"],
    from: "job_line l JOIN job_card j ON j.id = l.job_card_id JOIN branch b ON b.id = j.branch_id LEFT JOIN service s ON s.id = l.service_id LEFT JOIN item it ON it.id = l.item_id LEFT JOIN app_user tu ON tu.id = l.technician_id",
    fields: [t("doc_no", "Job card", "j.doc_no"), d("doc_date", "Date", "j.doc_date"), t("branch", "Branch", "b.code"), st("line_type", "Line type", "l.line_type"), t("description", "Description", "l.description"),
      t("service", "Service", "s.name_en"), t("part_no", "Part no.", "it.part_no"), n("qty", "Quantity", "l.qty"), n("standard_hours", "Standard hours", "l.standard_hours"),
      m("unit_price", "Unit price", "l.unit_price"), m("amount", "Amount before discount", "round(l.qty * l.unit_price, 2)"), m("discount", "Discount", "l.discount_amount", "discount"),
      t("technician", "Technician", "tu.full_name"), st("approval", "Customer decision", "l.approval_status"), t("extra_work", "Extra work", "CASE WHEN l.extra_work THEN 'Yes' ELSE 'No' END")] },
  { key: "quotations", label: "Quotations", module: "jobs", branch: "q.branch_id", date: "q.doc_date", archive: ["quotation", "q.id"],
    from: "quotation q JOIN branch b ON b.id = q.branch_id LEFT JOIN app_user u ON u.id = q.created_by",
    fields: [t("doc_no", "Quotation", "q.doc_no"), d("doc_date", "Date", "q.doc_date"), t("branch", "Branch", "b.code"), st("status", "Status", "q.status"), t("advisor", "Prepared by", "u.full_name"),
      n("revision", "Revision", "q.revision"), m("gross", "Gross", "q.gross_amount"), m("discount", "Discount", "q.discount_total", "discount"), m("taxable", "Taxable", "q.taxable_total"),
      m("vat", "VAT", "q.vat_total"), m("total", "Total", "q.grand_total"), m("approved_total", "Approved total", "q.approved_total")] },
  { key: "invoices", label: "Invoices", module: "invoices", branch: "i.branch_id", date: "i.doc_date", archive: ["sales_invoice", "i.id"],
    from: "sales_invoice i JOIN branch b ON b.id = i.branch_id LEFT JOIN customer c ON c.id = i.customer_id LEFT JOIN job_card j ON j.id = i.job_card_id LEFT JOIN app_user u ON u.id = j.advisor_id",
    fields: [t("doc_no", "Invoice", "i.doc_no"), d("doc_date", "Date", "i.doc_date"), t("branch", "Branch", "b.code"), t("customer", "Customer", `coalesce(i.bill_to_name, ${CUST()})`),
      t("advisor", "Advisor", "u.full_name"), st("kind", "Invoice kind", "i.invoice_kind"), st("source", "Source", "i.source"), m("net", "Net", "i.taxable_total"), m("vat", "VAT", "i.vat_total"),
      m("gross", "Gross", "i.grand_total"), m("paid", "Paid", "i.paid_amount"), m("credited", "Credited", "i.credited_amount"), m("open", "Open", "i.grand_total - i.paid_amount - i.credited_amount"),
      d("due_date", "Due date", "i.due_date")] },
  { key: "sales", label: "Sales lines", module: "invoices", branch: "i.branch_id", date: "i.doc_date", archive: ["sales_invoice", "i.id"],
    from: "sales_invoice_line l JOIN sales_invoice i ON i.id = l.invoice_id JOIN branch b ON b.id = i.branch_id LEFT JOIN item it ON it.id = l.item_id LEFT JOIN job_line jl ON jl.id = l.job_line_id LEFT JOIN service s ON s.id = jl.service_id",
    fields: [t("doc_no", "Invoice", "i.doc_no"), d("doc_date", "Date", "i.doc_date"), t("branch", "Branch", "b.code"), st("line_type", "Line type", "l.line_type"), t("description", "Description", "l.description"),
      t("service", "Service", "s.name_en"), t("part_no", "Part no.", "it.part_no"), t("category", "Item category", "it.category"), n("qty", "Quantity", "l.qty"), m("unit_price", "Unit price", "l.unit_price"),
      m("discount", "Discount", "l.discount_amount", "discount"), m("net", "Net", "l.taxable_amount"), m("vat", "VAT", "l.vat_amount"), m("gross", "Gross", "l.line_total"),
      m("cost", "Cost", "l.cost_value", "purchase_cost"), m("margin", "Margin", "l.taxable_amount - coalesce(l.cost_value, 0)", "margin")] },
  { key: "payments", label: "Payments received", module: "invoices", branch: "r.branch_id", date: "r.doc_date", archive: ["receipt", "r.id"],
    from: "receipt r JOIN branch b ON b.id = r.branch_id LEFT JOIN customer c ON c.id = r.customer_id",
    fields: [t("doc_no", "Receipt", "r.doc_no"), d("doc_date", "Date", "r.doc_date"), t("branch", "Branch", "b.code"), t("customer", "Customer", CUST()), st("method", "Method", "r.method"),
      st("kind", "Kind", "r.kind"), m("amount", "Amount", "r.amount"), t("reference", "Reference", "r.reference"), st("cheque_status", "Cheque status", "r.cheque_status")] },
  { key: "stock", label: "Items and stock", module: "stock", branch: "sb.branch_id",
    from: "stock_balance sb JOIN item it ON it.id = sb.item_id JOIN branch b ON b.id = sb.branch_id",
    fields: [t("branch", "Branch", "b.code"), t("part_no", "Part no.", "it.part_no"), t("description", "Item", "it.description"), t("brand", "Brand", "it.brand"), t("category", "Category", "it.category"),
      n("on_hand", "On hand", "sb.on_hand"), n("committed", "Committed", "sb.committed"), n("available", "Available", "sb.on_hand - sb.committed"), m("list_price", "List price", "it.list_price"),
      m("avg_cost", "Average cost", "round(sb.avg_cost, 2)", "purchase_cost"), m("value", "Stock value", "round(sb.on_hand * sb.avg_cost, 2)", "purchase_cost"), d("last_move", "Last movement", "sb.last_move_at::date")] },
  { key: "stock_moves", label: "Stock movements", module: "stock", branch: "sm.branch_id", date: "sm.at::date", archive: ["stock_move", "sm.id"],
    from: "stock_move sm JOIN item it ON it.id = sm.item_id JOIN branch b ON b.id = sm.branch_id LEFT JOIN app_user u ON u.id = sm.user_id",
    fields: [d("date", "Date", "sm.at::date"), t("branch", "Branch", "b.code"), t("part_no", "Part no.", "it.part_no"), t("description", "Item", "it.description"), st("move_type", "Movement", "sm.move_type"),
      t("doc_ref", "Document", "sm.doc_ref"), n("qty_in", "In", "sm.qty_in"), n("qty_out", "Out", "sm.qty_out"), m("value", "Value", "sm.value", "purchase_cost"), t("user", "By", "u.full_name")] },
  { key: "purchases", label: "Purchases (supplier bill lines)", module: "purchasing", branch: "sb.branch_id", date: "sb.invoice_date", archive: ["supplier_bill", "sb.id"],
    from: "supplier_bill_line l JOIN supplier_bill sb ON sb.id = l.bill_id JOIN branch b ON b.id = sb.branch_id JOIN supplier s ON s.id = sb.supplier_id LEFT JOIN grn_line gl ON gl.id = l.grn_line_id LEFT JOIN item it ON it.id = gl.item_id",
    fields: [t("doc_no", "Bill", "sb.doc_no"), d("invoice_date", "Date", "sb.invoice_date"), t("branch", "Branch", "b.code"), t("supplier", "Supplier", "s.name_en"), st("status", "Status", "sb.status"),
      t("description", "Description", "l.description"), t("part_no", "Part no.", "it.part_no"), n("qty", "Quantity", "l.qty"), m("net", "Net", "l.net_amount", "purchase_cost"),
      m("vat", "VAT", "l.vat_amount", "purchase_cost"), m("gross", "Gross", "l.net_amount + l.vat_amount", "purchase_cost")] },
  { key: "customers", label: "Customers", module: "customers", branch: null, date: "c.created_at::date", dateLabel: "Created",
    from: "customer c LEFT JOIN branch b ON b.id = c.preferred_branch_id",
    fields: [t("customer_no", "Customer no.", "c.customer_no"), t("name", "Name", CUST()), st("type", "Type", "c.customer_type"), t("mobile", "Mobile", "c.mobile"), t("email", "Email", "c.email"),
      t("nationality", "Nationality", "c.nationality"), t("branch", "Preferred branch", "b.code"), st("price_level", "Price level", "c.price_level"), m("credit_limit", "Credit limit", "c.credit_limit"),
      t("consent", "Marketing consent", "CASE WHEN c.marketing_consent THEN 'Yes' ELSE 'No' END"), d("created", "Created", "c.created_at::date")] },
  { key: "vehicles", label: "Vehicles", module: "customers", branch: null, date: "v.created_at::date", dateLabel: "Created",
    from: "vehicle v LEFT JOIN customer c ON c.id = v.owner_customer_id",
    fields: [t("plate", "Plate", PLATE()), t("make", "Make", "v.make"), t("model", "Model", "v.model"), n("year", "Year", "v.model_year"), t("vin", "VIN", "v.vin"), t("colour", "Colour", "v.colour"),
      n("odometer", "Odometer", "v.odometer"), d("mulkiya_expiry", "Mulkiya expiry", "v.mulkiya_expiry"), t("owner", "Owner", CUST())] },
  { key: "employees", label: "Employees", module: "hr", branch: "e.branch_id", date: "e.joining_date", dateLabel: "Joined",
    from: "employee e JOIN branch b ON b.id = e.branch_id LEFT JOIN department dp ON dp.id = e.department_id LEFT JOIN designation dg ON dg.id = e.designation_id",
    fields: [t("emp_no", "Emp. no.", "e.emp_no"), t("name", "Name", EMP()), t("branch", "Branch", "b.code"), t("department", "Department", "dp.name_en"), t("designation", "Designation", "dg.name_en"),
      t("nationality", "Nationality", "e.nationality"), st("gender", "Gender", "e.gender"), d("joining_date", "Joined", "e.joining_date"), st("contract_type", "Contract", "e.contract_type"),
      d("contract_end", "Contract end", "e.contract_end"), st("status", "Status", "e.status"), st("pay_method", "Pay method", "e.pay_method"),
      n("service_years", "Years of service", "round((coalesce(e.leaving_date, current_date) - e.joining_date) / 365.0, 2)")] },
  { key: "attendance", label: "Attendance punches", module: "hr", branch: "pu.branch_id", date: "pu.at::date",
    from: "punch pu JOIN employee e ON e.id = pu.employee_id JOIN branch b ON b.id = pu.branch_id",
    fields: [d("date", "Date", "pu.at::date"), t("time", "Time", "to_char(pu.at, 'HH24:MI')"), t("employee", "Employee", EMP()), t("emp_no", "Emp. no.", "e.emp_no"), t("branch", "Branch", "b.code"),
      st("source", "Source", "pu.source"), n("distance_m", "Distance (m)", "pu.distance_m"), t("note", "Note", "pu.note")] },
  { key: "payroll", label: "Payroll", module: "hr", salary: true, branch: "pe.branch_id", date: "r.period_month", dateLabel: "Month", archive: ["payroll_run", "r.id"],
    from: "payroll_employee pe JOIN payroll_run r ON r.id = pe.run_id JOIN employee e ON e.id = pe.employee_id JOIN branch b ON b.id = pe.branch_id",
    fields: [t("month", "Month", "to_char(r.period_month, 'YYYY-MM')"), st("run_status", "Run status", "r.status"), t("employee", "Employee", EMP()), t("emp_no", "Emp. no.", "e.emp_no"), t("branch", "Branch", "b.code"),
      n("paid_days", "Paid days", "pe.paid_days"), n("unpaid_days", "Unpaid days", "pe.unpaid_days"), n("ot_hours", "Overtime hours", "pe.ot_hours"), m("gross", "Gross", "pe.gross", "salary"),
      m("deductions", "Deductions", "pe.total_deductions", "salary"), m("net", "Net", "pe.net", "salary"), m("gratuity_accrual", "Gratuity accrual", "pe.accrual_gratuity", "salary"),
      m("gratuity_liability", "Gratuity liability", "pe.gratuity_liability", "salary")] },
  { key: "ledgers", label: "Ledgers and vouchers", module: "accounting", branch: "l.branch_id", date: "j.journal_date", archive: ["journal", "j.id"],
    from: "journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id JOIN branch b ON b.id = l.branch_id",
    fields: [d("date", "Date", "j.journal_date"), t("doc_no", "Journal", "j.doc_no"), st("source", "Source", "j.source_type"), t("branch", "Branch", "b.code"), t("account_code", "Account code", "a.code"),
      t("account", "Account", "a.name"), st("account_type", "Account type", "a.account_type"), t("narration", "Narration", "coalesce(l.narration, j.narration)"),
      m("debit", "Debit", "l.debit", "bank_balance"), m("credit", "Credit", "l.credit", "bank_balance"), m("net", "Debit less credit", "l.debit - l.credit", "bank_balance")] },
];

export type Agg = "" | "sum" | "count" | "avg" | "min" | "max";
export type Op = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "empty" | "not_empty";
export type Spec = {
  columns: { field: string; label?: string; agg?: Agg }[];
  filters: { field: string; op: Op; value?: string; prompt?: boolean }[];
  sort?: { col: string; dir: "asc" | "desc" } | null;
  subtotal?: string | null;
  pivot?: { row: string; col: string; value: string; agg: Exclude<Agg, ""> } | null;
  calcs?: { label: string; op: "diff" | "pct" | "mul" | "sum" | "ratio"; a: string; b: string; rate?: string }[];
  chart?: { type: "bar" | "line" | "pie"; x: string; y: string } | null;
  useDates?: boolean;
};
export const OPS: [Op, string][] = [["eq", "is"], ["ne", "is not"], ["contains", "contains"], ["gt", "more than"], ["ge", "at least"], ["lt", "less than"], ["le", "at most"], ["empty", "is empty"], ["not_empty", "is not empty"]];
export const AGGS: [Agg, string][] = [["", "Show each value"], ["sum", "Total"], ["count", "Count"], ["avg", "Average"], ["min", "Lowest"], ["max", "Highest"]];
export const CALC_OPS: [string, string][] = [["diff", "A minus B"], ["sum", "A plus B"], ["pct", "A as % of B"], ["ratio", "A divided by B"], ["mul", "A times rate"]];

export const sourceDef = (key: string) => SOURCES.find((s) => s.key === key);

/** Custom employee fields from the Employee fields master, offered on the Employees source unless hidden from the role. */
async function withCustom(c: PoolClient, src: Source): Promise<Source> {
  if (src.key !== "employees") return src;
  const cf = (await c.query("SELECT code, label, field_type, hidden_roles FROM custom_field WHERE active ORDER BY sort, label")).rows;
  return { ...src, fields: [...src.fields, ...cf.map((f) => ({ key: `cf_${f.code}`, label: f.label, expr: `e.custom ->> '${String(f.code).replace(/[^a-z0-9_]/gi, "")}'`, type: (f.field_type === "number" ? "num" : f.field_type === "date" ? "date" : "text") as ColType, cfRoles: f.hidden_roles }))] };
}

const fieldVisible = (ctx: Ctx, f: Field, branches: string[]) =>
  branches.every((b) => (!f.group || canSee(ctx, f.group, b)) && (!f.cfRoles || !f.cfRoles.split(",").map((s) => s.trim()).filter(Boolean).includes(roleAt(ctx, b)?.roleCode ?? "")));

/** The source with only the fields this user may see at the branches chosen (RB-11). */
export async function sourceFor(c: PoolClient, ctx: Ctx, key: string, branches: string[]) {
  const src = sourceDef(key);
  if (!src) throw invalid("Choose a data source.", { field: "source" });
  const full = await withCustom(c, src);
  return { ...full, fields: full.fields.filter((f) => fieldVisible(ctx, f, branches)) };
}

/** Sources the user may build on, each with the fields they may see. */
export async function builderSources(ctx: Ctx) {
  return withTx(ctx, async (c) => {
    const out: (Source & { branches: { id: string; code: string }[] })[] = [];
    for (const s of SOURCES) {
      try {
        const br = await reportBranches(c, ctx, s, undefined);
        out.push({ ...(await sourceFor(c, ctx, s.key, br.all.map((b) => b.id))), branches: br.all });
      } catch { /* no access to this source */ }
    }
    return out;
  });
}

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** Checks a spec against the source: only known fields, aggregations, operators and calculations. */
export function cleanSpec(raw: unknown, src: Source): Spec {
  const r = (raw ?? {}) as Record<string, unknown>;
  const has = (k: string) => src.fields.some((f) => f.key === k);
  const cols = (Array.isArray(r.columns) ? r.columns : []).slice(0, 30).map((x) => x as Record<string, unknown>).filter((x) => str(x.field));
  if (!cols.length) throw invalid("Choose at least one column.", { field: "columns" });
  for (const x of cols) if (!has(str(x.field))) throw invalid(`The field ${str(x.field)} is not available to you in ${src.label}.`, { field: "columns" });
  const columns = cols.map((x) => ({ field: str(x.field), label: str(x.label, 60) || undefined, agg: (AGGS.some(([a]) => a === x.agg) ? x.agg : "") as Agg }));
  for (const col of columns) {
    const f = src.fields.find((y) => y.key === col.field)!;
    if (["sum", "avg"].includes(col.agg ?? "") && !["num", "money", "hours", "int", "pct"].includes(f.type)) throw invalid(`${f.label} is not a number, so it cannot be totalled or averaged.`, { field: "columns" });
  }
  const filters = (Array.isArray(r.filters) ? r.filters : []).slice(0, 20).map((x) => x as Record<string, unknown>).filter((x) => str(x.field)).map((x) => {
    if (!has(str(x.field))) throw invalid(`The field ${str(x.field)} cannot be used as a filter.`, { field: "filters" });
    if (!OPS.some(([o]) => o === x.op)) throw invalid("Choose a filter condition.", { field: "filters" });
    return { field: str(x.field), op: x.op as Op, value: str(x.value), prompt: !!x.prompt };
  });
  const keys = columns.map((_, i) => `c${i}`);
  const calcs = (Array.isArray(r.calcs) ? r.calcs : []).slice(0, 5).map((x) => x as Record<string, unknown>).filter((x) => str(x.op)).map((x) => {
    if (!CALC_OPS.some(([o]) => o === x.op)) throw invalid("Choose a calculation.", { field: "calcs" });
    if (!keys.includes(str(x.a)) || (x.op !== "mul" && !keys.includes(str(x.b)))) throw invalid("A calculation must use two of the report's columns.", { field: "calcs" });
    if (x.op === "mul" && !/^-?\d+(\.\d+)?$/.test(str(x.rate))) throw invalid("Enter the rate as a number.", { field: "calcs" });
    return { label: str(x.label, 60) || "Calculated", op: x.op as "diff", a: str(x.a), b: str(x.b), rate: str(x.rate) };
  });
  const allKeys = [...keys, ...calcs.map((_, i) => `k${i}`)];
  const so = r.sort as Record<string, unknown> | null | undefined;
  const sort = so && str(so.col) ? { col: allKeys.includes(str(so.col)) ? str(so.col) : "c0", dir: so.dir === "desc" ? "desc" as const : "asc" as const } : null;
  const subtotal = r.subtotal && keys.includes(str(r.subtotal)) ? str(r.subtotal) : null;
  const pv = r.pivot as Record<string, unknown> | null | undefined;
  let pivot: Spec["pivot"] = null;
  if (pv && str(pv.row)) {
    if (!has(str(pv.row)) || !has(str(pv.col)) || !has(str(pv.value))) throw invalid("Choose the pivot row, column and value from the fields.", { field: "pivot" });
    const agg = (["sum", "count", "avg", "min", "max"].includes(str(pv.agg)) ? str(pv.agg) : "sum") as "sum" | "count" | "avg" | "min" | "max";
    const vf = src.fields.find((f) => f.key === str(pv.value))!;
    if (agg !== "count" && !["num", "money", "hours", "int", "pct"].includes(vf.type)) throw invalid("The pivot value must be a number, or use Count.", { field: "pivot" });
    pivot = { row: str(pv.row), col: str(pv.col), value: str(pv.value), agg };
  }
  const ch = r.chart as Record<string, unknown> | null | undefined;
  const chart = ch && ["bar", "line", "pie"].includes(str(ch.type)) ? { type: str(ch.type) as "bar", x: allKeys.includes(str(ch.x)) ? str(ch.x) : "c0", y: allKeys.includes(str(ch.y)) ? str(ch.y) : allKeys[allKeys.length - 1] } : null;
  return { columns, filters, sort, subtotal, pivot, calcs, chart, useDates: r.useDates !== false && !!src.date };
}

class P { v: unknown[] = []; add(x: unknown) { this.v.push(x); return `$${this.v.length}`; } }
const CAST: Record<string, string> = { num: "numeric", money: "numeric", int: "numeric", hours: "numeric", pct: "numeric", date: "date" };

function filterSql(f: Spec["filters"][number], fld: Field, p: P, value: string) {
  const e = fld.expr;
  if (f.op === "empty") return `(${e}) IS NULL OR (${e})::text = ''`;
  if (f.op === "not_empty") return `(${e}) IS NOT NULL AND (${e})::text <> ''`;
  if (f.op === "contains") return `(${e})::text ILIKE ${p.add(`%${value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)}`;
  const cast = CAST[fld.type];
  if (cast === "numeric" && !/^-?\d+(\.\d+)?$/.test(value)) throw invalid(`${fld.label}: enter a number to filter on.`, { field: "filters" });
  if (cast === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid(`${fld.label}: enter a date to filter on.`, { field: "filters" });
  const op = { eq: "=", ne: "<>", gt: ">", ge: ">=", lt: "<", le: "<=" }[f.op];
  return cast ? `(${e}) ${op} ${p.add(value)}::${cast}` : `lower((${e})::text) ${op} lower(${p.add(value)})`;
}

/** Code-like values (labour, pending_approval) as words for pivot headings. */
const words = (v: string) => (/^[a-z]+(_[a-z]+)*$/.test(v) ? v.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : v);

export type BuiltResult = { columns: Col[]; rows: Row[]; totals: Row; chart: Spec["chart"]; pivoted: boolean; truncated: boolean; max: number };

/** Runs a builder spec. Prompted filters take their value from the run-time input p0, p1... (RB-03). */
export async function runSpec(c: PoolClient, ctx: Ctx, srcKey: string, rawSpec: unknown, q: RunInput, branches: string[]): Promise<BuiltResult> {
  const src = await sourceFor(c, ctx, srcKey, branches);
  const spec = cleanSpec(rawSpec, src);
  const fld = (k: string) => src.fields.find((f) => f.key === k)!;
  const p = new P();
  const where: string[] = [];
  if (src.branch) where.push(`${src.branch} = ANY(${p.add(branches)}::uuid[])`);
  if (spec.useDates && src.date) {
    const dd = defaultDates({});
    const from = s1(q.from) || dd.from, to = s1(q.to) || dd.to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw invalid("Check the dates.", { field: "from" });
    where.push(`${src.date} BETWEEN ${p.add(from)}::date AND ${p.add(to)}::date`);
  }
  if (src.archive) {
    const source = s1(q.source) || "live";
    const sub = `SELECT 1 FROM archive_member am WHERE am.tbl = '${src.archive[0]}' AND am.row_id = ${src.archive[1]}::text`;
    where.push(source === "archived" ? `EXISTS (${sub})` : /^[0-9a-f-]{36}$/i.test(source) ? `EXISTS (${sub} AND am.run_id = ${p.add(source)})` : `NOT EXISTS (${sub})`);
  }
  spec.filters.forEach((f, i) => {
    const v = f.prompt && q[`p${i}`] !== undefined ? s1(q[`p${i}`]) : f.value ?? "";
    if (f.prompt && !v && !["empty", "not_empty"].includes(f.op)) return; // an empty prompt means "any"
    where.push(`(${filterSql(f, fld(f.field), p, v)})`);
  });
  const max = Number(await getSetting(c, "reports.max_rows", null, 5000));
  const W = where.length ? where.join(" AND ") : "true";

  if (spec.pivot) {
    const pv = spec.pivot, rf = fld(pv.row), cf = fld(pv.col), vf = fld(pv.value);
    const agg = pv.agg === "count" ? `count(${vf.expr})` : `${pv.agg}(${vf.expr})`;
    const rows = (await c.query(`SELECT (${rf.expr})::text r, (${cf.expr})::text k, ${agg} v FROM ${src.from} WHERE ${W} GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 20000`, p.v)).rows;
    const colVals = [...new Set(rows.map((x) => x.k ?? ""))].slice(0, 24);
    const byRow = new Map<string, Row>();
    for (const x of rows) {
      if (!colVals.includes(x.k ?? "")) continue;
      const key = x.r ?? "";
      const o: Row = byRow.get(key) ?? { r: key, total: 0 };
      o[`v${colVals.indexOf(x.k ?? "")}`] = x.v; o.total = Number(o.total) + Number(x.v ?? 0);
      byRow.set(key, o);
    }
    const vtype: ColType = pv.agg === "count" ? "int" : vf.type;
    const columns: Col[] = [{ key: "r", label: `${rf.label} \\ ${cf.label}`, type: rf.type }, ...colVals.map((v, i) => ({ key: `v${i}`, label: words(v) || "(blank)", type: vtype, total: true })), { key: "total", label: "Total", type: vtype, total: true }];
    const out = [...byRow.values()];
    const totals: Row = {};
    for (const col of columns.slice(1)) totals[col.key] = out.reduce((s, r) => s + (Number(r[col.key]) || 0), 0);
    return { columns, rows: out.slice(0, max), totals, chart: spec.chart ? { ...spec.chart, x: "r", y: "total" } : null, pivoted: true, truncated: out.length > max, max };
  }

  const grouped = spec.columns.some((x) => x.agg);
  const sel = spec.columns.map((x, i) => {
    const f = fld(x.field);
    const e = x.agg === "count" ? `count(${f.expr})` : x.agg ? `${x.agg}(${f.expr})` : f.type === "date" ? `to_char(${f.expr}, 'YYYY-MM-DD')` : f.expr;
    return `${x.agg && x.agg !== "count" && x.agg !== "min" && x.agg !== "max" ? `round((${e})::numeric, 2)` : e} AS c${i}`;
  });
  const groupBy = grouped ? spec.columns.map((x, i) => (x.agg ? null : String(i + 1))).filter(Boolean) : [];
  const order = spec.sort && spec.sort.col.startsWith("c") ? `${Number(spec.sort.col.slice(1)) + 1} ${spec.sort.dir.toUpperCase()}` : spec.subtotal ? `${Number(spec.subtotal.slice(1)) + 1}` : "1";
  const sql = `SELECT ${sel.join(", ")} FROM ${src.from} WHERE ${W} ${groupBy.length ? `GROUP BY ${groupBy.join(", ")}` : ""} ORDER BY ${spec.subtotal ? `${Number(spec.subtotal.slice(1)) + 1}, ` : ""}${order} LIMIT ${max + 1}`;
  let rows: Row[] = (await c.query(sql, p.v)).rows;
  const truncated = rows.length > max;
  if (truncated) rows = rows.slice(0, max);
  const columns: Col[] = spec.columns.map((x, i) => {
    const f = fld(x.field);
    const type: ColType = x.agg === "count" ? "int" : f.type;
    return { key: `c${i}`, label: x.label || (x.agg ? `${AGGS.find(([a]) => a === x.agg)![1]} of ${f.label.toLowerCase()}` : f.label), type, total: ["money", "num", "int", "hours"].includes(type) && x.agg !== "avg" && x.agg !== "min" && x.agg !== "max" };
  });
  // Safe calculated columns (RB-05): difference, sum, percentage, ratio and amount x rate, worked out on each row.
  (spec.calcs ?? []).forEach((k, i) => {
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    for (const r of rows) {
      const a = num(r[k.a]), b = num(r[k.b]);
      let v: number | null = null;
      if (k.op === "mul") v = a === null ? null : a * Number(k.rate);
      else if (a !== null && b !== null) v = k.op === "diff" ? a - b : k.op === "sum" ? a + b : b === 0 ? null : k.op === "pct" ? (a / b) * 100 : a / b;
      r[`k${i}`] = v === null ? null : Math.round(v * 100) / 100;
    }
    columns.push({ key: `k${i}`, label: k.label, type: k.op === "pct" ? "pct" : "num", total: ["diff", "sum", "mul"].includes(k.op) });
  });
  if (spec.sort && spec.sort.col.startsWith("k")) {
    const key = spec.sort.col, dir = spec.sort.dir === "desc" ? -1 : 1;
    rows.sort((a, b) => (Number(a[key] ?? -Infinity) - Number(b[key] ?? -Infinity)) * dir);
  }
  const totals: Row = {};
  for (const col of columns) if (col.total) totals[col.key] = rows.reduce((s, r) => s + (Number(r[col.key]) || 0), 0);
  // Subtotals (RB-02): a subtotal row after each change of the chosen column.
  if (spec.subtotal) {
    const out: Row[] = [];
    let cur: unknown = Symbol("start"), acc: Row = {};
    const flush = () => { if (Object.keys(acc).length) out.push({ ...acc, $subtotal: true, [spec.subtotal!]: `Subtotal ${cur ?? ""}` }); };
    for (const r of rows) {
      if (r[spec.subtotal] !== cur) { flush(); cur = r[spec.subtotal]; acc = {}; }
      for (const col of columns) if (col.total) acc[col.key] = Number(acc[col.key] ?? 0) + (Number(r[col.key]) || 0);
      out.push(r);
    }
    flush();
    rows = out;
  }
  return { columns, rows, totals, chart: spec.chart ?? null, pivoted: false, truncated, max };
}

/** Preview or run a spec that is not saved yet (the builder screen). */
export async function previewSpec(ctx: Ctx, srcKey: string, rawSpec: unknown, q: RunInput) {
  const src = sourceDef(srcKey);
  if (!src) throw invalid("Choose a data source.", { field: "source" });
  return withTx(ctx, async (c) => {
    const br = await reportBranches(c, ctx, src, q.branches);
    const ids = br.chosen.map((b) => b.id);
    const res = await runSpec(c, ctx, srcKey, rawSpec, q, ids);
    return { ...res, branches: br.all, chosen: br.chosen, canExport: canExport(ctx, ids) };
  });
}

export function assertSource(ctx: Ctx, srcKey: string) {
  const src = sourceDef(srcKey);
  if (!src) throw invalid("Choose a data source.", { field: "source" });
  if (!ctx.branchIds.length) throw forbidden();
  return src;
}
