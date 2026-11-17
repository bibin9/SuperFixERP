import { headers } from "next/headers";
import { publicInvoice } from "@/lib/services/billing";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** The customer's copy of a posted invoice, opened from the link staff send on WhatsApp. */
export default async function PublicInvoice({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await publicInvoice(token);
  if (!data) return <div className="public"><div className="card">This link is not valid.</div></div>;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") === "https" ? "https" : "http"}://${h.get("host") ?? "localhost:3000"}`;
  return (
    <div className="public wide">
      <div className="no-print" style={{ marginBottom: 10 }}><PrintButton label="Print or save as PDF" /></div>
      <InvoiceDoc i={data.invoice} lines={data.lines} link={`${origin}/i/${token}`} />
    </div>
  );
}
