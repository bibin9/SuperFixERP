/**
 * Small server-rendered SVG charts for reports (RB-06): one-series bar and line, and pie for shares.
 * The report table under the chart is always the table view. Each mark carries a hover title.
 * Palette: the validated categorical order (blue, orange, aqua, yellow, magenta, green, violet, red);
 * one-series charts use slot 1 only. A ninth slice folds into "Other".
 */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const words = (v: string) => (/^[a-z]+(_[a-z]+)*$/.test(v) ? v.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : v);

export type ChartPoint = { label: string; value: number };

export function ReportChart({ type, points, title, valueLabel }: { type: "bar" | "line" | "pie"; points: ChartPoint[]; title: string; valueLabel: string }) {
  const pts = points.filter((p) => Number.isFinite(p.value)).map((p) => ({ ...p, label: words(p.label || "(blank)") }));
  if (!pts.length) return <p className="small muted">Nothing to chart for these filters.</p>;
  if (type === "pie") return <Pie pts={pts} title={title} valueLabel={valueLabel} />;
  const shown = pts.slice(0, 40);
  const W = 720, H = 260, L = 56, B = 64, T = 14, R = 12;
  const max = Math.max(0, ...shown.map((p) => p.value)), min = Math.min(0, ...shown.map((p) => p.value));
  const span = max - min || 1;
  const y = (v: number) => T + ((max - v) / span) * (H - T - B);
  const step = (W - L - R) / shown.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
  return (
    <figure className="chart" aria-label={`${title}: ${type} chart of ${valueLabel}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" width="100%" style={{ maxWidth: W }}>
        <title>{`${title}, ${valueLabel}`}</title>
        {ticks.map((t, i) => (
          <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e3e8ef" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#64748b">{fmt(t)}</text></g>
        ))}
        {type === "bar" && shown.map((p, i) => {
          const bw = Math.max(4, Math.min(48, step - 4)), x = L + i * step + (step - bw) / 2, top = y(Math.max(0, p.value)), h = Math.max(1, Math.abs(y(p.value) - y(0)));
          const r = Math.min(4, bw / 2, h);
          const d = p.value >= 0
            ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`
            : `M${x},${y(0)} V${y(0) + h - r} Q${x},${y(0) + h} ${x + r},${y(0) + h} H${x + bw - r} Q${x + bw},${y(0) + h} ${x + bw},${y(0) + h - r} V${y(0)} Z`;
          return <g key={i} className="mark"><rect x={L + i * step} y={T} width={step} height={H - T - B} fill="transparent"><title>{`${p.label}: ${fmt(p.value)}`}</title></rect>
            <path d={d} fill={SERIES[0]}><title>{`${p.label}: ${fmt(p.value)}`}</title></path>
            {shown.length <= 12 && <text x={x + bw / 2} y={(p.value >= 0 ? top : y(0) + h + 10) - 4} textAnchor="middle" fontSize={10} fill="#334155">{fmt(p.value)}</text>}</g>;
        })}
        {type === "line" && (<>
          <polyline fill="none" stroke={SERIES[0]} strokeWidth={2} points={shown.map((p, i) => `${L + i * step + step / 2},${y(p.value)}`).join(" ")} />
          {shown.map((p, i) => <circle key={i} cx={L + i * step + step / 2} cy={y(p.value)} r={4} fill={SERIES[0]} stroke="#fff" strokeWidth={2}><title>{`${p.label}: ${fmt(p.value)}`}</title></circle>)}
        </>)}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
        {shown.map((p, i) => (shown.length <= 16 || i % Math.ceil(shown.length / 16) === 0) && (
          <text key={i} x={L + i * step + step / 2} y={H - B + 14} fontSize={10} fill="#64748b" textAnchor="end" transform={`rotate(-35 ${L + i * step + step / 2} ${H - B + 14})`}>{p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}</text>
        ))}
      </svg>
      {pts.length > shown.length && <figcaption className="small muted">Chart shows the first {shown.length} of {pts.length}; the table has them all.</figcaption>}
    </figure>
  );
}

function Pie({ pts, title, valueLabel }: { pts: ChartPoint[]; title: string; valueLabel: string }) {
  const pos = pts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const slices = pos.length > 8 ? [...pos.slice(0, 7), { label: "Other", value: pos.slice(7).reduce((s, p) => s + p.value, 0) }] : pos;
  const total = slices.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="small muted">Nothing to chart for these filters.</p>;
  const R = 90, C = 100;
  let a = -Math.PI / 2;
  return (
    <figure className="chart pie" aria-label={`${title}: share of ${valueLabel}`}>
      <svg viewBox="0 0 200 200" width={200} height={200} role="img"><title>{`${title}, share of ${valueLabel}`}</title>
        {slices.map((p, i) => {
          const sweep = (p.value / total) * Math.PI * 2, a2 = a + sweep;
          const d = slices.length === 1 ? `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0`
            : `M${C},${C} L${C + R * Math.cos(a)},${C + R * Math.sin(a)} A${R},${R} 0 ${sweep > Math.PI ? 1 : 0},1 ${C + R * Math.cos(a2)},${C + R * Math.sin(a2)} Z`;
          a = a2;
          return <path key={i} d={d} fill={SERIES[i]} stroke="#fff" strokeWidth={2}><title>{`${p.label}: ${fmt(p.value)} (${Math.round((p.value / total) * 1000) / 10}%)`}</title></path>;
        })}
      </svg>
      <ul className="legend">{slices.map((p, i) => <li key={i}><span className="sw" style={{ background: SERIES[i] }} />{p.label} <b>{fmt(p.value)}</b> <span className="muted">{Math.round((p.value / total) * 1000) / 10}%</span></li>)}</ul>
    </figure>
  );
}
