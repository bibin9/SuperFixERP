import type { PoolClient } from "pg";
import { Ctx, can } from "../access";
import { withTx } from "../db";
import { forbidden, invalid } from "../errors";
import { audit } from "./audit";
import { getSetting } from "./settings";

/**
 * Archive (AR-01 to AR-06). Closed, paid and posted transactions older than the live window are marked as
 * archived in one run. They stay in the same database, read only (a trigger refuses any change), and are
 * reported through the Live / Archived / archive-run selector. Masters are never archived. Ledger balances
 * are not touched: the financial statements always read every journal, so balances carry forward and live
 * reports stay correct; each run checks the archived journals balance and records the totals.
 */

export const ARCHIVE_TABLES: { tbl: string; label: string; sql: string }[] = [
  { tbl: "job_card", label: "Job cards", sql: "SELECT id FROM job_card WHERE status IN ('closed','cancelled') AND doc_date < $1" },
  { tbl: "quotation", label: "Quotations", sql: `SELECT q.id FROM quotation q LEFT JOIN job_card j ON j.id = q.job_card_id WHERE q.doc_date < $1
      AND q.status IN ('approved','partly_approved','declined','expired','superseded') AND (j.id IS NULL OR j.status IN ('closed','cancelled'))` },
  { tbl: "sales_invoice", label: "Invoices", sql: "SELECT id FROM sales_invoice WHERE doc_date < $1 AND grand_total - paid_amount - credited_amount <= 0.005" },
  { tbl: "receipt", label: "Receipts", sql: "SELECT id FROM receipt WHERE doc_date < $1 AND (cheque_status IS NULL OR cheque_status IN ('cleared','bounced'))" },
  { tbl: "purchase_order", label: "Purchase orders", sql: "SELECT id FROM purchase_order WHERE created_at::date < $1 AND status IN ('received','cancelled','rejected')" },
  { tbl: "supplier_bill", label: "Supplier bills", sql: "SELECT id FROM supplier_bill WHERE invoice_date < $1 AND (status = 'rejected' OR (status = 'posted' AND paid_amount >= grand_total))" },
  { tbl: "stock_move", label: "Stock movements", sql: "SELECT id FROM stock_move WHERE at::date < $1" },
  { tbl: "transfer", label: "Transfers", sql: "SELECT id FROM transfer WHERE created_at::date < $1 AND status IN ('received','cancelled','rejected')" },
  { tbl: "payroll_run", label: "Payroll runs", sql: "SELECT id FROM payroll_run WHERE period_month < $1 AND status = 'paid'" },
  { tbl: "journal", label: "Journals", sql: "SELECT id FROM journal WHERE journal_date < $1" },
];

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const monthsBack = (d: string, n: number) => { const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() - n); return x.toISOString().slice(0, 10); };
const monthsAhead = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

/** Only someone with settings edit for every branch (owner, admin) runs the archive: it spans the company. */
export const canRunArchive = (ctx: Ctx) => ctx.allBranches && ctx.branchIds.every((b) => can(ctx, "settings", "edit", b));
export const canSeeArchive = (ctx: Ctx) => ctx.branchIds.some((b) => can(ctx, "reports", "view", b));

async function eligible(c: PoolClient, cutoff: string) {
  const out: Record<string, number> = {};
  for (const t of ARCHIVE_TABLES) {
    out[t.tbl] = Number((await c.query(`SELECT count(*) n FROM (${t.sql}) x WHERE NOT EXISTS (SELECT 1 FROM archive_member am WHERE am.tbl = '${t.tbl}' AND am.row_id = x.id::text)`, [cutoff])).rows[0].n);
  }
  return out;
}

export async function archiveStatus(ctx: Ctx) {
  if (!canSeeArchive(ctx)) throw forbidden();
  return withTx(ctx, async (c) => {
    const live = Number(await getSetting(c, "archive.live_months", null, 12));
    const every = Number(await getSetting(c, "archive.every_months", null, 6));
    const keep = Number(await getSetting(c, "archive.keep_years", null, 7));
    const t = today();
    const cutoff = monthsBack(t, live);
    const runs = (await c.query(`SELECT r.id, r.run_no, to_char(r.cutoff, 'YYYY-MM-DD') cutoff, r.live_months, r.run_at, r.counts, r.ledger_check, r.note, to_char(r.keep_until, 'YYYY-MM-DD') keep_until, u.full_name run_by
      FROM archive_run r JOIN app_user u ON u.id = r.run_by ORDER BY r.run_no DESC`)).rows;
    const last = runs[0];
    const nextDue = last ? monthsAhead(new Date(last.run_at).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }), every) : t;
    const pending = canRunArchive(ctx) ? await eligible(c, cutoff) : null;
    const archivedTotals = Object.fromEntries((await c.query("SELECT tbl, count(*)::int n FROM archive_member GROUP BY tbl")).rows.map((r) => [r.tbl, r.n]));
    return { live, every, keep, cutoff, runs, nextDue, due: nextDue <= t, pending, archivedTotals, canRun: canRunArchive(ctx) };
  });
}

/** Runs the archive now. Everything eligible before the cut-off moves in one transaction, or nothing does. */
export async function runArchive(ctx: Ctx, note: string) {
  if (!canRunArchive(ctx)) throw forbidden("Only the owner or an administrator with access to every branch can run the archive.");
  return withTx(ctx, async (c) => {
    await c.query("LOCK TABLE archive_run IN EXCLUSIVE MODE");
    const live = Number(await getSetting(c, "archive.live_months", null, 12));
    const keep = Number(await getSetting(c, "archive.keep_years", null, 7));
    if (!(live >= 1)) throw invalid("Set the live window (archive.live_months) to at least 1 month first.");
    const t = today(), cutoff = monthsBack(t, live);
    const counts = await eligible(c, cutoff);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    if (!total) throw invalid(`Nothing to archive: no closed, paid or posted records before ${cutoff.split("-").reverse().join("/")}.`);
    // AR-03: the journals to archive must balance; their totals are recorded with the run.
    const jsql = ARCHIVE_TABLES.find((x) => x.tbl === "journal")!.sql;
    const lc = (await c.query(`SELECT coalesce(sum(l.debit), 0) debit, coalesce(sum(l.credit), 0) credit, count(DISTINCT l.account_id)::int accounts
      FROM journal_line l WHERE l.journal_id IN (SELECT x.id FROM (${jsql}) x WHERE NOT EXISTS (SELECT 1 FROM archive_member am WHERE am.tbl = 'journal' AND am.row_id = x.id::text))`, [cutoff])).rows[0];
    const check = { debit: lc.debit, credit: lc.credit, accounts: lc.accounts, balanced: Number(lc.debit).toFixed(2) === Number(lc.credit).toFixed(2) };
    if (!check.balanced) throw invalid("The journals to archive do not balance, so nothing was archived. Check the ledger first.");
    const run = (await c.query("INSERT INTO archive_run (cutoff, live_months, run_by, counts, ledger_check, note, keep_until) VALUES ($1,$2,$3,$4,$5,$6, $7::date) RETURNING id, run_no",
      [cutoff, live, ctx.userId, counts, check, String(note ?? "").trim().slice(0, 300) || null, monthsAhead(t, keep * 12)])).rows[0];
    for (const tb of ARCHIVE_TABLES) {
      await c.query(`INSERT INTO archive_member (tbl, row_id, run_id) SELECT '${tb.tbl}', x.id::text, $2 FROM (${tb.sql}) x
        WHERE NOT EXISTS (SELECT 1 FROM archive_member am WHERE am.tbl = '${tb.tbl}' AND am.row_id = x.id::text)`, [cutoff, run.id]);
    }
    await audit(c, ctx, "archive_run", run.id, "run", { cutoff, counts, ledger: check });
    return { id: run.id, run_no: run.run_no, cutoff, counts, check, total };
  });
}
