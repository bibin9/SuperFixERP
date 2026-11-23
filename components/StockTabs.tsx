import Link from "next/link";

const TABS: [string, string][] = [["/stock", "Stock on hand"], ["/stock/planning", "Planning and back orders"], ["/stock/queue", "Store queue"], ["/stock/tyres", "Tyres and batteries"], ["/stock/transfers", "Transfer orders"], ["/stock/adjustments", "Adjustments and counts"]];

export function StockTabs({ at }: { at: string }) {
  return <div className="tabs">{TABS.map(([h, l]) => <Link key={h} className={at === h ? "on" : ""} href={h}>{l}</Link>)}</div>;
}
