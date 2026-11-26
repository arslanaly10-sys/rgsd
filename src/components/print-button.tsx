"use client";
export function PrintButton({ label }: { label: string }) {
  return <button onClick={() => window.print()} className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white">{label}</button>;
}
