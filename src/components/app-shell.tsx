import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { signOut, toggleLocale } from "@/app/actions";
import type { Session } from "@/lib/auth";
import { Icon, NavLinks, type NavItem } from "./nav-links";

export async function AppShell({ session, area, badges = {}, children }: { session: Session; area: "ops" | "client"; badges?: Record<string, number>; children: ReactNode }) {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ar";
  const n = (k: string) => t(`nav.${k}`);

  const groups: { label?: string; items: NavItem[] }[] =
    area === "ops"
      ? [
          { items: [{ href: "/ops", label: n("overview"), icon: "home" }] },
          {
            label: n("operations"),
            items: [
              { href: "/ops/requests", label: n("requests"), icon: "inbox", badge: badges.requests },
              { href: "/ops/scaffolds", label: n("scaffolds"), icon: "scaffold", badge: badges.overdue },
              { href: "/ops/fleet", label: n("fleet"), icon: "truck" },
              { href: "/ops/workforce", label: n("workforce"), icon: "people", badge: badges.expiring },
              { href: "/ops/billing", label: n("finance"), icon: "money" },
              { href: "/ops/sites", label: n("sites"), icon: "pin" },
            ],
          },
          {
            label: n("control"),
            items: [
              { href: "/ops/approvals", label: n("approvals"), icon: "check", badge: badges.approvals },
              { href: "/ops/agents", label: n("agents"), icon: "spark" },
              { href: "/field", label: n("field"), icon: "phone" },
            ],
          },
        ]
      : [
          {
            items: [
              { href: "/client", label: n("overview"), icon: "home" },
              { href: "/client/scaffolds", label: n("scaffolds"), icon: "scaffold" },
              { href: "/client/requests", label: n("requests"), icon: "inbox" },
              { href: "/client/billing", label: n("finance"), icon: "money" },
            ],
          },
        ];

  const name = locale === "ar" && session.fullNameAr ? session.fullNameAr : session.fullName;
  const company = session.isStaff ? t(`roles.${session.role}`) : (locale === "ar" && session.companyNameAr) || session.companyName;

  const rail = (
    <div className="flex h-full flex-col gap-6 bg-ink px-3 py-4 text-white">
      <div className="flex items-center gap-2.5 px-2">
        <Image src="/brand/rgs-logo.png" alt="RGS" width={34} height={34} className="rounded-md bg-white p-0.5" />
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold">OneSite</div>
          <div className="text-[11px] text-white/50">Resa Gulf Scaffolding</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavLinks groups={groups} />
      </div>
      <div className="flex flex-col gap-2 border-t border-white/10 px-2 pt-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate text-xs text-white/50">{company}</div>
        </div>
        <div className="flex gap-2">
          <form action={toggleLocale}>
            <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
            <button className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/15">
              <Icon name="globe" className="size-3.5" /> {t("app.language")}
            </button>
          </form>
          <form action={signOut}>
            <button className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white">
              <Icon name="out" className="size-3.5" /> {t("app.signOut")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh md:block">{rail}</aside>
      {/* Mobile top bar with a no-JS drawer */}
      <details className="group sticky top-0 z-30 md:hidden">
        <summary className="flex list-none items-center justify-between bg-ink px-4 py-3 text-white [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Image src="/brand/rgs-logo.png" alt="RGS" width={28} height={28} className="rounded bg-white p-0.5" />
            <span className="font-display font-semibold">OneSite</span>
          </span>
          <Icon name="menu" />
        </summary>
        <div className="fixed inset-x-0 bottom-0 top-[52px] z-30">{rail}</div>
      </details>
      <main className="min-w-0">
        <div className="flex items-center justify-end gap-2 border-b border-line bg-panel/70 px-4 py-2 backdrop-blur md:px-8">
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-600">{t("app.sample")}</span>
        </div>
        <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8">{children}</div>
      </main>
    </div>
  );
}
