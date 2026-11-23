import { Ctx, assertCan, can, canAnywhere } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { getSetting } from "./settings";
import { optStr, str } from "../validate";

/**
 * OT-03 customer complaints register: each complaint with its branch, customer, job card, the owner
 * who deals with it, the actions taken and the closure. Same rights as job cards: anyone who can see
 * a branch's jobs sees its complaints, and anyone who can edit them opens and works on complaints.
 */

const CUST = `CASE WHEN cu.customer_type = 'individual' THEN concat_ws(' ', cu.title, cu.first_name, cu.last_name) ELSE 'M/s. ' || cu.company_name END`;

export async function listComplaints(ctx: Ctx, show = "open") {
  if (!canAnywhere(ctx, "jobs", "view")) throw forbidden();
  return withTx(ctx, async (c) => {
    const rows = (await c.query(
      `SELECT k.id, k.doc_no, k.status, k.source, k.description, k.opened_at, k.closed_at, k.due_date, k.resolution, b.code branch_code, j.doc_no job_no, k.job_card_id,
              ${CUST} customer_name, cu.mobile, u.full_name owner_name, lv.name_en source_name,
              (k.status <> 'closed' AND k.due_date < current_date) overdue,
              (SELECT count(*)::int FROM complaint_action a WHERE a.case_id = k.id) actions
         FROM complaint_case k JOIN branch b ON b.id = k.branch_id JOIN customer cu ON cu.id = k.customer_id LEFT JOIN job_card j ON j.id = k.job_card_id
         LEFT JOIN app_user u ON u.id = k.owner_id LEFT JOIN lookup_value lv ON lv.list = 'complaint_source' AND lv.code = k.source
        WHERE ($1 = 'all' OR ($1 = 'open' AND k.status <> 'closed') OR ($1 = 'closed' AND k.status = 'closed') OR ($1 = 'mine' AND k.status <> 'closed' AND k.owner_id = $2)
               OR ($1 = 'overdue' AND k.status <> 'closed' AND k.due_date < current_date))
        ORDER BY k.status = 'closed', k.due_date NULLS LAST, k.opened_at DESC LIMIT 500`, [show, ctx.userId])).rows;
    const stats = (await c.query(
      `SELECT count(*) FILTER (WHERE status <> 'closed')::int open, count(*) FILTER (WHERE status <> 'closed' AND due_date < current_date)::int overdue,
              count(*) FILTER (WHERE status <> 'closed' AND owner_id = $1)::int mine,
              count(*) FILTER (WHERE status = 'closed' AND closed_at > now() - interval '30 days')::int closed_30,
              round(avg(extract(epoch FROM closed_at - opened_at) / 86400) FILTER (WHERE status = 'closed' AND closed_at > now() - interval '90 days')::numeric, 1) avg_days
         FROM complaint_case`, [ctx.userId])).rows[0];
    return { rows, stats };
  });
}

/** Choices for the new-complaint form at the current branch. */
export async function complaintOptions(ctx: Ctx) {
  const b = ctx.currentBranchId;
  return withTx(ctx, async (c) => ({
    sources: (await c.query("SELECT code, name_en FROM lookup_value WHERE list = 'complaint_source' AND active ORDER BY sort")).rows as { code: string; name_en: string }[],
    owners: b ? (await c.query(
      `SELECT DISTINCT u.id, u.full_name FROM app_user u JOIN user_branch_role ubr ON ubr.user_id = u.id JOIN role r ON r.id = ubr.role_id
        WHERE u.status = 'active' AND (ubr.branch_id = $1 OR ubr.branch_id IS NULL) AND r.code NOT IN ('technician') ORDER BY u.full_name`, [b])).rows as { id: string; full_name: string }[] : [],
  }));
}

export async function openComplaint(ctx: Ctx, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    let branchId = ctx.currentBranchId, customerId = str(f.customer_id), jobId = optStr(f.job_card_id), feedbackId = optStr(f.feedback_id);
    let description = str(f.description), source = str(f.source) || "walk_in";
    if (feedbackId) {
      const fb = (await c.query("SELECT f.*, j.customer_id FROM job_feedback f JOIN job_card j ON j.id = f.job_card_id WHERE f.id = $1", [feedbackId])).rows[0];
      if (!fb) throw notFound("Feedback");
      const had = (await c.query("SELECT doc_no FROM complaint_case WHERE feedback_id = $1", [feedbackId])).rows[0];
      if (had) throw invalid(`This rating already has complaint ${had.doc_no}.`);
      branchId = fb.branch_id; customerId = fb.customer_id; jobId = fb.job_card_id; source = "feedback";
      description = description || `Rated ${fb.rating} out of 5${fb.comment ? `: ${fb.comment}` : ""}`;
    } else if (jobId) {
      const j = (await c.query("SELECT branch_id, customer_id FROM job_card WHERE id = $1", [jobId])).rows[0];
      if (!j) throw notFound("Job card");
      branchId = j.branch_id; customerId = j.customer_id;
    }
    if (!branchId) throw invalid("Choose a branch first.");
    assertCan(ctx, "jobs", "edit", branchId);
    if (!customerId || !(await c.query("SELECT 1 FROM customer WHERE id = $1 AND active", [customerId])).rowCount) throw invalid("Choose the customer.", { field: "customer_id" });
    if (!description) throw invalid("Write what the customer is unhappy about.", { field: "description" });
    if (description.length > 2000) throw invalid("Keep the complaint under 2,000 characters.", { field: "description" });
    if (!(await c.query("SELECT 1 FROM lookup_value WHERE list = 'complaint_source' AND code = $1 AND active", [source])).rowCount) throw invalid("Choose how the complaint came in.", { field: "source" });
    const owner = optStr(f.owner_id) ?? ctx.userId;
    const days = Math.max(0, Number(await getSetting(c, "complaints.days_to_close", branchId, 3)) || 3);
    const docNo = await nextDocNo(c, branchId, "complaint");
    const id = (await c.query(
      `INSERT INTO complaint_case (branch_id, doc_no, customer_id, job_card_id, feedback_id, source, description, owner_id, due_date, opened_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, current_date + $9::int, $10) RETURNING id`,
      [branchId, docNo, customerId, jobId, feedbackId, source, description, owner, days, ctx.userId])).rows[0].id as string;
    await c.query("INSERT INTO complaint_action (case_id, branch_id, kind, note, user_id) VALUES ($1,$2,'opened',$3,$4)", [id, branchId, "Complaint opened", ctx.userId]);
    if (feedbackId) await c.query("UPDATE job_feedback SET followed_up_at = coalesce(followed_up_at, now()), followed_up_by = coalesce(followed_up_by, $2), follow_up_note = coalesce(follow_up_note, $3) WHERE id = $1", [feedbackId, ctx.userId, `Complaint ${docNo} opened`]);
    await audit(c, ctx, "complaint", id, "opened", { doc_no: docNo, source }, branchId);
    return { id, docNo };
  });
}

export async function getComplaint(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const k = (await c.query(
      `SELECT k.*, b.code branch_code, b.name_en branch_name, j.doc_no job_no, ${CUST} customer_name, cu.mobile, u.full_name owner_name, ob.full_name opened_by_name,
              cb.full_name closed_by_name, lv.name_en source_name, (k.status <> 'closed' AND k.due_date < current_date) overdue
         FROM complaint_case k JOIN branch b ON b.id = k.branch_id JOIN customer cu ON cu.id = k.customer_id LEFT JOIN job_card j ON j.id = k.job_card_id
         LEFT JOIN app_user u ON u.id = k.owner_id LEFT JOIN app_user ob ON ob.id = k.opened_by LEFT JOIN app_user cb ON cb.id = k.closed_by
         LEFT JOIN lookup_value lv ON lv.list = 'complaint_source' AND lv.code = k.source WHERE k.id = $1`, [id])).rows[0];
    if (!k) throw notFound("Complaint");
    assertCan(ctx, "jobs", "view", k.branch_id);
    const actions = (await c.query("SELECT a.*, u.full_name FROM complaint_action a LEFT JOIN app_user u ON u.id = a.user_id WHERE a.case_id = $1 ORDER BY a.at, a.id", [id])).rows;
    const owners = (await c.query(
      `SELECT DISTINCT u.id, u.full_name FROM app_user u JOIN user_branch_role ubr ON ubr.user_id = u.id JOIN role r ON r.id = ubr.role_id
        WHERE u.status = 'active' AND (ubr.branch_id = $1 OR ubr.branch_id IS NULL) AND r.code NOT IN ('technician') ORDER BY u.full_name`, [k.branch_id])).rows as { id: string; full_name: string }[];
    return { k, actions, owners, canEdit: can(ctx, "jobs", "edit", k.branch_id) };
  });
}

/** Adds an action taken, hands the complaint to another owner, or closes it with what was done. */
export async function workComplaint(ctx: Ctx, id: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const k = (await c.query("SELECT * FROM complaint_case WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!k) throw notFound("Complaint");
    assertCan(ctx, "jobs", "edit", k.branch_id);
    const step = str(f.step);
    const note = optStr(f.note);
    if (k.status === "closed" && step !== "reopen") throw invalid("This complaint is closed. Reopen it to add more.");
    if (step === "action") {
      if (!note) throw invalid("Write what was done.", { field: "note" });
      await c.query("INSERT INTO complaint_action (case_id, branch_id, kind, note, user_id) VALUES ($1,$2,'note',$3,$4)", [id, k.branch_id, note, ctx.userId]);
      if (k.status === "open") await c.query("UPDATE complaint_case SET status = 'in_progress' WHERE id = $1", [id]);
    } else if (step === "owner") {
      const o = str(f.owner_id);
      const u = (await c.query("SELECT full_name FROM app_user WHERE id = $1 AND status = 'active'", [o])).rows[0];
      if (!u) throw invalid("Choose who deals with it.", { field: "owner_id" });
      await c.query("UPDATE complaint_case SET owner_id = $2 WHERE id = $1", [id, o]);
      await c.query("INSERT INTO complaint_action (case_id, branch_id, kind, note, user_id) VALUES ($1,$2,'owner',$3,$4)", [id, k.branch_id, `Handed to ${u.full_name}${note ? `: ${note}` : ""}`, ctx.userId]);
    } else if (step === "close") {
      if (!note) throw invalid("Write how the complaint was resolved.", { field: "note" });
      await c.query("UPDATE complaint_case SET status = 'closed', resolution = $2, closed_at = now(), closed_by = $3 WHERE id = $1", [id, note, ctx.userId]);
      await c.query("INSERT INTO complaint_action (case_id, branch_id, kind, note, user_id) VALUES ($1,$2,'closed',$3,$4)", [id, k.branch_id, `Closed: ${note}`, ctx.userId]);
    } else if (step === "reopen") {
      if (k.status !== "closed") throw invalid("The complaint is still open.");
      if (!note) throw invalid("Write why it is reopened.", { field: "note" });
      await c.query("UPDATE complaint_case SET status = 'in_progress', closed_at = NULL, closed_by = NULL, resolution = NULL WHERE id = $1", [id]);
      await c.query("INSERT INTO complaint_action (case_id, branch_id, kind, note, user_id) VALUES ($1,$2,'reopened',$3,$4)", [id, k.branch_id, `Reopened: ${note}`, ctx.userId]);
    } else throw invalid("Choose what to do.");
    await audit(c, ctx, "complaint", id, step, { note }, k.branch_id);
  });
}
