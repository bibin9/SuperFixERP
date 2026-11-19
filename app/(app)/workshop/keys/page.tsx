import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireCtx } from "@/lib/session";
import { listKeyDrops, keydropCode } from "@/lib/services/keydrop";
import { newKeydropCodeAction } from "@/app/actions-front";
import { can } from "@/lib/access";
import { Flash, Link, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PrintButton } from "@/components/PrintButton";

/** After-hours key drop: the keys waiting for check-in, and the QR code to print for the key box. */
export default async function KeyDrops({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const list = await listKeyDrops(ctx, sp.all === "1");
  const b = await keydropCode(ctx);
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}/k/${b.keydrop_code}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
  const waiting = list.filter((k) => k.status === "waiting");
  const manage = !!ctx.currentBranchId && (can(ctx, "settings", "edit", ctx.currentBranchId) || can(ctx, "workshop", "edit", ctx.currentBranchId));
  return (
    <>
      <PageHead title="After-hours key drop" sub="Customers who came after closing: they scanned the QR code on the key box, filled the form on their phone and dropped the key. Check them in each morning." />
      <Flash sp={sp} />
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(260px,1fr)" }}>
        <div className="card">
          <h2>Waiting for check-in ({waiting.length})</h2>
          {list.length ? <div className="cardgrid">
            {list.map((k) => (
              <Link key={k.id} href={`/workshop/keys/${k.id}`} className={`lcard${k.status !== "waiting" ? " done" : ""}`}>
                <div className="small muted">{k.doc_no} · {k.at}{k.key_slot ? ` · slot ${k.key_slot}` : ""}</div>
                <b>{k.title ? `${k.title} ` : ""}{k.name}</b>
                <div className="small">{[k.registered_in, k.plate_code, k.plate_number].filter(Boolean).join(" ")}{k.make_model ? ` · ${k.make_model}` : ""}</div>
                <div className="small muted">&ldquo;{k.service_asked}&rdquo;{k.photos ? ` · ${k.photos} photo${k.photos === 1 ? "" : "s"}` : ""} · signed on phone</div>
                {k.status === "waiting" ? <span className="btn sm" style={{ marginTop: 8 }}>Check in</span>
                  : k.status === "checked_in" ? <span className="pill green" style={{ marginTop: 8 }}>Checked in · {k.enquiry_no}</span> : <span className="pill grey" style={{ marginTop: 8 }}>Cancelled</span>}
              </Link>
            ))}
          </div> : <p className="muted small">No keys in the drop box.</p>}
          <p className="small"><Link href={sp.all === "1" ? "/workshop/keys" : "/workshop/keys?all=1"}>{sp.all === "1" ? "Show only recent" : "Show all key drops"}</Link></p>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <h2>QR code for the key box</h2>
          <div style={{ display: "inline-block", width: 240 }} dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="small">Print it and stick it on the key box at {b.name_en}. It opens the form in the phone browser; no app is needed.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <PrintButton />
            <Link className="btn ghost sm" href={`/k/${b.keydrop_code}`} target="_blank">Open the customer form</Link>
          </div>
          {manage && <form action={newKeydropCodeAction} style={{ marginTop: 10 }}><ConfirmButton className="btn ghost sm" message="Make a new QR code? The printed one stops working.">Make a new QR code</ConfirmButton></form>}
        </div>
      </div>
    </>
  );
}
