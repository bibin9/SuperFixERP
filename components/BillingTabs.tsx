import Link from "next/link";

const TABS: [string, string][] = [["/invoices", "Invoices"], ["/billing/counter-sale", "Counter sale"], ["/billing/trade", "Trade orders"], ["/billing/quick", "Quick job"], ["/billing/advances", "Advances"], ["/billing/cheques", "Cheques"],
  ["/billing/credit-notes", "Credit notes"], ["/billing/cash", "Cash closing"]];

export function BillingTabs({ at }: { at: string }) {
  return <div className="tabs no-print">{TABS.map(([h, l]) => <Link key={h} className={at === h ? "on" : ""} href={h}>{l}</Link>)}</div>;
}
