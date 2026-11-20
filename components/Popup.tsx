"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * A sub-task in a popup over the page. The forms inside are ordinary server-action forms: they save and
 * send the user back to the same page, so the page behind refreshes in place. On success the popup closes;
 * if the server refuses, the popup opens again with the message and what was typed (kept by FormErrors).
 */
const KEY = "sf-popup";

export function Popup({ label, title, children, className, wide, id }: {
  label: React.ReactNode; title: string; children: React.ReactNode; className?: string; wide?: boolean; id?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const params = useSearchParams();

  // The page came back after a save in this popup: a refused save opens it again with the reason.
  useEffect(() => {
    let mark: { id?: string; path?: string; at?: number } | null = null;
    try { mark = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { /* blocked */ }
    if (id && mark?.id === id && mark.path === location.pathname && Date.now() - (mark.at ?? 0) < 60_000) {
      sessionStorage.removeItem(KEY);
      const e = new URLSearchParams(location.search).get("err");
      if (e) { setErr(e); ref.current?.showModal(); }
    }
    // Open straight away when the page is reached as /page#popup-id, e.g. from the next-step card or a home-page link.
    const fromHash = () => { if (id && window.location.hash === `#${id}` && !ref.current?.open) { setErr(null); ref.current?.showModal(); } };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [id]);

  // Same address after the save (nothing re-mounted): new content from the server means the save is done.
  useEffect(() => {
    if (!saving.current) return;
    saving.current = false; setBusy(false);
    const e = params.get("err");
    if (e) setErr(e); else close();
  }, [children]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = () => { setErr(null); ref.current?.showModal(); };
  function close() {
    ref.current?.close();
    if (id && window.location.hash === `#${id}`) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }

  return (
    <>
      <dialog ref={ref} className={`popup${wide ? " wide" : ""}`} aria-label={title} aria-busy={busy}
        onClick={(e) => { if (e.target === ref.current && !busy) close(); }}
        onSubmit={() => {
          saving.current = true; setBusy(true); setErr(null);
          try { if (id) sessionStorage.setItem(KEY, JSON.stringify({ id, path: location.pathname, at: Date.now() })); } catch { /* blocked */ }
        }}>
        <div className="popup-head"><div className="popup-title" role="heading" aria-level={2}>{title}</div>
          {busy ? <span className="small muted">Saving…</span> : <button type="button" className="popup-x" onClick={close} aria-label="Close">×</button>}</div>
        {err && <div className="flash err" role="alert">{err}</div>}
        <div className="popup-body">{children}</div>
      </dialog>
      {/* After the dialog in the page order, so a search for the save button finds the one inside first. */}
      <button type="button" className={className ?? "btn sm"} onClick={open} data-popup={id ?? ""}>{label}</button>
    </>
  );
}
