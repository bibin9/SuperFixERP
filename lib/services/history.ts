import { canSee, type Ctx } from "../access";
import { withTx } from "../db";
import { recordHistory } from "./audit";

/**
 * Transaction history for the document pages: every user who created, changed, approved, posted or
 * cancelled it, with their role and the time (FSD 3.6). The document must be visible to the caller
 * (row security), otherwise nothing is returned.
 */
const DOCS: Record<string, { table: string; audit: string[]; approval?: string; children?: { entity: string; sql: string }[] }> = {
  job_card: { table: "job_card", audit: ["job_card"], children: [{ entity: "job_line", sql: "SELECT id::text FROM job_line WHERE job_card_id = $1" }] },
  enquiry: { table: "enquiry", audit: ["enquiry"], children: [{ entity: "quotation", sql: "SELECT id::text FROM quotation WHERE enquiry_id = $1" }] },
  sales_invoice: { table: "sales_invoice", audit: ["sales_invoice"], children: [{ entity: "receipt", sql: "SELECT receipt_id::text FROM receipt_allocation WHERE invoice_id = $1" }] },
  voucher: { table: "voucher", audit: ["voucher"], approval: "voucher" },
  purchase_order: { table: "purchase_order", audit: ["purchase_order"], approval: "purchase_order", children: [{ entity: "grn", sql: "SELECT id::text FROM grn WHERE po_id = $1" }] },
  supplier_bill: { table: "supplier_bill", audit: ["supplier_bill"], approval: "supplier_bill" },
  transfer: { table: "transfer", audit: ["transfer"], approval: "stock_transfer" },
  credit_note: { table: "credit_note", audit: ["credit_note"], approval: "credit_note" },
  supplier_claim: { table: "supplier_claim", audit: ["supplier_claim"] },
  rfq: { table: "rfq", audit: ["rfq"] },
  sales_order: { table: "sales_order", audit: ["sales_order"], children: [{ entity: "sales_invoice", sql: "SELECT id::text FROM sales_invoice WHERE sales_order_id = $1" }] },
};
const STAMPS: [string, string, string][] = [["created_by", "created_at", "created"], ["posted_by", "posted_at", "posted"], ["approved_by", "approved_at", "approved"], ["cancelled_by", "cancelled_at", "cancelled"], ["requested_by", "created_at", "requested"]];

export async function docHistory(ctx: Ctx, kind: keyof typeof DOCS, id: string) {
  const d = DOCS[kind];
  return withTx(ctx, async (c) => {
    const row = (await c.query(`SELECT to_jsonb(t) j FROM ${d.table} t WHERE id = $1`, [id])).rows[0]?.j;
    if (!row) return [];
    const refs: [string, string][] = d.audit.map((e) => [e, id]);
    for (const ch of d.children ?? []) {
      try { for (const r of (await c.query(ch.sql, [id])).rows) refs.push([ch.entity, Object.values(r)[0] as string]); } catch { /* optional link */ }
    }
    const approvals: [string, string][] = [];
    if (d.approval) approvals.push([d.approval, id]);
    if (kind === "job_card" || kind === "enquiry") approvals.push(["discount", id]);
    const stamps = STAMPS.filter(([u, a]) => row[u] && row[a]).map(([u, a, action]) => ({ action, user_id: row[u], at: row[a] }));
    const rows = await recordHistory(c, { refs, approvals, stamps });
    // Field permissions apply to the history too (FP-02, FP-03): money values are removed for roles that cannot see prices or costs.
    const b = row.branch_id ?? null;
    if (canSee(ctx, "selling_price", b) && canSee(ctx, "purchase_cost", b)) return rows;
    const MONEY = /price|amount|total|cost|discount|taxable|vat|margin|salary|rate|paid|balance|value/i;
    const strip = (d: unknown): unknown => {
      if (!d || typeof d !== "object") return d;
      const o = Object.fromEntries(Object.entries(d as Record<string, unknown>).filter(([k]) => !MONEY.test(k)));
      return Object.keys(o).length ? o : null;
    };
    return rows.map((r) => ({ ...r, detail: strip(r.detail) }));
  });
}
