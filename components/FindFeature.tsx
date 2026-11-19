"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

export type Feature = { k: "Screen" | "How to"; t: string; d: string; href: string; text: string };

/** "Find a feature": type any word and jump to the screen or the guide page. Ctrl+K or ? opens it anywhere. */
export function FindFeature({ items }: { items: Feature[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      else if (e.key === "?" && !typing) { e.preventDefault(); setOpen(true); }
      else if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (open) { setAt(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);
  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items.filter((x) => x.k === "Screen").slice(0, 10);
    return items.map((x) => {
      const T = x.t.toLowerCase(), D = x.text.toLowerCase();
      let s = 0;
      for (const w of words) { if (T.includes(w)) s += 3; else if (D.includes(w)) s += 1; else return null; }
      return [s + (x.k === "Screen" ? 1 : 0), x] as const;
    }).filter((r): r is readonly [number, Feature] => r !== null).sort((a, b) => b[0] - a[0]).map((r) => r[1]).slice(0, 12);
  }, [q, items]);
  const go = (x: Feature) => { setOpen(false); setQ(""); router.push(x.href); };
  return (
    <>
      <button type="button" className="findbtn" onClick={() => setOpen(true)} title="Find any feature (Ctrl+K)"><Icon name="search" size={16} /> <span>Find a feature</span></button>
      {open && (
        <div className="ff-back" onClick={() => setOpen(false)}>
          <div className="ff" role="dialog" aria-modal="true" aria-label="Find a feature" onClick={(e) => e.stopPropagation()}>
            <div className="ff-h"><div><small>Type any word · opens the right screen or the guide</small><h2>Find a feature</h2></div><button type="button" className="ff-x" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            <div className="bigsearch" style={{ margin: 0 }}><Icon name="search" size={18} className="sicon" />
              <input ref={input} value={q} placeholder="e.g. revised quotation, WPS, credit note, bank, low stock…" aria-label="What are you looking for?" autoComplete="off"
                onChange={(e) => { setQ(e.target.value); setAt(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, found.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter" && found[at]) { e.preventDefault(); go(found[at]); }
                }} />
            </div>
            <div className="ff-list">
              {found.length ? found.map((x, i) => (
                <button type="button" key={x.k + x.href + x.t} className={`ff-row${i === at ? " on" : ""}`} onMouseEnter={() => setAt(i)} onClick={() => go(x)}>
                  <span className={`pill ${x.k === "Screen" ? "" : "violet"}`}>{x.k}</span>
                  <span className="ff-t"><b>{x.t}</b><small>{x.d}</small></span><Icon name="arrow" size={16} />
                </button>
              )) : <p className="muted small" style={{ padding: 12 }}>Nothing found for “{q}”. Try a simpler word, like <b>invoice</b>, <b>WPS</b> or <b>stock</b>.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
