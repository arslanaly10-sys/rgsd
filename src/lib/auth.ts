import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { one, withSystem } from "./db";
import { isStaffRole, type Role } from "./roles";

const COOKIE = "rgs_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-only-insecure-secret");

export type Session = {
  id: string;
  orgId: string;
  role: Role;
  isStaff: boolean;
  clientCompanyId: string | null;
  companyName: string | null;
  companyNameAr: string | null;
  fullName: string;
  fullNameAr: string | null;
  title: string | null;
  email: string;
  locale: "en" | "ar";
  mfaEnabled: boolean;
};

const PENDING = "rgs_mfa_pending";

export async function createSession(profileId: string) {
  const v = (await withSystem((db) => one<{ v: number }>(db, "select session_version v from profiles where id = $1", [profileId])))?.v ?? 0;
  const token = await new SignJWT({ sub: profileId, v })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(PENDING);
}

/** After a correct email code, when an authenticator code is still needed (5 minutes). */
export async function setPendingMfa(profileId: string) {
  const token = await new SignJWT({ sub: profileId, purpose: "mfa" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(secret());
  (await cookies()).set(PENDING, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
}

export async function getPendingMfa(): Promise<string | null> {
  const token = (await cookies()).get(PENDING)?.value;
  if (!token) return null;
  try {
    const p = (await jwtVerify(token, secret())).payload;
    return p.purpose === "mfa" && typeof p.sub === "string" ? p.sub : null;
  } catch { return null; }
}

export async function clearPendingMfa() {
  (await cookies()).delete(PENDING);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined, v: number | undefined;
  try {
    const p = (await jwtVerify(token, secret())).payload;
    if (p.purpose) return null;
    sub = p.sub; v = typeof p.v === "number" ? p.v : 0;
  } catch {
    return null;
  }
  if (!sub) return null;
  const s = await getSessionById(sub, true);
  // Disabled people and tokens from before "sign out everywhere" stop working at once.
  if (!s || s.status !== "active" || s.sessionVersion !== v) return null;
  const { status: _s, sessionVersion: _v, ...rest } = s;
  return rest;
}

export async function getSessionById(id: string): Promise<Session | null>;
export async function getSessionById(id: string, withState: true): Promise<(Session & { status: string; sessionVersion: number }) | null>;
export async function getSessionById(id: string, withState = false): Promise<(Session & { status?: string; sessionVersion?: number }) | null> {
  const p = await withSystem((db) =>
    one<{
      id: string; org_id: string; role: Role; client_company_id: string | null; full_name: string; full_name_ar: string | null;
      title: string | null; email: string; locale: "en" | "ar"; company_name: string | null; company_name_ar: string | null;
      status: string; session_version: number; mfa_enabled: boolean;
    }>(db, `select p.*, c.name as company_name, c.name_ar as company_name_ar
            from profiles p left join client_companies c on c.id = p.client_company_id where p.id = $1`, [id]),
  );
  if (!p) return null;
  return {
    id: p.id, orgId: p.org_id, role: p.role, isStaff: isStaffRole(p.role), clientCompanyId: p.client_company_id,
    companyName: p.company_name, companyNameAr: p.company_name_ar, fullName: p.full_name, fullNameAr: p.full_name_ar,
    title: p.title, email: p.email, locale: p.locale, mfaEnabled: p.mfa_enabled,
    ...(withState ? { status: p.status, sessionVersion: p.session_version } : {}),
  };
}

export async function requireSession(area?: "staff" | "client", opts: { allowWithoutMfa?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  // In production sign-in mode, roles that must use an authenticator set one up before anything else.
  if (!opts.allowWithoutMfa && process.env.AUTH_MODE === "otp" && !s.mfaEnabled && (process.env.MFA_REQUIRED_ROLES ?? "admin,finance").split(",").map((r) => r.trim()).includes(s.role)) redirect("/account/security?required=1");
  if (area === "staff" && !s.isStaff) redirect("/client");
  if (area === "client" && s.isStaff) redirect("/ops");
  return s;
}
