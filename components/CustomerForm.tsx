"use client";
import { useState } from "react";
import { saveCustomerAction } from "@/app/actions";

type Opt = { code: string; name: string; id_types?: string[] };

type Lk = { list: string; code: string; name_en: string };
export function CustomerForm({ back, countries, titles, lookups = [], c, dups }: { back: string; countries: Opt[]; titles: { code: string; name_en: string }[]; lookups?: Lk[]; c?: Record<string, any>; dups?: { kind: string; id: string; label: string }[] }) {
  const list = (l: string) => lookups.filter((x) => x.list === l);
  const v = (k: string) => (c?.[k] ?? "") as string;
  const [ctype, setCtype] = useState<string>(v("customer_type") || "individual");
  const [country, setCountry] = useState<string>(v("country_code") || "AE");
  const isPerson = ctype === "individual";
  const idTypes = countries.find((x) => x.code === country)?.id_types ?? [];
  const savedId = v("id_type");
  const idOptions = savedId && !idTypes.includes(savedId) ? [...idTypes, savedId] : idTypes;
  return (
    <form action={saveCustomerAction}>
      <input type="hidden" name="$back" value={back} />
      <input type="hidden" name="whatsapp_shown" value="1" />
      {c?.id && <input type="hidden" name="id" value={c.id} />}
      {c?.id && <input type="hidden" name="version" value={c.version} />}
      {dups && dups.length > 0 && (
        <div className="flash warn">
          <b>Possible duplicate found in another record:</b>
          <ul>{dups.map((d) => <li key={d.id}>Same {({ mobile: "mobile", vin: "VIN", plate: "plate" } as Record<string, string>)[d.kind] ?? d.kind}: <a href={`/customers/${d.id}`}>{d.label}</a> (use this one)</li>)}</ul>
          To save as new anyway, give a reason (for example, family members share a phone):
          <input name="duplicate_reason" required style={{ marginTop: 6 }} />
        </div>
      )}
      <div className="row">
        <div className="field"><label>Customer type</label>
          <select name="customer_type" required value={ctype} onChange={(e) => setCtype(e.target.value)}>
            <option value="individual">Individual</option><option value="corporate">Corporate / fleet</option><option value="government">Government</option>
          </select></div>
        <div className="field"><label>Country</label>
          <select name="country_code" required value={country} onChange={(e) => setCountry(e.target.value)}>{countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
        <div className="field"><label>Mobile (with or without country code)</label><input name="mobile" defaultValue={v("mobile")} required placeholder="050 123 4567" /></div>
      </div>
      <div className="row">
        {isPerson ? (<>
          <div className="field shrink" style={{ minWidth: 110 }}><label>Title</label>
            <select name="title" required defaultValue={v("title")}><option value="">—</option>{titles.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
          <div className="field"><label>First name</label><input name="first_name" defaultValue={v("first_name")} required /></div>
          <div className="field"><label>Last name</label><input name="last_name" defaultValue={v("last_name")} required /></div>
        </>) : (<>
          <div className="field"><label>Company name</label><input name="company_name" defaultValue={v("company_name")} required /></div>
        </>)}
      </div>
      <div className="row">
        <div className="field"><label>Name in Arabic</label><input name="name_ar" dir="rtl" defaultValue={v("name_ar")} /></div>
        <div className="field"><label>Email</label><input name="email" type="email" defaultValue={v("email")} /></div>
        <div className="field"><label>ID type</label>
          <select name="id_type" key={country} defaultValue={idOptions.includes(savedId) ? savedId : ""}><option value="">—</option>{idOptions.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field"><label>ID number</label><input name="id_number" defaultValue={v("id_number")} /></div>
      </div>
      <div className="row">
        <div className="field"><label>TRN (VAT-registered business)</label><input name="trn" defaultValue={v("trn")} /></div>
        <div className="field"><label>Credit limit (AED)</label><input name="credit_limit" defaultValue={v("credit_limit") || "0"} /></div>
        <div className="field"><label>Payment terms (days)</label><input name="payment_terms_days" defaultValue={v("payment_terms_days") || "0"} /></div>
        <div className="field"><label>Fleet discount %</label><input name="fleet_discount_pct" defaultValue={v("fleet_discount_pct") || "0"} /></div>
        <div className="field"><label>Price level</label>
          <select name="price_level" required defaultValue={v("price_level") || "retail"}>{list("price_level").map((x) => <option key={x.code} value={x.code}>{x.name_en}</option>)}</select></div>
      </div>
      {!isPerson && (
        <fieldset className="einv">
          <legend>E-invoicing details (needed for a full tax invoice to a VAT-registered business)</legend>
          <div className="row">
            <div className="field"><label>Peppol ID</label><input name="peppol_id" defaultValue={v("peppol_id")} placeholder="0235:100234567800003" /></div>
            <div className="field"><label>Trade licence no.</label><input name="trade_licence_no" defaultValue={v("trade_licence_no")} /></div>
            <div className="field"><label>Licence issued by</label>
              <select name="licence_authority" defaultValue={v("licence_authority")}><option value="">—</option>{list("licence_authority").map((x) => <option key={x.code} value={x.code}>{x.name_en}</option>)}</select></div>
          </div>
          <div className="row">
            <div className="field"><label>Building and street</label><input name="building_street" defaultValue={v("building_street")} /></div>
            <div className="field"><label>City</label><input name="city" defaultValue={v("city")} /></div>
            <div className="field"><label>Emirate</label>
              <select name="emirate" defaultValue={v("emirate")}><option value="">—</option>{list("emirate").map((x) => <option key={x.code} value={x.code}>{x.name_en}</option>)}</select></div>
            <div className="field"><label>P.O. box</label><input name="po_box" defaultValue={v("po_box")} /></div>
          </div>
          <div className="row">
            <div className="field"><label>Contact person (accounts)</label><input name="contact_person" defaultValue={v("contact_person")} /></div>
            <div className="field"><label>Contact phone</label><input name="contact_phone" defaultValue={v("contact_phone")} placeholder="+971 2 555 0100" /></div>
          </div>
        </fieldset>)}
      <div className="row" style={{ alignItems: "center" }}>
        <label className="shrink"><input type="checkbox" name="whatsapp" defaultChecked={c ? c.whatsapp === true || c.whatsapp === "on" : true} /> WhatsApp on this mobile</label>
        <label className="shrink"><input type="checkbox" name="marketing_consent" defaultChecked={!!c?.marketing_consent} /> Marketing consent (PDPL)</label>
        <label className="shrink"><input type="checkbox" name="lpo_required" defaultChecked={!!c?.lpo_required} /> LPO required</label>
        <div className="shrink"><button className="btn">Save customer</button></div>
      </div>
    </form>
  );
}
