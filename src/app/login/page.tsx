import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { signInAs, toggleLocale } from "@/app/actions";
import { requestCodeAction, verifyCodeAction, verifyMfaAction } from "@/app/auth-actions";
import { Flash } from "@/components/ui";
import { getPendingMfa } from "@/lib/auth";
import { authMode } from "@/lib/identity";
import { rows, withSystem } from "@/lib/db";

type P = { id: string; full_name: string; full_name_ar: string | null; role: string; title: string | null; company: string | null; company_ar: string | null };

export default async function Login({ searchParams }: { searchParams: Promise<{ step?: string; email?: string; dev?: string; msg?: string }> }) {
  const sp = await searchParams;
  const mode = authMode();
  const pendingMfa = sp.step === "mfa" && (await getPendingMfa());
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ar";
  const people = mode !== "demo" ? [] : await withSystem((db) =>
    rows<P>(db, `select p.id, p.full_name, p.full_name_ar, p.role, p.title, c.name company, c.name_ar company_ar
                 from profiles p left join client_companies c on c.id = p.client_company_id where p.status = 'active'
                 order by (p.client_company_id is not null), array_position(array['ops_manager','estimator','inspector','site_supervisor','yard_logistics','hse_training','finance','admin','client_admin','client_user'], p.role)`),
  );
  const staff = people.filter((p) => !p.role.startsWith("client_"));
  const clients = people.filter((p) => p.role.startsWith("client_"));

  const Person = ({ p }: { p: P }) => (
    <form action={signInAs}>
      <input type="hidden" name="profileId" value={p.id} />
      <button className="group flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-start transition hover:border-brand hover:shadow-sm">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink font-display text-sm font-semibold text-white">
          {p.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{locale === "ar" && p.full_name_ar ? p.full_name_ar : p.full_name}</span>
          <span className="block truncate text-xs text-muted">
            {t(`roles.${p.role}`)}
            {p.company ? ` · ${locale === "ar" && p.company_ar ? p.company_ar : p.company}` : ""}
          </span>
        </span>
        <span className="text-brand opacity-0 transition group-hover:opacity-100 rtl:rotate-180" aria-hidden>→</span>
      </button>
    </form>
  );

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.15fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-white lg:flex">
        <svg className="absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
          <defs>
            <pattern id="scaf" width="64" height="64" patternUnits="userSpaceOnUse">
              <path d="M0 0V64M64 0V64M0 32H64M0 0L64 32" stroke="white" strokeWidth="1.5" fill="none" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#scaf)" />
        </svg>
        <div className="relative flex items-center gap-3">
          <Image src="/brand/rgs-logo.png" alt="RGS" width={44} height={44} className="rounded-lg bg-white p-1" />
          <span className="font-display text-xl font-semibold">RGS OneSite</span>
        </div>
        <div className="relative max-w-md">
          <p className="eyebrow !text-brand">Consult · Mobilize · Succeed</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight">{t("app.tagline")}</h1>
          <ul className="mt-8 grid gap-3 text-sm text-white/75">
            <li className="flex gap-3"><span className="mt-1.5 size-2 rounded-full bg-tag-green" />Requests, quotes and tenders drafted by the Estimator agent</li>
            <li className="flex gap-3"><span className="mt-1.5 size-2 rounded-full bg-tag-yellow" />7-day inspections and tag compliance, offline on the platform</li>
            <li className="flex gap-3"><span className="mt-1.5 size-2 rounded-full bg-tag-red" />Rental fleet, dispatch, crews and certificates watched around the clock</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Resa Gulf Scaffolding Co. Ltd. · Khobar</p>
      </section>
      <section className="flex flex-col px-4 py-8 sm:px-10">
        <div className="flex justify-end">
          <form action={toggleLocale}>
            <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
            <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:bg-canvas">{t("app.language")}</button>
          </form>
        </div>
        <div className="mx-auto w-full max-w-xl flex-1 py-8">
          <h2 className="text-2xl font-semibold">{t("login.title")}</h2>
          <Flash msg={sp.msg} />
          <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
            {pendingMfa ? (
              <form action={verifyMfaAction} className="grid gap-3">
                <label className="text-sm font-medium" htmlFor="mfa">{locale === "ar" ? "أدخل الرمز من تطبيق المصادقة" : "Enter the 6-digit code from your authenticator app"}</label>
                <input id="mfa" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus className="rounded-lg border border-line px-3 py-2 text-center font-mono text-xl tracking-[0.4em]" />
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{locale === "ar" ? "تحقق" : "Verify"}</button>
              </form>
            ) : sp.step === "code" && sp.email ? (
              <form action={verifyCodeAction} className="grid gap-3">
                <input type="hidden" name="email" value={sp.email} />
                <p className="text-sm text-muted">{locale === "ar" ? `إذا كان ${sp.email} مسجلاً لدينا فقد أرسلنا إليه رمزاً من 6 أرقام صالحاً لمدة 10 دقائق.` : `If ${sp.email} has access, we've emailed it a 6-digit code. It expires in 10 minutes.`}</p>
                {sp.dev && <p role="note" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-600">{locale === "ar" ? "وضع العرض (لا يوجد مزود بريد): الرمز" : "Demo mode (no email provider connected): your code is"} <strong className="font-mono" data-dev-code>{sp.dev}</strong></p>}
                <label className="text-sm font-medium" htmlFor="code">{locale === "ar" ? "رمز الدخول" : "Sign-in code"}</label>
                <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus className="rounded-lg border border-line px-3 py-2 text-center font-mono text-xl tracking-[0.4em]" />
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{locale === "ar" ? "دخول" : "Sign in"}</button>
                <a href="/login" className="text-center text-xs text-muted underline">{locale === "ar" ? "استخدم بريداً آخر أو اطلب رمزاً جديداً" : "Use another email or get a new code"}</a>
              </form>
            ) : (
              <form action={requestCodeAction} className="grid gap-3">
                <label className="text-sm font-medium" htmlFor="email">{locale === "ar" ? "البريد الإلكتروني للعمل" : "Work email"}</label>
                <input id="email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" className="rounded-lg border border-line px-3 py-2" dir="ltr" />
                <button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">{locale === "ar" ? "أرسل رمز الدخول" : "Email me a sign-in code"}</button>
                <p className="text-xs text-muted">{locale === "ar" ? "لا كلمات مرور. الوصول بدعوة فقط." : "No passwords. Access is by invitation only."}</p>
              </form>
            )}
          </div>
          {mode === "demo" && <>
          <p className="mt-8 text-sm text-muted">{t("login.subtitle")}</p>
          <h3 className="eyebrow mt-8 mb-3">{t("login.staff")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">{staff.map((p) => <Person key={p.id} p={p} />)}</div>
          <h3 className="eyebrow mt-8 mb-3">{t("login.clients")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">{clients.map((p) => <Person key={p.id} p={p} />)}</div>
          </>}
        </div>
      </section>
    </div>
  );
}
