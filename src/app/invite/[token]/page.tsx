import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { acceptInviteAction } from "@/app/auth-actions";
import { Flash } from "@/components/ui";
import { inviteByToken } from "@/lib/identity";

export const metadata = { robots: { index: false } };

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { token } = await params;
  const { msg } = await searchParams;
  const t = await getTranslations();
  const inv = await inviteByToken(token);
  const field = "rounded-lg border border-line bg-panel px-3 py-2";
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <Image src="/brand/rgs-logo.png" alt="RGS" width={40} height={40} className="rounded-lg" />
        <span className="font-display text-lg font-semibold">RGS OneSite</span>
      </div>
      <Flash msg={msg} />
      {!inv || inv.expired || inv.accepted ? (
        <div className="rounded-2xl border border-line bg-panel p-6">
          <h1 className="text-xl font-semibold">This invitation can&apos;t be used</h1>
          <p className="mt-2 text-sm text-muted">It has expired, was withdrawn, or was already accepted. Ask the person who invited you for a new one, or <a className="text-brand underline" href="/login">sign in</a> if you already have access.</p>
        </div>
      ) : (
        <form action={acceptInviteAction} className="grid gap-3 rounded-2xl border border-line bg-panel p-6">
          <input type="hidden" name="token" value={token} />
          <h1 className="text-xl font-semibold">Welcome to RGS OneSite</h1>
          <p className="text-sm text-muted">{inv.inviter ?? "RGS"} invited <strong className="text-ink">{inv.email}</strong> as {t(`roles.${inv.role}`)}{inv.company ? ` for ${inv.company}` : ""}. Confirm your details to continue. Next time, sign in with a code sent to this email.</p>
          <label className="text-sm font-medium" htmlFor="fullName">Full name</label>
          <input id="fullName" name="fullName" defaultValue={inv.full_name} required minLength={3} className={field} />
          <label className="text-sm font-medium" htmlFor="phone">Mobile (optional, for WhatsApp/SMS alerts)</label>
          <input id="phone" name="phone" inputMode="tel" placeholder="+9665XXXXXXXX" className={field} dir="ltr" />
          <label className="text-sm font-medium" htmlFor="locale">Language / اللغة</label>
          <select id="locale" name="locale" defaultValue={inv.locale} className={field}><option value="en">English</option><option value="ar">العربية</option></select>
          <button className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Accept invitation</button>
        </form>
      )}
    </main>
  );
}
