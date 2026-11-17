import { requireCtx } from "@/lib/session";
import { listRuns, runOptions, canEditRuns, canViewRuns } from "@/lib/services/runs";
import { canSee } from "@/lib/access";
import { forbidden } from "@/lib/errors";
import { Flash, PageHead } from "@/components/ui";
import { RunForm, RunsTable } from "@/components/RunsPanel";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!canViewRuns(ctx, ctx.currentBranchId)) throw forbidden();
  const { rows, drivers } = await listRuns(ctx, { driver: sp.driver, type: sp.type, status: sp.status ?? "open", from: sp.from, to: sp.to });
  const b = ctx.currentBranchId;
  const edit = !!b && canEditRuns(ctx, b);
  const staff = edit ? (await runOptions(ctx, b!)).drivers : [];
  const qs = new URLSearchParams(Object.entries(sp).filter(([k]) => !["ok", "err", "errf"].includes(k))).toString();
  const back = `/workshop/runs${qs ? `?${qs}` : ""}`;
  const km = rows.filter((r) => r.status === "completed").reduce((a, r) => a + Number(r.distance_km ?? 0), 0);
  return (
    <>
      <PageHead title="Pickup, drop-off and recovery runs" sub="Every driver's runs: from where, to where, when, and how far" />
      <Flash sp={sp} />
      <form className="card row" style={{ alignItems: "end" }}>
        <div className="field"><label htmlFor="f-driver">Driver</label><AutoSubmitSelect id="f-driver" name="driver" defaultValue={sp.driver ?? ""}><option value="">All drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</AutoSubmitSelect></div>
        <div className="field"><label htmlFor="f-type">Type</label><AutoSubmitSelect id="f-type" name="type" defaultValue={sp.type ?? ""}><option value="">All types</option><option value="pickup">Pickup</option><option value="drop_off">Drop-off</option><option value="recovery">Recovery</option><option value="towing">Towing</option></AutoSubmitSelect></div>
        <div className="field"><label htmlFor="f-status">Status</label><AutoSubmitSelect id="f-status" name="status" defaultValue={sp.status ?? "open"}><option value="open">Not done yet</option><option value="">All</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></AutoSubmitSelect></div>
        <div className="field"><label htmlFor="f-from">From day</label><input id="f-from" type="date" name="from" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="f-to">To day</label><input id="f-to" type="date" name="to" defaultValue={sp.to ?? ""} /></div>
        <button className="btn sm shrink">Show</button>
      </form>
      <div className="card"><h2>{rows.length} run{rows.length === 1 ? "" : "s"}{km ? ` · ${km.toFixed(1)} km completed` : ""}</h2>
        <RunsTable rows={rows} back={back} canEdit={edit} prices={canSee(ctx, "selling_price", b)} />
      </div>
      {edit && (
        <div className="card"><h2>Schedule a run not linked to an enquiry</h2>
          <p className="small muted">For a run that belongs to a customer&apos;s visit, schedule it from the enquiry or the job card, so its charge can go on the bill.</p>
          <RunForm back={back} drivers={staff} canCharge={false} />
        </div>
      )}
    </>
  );
}
