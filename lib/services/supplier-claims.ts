import { Ctx, assertCan, can, canSee, redact } from "../access";
import { withTx } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { nextDocNo } from "./numbering";
import { postJournal } from "./ledger";
import { D, r2, parseDec } from "../money";
import { optStr, str } from "../validate";
import { stockIn, stockOut, today } from "./stock";
import { getSetting } from "./settings";

/**
 * OT-05: warranty claims to suppliers for failed parts and tyres. Open (failed part recorded) → sent
 * (back to the supplier) → credited, replaced or rejected. A part off the shelf leaves stock when sent
 * (its cost goes to warranty cost); a supplier credit or a replacement part reduces warranty cost.
 */
const COST = { unit_cost: "purchase_cost", credit_amount: "purchase_cost", credit_vat: "purchase_cost", value: "purchase_cost" };

function here(ctx: Ctx) {
  if (!ctx.currentBranchId) throw invalid("Choose a branch first.");
  return ctx.currentBranchId;
}
const canWork = (ctx: Ctx, b: string) => can(ctx, "purchasing", "create", b) || can(ctx, "stock", "create", b);

export async function listClaims(ctx: Ctx, show = "open") {
  if (!can(ctx, "purchasing", "view") && !can(ctx, "stock", "view")) throw forbidden();
  return withTx(ctx, async (c) => {
    const days = Number(await getSetting(c, "claims.days_to_answer", ctx.currentBranchId, 30)) || 30;
    const rows = (await c.query(
      `SELECT sc.*, b.code branch_code, s.name_en supplier_name, i.part_no, i.description item_desc, j.doc_no job_no,
              (sc.status = 'sent' AND sc.sent_at < now() - make_interval(days => $2)) overdue
         FROM supplier_claim sc JOIN branch b ON b.id = sc.branch_id JOIN supplier s ON s.id = sc.supplier_id JOIN item i ON i.id = sc.item_id
         LEFT JOIN job_card j ON j.id = sc.job_card_id
        WHERE ($1 = 'all' OR ($1 = 'open' AND sc.status IN ('open','sent')) OR ($1 = 'closed' AND sc.status IN ('credited','replaced','rejected')))
        ORDER BY sc.created_at DESC LIMIT 300`, [show, days])).rows;
    return redact(ctx, rows, COST, (r) => r.branch_id as string);
  });
}

export async function claimOptions(ctx: Ctx) {
  return withTx(ctx, async (c) => ({
    suppliers: (await c.query("SELECT id, name_en FROM supplier WHERE active ORDER BY name_en")).rows,
    items: (await c.query("SELECT id, part_no, description, search_codes codes, preferred_supplier_id FROM item WHERE active AND item_type IN ('stock','consumable') ORDER BY part_no")).rows,
    jobs: ctx.currentBranchId ? (await c.query("SELECT id, doc_no FROM job_card WHERE branch_id = $1 AND doc_date > current_date - 400 ORDER BY doc_no DESC LIMIT 300", [ctx.currentBranchId])).rows : [],
  }));
}

export async function openClaim(ctx: Ctx, f: Record<string, unknown>) {
  const b = here(ctx);
  if (!canWork(ctx, b)) throw forbidden();
  return withTx(ctx, async (c) => {
    const sup = (await c.query("SELECT id FROM supplier WHERE id = $1 AND active", [str(f.supplier_id)])).rows[0];
    if (!sup) throw invalid("Choose the supplier.");
    const it = (await c.query("SELECT id FROM item WHERE id = $1 AND active", [str(f.item_id)])).rows[0];
    if (!it) throw invalid("Choose the failed part.");
    const qty = parseDec(f.qty || "1", "Quantity", { min: "0.001", dp: 3 });
    const fault = str(f.fault);
    if (!fault) throw invalid("Describe the fault.");
    const jobId = optStr(f.job_card_id);
    if (jobId && !(await c.query("SELECT 1 FROM job_card WHERE id = $1 AND branch_id = $2", [jobId, b])).rowCount) throw invalid("Job card not found in this branch.");
    const fromStock = str(f.from_stock) === "on" || str(f.from_stock) === "true";
    if (!fromStock && !jobId) throw invalid("Choose the job the part failed on, or tick that it comes off the shelf.");
    const cost = (await c.query("SELECT avg_cost FROM stock_balance WHERE item_id = $1 AND branch_id = $2", [it.id, b])).rows[0]?.avg_cost ?? 0;
    const docNo = await nextDocNo(c, b, "supplier_claim");
    const r = (await c.query(
      `INSERT INTO supplier_claim (branch_id, doc_no, supplier_id, item_id, qty, serial_no, job_card_id, from_stock, fault, unit_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b, docNo, sup.id, it.id, qty.toFixed(3), optStr(f.serial_no), jobId, fromStock, fault, D(cost).toFixed(4), ctx.userId])).rows[0];
    await audit(c, ctx, "supplier_claim", r.id, "opened", { doc_no: docNo, from_stock: fromStock }, b);
    return { id: r.id as string, docNo };
  });
}

export async function getClaim(ctx: Ctx, id: string) {
  return withTx(ctx, async (c) => {
    const r = (await c.query(
      `SELECT sc.*, b.code branch_code, s.name_en supplier_name, i.part_no, i.description item_desc, j.doc_no job_no, u.full_name created_by_name
         FROM supplier_claim sc JOIN branch b ON b.id = sc.branch_id JOIN supplier s ON s.id = sc.supplier_id JOIN item i ON i.id = sc.item_id
         LEFT JOIN job_card j ON j.id = sc.job_card_id LEFT JOIN app_user u ON u.id = sc.created_by WHERE sc.id = $1`, [id])).rows[0];
    if (!r) throw notFound("Warranty claim");
    if (!can(ctx, "purchasing", "view", r.branch_id) && !can(ctx, "stock", "view", r.branch_id)) throw forbidden();
    return { claim: redact(ctx, [r], COST, () => r.branch_id)[0], canWork: canWork(ctx, r.branch_id), canPost: can(ctx, "purchasing", "edit", r.branch_id) && canSee(ctx, "purchase_cost", r.branch_id) };
  });
}

/** Steps: send (back to the supplier), credit (amount and VAT), replace (part comes back into stock), reject. */
export async function workClaim(ctx: Ctx, id: string, step: string, f: Record<string, unknown>) {
  return withTx(ctx, async (c) => {
    const r = (await c.query("SELECT sc.*, i.part_no FROM supplier_claim sc JOIN item i ON i.id = sc.item_id WHERE sc.id = $1 FOR UPDATE OF sc", [id])).rows[0];
    if (!r) throw notFound("Warranty claim");
    const b = r.branch_id as string;
    if (!canWork(ctx, b) && !(step === "credit" && can(ctx, "purchasing", "edit", b))) throw forbidden();
    const qty = D(r.qty);
    if (step === "send") {
      if (r.status !== "open") throw invalid("This claim has already been sent.");
      if (r.from_stock) {
        // The failed part leaves the shelf; its cost is warranty cost until the supplier answers.
        const out = await stockOut(c, ctx, { branchId: b, itemId: r.item_id, qty, moveType: "supplier_claim", ref: r.doc_no });
        await c.query("UPDATE supplier_claim SET unit_cost = $2 WHERE id = $1", [id, out.value.div(qty).toFixed(4)]);
        await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "supplier_claim", sourceId: id, narration: `${r.doc_no}: failed ${r.part_no} sent back to the supplier`,
          lines: [{ event: "warranty_expense", debit: out.value }, { event: "inventory", credit: out.value }] });
      }
      await c.query("UPDATE supplier_claim SET status = 'sent', sent_at = now(), sent_by = $2, sent_ref = $3 WHERE id = $1", [id, ctx.userId, optStr(f.sent_ref)]);
    } else if (step === "credit" || step === "replace" || step === "reject") {
      if (r.status !== "sent") throw invalid("Send the claim to the supplier first.");
      const note = optStr(f.outcome_note), sref = optStr(f.supplier_ref);
      if (step === "credit") {
        if (!can(ctx, "purchasing", "edit", b) || !canSee(ctx, "purchase_cost", b)) throw forbidden("The purchasing officer or accountant records a supplier credit.");
        const amt = parseDec(f.credit_amount, "Credit amount before VAT", { min: "0.01", dp: 2 });
        const vat = str(f.credit_vat) ? parseDec(f.credit_vat, "VAT on the credit", { min: 0, dp: 2 }) : r2(amt.mul("0.05"));
        if (!sref) throw invalid("Enter the supplier's credit note number.");
        await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "supplier_claim", sourceId: id, narration: `${r.doc_no}: supplier credit ${sref} for failed ${r.part_no}`,
          lines: [{ event: "trade_payable", debit: amt.plus(vat), supplierId: r.supplier_id }, { event: "warranty_expense", credit: amt }, { event: "vat_input", credit: vat }] });
        await c.query("UPDATE supplier_claim SET credit_amount = $2, credit_vat = $3 WHERE id = $1", [id, amt.toFixed(2), vat.toFixed(2)]);
      }
      if (step === "replace") {
        // The replacement goes into stock at the failed part's cost; that value comes off warranty cost.
        const unit = D(r.unit_cost);
        const inn = await stockIn(c, ctx, { branchId: b, itemId: r.item_id, qty, unitCost: unit, moveType: "supplier_claim", ref: r.doc_no });
        await postJournal(c, ctx, { branchId: b, date: today(), sourceType: "supplier_claim", sourceId: id, narration: `${r.doc_no}: replacement ${r.part_no} from the supplier`,
          lines: [{ event: "inventory", debit: inn.value }, { event: "warranty_expense", credit: inn.value }] });
      }
      if (step === "reject" && !note) throw invalid("Write why the supplier rejected the claim.");
      await c.query("UPDATE supplier_claim SET status = $2, outcome_at = now(), outcome_by = $3, outcome_note = $4, supplier_ref = $5 WHERE id = $1",
        [id, ({ credit: "credited", replace: "replaced", reject: "rejected" } as Record<string, string>)[step], ctx.userId, note, sref]);
    } else throw invalid("Unknown step.");
    await audit(c, ctx, "supplier_claim", id, step, { doc_no: r.doc_no }, b);
  });
}
