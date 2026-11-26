import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type { Session } from "./auth";
import { channelStatus, sendMessage } from "./channels";
import { one, rows, withSystem, type Db } from "./db";
import { CLIENT_ROLES, isStaffRole, STAFF_ROLES } from "./roles";
import { newSecret, otpauthUrl, verifyTotp } from "./totp";

/*
 * Sign-in for production: email one-time codes (no passwords to leak), an authenticator-app second
 * factor (required for admin and finance by default), invitations instead of self-sign-up, and
 * "sign out everywhere". AUTH_MODE=demo keeps the persona picker for demos; AUTH_MODE=otp removes it.
 */

export class AuthError extends Error {}
export const authMode = () => (process.env.AUTH_MODE === "otp" ? "otp" : "demo");
export const mfaRequiredRoles = () => (process.env.MFA_REQUIRED_ROLES ?? "admin,finance").split(",").map((r) => r.trim()).filter(Boolean);
const OTP_TTL_MIN = 10, OTP_MAX_ATTEMPTS = 5, OTP_PER_10_MIN = 3, INVITE_DAYS = 7;

const pepper = () => process.env.AUTH_SECRET || "dev-only-insecure-secret";
const hash = (...parts: string[]) => createHash("sha256").update([pepper(), ...parts].join("|")).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const norm = (email: string) => email.trim().toLowerCase();

export async function logEvent(db: Db, x: { orgId?: string | null; profileId?: string | null; email?: string | null; event: string; detail?: string; ip?: string | null }) {
  await db.query("insert into login_events (org_id, profile_id, email, event, detail, ip) values ($1,$2,$3,$4,$5,$6)", [x.orgId ?? null, x.profileId ?? null, x.email ?? null, x.event, x.detail ?? null, x.ip ?? null]);
}

// ───────── Email one-time codes ─────────

/** Always answers the same way whether or not the address exists (no account discovery). In demo mode the code is returned for display. */
export async function requestOtp(emailRaw: string, ip: string | null) {
  const email = norm(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  return withSystem(async (db) => {
    const recent = (await one<{ n: number }>(db, "select count(*)::int n from auth_otps where lower(email) = $1 and created_at > now() - interval '10 minutes'", [email]))!.n;
    if (recent >= OTP_PER_10_MIN) { await logEvent(db, { email, event: "otp_throttled", ip }); return { devCode: null as string | null }; }
    const p = await one<{ id: string; org_id: string; locale: string; status: string }>(db, "select id, org_id, locale, status from profiles where lower(email) = $1", [email]);
    if (!p || p.status !== "active") { await logEvent(db, { email, event: "otp_unknown", ip }); return { devCode: null }; }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.query("insert into auth_otps (email, code_hash, expires_at) values ($1,$2, now() + make_interval(mins => $3))", [email, hash(email, code), OTP_TTL_MIN]);
    const ar = p.locale === "ar";
    const r = await sendMessage({ orgId: p.org_id, profileId: p.id, channel: "email", to: email,
      subject: ar ? `رمز الدخول إلى RGS OneSite: ${code}` : `Your RGS OneSite sign-in code: ${code}`,
      body: ar ? `رمز الدخول: ${code}\nصالح لمدة ${OTP_TTL_MIN} دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.` : `Your sign-in code is ${code}. It expires in ${OTP_TTL_MIN} minutes. If you didn't ask for it, ignore this email.` }, db);
    // Never keep the code readable in the outbox.
    await db.query("update outbound_messages set subject = 'Sign-in code', body = '[sign-in code redacted]' where id = $1", [r.id]);
    await logEvent(db, { orgId: p.org_id, profileId: p.id, email, event: "otp_sent", detail: r.provider, ip });
    const showCode = authMode() === "demo" || (channelStatus().email === "log only" && process.env.NODE_ENV !== "production");
    return { devCode: showCode ? code : null };
  });
}

/** Returns the profile to sign in, and whether an authenticator code is still needed. */
export async function verifyOtp(emailRaw: string, codeRaw: string, ip: string | null) {
  const email = norm(emailRaw), code = codeRaw.replace(/\s/g, "");
  return withSystem(async (db) => {
    const o = await one<{ id: string; code_hash: string; attempts: number }>(db,
      "select id, code_hash, attempts from auth_otps where lower(email) = $1 and consumed_at is null and expires_at > now() order by created_at desc limit 1 for update", [email]);
    const bad = async (why: string) => { await logEvent(db, { email, event: "otp_failed", detail: why, ip }); throw new AuthError("That code is wrong or has expired. Request a new one."); };
    if (!o) return bad("none");
    await db.query("update auth_otps set attempts = attempts + 1 where id = $1", [o.id]);
    if (o.attempts + 1 > OTP_MAX_ATTEMPTS) return bad("too many attempts");
    if (!/^\d{6}$/.test(code) || !same(o.code_hash, hash(email, code))) return bad("mismatch");
    await db.query("update auth_otps set consumed_at = now() where id = $1", [o.id]);
    const p = await one<{ id: string; org_id: string; role: string; mfa_enabled: boolean; locale: string }>(db, "select id, org_id, role, mfa_enabled, locale from profiles where lower(email) = $1 and status = 'active'", [email]);
    if (!p) return bad("inactive");
    if (!p.mfa_enabled) await signedIn(db, p, ip, "email code");
    return { profileId: p.id, role: p.role, locale: p.locale, needsMfa: p.mfa_enabled };
  });
}

async function signedIn(db: Db, p: { id: string; org_id: string }, ip: string | null, how: string) {
  await db.query("update profiles set last_login_at = now() where id = $1", [p.id]);
  await logEvent(db, { orgId: p.org_id, profileId: p.id, event: "signed_in", detail: how, ip });
}

// ───────── Authenticator app (TOTP) ─────────

export async function verifyMfa(profileId: string, code: string, ip: string | null) {
  return withSystem(async (db) => {
    const f = await one<{ totp_secret: string; org_id: string }>(db, "select f.totp_secret, p.org_id from auth_factors f join profiles p on p.id = f.profile_id where f.profile_id = $1 and f.confirmed_at is not null", [profileId]);
    if (!f || !verifyTotp(f.totp_secret, code)) {
      await logEvent(db, { profileId, event: "mfa_failed", ip });
      throw new AuthError("That authenticator code didn't match. Check the time on your phone and try again.");
    }
    await signedIn(db, { id: profileId, org_id: f.org_id }, ip, "email code + authenticator");
  });
}

export async function startMfaEnrollment(s: Session) {
  const secret = newSecret();
  await withSystem((db) => db.query("insert into auth_factors (profile_id, totp_secret) values ($1,$2) on conflict (profile_id) do nothing", [s.id, secret]));
  const row = await withSystem((db) => one<{ totp_secret: string; confirmed_at: string | null }>(db, "select totp_secret, confirmed_at from auth_factors where profile_id = $1", [s.id]));
  if (row?.confirmed_at) throw new AuthError("An authenticator is already set up. Remove it first to add a new one.");
  const url = otpauthUrl(row!.totp_secret, s.email);
  return { secret: row!.totp_secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

export async function confirmMfa(s: Session, code: string) {
  return withSystem(async (db) => {
    const f = await one<{ totp_secret: string }>(db, "select totp_secret from auth_factors where profile_id = $1 and confirmed_at is null", [s.id]);
    if (!f) throw new AuthError("Start again: scan the QR code first.");
    if (!verifyTotp(f.totp_secret, code)) throw new AuthError("That code didn't match. Enter the 6 digits your app shows now.");
    await db.query("update auth_factors set confirmed_at = now() where profile_id = $1", [s.id]);
    await db.query("update profiles set mfa_enabled = true, session_version = session_version + 1 where id = $1", [s.id]);
    await logEvent(db, { orgId: s.orgId, profileId: s.id, event: "mfa_enabled" });
    return "Authenticator added. You'll be asked for a code each time you sign in.";
  });
}

export async function removeMfa(s: Session, code: string) {
  if (authMode() === "otp" && mfaRequiredRoles().includes(s.role)) throw new AuthError("Your role must keep an authenticator. Ask an admin to reset it if you lost your phone.");
  return withSystem(async (db) => {
    const f = await one<{ totp_secret: string }>(db, "select totp_secret from auth_factors where profile_id = $1 and confirmed_at is not null", [s.id]);
    if (!f || !verifyTotp(f.totp_secret, code)) throw new AuthError("Enter a current code from your app to remove it.");
    await db.query("delete from auth_factors where profile_id = $1", [s.id]);
    await db.query("update profiles set mfa_enabled = false where id = $1", [s.id]);
    await logEvent(db, { orgId: s.orgId, profileId: s.id, event: "mfa_removed" });
    return "Authenticator removed.";
  });
}

/** Admin reset for a lost phone: removes the factor and signs the person out everywhere. */
export async function resetMfa(s: Session, profileId: string) {
  if (s.role !== "admin") throw new AuthError("Only an admin can reset an authenticator.");
  return withSystem(async (db) => {
    const p = await one<{ full_name: string }>(db, "select full_name from profiles where id = $1 and org_id = $2", [profileId, s.orgId]);
    if (!p) throw new AuthError("Person not found.");
    await db.query("delete from auth_factors where profile_id = $1", [profileId]);
    await db.query("update profiles set mfa_enabled = false, session_version = session_version + 1 where id = $1", [profileId]);
    await logEvent(db, { orgId: s.orgId, profileId, event: "mfa_reset", detail: `by ${s.fullName}` });
    return `Authenticator reset for ${p.full_name}. They set a new one up at their next sign-in.`;
  }, { actorId: s.id });
}

export async function signOutEverywhere(s: Session) {
  await withSystem(async (db) => {
    await db.query("update profiles set session_version = session_version + 1 where id = $1", [s.id]);
    await logEvent(db, { orgId: s.orgId, profileId: s.id, event: "signed_out_everywhere" });
  });
}

// ───────── Invitations ─────────

/** Admins invite anyone; client admins invite colleagues from their own company (client roles only). */
export async function createInvite(s: Session, x: { email: string; fullName: string; role: string; clientCompanyId?: string | null; phone?: string | null; locale?: string }) {
  const email = norm(x.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  if (x.fullName.trim().length < 3) throw new AuthError("Enter the person's full name.");
  const isClientRole = (CLIENT_ROLES as readonly string[]).includes(x.role);
  if (!isClientRole && !(STAFF_ROLES as readonly string[]).includes(x.role)) throw new AuthError("Pick a role.");
  let company: string | null = null;
  if (s.role === "admin") {
    company = isClientRole ? x.clientCompanyId || null : null;
    if (isClientRole && !company) throw new AuthError("Pick the client company.");
  } else if (s.role === "client_admin") {
    if (!isClientRole) throw new AuthError("You can invite people from your company only.");
    company = s.clientCompanyId;
  } else throw new AuthError("Only admins and client admins can invite people.");
  const token = randomBytes(32).toString("base64url");
  return withSystem(async (db) => {
    if (company && !(await one(db, "select 1 from client_companies where id = $1 and org_id = $2", [company, s.orgId]))) throw new AuthError("Client company not found.");
    if (await one(db, "select 1 from profiles where lower(email) = $1", [email])) throw new AuthError("Someone with that email already has access.");
    const p = await one<{ id: string }>(db, "insert into profiles (org_id, client_company_id, full_name, email, phone, role, locale, status) values ($1,$2,$3,$4,$5,$6,$7,'invited') returning id",
      [s.orgId, company, x.fullName.trim().slice(0, 120), email, x.phone || null, x.role, x.locale === "ar" ? "ar" : "en"]);
    await db.query("insert into invites (org_id, client_company_id, profile_id, email, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $8))",
      [s.orgId, company, p!.id, email, x.role, hash("invite", token), s.id, INVITE_DAYS]);
    const link = `${process.env.APP_URL || "http://localhost:3100"}/invite/${token}`;
    const r = await sendMessage({ orgId: s.orgId, profileId: p!.id, channel: "email", to: email, subject: `${s.fullName} invited you to RGS OneSite`,
      body: `${s.fullName} (${s.companyName ?? "RGS"}) invited you to RGS OneSite.\n\nAccept within ${INVITE_DAYS} days: ${link}\n\nYou'll sign in with a code sent to this email; no password needed.` }, db);
    await db.query("update outbound_messages set body = regexp_replace(body, '/invite/[A-Za-z0-9_-]+', '/invite/[redacted]') where id = $1", [r.id]);
    await logEvent(db, { orgId: s.orgId, profileId: p!.id, email, event: "invite_sent", detail: `by ${s.fullName} as ${x.role}` });
    return { link: authMode() === "demo" || channelStatus().email === "log only" ? link : null, message: `Invitation sent to ${email}.` };
  }, { actorId: s.id });
}

export async function inviteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  return withSystem((db) => one<{ id: string; profile_id: string; email: string; role: string; full_name: string; locale: string; company: string | null; inviter: string | null; expired: boolean; accepted: boolean }>(db,
    `select i.id, i.profile_id, i.email, i.role, p.full_name, p.locale, c.name company, ib.full_name inviter, i.expires_at < now() or i.revoked_at is not null expired, i.accepted_at is not null accepted
     from invites i join profiles p on p.id = i.profile_id left join client_companies c on c.id = i.client_company_id left join profiles ib on ib.id = i.invited_by where i.token_hash = $1`, [hash("invite", token)]));
}

export async function acceptInvite(token: string, x: { fullName: string; locale: string; phone?: string }, ip: string | null) {
  const inv = await inviteByToken(token);
  if (!inv || inv.expired || inv.accepted) throw new AuthError("This invitation has expired or was already used. Ask for a new one.");
  return withSystem(async (db) => {
    await db.query("update invites set accepted_at = now() where id = $1 and accepted_at is null", [inv.id]);
    await db.query("update profiles set status = 'active', full_name = $2, locale = $3, phone = coalesce(nullif($4, ''), phone) where id = $1", [inv.profile_id, x.fullName.trim().slice(0, 120) || inv.full_name, x.locale === "ar" ? "ar" : "en", x.phone ?? ""]);
    const p = (await one<{ id: string; org_id: string; role: string }>(db, "select id, org_id, role from profiles where id = $1", [inv.profile_id]))!;
    await logEvent(db, { orgId: p.org_id, profileId: p.id, email: inv.email, event: "invite_accepted", ip });
    await signedIn(db, p, ip, "invitation");
    return { profileId: p.id, role: p.role, isStaff: isStaffRole(p.role) };
  });
}

export async function revokeInvite(s: Session, inviteId: string) {
  return withSystem(async (db) => {
    const i = await one<{ profile_id: string; client_company_id: string | null; email: string }>(db, "select profile_id, client_company_id, email from invites where id = $1 and org_id = $2 and accepted_at is null", [inviteId, s.orgId]);
    if (!i || !(s.role === "admin" || (s.role === "client_admin" && i.client_company_id === s.clientCompanyId))) throw new AuthError("Invitation not found.");
    await db.query("update invites set revoked_at = now() where id = $1", [inviteId]);
    await db.query("update profiles set status = 'disabled' where id = $1 and status = 'invited'", [i.profile_id]);
    return `Invitation to ${i.email} withdrawn.`;
  }, { actorId: s.id });
}

export async function setUserStatus(s: Session, profileId: string, status: "active" | "disabled") {
  if (profileId === s.id) throw new AuthError("You can't disable yourself.");
  return withSystem(async (db) => {
    const p = await one<{ full_name: string; client_company_id: string | null; role: string }>(db, "select full_name, client_company_id, role from profiles where id = $1 and org_id = $2 and status <> 'invited'", [profileId, s.orgId]);
    if (!p || !(s.role === "admin" || (s.role === "client_admin" && p.client_company_id === s.clientCompanyId))) throw new AuthError("Person not found.");
    await db.query("update profiles set status = $2, session_version = session_version + 1 where id = $1", [profileId, status]);
    await logEvent(db, { orgId: s.orgId, profileId, event: status === "disabled" ? "access_disabled" : "access_restored", detail: `by ${s.fullName}` });
    return `${p.full_name} ${status === "disabled" ? "can no longer sign in (signed out everywhere)" : "can sign in again"}.`;
  }, { actorId: s.id });
}

export async function listPeople(s: Session) {
  if (s.role !== "admin" && s.role !== "client_admin") throw new AuthError("Only admins manage access.");
  return withSystem((db) => rows<{ id: string; full_name: string; email: string; role: string; status: string; mfa_enabled: boolean; last_login_at: string | null; company: string | null; invite_id: string | null; invite_expires: string | null }>(db,
    `select p.id, p.full_name, p.email, p.role, p.status, p.mfa_enabled, p.last_login_at, c.name company,
            (select i.id from invites i where i.profile_id = p.id and i.accepted_at is null and i.revoked_at is null order by i.created_at desc limit 1) invite_id,
            (select i.expires_at from invites i where i.profile_id = p.id and i.accepted_at is null and i.revoked_at is null order by i.created_at desc limit 1)::text invite_expires
     from profiles p left join client_companies c on c.id = p.client_company_id
     where p.org_id = $1 and ($2::uuid is null or p.client_company_id = $2) order by c.name nulls first, p.full_name`,
    [s.orgId, s.role === "admin" ? null : s.clientCompanyId]));
}
