"use client";
import { useEffect, useRef } from "react";

/** On a bay tablet: lock (sign out to the names screen) after the idle time with no touch or key. */
export function IdleLock({ minutes, action }: { minutes: number; action: () => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let t = setTimeout(() => form.current?.requestSubmit(), minutes * 60_000);
    const reset = () => { clearTimeout(t); t = setTimeout(() => form.current?.requestSubmit(), minutes * 60_000); };
    const ev = ["pointerdown", "keydown", "scroll", "touchstart"];
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, reset)); };
  }, [minutes]);
  return <form ref={form} action={action} style={{ display: "inline" }}><button className="btn ghost sm">Lock</button></form>;
}
