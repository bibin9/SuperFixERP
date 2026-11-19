"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Gives every visible field a name a screen reader can read: the label next to it in its .field box, else its
 * table column heading, else its placeholder. Fields that already have a label or aria-label are left alone.
 */
function name(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const box = el.closest(".field");
  const lab = box?.querySelector(":scope > label");
  if (lab && box!.querySelectorAll("input:not([type=hidden]),select,textarea").length === 1) return (lab.textContent ?? "").replace(/\*/g, "").trim();
  const cell = el.closest("td");
  if (cell) {
    const tr = cell.parentElement as HTMLTableRowElement, i = [...tr.children].indexOf(cell);
    const th = cell.closest("table")?.querySelector("thead tr")?.children[i];
    const t = (th?.textContent ?? "").trim(), row = (tr.children[0]?.textContent ?? "").trim();
    if (t) return row && i > 0 ? `${t}: ${row.slice(0, 40)}` : t;
  }
  return "placeholder" in el && el.placeholder ? el.placeholder : "";
}
function fix() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("main input:not([type=hidden]),main select,main textarea").forEach((el) => {
    if ((el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title) return;
    const n = name(el);
    if (n) el.setAttribute("aria-label", n);
  });
}
export function AutoLabels() {
  const path = usePathname();
  useEffect(() => {
    fix();
    const mo = new MutationObserver(() => fix());
    const m = document.querySelector("main");
    if (m) mo.observe(m, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [path]);
  return null;
}
