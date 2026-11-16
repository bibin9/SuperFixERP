import type { PoolClient } from "pg";
import { invalid } from "../errors";

/**
 * Next document number for a branch and document type (FSD 3.4). The series row is locked and
 * advanced inside the caller's transaction, so a rolled-back document gives its number back and
 * posted tax invoices have no gaps.
 */
export async function nextDocNo(c: PoolClient, branchId: string, docType: string, at = new Date()): Promise<string> {
  const r = await c.query(
    `UPDATE doc_series SET next_number = next_number + 1, updated_at = now()
      WHERE branch_id = $1 AND doc_type = $2
      RETURNING prefix, next_number - 1 AS n, padding, year_part`,
    [branchId, docType],
  );
  if (!r.rowCount) throw invalid(`No document series set up for ${docType} at this branch. Ask the admin to add it under Document numbering.`);
  const { prefix, n, padding, year_part } = r.rows[0];
  const yy = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year: "2-digit" }).format(at);
  return `${prefix}${year_part ? yy + "-" : ""}${String(n).padStart(padding, "0")}`;
}
