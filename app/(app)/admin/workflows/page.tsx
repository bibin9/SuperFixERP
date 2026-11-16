import { requireCtx } from "@/lib/session";
import { listWorkflows } from "@/lib/services/admin";
import { workflowToggleAction, stepAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/ui";

export default async function Workflows({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const wfs = await listWorkflows(ctx);
  return (
    <>
      <PageHead title="Approval workflows" sub="One engine for every document. If a workflow is off or no step matches, the document is approved at once and that is logged." />
      <Flash sp={sp} />
      {wfs.map((w) => (
        <div className="card" key={w.id}>
          <div className="row" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>{w.name} <span className="muted small">({w.doc_type})</span></h2>
            <form action={workflowToggleAction} className="shrink"><input type="hidden" name="id" value={w.id} /><input type="hidden" name="enabled" value={String(!w.enabled)} />
              <button className={`btn sm ${w.enabled ? "ghost" : "green"}`}>{w.enabled ? "Switch off" : "Switch on"}</button></form>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Step</th><th>Approver</th><th>From AED</th><th>To AED</th><th>Discount above %</th><th>On</th><th></th></tr></thead>
            <tbody>{w.steps.map((s: Record<string, any>) => (
              <tr key={s.id}><td>{s.seq}. {s.name}</td><td>{s.role_name ?? s.user_name}{s.approver_role_scope === "supplying_branch" ? " (supplying branch)" : ""}{s.backup_name ? ` · backup ${s.backup_name}` : ""}</td>
                <td colSpan={5}><form action={stepAction} className="row"><input type="hidden" name="id" value={s.id} />
                  <input name="cond_min_amount" defaultValue={s.cond_min_amount ?? ""} placeholder="any" /><input name="cond_max_amount" defaultValue={s.cond_max_amount ?? ""} placeholder="any" />
                  <input name="cond_min_discount_pct" defaultValue={s.cond_min_discount_pct ?? ""} placeholder="any" />
                  <label className="shrink"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> on</label><button className="btn ghost sm shrink">Save</button></form></td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      <p className="small muted">Discount limits per role are under Settings (discount.max_pct.*). The discount workflow starts only when a user goes above their limit or below the minimum margin.</p>
    </>
  );
}
