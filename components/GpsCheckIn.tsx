"use client";
import { useRef, useState } from "react";

/** Check-in with the phone's location: asks the browser for it, then sends the form. */
export function GpsCheckIn({ action, back }: { action: (fd: FormData) => Promise<void>; back: string }) {
  const form = useRef<HTMLFormElement>(null);
  const lat = useRef<HTMLInputElement>(null), lng = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const go = () => {
    if (!navigator.geolocation) { setMsg("This browser cannot share your location. Scan the branch QR code instead."); return; }
    setMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => { lat.current!.value = String(p.coords.latitude); lng.current!.value = String(p.coords.longitude); form.current!.requestSubmit(); },
      () => setMsg("Location was not shared. Allow location for this site, or scan the branch QR code."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <form ref={form} action={action}>
      <input type="hidden" name="$back" value={back} /><input type="hidden" name="lat" ref={lat} /><input type="hidden" name="lng" ref={lng} />
      <button type="button" className="btn green" onClick={go}>Check in or out here</button>
      {msg && <p className="small muted" role="status">{msg}</p>}
    </form>
  );
}
