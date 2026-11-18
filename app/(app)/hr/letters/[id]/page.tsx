import { requireCtx } from "@/lib/session";
import { getLetter } from "@/lib/services/hr";
import { notFound } from "@/lib/errors";
import { Flash, PageHead } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export default async function Letter({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { letter: l } = await getLetter(ctx, id);
  if (l.status !== "approved") throw notFound("Letter");
  const ar = l.language === "ar";
  return (
    <>
      <div className="no-print"><PageHead title={`${l.template} · ${l.ref_no}`} sub={`${l.emp_no} ${l.full_name}`}><PrintButton /></PageHead><Flash sp={sp} /></div>
      <div className="card doc" dir={ar ? "rtl" : "ltr"} style={{ maxWidth: 760, margin: "0 auto", padding: 40 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sflogo.png" alt="Superfix" width={100} height={54} />
        <p className="small" style={{ textAlign: ar ? "left" : "right" }}>Ref {l.ref_no}</p>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{l.body}</div>
        <p style={{ marginTop: 48 }}>{ar ? "الموارد البشرية" : "Human Resources"}<br />Super Fix Auto Centers · {l.branch_name}{l.phone ? ` · ${l.phone}` : ""}</p>
      </div>
    </>
  );
}
