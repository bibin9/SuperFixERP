// The in-app user guide: topics (step-by-step pages) and process flows (diagrams).
// Text supports **bold** for button and field names and [label](/path) for links into the app.

export type HelpAccess = "all" | "customers" | "jobs" | "workshop" | "stock" | "purchasing" | "invoices"
  | "accounting" | "hr" | "settings" | "admin" | "audit" | "approvals" | "technician" | "payroll" | "reports";

export type HelpPart = { h: string; intro?: string; steps?: string[]; tips?: string[] };

export type HelpTopic = {
  slug: string;
  group: string;
  title: string;
  summary: string;
  who: string;
  access: HelpAccess[];
  open?: { label: string; href: string };
  parts: HelpPart[];
  flows?: string[];
};

export type FlowStep = { who: string; what: string; where?: string; note?: string };
export type HelpFlow = { slug: string; title: string; summary: string; access: HelpAccess[]; steps: FlowStep[]; after?: string[]; topics?: string[] };

export const GROUPS = ["Getting started", "Front office", "Workshop", "Parts", "Purchasing", "Billing", "Accounting", "HR", "Payroll", "Reports", "Administration"];
