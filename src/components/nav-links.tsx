"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string; badge?: number };

export function NavLinks({ groups }: { groups: { label?: string; items: NavItem[] }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-5">
      {groups.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {g.label && <span className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[.1em] text-white/40">{g.label}</span>}
          {g.items.map((it) => {
            const active = path === it.href || (it.href.split("/").length > 2 && path.startsWith(it.href));
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition ${active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
              >
                <span className={`flex size-5 items-center justify-center ${active ? "text-brand" : "text-white/45 group-hover:text-white/70"}`} aria-hidden>
                  <Icon name={it.icon} />
                </span>
                <span className="flex-1 truncate">{it.label}</span>
                {!!it.badge && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular">{it.badge}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Icon({ name, className = "size-[18px]" }: { name: string; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
    inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>,
    scaffold: <><path d="M5 3v18M19 3v18M5 8h14M5 14h14M5 20h14" /><path d="M5 8l14 6" /></>,
    truck: <><path d="M3 6h11v10H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
    people: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" /><circle cx="17.5" cy="9" r="2.4" /><path d="M16.5 14.6c2.3.2 4 1.9 4.5 4.6" /></>,
    money: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /></>,
    check: <><path d="M4 12.5l5 5L20 6.5" /></>,
    spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>,
    pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
    book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>,
    phone: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
    doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 11h6M9 15h4" /></>,
    qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></>,
    out: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} {...p}>
      {paths[name] ?? paths.home}
    </svg>
  );
}
