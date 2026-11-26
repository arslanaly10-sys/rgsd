"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { refuseViewer, requireSession } from "@/lib/auth";
import { one, rows, withSystem, withUser } from "@/lib/db";
import { invokeTool } from "@/lib/agents/policy";
import { estimateRequest } from "@/lib/workflows/estimate";
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, putFile, sniffMime } from "@/lib/storage";

const back = (path: string, msg: string): never => redirect(`${path}?msg=${encodeURIComponent(msg)}`);

export async function uploadRequestDocument(formData: FormData) {
  const s = await requireSession();
  await refuseViewer(s);
  const requestId = String(formData.get("requestId"));
  const path = s.isStaff ? `/ops/requests/${requestId}` : `/client/requests`;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back(path, "err:Choose a file to upload.");
  const f = file as File;
  if (f.size > MAX_UPLOAD_BYTES) back(path, "err:The file is larger than 15 MB. Upload a smaller PDF or photo.");
  const buf = Buffer.from(await f.arrayBuffer());
  const mime = sniffMime(buf, f.type);
  if (!mime || !ALLOWED_UPLOADS[mime]) back(path, "err:Upload a PDF, PNG, JPG, WebP or text file.");
  // Visibility check as the user (RLS): a client can only attach to their own requests.
  const r = await withUser(s, (db) => one<{ id: string; client_company_id: string; site_id: string | null }>(db, "select id, client_company_id, site_id from requests where id = $1", [requestId]));
  if (!r) back(path, "err:Request not found.");
  const kind = ["drawing", "rfq", "boq", "photo", "other"].includes(String(formData.get("kind"))) ? String(formData.get("kind")) : "rfq";
  const key = `${s.orgId}/requests/${requestId}/${randomUUID()}.${ALLOWED_UPLOADS[mime!]}`;
  await putFile(key, buf, mime!);
  await withSystem((db) => db.query(
    `insert into documents (org_id, client_company_id, site_id, entity_type, entity_id, kind, title, storage_path, mime, size_bytes, uploaded_by) values ($1,$2,$3,'request',$4,$5,$6,$7,$8,$9,$10)`,
    [s.orgId, r!.client_company_id, r!.site_id, requestId, kind, f.name.slice(0, 200), key, mime, f.size, s.id]), { actorId: s.id });
  revalidatePath(path);
  back(path, `ok:Uploaded ${f.name}.`);
}

export async function runEstimator(formData: FormData) {
  const s = await requireSession("staff");
  const requestId = String(formData.get("requestId"));
  const path = `/ops/requests/${requestId}`;
  if (!["admin", "ops_manager", "estimator"].includes(s.role)) back(path, "err:Only estimators and operations managers can run the Estimator.");
  const r = await withUser(s, (db) => one<{ id: string }>(db, "select id from requests where id = $1", [requestId]));
  if (!r) back(path, "err:Request not found.");
  const res = await estimateRequest(s.orgId, requestId, s.id);
  if (!res.quote) back(path, `err:The Estimator stopped at ${res.error ?? res.status}. It will retry automatically.`);
  redirect(`/ops/quotes/${res.quote!.quoteId}?msg=${encodeURIComponent(`ok:Draft ${res.quote!.ref} created. Review the lines, then submit for approval.`)}`);
}

export async function saveQuoteLines(formData: FormData) {
  const s = await requireSession("staff");
  const quoteId = String(formData.get("quoteId"));
  const path = `/ops/quotes/${quoteId}`;
  if (!["admin", "ops_manager", "estimator"].includes(s.role)) back(path, "err:Only estimators can edit quotes.");
  const result = await withUser(s, async (db) => {
    const q = await one<{ status: string; ai_generated: boolean; scope: unknown; vat_rate: string }>(db, "select status, ai_generated, scope, vat_rate from quotes where id = $1", [quoteId]);
    if (!q) return "err:Quote not found.";
    if (!["draft", "pending_approval"].includes(q.status)) return "err:Sent quotes can't be edited. Create a revision instead.";
    const before = await rows<{ id: string; description: string; qty: string; rate: string; unit: string }>(db, "select id, description, qty, rate, unit from quote_lines where quote_id = $1 order by sort", [quoteId]);
    let changed = false;
    for (const l of before) {
      if (formData.get(`remove_${l.id}`)) { await db.query("delete from quote_lines where id = $1", [l.id]); changed = true; continue; }
      const qty = Number(formData.get(`qty_${l.id}`)), rate = Number(formData.get(`rate_${l.id}`));
      const desc = String(formData.get(`desc_${l.id}`) ?? l.description).slice(0, 300);
      if (!Number.isFinite(qty) || !Number.isFinite(rate) || qty < 0 || rate < 0) return `err:Check the quantity and rate on “${l.description}”.`;
      if (qty !== Number(l.qty) || rate !== Number(l.rate) || desc !== l.description) {
        changed = true;
        await db.query("update quote_lines set qty=$2::numeric, rate=$3::numeric, description=$4, amount=round($2::numeric * $3::numeric, 2) where id=$1", [l.id, qty, rate, desc]);
      }
    }
    const t = await one<{ subtotal: string }>(db, "select coalesce(sum(amount),0) subtotal from quote_lines where quote_id = $1", [quoteId]);
    const sub = Number(t!.subtotal), vat = Math.round(sub * Number(q.vat_rate) * 100) / 100;
    await db.query("update quotes set subtotal=$2, vat=$3, total=$4, assumptions=coalesce($5, assumptions) where id=$1", [quoteId, sub, vat, sub + vat, (formData.get("assumptions") as string | null)?.slice(0, 4000) ?? null]);
    if (changed && q.ai_generated) {
      // Learn from the estimator's correction: stored as an example the Estimator reads next time.
      const after = await rows(db, "select description, qty, unit, rate from quote_lines where quote_id = $1 order by sort", [quoteId]);
      await db.query("insert into agent_examples (org_id, agent, task, input, output, corrected_output, note, created_by) values ($1,'estimator','price_quote',$2,$3,$4,$5,$6)",
        [s.orgId, JSON.stringify(q.scope ?? {}), JSON.stringify(before.map(({ description, qty, unit, rate }) => ({ description, qty, unit, rate }))), JSON.stringify(after), String(formData.get("lesson") ?? "").slice(0, 300) || "Estimator adjusted AI quote lines", s.id]);
    }
    return changed ? "ok:Saved. Your changes are kept as an example for the Estimator agent." : "ok:Saved.";
  }).catch((e) => {
    console.error("[saveQuoteLines]", e);
    return "err:Couldn't save the quote. Nothing was changed; try again or tell the system administrator.";
  });
  revalidatePath(path);
  back(path, result);
}

export async function submitQuote(formData: FormData) {
  const s = await requireSession("staff");
  const quoteId = String(formData.get("quoteId"));
  const path = `/ops/quotes/${quoteId}`;
  const q = await withUser(s, (db) => one<{ ref: string; status: string }>(db, "select ref, status from quotes where id = $1", [quoteId]));
  if (!q) back(path, "err:Quote not found.");
  if (q!.status !== "draft") back(path, `err:This quote is already ${q!.status.replace(/_/g, " ")}.`);
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "send_quote", { quote_ref: q!.ref });
  if (r.kind === "approval") {
    await withSystem((db) => db.query("update quotes set status = 'pending_approval' where id = $1", [quoteId]), { actorId: s.id });
    revalidatePath(path);
    back(path, "ok:Submitted. An operations manager approves before it goes to the client.");
  }
  revalidatePath(path);
  back(path, r.kind === "result" ? `ok:${r.output.brief_en}` : `err:${r.output.brief_en}`);
}

export async function clientDecideQuote(formData: FormData) {
  const s = await requireSession("client");
  await refuseViewer(s);
  const quoteId = String(formData.get("quoteId"));
  const decision = formData.get("decision") === "accepted" ? "accepted" : "rejected";
  const path = `/client/quotes/${quoteId}`;
  const note = String(formData.get("note") ?? "").slice(0, 500) || null;
  const q = await withUser(s, (db) => one<{ id: string; ref: string; status: string; request_id: string | null; valid_until: string | null }>(db, "select id, ref, status, request_id, valid_until from quotes where id = $1", [quoteId]));
  if (!q) back(path, "err:Quote not found.");
  if (q!.status !== "sent") back(path, `err:This quote is already ${q!.status}.`);
  if (q!.valid_until && new Date(q!.valid_until) < new Date(new Date().toDateString())) back(path, "err:This quote has expired. Ask RGS for a revised quote.");
  await withSystem(async (db) => {
    await db.query("update quotes set status=$2, client_decision_note=$3, decided_at=now() where id=$1 and status='sent'", [quoteId, decision, note]);
    if (q!.request_id) {
      await db.query("update requests set status=$2 where id=$1", [q!.request_id, decision === "accepted" ? "won" : "lost"]);
      // An accepted quote supersedes the request's other open quotes.
      if (decision === "accepted") await db.query("update quotes set status='expired' where request_id=$1 and id<>$2 and status in ('draft','pending_approval','sent')", [q!.request_id, quoteId]);
    }
    await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['estimator','ops_manager']), 'quote_decision', $2, $3, $4",
      [s.orgId, `${s.companyName}: ${q!.ref} ${decision}`, `${s.companyNameAr ?? s.companyName}: ${q!.ref} ${decision === "accepted" ? "مقبول" : "مرفوض"}`, `/ops/quotes/${quoteId}`]);
  }, { actorId: s.id });
  revalidatePath(path);
  const ar = s.locale === "ar";
  back(path, decision === "accepted"
    ? (ar ? "ok:شكراً لك. سيتواصل معك فريق RGS لجدولة التحريك." : "ok:Thank you. RGS will contact you to schedule mobilisation.")
    : (ar ? "ok:تم التسجيل. سيتابع فريق RGS ملاحظاتك." : "ok:Noted. RGS will follow up on your feedback."));
}

export async function createClientRequest(formData: FormData) {
  const s = await requireSession("client");
  await refuseViewer(s);
  const path = "/client/requests";
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const description = String(formData.get("description") ?? "").trim().slice(0, 4000);
  const siteCode = String(formData.get("site") ?? "");
  const days = Math.min(365, Math.max(0, Number(formData.get("days") ?? 7) || 7));
  if (title.length < 5) back(path, s.locale === "ar" ? "err:اكتب عنواناً قصيراً للطلب، مثل «سقالة لاستبدال صمام»." : "err:Give the request a short title, for example “Access for valve change at cellar deck”.");
  const file = formData.get("file");
  let upload: { buf: Buffer; mime: string; name: string; size: number } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) back(path, "err:The file is larger than 15 MB.");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniffMime(buf, file.type);
    if (!mime) back(path, "err:Attach a PDF, PNG, JPG, WebP or text file.");
    upload = { buf, mime: mime!, name: file.name.slice(0, 200), size: file.size };
  }
  const created = await withUser(s, async (db) => {
    const site = siteCode ? await one<{ id: string }>(db, "select id from sites where code = $1", [siteCode]) : undefined; // RLS: own sites only
    return { site, ref: undefined as { ref: string } | undefined };
  });
  const ref = created.ref?.ref ?? (await withSystem((db) => one<{ ref: string }>(db, `select 'RQ-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from requests where org_id = $1`, [s.orgId])))!.ref;
  const req = await withUser(s, (db) => one<{ id: string }>(db,
    `insert into requests (org_id, client_company_id, site_id, ref, source, title, description, required_by, created_by) values ($1,$2,$3,$4,'portal',$5,$6, current_date + $7::int, $8) returning id`,
    [s.orgId, s.clientCompanyId, created.site?.id ?? null, ref, title, description || null, days, s.id]));
  if (upload) {
    const key = `${s.orgId}/requests/${req!.id}/${randomUUID()}.${ALLOWED_UPLOADS[upload.mime]}`;
    await putFile(key, upload.buf, upload.mime);
    await withSystem((db) => db.query(`insert into documents (org_id, client_company_id, site_id, entity_type, entity_id, kind, title, storage_path, mime, size_bytes, uploaded_by) values ($1,$2,$3,'request',$4,'rfq',$5,$6,$7,$8,$9)`,
      [s.orgId, s.clientCompanyId, created.site?.id ?? null, req!.id, upload!.name, key, upload!.mime, upload!.size, s.id]), { actorId: s.id });
  }
  await withSystem((db) => db.query("insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'estimator','new_request',$2,$3,$4)",
    [s.orgId, `New request ${ref} from ${s.companyName}`, `طلب جديد ${ref} من ${s.companyNameAr ?? s.companyName}`, `/ops/requests/${req!.id}`]));
  // Agentic follow-through: the Estimator drafts a quote for RGS in the background (drafts stay invisible to clients).
  after(() => estimateRequest(s.orgId, req!.id, s.id).catch((e) => console.error("[auto-estimate]", e)));
  revalidatePath(path);
  back(path, s.locale === "ar" ? `ok:تم تسجيل الطلب ${ref}. سيؤكد فريق RGS عرض السعر وستجده هنا.` : `ok:Request ${ref} logged. RGS will confirm a quote; you'll see it here.`);
}
