// No server imports: used by the client Help link in the header.
/** Which guide fits the screen at this path (longest matching prefix). */
export const SCREEN_TOPIC: [string, string][] = [
  ["/enquiries", "enquiries"], ["/customers", "customers"], ["/vehicles", "customers"], ["/jobs/", "job-card"], ["/jobs", "job-card"],
  ["/bookings", "bookings"], ["/approvals", "approvals"], ["/workshop/runs", "runs"], ["/workshop/keys", "key-drop"], ["/workshop/time", "workshop-board"], ["/workshop/tablets", "workshop-board"], ["/hr/machines", "attendance"], ["/feedback", "feedback"], ["/complaints", "feedback"], ["/workshop", "workshop-board"], ["/my-jobs", "my-jobs"],
  ["/stock/queue", "store-queue"], ["/stock/reorder", "low-stock"], ["/stock/planning", "planning"], ["/stock/transfers", "transfers"], ["/stock/adjustments", "counts"], ["/stock/counts", "counts"], ["/stock", "stock"],
  ["/purchasing/bills", "supplier-bills"], ["/purchasing/petty-cash", "petty-cash"], ["/purchasing/direct", "buy-for-job"], ["/purchasing", "purchase-orders"],
  ["/invoices", "invoicing"], ["/billing/counter-sale", "counter-sale"], ["/billing/quick", "invoicing"], ["/billing/advances", "advances"], ["/billing/cheques", "cheques"], ["/billing/credit-notes", "credit-notes"], ["/billing/cash", "cash-closing"],
  ["/accounts/ledger", "vouchers"], ["/accounts/vouchers", "vouchers"], ["/accounts/day-book", "vouchers"], ["/accounts/journal", "vouchers"],
  ["/accounts/receivables", "receivables-payables"], ["/accounts/payables", "receivables-payables"], ["/accounts/statement", "receivables-payables"],
  ["/accounts/bank", "bank"], ["/accounts/vat", "vat"], ["/accounts/periods", "month-end"], ["/accounts/opening", "month-end"], ["/accounts/assets", "month-end"],
  ["/accounts/budgets", "month-end"], ["/accounts/allocation", "month-end"], ["/accounts", "statements"],
  ["/me", "my-hr"], ["/hr/employees", "employees"], ["/hr/attendance", "attendance"], ["/hr/roster", "attendance"], ["/hr/qr", "attendance"], ["/hr/leave", "leave"], ["/hr/overtime", "leave"],
  ["/hr/letters", "letters"], ["/hr/recruitment", "recruitment"], ["/hr/transfers", "employees"], ["/hr", "employees"],
  ["/payroll/revisions", "salary-loans"], ["/payroll/loans", "salary-loans"], ["/payroll/settlements", "settlements"], ["/payroll", "payroll"],
  ["/owner", "owner-dashboard"], ["/reports/builder", "report-builder"], ["/reports/archive", "archive"], ["/reports", "reports"],
  ["/admin/users", "users"], ["/admin/roles", "roles-admin"], ["/admin/audit", "audit"], ["/admin", "setup"],
];
export function topicForPath(path: string): string | null {
  if (path === "/" || path === "/search") return "my-day";
  if (/^\/jobs\/[^/]+\/invoice$/.test(path)) return "invoicing";
  if (/\/credit-note$/.test(path)) return "credit-notes";
  const hit = SCREEN_TOPIC.filter(([p]) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/")).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}
