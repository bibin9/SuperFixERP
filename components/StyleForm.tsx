"use client";
import { useState } from "react";
import type { Style } from "@/lib/services/style";

const BRAND = ["#EC3542", "#c8102e", "#1f6feb", "#0f766e", "#7c3aed", "#ea580c", "#111827"];
const MENU = ["#0d1b2e", "#111827", "#1e293b", "#172554", "#134e4a", "#3b0764", "#3f3f46"];
const LINK = ["#1f4fbf", "#0369a1", "#0f766e", "#7c3aed", "#b91c1c"];

function Colour({ name, label, value, set, swatches, hint }: { name: string; label: string; value: string; set: (v: string) => void; swatches: string[]; hint: string }) {
  return (
    <div>
      <label htmlFor={name}><b>{label}</b></label>
      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        <input type="color" id={name} name={name} value={value} onChange={(e) => set(e.target.value)} />
        <code>{value.toUpperCase()}</code>
      </div>
      <div className="swatchrow">{swatches.map((c) => <button type="button" key={c} title={c} aria-label={`Use ${c}`} style={{ background: c, borderColor: c.toLowerCase() === value.toLowerCase() ? "var(--ink)" : undefined }} onClick={() => set(c)} />)}</div>
      <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.9em" }}>{hint}</p>
    </div>
  );
}

export function StyleForm({ s }: { s: Style }) {
  const [brand, setBrand] = useState(s.brand_color);
  const [menu, setMenu] = useState(s.menu_color);
  const [link, setLink] = useState(s.link_color);
  const [name, setName] = useState(s.app_name);
  const [tag, setTag] = useState(s.app_tagline);
  const [logo, setLogo] = useState(s.logo);
  const reset = () => { setBrand("#EC3542"); setMenu("#0d1b2e"); setLink("#1f4fbf"); setName("AUTOVIQO"); setTag("for Superfix Auto Centers"); };
  return (
    <div className="grid2" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <div>
        <div className="card"><h2>Colours</h2>
          <div style={{ display: "grid", gap: 18 }}>
            <Colour name="brand_color" label="Brand colour" value={brand} set={setBrand} swatches={BRAND} hint="Main buttons, highlights and the menu marker." />
            <Colour name="menu_color" label="Menu colour" value={menu} set={setMenu} swatches={MENU} hint="The side menu background. A dark colour keeps the white menu text easy to read." />
            <Colour name="link_color" label="Link colour" value={link} set={setLink} swatches={LINK} hint="Links in day mode. Night mode uses a lighter blue so links stay readable." />
          </div>
          <button type="button" className="btn ghost sm" style={{ marginTop: 14 }} onClick={reset}>Back to the Superfix colours</button>
        </div>
        <div className="card"><h2>Name and logo</h2>
          <label htmlFor="app_name"><b>Name shown in the menu</b></label>
          <input id="app_name" name="app_name" value={name} maxLength={30} required onChange={(e) => setName(e.target.value)} />
          <label htmlFor="app_tagline" style={{ marginTop: 10, display: "block" }}><b>Line under the name</b></label>
          <input id="app_tagline" name="app_tagline" value={tag} maxLength={60} onChange={(e) => setTag(e.target.value)} />
          <label htmlFor="logo" style={{ marginTop: 10, display: "block" }}><b>Logo</b> <span className="muted">(PNG, JPG or WEBP, up to 300 KB)</span></label>
          <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setLogo(String(r.result)); r.readAsDataURL(f); } }} />
          {s.logo && <label className="row" style={{ marginTop: 8, gap: 6, alignItems: "center" }}><input type="checkbox" name="remove_logo" /> Remove the logo and use the Superfix one</label>}
        </div>
        <div className="card"><h2>Reading</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
            <div><label htmlFor="default_mode"><b>Starting mode</b></label>
              <select id="default_mode" name="default_mode" defaultValue={s.default_mode}><option value="light">Day</option><option value="dark">Night</option><option value="auto">Follow the device</option></select>
              <p className="muted" style={{ fontSize: "0.9em" }}>Until a person picks their own.</p></div>
            <div><label htmlFor="text_size"><b>Text size</b></label>
              <select id="text_size" name="text_size" defaultValue={s.text_size}><option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option></select></div>
            <div><label htmlFor="density"><b>Spacing in lists</b></label>
              <select id="density" name="density" defaultValue={s.density}><option value="comfortable">Comfortable</option><option value="compact">Compact (more rows on screen)</option></select></div>
          </div>
        </div>
        <button className="btn" type="submit">Save the style</button>
      </div>
      <div className="card" style={{ position: "sticky", top: 80 }}><h2>Preview</h2>
        <div className="stylepreview" style={{ ["--pv-menu" as string]: menu } as React.CSSProperties}>
          <div className="pv-side">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo || "/sflogo.png"} alt="" style={{ width: 70, height: 36, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 2 }} />
            <div style={{ marginTop: 8, fontWeight: 700 }}>{name || "Name"}</div>
            <div style={{ opacity: .7, fontSize: 10 }}>{tag}</div>
            <div style={{ marginTop: 12, padding: "5px 7px", borderRadius: 6, background: "rgba(255,255,255,.12)", borderLeft: `3px solid ${brand}` }}>Job cards</div>
            <div style={{ padding: "5px 7px", opacity: .8 }}>Invoices</div>
          </div>
          <div className="pv-main">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>JC-YAS-0042 · Toyota Camry</div>
            <p style={{ margin: "0 0 10px" }}>Customer: <a href="#" onClick={(e) => e.preventDefault()} style={{ color: link }}>Ahmed Al Mansoori</a></p>
            <span style={{ display: "inline-block", background: brand, color: "#fff", borderRadius: 8, padding: "7px 14px", fontWeight: 600 }}>Approve</span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "0.9em", marginTop: 10 }}>Printed invoices, job cards and customer links keep their normal light look.</p>
      </div>
    </div>
  );
}
