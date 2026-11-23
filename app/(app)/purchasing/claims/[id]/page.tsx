import { requireCtx } from "@/lib/session";
import { getClaim } from "@/lib/services/supplier-claims";
import { claimStepAction } from "@/app/actions-ops";
import { RecordHistory } from "@/components/RecordHistory";
import { docHistory } from "@/lib/services/history";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, Link, Money, PageHead, Status, dt } from "@/components/ui";
import { PurchTabs } from "@/components/PurchTabs";
import { D } from "@/lib/money";

/** OT-05: one supplier warranty claim and its steps. */
export default async function Claim({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { claim: r, canWork, canPost } = await getClaim(ctx, id);
  const hidden = <><input type="hidden" name="id" value={id} /></>;
  return (
    <>
      <PageHead title={`Warranty claim ${r.doc_no}`} sub={`${r.branch_code} · ${r.supplier_name} · opened by ${r.created_by_name ?? "—"} ${dt(r.created_at)}`}><Status s={r.status} /></PageHead>
      <PurchTabs at="/purchasing/claims" />
      <Flash sp={sp} />
      <div className="card">
        <p><b>{r.part_no}</b> {r.item_desc} × {D(r.qty).toString()}{r.serial_no && <> · serial/DOT <b>{r.serial_no}</b></>}</p>
        <p>Fault: {r.fault}</p>
        <p className="small">{r.job_no ? <>Failed on job <Link href={`/jobs/${r.job_card_id}`}>{r.job_no}</Link></> : "Taken off the shelf"}{"unit_cost" in r && <> · cost <Money v={D(r.unit_cost).mul(r.qty).toFixed(2)} /></>}</p>
        {r.sent_at && <p className="small">Sent {dt(r.sent_at)}{r.sent_ref && <> · reference {r.sent_ref}</>}</p>}
        {r.outcome_at && <p className="small">Answer {dt(r.outcome_at)}{r.supplier_ref && <> · supplier ref {r.supplier_ref}</>}{"credit_amount" in r && r.credit_amount && <> · credit <Money v={r.credit_amount} /> + VAT <Money v={r.credit_vat} /></>}{r.outcome_note && <> · {r.outcome_note}</>}</p>}
      </div>
      {canWork && r.status === "open" && (
        <form action={claimStepAction} className="card">{hidden}<input type="hidden" name="step" value="send" />
          <h2>Send to the supplier</h2>
          {r.from_stock && <p className="small muted">The part leaves stock now; its cost goes to warranty cost until the supplier answers.</p>}
          <div className="row"><div className="field"><label>Delivery note or courier reference</label><input name="sent_ref" /></div>
            <div className="shrink"><button className="btn">Mark as sent</button></div></div>
        </form>
      )}
      {(canWork || canPost) && r.status === "sent" && (
        <div className="card"><h2>Supplier&apos;s answer</h2>
          <div className="grid2">
            {canPost && <form action={claimStepAction} className="stack">{hidden}<input type="hidden" name="step" value="credit" />
              <h3>Credit note</h3>
              <div className="field"><label>Supplier credit note no.</label><input name="supplier_ref" required /></div>
              <div className="row"><div className="field"><label>Amount before VAT (AED)</label><input name="credit_amount" inputMode="decimal" required /></div>
                <div className="field"><label>VAT (blank = 5%)</label><input name="credit_vat" inputMode="decimal" /></div></div>
              <div className="field"><label>Note</label><input name="outcome_note" /></div>
              <ConfirmButton className="btn green" message="Post the supplier credit? It reduces what we owe the supplier.">Record credit</ConfirmButton>
            </form>}
            {canWork && <form action={claimStepAction} className="stack">{hidden}<input type="hidden" name="step" value="replace" />
              <h3>Replacement part</h3>
              <p className="small muted">The new part goes into stock.</p>
              <div className="field"><label>Supplier reference</label><input name="supplier_ref" /></div>
              <div className="field"><label>Note</label><input name="outcome_note" /></div>
              <ConfirmButton className="btn green" message={`Receive ${D(r.qty).toString()} replacement ${r.part_no} into stock?`}>Replacement received</ConfirmButton>
            </form>}
            {canWork && <form action={claimStepAction} className="stack">{hidden}<input type="hidden" name="step" value="reject" />
              <h3>Rejected</h3>
              <div className="field"><label>Why the supplier rejected it</label><input name="outcome_note" required /></div>
              <div className="field"><label>Supplier reference</label><input name="supplier_ref" /></div>
              <ConfirmButton className="btn ghost red-text" message="Record the claim as rejected?">Record rejection</ConfirmButton>
            </form>}
          </div>
        </div>
      )}
      <RecordHistory rows={await docHistory(ctx, "supplier_claim", id)} />
    </>
  );
}
