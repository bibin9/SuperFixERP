"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, iconFor } from "@/components/Icon";

export type NavItem = { href: string; label: string; badge?: number; badgeText?: string };
export type NavGroup = { key: string; label: string; items: NavItem[] };

/**
 * Left menu: section headings (FRONT OFFICE, WORKSHOP ...) that open like an accordion. Only the section
 * holding the current screen is open; clicking a heading opens that section and closes the others.
 * The current screen is marked in Superfix red.
 */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const isActive = (h: string) => { const href = h.split("?")[0]; return (href === "/" ? path === "/" : path === href || path.startsWith(href.split("#")[0] + "/") || path === href.split("#")[0]); };
  // The most specific match wins, so /stock/transfers marks Transfer orders, not Stock on hand.
  const best = groups.flatMap((g) => g.items.filter((i) => isActive(i.href) && !i.href.includes("#")).map((i) => ({ href: i.href, len: i.href.length }))).sort((a, b) => b.len - a.len)[0];
  const here = groups.find((g) => g.items.some((i) => i.href === best?.href))?.key ?? groups[0]?.key;
  const [open, setOpen] = useState<string | null>(here ?? null);
  useEffect(() => { setOpen(here ?? null); }, [here]);
  useEffect(() => {
    // On phones the menu is a drop-down: close it after moving to another page.
    const t = document.getElementById("navtoggle") as HTMLInputElement | null;
    if (t) t.checked = false;
    document.querySelector(".nav a.on")?.scrollIntoView({ block: "nearest" });
  }, [path]);
  return (
    <nav className="nav" aria-label="Main menu">
      {groups.map((g) => (
        <div key={g.key} className={`navsec${open === g.key ? " open" : ""}`}>
          <button type="button" className="grp" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
            <span>{g.label}</span>
            {open !== g.key && g.items.some((i) => i.badge || i.badgeText) && <span className="dot" aria-label="Has items waiting" />}
            <span className="chev" aria-hidden="true">›</span>
          </button>
          <div className="navitems" hidden={open !== g.key}>
          {g.items.map((i) => {
            const on = best?.href === i.href;
            return (
              <Link key={i.href} href={i.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                <Icon name={iconFor(i.href)} /><span>{i.label}</span>
                {i.badgeText ? <span className="badge">{i.badgeText}</span> : i.badge ? <span className="badge">{i.badge}</span> : null}
              </Link>
            );
          })}
          </div>
        </div>
      ))}
    </nav>
  );
}
