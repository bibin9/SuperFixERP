// Line icons used across the app (24px grid, stroke in currentColor).
const P: Record<string, string> = {
  home: "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  cal: "M4 5h16v16H4zM4 10h16M9 3v4M15 3v4",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  job: "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8 11h8M8 15h5",
  check: "M20 6 9 17l-5-5",
  board: "M4.5 3h4a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3zM15.5 3h4A1.5 1.5 0 0 1 21 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 12.5v-8A1.5 1.5 0 0 1 15.5 3z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  truck: "M1 4h14v12H1zM15 9h4l3 3v4h-7M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  box: "M21 8 12 3 3 8l9 5zM3 8v8l9 5 9-5V8M12 13v8",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  swap: "M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4",
  part: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  cart: "M9 21.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 21.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6",
  bill: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6",
  cash: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  wallet: "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l3-4h10l2 4M16 13.5h.01",
  cheque: "M2 6h20v12H2zM6 10h8M6 14h5M16 14h2",
  undo: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  lock: "M4 11h16v10H4zM8 11V7a4 4 0 0 1 8 0v4",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  bars: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  ledger: "M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z",
  bank: "M3 10 12 4l9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18",
  percent: "M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  dash: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5",
  plane: "M2 16l20-8-20-8 4 8zM6 8h8",
  briefcase: "M3 7h18v13H3zM8 7V4h8v3",
  pay: "M2 6h20v12H2zM6 12h.01M18 12h.01M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  trend: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  hand: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  exit: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  build: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  branch: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  form: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h4",
  flow: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  map: "M1 6v16l7-4 8 4 7-4V2l-7 4-8-4zM8 2v16M16 6v16",
  arrow: "M5 12h14M13 6l6 6-6 6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  wa: "M20.5 3.5A11 11 0 0 0 3.3 17.1L2 22l5-1.3A11 11 0 0 0 20.5 3.5z",
  car: "M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-5l2-5h14l2 5v5M5 12h14",
  phone: "M6 2h12v20H6zM11 18h2",
  plus: "M12 5v14M5 12h14",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  thumbs: "M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 8a2 2 0 0 1-2 1.7H7V10l4-8a3 3 0 0 1 4 3.9z",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
};

export function Icon({ name, size = 19, className = "nicon" }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.doc} />
    </svg>
  );
}

const BY_HREF: [string, string][] = [
  ["/my-day", "star"], ["/enquiries", "chat"], ["/bookings", "cal"], ["/customers", "users"], ["/jobs", "job"], ["/approvals", "check"], ["/feedback", "star"],
  ["/workshop/runs", "truck"], ["/workshop/time", "clock"], ["/workshop/tablets", "phone"], ["/workshop/keys", "key"], ["/workshop", "board"], ["/my-jobs", "build"], ["/complaints", "alert"],
  ["/stock/planning", "list"], ["/stock/reorder", "alert"], ["/stock/queue", "part"], ["/stock/transfers", "swap"], ["/stock/adjustments", "sliders"], ["/stock", "box"],
  ["/purchasing/bills", "bill"], ["/purchasing/petty-cash", "wallet"], ["/purchasing/direct", "tag"], ["/purchasing/quotes", "bars"], ["/purchasing", "cart"],
  ["/invoices", "doc"], ["/billing/counter-sale", "tag"], ["/billing/quick", "doc"], ["/billing/trade", "truck"], ["/billing/fleet", "briefcase"], ["/billing/advances", "hand"], ["/billing/cheques", "cheque"],
  ["/billing/credit-notes", "undo"], ["/billing/cash", "cash"],
  ["/accounts/ledger", "ledger"], ["/accounts/receivables", "trend"], ["/accounts/payables", "exit"], ["/accounts/bank", "bank"], ["/accounts/vat", "percent"],
  ["/accounts/periods", "lock"], ["/accounts", "bars"],
  ["/me", "user"], ["/hr/employees", "users"], ["/hr/attendance", "clock"], ["/hr/leave", "plane"], ["/hr/letters", "doc"], ["/hr/recruitment", "briefcase"], ["/hr/visas", "globe"], ["/hr", "dash"],
  ["/payroll/revisions", "trend"], ["/payroll/loans", "hand"], ["/payroll/settlements", "exit"], ["/payroll", "pay"],
  ["/reports/all", "list"], ["/reports/saved", "doc"], ["/reports/builder", "build"], ["/reports/inbox", "inbox"], ["/reports/archive", "archive"], ["/reports", "chart"],
  ["/admin/branches", "branch"], ["/admin/users", "users"], ["/admin/roles", "shield"], ["/admin/masters", "form"], ["/admin/bundles", "box"], ["/admin/import", "upload"], ["/admin/workflows", "flow"],
  ["/admin/numbering", "hash"], ["/admin/settings", "cog"], ["/admin/audit", "eye"],
  ["/help", "help"], ["/", "home"],
];
export function iconFor(href: string) {
  const p = href.split("#")[0];
  if (href.includes("#flows")) return "flow";
  return BY_HREF.find(([h]) => (h === "/" ? p === "/" : p === h || p.startsWith(h + "/")))?.[1] ?? "doc";
}
