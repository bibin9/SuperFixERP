/**
 * Records kept on the employee file (FSD 4.13). One registry declares the fields of each kind so
 * the employee page, the expiry alerts and the reports read the same definition. A field marked
 * `expiry` fills the record's expiry date (alerts at 60, 30 and 7 days); `amount` and `month` feed
 * payroll (a disciplinary deduction is taken in the chosen month, within the legal limit).
 */
export type RField = {
  name: string; label: string; type: "text" | "date" | "number" | "select" | "month" | "textarea";
  required?: boolean; options?: [string, string][]; lookup?: string; role?: "expiry" | "amount" | "month";
};
export type RKind = { kind: string; title: string; requirement: string; fields: RField[]; closeLabel?: string; summary: (d: Record<string, string>) => string };

export const RECORD_KINDS: RKind[] = [
  { kind: "document", title: "Documents", requirement: "HR-02",
    fields: [
      { name: "doc_type", label: "Document", type: "select", lookup: "hr_document_type", required: true },
      { name: "number", label: "Number", type: "text", required: true },
      { name: "issue_date", label: "Issued on", type: "date" },
      { name: "expiry_date", label: "Expires on", type: "date", role: "expiry" },
    ], summary: (d) => `${d.doc_type_label ?? d.doc_type} ${d.number ?? ""}` },
  { kind: "insurance", title: "Insurance", requirement: "HR-07",
    fields: [
      { name: "provider", label: "Provider", type: "text", required: true },
      { name: "policy_no", label: "Policy no.", type: "text", required: true },
      { name: "card_no", label: "Card no.", type: "text" },
      { name: "category", label: "Category", type: "select", lookup: "insurance_category", required: true },
      { name: "start_date", label: "Starts", type: "date", required: true },
      { name: "expiry_date", label: "Expires", type: "date", role: "expiry", required: true },
      { name: "premium", label: "Premium (AED a year)", type: "number", role: "amount" },
      { name: "dependants", label: "Dependants covered", type: "text" },
    ], summary: (d) => `${d.provider} · ${d.policy_no}` },
  { kind: "air_ticket", title: "Air ticket entitlement", requirement: "HR-08",
    fields: [
      { name: "cycle_years", label: "Every", type: "select", options: [["1", "1 year"], ["2", "2 years"]], required: true },
      { name: "sector", label: "Sector", type: "text", required: true },
      { name: "ticket_amount", label: "Ticket amount (AED)", type: "number", role: "amount", required: true },
      { name: "last_used", label: "Last used on", type: "date" },
    ], summary: (d) => `${d.sector}, every ${d.cycle_years} year(s)` },
  { kind: "visa", title: "Visa and labour process", requirement: "HR-16", closeLabel: "Completed",
    fields: [
      { name: "process_type", label: "Process", type: "select", options: [["new", "New visa"], ["renewal", "Renewal"], ["cancellation", "Cancellation"]], required: true },
      { name: "step", label: "Current step", type: "select", options: [["entry_permit", "Entry permit"], ["medical", "Medical"], ["emirates_id", "Emirates ID"], ["labour_contract", "Labour contract"], ["stamping", "Visa stamping"], ["cancelled", "Cancelled"], ["done", "Done"]], required: true },
      { name: "cost", label: "Cost (AED)", type: "number", role: "amount" },
      { name: "responsible", label: "Person responsible", type: "text", required: true },
      { name: "expiry_date", label: "Visa expires", type: "date", role: "expiry" },
    ], summary: (d) => `${d.process_type_label ?? d.process_type}: ${d.step_label ?? d.step}` },
  { kind: "asset", title: "Company assets issued", requirement: "HR-17", closeLabel: "Returned and checked",
    fields: [
      { name: "asset_name", label: "Asset", type: "select", lookup: "hr_asset_type", required: true },
      { name: "serial", label: "Serial / tag", type: "text" },
      { name: "issue_date", label: "Issued on", type: "date", required: true },
      { name: "condition", label: "Condition when issued", type: "text" },
    ], summary: (d) => `${d.asset_name_label ?? d.asset_name} ${d.serial ?? ""}` },
  { kind: "disciplinary", title: "Warnings and disciplinary", requirement: "HR-18",
    fields: [
      { name: "warning_type", label: "Type", type: "select", options: [["verbal", "Verbal warning"], ["written", "Written warning"], ["final", "Final warning"], ["deduction", "Deduction"]], required: true },
      { name: "incident_date", label: "Date", type: "date", required: true },
      { name: "details", label: "Details", type: "textarea", required: true },
      { name: "deduction", label: "Deduction from salary (AED)", type: "number", role: "amount" },
      { name: "deduct_month", label: "Deduct in month", type: "month", role: "month" },
    ], summary: (d) => `${d.warning_type_label ?? d.warning_type} on ${String(d.incident_date ?? "").split("-").reverse().join("/")}` },
  { kind: "review", title: "Performance reviews", requirement: "HR-19",
    fields: [
      { name: "period", label: "Period", type: "text", required: true },
      { name: "kpis", label: "KPIs and results", type: "textarea", required: true },
      { name: "rating", label: "Rating", type: "select", options: [["5", "5 · Outstanding"], ["4", "4 · Exceeds"], ["3", "3 · Meets"], ["2", "2 · Needs improvement"], ["1", "1 · Unsatisfactory"]], required: true },
      { name: "comments", label: "Manager comments", type: "textarea" },
    ], summary: (d) => `${d.period}: rating ${d.rating}` },
  { kind: "training", title: "Training and certificates", requirement: "HR-20",
    fields: [
      { name: "course", label: "Course", type: "text", required: true },
      { name: "provider", label: "Provider", type: "text" },
      { name: "completed_on", label: "Completed on", type: "date", required: true },
      { name: "expiry_date", label: "Certificate expires", type: "date", role: "expiry" },
    ], summary: (d) => `${d.course}${d.provider ? ` (${d.provider})` : ""}` },
];
export const recordKind = (k: string) => RECORD_KINDS.find((x) => x.kind === k);
