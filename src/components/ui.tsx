import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 max-w-[65ch] text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "red" | "yellow" | "brand"; href?: string }) {
  const stripe = { default: "bg-line", red: "bg-tag-red", yellow: "bg-tag-yellow", brand: "bg-brand" }[tone];
  const body = (
    <div className="relative flex h-full flex-col gap-1 overflow-hidden rounded-xl border border-line bg-panel px-4 py-3.5">
      <span className={`absolute inset-y-0 start-0 w-1 ${stripe}`} aria-hidden />
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="tabular font-display text-2xl font-semibold text-ink">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
  return href ? <Link href={href} className="block h-full transition hover:-translate-y-px">{body}</Link> : body;
}

const tagStyles: Record<string, string> = {
  green: "bg-tag-green-bg text-tag-green ring-tag-green/25",
  yellow: "bg-tag-yellow-bg text-tag-yellow ring-tag-yellow/30",
  red: "bg-tag-red-bg text-tag-red ring-tag-red/25",
  erecting: "bg-slate-100 text-slate-600 ring-slate-300",
  dismantled: "bg-slate-100 text-slate-400 ring-slate-200",
};

export function TagPill({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tagStyles[status] ?? tagStyles.erecting}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

const pillTones: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-700",
  brand: "bg-brand-50 text-brand-600",
  green: "bg-tag-green-bg text-tag-green",
  yellow: "bg-tag-yellow-bg text-tag-yellow",
  red: "bg-tag-red-bg text-tag-red",
  dark: "bg-ink text-white",
};

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof pillTones }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${pillTones[tone]}`}>{children}</span>;
}

export function statusTone(status: string): keyof typeof pillTones {
  if (["paid", "accepted", "won", "completed", "approved", "cleared", "executed", "done", "active"].includes(status)) return "green";
  if (["pending_approval", "off_hire_requested", "estimating", "triage", "high", "pending"].includes(status)) return "yellow";
  if (["rejected", "lost", "failed", "urgent", "void"].includes(status)) return "red";
  if (["new", "sent", "issued", "draft"].includes(status)) return "brand";
  return "neutral";
}

export function Table({ head, children, empty, minWidth = 640 }: { head: ReactNode[]; children: ReactNode; empty?: string; minWidth?: number }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line text-start">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 pb-2 text-start text-xs font-medium text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>}
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-top ${className}`}>{children}</td>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap font-mono text-[12.5px] font-medium tracking-tight" dir="ltr">{children}</span>;
}

export function DueLabel({ days, t }: { days: number | null; t: (k: string, v?: Record<string, number>) => string }) {
  if (days === null) return <span className="text-muted">—</span>;
  if (days < 0) return <span className="font-semibold text-tag-red">{t("overdueBy", { days: -days })}</span>;
  if (days === 0) return <span className="font-semibold text-tag-yellow">{t("dueToday")}</span>;
  return <span className={days <= 2 ? "font-medium text-tag-yellow" : "text-muted"}>{t("dueIn", { days })}</span>;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "ghost" }) {
  const cls = variant === "primary" ? "bg-brand text-white hover:bg-brand-600" : "border border-line bg-panel text-ink hover:bg-canvas";
  return <Link href={href} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${cls}`}>{children}</Link>;
}

export function Flash({ msg }: { msg?: string }) {
  if (!msg) return null;
  const ok = msg.startsWith("ok:");
  return <div role="status" className={`mb-4 rounded-lg px-4 py-3 text-sm ${ok ? "bg-tag-green-bg text-tag-green" : "bg-tag-red-bg text-tag-red"}`}>{msg.slice(msg.indexOf(":") + 1)}</div>;
}

export function Confidence({ value }: { value: number | string | null }) {
  if (value == null) return null;
  const v = Math.round(Number(value) * 100);
  const tone = v >= 75 ? "text-tag-green" : v >= 55 ? "text-tag-yellow" : "text-tag-red";
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line"><span className={`block h-full bg-current ${tone}`} style={{ width: `${v}%` }} /></span>
      <span className={`font-semibold tabular ${tone}`}>{v}%</span>
    </span>
  );
}
