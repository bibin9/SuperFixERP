import { requireCtx } from "@/lib/session";
import { getMaster } from "@/lib/services/master-forms";
import { can } from "@/lib/access";
import { saveMasterAction, masterActiveAction } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, Link, PageHead } from "@/components/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
const show = (v: any) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

export default async function MasterPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { key } = await params;
  const sp = await searchParams;
  const { def, rows, options } = await getMaster(ctx, key);
  const keyOf = (r: any) => JSON.stringify(def.pk.map((k) => r[k]));
  const editing = sp.edit ? rows.find((r) => keyOf(r) === sp.edit) : null;
  const canEdit = can(ctx, "settings", "edit");
  const canCreate = can(ctx, "settings", "create") && !def.noCreate;
  const back = `/admin/masters/${key}`;
  const label = (f: (typeof def.fields)[number], v: any) => (options[f.name]?.find(([o]) => o === String(v))?.[1] ?? show(v));
  const form = (r: any | null) => (
    <form action={saveMasterAction}>
      <input type="hidden" name="$master" value={key} /><input type="hidden" name="$back" value={back} />
      {r && <input type="hidden" name="$key" value={keyOf(r)} />}
      <div className="row">
        {def.fields.map((f) => {
          const locked = !!r && def.pk.includes(f.name);
          const v = r ? r[f.name] : undefined;
          return (
            <div className="field" key={f.name} style={f.type === "textarea" ? { flexBasis: "100%" } : {}}>
              <label>{f.label}{f.required ? "" : " (optional)"}</label>
              {locked ? <input value={label(f, v)} disabled />
                : f.type === "bool" ? <input type="checkbox" name={f.name} defaultChecked={!!v} style={{ width: "auto", minHeight: 0 }} />
                : f.type === "textarea" ? <textarea name={f.name} defaultValue={show(v)} required={f.required} />
                : f.type === "select" ? <select name={f.name} defaultValue={v ?? ""} required={f.required}><option value="">—</option>{(options[f.name] ?? []).map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
                : <input name={f.name} defaultValue={show(v)} required={f.required} inputMode={f.type === "number" ? "decimal" : undefined} title={f.hint} />}
            </div>
          );
        })}
      </div>
      <button className="btn">{r ? "Save changes" : "Add"}</button>{r && <> <Link className="btn ghost" href={back}>Cancel</Link></>}
    </form>
  );
  return (
    <>
      <PageHead title={def.title} sub={def.note}><Link className="btn ghost sm" href="/admin/masters">All master forms</Link></PageHead>
      <Flash sp={sp} />
      {editing && canEdit && <div className="card"><h2>Edit</h2>{form(editing)}</div>}
      {!editing && canCreate && <div className="card"><h2>Add</h2>{form(null)}</div>}
      <div className="card">
        <table>
          <thead><tr>{def.fields.map((f) => <th key={f.name}>{f.label}</th>)}{def.hasActive && <th>Active</th>}<th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={keyOf(r)} style={def.hasActive && !r.active ? { opacity: 0.55 } : {}}>
              {def.fields.map((f) => <td key={f.name} className={f.type === "textarea" ? "small" : ""}>{label(f, r[f.name])}</td>)}
              {def.hasActive && <td>{r.active ? "Yes" : "No"}</td>}
              <td style={{ whiteSpace: "nowrap" }}>{canEdit && <>
                <Link className="btn ghost sm" href={`${back}?edit=${encodeURIComponent(keyOf(r))}`}>Edit</Link>{" "}
                {def.hasActive && <form action={masterActiveAction} className="inline"><input type="hidden" name="$master" value={key} /><input type="hidden" name="$key" value={keyOf(r)} />
                  <input type="hidden" name="active" value={r.active ? "false" : "true"} /><ConfirmButton className="btn ghost sm" message={r.active ? "Deactivate this record? It stops being offered on new documents; existing documents keep it." : "Activate this record again?"}>{r.active ? "Deactivate" : "Activate"}</ConfirmButton></form>}
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
