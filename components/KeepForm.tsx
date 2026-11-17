"use client";
import { startTransition } from "react";

/**
 * A form for long entries (vouchers): runs the server action without React's automatic form reset, so when the
 * server refuses the entry with a message, everything typed is still there to correct.
 */
export function KeepForm({ action, className, children }: { action: (fd: FormData) => Promise<void>; className?: string; children: React.ReactNode }) {
  return (
    <form className={className} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}>
      {children}
    </form>
  );
}
