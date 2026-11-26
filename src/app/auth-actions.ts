"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearPendingMfa, createSession, destroySession, getPendingMfa, requireSession, setPendingMfa } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import {
  acceptInvite, AuthError, confirmMfa, createInvite, removeMfa, requestOtp, resetMfa, revokeInvite, setUserStatus, signOutEverywhere, verifyMfa, verifyOtp,
} from "@/lib/identity";

const ip = async () => ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
const go = (path: string, params: Record<string, string | null | undefined>): never => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "") as [string, string][]);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};
const msgOf = (e: unknown) => (e instanceof AuthError ? e.message : "Something went wrong. Try again.");
async function land(profileId: string, role: string, locale: string) {
  await createSession(profileId);
  const jar = await cookies();
  if (!jar.get("locale")) jar.set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect(role.startsWith("client_") ? "/client" : "/ops");
}

// ───────── Sign-in ─────────
export async function requestCodeAction(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim();
  let dev: string | null = null;
  try { dev = (await requestOtp(email, await ip())).devCode; }
  catch (e) { if (!(e instanceof AuthError)) console.error("[auth]", e); go("/login", { msg: `err:${msgOf(e)}` }); }
  go("/login", { step: "code", email, dev });
}

export async function verifyCodeAction(fd: FormData) {
  const email = String(fd.get("email") ?? "");
  let r: Awaited<ReturnType<typeof verifyOtp>>;
  try { r = await verifyOtp(email, String(fd.get("code") ?? ""), await ip()); }
  catch (e) { if (!(e instanceof AuthError)) console.error("[auth]", e); return go("/login", { step: "code", email, msg: `err:${msgOf(e)}` }); }
  if (r.needsMfa) { await setPendingMfa(r.profileId); go("/login", { step: "mfa" }); }
  await land(r.profileId, r.role, r.locale);
}

export async function verifyMfaAction(fd: FormData) {
  const pid = await getPendingMfa();
  if (!pid) go("/login", { msg: "err:That took too long. Sign in again." });
  try { await verifyMfa(pid!, String(fd.get("code") ?? ""), await ip()); }
  catch (e) { go("/login", { step: "mfa", msg: `err:${msgOf(e)}` }); }
  await clearPendingMfa();
  const p = await withSystem((db) => db.query<{ role: string; locale: string }>("select role, locale from profiles where id = $1", [pid]));
  await land(pid!, p.rows[0].role, p.rows[0].locale);
}

export async function acceptInviteAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  let r: Awaited<ReturnType<typeof acceptInvite>>;
  try { r = await acceptInvite(token, { fullName: String(fd.get("fullName") ?? ""), locale: String(fd.get("locale") ?? "en"), phone: String(fd.get("phone") ?? "") }, await ip()); }
  catch (e) { return go(`/invite/${token}`, { msg: `err:${msgOf(e)}` }); }
  await createSession(r.profileId);
  (await cookies()).set("locale", String(fd.get("locale") ?? "en") === "ar" ? "ar" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect(r.isStaff ? "/account/security?welcome=1" : "/client?welcome=1");
}

// ───────── Account security ─────────
export async function confirmMfaAction(fd: FormData) {
  const s = await requireSession(undefined, { allowWithoutMfa: true });
  let m: string;
  try { m = await confirmMfa(s, String(fd.get("code") ?? "")); }
  catch (e) { return go("/account/security", { msg: `err:${msgOf(e)}` }); }
  await createSession(s.id); // the session version changed; reissue this device's session
  go("/account/security", { msg: `ok:${m}` });
}

export async function removeMfaAction(fd: FormData) {
  const s = await requireSession(undefined, { allowWithoutMfa: true });
  let m: string;
  try { m = await removeMfa(s, String(fd.get("code") ?? "")); }
  catch (e) { return go("/account/security", { msg: `err:${msgOf(e)}` }); }
  go("/account/security", { msg: `ok:${m}` });
}

export async function signOutEverywhereAction() {
  const s = await requireSession(undefined, { allowWithoutMfa: true });
  await signOutEverywhere(s);
  await destroySession();
  redirect("/login?msg=" + encodeURIComponent("ok:Signed out on every device."));
}

export async function saveNotifyAction(fd: FormData) {
  const s = await requireSession(undefined, { allowWithoutMfa: true });
  const phone = String(fd.get("phone") ?? "").replace(/[^\d+]/g, "");
  if (phone && !/^\+?9665\d{8}$|^\+?\d{10,15}$/.test(phone)) go("/account/security", { msg: "err:Enter a mobile number like +9665XXXXXXXX." });
  const notify = { email: fd.get("email") === "1", whatsapp: fd.get("whatsapp") === "1", sms: fd.get("sms") === "1" };
  if ((notify.whatsapp || notify.sms) && !phone) go("/account/security", { msg: "err:Add your mobile number for WhatsApp or SMS." });
  await withSystem((db) => db.query("update profiles set notify = $2, phone = nullif($3, '') where id = $1", [s.id, JSON.stringify(notify), phone]), { actorId: s.id });
  go("/account/security", { msg: "ok:Notification preferences saved." });
}

// ───────── Access management (admins, client admins) ─────────
const peoplePath = async () => ((await requireSession()).isStaff ? "/ops/admin/people" : "/client/people");

export async function inviteAction(fd: FormData) {
  const s = await requireSession();
  const path = await peoplePath();
  let r: Awaited<ReturnType<typeof createInvite>>;
  try {
    r = await createInvite(s, { email: String(fd.get("email") ?? ""), fullName: String(fd.get("fullName") ?? ""), role: String(fd.get("role") ?? ""), clientCompanyId: String(fd.get("clientCompanyId") ?? "") || null, phone: String(fd.get("phone") ?? "") || null, locale: String(fd.get("locale") ?? "en") });
  } catch (e) { if (!(e instanceof AuthError)) console.error("[invite]", e); return go(path, { msg: `err:${msgOf(e)}` }); }
  revalidatePath(path);
  go(path, { msg: `ok:${r.message}${r.link ? ` Demo link (no email provider yet): ${r.link}` : ""}` });
}

export async function revokeInviteAction(fd: FormData) {
  const s = await requireSession();
  const path = await peoplePath();
  let m: string;
  try { m = await revokeInvite(s, String(fd.get("id"))); } catch (e) { return go(path, { msg: `err:${msgOf(e)}` }); }
  go(path, { msg: `ok:${m}` });
}

export async function setStatusAction(fd: FormData) {
  const s = await requireSession();
  const path = await peoplePath();
  let m: string;
  try { m = await setUserStatus(s, String(fd.get("id")), fd.get("status") === "active" ? "active" : "disabled"); } catch (e) { return go(path, { msg: `err:${msgOf(e)}` }); }
  go(path, { msg: `ok:${m}` });
}

export async function resetMfaAction(fd: FormData) {
  const s = await requireSession("staff");
  let m: string;
  try { m = await resetMfa(s, String(fd.get("id"))); } catch (e) { return go("/ops/admin/people", { msg: `err:${msgOf(e)}` }); }
  go("/ops/admin/people", { msg: `ok:${m}` });
}
