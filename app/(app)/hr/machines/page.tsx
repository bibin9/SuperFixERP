import { requireCtx } from "@/lib/session";
import { listDevices } from "@/lib/services/punch-devices";
import { hrLookups } from "@/lib/services/hr";
import { can } from "@/lib/access";
import { addDeviceAction, deviceActiveAction, deviceKeyAction } from "@/app/actions-hr";
import { DeviceKey } from "@/components/DeviceKey";
import { Flash, PageHead } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

/** Punching machines per branch: online or offline, last sync, punches today, and their sync keys. */
export default async function Machines({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const list = await listDevices(ctx);
  const l = await hrLookups(ctx);
  const mine = l.branches.filter((b) => can(ctx, "hr", "edit", b.id));
  const on = list.filter((d) => d.active && d.online).length, act = list.filter((d) => d.active).length;
  return (
    <>
      <PageHead title="Punching machines" sub="Each machine sends its punches here by itself. A machine that has sent nothing for 30 minutes shows as offline." />
      <HrTabs group="hr" at="/hr/machines" />
      <Flash sp={sp} />
      <div className="grid4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="kpi"><div className="v">{on} / {act}</div><div className="l">Machines online</div></div>
        <div className="kpi"><div className="v">{list.reduce((s, d) => s + d.today, 0)}</div><div className="l">Punches today from machines</div></div>
        <div className="kpi"><div className="v" style={act - on ? { color: "var(--late)" } : undefined}>{act - on}</div><div className="l">Offline or never synced</div></div>
      </div>
      <div className="card">
        <table><thead><tr><th>Machine</th><th>Branch</th><th>Status</th><th>Last sync</th><th className="num">Punches today</th><th>Sync key</th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.id}><td><b>{d.code}</b><div className="small muted">{d.name}{d.model ? ` · ${d.model}` : ""}</div></td><td>{d.branch_code}</td>
              <td>{!d.active ? <span className="pill grey">Switched off</span> : d.online ? <span className="pill green">Online</span> : <span className="pill red">Offline</span>}</td>
              <td className="small">{d.last_sync ?? "Never"}{d.last_sync_count != null ? ` · ${d.last_sync_count} new` : ""}</td><td className="num">{d.today}</td>
              <td>{d.manage && d.active ? <DeviceKey id={d.id} hasKey={d.has_key} action={deviceKeyAction} /> : d.has_key ? "Set" : "Not set"}</td>
              <td>{d.manage && <form action={deviceActiveAction}><input type="hidden" name="device_id" value={d.id} /><input type="hidden" name="active" value={d.active ? "0" : "1"} /><button className="btn ghost sm">{d.active ? "Switch off" : "Switch on"}</button></form>}</td></tr>))}
          </tbody></table>
        {!list.length && <p className="muted small">No machines yet.</p>}
      </div>
      <div className="grid2">
        {mine.length > 0 && <div className="card"><h2>Add a machine</h2>
          <form action={addDeviceAction}>
            <div className="row">
              <div className="field"><label htmlFor="mb">Branch</label><select id="mb" name="branch_id" required defaultValue={ctx.currentBranchId ?? ""}>{mine.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}</select></div>
              <div className="field"><label htmlFor="mc">Machine code</label><input id="mc" name="code" required placeholder="YAS-ZK2" pattern="[A-Za-z0-9-]{2,20}" /></div>
              <div className="field"><label htmlFor="mn">Name</label><input id="mn" name="name" required placeholder="Workshop back door" /></div>
              <div className="field"><label htmlFor="mm">Model</label><input id="mm" name="model" placeholder="ZKTeco K40" /></div>
            </div>
            <button className="btn sm">Add machine</button>
          </form></div>}
        <div className="card"><h2>How a machine sends punches</h2>
          <p className="small">Press <b>Make key</b> and type the key into the machine&apos;s cloud or push settings (or the small sync program on the branch PC). The machine then sends every punch to:</p>
          <p className="small"><code>POST /api/punch</code> with the header <code>Authorization: Bearer &lt;key&gt;</code></p>
          <p className="small muted">The punches can be JSON (<code>{`{"punches":[{"emp_no":"E0012","at":"2026-11-19 07:58"}]}`}</code>) or a CSV with &quot;Employee no&quot; and &quot;Date time&quot; columns. Punches already received are skipped, so a machine that was offline can send everything again. If a machine cannot send, export a CSV from it and use <b>Import from the biometric device</b> on Attendance.</p>
        </div>
      </div>
    </>
  );
}
