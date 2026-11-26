"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { decideApproval } from "@/lib/agents/policy";

export async function decide(formData: FormData) {
  const s = await requireSession("staff");
  const id = String(formData.get("id"));
  const decision = formData.get("decision") === "approved" ? "approved" : "rejected";
  const note = String(formData.get("note") ?? "").slice(0, 500) || undefined;
  let msg: string;
  try {
    const r = await decideApproval(s, id, decision, note);
    msg = r.status === "executed" ? `ok:${r.output?.brief_en ?? "Done"}` : r.status === "rejected" ? "ok:Rejected. The agent will not run it." : "err:Approved, but the action failed. Check the trace.";
  } catch (e) {
    msg = `err:${(e as Error).message}`;
  }
  revalidatePath("/ops", "layout");
  redirect(`/ops/approvals?msg=${encodeURIComponent(msg)}`);
}
