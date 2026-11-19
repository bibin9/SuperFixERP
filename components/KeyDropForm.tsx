"use client";
import { useState, useTransition } from "react";
import { SignaturePad } from "./SignaturePad";

/** Phone photos are large: shrink each to at most 1600 px as JPEG before sending (a few hundred KB each). */
async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith("image/")) return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch { return f; }
}

type Res = { ok?: { docNo: string; name: string; branch: string }; err?: string; field?: string };

/** The customer's phone form for the key box: three short steps on one page, nothing lost on a mistake. */
export function KeyDropForm({ code, plates, action }: { code: string; plates: { code: string; name: string }[]; action: (fd: FormData) => Promise<Res> }) {
  const [res, setRes] = useState<Res>({});
  const [busy, start] = useTransition();
  if (res.ok) {
    return (
      <div style={{ textAlign: "center", padding: "12px 4px" }}>
        <div style={{ fontSize: 44 }} aria-hidden>✅</div>
        <h2>Thank you, {res.ok.name}</h2>
        <p>Key drop <b>{res.ok.docNo}</b> is received. Please drop your key in the box now. An advisor at Superfix {res.ok.branch} will check your car in from 07:30 and send you the quotation on WhatsApp before any work.</p>
      </div>
    );
  }
  const bad = (f: string) => (res.field === f ? { "aria-invalid": true as const } : {});
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const photos = fd.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
        if (photos.length > 3) { setRes({ err: "Add at most 3 photos." }); return; }
        fd.delete("photos");
        for (const p of photos) fd.append("photos", await shrink(p));
        const r = await action(fd); setRes(r); if (r.err) window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }} encType="multipart/form-data">
      <input type="hidden" name="code" value={code} />
      {res.err && <div className="flash err" role="alert">{res.err}</div>}
      <h3>1. You and your car</h3>
      <div className="row">
        <div className="field" style={{ maxWidth: 110 }}><label htmlFor="kt">Title</label><select id="kt" name="title" defaultValue=""><option value="">-</option><option>Mr</option><option>Mrs</option><option>Ms</option><option>Dr</option></select></div>
        <div className="field"><label htmlFor="kn">Your name</label><input id="kn" name="name" required autoComplete="name" {...bad("name")} /></div>
      </div>
      <div className="field"><label htmlFor="km">Mobile (WhatsApp)</label><input id="km" name="mobile" type="tel" inputMode="tel" required placeholder="050 123 4567" autoComplete="tel" {...bad("mobile")} /></div>
      <div className="row">
        <div className="field"><label htmlFor="kr">Plate from</label><select id="kr" name="registered_in" defaultValue="" {...bad("registered_in")}><option value="">Choose</option>{plates.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
        <div className="field" style={{ maxWidth: 110 }}><label htmlFor="kc">Plate code</label><input id="kc" name="plate_code" maxLength={5} autoCapitalize="characters" /></div>
        <div className="field"><label htmlFor="kp">Plate number</label><input id="kp" name="plate_number" required maxLength={10} inputMode="numeric" {...bad("plate_number")} /></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="kmm">Car make and model</label><input id="kmm" name="make_model" placeholder="Toyota Land Cruiser" maxLength={80} /></div>
        <div className="field" style={{ maxWidth: 160 }}><label htmlFor="ko">Odometer (km)</label><input id="ko" name="odometer" inputMode="numeric" maxLength={9} {...bad("odometer")} /></div>
      </div>
      <h3>2. What do you need?</h3>
      <div className="field"><label htmlFor="ks">Service</label><input id="ks" name="service_asked" required maxLength={300} placeholder="For example: brakes, 10,000 km service, AC" {...bad("service_asked")} /></div>
      <div className="field"><label htmlFor="kd">Describe the problem (optional)</label><textarea id="kd" name="complaints" rows={3} maxLength={2000} placeholder="For example: grinding noise from the front when braking" /></div>
      <div className="field"><label htmlFor="kph">Photos of the car (optional, up to 3)</label><input id="kph" name="photos" type="file" accept="image/*" multiple capture="environment" /></div>
      <div className="field"><label htmlFor="kv">Valuables left in the car (optional)</label><input id="kv" name="valuables" maxLength={300} placeholder="None" /></div>
      <h3>3. Confirm and sign</h3>
      <label className="row small" style={{ gap: 8, alignItems: "flex-start", marginBottom: 10 }} {...bad("agree")}><input type="checkbox" name="agree" value="1" required style={{ width: 22, height: 22, flex: "none" }} /> I agree Superfix may inspect the car and will send me a quotation on WhatsApp before any work.</label>
      <div className="field"><label>Sign with your finger</label><SignaturePad /></div>
      <div className="field" style={{ maxWidth: 200 }}><label htmlFor="kk">Key box slot (if numbered)</label><input id="kk" name="key_slot" maxLength={10} inputMode="numeric" /></div>
      <button className="btn green" style={{ width: "100%", minHeight: 52, fontSize: 17 }} disabled={busy}>{busy ? "Sending…" : "Send and drop my key"}</button>
    </form>
  );
}
