"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, getSession } from "@/lib/auth";
import { one, withSystem } from "@/lib/db";

export async function signInAs(formData: FormData) {
  if (process.env.AUTH_MODE && process.env.AUTH_MODE !== "demo") throw new Error("Demo sign-in is disabled");
  const id = String(formData.get("profileId") ?? "");
  const p = await withSystem((db) => one<{ id: string; role: string; locale: string }>(db, "select id, role, locale from profiles where id = $1", [id]));
  if (!p) redirect("/login");
  await createSession(p.id);
  (await cookies()).set("locale", p.locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect(p.role.startsWith("client_") ? "/client" : "/ops");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}

export async function toggleLocale(formData: FormData) {
  const next = formData.get("locale") === "ar" ? "ar" : "en";
  (await cookies()).set("locale", next, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  const s = await getSession();
  if (s) await withSystem((db) => db.query("update profiles set locale = $1 where id = $2", [next, s.id]));
  revalidatePath("/", "layout");
}
