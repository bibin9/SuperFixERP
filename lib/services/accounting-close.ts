import type { PoolClient } from "pg";
import { Ctx, assertCan, can } from "../access";
import { withTx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal, type PostLine } from "./ledger";
import { getSetting } from "./settings";
import { D, Decimal, parseDec } from "../money";
import { today } from "./stock";
import { str } from "../validate";
import { assertOpenPeriod, ymd } from "./accounting";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** "2026-11" or "2026-11-01" to the first day of the month; refuses anything else. */
export function monthStart(v: unknown) {
  const s = str(v);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(s)) throw invalid("Choose a month.");
  const m = Number(s.slice(5, 7));
  if (m < 1 || m > 12) throw invalid("Choose a month.");
  return `${s.slice(0, 7)}-01`;
}
export function monthEnd(first: string) {
  const [y, m] = first.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
/** Month-end entries for the current month are dated today, never in the future. */
const postingDate = (first: string) => { const e = monthEnd(first), t = today(); return e > t ? t : e; };
const isOwner = (ctx: Ctx) => ctx.grants.some((g) => g.roleCode === "owner");
async function hqBranch(c: PoolClient) {
  const r = (await c.query("SELECT id, code FROM branch WHERE branch_type = 'head_office' AND active ORDER BY code LIMIT 1")).rows[0];
  if (!r) throw invalid("No head-office branch is set up. Add one under Settings, Branches.");
  return r as { id: string; code: string };
}

// =====================================================================================
// Period close (AC-09)
// =====================================================================================

export type CheckItem = { key: string; label: string; ok: boolean; detail: string; link?: string; manual?: boolean };

async function checklistFor(c: PoolClient, first: string): Promise<CheckItem[]> {
  const last = monthEnd(first);
  const one = async (sql: string) => Number((await c.query(sql, [first, last])).rows[0].n);
  const p = (await c.query("SELECT checklist FROM accounting_period WHERE period_month = $1", [first])).rows[0];
  const manual = (p?.checklist ?? {}) as Record<string, { by?: string; at?: string }>;
  const cash = await one("SELECT count(*) n FROM cash_session WHERE session_date BETWEEN $1 AND $2 AND status <> 'signed_off'");
  const bank = await one("SELECT count(*) n FROM bank_statement WHERE date_to BETWEEN $1 AND $2 AND status <> 'finished'");
  const counts = await one("SELECT count(*) n FROM stock_count WHERE created_at::date BETWEEN $1 AND $2 AND status IN ('open','submitted')");
  const vouchers = await one("SELECT count(*) n FROM voucher WHERE voucher_date BETWEEN $1 AND $2 AND status = 'pending_approval'");
  const bills = await one("SELECT count(*) n FROM supplier_bill WHERE invoice_date BETWEEN $1 AND $2 AND status NOT IN ('posted','cancelled','rejected')");
  const cns = await one("SELECT count(*) n FROM credit_note WHERE doc_date BETWEEN $1 AND $2 AND status = 'pending_approval'");
  const hasPayroll = (await c.query("SELECT to_regclass('payroll_run') IS NOT NULL ok")).rows[0].ok;
  const items: CheckItem[] = [
    { key: "cash", label: "Every cash closing is signed off", ok: cash === 0, detail: cash ? `${cash} cash closing(s) waiting for sign-off` : "All signed off", link: "/billing/cash" },
    { key: "bank", label: "Bank statements for the month are reconciled and finished", ok: bank === 0, detail: bank ? `${bank} statement(s) not finished` : "Nothing open", link: "/accounts/bank" },
    { key: "stock", label: "Stock counts are posted", ok: counts === 0, detail: counts ? `${counts} count(s) still open or waiting for approval` : "Nothing open", link: "/stock/adjustments" },
    { key: "vouchers", label: "No voucher is waiting for approval", ok: vouchers === 0, detail: vouchers ? `${vouchers} voucher(s) waiting` : "None waiting", link: "/accounts/vouchers" },
    { key: "bills", label: "Supplier bills for the month are posted", ok: bills === 0, detail: bills ? `${bills} bill(s) not posted` : "All posted", link: "/purchasing/bills" },
    { key: "credit_notes", label: "No credit note is waiting for approval", ok: cns === 0, detail: cns ? `${cns} credit note(s) waiting` : "None waiting", link: "/billing/credit-notes" },
  ];
  if (hasPayroll) {
    const pr = (await c.query("SELECT count(*) FILTER (WHERE status = 'posted') posted, count(*) n FROM payroll_run WHERE period_month = $1", [first])).rows[0];
    items.push({ key: "payroll", label: "Payroll for the month is posted", ok: Number(pr.posted) > 0, detail: Number(pr.posted) ? "Posted" : Number(pr.n) ? "Payroll run not posted yet" : "No payroll run yet", link: "/hr/payroll" });
  }
  items.push({ key: "vat", label: "VAT for the month has been reviewed", ok: !!manual.vat, manual: true, detail: manual.vat ? `Ticked by ${manual.vat.by} on ${String(manual.vat.at).slice(0, 10)}` : "Tick once you have checked the VAT return", link: "/accounts/vat" });
  return items;
}

export async function listPeriods(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT m::date period_month, coalesce(p.status, 'open') status, p.closed_at, cu.full_name closed_by_name, p.reopened_at, p.reopen_reason, ru.full_name reopened_by_name,
              (SELECT count(*) FROM journal j WHERE j.journal_date >= m AND j.journal_date < m + interval '1 month') journals
         FROM generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m
         LEFT JOIN accounting_period p ON p.period_month = m::date
         LEFT JOIN app_user cu ON cu.id = p.closed_by LEFT JOIN app_user ru ON ru.id = p.reopened_by
        ORDER BY m DESC`)).rows;
    return rows.map((r) => ({ ...r, period_month: ymd(r.period_month) }));
  });
}

export async function periodChecklist(ctx: Ctx, month: string) {
  assertCan(ctx, "accounting", "view");
  const first = monthStart(month);
  return withTx(ctx, async (c) => {
    const p = (await c.query("SELECT * FROM accounting_period WHERE period_month = $1", [first])).rows[0];
    return { month: first, status: (p?.status ?? "open") as string, items: await checklistFor(c, first), yearEndJournal: p?.year_end_journal_id ?? null };
  });
}

export async function tickPeriodItem(ctx: Ctx, month: string, key: string, on: boolean) {
  assertCan(ctx, "accounting", "edit");
  const first = monthStart(month);
  if (key !== "vat") throw invalid("Only the VAT review is ticked by hand; the other checks come from the records.");
  return withTx(ctx, async (c) => {
    await c.query("INSERT INTO accounting_period (period_month) VALUES ($1) ON CONFLICT DO NOTHING", [first]);
    const p = (await c.query("SELECT status FROM accounting_period WHERE period_month = $1 FOR UPDATE", [first])).rows[0];
    if (p.status === "closed") throw invalid("This month is closed.");
    const val = on ? JSON.stringify({ by: ctx.fullName, at: new Date().toISOString() }) : null;
    await c.query(on ? "UPDATE accounting_period SET checklist = checklist || jsonb_build_object($2::text, $3::jsonb) WHERE period_month = $1"
      : "UPDATE accounting_period SET checklist = checklist - $2::text WHERE period_month = $1", on ? [first, key, val] : [first, key]);
    await audit(c, ctx, "accounting_period", null, on ? "check_ticked" : "check_cleared", { month: first, key }, null);
  });
}

/** Locks a month for everyone (AC-09). Every check must pass; the database trigger then refuses any posting dated in it. */
export async function closePeriod(ctx: Ctx, month: string) {
  assertCan(ctx, "accounting", "approve");
  const first = monthStart(month);
  if (first > `${today().slice(0, 7)}-01`) throw invalid("A future month cannot be closed.");
  return withTx(ctx, async (c) => {
    await c.query("INSERT INTO accounting_period (period_month) VALUES ($1) ON CONFLICT DO NOTHING", [first]);
    const p = (await c.query("SELECT status FROM accounting_period WHERE period_month = $1 FOR UPDATE", [first])).rows[0];
    if (p.status === "closed") throw conflict("This month is already closed.");
    const earlierOpen = (await c.query(
      `SELECT to_char(min(m), 'Mon YYYY') m FROM generate_series(date_trunc('month', (SELECT coalesce(min(journal_date), $1::date) FROM journal))::date, $1::date - interval '1 month', interval '1 month') m
        WHERE NOT EXISTS (SELECT 1 FROM accounting_period ap WHERE ap.period_month = date_trunc('month', m)::date AND ap.status = 'closed')
          AND EXISTS (SELECT 1 FROM journal j WHERE date_trunc('month', j.journal_date) = date_trunc('month', m))`, [first])).rows[0]?.m;
    if (earlierOpen) throw invalid(`Close ${earlierOpen} first. Months are closed in order.`);
    const items = await checklistFor(c, first);
    const failing = items.filter((i) => !i.ok);
    if (failing.length) throw invalid(`The month cannot be closed yet: ${failing.map((i) => i.detail).join("; ")}.`);
    await c.query("UPDATE accounting_period SET status = 'closed', closed_by = $2, closed_at = now() WHERE period_month = $1", [first, ctx.userId]);
    await audit(c, ctx, "accounting_period", null, "closed", { month: first }, null);
  });
}

/** Only the owner reopens a closed month, with a reason that goes in the audit log (AC-09). */
export async function reopenPeriod(ctx: Ctx, month: string, reason: string) {
  if (!isOwner(ctx)) throw forbidden("Only the owner can reopen a closed month.");
  const first = monthStart(month);
  const why = str(reason);
  if (why.length < 5) throw invalid("Write why the month is being reopened.");
  return withTx(ctx, async (c) => {
    const p = (await c.query("SELECT status FROM accounting_period WHERE period_month = $1 FOR UPDATE", [first])).rows[0];
    if (p?.status !== "closed") throw invalid("This month is not closed.");
    const later = (await c.query("SELECT to_char(min(period_month), 'Mon YYYY') m FROM accounting_period WHERE period_month > $1 AND status = 'closed'", [first])).rows[0].m;
    if (later) throw invalid(`Reopen ${later} and any later closed months first.`);
    await c.query("UPDATE accounting_period SET status = 'open', reopened_by = $2, reopened_at = now(), reopen_reason = $3 WHERE period_month = $1", [first, ctx.userId, why]);
    await audit(c, ctx, "accounting_period", null, "reopened", { month: first, reason: why }, null);
  });
}

/** Moves the year's profit or loss of each branch into retained earnings (AC-09), dated 31 December. */
export async function yearEndClose(ctx: Ctx, year: number) {
  assertCan(ctx, "accounting", "approve");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid("Choose the year.");
  const dec = `${year}-12-01`, last = `${year}-12-31`;
  if (today() < last) throw invalid(`The ${year} year-end close can be run from 31 December ${year}.`);
  return withTx(ctx, async (c) => {
    await c.query("INSERT INTO accounting_period (period_month) VALUES ($1) ON CONFLICT DO NOTHING", [dec]);
    const p = (await c.query("SELECT * FROM accounting_period WHERE period_month = $1 FOR UPDATE", [dec])).rows[0];
    if (p.year_end_journal_id) throw conflict(`${year} has already been closed into retained earnings.`);
    await assertOpenPeriod(c, last);
    const re = (await c.query("SELECT a.id FROM account_mapping m JOIN account a ON a.id = m.account_id WHERE m.event_key = 'retained_earnings'")).rows[0];
    if (!re) throw invalid('No account mapped for "retained_earnings".');
    const rows = (await c.query(
      `SELECT l.branch_id, l.account_id, sum(l.credit - l.debit) net
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE a.account_type IN ('income','expense') AND j.journal_date BETWEEN $1 AND $2 AND j.source_type <> 'year_end'
        GROUP BY l.branch_id, l.account_id HAVING sum(l.credit - l.debit) <> 0`, [`${year}-01-01`, last])).rows;
    if (!rows.length) throw invalid(`Nothing was posted to income or expenses in ${year}.`);
    const lines: PostLine[] = [];
    const perBranch = new Map<string, Decimal>();
    for (const r of rows) {
      const n = D(r.net); // credit balance (income) is cleared with a debit
      lines.push({ accountId: r.account_id, branchId: r.branch_id, debit: n.gt(0) ? n.toFixed(2) : "0", credit: n.lt(0) ? n.neg().toFixed(2) : "0" });
      perBranch.set(r.branch_id, (perBranch.get(r.branch_id) ?? D(0)).plus(n));
    }
    let profit = D(0);
    for (const [b, n] of perBranch) {
      lines.push({ accountId: re.id, branchId: b, credit: n.gt(0) ? n.toFixed(2) : "0", debit: n.lt(0) ? n.neg().toFixed(2) : "0", narration: "Profit or loss for the year" });
      profit = profit.plus(n);
    }
    const hq = await hqBranch(c);
    const j = await postJournal(c, ctx, { branchId: hq.id, date: last, sourceType: "year_end", sourceId: hq.id, narration: `Year-end close ${year}: profit and loss to retained earnings`, lines });
    await c.query("UPDATE accounting_period SET year_end_journal_id = $2 WHERE period_month = $1", [dec, j!.id]);
    await audit(c, ctx, "accounting_period", null, "year_end_closed", { year, profit: profit.toFixed(2), journal: j!.docNo }, null);
    return { profit: profit.toFixed(2), journal: j!.docNo };
  });
}

// =====================================================================================
// Head-office cost allocation (AC-10)
// =====================================================================================

export async function hoPreview(ctx: Ctx, month: string) {
  assertCan(ctx, "accounting", "view");
  const first = monthStart(month), last = monthEnd(first);
  return withTx(ctx, async (c) => {
    const hq = await hqBranch(c);
    const basis = await getSetting<string>(c, "accounting.ho_basis", null, "revenue");
    const fixedPct = await getSetting<Record<string, number>>(c, "accounting.ho_fixed_pct", null, {});
    const done = (await c.query("SELECT h.*, j.doc_no journal_no FROM ho_allocation h LEFT JOIN journal j ON j.id = h.journal_id WHERE period_month = $1", [first])).rows[0];
    const cost = D((await c.query(
      `SELECT coalesce(sum(l.debit - l.credit), 0) v FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE l.branch_id = $1 AND a.account_type = 'expense' AND j.journal_date BETWEEN $2 AND $3 AND j.source_type NOT IN ('ho_allocation','year_end')`, [hq.id, first, last])).rows[0].v);
    const branches = (await c.query(
      `SELECT b.id, b.code, b.name_en, coalesce((SELECT sum(l.credit - l.debit) FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
                 WHERE l.branch_id = b.id AND a.account_type = 'income' AND j.journal_date BETWEEN $1 AND $2 AND j.source_type <> 'year_end'), 0) revenue
         FROM branch b WHERE b.branch_type = 'workshop' AND b.active ORDER BY b.code`, [first, last])).rows;
    let weights: Decimal[];
    if (basis === "fixed") weights = branches.map((b) => D(fixedPct[b.code] ?? 0));
    else weights = branches.map((b) => Decimal.max(D(b.revenue), 0));
    const total = weights.reduce((s, w) => s.plus(w), D(0));
    const shares = branches.map((b, k) => ({ branch_id: b.id, code: b.code, name: b.name_en, revenue: D(b.revenue).toFixed(2), pct: total.gt(0) ? weights[k].div(total).times(100).toDecimalPlaces(2).toFixed(2) : "0.00", amount: "0.00" }));
    if (total.gt(0) && cost.gt(0)) {
      let left = cost;
      const live = shares.map((s, k) => ({ s, w: weights[k] })).filter((x) => x.w.gt(0));
      live.forEach((x, k) => {
        const amt = k === live.length - 1 ? left : cost.times(x.w).div(total).toDecimalPlaces(2);
        x.s.amount = amt.toFixed(2); left = left.minus(amt);
      });
    }
    const problem = basis === "fixed" && total.gt(0) && !total.eq(100) ? `The fixed percentages add up to ${total.toFixed(2)}%, not 100%.` : total.eq(0) ? (basis === "fixed" ? "No fixed percentages are set." : "No branch had revenue in this month.") : cost.lte(0) ? "Head office has no costs in this month." : null;
    return { month: first, hq, basis, cost: cost.toFixed(2), shares: shares.filter((s) => basis !== "fixed" || D(s.pct).gt(0) || D(s.revenue).gt(0)), problem, done: done ?? null };
  });
}

export async function hoPost(ctx: Ctx, month: string) {
  assertCan(ctx, "accounting", "create");
  const pv = await hoPreview(ctx, month);
  if (pv.done) throw conflict(`The allocation for this month was already posted (${pv.done.journal_no}).`);
  if (pv.problem) throw invalid(pv.problem);
  return withTx(ctx, async (c) => {
    await assertOpenPeriod(c, postingDate(pv.month));
    const lines: PostLine[] = [];
    for (const s of pv.shares.filter((x) => D(x.amount).gt(0))) {
      lines.push({ event: "ho_allocation", branchId: s.branch_id, debit: s.amount, narration: `Head-office costs ${s.pct}%` });
      lines.push({ event: "interbranch", branchId: s.branch_id, credit: s.amount });
    }
    lines.push({ event: "interbranch", branchId: pv.hq.id, debit: pv.cost });
    lines.push({ event: "ho_allocation", branchId: pv.hq.id, credit: pv.cost, narration: "Costs charged to branches" });
    const ins = await c.query("INSERT INTO ho_allocation (period_month, basis, ho_cost, shares, posted_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [pv.month, pv.basis, pv.cost, JSON.stringify(pv.shares), ctx.userId]);
    const j = await postJournal(c, ctx, { branchId: pv.hq.id, date: postingDate(pv.month), sourceType: "ho_allocation", sourceId: ins.rows[0].id, narration: `Head-office cost allocation ${pv.month.slice(0, 7)} (${pv.basis})`, lines });
    await c.query("UPDATE ho_allocation SET journal_id = $2 WHERE id = $1", [ins.rows[0].id, j!.id]);
    await audit(c, ctx, "ho_allocation", ins.rows[0].id, "posted", { month: pv.month, cost: pv.cost, basis: pv.basis }, pv.hq.id);
    return j!.docNo;
  });
}

// =====================================================================================
// Fixed assets (AC-11): register, monthly straight-line depreciation, disposal
// =====================================================================================

export async function listAssets(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT f.*, b.code branch_code, f.cost - f.depreciated book_value, round((f.cost - f.salvage) / f.life_months, 2) monthly
       FROM fixed_asset f JOIN branch b ON b.id = f.branch_id ORDER BY f.status, f.asset_no`)).rows);
}
export async function depreciationRuns(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query("SELECT r.*, u.full_name run_by_name FROM depreciation_run r LEFT JOIN app_user u ON u.id = r.run_by ORDER BY period_month DESC LIMIT 24")).rows);
}

export async function addAsset(ctx: Ctx, f: { branch_id: string; name: string; category: string; acquired_on: string; cost: unknown; salvage?: unknown; life_months: unknown; paid_from: string }) {
  assertCan(ctx, "accounting", "create", f.branch_id);
  const name = str(f.name);
  if (name.length < 2) throw invalid("Enter the asset name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f.acquired_on)) || f.acquired_on > today()) throw invalid("Enter the date the asset was bought (not in the future).");
  const cost = parseDec(f.cost, "Cost", { min: 0.01 });
  const salvage = str(f.salvage) ? parseDec(f.salvage, "Value at the end", { min: 0 }) : D(0);
  if (salvage.gte(cost)) throw invalid("The value at the end of its life must be less than the cost.");
  const life = Number(str(f.life_months));
  if (!Number.isInteger(life) || life < 1 || life > 600) throw invalid("Enter the useful life in months (1 to 600).");
  return withTx(ctx, async (c) => {
    const cat = (await c.query("SELECT 1 FROM lookup_value WHERE list = 'asset_category' AND code = $1 AND active", [str(f.category)])).rowCount;
    if (!cat) throw invalid("Choose the asset category.");
    await assertOpenPeriod(c, f.acquired_on);
    let credit: PostLine;
    if (f.paid_from === "opening") credit = { accountId: (await c.query("SELECT id FROM account WHERE code = '3900'")).rows[0].id, credit: cost.toFixed(2), narration: "Asset brought in at opening" };
    else {
      const bank = (await c.query("SELECT account_id FROM bank_account WHERE id = $1 AND active", [f.paid_from])).rows[0];
      if (!bank) throw invalid("Choose the bank account it was paid from, or 'Already owned (opening)'.");
      credit = { accountId: bank.account_id, credit: cost.toFixed(2) };
    }
    const no = await nextDocNo(c, f.branch_id, "fixed_asset");
    const ins = await c.query(
      "INSERT INTO fixed_asset (branch_id, asset_no, name, category, acquired_on, cost, salvage, life_months, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [f.branch_id, no, name, f.category, f.acquired_on, cost.toFixed(2), salvage.toFixed(2), life, ctx.userId]);
    const j = await postJournal(c, ctx, { branchId: f.branch_id, date: f.acquired_on, sourceType: "fixed_asset", sourceId: ins.rows[0].id, narration: `Asset ${no} ${name}`,
      lines: [{ event: "fixed_assets", debit: cost.toFixed(2) }, credit] });
    await c.query("UPDATE fixed_asset SET journal_id = $2 WHERE id = $1", [ins.rows[0].id, j!.id]);
    await audit(c, ctx, "fixed_asset", ins.rows[0].id, "created", { asset_no: no, cost: cost.toFixed(2), life }, f.branch_id);
    return { id: ins.rows[0].id as string, no };
  });
}

/** Straight line from the month after purchase: (cost - end value) / life each month, never past the end value. One run per month. */
export async function runDepreciation(ctx: Ctx, month: string) {
  assertCan(ctx, "accounting", "create");
  const first = monthStart(month), last = postingDate(first);
  if (first > `${today().slice(0, 7)}-01`) throw invalid("Depreciation cannot be run for a future month.");
  return withTx(ctx, async (c) => {
    await assertOpenPeriod(c, last);
    if ((await c.query("SELECT 1 FROM depreciation_run WHERE period_month = $1", [first])).rowCount) throw conflict("Depreciation for this month has already been run.");
    const later = (await c.query("SELECT to_char(max(period_month), 'Mon YYYY') m FROM depreciation_run WHERE period_month > $1", [first])).rows[0].m;
    if (later) throw invalid(`Depreciation has already been run for ${later}; months are run in order.`);
    const assets = (await c.query(
      `SELECT * FROM fixed_asset WHERE status = 'active' AND acquired_on < $1::date AND depreciated < cost - salvage ORDER BY branch_id, asset_no FOR UPDATE`, [first])).rows;
    if (!assets.length) throw invalid("No asset needs depreciation for this month.");
    let total = D(0);
    const byBranch = new Map<string, { a: Row; amt: Decimal }[]>();
    for (const a of assets) {
      const monthly = D(a.cost).minus(a.salvage).div(a.life_months).toDecimalPlaces(2);
      const amt = Decimal.min(monthly, D(a.cost).minus(a.salvage).minus(a.depreciated));
      if (amt.lte(0)) continue;
      total = total.plus(amt);
      byBranch.set(a.branch_id, [...(byBranch.get(a.branch_id) ?? []), { a, amt }]);
    }
    await c.query("INSERT INTO depreciation_run (period_month, total, run_by) VALUES ($1,$2,$3)", [first, total.toFixed(2), ctx.userId]);
    for (const [b, list] of byBranch) {
      const sum = list.reduce((s, x) => s.plus(x.amt), D(0));
      const j = await postJournal(c, ctx, { branchId: b, date: last, sourceType: "depreciation", sourceId: list[0].a.id, narration: `Depreciation ${first.slice(0, 7)}`,
        lines: [{ event: "depreciation", debit: sum.toFixed(2) }, { event: "accumulated_depreciation", credit: sum.toFixed(2) }] });
      for (const { a, amt } of list) {
        await c.query("INSERT INTO depreciation_line (period_month, asset_id, branch_id, amount, journal_id) VALUES ($1,$2,$3,$4,$5)", [first, a.id, b, amt.toFixed(2), j!.id]);
        await c.query("UPDATE fixed_asset SET depreciated = depreciated + $2 WHERE id = $1", [a.id, amt.toFixed(2)]);
      }
    }
    await audit(c, ctx, "depreciation_run", null, "run", { month: first, total: total.toFixed(2), assets: assets.length }, null);
    return total.toFixed(2);
  });
}

export async function disposeAsset(ctx: Ctx, id: string, f: { date: string; amount: unknown; bank_account_id?: string }) {
  return withTx(ctx, async (c) => {
    const a = (await c.query("SELECT * FROM fixed_asset WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!a) throw notFound("Asset");
    assertCan(ctx, "accounting", "approve", a.branch_id);
    if (a.status !== "active") throw invalid("This asset has already been disposed of.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f.date)) || f.date > today() || f.date < ymd(a.acquired_on)) throw invalid("Enter the disposal date (after purchase, not in the future).");
    await assertOpenPeriod(c, f.date);
    const amount = str(f.amount) ? parseDec(f.amount, "Amount received", { min: 0 }) : D(0);
    const lines: PostLine[] = [{ event: "accumulated_depreciation", debit: D(a.depreciated).toFixed(2) }, { event: "fixed_assets", credit: D(a.cost).toFixed(2) }];
    if (amount.gt(0)) {
      const bank = (await c.query("SELECT account_id FROM bank_account WHERE id = $1 AND active", [f.bank_account_id ?? ""])).rows[0];
      if (!bank) throw invalid("Choose the bank account the money went into.");
      lines.push({ accountId: bank.account_id, debit: amount.toFixed(2) });
    }
    const book = D(a.cost).minus(a.depreciated);
    const gain = amount.minus(book);
    lines.push({ event: "asset_disposal", debit: gain.lt(0) ? gain.neg().toFixed(2) : "0", credit: gain.gt(0) ? gain.toFixed(2) : "0", narration: gain.gte(0) ? "Gain on disposal" : "Loss on disposal" });
    const j = await postJournal(c, ctx, { branchId: a.branch_id, date: f.date, sourceType: "asset_disposal", sourceId: a.id, narration: `Disposal of ${a.asset_no} ${a.name}`, lines });
    await c.query("UPDATE fixed_asset SET status = 'disposed', disposed_on = $2, disposal_amount = $3 WHERE id = $1", [id, f.date, amount.toFixed(2)]);
    await audit(c, ctx, "fixed_asset", id, "disposed", { amount: amount.toFixed(2), book: book.toFixed(2), journal: j?.docNo }, a.branch_id);
    return gain.toFixed(2);
  });
}

// =====================================================================================
// Budgets (AC-12)
// =====================================================================================

export async function budgetGrid(ctx: Ctx, branchId: string, year: number) {
  assertCan(ctx, "accounting", "view", branchId);
  return withTx(ctx, async (c) => {
    const accounts = (await c.query("SELECT id, code, name, account_type FROM account WHERE active AND account_type IN ('income','expense') ORDER BY code")).rows;
    const budgets = (await c.query("SELECT account_id, extract(month FROM period_month)::int m, amount FROM budget WHERE branch_id = $1 AND extract(year FROM period_month) = $2", [branchId, year])).rows;
    const actual = (await c.query(
      `SELECT l.account_id, extract(month FROM j.journal_date)::int m, sum(CASE WHEN a.account_type = 'income' THEN l.credit - l.debit ELSE l.debit - l.credit END) v
         FROM journal_line l JOIN journal j ON j.id = l.journal_id JOIN account a ON a.id = l.account_id
        WHERE l.branch_id = $1 AND extract(year FROM j.journal_date) = $2 AND a.account_type IN ('income','expense') AND j.source_type <> 'year_end'
        GROUP BY l.account_id, m`, [branchId, year])).rows;
    const key = (a: string, m: number) => `${a}:${m}`;
    const b = new Map(budgets.map((r) => [key(r.account_id, r.m), D(r.amount)]));
    const act = new Map(actual.map((r) => [key(r.account_id, r.m), D(r.v)]));
    const rows = accounts.map((a) => {
      const months = Array.from({ length: 12 }, (_, k) => ({ m: k + 1, budget: b.get(key(a.id, k + 1)) ?? null, actual: act.get(key(a.id, k + 1)) ?? D(0) }));
      const tb = months.reduce((s, x) => s.plus(x.budget ?? 0), D(0)), ta = months.reduce((s, x) => s.plus(x.actual), D(0));
      // A favourable variance is positive: income above budget, or spending below it.
      const variance = a.account_type === "income" ? ta.minus(tb) : tb.minus(ta);
      return { ...a, months: months.map((x) => ({ m: x.m, budget: x.budget?.toFixed(2) ?? "", actual: x.actual.toFixed(2) })), budget: tb.toFixed(2), actual: ta.toFixed(2), variance: variance.toFixed(2), pct: tb.gt(0) ? ta.div(tb).times(100).toFixed(0) : null };
    });
    return { rows, year, branchId };
  });
}

export async function saveBudget(ctx: Ctx, branchId: string, year: number, cells: Record<string, string>) {
  assertCan(ctx, "accounting", "edit", branchId);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid("Choose the year.");
  return withTx(ctx, async (c) => {
    const valid = new Set((await c.query("SELECT id FROM account WHERE active AND account_type IN ('income','expense')")).rows.map((r) => r.id));
    let n = 0;
    for (const [k, v] of Object.entries(cells)) {
      const [acc, m] = k.split(":");
      const mm = Number(m);
      if (!valid.has(acc) || !(mm >= 1 && mm <= 12)) throw invalid("A budget cell does not match an income or expense ledger.");
      const month = `${year}-${String(mm).padStart(2, "0")}-01`;
      if (!str(v)) { await c.query("DELETE FROM budget WHERE branch_id = $1 AND account_id = $2 AND period_month = $3", [branchId, acc, month]); continue; }
      const amt = parseDec(v, "Budget", { min: 0 });
      await c.query("INSERT INTO budget (branch_id, account_id, period_month, amount) VALUES ($1,$2,$3,$4) ON CONFLICT (branch_id, account_id, period_month) DO UPDATE SET amount = EXCLUDED.amount",
        [branchId, acc, month, amt.toFixed(2)]);
      n++;
    }
    await audit(c, ctx, "budget", null, "saved", { year, cells: n }, branchId);
    return n;
  });
}

// =====================================================================================
// Opening balances and the Tally cut-over check (TM-02, TM-03)
// =====================================================================================

function csvRows(text: string) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const split = (l: string) => { const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; } else cur += ch; }
    out.push(cur.trim()); return out; };
  if (!lines.length) return [];
  const head = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  return lines.slice(1).map((l, k) => { const v = split(l); const o: Record<string, string> = { _line: String(k + 2) }; head.forEach((h, i) => (o[h] = v[i] ?? "")); return o; });
}
const amt = (v: string) => { const s = str(v).replace(/,/g, ""); if (!s) return D(0); if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw invalid(`"${v}" is not an amount.`); return D(s); };
const isoDate = (v: string) => { const s = str(v); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); const d = m ? `${m[3]}-${m[2]}-${m[1]}` : s; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw invalid(`"${v}" is not a date (use DD/MM/YYYY).`); return d; };

type OpeningPlan = { cutover: string; errors: string[]; ledger: { branch_id: string; branch: string; account_id: string; code: string; name: string; sub_type: string; debit: Decimal; credit: Decimal }[];
  bills: { branch_id: string; branch: string; party_type: "customer" | "supplier"; party_id: string; party: string; bill_no: string; bill_date: string; due_date: string; amount: Decimal }[];
  tb: { code: string; name: string; ours_dr: string; ours_cr: string; tally_dr: string; tally_cr: string; diff: string }[]; tbMatches: boolean | null; branchTotals: { branch: string; debit: string; credit: string }[] };

/** Reads the three templates and reports every problem without writing anything (TM-02). */
async function planOpening(c: PoolClient, f: { cutover_date: string; ledger_csv: string; bills_csv: string; tally_csv?: string }): Promise<OpeningPlan> {
  const errors: string[] = [];
  let cutover = "";
  try { cutover = isoDate(f.cutover_date); } catch { errors.push("Enter the cut-over date."); }
  const branches = new Map((await c.query("SELECT id, code FROM branch")).rows.map((r) => [r.code.toUpperCase(), r.id]));
  const accounts = new Map((await c.query("SELECT id, code, name, sub_type, party_type FROM account WHERE active")).rows.map((r) => [r.code, r]));
  const ledger: OpeningPlan["ledger"] = [];
  for (const r of csvRows(f.ledger_csv)) {
    try {
      const b = branches.get(str(r.branch).toUpperCase()); if (!b) throw invalid(`branch "${r.branch}" is not known`);
      const a = accounts.get(str(r.accountcode ?? r.ledgercode ?? r.code)); if (!a) throw invalid(`ledger code "${r.accountcode ?? r.code}" is not in the chart of accounts`);
      const dr = amt(r.debit), cr = amt(r.credit);
      if (dr.lt(0) || cr.lt(0) || (dr.gt(0) && cr.gt(0))) throw invalid("put the balance in either Debit or Credit, not both");
      if (dr.eq(0) && cr.eq(0)) continue;
      ledger.push({ branch_id: b, branch: str(r.branch).toUpperCase(), account_id: a.id, code: a.code, name: a.name, sub_type: a.sub_type, debit: dr, credit: cr });
    } catch (e) { errors.push(`Ledger balances line ${r._line}: ${(e as Error).message}.`); }
  }
  if (!ledger.length) errors.push("The ledger balances file has no rows.");
  const bills: OpeningPlan["bills"] = [];
  const custs = new Map((await c.query("SELECT id, customer_no, coalesce(company_name, first_name || ' ' || coalesce(last_name, '')) name FROM customer")).rows.map((r) => [String(r.customer_no).toUpperCase(), r]));
  const sups = new Map((await c.query("SELECT id, code, name_en FROM supplier")).rows.map((r) => [String(r.code).toUpperCase(), r]));
  for (const r of csvRows(f.bills_csv)) {
    try {
      const b = branches.get(str(r.branch).toUpperCase()); if (!b) throw invalid(`branch "${r.branch}" is not known`);
      const pt = str(r.partytype).toLowerCase(); if (pt !== "customer" && pt !== "supplier") throw invalid('party type must be "customer" or "supplier"');
      const code = str(r.partycode).toUpperCase();
      const p = pt === "customer" ? custs.get(code) : sups.get(code); if (!p) throw invalid(`${pt} "${r.partycode}" is not in the masters`);
      const billNo = str(r.billno); if (!billNo) throw invalid("bill no. is missing");
      const bd = isoDate(r.billdate), dd = str(r.duedate) ? isoDate(r.duedate) : bd;
      if (cutover && bd > cutover) throw invalid("the bill date is after the cut-over date");
      const a = amt(r.amount); if (a.lte(0)) throw invalid("the amount must be more than zero");
      bills.push({ branch_id: b, branch: str(r.branch).toUpperCase(), party_type: pt, party_id: p.id, party: p.name ?? p.name_en, bill_no: billNo, bill_date: bd, due_date: dd, amount: a });
    } catch (e) { errors.push(`Open bills line ${r._line}: ${(e as Error).message}.`); }
  }
  // Receivable and payable ledgers must equal the open bills behind them, branch by branch.
  const control = (sub: string, pt: string) => {
    for (const b of new Set([...ledger.filter((l) => l.sub_type === sub).map((l) => l.branch), ...bills.filter((x) => x.party_type === pt).map((x) => x.branch)])) {
      const led = ledger.filter((l) => l.branch === b && l.sub_type === sub).reduce((s, l) => s.plus(sub === "receivable" ? l.debit.minus(l.credit) : l.credit.minus(l.debit)), D(0));
      const bil = bills.filter((x) => x.branch === b && x.party_type === pt).reduce((s, x) => s.plus(x.amount), D(0));
      if (!led.eq(bil)) errors.push(`${b}: the ${sub === "receivable" ? "trade receivables" : "trade payables"} balance (${led.toFixed(2)}) does not equal the open ${pt} bills (${bil.toFixed(2)}).`);
    }
  };
  control("receivable", "customer"); control("payable", "supplier");
  const branchTotals: OpeningPlan["branchTotals"] = [];
  for (const b of new Set(ledger.map((l) => l.branch))) {
    const dr = ledger.filter((l) => l.branch === b).reduce((s, l) => s.plus(l.debit), D(0)), cr = ledger.filter((l) => l.branch === b).reduce((s, l) => s.plus(l.credit), D(0));
    branchTotals.push({ branch: b, debit: dr.toFixed(2), credit: cr.toFixed(2) });
    if (!dr.eq(cr)) errors.push(`${b}: debits ${dr.toFixed(2)} and credits ${cr.toFixed(2)} do not balance. Put any difference on 2900 inter-branch clearing or 3900 opening balance equity.`);
  }
  // Side by side with Tally's trial balance (TM-03).
  const ours = new Map<string, { name: string; dr: Decimal; cr: Decimal }>();
  for (const l of ledger) { const o = ours.get(l.code) ?? { name: l.name, dr: D(0), cr: D(0) }; o.dr = o.dr.plus(l.debit); o.cr = o.cr.plus(l.credit); ours.set(l.code, o); }
  const tally = new Map<string, { dr: Decimal; cr: Decimal }>();
  let tbMatches: boolean | null = null;
  if (str(f.tally_csv)) {
    for (const r of csvRows(f.tally_csv!)) {
      try { const code = str(r.accountcode ?? r.ledgercode ?? r.code); if (!accounts.has(code)) throw invalid(`ledger code "${code}" is not in the chart of accounts`);
        const t = tally.get(code) ?? { dr: D(0), cr: D(0) }; t.dr = t.dr.plus(amt(r.debit)); t.cr = t.cr.plus(amt(r.credit)); tally.set(code, t);
      } catch (e) { errors.push(`Tally trial balance line ${r._line}: ${(e as Error).message}.`); }
    }
    tbMatches = true;
  }
  const tb = [...new Set([...ours.keys(), ...tally.keys()])].sort().map((code) => {
    const o = ours.get(code), t = tally.get(code);
    const net = (o?.dr ?? D(0)).minus(o?.cr ?? 0), tnet = (t?.dr ?? D(0)).minus(t?.cr ?? 0);
    const diff = t ? net.minus(tnet) : D(0);
    if (tbMatches !== null && !diff.eq(0)) tbMatches = false;
    return { code, name: o?.name ?? accounts.get(code)?.name ?? "", ours_dr: (o?.dr ?? D(0)).toFixed(2), ours_cr: (o?.cr ?? D(0)).toFixed(2), tally_dr: t ? t.dr.toFixed(2) : "", tally_cr: t ? t.cr.toFixed(2) : "", diff: diff.toFixed(2) };
  });
  return { cutover, errors, ledger, bills, tb, tbMatches, branchTotals };
}

const planView = (p: OpeningPlan) => ({ cutover: p.cutover, errors: p.errors, ledgerRows: p.ledger.length, billRows: p.bills.length, tb: p.tb, tbMatches: p.tbMatches, branchTotals: p.branchTotals,
  bills: p.bills.slice(0, 50).map((b) => ({ ...b, amount: b.amount.toFixed(2) })) });

export async function checkOpening(ctx: Ctx, f: { cutover_date: string; ledger_csv: string; bills_csv: string; tally_csv?: string }) {
  assertCan(ctx, "accounting", "create");
  return withTx(ctx, async (c) => planView(await planOpening(c, f)));
}

export async function openingBatches(ctx: Ctx) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => (await c.query(
    `SELECT m.*, lu.full_name loaded_by_name, su.full_name signed_by_name FROM migration_batch m LEFT JOIN app_user lu ON lu.id = m.loaded_by LEFT JOIN app_user su ON su.id = m.signed_by ORDER BY loaded_at DESC`)).rows);
}

/** Posts the opening balances: one journal per branch dated the cut-over day; customer and supplier bills become open items. */
export async function loadOpening(ctx: Ctx, f: { cutover_date: string; ledger_csv: string; bills_csv: string; tally_csv?: string }) {
  assertCan(ctx, "accounting", "create");
  return withTx(ctx, async (c) => {
    await c.query("LOCK TABLE migration_batch IN EXCLUSIVE MODE");
    if ((await c.query("SELECT 1 FROM migration_batch")).rowCount) throw conflict("Opening balances have already been loaded. Correct them with a journal voucher.");
    const p = await planOpening(c, f);
    if (p.errors.length) throw invalid(`The files have ${p.errors.length} problem(s). Check them first: ${p.errors.slice(0, 3).join(" ")}`);
    if (!str(f.tally_csv)) throw invalid("Attach Tally's trial balance at the cut-over date so the two can be compared.");
    await assertOpenPeriod(c, p.cutover);
    const tally = Object.fromEntries(p.tb.map((t) => [t.code, { debit: t.tally_dr, credit: t.tally_cr }]));
    const batch = (await c.query("INSERT INTO migration_batch (cutover_date, ledger_rows, bill_rows, tally_tb, loaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [p.cutover, p.ledger.length, p.bills.length, JSON.stringify(tally), ctx.userId])).rows[0].id;
    for (const b of new Set(p.ledger.map((l) => l.branch_id))) {
      const lines: PostLine[] = [];
      for (const l of p.ledger.filter((x) => x.branch_id === b)) {
        if (l.sub_type === "receivable" || l.sub_type === "payable") continue; // posted per party below
        lines.push({ accountId: l.account_id, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) });
      }
      for (const x of p.bills.filter((y) => y.branch_id === b)) {
        const acc = p.ledger.find((l) => l.branch_id === b && l.sub_type === (x.party_type === "customer" ? "receivable" : "payable"))!.account_id;
        lines.push(x.party_type === "customer" ? { accountId: acc, debit: x.amount.toFixed(2), customerId: x.party_id, narration: `Opening bill ${x.bill_no}` }
          : { accountId: acc, credit: x.amount.toFixed(2), supplierId: x.party_id, narration: `Opening bill ${x.bill_no}` });
        await c.query("INSERT INTO opening_item (branch_id, party_type, customer_id, supplier_id, bill_no, bill_date, due_date, amount, batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [b, x.party_type, x.party_type === "customer" ? x.party_id : null, x.party_type === "supplier" ? x.party_id : null, x.bill_no, x.bill_date, x.due_date, x.amount.toFixed(2), batch]);
      }
      await postJournal(c, ctx, { branchId: b, date: p.cutover, sourceType: "opening", sourceId: batch, narration: `Opening balances at ${p.cutover} (from Tally)`, lines });
    }
    await audit(c, ctx, "migration_batch", batch, "loaded", { cutover: p.cutover, ledger: p.ledger.length, bills: p.bills.length, matches_tally: p.tbMatches }, null);
    return batch as string;
  });
}

/** The opening trial balance from the books, against the Tally figures stored with the batch. */
export async function openingComparison(ctx: Ctx, batchId: string) {
  assertCan(ctx, "accounting", "view");
  return withTx(ctx, async (c) => {
    const m = (await c.query("SELECT * FROM migration_batch WHERE id = $1", [batchId])).rows[0];
    if (!m) throw notFound("Opening balance batch");
    const ours = (await c.query(
      `SELECT a.code, a.name, sum(l.debit) dr, sum(l.credit) cr FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id
        WHERE j.source_type = 'opening' AND j.source_id = $1 GROUP BY a.code, a.name`, [batchId])).rows;
    const tally = (m.tally_tb ?? {}) as Record<string, { debit: string; credit: string }>;
    const codes = [...new Set([...ours.map((o) => o.code), ...Object.keys(tally)])].sort();
    const names = new Map((await c.query("SELECT code, name FROM account")).rows.map((r) => [r.code, r.name]));
    let matches = true;
    const rows = codes.map((code) => {
      const o = ours.find((x) => x.code === code), t = tally[code];
      const net = D(o?.dr ?? 0).minus(o?.cr ?? 0), tnet = D(t?.debit || 0).minus(t?.credit || 0);
      const diff = net.minus(tnet);
      if (!diff.eq(0)) matches = false;
      return { code, name: names.get(code) ?? "", ours_dr: D(o?.dr ?? 0).toFixed(2), ours_cr: D(o?.cr ?? 0).toFixed(2), tally_dr: t?.debit ?? "", tally_cr: t?.credit ?? "", diff: diff.toFixed(2) };
    });
    return { batch: m, rows, matches };
  });
}

export async function signOffOpening(ctx: Ctx, batchId: string, note: string) {
  assertCan(ctx, "accounting", "approve");
  const cmp = await openingComparison(ctx, batchId);
  if (cmp.batch.status === "signed_off") throw conflict("Already signed off.");
  if (!cmp.matches && str(note).length < 10) throw invalid("The trial balance differs from Tally. Explain the difference in the note (at least 10 characters) to sign off.");
  return withTx(ctx, async (c) => {
    const r = await c.query("UPDATE migration_batch SET status = 'signed_off', signed_by = $2, signed_at = now(), sign_note = $3 WHERE id = $1 AND status = 'loaded'", [batchId, ctx.userId, str(note) || null]);
    if (!r.rowCount) throw conflict("Already signed off.");
    await audit(c, ctx, "migration_batch", batchId, "signed_off", { matches_tally: cmp.matches, note: str(note) || null }, null);
  });
}

export { can };
