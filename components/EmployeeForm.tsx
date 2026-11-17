/* eslint-disable @typescript-eslint/no-explicit-any */
import { DAYS } from "@/lib/services/hr-time";

type L = Awaited<ReturnType<typeof import("@/lib/services/hr").hrLookups>>;

const F = ({ label, children, opt, wide }: { label: string; children: React.ReactNode; opt?: boolean; wide?: boolean }) => (
  <div className="field" style={wide ? { flexBasis: "100%" } : {}}><label>{label}{opt ? " (optional)" : ""}</label>{children}</div>
);

/** The employee file form (new and edit). Field names match the service; custom fields are named cf_<code>. */
export function EmployeeForm({ e, l, custom, isNew, showBank }: { e?: any; l: L; custom?: Record<string, any>; isNew?: boolean; showBank: boolean }) {
  const v = (k: string) => (e?.[k] === null || e?.[k] === undefined ? "" : String(e[k]));
  const tabs: [string, string][] = [["personal", "Personal"], ["job", "Job"], ["documents", "Documents"], ["other", "Other"]];
  const cfs = (tab: string) => l.customFields.filter((f) => f.tab === tab);
  const cf = (f: L["customFields"][number]) => {
    const val = custom?.[f.code] ?? "";
    const name = `cf_${f.code}`;
    return (
      <F key={f.id} label={f.label} opt={!f.required}>
        {f.field_type === "dropdown" ? <select name={name} defaultValue={val}><option value="">—</option>{(f.options ?? "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
          : f.field_type === "yes_no" ? <select name={name} defaultValue={val}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>
          : f.field_type === "date" ? <input type="date" name={name} defaultValue={val} />
          : f.field_type === "attachment" ? <><input type="file" name={name} accept="image/*,application/pdf" />{val && <a className="small" href={`/api/attachments/${val}`}>Current file</a>}</>
          : <input name={name} defaultValue={val} inputMode={f.field_type === "number" ? "decimal" : undefined} />}
      </F>
    );
  };
  return (
    <>
      <h3>Personal</h3>
      <div className="row">
        {isNew && <F label="Branch"><select name="branch_id" required defaultValue={l.branches.length === 1 ? l.branches[0].id : ""}><option value="">Choose</option>{l.branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}</select></F>}
        {isNew && <F label="Employee no." opt><input name="emp_no" placeholder="Given automatically" /></F>}
        <F label="First name"><input name="first_name" defaultValue={v("first_name")} required /></F>
        <F label="Last name"><input name="last_name" defaultValue={v("last_name")} required /></F>
        <F label="Name in Arabic" opt><input name="name_ar" dir="rtl" defaultValue={v("name_ar")} /></F>
        <F label="Nationality"><select name="nationality" defaultValue={v("nationality")} required><option value="">Choose</option>{l.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></F>
        <F label="Date of birth" opt><input type="date" name="date_of_birth" defaultValue={v("date_of_birth")} /></F>
        <F label="Gender" opt><select name="gender" defaultValue={v("gender")}><option value="">—</option><option value="male">Male</option><option value="female">Female</option></select></F>
        <F label="Marital status" opt><select name="marital_status" defaultValue={v("marital_status")}><option value="">—</option>{["single", "married", "divorced", "widowed"].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</select></F>
        <F label="Mobile" opt><input name="mobile" defaultValue={v("mobile")} inputMode="tel" /></F>
        <F label="Email" opt><input name="email" type="email" defaultValue={v("email")} /></F>
        <F label="Emergency contact" opt><input name="emergency_contact" defaultValue={v("emergency_contact")} /></F>
        {cfs("personal").map(cf)}
      </div>
      <h3>Job</h3>
      <div className="row">
        <F label="Department" opt><select name="department_id" defaultValue={v("department_id")}><option value="">—</option>{l.departments.map((x) => <option key={x.id} value={x.id}>{x.name_en}</option>)}</select></F>
        <F label="Designation" opt><select name="designation_id" defaultValue={v("designation_id")}><option value="">—</option>{l.designations.map((x) => <option key={x.id} value={x.id}>{x.name_en}</option>)}</select></F>
        <F label="Grade" opt><select name="grade" defaultValue={v("grade")}><option value="">—</option>{l.grades.map((x) => <option key={x.code} value={x.code}>{x.name_en}</option>)}</select></F>
        <F label="Line manager" opt><select name="line_manager_id" defaultValue={v("line_manager_id")}><option value="">—</option>{l.managers.filter((m) => m.id !== e?.id).map((m) => <option key={m.id} value={m.id}>{m.emp_no} {m.full_name} ({m.branch_code})</option>)}</select></F>
        <F label="Joining date"><input type="date" name="joining_date" defaultValue={v("joining_date")} required /></F>
        <F label="Contract"><select name="contract_type" defaultValue={v("contract_type") || "limited"}><option value="limited">Limited</option><option value="unlimited">Unlimited</option><option value="part_time">Part time</option><option value="temporary">Temporary</option></select></F>
        <F label="Contract ends" opt><input type="date" name="contract_end" defaultValue={v("contract_end")} /></F>
        <F label="Probation ends" opt><input type="date" name="probation_end" defaultValue={v("probation_end")} /></F>
        <F label="Shift" opt><select name="shift_id" defaultValue={v("shift_id")}><option value="">—</option>{l.shifts.map((x) => <option key={x.id} value={x.id}>{x.name} {x.start_time}–{x.end_time}</option>)}</select></F>
        <F label="Weekly day off"><select name="weekly_off" defaultValue={v("weekly_off") || "5"}>{DAYS.map((dd, i) => <option key={i} value={i}>{dd}</option>)}</select></F>
        <F label="Sign-in user" opt><select name="user_id" defaultValue={v("user_id")}><option value="">Not linked</option>{e?.user_id && <option value={e.user_id}>{e.username}</option>}{l.users.map((u) => <option key={u.id} value={u.id}>{u.username} · {u.full_name}</option>)}</select></F>
        {cfs("job").map(cf)}
      </div>
      <h3>Labour and WPS</h3>
      <div className="row">
        <F label="MOHRE person code" opt><input name="mohre_person_code" defaultValue={v("mohre_person_code")} inputMode="numeric" placeholder="14 digits" /></F>
        <F label="Labour card no." opt><input name="labour_card_no" defaultValue={v("labour_card_no")} /></F>
        <F label="Paid through (WPS agent)" opt><select name="wps_agent_id" defaultValue={v("wps_agent_id")}><option value="">—</option>{l.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></F>
        <F label="Paid by"><select name="pay_method" defaultValue={v("pay_method") || "iban"}><option value="iban">Bank account (IBAN)</option><option value="wps_card">WPS salary card</option></select></F>
        {showBank ? <>
          <F label="IBAN" opt><input name="iban" defaultValue={v("iban")} placeholder="AE + 21 digits" /></F>
          <F label="WPS card no." opt><input name="wps_card_no" defaultValue={v("wps_card_no")} /></F>
        </> : <p className="small muted">Bank details are kept by HR.</p>}
        {cfs("documents").map(cf)}
        {cfs("other").map(cf)}
      </div>
      {tabs.length === 0 && null}
    </>
  );
}
