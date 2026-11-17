import type { PoolClient } from "pg";
import type { Ctx } from "../access";
import { assertCan, canSee } from "../access";
import { withTx } from "../db";
import { invalid } from "../errors";
import { D, Decimal } from "../money";
import { nextDocNo } from "./numbering";

/** Posting engine (M12). Turns business events into balanced journals in the caller's transaction. */

/** One ledger line: by business event (mapped account) or a chosen account; optionally on another branch (inter-branch journals). */
export type PostLine = { event?: string; accountId?: string; debit?: Decimal | string; credit?: Decimal | string; customerId?: string | null; supplierId?: string | null; narration?: string | null; branchId?: string };

async function accountFor(c: PoolClient, event: string) {
  const r = await c.query("SELECT a.id FROM account_mapping m JOIN account a ON a.id = m.account_id WHERE m.event_key = $1 AND a.active", [event]);
  // FSD M12 rule 1: a failure to post blocks the document with a clear message.
  if (!r.rowCount) throw invalid(`No account mapped for "${event}". Ask the accountant to set it under Posting mapping.`);
  return r.rows[0].id as string;
}

export async function postJournal(c: PoolClient, ctx: Ctx | null, j: { branchId: string; date: string; sourceType: string; sourceId: string; narration: string; lines: PostLine[] }) {
  const lines = j.lines
    .map((l) => ({ ...l, debit: D(l.debit ?? 0).toDecimalPlaces(2), credit: D(l.credit ?? 0).toDecimalPlaces(2) }))
    .filter((l) => l.debit.gt(0) || l.credit.gt(0));
  if (!lines.length) return null;
  const dr = lines.reduce((s, l) => s.plus(l.debit), D(0));
  const cr = lines.reduce((s, l) => s.plus(l.credit), D(0));
  if (!dr.eq(cr)) throw invalid(`Journal does not balance (debit ${dr.toFixed(2)}, credit ${cr.toFixed(2)}).`);
  const docNo = await nextDocNo(c, j.branchId, "journal");
  const r = await c.query(
    "INSERT INTO journal (branch_id, doc_no, journal_date, source_type, source_id, narration, posted_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [j.branchId, docNo, j.date, j.sourceType, j.sourceId, j.narration, ctx?.userId ?? null],
  );
  const jid = r.rows[0].id;
  for (const l of lines) {
    const acc = l.accountId ?? (l.event ? await accountFor(c, l.event) : null);
    if (!acc) throw invalid("A journal line has no account.");
    await c.query("INSERT INTO journal_line (journal_id, branch_id, account_id, debit, credit, customer_id, supplier_id, narration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [jid, l.branchId ?? j.branchId, acc, l.debit.toFixed(2), l.credit.toFixed(2), l.customerId ?? null, l.supplierId ?? null, l.narration ?? null]);
  }
  return { id: jid as string, docNo };
}

/** Trial balance by branch (AC-08). Bank and cash balances follow the bank-balance field permission. */
export async function trialBalance(ctx: Ctx, branchId: string | "all") {
  assertCan(ctx, "accounting", "view", branchId === "all" ? undefined : branchId);
  return withTx(ctx, async (c) => {
    const r = await c.query(
      `SELECT a.code, a.name, a.account_type, a.sub_type, sum(l.debit) debit, sum(l.credit) credit
         FROM journal_line l JOIN account a ON a.id = l.account_id
        WHERE ($1 = 'all' OR l.branch_id::text = $1)
        GROUP BY a.code, a.name, a.account_type, a.sub_type ORDER BY a.code`, [branchId]);
    const hideBank = !canSee(ctx, "bank_balance", branchId === "all" ? undefined : branchId);
    const rows = r.rows.filter((x) => !(hideBank && ["cash", "bank"].includes(x.sub_type)));
    const totals = rows.reduce((s, x) => ({ debit: s.debit.plus(x.debit), credit: s.credit.plus(x.credit) }), { debit: D(0), credit: D(0) });
    return { rows, totals: { debit: totals.debit.toFixed(2), credit: totals.credit.toFixed(2) }, bankHidden: hideBank };
  });
}

export async function journalsFor(c: PoolClient, sourceId: string) {
  return (await c.query(
    `SELECT j.doc_no, j.narration, a.code, a.name, l.debit, l.credit FROM journal j JOIN journal_line l ON l.journal_id = j.id JOIN account a ON a.id = l.account_id
      WHERE j.source_id = $1 ORDER BY j.posted_at, l.id`, [sourceId])).rows;
}
