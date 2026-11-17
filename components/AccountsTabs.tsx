import Link from "next/link";

const GROUPS: Record<string, [string, string][]> = {
  statements: [["/accounts", "Trial balance"], ["/accounts/pl", "Profit and loss"], ["/accounts/bs", "Balance sheet"], ["/accounts/cash-flow", "Cash flow"], ["/accounts/budgets", "Budget against actual"]],
  books: [["/accounts/ledger", "Ledger"], ["/accounts/day-book", "Day book"], ["/accounts/statement", "Party statement"], ["/accounts/vouchers", "Vouchers"]],
  parties: [["/accounts/receivables", "Receivables"], ["/accounts/payables", "Payables"], ["/accounts/payables/pay", "Pay a supplier"], ["/accounts/payables/payments", "Payments and cheques issued"]],
  monthend: [["/accounts/periods", "Period close"], ["/accounts/allocation", "Head-office allocation"], ["/accounts/assets", "Fixed assets"], ["/accounts/opening", "Opening balances"]],
};

export function AccountsTabs({ group, at }: { group: keyof typeof GROUPS; at: string }) {
  return <div className="tabs no-print">{GROUPS[group].map(([h, l]) => <Link key={h} className={at === h ? "on" : ""} href={h}>{l}</Link>)}</div>;
}
