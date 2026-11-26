import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { signOut, toggleLocale } from "@/app/actions";
import type { Session } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { clientCaps } from "@/lib/roles";
import { Copilot } from "./copilot";
import { Icon, NavLinks, type NavItem } from "./nav-links";

export async function AppShell({ session, area, badges = {}, children }: { session: Session; area: "ops" | "client"; badges?: Record<string, number>; children: ReactNode }) {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ar";
  const n = (k: string) => t(`nav.${k}`);

  const groups: { label?: string; items: NavItem[] }[] =
    area === "ops"
      ? [
          { label: n("workspace"), items: [
            { href: "/ops/agent", label: n("myAgent"), icon: "spark", badge: badges.agent },
            { href: "/ops", label: n("overview"), icon: "home" },
            { href: "/ops/oversight", label: n("oversight"), icon: "spark" },
            { href: "/ops/projects", label: n("projects"), icon: "clipboard" },
            { href: "/ops/map", label: n("map"), icon: "pin" },
            { href: "/ops/reports", label: n("reports"), icon: "doc" },
          ] },
          { label: n("delivery"), items: [
            { href: "/ops/activity", label: n("activity"), icon: "inbox" },
            { href: "/ops/progress", label: n("progress"), icon: "scaffold" },
            { href: "/ops/milestones", label: n("milestones"), icon: "check" },
            { href: "/ops/dependencies", label: n("dependencies"), icon: "pin" },
            { href: "/ops/handover", label: n("handover"), icon: "check" },
          ] },
          { label: n("customer"), items: [
            { href: "/ops/requests", label: n("requests"), icon: "inbox", badge: badges.requests },
            { href: "/ops/triage", label: n("triage"), icon: "menu" },
            { href: "/ops/journeys", label: n("journeys"), icon: "spark" },
            { href: "/ops/instructions", label: n("instructions"), icon: "doc" },
            { href: "/ops/signoffs", label: n("signoffs"), icon: "check" },
          ] },
          { label: n("quality"), items: [
            { href: "/ops/inspections", label: n("itp"), icon: "clipboard" },
            { href: "/ops/scaffolds", label: n("scaffoldTags"), icon: "scaffold", badge: badges.overdue },
            { href: "/ops/findings", label: n("findings"), icon: "inbox", badge: badges.findings },
            { href: "/ops/corrective", label: n("corrective"), icon: "check" },
            { href: "/ops/checklists", label: n("checklists"), icon: "doc" },
            { href: "/ops/hse", label: n("hse"), icon: "people" },
            { href: "/ops/tasks", label: n("tasks"), icon: "clipboard", badge: badges.tasks },
          ] },
          { label: n("documentControl"), items: [
            { href: "/ops/documents", label: n("documents"), icon: "doc" },
            { href: "/ops/evidence", label: n("evidence"), icon: "pin" },
            { href: "/ops/docreview", label: n("docreview"), icon: "check" },
          ] },
          { label: n("operations"), items: [
            { href: "/ops/fleet", label: n("fleet"), icon: "truck" },
            { href: "/ops/workforce", label: n("workforce"), icon: "people", badge: badges.expiring },
            { href: "/ops/sites", label: n("sites"), icon: "pin" },
          ] },
          { label: n("commercial"), items: [
            { href: "/ops/claims", label: n("claims"), icon: "money" },
            { href: "/ops/billing", label: n("finance"), icon: "money" },
            { href: "/ops/credit-notes", label: n("creditNotes"), icon: "doc" },
            { href: "/ops/statement", label: n("statement"), icon: "clipboard" },
          ] },
          { label: n("help"), items: [
            { href: "/ops/support", label: n("support"), icon: "inbox", badge: badges.tickets },
            { href: "/ops/contacts", label: n("contacts"), icon: "people" },
          ] },
          { label: n("control"), items: [
            { href: "/ops/approvals", label: n("approvals"), icon: "check", badge: badges.approvals },
            { href: "/ops/agents", label: n("agents"), icon: "spark" },
            ...(["admin", "ops_manager"].includes(session.role) ? [{ href: "/ops/agents/team", label: n("teamAgents"), icon: "people" } as NavItem] : []),
            { href: "/field", label: n("field"), icon: "phone" },
          ] },
          ...(session.role === "admin" ? [{ label: n("stage1"), items: [
            { href: "/ops/admin", label: n("reviewHub"), icon: "spark" },
            { href: "/ops/admin/design", label: n("designSystem"), icon: "doc" },
            { href: "/ops/admin/data-model", label: n("dataModel"), icon: "menu" },
            { href: "/ops/admin/permissions", label: n("permissionMatrix"), icon: "check" },
            { href: "/ops/admin/access", label: n("accessTester"), icon: "people" },
            { href: "/ops/admin/states", label: n("interfaceStates"), icon: "clipboard" },
            { href: "/ops/admin/architecture", label: n("architecture"), icon: "pin" },
            { href: "/ops/admin/people", label: n("people"), icon: "people" },
            { href: "/ops/admin/outbox", label: n("outbox"), icon: "inbox" },
          ] as NavItem[] }] : []),
        ]
      : [
          { label: n("workspace"), items: [
            { href: "/client/agent", label: n("myAgent"), icon: "spark", badge: badges.agent },
            { href: "/client", label: n("overview"), icon: "home" },
            { href: "/client/projects", label: n("projects"), icon: "clipboard" },
            { href: "/client/map", label: n("map"), icon: "pin" },
            { href: "/client/reports", label: n("reports"), icon: "doc" },
          ] },
          { label: n("delivery"), items: [
            { href: "/client/activity", label: n("activity"), icon: "inbox" },
            { href: "/client/progress", label: n("progress"), icon: "scaffold" },
            { href: "/client/milestones", label: n("milestones"), icon: "check" },
            { href: "/client/dependencies", label: n("dependencies"), icon: "pin", badge: badges.clientDeps },
            { href: "/client/handover", label: n("handover"), icon: "check" },
          ] },
          { label: n("customer"), items: [
            { href: "/client/requests", label: n("requests"), icon: "inbox" },
            { href: "/client/journeys", label: n("journeys"), icon: "spark" },
            { href: "/client/instructions", label: n("instructions"), icon: "doc" },
            { href: "/client/signoffs", label: n("mySignoffs"), icon: "check", badge: badges.signoffs },
          ] },
          { label: n("quality"), items: [
            { href: "/client/inspections", label: n("itp"), icon: "clipboard" },
            { href: "/client/scaffolds", label: n("scaffoldTags"), icon: "scaffold" },
            { href: "/client/findings", label: n("findings"), icon: "inbox" },
            { href: "/client/corrective", label: n("corrective"), icon: "check", badge: badges.closeouts },
            { href: "/client/checklists", label: n("checklists"), icon: "doc" },
            { href: "/client/hse", label: n("hse"), icon: "people" },
          ] },
          { label: n("documentControl"), items: [
            { href: "/client/documents", label: n("documents"), icon: "doc" },
            { href: "/client/evidence", label: n("evidence"), icon: "pin" },
            { href: "/client/docreview", label: n("docreview"), icon: "check", badge: badges.reviews },
          ] },
          { label: n("commercial"), items: [
            { href: "/client/claims", label: n("claims"), icon: "money" },
            { href: "/client/billing", label: n("finance"), icon: "money" },
            { href: "/client/statement", label: n("statement"), icon: "clipboard" },
          ] },
          { label: n("help"), items: [
            { href: "/client/support", label: n("support"), icon: "inbox", badge: badges.tickets },
            { href: "/client/help", label: n("helpCenter"), icon: "spark" },
            { href: "/client/contacts", label: n("contacts"), icon: "people" },
            ...(session.role === "client_admin" ? [{ href: "/client/people", label: n("people"), icon: "people" } as NavItem] : []),
          ] },
        ];

  const name = locale === "ar" && session.fullNameAr ? session.fullNameAr : session.fullName;
  const projects = await listProjects(session);
  const company = session.isStaff ? t(`roles.${session.role}`) : (locale === "ar" && session.companyNameAr) || session.companyName;

  const rail = (
    <div className="flex h-full flex-col gap-6 bg-ink px-3 py-4 text-white">
      <div className="grid gap-2 px-2">
        <div className="flex items-center gap-2">
          <Image src="/brand/rgs-logo.png" alt="RGS" width={34} height={34} className="rounded-md bg-white p-0.5" />
          {!session.isStaff && company && <span title={company} className="flex h-[34px] min-w-[34px] items-center justify-center rounded-md bg-white px-2 text-[11px] font-bold tracking-wide text-ink" data-client-badge>{company.replace(/\(.*?\)/g, "").split(/[\s·]+/).filter((w) => /^[A-Za-z\u0600-\u06FF]/.test(w)).slice(0, 3).map((w) => w[0]).join("").toUpperCase()}</span>}
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold">{session.isStaff ? "OneSite" : locale === "ar" ? "بوابة عملاء RGS" : "RGS Client Portal"}</div>
          <div className="text-[11px] text-white/50">{session.isStaff ? "Resa Gulf Scaffolding" : locale === "ar" ? "مساحة العميل" : "Client workspace"}</div>
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
          <Link href="/account/security" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white">{n("security")}</Link>
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
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-panel/85 px-4 py-2 backdrop-blur md:px-8">
          <form action={`/${area}/search`} role="search" className="relative min-w-0 flex-1 md:max-w-md">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input name="q" aria-label={locale === "ar" ? "بحث" : "Search"} placeholder={locale === "ar" ? "ابحث في المشاريع والمستندات…" : "Search projects, packages, documents…"} className="w-full rounded-lg border border-line bg-canvas py-1.5 pe-3 ps-9 text-sm" />
          </form>
          <details className="relative hidden md:block" data-project-switcher>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">{locale === "ar" ? "كل مشاريعي" : "All my projects"} <span aria-hidden>▾</span></summary>
            <div className="absolute end-0 z-30 mt-1 max-h-96 w-80 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-lg">
              <Link href={`/${area}/projects`} className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-canvas">{locale === "ar" ? "كل المشاريع" : "All projects"}</Link>
              {projects.map((p) => <Link key={p.id} href={`/${area}/projects/${p.id}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-canvas"><span className="font-mono text-xs text-muted">{p.ref}</span> {locale === "ar" && p.name_ar ? p.name_ar : p.name.split(" · ")[0]}</Link>)}
            </div>
          </details>
          <span className="hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-600 lg:inline">{t("app.sample")}</span>
          <form action={toggleLocale}>
            <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
            <button className="inline-flex size-8 items-center justify-center rounded-full hover:bg-canvas" aria-label={t("app.language")} title={t("app.language")}><Icon name="globe" className="size-[18px]" /></button>
          </form>
          <Link href={`/${area}/notifications`} className="relative inline-flex size-8 items-center justify-center rounded-full hover:bg-canvas" aria-label={`${n("notifications")}${badges.unread ? ` (${badges.unread})` : ""}`}>
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
            {!!badges.unread && <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-4 text-white tabular">{badges.unread > 99 ? "99+" : badges.unread}</span>}
          </Link>
          <Link href="/account/security" className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-canvas" data-user-chip>
            <span className="flex size-8 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">{session.fullName.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
            <span className="hidden leading-tight sm:block"><span className="block text-sm font-semibold">{name}</span><span className="block text-[11px] text-muted">{t(`roles.${session.role}`)}{!session.isStaff && session.role !== "client_viewer" ? ` · ${clientCaps(session.role).label}` : ""}</span></span>
          </Link>
        </div>
        <div className="mx-auto max-w-[1320px] px-4 pb-24 pt-6 md:px-8">{children}</div>
      </main>
      <Copilot area={area} />
    </div>
  );
}
