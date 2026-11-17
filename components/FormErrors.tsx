"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Errors in red under the field that is wrong, on every form (17 Nov 2026 review).
 * When a form is sent, what was typed is kept for a moment. If the server refuses it, the page comes back
 * with the message (?err=, and ?errf= naming the field when the server knows it): the typed values are put
 * back, and the message is shown under the field it is about (by name, or by the field's label at the
 * start of the message), the field is outlined in red and focused. Typing in it clears the mark.
 */
const KEY = "sf-last-form";
type Saved = { path: string; at: number; index: number; values: [string, string][] };

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const skip = (el: Element) => el instanceof HTMLInputElement && ["hidden", "password", "file", "submit", "button"].includes(el.type);

function save(form: HTMLFormElement) {
  const forms = Array.from(document.querySelectorAll("form"));
  const values: [string, string][] = [];
  for (const el of Array.from(form.elements)) {
    const f = el as HTMLInputElement;
    if (!f.name || skip(el) || f.name.startsWith("$")) continue;
    if ((f.type === "checkbox" || f.type === "radio") && !f.checked) continue;
    values.push([f.name, f.value]);
  }
  try { sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, at: Date.now(), index: forms.indexOf(form), values } satisfies Saved)); } catch { /* storage full or blocked */ }
}

function restore(form: HTMLFormElement, values: [string, string][]) {
  const byName = new Map<string, string[]>();
  for (const [k, v] of values) byName.set(k, [...(byName.get(k) ?? []), v]);
  const seen = new Map<string, number>();
  for (const el of Array.from(form.elements)) {
    const f = el as HTMLInputElement;
    if (!f.name || skip(el) || !byName.has(f.name)) continue;
    const vals = byName.get(f.name)!;
    if (f.type === "checkbox" || f.type === "radio") { f.checked = vals.includes(f.value); continue; }
    const i = seen.get(f.name) ?? 0;
    seen.set(f.name, i + 1);
    if (vals[i] === undefined) continue;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), "value")?.set;
    setter ? setter.call(f, vals[i]) : (f.value = vals[i]);
    f.dispatchEvent(new Event("input", { bubbles: true }));
    f.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function findField(root: ParentNode, msg: string, name: string | null): HTMLElement | null {
  if (name) {
    const el = root.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`) ?? document.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    if (el) return el;
  }
  const m = norm(msg);
  let best: { el: HTMLElement; len: number } | null = null;
  for (const lab of Array.from(root.querySelectorAll("label"))) {
    const t = norm(lab.textContent ?? "");
    if (t.length < 3 || !(m.startsWith(t + " ") || m === t)) continue;
    const el = (lab.htmlFor ? document.getElementById(lab.htmlFor) : null) ?? lab.closest(".field")?.querySelector<HTMLElement>("input,select,textarea") ?? null;
    if (el && (!best || t.length > best.len)) best = { el, len: t.length };
  }
  return best?.el ?? null;
}

function mark(el: HTMLElement, msg: string) {
  document.querySelectorAll(".field-err[data-auto]").forEach((n) => n.remove());
  document.querySelectorAll("[aria-invalid='true'][data-auto-invalid]").forEach((n) => { n.removeAttribute("aria-invalid"); n.removeAttribute("data-auto-invalid"); });
  const box = document.createElement("div");
  box.className = "field-err"; box.dataset.auto = "1"; box.setAttribute("role", "alert"); box.textContent = msg;
  box.id = `err-${Math.random().toString(36).slice(2)}`;
  const holder = el.closest(".field") ?? el.parentElement;
  holder?.appendChild(box);
  el.setAttribute("aria-invalid", "true"); el.setAttribute("data-auto-invalid", "1"); el.setAttribute("aria-describedby", box.id);
  const details = el.closest("details");
  if (details) details.open = true;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  const clear = () => { box.remove(); el.removeAttribute("aria-invalid"); el.removeAttribute("data-auto-invalid"); el.removeEventListener("input", clear); };
  el.addEventListener("input", clear);
}

export function FormErrors() {
  const path = usePathname();
  const sp = useSearchParams();
  const err = sp.get("err");
  const errf = sp.get("errf");

  useEffect(() => {
    const onSubmit = (e: Event) => { if (e.target instanceof HTMLFormElement) save(e.target); };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  useEffect(() => {
    if (!err) return;
    let tries = 0, root: ParentNode | null = null;
    const attempt = () => {
      const el = findField(root ?? document, err, errf);
      if (el) { mark(el, err); return; }
      if (++tries < 10) t2 = setTimeout(attempt, 200); // fields that appear late (for example after a load check) get the mark too
    };
    let t2: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      let saved: Saved | null = null;
      try { saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { saved = null; }
      root = document.querySelector("main") ?? document;
      if (saved && saved.path === path && Date.now() - saved.at < 120_000) {
        const form = document.querySelectorAll("form")[saved.index] as HTMLFormElement | undefined;
        if (form) {
          const details = form.closest("details");
          if (details) details.open = true;
          restore(form, saved.values);
          root = form;
        }
        sessionStorage.removeItem(KEY);
      }
      attempt();
    }, 120);
    return () => { clearTimeout(t); if (t2) clearTimeout(t2); };
  }, [err, errf, path]);
  return null;
}
