import Link from "next/link";

const TABS: [string, string][] = [["/purchasing", "Purchase orders"], ["/purchasing/rfq", "Price requests"], ["/purchasing/claims", "Warranty claims"], ["/purchasing/bills", "Supplier bills"], ["/purchasing/petty-cash", "Petty cash"], ["/purchasing/direct", "Buy for a job"], ["/admin/masters/suppliers", "Suppliers"]];

export function PurchTabs({ at }: { at: string }) {
  return <div className="tabs">{TABS.map(([h, l]) => <Link key={h} className={at === h ? "on" : ""} href={h}>{l}</Link>)}</div>;
}
