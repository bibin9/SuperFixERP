import { Ctx, canAnywhere } from "../access";
import { withTx } from "../db";

export async function shellData(ctx: Ctx) {
  return withTx(ctx, async (c) => {
    const branches = (await c.query("SELECT id, code, name_en FROM branch WHERE id = ANY($1) ORDER BY code", [ctx.branchIds])).rows;
    const pending = canAnywhere(ctx, "approvals", "view")
      ? Number((await c.query(
        `SELECT count(*) n FROM approval_task t JOIN approval_request r ON r.id = t.request_id
          WHERE t.status = 'pending' AND r.status = 'pending' AND t.seq = r.current_seq AND r.requested_by <> $1
            AND (t.approver_user_id = $1 OR t.backup_user_id = $1 OR EXISTS (SELECT 1 FROM user_branch_role ubr WHERE ubr.user_id = $1 AND ubr.role_id = t.approver_role_id AND (ubr.branch_id = t.approver_branch_id OR ubr.branch_id IS NULL)))`,
        [ctx.userId])).rows[0].n)
      : 0;
    return { branches, pending };
  });
}

/** Home dashboard figures for the current branch (or all branches for owner/HQ). */
export async function dashboard(ctx: Ctx, scope: "current" | "all") {
  return withTx(ctx, async (c) => {
    const b = scope === "all" ? null : ctx.currentBranchId;
    const byStatus = (await c.query(
      `SELECT status, count(*) n FROM job_card WHERE ($1::uuid IS NULL OR branch_id = $1) AND status NOT IN ('closed','cancelled') GROUP BY status`, [b])).rows;
    const late = (await c.query(
      `SELECT j.id, j.doc_no, j.status, j.promised_at, br.code FROM job_card j JOIN branch br ON br.id = j.branch_id
        WHERE ($1::uuid IS NULL OR j.branch_id = $1) AND j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled') ORDER BY j.promised_at LIMIT 10`, [b])).rows;
    const enq = (await c.query(
      `SELECT count(*) FILTER (WHERE status = 'open') open, count(*) FILTER (WHERE status = 'open' AND follow_up_at < now()) overdue FROM enquiry WHERE ($1::uuid IS NULL OR branch_id = $1)`, [b])).rows[0];
    const sales = (await c.query(
      `SELECT coalesce(sum(taxable_total),0) net, coalesce(sum(grand_total - paid_amount),0) open FROM sales_invoice WHERE ($1::uuid IS NULL OR branch_id = $1) AND doc_date = (now() AT TIME ZONE 'Asia/Dubai')::date`, [b])).rows[0];
    return { byStatus, late, enq, sales };
  });
}
