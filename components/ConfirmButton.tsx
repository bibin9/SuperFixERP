"use client";
/** A submit button that asks first, for actions that cannot be undone. */
export function ConfirmButton({ message, className, children, disabled }: { message: string; className?: string; children: React.ReactNode; disabled?: boolean }) {
  return <button type="submit" className={className} disabled={disabled} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{children}</button>;
}
