import { requireCtx } from "@/lib/session";
import { techTimeline, type Seg } from "@/lib/services/workshop";
import { Flash, Link, PageHead } from "@/components/ui";

const FROM_H = 7, TO_H = 20;
const hm = (ms: number) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const todayDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const clock = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(ms));

export default async function TechTime({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day : todayDubai();
  const t = await techTimeline(ctx, day);
  // The axis is the normal working day, widened to cover any early or late clocking.
  const all = t.techs.flatMap((x) => x.segs);
  const H = 3600000;
  const fromH = Math.min(FROM_H, ...all.map((s) => Math.floor((s.from - t.start) / H)));
  const toH = Math.max(TO_H, ...all.map((s) => Math.ceil((s.to - t.start) / H)));
  const a = t.start + fromH * H, z = t.start + toH * H;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - a) / (z - a)) * 100));
  const isToday = day === todayDubai();
  const maxPause = Math.max(1, ...t.pauses.map(([, v]) => v));
  return (
    <>
      <PageHead title={`Technician time${isToday ? ", today" : ""}`} sub="Every clock in, pause and clock out at this branch, against the standard time of each job line.">
        <Link className="btn ghost sm" href={`/workshop/time?day=${shift(day, -1)}`}>Previous day</Link>
        <form action="/workshop/time" className="row" style={{ margin: 0 }}><input type="date" name="day" defaultValue={day} aria-label="Day" /><button className="btn ghost sm shrink">Show</button></form>
        {!isToday && <Link className="btn ghost sm" href="/workshop/time">Today</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="grid4">
        <div className="kpi"><div className="v">{t.kpi.eff === null ? "—" : `${t.kpi.eff}%`}</div><div className="l">Workshop efficiency (standard ÷ actual, finished lines)</div></div>
        <div className="kpi"><div className="v">{hm(t.kpi.worked)}</div><div className="l">Hours clocked · standard booked {hm(t.kpi.stdBooked)}</div></div>
        <div className="kpi"><div className="v">{hm(t.kpi.paused)}</div><div className="l">Paused time{t.pauses[0] ? ` · mostly ${t.pauses[0][0].toLowerCase()}` : ""}</div></div>
        <div className="kpi"><div className="v" style={{ color: t.kpi.over ? "var(--late)" : undefined }}>{t.kpi.over}</div><div className="l">Job lines over standard</div></div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h2 style={{ margin: 0 }}>Timeline</h2>
          <div className="tl-legend small"><span><i className="ok" />Within standard</span><span><i className="near" />Near standard (85%)</span><span><i className="over" />Over standard</span><span><i className="pause" />Paused</span></div></div>
        <div className="tl">
          <div className="tl-axis"><div /><div className="tl-ticks">{Array.from({ length: toH - fromH + 1 }, (_, i) => <span key={i} style={{ left: `${(i / (toH - fromH)) * 100}%` }}>{String(fromH + i).padStart(2, "0")}:00</span>)}</div></div>
          {t.techs.map((x) => (
            <div key={x.id} className="tl-row">
              <div className="tl-who"><span className="avatar sm">{initials(x.full_name)}</span><div><b>{x.full_name}</b><div className="small muted">{x.eff === null ? "no finished lines" : `${x.eff}% efficiency`}</div></div></div>
              <div className="tl-track">
                {Array.from({ length: toH - fromH }, (_, i) => <i key={i} className="tl-grid" style={{ left: `${((i + 1) / (toH - fromH)) * 100}%` }} />)}
                {x.segs.map((s: Seg, i: number) => (
                  <Link key={i} href={`/jobs/${s.jobId}`} className={`tl-seg ${s.kind === "pause" ? "pause" : s.tone}`} style={{ left: `${pct(s.from)}%`, width: `${Math.max(0.4, pct(s.to) - pct(s.from))}%` }}
                    title={`${s.job} · ${s.line} · ${clock(s.from)} to ${clock(s.to)}${s.kind === "pause" ? ` · paused: ${s.reason ?? ""}` : ""}`}>
                    <span>{s.kind === "pause" ? `❚❚ ${s.reason ?? "Paused"}` : `${s.job} · ${s.line}`}</span></Link>
                ))}
                {isToday && t.now > a && t.now < z && <i className="tl-now" style={{ left: `${pct(t.now)}%` }} />}
              </div>
            </div>
          ))}
          {!t.techs.length && <p className="muted">No technicians at this branch.</p>}
        </div>
      </div>
      <div className="grid2">
        <div className="card"><h2>Efficiency by technician</h2>
          {t.techs.map((x) => <div key={x.id} className="barrow"><span>{x.full_name}</span><div className="bar"><i className={x.eff === null ? "" : x.eff >= 100 ? "ok" : x.eff >= 85 ? "near" : "over"} style={{ width: `${Math.min(100, x.eff ?? 0)}%` }} /></div><b>{x.eff === null ? "—" : `${x.eff}%`}</b></div>)}
          <p className="small muted">Finished lines only. 100% is exactly the standard time; above 100% is faster than standard.</p></div>
        <div className="card"><h2>Paused time by reason</h2>
          {t.pauses.map(([r, v]) => <div key={r} className="barrow"><span>{r}</span><div className="bar"><i className="pause" style={{ width: `${(v / maxPause) * 100}%` }} /></div><b>{hm(v)}</b></div>)}
          {!t.pauses.length && <p className="muted small">No pauses on this day.</p>}
          <p className="small muted">Technicians choose the reason when they press Pause on My jobs.</p></div>
      </div>
    </>
  );
}
