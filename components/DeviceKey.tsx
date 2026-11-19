"use client";
import { useActionState } from "react";

type S = { key?: string; err?: string; id?: string };
/** "New key" for a punching machine: the key is shown here once, to type into the machine's sync settings. */
export function DeviceKey({ id, action, hasKey }: { id: string; hasKey: boolean; action: (p: S, fd: FormData) => Promise<S> }) {
  const [st, run, busy] = useActionState(action, {});
  return (
    <form action={run} style={{ margin: 0 }}>
      <input type="hidden" name="device_id" value={id} />
      {st.key ? <div className="small"><b>Sync key (shown once):</b> <code style={{ userSelect: "all", wordBreak: "break-all" }}>{st.key}</code></div>
        : <button className="btn ghost sm" disabled={busy} onClick={(e) => { if (hasKey && !window.confirm("Make a new key? The machine stops sending until the new key is entered.")) e.preventDefault(); }}>{hasKey ? "New key" : "Make key"}</button>}
      {st.err && <div className="small" style={{ color: "var(--late)" }}>{st.err}</div>}
    </form>
  );
}
