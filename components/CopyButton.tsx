"use client";
import { useState } from "react";

/** Copies prepared text so staff can paste it into any app themselves (manual messaging). */
export function CopyButton({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); }}>
      {done ? "Copied" : label}
    </button>
  );
}
