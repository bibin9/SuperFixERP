"use client";
import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { quickAddAction } from "@/app/actions-quick";
import type { QuickSpec, QField } from "@/lib/services/quick-add";

const initial = (fields: QField[]) => Object.fromEntries(fields.map((f) => [f.name, f.def ?? ""]));

/**
 * "+ New" beside a picker. Opens a short form over the page, saves the new record (customer, car, part,
 * service or supplier) with the same checks as its master screen, then adds it to the picker and selects it.
 * Whatever the user already typed on the page stays as it was.
 */
export function QuickAdd({ spec, target, ownerFrom, owner, label = "+ New", go, className }: {
  spec: QuickSpec; target?: string; ownerFrom?: string; owner?: string; label?: string;
  /** Instead of filling a picker, open this address after saving; {id} is the new record. */
  go?: string; className?: string;
}) {
  const router = useRouter();
  const btn = useRef<HTMLButtonElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const [vals, setVals] = useState<Record<string, string>>(() => initial(spec.fields));
  const [err, setErr] = useState<string | null>(null);
  const [dups, setDups] = useState<{ kind: string; id: string; label: string }[] | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [pending, start] = useTransition();
  const [mounted, setMounted] = useState(false);

  const scope = () => (btn.current?.closest("form") ?? btn.current?.closest(".field, .row, .card") ?? document) as ParentNode;
  const ownerId = () => owner ?? (ownerFrom ? (scope().querySelector(`[name="${ownerFrom}"]`) as HTMLSelectElement | HTMLInputElement | null)?.value ?? "" : "");

  const open = () => {
    setMounted(true); setErr(null); setDups(null); setBlocked(false);
    if (ownerFrom && !ownerId()) { setErr("Pick or add the customer first, then add the car."); }
    requestAnimationFrame(() => dlg.current?.showModal());
  };
  const close = () => dlg.current?.close();
  // A change clears the fields whose options depend on it (the ID type follows the country, the plate code the emirate).
  const set = (name: string, v: string) => setVals((cur) => ({ ...cur, [name]: v, ...Object.fromEntries(spec.fields.filter((x) => x.dep?.on === name).map((x) => [x.name, ""])) }));
  const shown = (f: QField) => !f.showIf || f.showIf[1].includes(vals[f.showIf[0]] ?? "");
  const opts = (f: QField) => (f.dep ? f.dep.map[vals[f.dep.on]] ?? [] : f.options ?? []);

  const save = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const values: Record<string, string> = {};
    for (const f of spec.fields) if (shown(f)) values[f.name] = f.type === "bool" ? (fd.get(f.name) ? "on" : "") : String(fd.get(f.name) ?? "");
    const reason = fd.get("duplicate_reason"); if (reason) values.duplicate_reason = String(reason);
    if (ownerFrom || owner) values.owner_customer_id = ownerId();
    start(async () => {
      const r = await quickAddAction(spec.kind, values);
      if (!r.ok) { setErr(r.err); setDups(r.dups ?? null); setBlocked(!!r.blocked); return; }
      if (go) { close(); router.push(go.replace("{id}", encodeURIComponent(r.id))); return; }
      const near = (btn.current?.closest(".picker") ?? scope()) as ParentNode;
      const sel = target ? (near.querySelector(`select[name="${target}"]`) ?? scope().querySelector(`select[name="${target}"]`)) as HTMLSelectElement | null : null;
      if (sel) {
        let o = [...sel.options].find((x) => x.value === r.id);
        if (!o) { o = new Option(r.label, r.id); sel.add(o, sel.options[1] ?? null); }
        sel.value = r.id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      setVals(initial(spec.fields)); setDups(null); setErr(null);
      close();
    });
  };

  return (
    <>
      <button ref={btn} type="button" className={className ?? "btn ghost sm quickadd"} data-quickadd={spec.kind} onClick={open} aria-label={`${spec.title}`}>{label}</button>
      {mounted && createPortal(
        <dialog ref={dlg} className="popup" aria-label={spec.title} onClick={(e) => { if (e.target === dlg.current) close(); }}>
          <div className="popup-head"><div className="popup-title" role="heading" aria-level={2}>{spec.title}</div><button type="button" className="popup-x" onClick={close} aria-label="Close">×</button></div>
          <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); save(e.currentTarget); }}>
            {err && <div className="flash err" role="alert">{err}</div>}
            {dups && dups.length > 0 && <div className="flash warn">
              <ul style={{ margin: "0 0 6px 18px" }}>{dups.map((d) => <li key={d.id}>{d.label}</li>)}</ul>
              {blocked ? "This cannot be saved again." : <>To save a new one anyway, give a reason: <input name="duplicate_reason" required /></>}
            </div>}
            <div className="popup-grid">
              {spec.fields.filter(shown).map((f) => (
                <div key={f.name} className={`field${f.type === "bool" ? " checkf" : ""}`}>
                  {f.type === "bool" ? <label className="check"><input type="checkbox" name={f.name} /> {f.label}</label> : <>
                    <label htmlFor={`qa-${spec.kind}-${f.name}`}>{f.label}</label>
                    {f.type === "select" || (f.dep && opts(f).length > 0)
                      ? <select id={`qa-${spec.kind}-${f.name}`} name={f.name} required={f.required} value={vals[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                          <option value="">Choose</option>{opts(f).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                      : <input id={`qa-${spec.kind}-${f.name}`} name={f.name} required={f.required} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined}
                          pattern={f.pattern} value={vals[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />}
                    {f.hint && <div className="small muted">{f.hint}</div>}
                  </>}
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn green shrink" disabled={pending || blocked}>{pending ? "Saving…" : "Save and use it"}</button>
              <button type="button" className="btn ghost shrink" onClick={close}>Cancel</button>
            </div>
          </form>
        </dialog>, document.body)}
    </>
  );
}
