"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { runComplianceWatcher, runDeliveryWatcher } from "@/lib/watchers/compliance";

export async function completeTask(formData: FormData) {
  const s = await requireSession("staff");
  await withUser(s, (db) => db.query("update tasks set status = 'done' where id = $1 and status = 'open'", [String(formData.get("id"))]));
  revalidatePath("/ops", "layout");
}

export async function runWatchersNow() {
  const s = await requireSession("staff");
  if (!["admin", "ops_manager", "hse_training"].includes(s.role)) redirect("/ops/tasks?msg=" + encodeURIComponent("err:Only operations, HSE or admins can run the watchers."));
  const r = await runComplianceWatcher(s.orgId);
  const d = await runDeliveryWatcher(s.orgId);
  revalidatePath("/ops", "layout");
  redirect("/ops/tasks?msg=" + encodeURIComponent(`ok:Compliance: ${r.summary} Delivery: ${d.summary}`));
}
