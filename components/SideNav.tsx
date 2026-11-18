"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";


/** Simple line icons for the menu groups (24px grid, stroke drawn with currentColor). */
const ICONS: Record<string, string> = {
  "front-office": "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  workshop: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  parts: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  purchasing: "M6 6h15l-1.5 9h-12zM6 6 5 3H2m5 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  billing: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4",
  accounting: "M4 20V10m6 10V4m6 16v-7m6 7H2",
  hr: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  payroll: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01",
  reports: "M3 3v18h18M7 15l4-4 3 3 5-6",
  administration: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
};
const Icon = ({ k }: { k: string }) => (
  <svg className="nicon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[k] ?? ICONS.help} /></svg>
);

export type NavItem = { href: string; label: string; badge?: number };
export type NavGroup = { key: string; label: string; items: NavItem[] };

/**
 * Left menu: one expandable group per module, accordion style. Only the group holding the current
 * page starts open; opening a group closes the others.
 */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  // The most specific match wins, so /stock/transfers opens Parts, not a group that only links /stock.
  const best = groups.flatMap((g) => g.items.filter((i) => isActive(i.href)).map((i) => ({ g: g.key, len: i.href.length }))).sort((a, b) => b.len - a.len)[0];
  const activeKey = best?.g ?? null;
  const [openKey, setOpenKey] = useState<string | null>(activeKey);
  useEffect(() => {
    setOpenKey(activeKey);
    // On phones the menu is a drop-down: close it after moving to another page.
    const t = document.getElementById("navtoggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [path, activeKey]);
  return (
    <nav className="nav" aria-label="Main menu">
      {groups.map((g) => {
        const open = openKey === g.key;
        const badge = g.items.reduce((n, i) => n + (i.badge ?? 0), 0);
        const id = `nav-${g.key}`;
        return (
          <div key={g.key} className={`navgrp${open ? " open" : ""}${activeKey === g.key ? " here" : ""}`}>
            <button type="button" className="grp" aria-expanded={open} aria-controls={id} onClick={() => setOpenKey(open ? null : g.key)} title={open ? "Close" : "Open"}>
              <Icon k={g.key} />{g.label}
              {!open && badge > 0 && <span className="badge">{badge}</span>}
              <span className="chev" aria-hidden>›</span>
            </button>
            {open && (
              <div id={id} className="navitems">
                {g.items.map((i) => {
                  const on = isActive(i.href) && best?.len === i.href.length && activeKey === g.key;
                  return <Link key={i.href} href={i.href} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>
                    {i.label}{i.badge ? <span className="badge">{i.badge}</span> : null}
                  </Link>;
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
