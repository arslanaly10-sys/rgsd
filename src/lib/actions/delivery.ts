"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { refuseViewer, requireSession } from "@/lib/auth";
import { rows, withSystem, withUser } from "@/lib/db";
import { decideSignoff, logProgress, raiseInstruction, respondInstruction, SignoffError, submitMeasurement, submitVariation } from "@/lib/projects";

const back = (path: string, msg: string): never => redirect(`${path.split("?")[0]}?msg=${encodeURIComponent(msg)}`);
const from = (fd: FormData, fallback: string) => {
  const p = String(fd.get("back") ?? "");
  return p.startsWith("/ops/") || p.startsWith("/client/") ? p : fallback;
};
const CONTROLS = ["admin", "ops_manager", "site_supervisor", "estimator"];

export async function logProgressAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/progress");
  if (!CONTROLS.includes(s.role)) back(path, "err:Only supervisors, estimators or operations can log progress.");
  const qty = Number(fd.get("qty") ?? 0);
  const partial = Math.min(1, Math.max(0, Number(fd.get("partial") ?? 50) / 100));
  if (!Number.isFinite(qty) || qty < 0) back(path, "err:Quantity must be zero or more.");
  let msg: string;
  try {
    const r = await logProgress(s, { areaId: String(fd.get("areaId")), qty, stage: String(fd.get("stage")), partial, notes: String(fd.get("notes") ?? "").slice(0, 500) || undefined });
    msg = `ok:Logged on ${r.code}. Installed now ${r.installed}.${r.over ? " This is above the BOQ quantity: raise a variation if the extra is the client's." : ""}`;
  } catch (e) { msg = `err:${(e as Error).message}`; }
  revalidatePath("/ops", "layout");
  back(path, msg);
}

export async function submitMeasurementAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/projects");
  if (!["admin", "ops_manager", "estimator"].includes(s.role)) back(path, "err:Only operations or estimating can submit measurement sheets.");
  let msg: string;
  try {
    const r = await submitMeasurement(s, String(fd.get("projectId")));
    msg = `ok:${r.ref} sent to the client for signature: ${r.lines} line(s), SAR ${r.total.toLocaleString("en")}.`;
  } catch (e) { msg = `err:${(e as Error).message}`; }
  revalidatePath(path);
  back(path, msg);
}

export async function raiseInstructionAction(fd: FormData) {
  const s = await requireSession();
  await refuseViewer(s);
  const path = from(fd, s.isStaff ? "/ops/instructions" : "/client/instructions");
  const title = String(fd.get("title") ?? "").trim();
  if (title.length < 5) back(path, s.locale === "ar" ? "err:اكتب عنواناً واضحاً للتعليمات." : "err:Give the instruction a clear title (at least 5 characters).");
  if (!s.isStaff && !["client_admin", "client_user", "client_consultant"].includes(s.role)) back(path, "err:Your role can't issue site instructions.");
  let msg: string;
  try {
    const r = await raiseInstruction(s, { projectId: String(fd.get("projectId")), title: title.slice(0, 200), description: String(fd.get("description") ?? "").slice(0, 2000) || undefined });
    msg = s.locale === "ar" ? `ok:تم تسجيل التعليمات ${r.ref}. سيرد فريق RGS أو يرسل أمر تغيير مسعّر.` : `ok:Instruction ${r.ref} recorded. RGS will acknowledge it or send a priced variation for approval.`;
  } catch (e) { msg = `err:${(e as Error).message}`; }
  revalidatePath(path);
  back(path, msg);
}

export async function respondInstructionAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/instructions");
  const status = String(fd.get("status")) as "acknowledged" | "rejected" | "closed";
  const response = String(fd.get("response") ?? "").trim();
  if (!["acknowledged", "rejected", "closed"].includes(status)) back(path, "err:Pick a response.");
  if (response.length < 5) back(path, "err:Write a short response for the client.");
  await respondInstruction(s, String(fd.get("id")), status, response.slice(0, 1000));
  revalidatePath(path);
  back(path, `ok:Response sent (${status}).`);
}

export async function submitVariationAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/instructions");
  if (!["admin", "ops_manager", "estimator"].includes(s.role)) back(path, "err:Only estimating or operations can price variations.");
  const lines = [0, 1, 2, 3, 4].map((i) => ({ description: String(fd.get(`d${i}`) ?? "").trim(), qty: Number(fd.get(`q${i}`) ?? 0), uom: String(fd.get(`u${i}`) ?? "m2"), rate: Number(fd.get(`r${i}`) ?? 0) })).filter((l) => l.description && l.qty > 0);
  let msg: string;
  try {
    const r = await submitVariation(s, { instructionId: String(fd.get("instructionId")), title: String(fd.get("title") ?? "Variation").slice(0, 200), description: String(fd.get("description") ?? "") || undefined, lines, daysImpact: Number(fd.get("days") ?? 0) || 0 });
    msg = `ok:${r.ref} sent for client approval: SAR ${r.amount.toLocaleString("en")}.${r.amount > 100000 ? " Above SAR 100,000, so the client's procurement must also approve." : ""}`;
  } catch (e) { msg = `err:${(e as Error).message}`; }
  revalidatePath(path);
  back(path, msg);
}

export async function decideSignoffAction(fd: FormData) {
  const s = await requireSession("client");
  await refuseViewer(s);
  const path = from(fd, "/client/signoffs");
  const decision = fd.get("decision") === "approved" ? "approved" : "rejected";
  let msg: string;
  try {
    const r = await decideSignoff(s, String(fd.get("id")), decision, String(fd.get("comment") ?? "").trim() || null, String(fd.get("signature") ?? ""));
    const ar = s.locale === "ar";
    msg = r.status === "pending"
      ? (ar ? `ok:تم توقيعك. بانتظار: ${r.waitingFor.join("، ")}.` : `ok:Signed. Still waiting for: ${r.waitingFor.map((x) => x.replace("client_", "")).join(", ")}.`)
      : (ar ? `ok:تم ${r.status === "approved" ? "الاعتماد" : "الرفض"}. ${r.effect}` : `ok:${r.status === "approved" ? "Approved" : "Rejected"}. ${r.effect}`);
  } catch (e) {
    msg = `err:${e instanceof SignoffError ? e.message : "Couldn't record your decision. Try again."}`;
    if (!(e instanceof SignoffError)) console.error("[signoff]", e);
  }
  revalidatePath("/client", "layout");
  back(path, msg);
}

/** Mark a dependency met: RGS for its own items, the client for client-side prerequisites. */
export async function markDependencyAction(fd: FormData) {
  const s = await requireSession();
  await refuseViewer(s);
  const path = from(fd, s.isStaff ? "/ops/dependencies" : "/client/dependencies");
  const id = String(fd.get("id"));
  const status = String(fd.get("status")) === "met" ? "met" : String(fd.get("status")) === "blocked" ? "blocked" : "open";
  const dep = (await withUser(s, (db) => rows<{ owner_side: string; scaffold_id: string | null }>(db, "select owner_side, scaffold_id from dependencies where id = $1", [id])))[0];
  if (!dep) back(path, "err:Dependency not found.");
  if (dep!.scaffold_id && status === "met") back(path, "err:This one clears itself when the scaffold is green-tagged by an inspector.");
  if (!s.isStaff && dep!.owner_side !== "client") back(path, "err:Only RGS can update its own items.");
  await withSystem((db) => db.query("update dependencies set status = $2, met_at = case when $2 = 'met' then now() else null end where id = $1", [id, status]), { actorId: s.id });
  revalidatePath(path);
  back(path, s.locale === "ar" ? "ok:تم التحديث." : `ok:Marked ${status}.`);
}

export async function updateMilestoneAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/milestones");
  const id = String(fd.get("id"));
  if (fd.get("achieved")) await withUser(s, (db) => db.query("update milestones set status = 'achieved', achieved_at = current_date where id = $1", [id]));
  else {
    const f = String(fd.get("forecast") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) back(path, "err:Pick a forecast date.");
    await withUser(s, (db) => db.query("update milestones set forecast_date = $2 where id = $1", [id, f]));
  }
  revalidatePath(path);
  back(path, "ok:Milestone updated.");
}

export async function triageAction(fd: FormData) {
  const s = await requireSession("staff");
  const status = String(fd.get("status"));
  if (!["triage", "estimating", "cancelled", "new"].includes(status)) back("/ops/triage", "err:Unknown status.");
  await withUser(s, (db) => db.query("update requests set status = $2, priority = coalesce($3, priority) where id = $1", [String(fd.get("id")), status, (fd.get("priority") as string) || null]));
  revalidatePath("/ops", "layout");
  back("/ops/triage", "ok:Request updated.");
}

export async function markAllReadAction(fd: FormData) {
  const s = await requireSession();
  await refuseViewer(s);
  await withUser(s, async (db) => {
    const ids = await rows<{ id: string }>(db, "select id from notifications order by created_at desc limit 300");
    for (const n of ids) await db.query("insert into notification_reads (notification_id, user_id) values ($1,$2) on conflict do nothing", [n.id, s.id]);
  });
  revalidatePath("/", "layout");
  back(from(fd, s.isStaff ? "/ops/notifications" : "/client/notifications"), s.locale === "ar" ? "ok:تم تعليم الكل كمقروء." : "ok:All marked as read.");
}
