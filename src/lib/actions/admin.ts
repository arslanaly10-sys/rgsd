"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { dispatchNotifications } from "@/lib/channels";

export async function dispatchNowAction() {
  const s = await requireSession("staff");
  if (s.role !== "admin") redirect("/ops");
  const r = await dispatchNotifications(200);
  revalidatePath("/ops/admin/outbox");
  redirect("/ops/admin/outbox?msg=" + encodeURIComponent(`ok:${r.summary}`));
}
