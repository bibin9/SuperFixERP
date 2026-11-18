"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { topicForPath } from "@/lib/help/screens";

/** "Help" in the top bar: opens the guide for the screen you are on. */
export function HelpLink() {
  const path = usePathname() ?? "/";
  if (path.startsWith("/help")) return null;
  const slug = topicForPath(path);
  return <Link className="btn ghost sm helplink" href={slug ? `/help/${slug}` : "/help"} title="Open the user guide for this screen">? Help</Link>;
}
