"use client";
import { useRef, useState } from "react";

/** Big number keys for the bay tablet. The form is sent as soon as 4 digits are typed. */
export function PinPad({ userId, action }: { userId: string; action: (fd: FormData) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const press = (k: string) => {
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) setTimeout(() => form.current?.requestSubmit(), 60);
  };
  return (
    <form ref={form} action={action} className="pinpad">
      <input type="hidden" name="user_id" value={userId} />
      <input type="password" name="pin" value={pin} readOnly inputMode="numeric" aria-label="PIN" className="vh" />
      <div className="pindots" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? "on" : ""} />)}</div>
      <div className="pinkeys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => k
          ? <button key={i} type="button" onClick={() => press(k)} aria-label={k === "⌫" ? "Delete" : k}>{k}</button>
          : <span key={i} />)}
      </div>
    </form>
  );
}
