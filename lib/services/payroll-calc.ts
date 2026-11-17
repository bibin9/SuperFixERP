import { D, Decimal, r2 } from "../money";

/**
 * Payroll arithmetic from FSD 5.5 (UAE Federal Decree-Law No. 33 of 2021). Pure functions: every
 * factor comes in as an argument so it can follow the settings, and each one has a worked example
 * in the tests.
 */

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const parseDate = (s: string) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
export const addDays = (s: string, n: number) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
export const daysBetween = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000); // b - a
export const monthEnd = (month: string) => { const d = parseDate(month.slice(0, 7) + "-01"); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return isoDate(d); };
export const daysInMonth = (month: string) => Number(monthEnd(month).slice(8, 10));

/** Full years, months and days from start to end (end inclusive is not added: a service ending the day before the anniversary is not a year). */
export function ymd(start: string, end: string) {
  const s = parseDate(start), e = parseDate(addDays(end, 1));
  let y = e.getUTCFullYear() - s.getUTCFullYear(), m = e.getUTCMonth() - s.getUTCMonth(), d = e.getUTCDate() - s.getUTCDate();
  if (d < 0) { m -= 1; const prev = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)); d += prev.getUTCDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return { y: Math.max(0, y), m: Math.max(0, m), d: Math.max(0, d) };
}
/** Service in years as Y + M/12 + D/365 (6 years 3 months = 6.25). Unpaid leave days are taken out first. */
export function serviceYears(joining: string, lastDay: string, unpaidDays = 0) {
  const end = unpaidDays ? addDays(lastDay, -Math.round(unpaidDays)) : lastDay;
  if (end < joining) return D(0);
  const { y, m, d } = ymd(joining, end);
  return D(y).plus(D(m).div(12)).plus(D(d).div(365));
}

/**
 * Gratuity (PR-05, PR-12): needs one year of continuous service; 21 days' basic for each of the
 * first five years and 30 days' basic for each year after, pro-rated; capped at two years' wage.
 * Example: basic 2,000, 6 years 3 months -> 7,000.00 + 2,500.00 = 9,500.00.
 */
export function gratuity(basicMonthly: Decimal.Value, years: Decimal.Value, opts: { divisor?: number; capMonths?: number } = {}) {
  const yrs = D(years), basic = D(basicMonthly);
  if (yrs.lt(1) || basic.lte(0)) return D(0);
  const daily = basic.div(opts.divisor ?? 30);
  const first = Decimal.min(yrs, 5), after = Decimal.max(yrs.minus(5), 0);
  const g = daily.times(21).times(first).plus(daily.times(30).times(after));
  return r2(Decimal.min(g, basic.times(opts.capMonths ?? 24)));
}

/** Overtime (HR-13): hourly base = basic x 12 / 365 / 8; amount = hours x base x multiplier. Basic 2,000, 10 h normal -> 102.74. */
export function overtimeAmount(basicMonthly: Decimal.Value, hours: Decimal.Value, multiplier: Decimal.Value) {
  const hourly = D(basicMonthly).times(12).div(365).div(8);
  return r2(hourly.times(hours).times(multiplier));
}

/**
 * Annual leave earned to a date (HR-04): nothing in the first six months, then 2 days for each
 * month of service in the first year, then 30 days a year (2.5 a month).
 */
export function annualLeaveEarned(joining: string, asOf: string) {
  if (asOf < joining) return D(0);
  const { y, m } = ymd(joining, asOf);
  const months = y * 12 + m;
  if (months < 6) return D(0);
  if (months <= 12) return D(months * 2);
  return D(24).plus(D(months - 12).times(2.5));
}

/** Pro-rated amount of a fixed component (FSD 5.5): monthly x paid days / divisor (30 or the month's calendar days). */
export function prorate(monthly: Decimal.Value, paidDays: Decimal.Value, divisor: number) {
  return r2(D(monthly).times(paidDays).div(divisor));
}

/**
 * Paid days in the month. With the 30-day basis a full month is 30 days whatever its length; a
 * part month counts its calendar days employed (at most 30). Unpaid leave comes off either way.
 */
export function paidDays(month: string, employedFrom: string, employedTo: string, unpaid: number, basis: "30" | "calendar") {
  const first = month.slice(0, 7) + "-01", last = monthEnd(month);
  const from = employedFrom > first ? employedFrom : first, to = employedTo < last ? employedTo : last;
  if (to < from) return { days: 0, employed: 0, divisor: basis === "30" ? 30 : daysInMonth(month) };
  const employed = daysBetween(from, to) + 1, full = from === first && to === last;
  const divisor = basis === "30" ? 30 : daysInMonth(month);
  const base = basis === "30" ? (full ? 30 : Math.min(30, employed)) : employed;
  return { days: Math.max(0, base - unpaid), employed, divisor };
}

/**
 * Splits amounts across branches by working days (PR-04), the last branch taking the rounding.
 * Gross 3,000 with 10 days at Yas and 16 at Al Qusais -> 1,153.85 and 1,846.15.
 */
export function splitByDays(amount: Decimal.Value, parts: { key: string; days: number }[]) {
  const total = parts.reduce((s, p) => s + p.days, 0);
  const out: Record<string, Decimal> = {};
  if (!total) return out;
  let left = D(amount);
  parts.forEach((p, i) => {
    const v = i === parts.length - 1 ? left : r2(D(amount).times(p.days).div(total));
    out[p.key] = (out[p.key] ?? D(0)).plus(v); left = left.minus(v);
  });
  return out;
}

/**
 * Deduction cap (PR-02): total deductions at most cap % of the wage. Fixed deductions are taken
 * first, then other deductions, then loan instalments; whatever does not fit is carried forward.
 */
export function capDeductions(wage: Decimal.Value, capPct: Decimal.Value, items: { key: string; amount: Decimal.Value; carry: boolean }[]) {
  let room = r2(D(wage).times(capPct).div(100));
  const taken: Record<string, Decimal> = {}; let carried = D(0);
  const order = [...items.filter((i) => !i.carry), ...items.filter((i) => i.carry)];
  for (const it of order) {
    const want = D(it.amount);
    const take = Decimal.max(Decimal.min(want, room), 0);
    if (take.gt(0)) taken[it.key] = take;
    room = room.minus(take);
    if (want.gt(take)) carried = carried.plus(want.minus(take));
  }
  return { taken, carried };
}

/** Distance in metres between two points (haversine), for GPS check-in. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export type SifEmployee = { personCode: string; routing: string; account: string; start: string; end: string; days: number; fixed: string; variable: string; leaveDays: number };
/**
 * WPS salary information file (PR-03, FSD 5.5): one EDR per employee and one SCR control record.
 * The name is the 13-digit MOHRE establishment ID plus YYMMDDHHMMSS with extension .SIF.
 */
export function buildSif(opts: { establishmentId: string; routing: string; month: string; employerRef: string; at: Date; employees: SifEmployee[] }) {
  const p = (n: number) => String(n).padStart(2, "0");
  const dubai = new Date(opts.at.getTime() + 4 * 3600000);
  const Y = dubai.getUTCFullYear(), M = dubai.getUTCMonth() + 1, Dd = dubai.getUTCDate(), h = dubai.getUTCHours(), mi = dubai.getUTCMinutes(), s = dubai.getUTCSeconds();
  const fileName = `${opts.establishmentId}${String(Y).slice(2)}${p(M)}${p(Dd)}${p(h)}${p(mi)}${p(s)}.SIF`;
  const lines = opts.employees.map((e) => ["EDR", e.personCode, e.routing, e.account, e.start, e.end, e.days, e.fixed, e.variable, e.leaveDays].join(","));
  const total = opts.employees.reduce((t, e) => t.plus(e.fixed).plus(e.variable), D(0));
  const mm = opts.month.slice(5, 7) + opts.month.slice(0, 4);
  lines.push(["SCR", opts.establishmentId, opts.routing, `${Y}-${p(M)}-${p(Dd)}`, `${p(h)}${p(mi)}`, mm, opts.employees.length, total.toFixed(2), "AED", opts.employerRef].join(","));
  return { fileName, content: lines.join("\r\n") + "\r\n", total: total.toFixed(2) };
}
