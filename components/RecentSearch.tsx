"use client";
import { useEffect } from "react";

/**
 * Recent searches for every search box: what a user searched on a screen is kept on this device (per user and per
 * screen, last 8) and offered in a small list when the box is empty and gets focus. Picking one runs it again.
 */
const MAX = 8;
const isBox = (el: Element | null): el is HTMLInputElement =>
  !!el && el.tagName === "INPUT" && ((el as HTMLInputElement).type === "search" || (el as HTMLInputElement).name === "q") && !!(el as HTMLInputElement).form;

export function RecentSearch({ user }: { user: string }) {
  useEffect(() => {
    const key = (inp: HTMLInputElement) => {
      const f = inp.form!; const a = f.getAttribute("action");
      const scope = a && a.startsWith("/") ? a.split("?")[0] : location.pathname;
      return `sf.recent.${user}.${scope}`;
    };
    const read = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v.filter((s) => typeof s === "string") : []; } catch { return []; } };
    let pop: HTMLDivElement | null = null; let owner: HTMLInputElement | null = null;
    const close = () => { pop?.remove(); pop = null; owner = null; };
    const place = () => {
      if (!pop || !owner) return;
      const r = owner.getBoundingClientRect();
      Object.assign(pop.style, { left: `${Math.max(8, r.left)}px`, top: `${r.bottom + 4}px`, width: `${Math.min(Math.max(r.width, 240), innerWidth - 16)}px` });
    };
    const open = (inp: HTMLInputElement) => {
      const list = read(key(inp));
      close();
      if (!list.length || inp.value.trim()) return;
      owner = inp;
      pop = document.createElement("div");
      pop.className = "recent-pop"; pop.setAttribute("role", "listbox"); pop.setAttribute("aria-label", "Recent searches");
      pop.innerHTML = `<div class="rp-h"><span>Recent searches</span><button type="button" data-clear>Clear</button></div>`
        + list.map((s, i) => `<button type="button" role="option" class="rp-i" data-i="${i}"><span aria-hidden="true">↺</span> ${s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))}</button>`).join("");
      pop.addEventListener("mousedown", (e) => e.preventDefault());
      pop.addEventListener("click", (e) => {
        const t = e.target as Element; const inp2 = owner!;
        if (t.closest("[data-clear]")) { localStorage.removeItem(key(inp2)); close(); return; }
        const b = t.closest(".rp-i") as HTMLElement | null;
        if (!b) return;
        inp2.value = list[Number(b.dataset.i)]; close();
        inp2.form!.requestSubmit();
      });
      document.body.appendChild(pop); place();
    };
    const onFocus = (e: Event) => { if (isBox(e.target as Element)) open(e.target as HTMLInputElement); };
    const onInput = (e: Event) => { const t = e.target as Element; if (isBox(t)) { if ((t as HTMLInputElement).value) close(); else open(t as HTMLInputElement); } };
    const onBlur = (e: Event) => { if (e.target !== owner) return; const was = pop; setTimeout(() => { if (pop === was) close(); }, 120); };
    const onSubmit = (e: Event) => {
      const f = e.target as HTMLFormElement;
      const inp = Array.from(f.elements).find((x) => isBox(x)) as HTMLInputElement | undefined;
      const v = inp?.value.trim();
      if (!inp || !v || v.length > 80) return;
      const k = key(inp);
      localStorage.setItem(k, JSON.stringify([v, ...read(k).filter((s) => s.toLowerCase() !== v.toLowerCase())].slice(0, MAX)));
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("focusin", onFocus); document.addEventListener("input", onInput);
    document.addEventListener("focusout", onBlur); document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey); addEventListener("scroll", place, true); addEventListener("resize", place);
    return () => {
      document.removeEventListener("focusin", onFocus); document.removeEventListener("input", onInput);
      document.removeEventListener("focusout", onBlur); document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKey); removeEventListener("scroll", place, true); removeEventListener("resize", place); close();
    };
  }, [user]);
  return null;
}
