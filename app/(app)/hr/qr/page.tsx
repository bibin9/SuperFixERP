import { requireCtx } from "@/lib/session";
import { branchQr } from "@/lib/services/hr-time";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { PageHead, d } from "@/components/ui";
import { forbidden } from "@/lib/errors";

/** The branch screen: today's QR code for staff check-in. It changes every day. */
export default async function BranchQr() {
  const ctx = await requireCtx();
  if (!ctx.currentBranchId) throw forbidden("Choose a branch first.");
  const q = await branchQr(ctx, ctx.currentBranchId);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const url = `${origin}/me/check-in?branch=${q.code}&code=${q.qr}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 320 });
  return (
    <>
      <PageHead title={`Check-in code · ${q.name}`} sub={`For ${d(q.today)}. Staff scan it with their phone and sign in; the code changes every day.`} />
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ display: "inline-block", width: 320 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="small muted">Code {q.qr}</p>
      </div>
    </>
  );
}
