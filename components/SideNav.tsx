"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
              {g.label}
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
