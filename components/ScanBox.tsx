"use client";
import { useEffect, useRef, useState } from "react";
import { matchCode } from "@/lib/scan-match";

type Mode = "select" | "count";

/**
 * IN-07 / UX-03: scan or type a barcode or part number. A USB or Bluetooth scanner types the code and
 * presses Enter, so this is a plain input; on a phone the camera button reads the barcode where the
 * browser can. In "select" mode the part is chosen in the nearest item picker (the closest element
 * marked data-scan-scope, else the form). In "count" mode the matching count line goes up by one.
 * `onCode` lets a component with its own state (the counter sale) handle the code itself.
 */
export function ScanBox({ mode = "select", onCode, label = "Scan or type a barcode or part no." }: { mode?: Mode; onCode?: (code: string) => string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [canCamera, setCanCamera] = useState(false);
  useEffect(() => { setCanCamera(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia); }, []);

  function handle(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const el = ref.current!;
    let text: string;
    let ok = true;
    if (onCode) {
      text = onCode(code);
      ok = !text.startsWith("No ");
    } else if (mode === "count") {
      const rows = Array.from(el.closest("form")?.querySelectorAll<HTMLTableRowElement>("tr[data-codes]") ?? []);
      const hit = matchCode(code, rows.map((r) => ({ codes: r.dataset.codes, part_no: r.dataset.part, r })));
      if (hit) {
        const input = hit.r.querySelector<HTMLInputElement>("input[name^='qty[']");
        if (input) { input.value = String(Math.round(((Number(input.value) || 0) + 1) * 1000) / 1000); }
        hit.r.classList.remove("scanhit"); void hit.r.offsetWidth; hit.r.classList.add("scanhit");
        hit.r.scrollIntoView({ block: "nearest" });
        text = `${hit.part_no}: counted ${input?.value ?? ""}`;
      } else { ok = false; text = `No part with code ${code} on this count.`; }
    } else {
      const scope = el.closest("[data-scan-scope]") ?? el.closest("form");
      const select = scope?.querySelector<HTMLSelectElement>("select[name='item_id']");
      const opts = Array.from(select?.options ?? []).filter((o) => o.value);
      const hit = matchCode(code, opts.map((o) => ({ codes: o.dataset.codes, part_no: o.text.split(" · ")[0], o })));
      if (select && hit) {
        select.value = hit.o.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        text = `Picked ${hit.o.text}`;
      } else { ok = false; text = `No part with code ${code}. Check the code, or add the barcode to the part.`; }
    }
    setMsg({ ok, text });
    el.value = "";
    el.focus();
  }

  return (
    <div className="scanbox">
      <div className="picker">
        <input ref={ref} type="search" enterKeyHint="go" autoComplete="off" aria-label={label} placeholder={label} data-scan
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handle(e.currentTarget.value); } }} />
        {canCamera && <button type="button" className="btn ghost sm" onClick={() => setCamera(true)} aria-label="Scan with the camera">Camera</button>}
      </div>
      {msg && <div className={`small ${msg.ok ? "muted" : "red-text"}`} role="status">{msg.text}</div>}
      {camera && <CameraScan onClose={() => setCamera(false)} onCode={(c) => { setCamera(false); handle(c); }} />}
    </div>
  );
}

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

function CameraScan({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stop) return;
        video.current!.srcObject = stream;
        await video.current!.play();
        const Ctor = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
        const det = new Ctor();
        while (!stop) {
          const found = await det.detect(video.current!).catch(() => []);
          if (found[0]?.rawValue) { cb.current(found[0].rawValue); return; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setErr("The camera could not be opened. Type the code instead."); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="scancam">
      {err ? <p className="small red-text">{err}</p> : <video ref={video} muted playsInline />}
      <button type="button" className="btn ghost sm" onClick={onClose}>Close the camera</button>
    </div>
  );
}
