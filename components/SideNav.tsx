"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Icon, iconFor } from "@/components/Icon";

export type NavItem = { href: string; label: string; badge?: number; badgeText?: string };
export type NavGroup = { key: string; label: string; items: NavItem[] };

/**
 * Left menu: section headings (FRONT OFFICE, WORKSHOP ...) with one line per screen, each with its icon.
 * The current screen is marked in Superfix red.
 */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href.split("#")[0] + "/") || path === href.split("#")[0]);
  // The most specific match wins, so /stock/transfers marks Transfer orders, not Stock on hand.
  const best = groups.flatMap((g) => g.items.filter((i) => isActive(i.href) && !i.href.includes("#")).map((i) => ({ href: i.href, len: i.href.length }))).sort((a, b) => b.len - a.len)[0];
  useEffect(() => {
    // On phones the menu is a drop-down: close it after moving to another page.
    const t = document.getElementById("navtoggle") as HTMLInputElement | null;
    if (t) t.checked = false;
    document.querySelector(".nav a.on")?.scrollIntoView({ block: "nearest" });
  }, [path]);
  return (
    <nav className="nav" aria-label="Main menu">
      {groups.map((g) => (
        <div key={g.key} className="navsec">
          <div className="grp">{g.label}</div>
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
      ))}
    </nav>
  );
}
