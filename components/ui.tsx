import Link from "next/link";
import { fmtAED } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/services/jobs";

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.err === "string" ? sp.err : null;
  return (
    <>
      {ok && <div className="flash ok">{ok}</div>}
      {err && <div className="flash err">{err}</div>}
    </>
  );
}

export function Money({ v }: { v: string | number | null | undefined }) {
  if (v === undefined) return <span className="muted">hidden</span>;
  return <span className="num">{fmtAED(v)}</span>;
}

const STATUS_COLOR: Record<string, string> = {
  booked: "", quoted: "amber", approved: "green", prepared: "amber", sent_manually: "green", awaiting_parts: "amber", in_progress: "violet",
  quality_check: "violet", ready: "green", delivered: "green", invoiced: "grey", closed: "grey", cancelled: "red",
  sent: "amber", ready_to_send: "", draft: "grey", pending_internal_approval: "amber", partly_approved: "green", declined: "red", expired: "grey", superseded: "grey",
  open: "amber", converted: "green", lost: "red", pending: "amber", rejected: "red", sent_back: "amber",
  pending_approval: "amber", posted: "green", held: "amber", cleared: "green", bounced: "red", submitted: "amber", signed_off: "green",
  settled: "green", overdue: "red",
};

const WORDS: Record<string, string> = {
  whatsapp: "WhatsApp", whatsapp_reply: "WhatsApp reply", whatsapp_link: "WhatsApp link", walk_in: "Walk-in", in_person: "In person",
  sms: "SMS", email: "Email", lpo: "LPO", vat: "VAT", trn: "TRN", job_no: "Job number", doc_no: "Document number", max_pct: "Maximum %",
  sent_manually: "Sent manually", job_card: "Job card", credit_note: "Credit note", purchase_order: "Purchase order",
};
/** Plain words for stored codes such as walk_in or whatsapp_reply. Free text is returned unchanged. */
export const label = (v: string | null | undefined) => {
  if (!v) return "";
  if (WORDS[v]) return WORDS[v];
  if (STATUS_LABEL[v]) return STATUS_LABEL[v];
  if (!/^[a-z]+(_[a-z]+)*$/.test(v)) return v;
  return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()).replace(/\bwhatsapp\b/gi, "WhatsApp");
};

export function Status({ s }: { s: string }) {
  const label = STATUS_LABEL[s] ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return <span className={`pill ${STATUS_COLOR[s] ?? ""}`}>{label}</span>;
}

export const plate = (v: { registered_in?: string; plate_code?: string | null; plate_number?: string }) =>
  `${v.registered_in ?? ""} ${v.plate_code ?? ""} ${v.plate_number ?? ""}`.replace(/\s+/g, " ").trim();

export const custName = (r: { customer_type?: string; title?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }) =>
  r.customer_type === "individual" ? [r.title, r.first_name, r.last_name].filter(Boolean).join(" ") : `M/s. ${r.company_name ?? ""}`;

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "center", marginBottom: 14 }}>
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      <div className="shrink" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

export const dt = (v: string | Date | null | undefined) =>
  v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v)) : "";
export const d = (v: string | null | undefined) => (v ? v.split("-").reverse().join("/") : "");

export { Link };
