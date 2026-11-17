"use client";
/** A submit button that asks first, for actions that cannot be undone. */
export function ConfirmButton({ message, className, children, disabled, name, value }: { message: string; className?: string; children: React.ReactNode; disabled?: boolean; name?: string; value?: string }) {
  return <button type="submit" className={className} disabled={disabled} name={name} value={value} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{children}</button>;
}
