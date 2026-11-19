"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type Alert = { group: string; text: string; sub?: string; href: string; tone: "r" | "a" | "b" };

/** The bell in the top bar: a count, and a drop-down of this person's alerts grouped by kind. */
export function Bell({ alerts }: { alerts: Alert[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (ref.current) ref.current.open = false; setOpen(false); }, [path]);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) { ref.current.open = false; setOpen(false); } };
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, []);
  const groups = [...new Set(alerts.map((a) => a.group))];
  return (
    <details className="bell" ref={ref} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary aria-label={`Alerts: ${alerts.length}`} title="Alerts"><Icon name="bell" size={20} />{alerts.length > 0 && <span className="bdg">{alerts.length}</span>}</summary>
      {open && <div className="bell-pop">
        <div className="bell-h"><b>Alerts</b><span className="muted small">only the ones for your role</span></div>
        {groups.length === 0 && <p className="muted small" style={{ padding: "6px 16px 14px" }}>Nothing needs you right now.</p>}
        {groups.map((g) => (
          <div key={g}>
            <h4>{g} ({alerts.filter((a) => a.group === g).length})</h4>
            {alerts.filter((a) => a.group === g).map((a, i) => (
              <Link key={i} href={a.href} className="bell-row"><span className={`dot ${a.tone}`} /><span><b>{a.text}</b>{a.sub && <small>{a.sub}</small>}</span></Link>
            ))}
          </div>
        ))}
      </div>}
    </details>
  );
}
