"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pending, className, name, value, disabled }: { children: React.ReactNode; pending?: string; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={busy || disabled} aria-busy={busy} className={`${className ?? ""} disabled:opacity-60`}>
      {busy ? pending ?? "…" : children}
    </button>
  );
}
