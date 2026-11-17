import { requireCtx } from "@/lib/session";
import { getTransfer } from "@/lib/services/stock-ops";
import { can } from "@/lib/access";
import { transferStepAction } from "@/app/actions-ops";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, Link, Money, PageHead, Status, dt, label } from "@/components/ui";
import { D } from "@/lib/money";

export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { t, lines, events, side } = await getTransfer(ctx, id);
  const cost = lines.some((l) => "unit_cost" in l);
  const canDispatch = side.supplier && can(ctx, "stock", "edit", t.from_branch_id) && t.status === "approved";
  const canReceive = side.requester && can(ctx, "stock", "edit", t.to_branch_id) && t.status === "dispatched";
  const canCancel = (t.status === "requested" && side.requester) || (t.status === "approved" && side.supplier);
  return (
    <>
      <PageHead title={`Transfer ${t.doc_no}`} sub={`From ${t.from_code} · ${t.from_name} to ${t.to_code} · ${t.to_name}${t.note ? ` · ${t.note}` : ""}`}><Status s={t.status} /></PageHead>
      <Flash sp={sp} />
      {t.status === "requested" && <div className="flash warn">Waiting for the {t.from_code} branch manager to approve. Nothing has moved yet.</div>}
      {t.reason && <div className="flash warn">{label(t.status)}: {t.reason}</div>}
      <form action={transferStepAction} className="card">
        <input type="hidden" name="id" value={id} />
        <table>
          <thead><tr><th>Part</th><th>For job</th><th className="num">Asked</th><th className="num">Sent</th><th className="num">Received</th>{cost && <th className="num">Unit cost</th>}<th>Short or damaged</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.part_no}<div className="small muted">{l.description}</div></td><td>{l.job_id ? <Link href={`/jobs/${l.job_id}`}>{l.job_no}</Link> : "—"}</td>
              <td className="num">{D(l.qty).toString()}</td><td className="num">{D(l.dispatched_qty).toString()}</td>
              <td className="num">{canReceive ? <input name={`recv[${l.id}]`} defaultValue={D(l.dispatched_qty).toString()} style={{ width: 80, minWidth: 60 }} /> : D(l.received_qty).toString()}</td>
              {cost && <td className="num">{l.unit_cost ? <Money v={l.unit_cost} /> : "—"}</td>}
              <td className="small">{canReceive ? <input name={`why[${l.id}]`} placeholder="Reason if less arrived" /> : D(l.short_qty).gt(0) ? <><b>{D(l.short_qty).toString()}</b> {l.short_reason}</> : "—"}</td></tr>
          ))}</tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          {canDispatch && <div className="shrink"><ConfirmButton className="btn" name="step" value="dispatch" message="Dispatch these parts? They leave your stock now.">Dispatch</ConfirmButton></div>}
          {canReceive && <div className="shrink"><button className="btn green" name="step" value="receive">Receive into stock</button></div>}
        </div>
      </form>
      {canCancel && (can(ctx, "stock", "cancel") || can(ctx, "stock", "approve")) && (
        <form action={transferStepAction} className="card row"><input type="hidden" name="id" value={id} /><input type="hidden" name="step" value="cancel" />
          <input name="reason" placeholder="Reason for cancelling" required /><ConfirmButton className="btn ghost red-text shrink" message="Cancel this transfer?">Cancel transfer</ConfirmButton></form>
      )}
      <div className="card"><h2>History</h2>
        <table><tbody>{events.map((e) => <tr key={e.id}><td><Status s={e.status} /></td><td>{e.full_name}</td><td className="small">{e.note}</td><td className="small muted">{dt(e.at)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
