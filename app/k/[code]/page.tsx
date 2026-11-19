import { keydropBranch, keydropOptions } from "@/lib/services/keydrop";
import { keyDropSubmitAction } from "@/app/actions-front";
import { KeyDropForm } from "@/components/KeyDropForm";

export const dynamic = "force-dynamic";

/** Opened from the QR code on the key box: the customer checks the car in on their phone, no app. */
export default async function KeyDrop({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const b = await keydropBranch(code);
  if (!b) return <main className="public"><div className="card">This QR code is not valid any more. Please call the branch.</div></main>;
  const o = await keydropOptions(b.id);
  return (
    <main className="public" style={{ maxWidth: 560 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sflogo.png" alt="Superfix" width={82} height={44} />
        <h1 style={{ marginTop: 8 }}>After-hours key drop</h1>
        <p className="sub">Superfix {b.name_en}. Fill this in, then drop your key in the box. No app is needed.{b.phone ? ` Questions: ${b.phone}.` : ""}</p>
        <KeyDropForm code={code} plates={o.plates} action={keyDropSubmitAction} />
      </div>
    </main>
  );
}
