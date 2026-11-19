"use client";
import { useState } from "react";
import { ZONES, KINDS, type Mark } from "@/lib/checkin";

/** Top view of a car: tap a part to mark it, tap again to change the kind (scratch, dent, broken), a fourth tap clears it. */
export function CarDamage({ name = "damage", initial = [], readOnly = false }: { name?: string; initial?: Mark[]; readOnly?: boolean }) {
  const [marks, setMarks] = useState<Mark[]>(initial);
  const kindOf = (z: string) => marks.find((m) => m.z === z)?.k;
  const tap = (z: string) => {
    if (readOnly) return;
    const k = kindOf(z);
    const i = KINDS.findIndex(([id]) => id === k);
    const next = i < 0 ? KINDS[0][0] : KINDS[i + 1]?.[0];
    setMarks((m) => (next ? [...m.filter((x) => x.z !== z), { z, k: next }] : m.filter((x) => x.z !== z)));
  };
  return (
    <div className="cardiag-wrap">
      <input type="hidden" name={name} value={JSON.stringify(marks)} />
      <svg className="cardiag" viewBox="0 0 320 344" role="group" aria-label="Car diagram, top view">
        {ZONES.map(([id, label, d]) => {
          const k = kindOf(id);
          return (
            <path key={id} d={d} className={`zone${k ? ` hit ${k}` : ""}`} onClick={() => tap(id)} role={readOnly ? undefined : "button"} tabIndex={readOnly ? -1 : 0}
              aria-label={`${label}${k ? `: ${KINDS.find(([x]) => x === k)?.[1]}` : ""}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(id); } }}><title>{label}</title></path>
          );
        })}
        <text x="160" y="202" textAnchor="middle" fontSize="11" fill="#64748b">top view · front up</text>
      </svg>
      <div className="dmg-legend small">{KINDS.map(([id, l]) => <span key={id}><i className={`sw ${id}`} />{l}</span>)}</div>
      <div className="small" style={{ marginTop: 6 }}>{marks.length ? <>Marked: {marks.map((m) => `${ZONES.find(([z]) => z === m.z)?.[1]} (${KINDS.find(([k]) => k === m.k)?.[1].toLowerCase()})`).join(", ")}</> : <span className="muted">No damage marked{readOnly ? "" : ". Tap a part of the car to mark it"}.</span>}</div>
    </div>
  );
}
