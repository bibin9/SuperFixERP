"use client";
import { useEffect, useRef, useState } from "react";

/** Customer signature on the delivery form; sent as a PNG data URL in a hidden field. */
export function SignaturePad({ name = "signature" }: { name?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState("");
  const drawing = useRef(false);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
    const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    const down = (e: PointerEvent) => { drawing.current = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!drawing.current) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
    const up = () => { if (!drawing.current) return; drawing.current = false; setData(cv.toDataURL("image/png")); };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointerleave", up);
    return () => { cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); cv.removeEventListener("pointerleave", up); };
  }, []);
  const clear = () => { const cv = ref.current!; cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height); setData(""); };
  return (
    <div>
      <canvas ref={ref} width={480} height={140} className="sigpad" aria-label="Customer signature" />
      <input type="hidden" name={name} value={data} />
      <div className="row"><span className="small muted">{data ? "Signed" : "Ask the customer to sign above"}</span><button type="button" className="btn ghost sm shrink" onClick={clear}>Clear</button></div>
    </div>
  );
}
