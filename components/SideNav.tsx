"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type NavItem = { href: string; label: string; badge?: number };
export type NavGroup = { key: string; label: string; items: NavItem[] };

const STORE = "sf.nav.collapsed";

/** Left menu with collapsible groups. The group holding the current page always opens; other choices are remembered. */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // On phones the menu is a drop-down: close it after moving to another page.
    const t = document.getElementById("navtoggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [path]);
  useEffect(() => {
    try { setCollapsed(JSON.parse(localStorage.getItem(STORE) || "{}")); } catch { /* ignore a bad stored value */ }
  }, []);
  const toggle = (key: string, open: boolean) => {
    const next = { ...collapsed, [key]: open };
    setCollapsed(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* storage may be blocked */ }
  };
  return (
    <nav className="nav" aria-label="Main menu">
      {groups.map((g) => {
        const hasActive = g.items.some((i) => isActive(i.href));
        const open = hasActive || !collapsed[g.key];
        const badge = g.items.reduce((n, i) => n + (i.badge ?? 0), 0);
        const id = `nav-${g.key}`;
        return (
          <div key={g.key} className={`navgrp${open ? " open" : ""}`}>
            <button type="button" className="grp" aria-expanded={open} aria-controls={id} onClick={() => toggle(g.key, open)} disabled={hasActive} title={hasActive ? "Contains the page you are on" : open ? "Collapse" : "Expand"}>
              {g.label}
              {!open && badge > 0 && <span className="badge">{badge}</span>}
              <span className="chev" aria-hidden>›</span>
            </button>
            {open && (
              <div id={id}>
                {g.items.map((i) => (
                  <Link key={i.href} href={i.href} className={isActive(i.href) ? "active" : undefined} aria-current={isActive(i.href) ? "page" : undefined}>
                    {i.label}{i.badge ? <span className="badge">{i.badge}</span> : null}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
