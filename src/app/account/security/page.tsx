import Link from "next/link";
import { getLocale } from "next-intl/server";
import { confirmMfaAction, removeMfaAction, saveNotifyAction, signOutEverywhereAction } from "@/app/auth-actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, Flash, PageHeader, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { channelStatus } from "@/lib/channels";
import { one, rows, withSystem } from "@/lib/db";
import { authMode, mfaRequiredRoles, startMfaEnrollment } from "@/lib/identity";

export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ msg?: string; required?: string; welcome?: string }> }) {
  const s = await requireSession(undefined, { allowWithoutMfa: true });
  const sp = await searchParams;
  const l = (await getLocale()) as "en" | "ar";
  const ar = l === "ar";
  const enroll = s.mfaEnabled ? null : await startMfaEnrollment(s);
  const [me, events] = await Promise.all([
    withSystem((db) => one<{ phone: string | null; notify: { email?: boolean; whatsapp?: boolean; sms?: boolean } }>(db, "select phone, notify from profiles where id = $1", [s.id])),
    withSystem((db) => rows<{ event: string; detail: string | null; ip: string | null; created_at: string }>(db, "select event, detail, ip, created_at from login_events where profile_id = $1 order by created_at desc limit 8", [s.id])),
  ]);
  const required = mfaRequiredRoles().includes(s.role);
  const ch = channelStatus();
  const field = "rounded-lg border border-line bg-panel px-3 py-2 text-sm";
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href={s.isStaff ? "/ops" : "/client"} className="text-sm text-brand">← {ar ? "رجوع" : "Back"}</Link>
      <PageHeader title={ar ? "الحساب والأمان" : "Account & security"} sub={`${s.fullName} · ${s.email}`} />
      <Flash msg={sp.msg} />
      {sp.required && !s.mfaEnabled && <div role="alert" className="mb-4 rounded-lg bg-tag-yellow-bg px-4 py-3 text-sm text-tag-yellow">{ar ? "يتطلب دورك تطبيق مصادقة قبل المتابعة." : "Your role needs an authenticator app before you continue."}</div>}
      {sp.welcome && <div className="mb-4 rounded-lg bg-tag-green-bg px-4 py-3 text-sm text-tag-green">{ar ? "مرحباً! أكمل إعداد الأمان." : "Welcome! Finish setting up your account security."}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={ar ? "تطبيق المصادقة (MFA)" : "Authenticator app (MFA)"} action={s.mfaEnabled ? <Pill tone="green">{ar ? "مفعّل" : "On"}</Pill> : <Pill tone={required ? "red" : "neutral"}>{required ? (ar ? "مطلوب" : "Required") : ar ? "غير مفعّل" : "Off"}</Pill>}>
          {enroll ? (
            <form action={confirmMfaAction} className="grid gap-3">
              <p className="text-sm text-muted">{ar ? "امسح الرمز بتطبيق Google أو Microsoft Authenticator ثم أدخل الرمز المكون من 6 أرقام." : "Scan with Google or Microsoft Authenticator, then enter the 6-digit code it shows."}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="Authenticator QR code" width={180} height={180} className="rounded-lg border border-line" />
              <details className="text-xs text-muted"><summary className="cursor-pointer">{ar ? "لا يمكنك المسح؟" : "Can't scan?"}</summary><code className="mt-1 block break-all font-mono" data-mfa-secret>{enroll.secret}</code></details>
              <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required aria-label="Authenticator code" placeholder="123456" className={`${field} font-mono tracking-widest`} />
              <SubmitButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending="…">{ar ? "تفعيل" : "Turn on"}</SubmitButton>
            </form>
          ) : (
            <form action={removeMfaAction} className="grid gap-3">
              <p className="text-sm text-muted">{ar ? "ستُسأل عن رمز من التطبيق عند كل تسجيل دخول." : "You're asked for a code from the app each time you sign in."}{required ? (ar ? " دورك يتطلبه." : " Your role requires it.") : ""}</p>
              {!required && <><input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required aria-label="Current code to remove" placeholder="Current code" className={field} /><SubmitButton className="rounded-lg border border-line px-4 py-2 text-sm font-semibold" pending="…">{ar ? "إزالة" : "Remove authenticator"}</SubmitButton></>}
            </form>
          )}
        </Card>
        <Card title={ar ? "الإشعارات" : "Notifications"}>
          <form action={saveNotifyAction} className="grid gap-2 text-sm">
            <p className="text-muted">{ar ? "تظهر كل الإشعارات في الجرس. اختر القنوات الإضافية:" : "Everything shows in the bell. Also send me:"}</p>
            <label className="flex items-center gap-2"><input type="checkbox" name="email" value="1" defaultChecked={!!me?.notify?.email} /> Email <span className="text-xs text-muted">({ch.email})</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" name="whatsapp" value="1" defaultChecked={!!me?.notify?.whatsapp} /> WhatsApp <span className="text-xs text-muted">({ch.whatsapp})</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" name="sms" value="1" defaultChecked={!!me?.notify?.sms} /> SMS {ar ? "(العاجل فقط)" : "(urgent only)"} <span className="text-xs text-muted">({ch.sms})</span></label>
            <input name="phone" defaultValue={me?.phone ?? ""} inputMode="tel" aria-label="Mobile number" placeholder="+9665XXXXXXXX" className={field} dir="ltr" />
            <SubmitButton className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white" pending="…">{ar ? "حفظ" : "Save"}</SubmitButton>
          </form>
        </Card>
        <Card title={ar ? "النشاط الأخير" : "Recent sign-in activity"}>
          <ul className="divide-y divide-line text-sm">
            {events.map((e, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{e.event.replace(/_/g, " ")}{e.detail ? <span className="text-xs text-muted"> · {e.detail}</span> : null}</span><span className="whitespace-nowrap text-xs text-muted">{new Date(e.created_at).toLocaleString(ar ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" })}{e.ip ? ` · ${e.ip}` : ""}</span></li>)}
            {!events.length && <li className="py-2 text-muted">—</li>}
          </ul>
        </Card>
        <Card title={ar ? "الجلسات" : "Sessions"}>
          <p className="mb-3 text-sm text-muted">{ar ? "سجّل الخروج من كل الأجهزة إذا فقدت هاتفاً أو استخدمت جهازاً مشتركاً." : "Lost a phone or used a shared computer? Sign out on every device."} {authMode() === "demo" ? (ar ? "(وضع العرض)" : "(demo sign-in mode)") : ""}</p>
          <form action={signOutEverywhereAction}><SubmitButton className="rounded-lg border border-tag-red px-4 py-2 text-sm font-semibold text-tag-red" pending="…">{ar ? "تسجيل الخروج من كل الأجهزة" : "Sign out everywhere"}</SubmitButton></form>
        </Card>
      </div>
    </main>
  );
}
