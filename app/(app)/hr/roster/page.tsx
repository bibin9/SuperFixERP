import { requireCtx } from "@/lib/session";
import { rosterWeek, DAYS } from "@/lib/services/hr-time";
import { today } from "@/lib/services/hr";
import { addDays } from "@/lib/services/payroll-calc";
import { can } from "@/lib/access";
import { forbidden } from "@/lib/errors";
import { saveRosterAction } from "@/app/actions-hr";
import { Flash, Link, PageHead, d } from "@/components/ui";
import { HrTabs } from "@/components/HrTabs";

export default async function Roster({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const b = ctx.currentBranchId;
  if (!b) throw forbidden("Choose a branch at the top first.");
  const t = today();
  const dow = new Date(`${t}T00:00:00Z`).getUTCDay();
  const thisWeek = addDays(t, -((dow + 1) % 7)); // weeks start on Saturday
  const week = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week : thisWeek;
  const r = await rosterWeek(ctx, b, week);
  const edit = can(ctx, "hr", "edit", b) || can(ctx, "hr", "approve", b);
  return (
    <>
      <PageHead title="Roster" sub="Shifts per day for the branch chosen at the top. A cell left as planned uses the employee's own shift and day off.">
        <Link className="btn ghost sm" href={`/hr/roster?week=${addDays(week, -7)}`}>Previous week</Link><Link className="btn ghost sm" href={`/hr/roster?week=${addDays(week, 7)}`}>Next week</Link>
      </PageHead>
      <HrTabs group="hr" at="/hr/roster" />
      <Flash sp={sp} />
      <form className="card" action={saveRosterAction}>
        <input type="hidden" name="branch_id" value={b} /><input type="hidden" name="$back" value={`/hr/roster?week=${week}`} />
        <h2>Week from {d(week)}</h2>
        <table><thead><tr><th>Employee</th>{r.days.map((x) => <th key={x}>{DAYS[new Date(`${x}T00:00:00Z`).getUTCDay()].slice(0, 3)} {x.slice(8)}{r.hols.find((h) => h.d === x) ? " ★" : ""}</th>)}</tr></thead>
          <tbody>{r.emps.map((e) => (
            <tr key={e.id}><td>{e.emp_no} {e.full_name}</td>{e.cells.map((c: { value: string; planned: boolean }, i: number) => (
              <td key={i}>{edit ? <select name={`cell[${e.id}|${r.days[i]}]`} defaultValue={c.planned ? c.value : ""} aria-label={`${e.full_name} ${r.days[i]}`} style={{ minWidth: 92 }}>
                <option value="">{c.value === "off" ? "Day off" : r.shifts.find((s) => s.id === c.value)?.code ?? "—"} (usual)</option>
                {r.shifts.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}<option value="off">Day off</option></select>
                : <span>{c.value === "off" ? "Off" : r.shifts.find((s) => s.id === c.value)?.code ?? "—"}</span>}</td>))}</tr>))}
          </tbody></table>
        {r.hols.length > 0 && <p className="small muted">★ Public holiday: {r.hols.map((h) => `${d(h.d)} ${h.name}`).join(", ")}</p>}
        {edit && <button className="btn">Save roster</button>}
      </form>
    </>
  );
}
