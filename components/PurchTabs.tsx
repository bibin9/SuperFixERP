import Link from "next/link";

const TABS: [string, string][] = [["/purchasing", "Purchase orders"], ["/purchasing/bills", "Supplier bills"], ["/purchasing/petty-cash", "Petty cash"], ["/admin/masters/suppliers", "Suppliers"]];

export function PurchTabs({ at }: { at: string }) {
  return <div className="tabs">{TABS.map(([h, l]) => <Link key={h} className={at === h ? "on" : ""} href={h}>{l}</Link>)}</div>;
}
