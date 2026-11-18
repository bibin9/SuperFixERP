"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { markPhoneTables } from "@/lib/phone-tables";

/** Keeps phone list labels (see lib/phone-tables.ts) in step after client-side navigation and refreshes. */
export function PhoneTables() {
  const path = usePathname();
  useEffect(() => {
    markPhoneTables();
    const main = document.querySelector(".main");
    if (!main) return;
    const ob = new MutationObserver(markPhoneTables);
    ob.observe(main, { childList: true, subtree: true });
    return () => ob.disconnect();
  }, [path]);
  return null;
}
