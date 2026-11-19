"use client";
import { useEffect, useRef, useState } from "react";

/** Finger or mouse signature. The drawing is kept as a PNG in a hidden field and sent with the form. */
export function SignaturePad({ name = "signature" }: { name?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState("");
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2);
    const g = c.getContext("2d")!; g.scale(2, 2); g.lineWidth = 2.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0f172a";
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const g = ref.current!.getContext("2d")!; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const g = ref.current!.getContext("2d")!; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); };
  const up = () => { if (!drawing.current) return; drawing.current = false; setData(ref.current!.toDataURL("image/png")); };
  const clear = () => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setData(""); };
  return (
    <div className="sigpad">
      <input type="hidden" name={name} value={data} />
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Signature area: sign with a finger or the mouse" />
      <div className="row" style={{ justifyContent: "space-between", margin: "6px 0 0" }}><span className="small muted">{data ? "Signed" : "Sign inside the box"}</span><button type="button" className="btn ghost sm" onClick={clear}>Clear</button></div>
    </div>
  );
}
