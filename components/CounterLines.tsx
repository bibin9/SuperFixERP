"use client";
import { useState } from "react";
import { ScanBox } from "@/components/ScanBox";
import { matchCode } from "@/lib/scan-match";

type Item = { id: string; part_no: string; description: string; gross: string; free: string; codes?: string };

/** Counter-sale lines with a live VAT-inclusive total; the server prices and checks every line again. */
export function CounterLines({ items, rows = 6 }: { items: Item[]; rows?: number }) {
  const [lines, setLines] = useState(Array.from({ length: rows }, () => ({ item: "", qty: "1", price: "", discount: "" })));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const set = (k: number, f: string, v: string) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, [f]: v } : l)));
  const lineTotal = (l: (typeof lines)[number]) => {
    const it = byId[l.item];
    if (!it) return 0;
    const unit = l.price ? Number(l.price) : Number(it.gross);
    return Math.round((Number(l.qty || 0) * unit - Number(l.discount || 0)) * 100) / 100;
  };
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  // A scan adds one to the line that already has the part, else fills the first empty line.
  const scan = (code: string) => {
    const it = matchCode(code, items);
    if (!it) return `No part with code ${code}. Check the code, or add the barcode to the part.`;
    const at = lines.findIndex((l) => l.item === it.id);
    if (at >= 0) { set(at, "qty", String(Number(lines[at].qty || 0) + 1)); return `${it.part_no}: quantity ${Number(lines[at].qty || 0) + 1}`; }
    const free = lines.findIndex((l) => !l.item);
    if (free >= 0) setLines((ls) => ls.map((l, i) => (i === free ? { ...l, item: it.id, qty: "1" } : l)));
    else setLines((ls) => [...ls, { item: it.id, qty: "1", price: "", discount: "" }]);
    return `Added ${it.part_no} · ${it.description}`;
  };
  return (
    <>
      <ScanBox onCode={scan} />
      <table>
        <thead><tr><th>Item</th><th className="num">Free stock</th><th>Qty</th><th>Price incl. VAT</th><th>Discount (AED)</th><th className="num">Line total</th></tr></thead>
        <tbody>{lines.map((l, k) => (
          <tr key={k}>
            <td><select name="item_id" value={l.item} onChange={(e) => set(k, "item", e.target.value)} aria-label={`Item ${k + 1}`}>
              <option value="">Choose an item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.part_no} · {i.description} · AED {i.gross}</option>)}</select></td>
            <td className="num">{byId[l.item] ? Number(byId[l.item].free).toString() : ""}</td>
            <td><input name="qty" value={l.qty} onChange={(e) => set(k, "qty", e.target.value)} inputMode="decimal" style={{ width: 70 }} aria-label={`Quantity ${k + 1}`} /></td>
            <td><input name="price" value={l.price} placeholder={byId[l.item]?.gross ?? ""} onChange={(e) => set(k, "price", e.target.value)} inputMode="decimal" style={{ width: 100 }} aria-label={`Price ${k + 1}`} /></td>
            <td><input name="discount" value={l.discount} onChange={(e) => set(k, "discount", e.target.value)} inputMode="decimal" style={{ width: 90 }} aria-label={`Discount ${k + 1}`} /></td>
            <td className="num">{l.item ? lineTotal(l).toFixed(2) : ""}</td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={5}>Total incl. VAT (AED)</td><td className="num" data-testid="counter-total">{total.toFixed(2)}</td></tr></tfoot>
      </table>
    </>
  );
}
