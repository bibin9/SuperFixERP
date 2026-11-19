"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Paging for every long list in the app: any list table (no form fields in its rows) and any card grid with more
 * than 25 entries gets a pager under it. Each grid has its own Per page choice
 * (10 to 200), kept per user on this device; the company default is the setting lists.page_size. Rows on other pages are only hidden, so search,
 * totals and printing still cover the whole list. Report tables and tables marked .no-pager are left whole.
 */
const SIZES = [10, 25, 50, 100, 200];
let user = "", defSize = 25;
/** Each grid keeps its own page size: the screen's path plus the grid's place on the screen. */
const sizeKey = (list: Element) => `sf.pageSize.${user}.${location.pathname}.${lists().indexOf(list)}`;
const getSize = (list: Element) => { const n = Number(localStorage.getItem(sizeKey(list))); return SIZES.includes(n) ? n : defSize; };
const pages = new WeakMap<Element, number>();
let busy = false;

function items(list: Element): HTMLElement[] {
  if (list.tagName === "TABLE") return Array.from((list as HTMLTableElement).tBodies).flatMap((b) => Array.from(b.rows));
  return Array.from(list.children).filter((e) => !e.classList.contains("pgbar")) as HTMLElement[];
}

function lists(): Element[] {
  const main = document.querySelector(".main");
  if (!main) return [];
  const t = Array.from(main.querySelectorAll("table")).filter((x) => !x.matches(".report,.no-pager,.matrix") && !x.closest(".no-pager,.htour")
    && !x.querySelector("tbody :is(input:not([type=hidden]),select,textarea)"));
  return [...t, ...Array.from(main.querySelectorAll(".cardgrid:not(.no-pager)"))];
}

function render(list: Element) {
  const all = items(list);
  const bar0 = list.nextElementSibling?.classList.contains("pgbar") ? list.nextElementSibling as HTMLElement : null;
  const size = getSize(list);
  // A list that fits on one page shows no pager at all.
  if (all.length <= Math.max(SIZES[0], size)) { all.forEach((r) => r.removeAttribute("data-pg-hide")); bar0?.remove(); return; }
  const last = Math.ceil(all.length / size);
  const page = Math.min(pages.get(list) ?? 1, last);
  pages.set(list, page);
  all.forEach((r, i) => { const hide = i < (page - 1) * size || i >= page * size; if (hide) r.setAttribute("data-pg-hide", ""); else r.removeAttribute("data-pg-hide"); });
  const bar = bar0 ?? document.createElement("div");
  bar.className = "pgbar no-print";
  const from = (page - 1) * size + 1, to = Math.min(page * size, all.length);
  const html = `<span class="pg-info">Showing ${from}–${to} of ${all.length}</span>`
    + `<label class="pg-size">Per page <select aria-label="Rows per page">${SIZES.map((s) => `<option${s === size ? " selected" : ""}>${s}</option>`).join("")}</select></label>`
    + (last <= 1 ? "" : `<span class="pg-nav"><button type="button" class="btn ghost sm" data-go="1"${page <= 1 ? " disabled" : ""} aria-label="First page">«</button>`
    + `<button type="button" class="btn ghost sm" data-go="${page - 1}"${page <= 1 ? " disabled" : ""} aria-label="Previous page">‹ Prev</button>`
    + `<span class="pg-of">Page ${page} of ${last}</span>`
    + `<button type="button" class="btn ghost sm" data-go="${page + 1}"${page >= last ? " disabled" : ""} aria-label="Next page">Next ›</button>`
    + `<button type="button" class="btn ghost sm" data-go="${last}"${page >= last ? " disabled" : ""} aria-label="Last page">»</button></span>`);
  if (bar.innerHTML !== html) bar.innerHTML = html;
  if (!bar0) list.after(bar);
  (bar as HTMLElement & { _list?: Element })._list = list;
}

function renderAll() {
  if (busy) return;
  busy = true;
  try {
    const ls = lists();
    // A bar whose list was re-drawn or moved (React replaced the rows, a search refreshed the list) is dropped,
    // so a list never shows two pagers.
    document.querySelectorAll(".main .pgbar").forEach((b) => {
      const l = (b as HTMLElement & { _list?: Element })._list;
      if (!l || !ls.includes(l) || l.nextElementSibling !== b) b.remove();
    });
    ls.forEach(render);
  } finally { busy = false; }
}

export function ListPager({ user: u, defaultSize }: { user: string; defaultSize: number }) {
  const path = usePathname();
  useEffect(() => {
    user = u; defSize = SIZES.includes(defaultSize) ? defaultSize : 25;
    renderAll();
    const main = document.querySelector(".main");
    if (!main) return;
    const ours = (n: Node) => n instanceof Element && (n.classList.contains("pgbar") || !!n.closest(".pgbar"));
    const ob = new MutationObserver((recs) => {
      if (busy || recs.every((r) => ours(r.target) || [...r.addedNodes, ...r.removedNodes].every(ours))) return;
      requestAnimationFrame(renderAll);
    });
    ob.observe(main, { childList: true, subtree: true });
    const click = (e: Event) => {
      const b = (e.target as Element).closest?.(".pgbar [data-go]") as HTMLElement | null;
      if (!b) return;
      const bar = b.closest(".pgbar") as HTMLElement & { _list?: Element };
      if (!bar._list) return;
      pages.set(bar._list, Number(b.dataset.go));
      busy = true; render(bar._list); busy = false;
      const top = bar._list.closest(".card") ?? bar._list;
      if (top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
    };
    const change = (e: Event) => {
      const s = e.target as HTMLSelectElement;
      if (!s.closest?.(".pgbar")) return;
      const l = (s.closest(".pgbar") as HTMLElement & { _list?: Element })._list;
      if (!l) return;
      localStorage.setItem(sizeKey(l), s.value);
      pages.set(l, 1);
      busy = true; render(l); busy = false;
    };
    main.addEventListener("click", click);
    main.addEventListener("change", change);
    return () => { document.querySelectorAll(".main .pgbar").forEach((b) => b.remove()); ob.disconnect(); main.removeEventListener("click", click); main.removeEventListener("change", change); };
  }, [path, u, defaultSize]);
  return null;
}
