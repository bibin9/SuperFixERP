import { requireCtx } from "@/lib/session";
import { listWorkflows } from "@/lib/services/admin";
import { workflowToggleAction, stepAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/ui";

/** Which rule facts each document carries (WF-03). Branch and amount apply to all. */
const SUPPLIER_DOCS = ["purchase_order", "supplier_bill"];
const CUSTOMER_DOCS = ["discount", "credit_note"];
const CATEGORY_DOCS = ["purchase_order", "supplier_bill", "discount", "credit_note", "stock_transfer", "stock_adjustment"];
const NO_AMOUNT = ["stock_transfer", "leave_request", "overtime_request", "hr_letter"];

export default async function Workflows({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const { workflows: wfs, options: o } = await listWorkflows(ctx);
  const pick = (name: string, label: string, list: { id: string; label: string }[], v: string | null) => (
    <div className="field"><label>{label}</label><select name={name} defaultValue={v ?? ""}><option value="">Any</option>{list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
  );
  return (
    <>
      <PageHead title="Approval workflows" sub="One engine for every document. If a workflow is off or no step matches, the document is approved at once and that is logged." />
      <Flash sp={sp} />
      <p className="small muted">A step applies only when every rule on it matches; leave a rule at Any to ignore it. Amounts include both ends. Item category matches when any line on the document is in that category.</p>
      {wfs.map((w) => (
        <div className="card" key={w.id}>
          <div className="row" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>{w.name}</h2>
            <form action={workflowToggleAction} className="shrink"><input type="hidden" name="id" value={w.id} /><input type="hidden" name="enabled" value={String(!w.enabled)} />
              <button className={`btn sm ${w.enabled ? "ghost" : "green"}`}>{w.enabled ? "Switch off" : "Switch on"}</button></form>
          </div>
          {w.steps.map((s: Record<string, any>) => (
            <form key={s.id} action={stepAction} className="wfstep" style={{ borderTop: "1px solid #eef2f7", marginTop: 10, paddingTop: 10 }}>
              <input type="hidden" name="id" value={s.id} />
              <div><b>{s.seq}. {s.name}</b> <span className="small muted">· {s.role_name ?? s.user_name}{s.approver_role_scope === "supplying_branch" ? " (supplying branch)" : ""}{s.backup_name ? ` · backup ${s.backup_name}` : ""}</span></div>
              <div className="row">
                {pick("cond_branch_id", "Branch", o.branches, s.cond_branch_id)}
                {!NO_AMOUNT.includes(w.doc_type) && <>
                  <div className="field"><label>From AED</label><input name="cond_min_amount" defaultValue={s.cond_min_amount ?? ""} placeholder="any" inputMode="decimal" /></div>
                  <div className="field"><label>To AED</label><input name="cond_max_amount" defaultValue={s.cond_max_amount ?? ""} placeholder="any" inputMode="decimal" /></div></>}
                {NO_AMOUNT.includes(w.doc_type) && <><input type="hidden" name="cond_min_amount" value={s.cond_min_amount ?? ""} /><input type="hidden" name="cond_max_amount" value={s.cond_max_amount ?? ""} /></>}
                {w.doc_type !== "discount" && <input type="hidden" name="cond_min_discount_pct" value={s.cond_min_discount_pct ?? ""} />}
                {w.doc_type === "discount" && <div className="field"><label>Discount above %</label><input name="cond_min_discount_pct" defaultValue={s.cond_min_discount_pct ?? ""} placeholder="any" inputMode="decimal" /></div>}
                {SUPPLIER_DOCS.includes(w.doc_type) && pick("cond_supplier_id", "Supplier", o.suppliers, s.cond_supplier_id)}
                {CUSTOMER_DOCS.includes(w.doc_type) && pick("cond_customer_id", "Company customer", o.customers, s.cond_customer_id)}
                {CATEGORY_DOCS.includes(w.doc_type) && pick("cond_item_category", "Item category", o.categories, s.cond_item_category)}
                <div className="field shrink" style={{ width: 120 }}><label>Remind after (h)</label><input name="reminder_hours" defaultValue={s.reminder_hours ?? ""} placeholder="default" inputMode="numeric" /></div>
                <div className="field shrink" style={{ width: 120 }}><label>Escalate after (h)</label><input name="escalate_hours" defaultValue={s.escalate_hours ?? ""} placeholder="default" inputMode="numeric" /></div>
                {pick("escalate_role_id", "Escalate to", o.roles, s.escalate_role_id)}
                <label className="check shrink"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Step on</label>
                <div className="shrink"><button className="btn ghost sm">Save</button></div>
              </div>
            </form>
          ))}
        </div>
      ))}
      <p className="small muted">Discount limits per role are under Settings, in the discount limit lines. The discount workflow starts only when a user goes above their limit or below the minimum margin. Remind after and Escalate after are the hours a step may wait: blank uses Settings, Approvals (24 and 48 hours), 0 switches it off. When an item is escalated, the Escalate to role (blank = the role in Settings) can approve it too.</p>
    </>
  );
}
