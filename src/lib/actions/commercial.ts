"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { invokeTool } from "@/lib/agents/policy";
import { withSystem } from "@/lib/db";
import { CommercialError, createCreditNote, recordPayment, releaseRetention, submitClaim } from "@/lib/commercial";
import { closeTicket, createTicket, replyTicket, SupportError } from "@/lib/support";
import { bookRefreshers, readCertificate, WorkforceError } from "@/lib/workforce";
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, sniffMime } from "@/lib/storage";

/* Server actions for Phase C: commercial (claims, retention, credit notes, payments), support tickets and workforce. */

const back = (path: string, msg: string): never => redirect(`${path.split("?")[0]}?msg=${encodeURIComponent(msg)}`);
const from = (fd: FormData, fallback: string) => {
  const p = String(fd.get("back") ?? "");
  return p.startsWith("/ops/") || p.startsWith("/client/") ? p : fallback;
};
const known = (e: unknown) => e instanceof CommercialError || e instanceof SupportError || e instanceof WorkforceError;
async function run(path: string, fn: () => Promise<string>) {
  let msg: string;
  try { msg = `ok:${await fn()}`; }
  catch (e) {
    msg = `err:${known(e) ? (e as Error).message : "Something went wrong. Nothing was changed."}`;
    if (!known(e)) console.error("[commercial]", e);
  }
  revalidatePath("/", "layout");
  back(path, msg);
}

// ───────── Commercial ─────────
export async function submitClaimAction(fd: FormData) {
  const s = await requireSession("staff");
  await run("/ops/claims", () => submitClaim(s, String(fd.get("projectId"))));
}

export async function releaseRetentionAction(fd: FormData) {
  const s = await requireSession("staff");
  await run("/ops/claims", () => releaseRetention(s, String(fd.get("projectId"))));
}

export async function createCreditNoteAction(fd: FormData) {
  const s = await requireSession("staff");
  await run("/ops/credit-notes", async () => {
    const ref = await createCreditNote(s, {
      invoiceRef: String(fd.get("invoiceRef") ?? "").trim().toUpperCase(), kind: fd.get("kind") === "debit" ? "debit" : "credit",
      reason: String(fd.get("reason") ?? "").slice(0, 500), amount: Number(fd.get("amount")), description: String(fd.get("description") ?? fd.get("reason") ?? "").slice(0, 300),
    });
    return `${ref} drafted. Submit it for Finance approval to issue it.`;
  });
}

export async function submitCreditNoteAction(fd: FormData) {
  const s = await requireSession("staff");
  const ref = String(fd.get("ref"));
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "issue_credit_note", { ref });
  if (r.kind === "approval") await withSystem((db) => db.query("update credit_notes set status = 'pending_approval' where ref = $1 and org_id = $2 and status = 'draft'", [ref, s.orgId]), { actorId: s.id });
  revalidatePath("/", "layout");
  back("/ops/credit-notes", r.kind === "approval" ? `ok:${ref} sent to Finance for approval. It is issued with its ZATCA QR once approved.` : r.kind === "result" ? `ok:${r.output.brief_en}` : `err:${r.output.brief_en}`);
}

export async function recordPaymentAction(fd: FormData) {
  const s = await requireSession("staff");
  await run("/ops/statement", () => recordPayment(s, {
    invoiceRef: String(fd.get("invoiceRef") ?? "").trim().toUpperCase(), amount: Number(fd.get("amount")),
    paidOn: String(fd.get("paidOn") || new Date().toISOString().slice(0, 10)), reference: String(fd.get("reference") ?? "").slice(0, 80) || undefined, method: String(fd.get("method") ?? "bank_transfer"),
  }));
}

// ───────── Support ─────────
export async function createTicketAction(fd: FormData) {
  const s = await requireSession();
  const base = s.isStaff ? "/ops/support" : "/client/support";
  let t: Awaited<ReturnType<typeof createTicket>>;
  try {
    t = await createTicket(s, {
      category: String(fd.get("category")), priority: String(fd.get("priority") ?? "normal"), subject: String(fd.get("subject") ?? ""), body: String(fd.get("body") ?? ""),
      projectId: String(fd.get("projectId") || "") || null, warrantyId: String(fd.get("warrantyId") || "") || null, clientCompanyId: String(fd.get("clientCompanyId") || "") || undefined,
    });
  } catch (e) {
    if (!known(e)) console.error("[support]", e);
    return back(base, `err:${known(e) ? (e as Error).message : "Something went wrong. Nothing was changed."}`);
  }
  revalidatePath("/", "layout");
  back(`${base}/${t.id}`, `ok:${s.locale === "ar" && !s.isStaff ? `تم فتح ${t.ref}. سترد RGS خلال ${t.respondH} ساعة.` : `${t.ref} opened. RGS replies within ${t.respondH} h and aims to resolve within ${t.resolveH} h.`}`);
}

export async function replyTicketAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  await run(`${s.isStaff ? "/ops" : "/client"}/support/${id}`, () => replyTicket(s, id, String(fd.get("body") ?? ""), { internal: fd.get("internal") === "1", status: String(fd.get("status") ?? "") || undefined }));
}

export async function closeTicketAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id"));
  await run(`${s.isStaff ? "/ops" : "/client"}/support/${id}`, () => closeTicket(s, id, Number(fd.get("satisfaction")) || null));
}

// ───────── Workforce ─────────
export async function assignCrewAction(fd: FormData) {
  const s = await requireSession("staff");
  const nos = String(fd.get("employeeNos") ?? "").toUpperCase().match(/RGS-\d{4}/g) ?? [];
  if (!nos.length) back("/ops/workforce", "err:Enter employee numbers like RGS-1031.");
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "assign_crew", { site_code: String(fd.get("siteCode")), employee_nos: [...new Set(nos)].slice(0, 30), start_in_days: Number(fd.get("startInDays") ?? 1) });
  revalidatePath("/", "layout");
  back("/ops/workforce", r.kind === "approval" ? "ok:Crew change sent to the Operations Manager for approval." : r.kind === "result" ? `${r.output.error ? "err" : (r.output.assigned as string[] | undefined)?.length ? "ok" : "err"}:${String(r.output.brief_en).replace(/\n/g, " ")}` : `err:${r.output.brief_en}`);
}

export async function uploadCertificateAction(fd: FormData) {
  const s = await requireSession("staff");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) back("/ops/workforce", "err:Choose a photo or PDF of the certificate.");
  const f = file as File;
  if (f.size > MAX_UPLOAD_BYTES) back("/ops/workforce", "err:That file is over 15 MB.");
  const data = Buffer.from(await f.arrayBuffer());
  const mime = sniffMime(data, f.type);
  if (!mime || !ALLOWED_UPLOADS[mime]) back("/ops/workforce", "err:Upload a JPG, PNG, WebP or PDF.");
  await run("/ops/workforce", () => readCertificate(s, { name: f.name, mime: mime!, data }, String(fd.get("employeeNo") ?? "").trim().toUpperCase() || undefined));
}

export async function verifyCertificateAction(fd: FormData) {
  const s = await requireSession("staff");
  if (!["admin", "hse_training"].includes(s.role)) back("/ops/workforce", "err:Only HSE & Training verifies certificates against the original.");
  await withSystem((db) => db.query("update certifications set verified = true where id = $1 and org_id = $2", [String(fd.get("id")), s.orgId]), { actorId: s.id });
  revalidatePath("/", "layout");
  back("/ops/workforce", "ok:Certificate verified against the original.");
}

export async function bookRefreshersAction() {
  const s = await requireSession("staff");
  await run("/ops/workforce", () => bookRefreshers(s));
}
