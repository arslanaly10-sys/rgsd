"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { QualityError, raiseFinding, recordItpStep, requestCompletion, reviewDocument, submitRevision, updateFinding, uploadEvidence } from "@/lib/quality";

const back = (path: string, msg: string): never => redirect(`${path.split("?")[0]}?msg=${encodeURIComponent(msg)}`);
const from = (fd: FormData, fallback: string) => {
  const p = String(fd.get("back") ?? "");
  return p.startsWith("/ops/") || p.startsWith("/client/") ? p : fallback;
};
async function run(path: string, fn: () => Promise<string>) {
  let msg: string;
  try { msg = `ok:${await fn()}`; }
  catch (e) {
    msg = `err:${e instanceof QualityError ? e.message : "Something went wrong. Nothing was changed."}`;
    if (!(e instanceof QualityError)) console.error("[quality]", e);
  }
  revalidatePath("/", "layout");
  back(path, msg);
}

export async function recordItpAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/inspections");
  const raw = String(fd.get("readings") ?? "");
  const readings = raw.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean).map((r) => (/^-?\d+(\.\d+)?$/.test(r) ? Number(r) : r));
  const visual = fd.get("visual");
  await run(path, async () => (await recordItpStep(s, { stepId: String(fd.get("stepId")), readings, note: String(fd.get("note") ?? "").slice(0, 500) || undefined, passVisual: visual == null ? undefined : visual === "pass" })).message);
}

export async function raiseFindingAction(fd: FormData) {
  const s = await requireSession();
  const path = from(fd, s.isStaff ? "/ops/findings" : "/client/findings");
  const title = String(fd.get("title") ?? "").trim();
  if (title.length < 5) back(path, s.locale === "ar" ? "err:اكتب وصفاً واضحاً للملاحظة." : "err:Describe the finding in a few words.");
  await run(path, async () => {
    const r = await raiseFinding(s, { projectId: String(fd.get("projectId")), areaId: String(fd.get("areaId") || "") || null, kind: String(fd.get("kind") ?? "observation"), severity: String(fd.get("severity") ?? "medium"), title: title.slice(0, 200), description: String(fd.get("description") ?? "").slice(0, 2000) || undefined });
    return s.locale === "ar" && !s.isStaff ? `تم تسجيل ${r.ref}. سترد RGS بإجراء تصحيحي خلال ${r.due} يوم.` : `${r.ref} raised. Corrective action due within ${r.due} day(s).`;
  });
}

export async function findingStepAction(fd: FormData) {
  const s = await requireSession();
  const path = from(fd, s.isStaff ? "/ops/corrective" : "/client/corrective");
  const step = String(fd.get("step")) as "plan" | "verify" | "close" | "reopen";
  await run(path, () => updateFinding(s, String(fd.get("id")), step, {
    root_cause: String(fd.get("root_cause") ?? "") || undefined, correction: String(fd.get("correction") ?? "") || undefined, corrective_action: String(fd.get("corrective_action") ?? "") || undefined,
    preventive_action: String(fd.get("preventive_action") ?? "") || undefined, action_due: String(fd.get("action_due") ?? "") || undefined, note: String(fd.get("note") ?? "") || undefined,
  }));
}

export async function reviewDocumentAction(fd: FormData) {
  const s = await requireSession("client");
  const path = from(fd, "/client/docreview");
  const code = String(fd.get("code")) as "A" | "B" | "C" | "D";
  if (!["A", "B", "C", "D"].includes(code)) back(path, "err:Pick a review code.");
  const comments = String(fd.get("comments") ?? "").split("\n").map((c) => c.trim()).filter(Boolean);
  await run(path, () => reviewDocument(s, String(fd.get("revId")), code, comments));
}

export async function submitRevisionAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/documents");
  const responses = [0, 1, 2, 3, 4, 5].map((i) => String(fd.get(`response_${i}`) ?? ""));
  const file = fd.get("file");
  await run(path, () => submitRevision(s, { documentId: String(fd.get("documentId")), file: file instanceof File ? file : null, responses: responses.some((r) => r.trim()) ? responses : undefined }));
}

export async function uploadEvidenceAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/evidence");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) back(path, "err:Choose a photo or PDF.");
  await run(path, () => uploadEvidence(s, String(fd.get("areaId")), file as File, String(fd.get("caption") ?? "")));
}

export async function requestCompletionAction(fd: FormData) {
  const s = await requireSession("staff");
  const path = from(fd, "/ops/handover");
  await run(path, () => requestCompletion(s, String(fd.get("projectId")), fd.get("override") === "1"));
}
