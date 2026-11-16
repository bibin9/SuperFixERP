import { getMessage } from "@/lib/services/messaging";
import { confirmMessageAction } from "@/app/actions";
import type { Ctx } from "@/lib/access";
import { CopyButton } from "./CopyButton";

/**
 * Manual-only messaging (FSD v0.10): shows the prepared text, a click-to-chat link and a copy
 * button. Staff send it themselves and then mark it as sent; the system never sends anything.
 */
export async function ManualMessage({ ctx, id, back }: { ctx: Ctx; id?: string; back: string }) {
  if (!id) return null;
  const m = await getMessage(ctx, id);
  if (!m) return null;
  const done = m.status === "sent_manually";
  return (
    <div className={`flash ${done ? "ok" : "warn"}`}>
      <div style={{ marginBottom: 6 }}><b>{done ? "Marked as sent by you." : "Message ready. Send it yourself, then mark it as sent."}</b> To {m.to_mobile}.</div>
      <pre className="msg">{m.body}</pre>
      {!done && (
        <div className="row" style={{ marginTop: 8 }}>
          <a className="btn wa sm shrink" href={m.url} target="_blank" rel="noreferrer">Open WhatsApp</a>
          <span className="shrink"><CopyButton text={m.body} /></span>
          <form action={confirmMessageAction} className="shrink"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="$back" value={back} />
            <button className="btn green sm">Mark as sent</button></form>
        </div>
      )}
    </div>
  );
}
