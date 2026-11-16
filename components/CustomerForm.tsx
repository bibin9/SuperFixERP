import { saveCustomerAction } from "@/app/actions";

type Opt = { code: string; name: string; id_types?: string[] };

export function CustomerForm({ back, countries, titles, c, dups }: { back: string; countries: Opt[]; titles: { code: string; name_en: string }[]; c?: Record<string, any>; dups?: { kind: string; id: string; label: string }[] }) {
  const v = (k: string) => (c?.[k] ?? "") as string;
  return (
    <form action={saveCustomerAction}>
      <input type="hidden" name="$back" value={back} />
      <input type="hidden" name="whatsapp_shown" value="1" />
      {c?.id && <input type="hidden" name="id" value={c.id} />}
      {c?.id && <input type="hidden" name="version" value={c.version} />}
      {dups && dups.length > 0 && (
        <div className="flash warn">
          <b>Possible duplicate found in another record:</b>
          <ul>{dups.map((d) => <li key={d.id}>{d.kind}: <a href={`/customers/${d.id}`}>{d.label}</a> (use this one)</li>)}</ul>
          To save as new anyway, give a reason (for example, family members share a phone):
          <input name="duplicate_reason" required style={{ marginTop: 6 }} />
        </div>
      )}
      <div className="row">
        <div className="field"><label>Customer type</label>
          <select name="customer_type" defaultValue={v("customer_type") || "individual"}>
            <option value="individual">Individual</option><option value="corporate">Corporate / fleet</option><option value="government">Government</option>
          </select></div>
        <div className="field"><label>Country</label>
          <select name="country_code" defaultValue={v("country_code") || "AE"}>{countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
        <div className="field"><label>Mobile (with or without country code)</label><input name="mobile" defaultValue={v("mobile")} required placeholder="050 123 4567" /></div>
      </div>
      <div className="row">
        <div className="field shrink" style={{ minWidth: 110 }}><label>Title (individuals)</label>
          <select name="title" defaultValue={v("title")}><option value="">—</option>{titles.map((t) => <option key={t.code} value={t.code}>{t.name_en}</option>)}</select></div>
        <div className="field"><label>First name</label><input name="first_name" defaultValue={v("first_name")} /></div>
        <div className="field"><label>Last name</label><input name="last_name" defaultValue={v("last_name")} /></div>
        <div className="field"><label>Company name (companies)</label><input name="company_name" defaultValue={v("company_name")} /></div>
      </div>
      <div className="row">
        <div className="field"><label>Name in Arabic</label><input name="name_ar" dir="rtl" defaultValue={v("name_ar")} /></div>
        <div className="field"><label>Email</label><input name="email" type="email" defaultValue={v("email")} /></div>
        <div className="field"><label>ID type</label>
          <select name="id_type" defaultValue={v("id_type")}><option value="">—</option>{[...new Set(countries.flatMap((x) => x.id_types ?? []))].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field"><label>ID number</label><input name="id_number" defaultValue={v("id_number")} /></div>
      </div>
      <div className="row">
        <div className="field"><label>TRN (VAT-registered business)</label><input name="trn" defaultValue={v("trn")} /></div>
        <div className="field"><label>Credit limit (AED)</label><input name="credit_limit" defaultValue={v("credit_limit") || "0"} /></div>
        <div className="field"><label>Payment terms (days)</label><input name="payment_terms_days" defaultValue={v("payment_terms_days") || "0"} /></div>
        <div className="field"><label>Fleet discount %</label><input name="fleet_discount_pct" defaultValue={v("fleet_discount_pct") || "0"} /></div>
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <label className="shrink"><input type="checkbox" name="whatsapp" defaultChecked={c ? c.whatsapp === true || c.whatsapp === "on" : true} /> WhatsApp on this mobile</label>
        <label className="shrink"><input type="checkbox" name="marketing_consent" defaultChecked={!!c?.marketing_consent} /> Marketing consent (PDPL)</label>
        <label className="shrink"><input type="checkbox" name="lpo_required" defaultChecked={!!c?.lpo_required} /> LPO required</label>
        <div className="shrink"><button className="btn">Save customer</button></div>
      </div>
    </form>
  );
}
