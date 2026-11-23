import type { PoolClient } from "pg";
import { Ctx, assertCan, canSee } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound, conflict } from "../errors";
import { audit } from "./audit";

/** M10 approval engine. One engine for every document type in WF-01. */

export type SubmitInput = {
  docType: string;
  docId: string;
  docRef: string;
  branchId: string;
  approverBranchId?: string; // e.g. the supplying branch for transfers
  amount?: string | null;
  discountPct?: string | null;
  summary?: Record<string, unknown>;
  /** The employee an HR request is about; line-manager steps go to that employee's manager (HR-14). */
  subjectEmployeeId?: string | null;
  /** WF-03 rule facts: the document's supplier, customer and the item categories on its lines. */
  supplierId?: string | null;
  customerId?: string | null;
  itemCategories?: string[] | null;
};

/** The distinct item categories of these items, for WF-03 category rules. */
export async function categoriesOf(c: PoolClient, itemIds: (string | null | undefined)[]) {
  const ids = itemIds.filter(Boolean);
  if (!ids.length) return [];
  return (await c.query("SELECT DISTINCT category FROM item WHERE id = ANY($1::uuid[]) AND category IS NOT NULL", [ids])).rows.map((r) => r.category as string);
}

export type Handler = {
  onApproved: (c: PoolClient, ctx: Ctx, req: ApprovalRequestRow) => Promise<void>;
  onRejected: (c: PoolClient, ctx: Ctx, req: ApprovalRequestRow, comment: string) => Promise<void>;
  onSentBack?: (c: PoolClient, ctx: Ctx, req: ApprovalRequestRow, comment: string) => Promise<void>;
};
export type ApprovalRequestRow = { id: string; doc_type: string; doc_id: string; doc_ref: string; branch_id: string; requested_by: string; amount: string | null };

const handlers = new Map<string, Handler>();
export const registerHandler = (docType: string, h: Handler) => handlers.set(docType, h);

type StepRow = { id: string; seq: number; name: string; approver_role_id: string | null; approver_user_id: string | null; approver_role_scope: string; backup_user_id: string | null };

/**
 * Steps that apply to a document. Conditions are combined with AND (WF-03). Amount bands are
 * inclusive; the discount condition means "discount % above the value".
 */
async function matchingSteps(c: PoolClient, input: SubmitInput, afterSeq = -1): Promise<StepRow[]> {
  const r = await c.query(
    `SELECT s.* FROM workflow w JOIN workflow_step s ON s.workflow_id = w.id
      WHERE w.doc_type = $1 AND w.enabled AND s.enabled AND s.seq > $2
        AND (s.cond_branch_id IS NULL OR s.cond_branch_id = $3)
        AND (s.cond_min_amount IS NULL OR ($4::numeric IS NOT NULL AND $4::numeric >= s.cond_min_amount))
        AND (s.cond_max_amount IS NULL OR ($4::numeric IS NOT NULL AND $4::numeric <= s.cond_max_amount))
        AND (s.cond_min_discount_pct IS NULL OR ($5::numeric IS NOT NULL AND $5::numeric > s.cond_min_discount_pct))
        AND (s.cond_supplier_id IS NULL OR s.cond_supplier_id = $6::uuid)
        AND (s.cond_customer_id IS NULL OR s.cond_customer_id = $7::uuid)
        AND (s.cond_item_category IS NULL OR s.cond_item_category = ANY($8::text[]))
      ORDER BY s.seq`,
    [input.docType, afterSeq, input.branchId, input.amount ?? null, input.discountPct ?? null, input.supplierId ?? null, input.customerId ?? null, input.itemCategories ?? []],
  );
  return r.rows;
}

async function createTask(c: PoolClient, reqId: string, input: SubmitInput, step: StepRow, requestedBy: string) {
  const approverBranch = step.approver_role_scope === "supplying_branch" ? input.approverBranchId ?? input.branchId : input.branchId;
  let userId = step.approver_user_id;
  if (step.approver_role_scope === "line_manager") {
    const lm = input.subjectEmployeeId
      ? (await c.query("SELECT employee_line_manager_of($1) u", [input.subjectEmployeeId])).rows[0]?.u
      : (await c.query("SELECT employee_line_manager_user($1) u", [requestedBy])).rows[0]?.u;
    if (lm) userId = lm;
  }
  // Rule 4: a user never approves their own document; if they are the only approver it goes to the backup.
  if (userId === requestedBy) userId = step.backup_user_id;
  if (!userId && step.approver_role_id) {
    const holders = await c.query(
      `SELECT DISTINCT u.id FROM user_branch_role ubr JOIN app_user u ON u.id = ubr.user_id
        WHERE ubr.role_id = $1 AND (ubr.branch_id = $2 OR ubr.branch_id IS NULL) AND u.status = 'active' AND u.id <> $3`,
      [step.approver_role_id, approverBranch, requestedBy],
    );
    if (!holders.rowCount && step.backup_user_id && step.backup_user_id !== requestedBy) userId = step.backup_user_id;
  }
  await c.query(
    `INSERT INTO approval_task (request_id, branch_id, step_id, seq, step_name, approver_role_id, approver_branch_id, approver_user_id, backup_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [reqId, input.branchId, step.id, step.seq, step.name, userId ? null : step.approver_role_id, approverBranch, userId, step.backup_user_id],
  );
}

/**
 * Submits a document. If the workflow is off or no step matches, the document is approved at once
 * and that is logged (rule 1). Must run inside the caller's transaction.
 */
export async function submitForApproval(c: PoolClient, ctx: Ctx, input: SubmitInput): Promise<{ status: "approved" | "pending"; requestId: string }> {
  const steps = await matchingSteps(c, input);
  const status = steps.length ? "pending" : "approved";
  const r = await c.query(
    `INSERT INTO approval_request (branch_id, approver_branch_id, doc_type, doc_id, doc_ref, amount, discount_pct, summary, requested_by, status, current_seq, decided_at, subject_employee_id, supplier_id, customer_id, item_categories)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $10 = 'approved' THEN now() END, $12, $13, $14, $15) RETURNING id`,
    [input.branchId, input.approverBranchId ?? input.branchId, input.docType, input.docId, input.docRef, input.amount ?? null, input.discountPct ?? null,
      JSON.stringify(input.summary ?? {}), ctx.userId, status, steps[0]?.seq ?? null, input.subjectEmployeeId ?? null, input.supplierId ?? null, input.customerId ?? null, input.itemCategories ?? null],
  ).catch((e) => {
    if (e.code === "23505") throw conflict("This document is already waiting for approval.");
    throw e;
  });
  const reqId = r.rows[0].id;
  await c.query("INSERT INTO approval_action (request_id, branch_id, user_id, action) VALUES ($1,$2,$3,$4)", [reqId, input.branchId, ctx.userId, steps.length ? "submitted" : "auto_approved"]);
  if (steps.length) await createTask(c, reqId, input, steps[0], ctx.userId);
  return { status, requestId: reqId };
}

const ELIGIBLE_SQL = `
  (t.approver_user_id = $1 OR t.backup_user_id = $1 OR EXISTS (
     SELECT 1 FROM user_branch_role ubr
      WHERE ubr.user_id = $1 AND ubr.role_id = t.approver_role_id
        AND (ubr.branch_id = t.approver_branch_id OR ubr.branch_id IS NULL)))
  AND r.requested_by <> $1`;

/** Approvals inbox: items waiting for me. Amounts follow field permissions (WF-05). */
export async function inbox(ctx: Ctx) {
  assertCan(ctx, "approvals", "view");
  return withTx(ctx, async (c) => {
    const r = await c.query(
      `SELECT t.id task_id, t.step_name, t.created_at, r.id request_id, r.doc_type, r.doc_id, r.doc_ref, r.amount, r.discount_pct, r.summary,
              b.code branch_code, u.full_name requested_by_name
         FROM approval_task t JOIN approval_request r ON r.id = t.request_id
         JOIN branch b ON b.id = r.branch_id JOIN app_user u ON u.id = r.requested_by
        WHERE t.status = 'pending' AND r.status = 'pending' AND t.seq = r.current_seq AND ${ELIGIBLE_SQL}
        ORDER BY t.created_at`,
      [ctx.userId],
    );
    // HR requests carry no prices; salary documents follow the salary field; the rest follow selling prices.
    const field = (t: string) => (["leave_request", "overtime_request", "hr_letter", "loan"].includes(t) ? null : ["salary_revision", "payroll_run", "final_settlement"].includes(t) ? "salary" : "selling_price");
    return r.rows.map((row) => { const f = field(row.doc_type); return !f || canSee(ctx, f, null) ? row : { ...row, amount: null, summary: {} }; });
  });
}

export async function sentByMe(ctx: Ctx) {
  return withTx(ctx, async (c) =>
    (await c.query(
      `SELECT r.*, b.code branch_code FROM approval_request r JOIN branch b ON b.id = r.branch_id
        WHERE r.requested_by = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [ctx.userId],
    )).rows,
  );
}

export async function history(c: PoolClient, docType: string, docId: string) {
  return (await c.query(
    `SELECT a.*, u.full_name, t.step_name FROM approval_action a JOIN approval_request r ON r.id = a.request_id
       LEFT JOIN app_user u ON u.id = a.user_id LEFT JOIN approval_task t ON t.id = a.task_id
      WHERE r.doc_type = $1 AND r.doc_id = $2 ORDER BY a.at, a.id`,
    [docType, docId],
  )).rows;
}

/** Approve, reject (reason required) or send back (note required). Rechecked under lock. */
export async function act(ctx: Ctx, taskId: string, action: "approved" | "rejected" | "sent_back", comment = "", channel = "web") {
  if (action !== "approved" && !comment.trim()) throw invalid(action === "rejected" ? "A reason is required to reject." : "A note is required to send back.");
  await import("./workflow-handlers");
  return withTx(ctx, async (c) => {
    const t = await c.query("SELECT t.*, r.requested_by FROM approval_task t JOIN approval_request r ON r.id = t.request_id WHERE t.id = $1", [taskId]);
    if (!t.rowCount) throw notFound("Approval item");
    const task = t.rows[0];
    const rq = await c.query("SELECT * FROM approval_request WHERE id = $1 FOR UPDATE", [task.request_id]);
    const req = rq.rows[0];
    const locked = await c.query("SELECT * FROM approval_task WHERE id = $1 FOR UPDATE", [taskId]);
    if (req.status !== "pending" || locked.rows[0].status !== "pending" || task.seq !== req.current_seq) throw conflict("This approval has already been dealt with.");
    if (req.requested_by === ctx.userId) throw forbidden("You cannot approve your own document.");
    const elig = await c.query(`SELECT 1 FROM approval_task t JOIN approval_request r ON r.id = t.request_id WHERE t.id = $2 AND ${ELIGIBLE_SQL}`, [ctx.userId, taskId]);
    if (!elig.rowCount) throw forbidden("You are not an approver for this step.");

    await c.query("UPDATE approval_task SET status = $2, acted_at = now() WHERE id = $1", [taskId, action]);
    await c.query("INSERT INTO approval_action (request_id, branch_id, task_id, user_id, action, comment, channel) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [req.id, req.branch_id, taskId, ctx.userId, action, comment || null, channel]);
    const h = handlers.get(req.doc_type);
    if (action === "approved") {
      const next = await matchingSteps(c, { docType: req.doc_type, docId: req.doc_id, docRef: req.doc_ref, branchId: req.branch_id, approverBranchId: req.approver_branch_id, amount: req.amount, discountPct: req.discount_pct, supplierId: req.supplier_id, customerId: req.customer_id, itemCategories: req.item_categories }, task.seq);
      if (next.length) {
        await c.query("UPDATE approval_request SET current_seq = $2, version = version + 1 WHERE id = $1", [req.id, next[0].seq]);
        await createTask(c, req.id, { docType: req.doc_type, docId: req.doc_id, docRef: req.doc_ref, branchId: req.branch_id, approverBranchId: req.approver_branch_id, subjectEmployeeId: req.subject_employee_id }, next[0], req.requested_by);
        return { status: "pending" as const };
      }
      await c.query("UPDATE approval_request SET status = 'approved', decided_at = now(), version = version + 1 WHERE id = $1", [req.id]);
      if (h) await h.onApproved(c, ctx, req);
    } else if (action === "rejected") {
      await c.query("UPDATE approval_request SET status = 'rejected', decided_at = now(), version = version + 1 WHERE id = $1", [req.id]);
      if (h) await h.onRejected(c, ctx, req, comment);
    } else {
      await c.query("UPDATE approval_request SET status = 'sent_back', decided_at = now(), version = version + 1 WHERE id = $1", [req.id]);
      if (h?.onSentBack) await h.onSentBack(c, ctx, req, comment);
      else if (h) await h.onRejected(c, ctx, req, comment);
    }
    await audit(c, ctx, "approval_request", req.id, action, { doc_type: req.doc_type, doc_ref: req.doc_ref, comment }, req.branch_id);
    return { status: action };
  });
}
