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
};

export async function createSession(profileId: string) {
  const token = await new SignJWT({ sub: profileId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined;
  try {
    sub = (await jwtVerify(token, secret())).payload.sub;
  } catch {
    return null;
  }
  if (!sub) return null;
  return getSessionById(sub);
}

export async function getSessionById(id: string): Promise<Session | null> {
  const p = await withSystem((db) =>
    one<{
      id: string; org_id: string; role: Role; client_company_id: string | null; full_name: string; full_name_ar: string | null;
      title: string | null; email: string; locale: "en" | "ar"; company_name: string | null; company_name_ar: string | null;
    }>(db, `select p.*, c.name as company_name, c.name_ar as company_name_ar
            from profiles p left join client_companies c on c.id = p.client_company_id where p.id = $1`, [id]),
  );
  if (!p) return null;
  return {
    id: p.id, orgId: p.org_id, role: p.role, isStaff: isStaffRole(p.role), clientCompanyId: p.client_company_id,
    companyName: p.company_name, companyNameAr: p.company_name_ar, fullName: p.full_name, fullNameAr: p.full_name_ar,
    title: p.title, email: p.email, locale: p.locale,
  };
}

export async function requireSession(area?: "staff" | "client"): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (area === "staff" && !s.isStaff) redirect("/client");
  if (area === "client" && s.isStaff) redirect("/ops");
  return s;
}
