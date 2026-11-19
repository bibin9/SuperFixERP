"use client";
import { useState } from "react";

type C = { group_name: string; name_en: string };

/** Complaints picked from the master list (as chips) plus the customer's own words; saved as one text. */
export function ComplaintPicker({ list, name = "complaints", defaultValue = "", required = false }: { list: C[]; name?: string; defaultValue?: string; required?: boolean }) {
  const known = new Set(list.map((c) => c.name_en));
  const parts = defaultValue.split(/\.\s+|\n/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
  const [chips, setChips] = useState<string[]>(parts.filter((p) => known.has(p)));
  const [notes, setNotes] = useState(parts.filter((p) => !known.has(p)).join(". "));
  const groups = [...new Set(list.map((c) => c.group_name))];
  const value = [...chips, notes.trim()].filter(Boolean).join(". ");
  return (
    <div className="cpick">
      <input type="hidden" name={name} value={value} />
      <select value="" onChange={(e) => { const v = e.target.value; if (v && !chips.includes(v)) setChips([...chips, v]); }} aria-label="Choose a complaint" required={required && !value}>
        <option value="">+ Choose a complaint…</option>
        {groups.map((g) => <optgroup key={g} label={g}>{list.filter((c) => c.group_name === g).map((c) => <option key={c.name_en} value={c.name_en} disabled={chips.includes(c.name_en)}>{c.name_en}</option>)}</optgroup>)}
      </select>
      {chips.length > 0 && <div className="cchips">{chips.map((c) => <span key={c} className="cchip">{c}<button type="button" onClick={() => setChips(chips.filter((x) => x !== c))} aria-label={`Remove ${c}`}>×</button></span>)}</div>}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Extra notes in the customer's words (optional)" rows={2} aria-label="Extra notes in the customer's words" />
    </div>
  );
}
