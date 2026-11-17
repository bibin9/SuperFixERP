"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Lists (tables with a header row and at least five columns) become one card per row on phones.
 * This only marks them: each cell gets its column name as data-label and the table gets class "stack";
 * the layout itself is CSS and applies below 900 px. Tables holding form fields are left as they are.
 */
export function PhoneTables() {
  const path = usePathname();
  useEffect(() => {
    const mark = () => {
      document.querySelectorAll<HTMLTableElement>(".main table").forEach((t) => {
        const ths = [...t.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
        if (ths.length < 5 || t.querySelector("tbody input, tbody select, tbody textarea")) return;
        t.classList.add("stack");
        t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (ths[i]) td.setAttribute("data-label", ths[i]); }));
      });
    };
    mark();
    const main = document.querySelector(".main");
    if (!main) return;
    const ob = new MutationObserver(mark);
    ob.observe(main, { childList: true, subtree: true });
    return () => ob.disconnect();
  }, [path]);
  return null;
}
