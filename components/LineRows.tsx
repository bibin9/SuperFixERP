"use client";
import { useState } from "react";

/** Repeating form rows (item + quantity) with an "Add another" button. Field names repeat, so the server reads them with getAll. */
export function LineRows({ items, qtyName, qtyLabel, qtyHint }: { items: { id: string; part_no: string; description: string }[]; qtyName: string; qtyLabel: string; qtyHint?: string }) {
  const [n, setN] = useState(1);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="row" key={i}>
          <div className="field"><label>Part</label><select name="item_id" defaultValue=""><option value="">Choose a part</option>{items.map((x) => <option key={x.id} value={x.id}>{x.part_no} · {x.description}</option>)}</select></div>
          <div className="field shrink" style={{ width: 140 }}><label>{qtyLabel}</label><input name={qtyName} inputMode="decimal" placeholder={qtyHint} /></div>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => setN(n + 1)}>Add another part</button>
    </>
  );
}
