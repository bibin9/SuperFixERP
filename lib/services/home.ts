import { Ctx, canAnywhere } from "../access";
import { withTx } from "../db";
import { missingPunches, listDevices } from "./punch-devices";

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
    const b = ctx.currentBranchId;
    const lowStock = b && canAnywhere(ctx, "stock", "view") ? Number((await c.query(
      `SELECT count(*) n FROM item_branch ib LEFT JOIN stock_balance sb ON sb.item_id = ib.item_id AND sb.branch_id = ib.branch_id
        WHERE ib.branch_id = $1 AND ib.reorder_level > 0 AND coalesce(sb.on_hand - sb.committed - sb.reserved, 0) <= ib.reorder_level`, [b])).rows[0].n) : 0;
    const lateJobs = b && (canAnywhere(ctx, "workshop", "view") || canAnywhere(ctx, "jobs", "view")) ? Number((await c.query(
      `SELECT count(*) n FROM job_card WHERE branch_id = $1 AND promised_at < now() AND status NOT IN ('ready','delivered','invoiced','closed','cancelled')`, [b])).rows[0].n) : 0;
    const keyDrops = b && canAnywhere(ctx, "customers", "view") ? Number((await c.query("SELECT count(*) n FROM key_drop WHERE branch_id = $1 AND status = 'waiting'", [b])).rows[0].n) : 0;
    return { branches, pending, lowStock, lateJobs, keyDrops };
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
      `SELECT count(*) FILTER (WHERE status IN ('open','booked')) open, count(*) FILTER (WHERE status IN ('open','booked','quoted') AND follow_up_at < now()) overdue,
              count(*) FILTER (WHERE status = 'quoted') quoted, count(*) FILTER (WHERE status = 'approved') approved FROM enquiry WHERE ($1::uuid IS NULL OR branch_id = $1)`, [b])).rows[0];
    const sales = (await c.query(
      `SELECT coalesce(sum(taxable_total),0) net, coalesce(sum(grand_total - paid_amount),0) open FROM sales_invoice WHERE ($1::uuid IS NULL OR branch_id = $1) AND doc_date = (now() AT TIME ZONE 'Asia/Dubai')::date`, [b])).rows[0];
    return { byStatus, late, enq, sales };
  });
}

const NOT_DONE = "('ready','delivered','invoiced','closed','cancelled')";

/**
 * "My day": the short lists a front-office person works through, each row with its next step.
 * Current branch only (all branches for owner/HQ when they choose). Rows are limited to what the user may open.
 */
export async function myDay(ctx: Ctx, scope: "current" | "all") {
  const seesEnq = canAnywhere(ctx, "customers", "view");
  const seesJobs = canAnywhere(ctx, "jobs", "view");
  return withTx(ctx, async (c) => {
    const b = scope === "all" ? null : ctx.currentBranchId;
    const who = `c.customer_type, c.title, c.first_name, c.last_name, c.company_name`;
    const callBack = seesEnq ? (await c.query(
      `SELECT e.id, e.doc_no, e.service_asked, e.follow_up_at, e.contact_name, e.customer_id, ${who},
              (e.follow_up_at < now()) overdue
         FROM enquiry e LEFT JOIN customer c ON c.id = e.customer_id
        WHERE ($1::uuid IS NULL OR e.branch_id = $1) AND e.status IN ('open','booked') AND e.doc_no NOT LIKE 'LEGACY-%'
          AND e.follow_up_at < ((now() AT TIME ZONE 'Asia/Dubai')::date + 1) AT TIME ZONE 'Asia/Dubai'
        ORDER BY e.follow_up_at LIMIT 8`, [b])).rows : [];
    const waiting = seesEnq ? (await c.query(
      `SELECT q.id, q.doc_no, q.sent_at, q.grand_total, q.enquiry_id, j.id job_id, j.doc_no job_no, v.make, v.model, v.model_year, ${who}
         FROM quotation q JOIN enquiry e ON e.id = q.enquiry_id LEFT JOIN job_card j ON j.id = q.job_card_id
         JOIN customer c ON c.id = e.customer_id LEFT JOIN vehicle v ON v.id = e.vehicle_id
        WHERE ($1::uuid IS NULL OR e.branch_id = $1) AND q.status = 'sent' ORDER BY q.sent_at LIMIT 8`, [b])).rows : [];
    const toCreate = seesEnq ? (await c.query(
      `SELECT e.id, e.doc_no, e.service_asked, v.make, v.model, ${who}
         FROM enquiry e JOIN customer c ON c.id = e.customer_id LEFT JOIN vehicle v ON v.id = e.vehicle_id
        WHERE ($1::uuid IS NULL OR e.branch_id = $1) AND e.status = 'approved' ORDER BY e.updated_at LIMIT 8`, [b])).rows : [];
    const ready = seesJobs ? (await c.query(
      `SELECT j.id, j.doc_no, j.ready_at, v.make, v.model, v.model_year, ${who},
              EXISTS (SELECT 1 FROM sales_invoice i WHERE i.job_card_id = j.id AND i.status <> 'cancelled') invoiced
         FROM job_card j JOIN customer c ON c.id = j.customer_id JOIN vehicle v ON v.id = j.vehicle_id
        WHERE ($1::uuid IS NULL OR j.branch_id = $1) AND j.status IN ('ready','invoiced') AND j.delivered_at IS NULL ORDER BY j.ready_at NULLS LAST LIMIT 8`, [b])).rows : [];
    const late = seesJobs ? (await c.query(
      `SELECT j.id, j.doc_no, j.promised_at, j.status, v.make, v.model, ${who}
         FROM job_card j JOIN customer c ON c.id = j.customer_id JOIN vehicle v ON v.id = j.vehicle_id
        WHERE ($1::uuid IS NULL OR j.branch_id = $1) AND j.promised_at < now() AND j.status NOT IN ${NOT_DONE} ORDER BY j.promised_at LIMIT 8`, [b])).rows : [];
    return { callBack, waiting, toCreate, ready, late };
  });
}

export type Alert = { group: string; text: string; sub?: string; href: string; tone: "r" | "a" | "b" };

/**
 * The bell in the top bar: each person sees only the alerts their permissions cover, for the branch they are on
 * (staff documents are company-wide, for HR). Same sources as the screens they link to.
 */
export async function alertsFor(ctx: Ctx): Promise<Alert[]> {
  const out = await branchAlerts(ctx);
  const miss = await missingPunches(ctx);
  if (miss.length) out.push({ group: "Attendance", text: `${miss.length} missing punch${miss.length === 1 ? "" : "es"} to fix`, sub: "Punched in but not out in the last 7 days", href: "/hr/attendance#missing", tone: "a" });
  if (canAnywhere(ctx, "hr", "edit")) {
    const off = (await listDevices(ctx)).filter((d) => d.active && !d.online && d.manage);
    if (off.length) out.push({ group: "Attendance", text: `${off.length} punching machine${off.length === 1 ? "" : "s"} offline`, sub: off.slice(0, 4).map((d) => d.code).join(", "), href: "/hr/machines", tone: "a" });
  }
  return out;
}

async function branchAlerts(ctx: Ctx): Promise<Alert[]> {
  const b = ctx.currentBranchId;
  return withTx(ctx, async (c) => {
    const out: Alert[] = [];
    if (b && canAnywhere(ctx, "stock", "view")) {
      for (const r of (await c.query(
        `SELECT i.part_no, i.description, coalesce(sb.on_hand - sb.committed - sb.reserved, 0) free, ib.reorder_level
           FROM item_branch ib JOIN item i ON i.id = ib.item_id LEFT JOIN stock_balance sb ON sb.item_id = ib.item_id AND sb.branch_id = ib.branch_id
          WHERE ib.branch_id = $1 AND ib.reorder_level > 0 AND coalesce(sb.on_hand - sb.committed - sb.reserved, 0) <= ib.reorder_level
          ORDER BY coalesce(sb.on_hand - sb.committed - sb.reserved, 0) / ib.reorder_level, i.part_no LIMIT 8`, [b])).rows)
        out.push({ group: "Stock running low", text: r.description, sub: `${Number(r.free)} free · reorder level ${Number(r.reorder_level)}`, href: "/stock/reorder", tone: Number(r.free) <= 0 ? "r" : "a" });
    }
    if (b && (canAnywhere(ctx, "workshop", "view") || canAnywhere(ctx, "jobs", "view"))) {
      for (const r of (await c.query(
        `SELECT j.id, j.doc_no, v.make || ' ' || v.model car FROM job_card j JOIN vehicle v ON v.id = j.vehicle_id
          WHERE j.branch_id = $1 AND j.promised_at < now() AND j.status NOT IN ('ready','delivered','invoiced','closed','cancelled')
          ORDER BY j.promised_at LIMIT 8`, [b])).rows)
        out.push({ group: "Running late", text: `${r.doc_no} · ${r.car}`, sub: "Past the promised time: send the customer a new time", href: `/jobs/${r.id}#newtime`, tone: "r" });
    }
    if (b && canAnywhere(ctx, "customers", "view")) {
      for (const r of (await c.query("SELECT id, doc_no, name, plate_number FROM key_drop WHERE branch_id = $1 AND status = 'waiting' ORDER BY created_at LIMIT 8", [b])).rows)
        out.push({ group: "Keys dropped after hours", text: `${r.name} · ${r.plate_number}`, sub: `${r.doc_no}: check the car in`, href: `/workshop/keys/${r.id}`, tone: "b" });
    }
    if (b && canAnywhere(ctx, "jobs", "view")) {
      for (const r of (await c.query(
        `SELECT f.rating, j.doc_no FROM job_feedback f JOIN job_card j ON j.id = f.job_card_id
          WHERE f.branch_id = $1 AND f.rating <= 2 AND f.followed_up_at IS NULL ORDER BY f.answered_at DESC LIMIT 5`, [b])).rows)
        out.push({ group: "Unhappy customers", text: `${r.doc_no} rated ${r.rating} of 5`, sub: "Call the customer and write what was done", href: "/feedback?f=low", tone: "r" });
    }
    if (canAnywhere(ctx, "hr", "view")) {
      for (const r of (await c.query(
        `SELECT e.id, e.first_name || ' ' || e.last_name full_name, r.kind, lv.name_en doc_label, r.data->>'doc_type' doc_type, (r.expiry_date - current_date) days_left
           FROM employee_record r JOIN employee e ON e.id = r.employee_id
           LEFT JOIN lookup_value lv ON lv.list = 'hr_document_type' AND lv.code = r.data->>'doc_type'
          WHERE r.status = 'active' AND e.status = 'active' AND r.expiry_date IS NOT NULL AND r.expiry_date <= current_date + 30
            AND (r.data->>'renewal_started') IS NULL
          ORDER BY r.expiry_date LIMIT 8`)).rows) {
        const left = Number(r.days_left);
        const what = r.kind === "document" ? r.doc_label ?? r.doc_type : r.kind === "visa" ? "Visa" : r.kind === "insurance" ? "Insurance" : r.kind;
        out.push({ group: "Staff documents expiring", text: `${r.full_name} · ${what}`, sub: left < 0 ? `Expired ${-left} days ago` : `Expires in ${left} days`, href: "/hr#expiring", tone: left <= 7 ? "r" : "a" });
      }
    }
    return out;
  });
}
