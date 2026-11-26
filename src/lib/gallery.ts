import "server-only";
import { randomUUID } from "node:crypto";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser } from "./db";
import { clientCaps } from "./roles";
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, putFile, sniffMime } from "./storage";

/* Project imagery: illustrations (badged) until RGS site photos are uploaded, then real photos lead. */

export class GalleryError extends Error {}
export type Photo = {
  id: string; project_id: string; project_ref: string; area_id: string | null; area_code: string | null; service_line: string | null; stage: "before" | "during" | "after" | null;
  kind: "illustration" | "photo"; url: string; caption: string; caption_ar: string | null; taken_on: string | null; credit: string | null; is_cover: boolean; visible_to_client: boolean; uploader: string | null;
};

const SELECT = `select ph.id, ph.project_id, p.ref project_ref, ph.area_id, a.code area_code, ph.service_line, ph.stage, ph.kind,
  coalesce(ph.src, '/api/files/' || ph.document_id) url, ph.caption, ph.caption_ar, ph.taken_on::text, ph.credit, ph.is_cover, ph.visible_to_client, pr.full_name uploader
  from project_photos ph join projects p on p.id = ph.project_id left join project_areas a on a.id = ph.area_id left join profiles pr on pr.id = ph.uploaded_by`;

export async function listPhotos(s: Session, projectId: string, f: { line?: string; stage?: string; area?: string } = {}) {
  return withUser(s, (db) => rows<Photo>(db, `${SELECT} where ph.project_id = $1 and ($2::text is null or ph.service_line = $2) and ($3::text is null or ph.stage = $3) and ($4::uuid is null or ph.area_id = $4)
    order by (ph.kind = 'photo') desc, ph.taken_on desc nulls last, ph.created_at desc`, [projectId, f.line || null, f.stage || null, f.area || null]));
}

/** Cover image per project: a real photo marked cover, else the latest real photo, else the cover illustration. */
export async function covers(s: Session) {
  const r = await withUser(s, (db) => rows<{ project_id: string; url: string; kind: "illustration" | "photo"; caption: string }>(db,
    `select distinct on (ph.project_id) ph.project_id, coalesce(ph.src, '/api/files/' || ph.document_id) url, ph.kind, ph.caption from project_photos ph
     order by ph.project_id, (ph.kind = 'photo') desc, ph.is_cover desc, ph.taken_on desc nulls last`));
  return Object.fromEntries(r.map((x) => [x.project_id, x]));
}

export async function photoCounts(s: Session) {
  const r = await withUser(s, (db) => rows<{ project_id: string; n: number; real: number }>(db, "select project_id, count(*)::int n, count(*) filter (where kind = 'photo')::int real from project_photos group by project_id"));
  return Object.fromEntries(r.map((x) => [x.project_id, x]));
}

export async function uploadPhoto(s: Session, projectId: string, file: File, x: { areaId?: string | null; line?: string | null; stage?: string | null; caption: string; takenOn?: string | null; visible: boolean; cover: boolean }) {
  if (!s.isStaff && !clientCaps(s.role).request) throw new GalleryError("Your role is view-only. Ask a requester or approver in your organisation.");
  if (!s.isStaff) { x.visible = true; x.cover = false; }
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new GalleryError("Choose a photo up to 15 MB.");
  const p = await withUser(s, (db) => one<{ org_id: string; client_company_id: string; ref: string }>(db, "select org_id, client_company_id, ref from projects where id = $1", [projectId]));
  if (!p) throw new GalleryError("Project not found.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf, file.type);
  if (!mime || !mime.startsWith("image/")) throw new GalleryError("Upload a JPG, PNG or WebP photo.");
  if (x.caption.trim().length < 3) throw new GalleryError("Add a short caption (what and where).");
  const key = `${p.org_id}/photos/${randomUUID()}.${ALLOWED_UPLOADS[mime]}`;
  await putFile(key, buf, mime);
  await withSystem(async (db) => {
    const doc = await one<{ id: string }>(db, "insert into documents (org_id, client_company_id, entity_type, entity_id, kind, title, storage_path, mime, size_bytes, uploaded_by) values ($1,$2,'project',$3,'photo',$4,$5,$6,$7,$8) returning id",
      [p.org_id, p.client_company_id, projectId, x.caption.slice(0, 200), key, mime, file.size, s.id]);
    if (x.cover) await db.query("update project_photos set is_cover = false where project_id = $1", [projectId]);
    await db.query(`insert into project_photos (org_id, client_company_id, project_id, area_id, service_line, stage, kind, document_id, caption, taken_on, credit, is_cover, visible_to_client, uploaded_by)
      values ($1,$2,$3,$4,$5,$6,'photo',$7,$8,coalesce($9::date, current_date),$10,$11,$12,$13)`,
      [p.org_id, p.client_company_id, projectId, x.areaId || null, x.line || null, x.stage || null, doc!.id, x.caption.slice(0, 200), x.takenOn || null, s.isStaff ? `RGS site photo · ${s.fullName}` : `Client photo · ${s.fullName}, ${s.companyName ?? ""}`, x.cover, x.visible, s.id]);
  }, { actorId: s.id });
  return `Photo added to ${p.ref}${x.visible ? " and shared with the client" : " (RGS only until you share it)"}.`;
}

export async function updatePhoto(s: Session, id: string, op: "cover" | "share" | "hide" | "delete") {
  if (!s.isStaff) throw new GalleryError("Only RGS manages photos.");
  return withSystem(async (db) => {
    const ph = await one<{ project_id: string; org_id: string; kind: string }>(db, "select project_id, org_id, kind from project_photos where id = $1", [id]);
    if (!ph || ph.org_id !== s.orgId) throw new GalleryError("Photo not found.");
    if (op === "cover") { await db.query("update project_photos set is_cover = false where project_id = $1", [ph.project_id]); await db.query("update project_photos set is_cover = true where id = $1", [id]); return "Cover image updated."; }
    if (op === "share" || op === "hide") { await db.query("update project_photos set visible_to_client = $2 where id = $1", [id, op === "share"]); return op === "share" ? "Shared with the client." : "Hidden from the client."; }
    await db.query("delete from project_photos where id = $1", [id]);
    return "Removed from the gallery.";
  }, { actorId: s.id });
}

/** Extra figures for project cards: last update, next commitment, who acts next, what waits on the customer. */
export async function projectExtras(s: Session) {
  const r = await withUser(s, (db) => rows<{ id: string; last_update: string | null; next_due: string | null; next_name: string | null; next_overdue: boolean; awaiting: number; rgs_pm: string | null; city: string | null; region: string | null; site_type: string | null; lat: number | null; lng: number | null }>(db,
    `select p.id,
       greatest((select max(entry_date) from progress_entries e where e.project_id = p.id), (select max(taken_on) from project_photos ph where ph.project_id = p.id and ph.kind = 'photo'))::text last_update,
       (select m.coalesce_date::text from (select coalesce(m.forecast_date, m.due_date) coalesce_date, m.name from milestones m where m.project_id = p.id and m.status in ('pending','missed') order by 1 limit 1) m) next_due,
       (select m.name from milestones m where m.project_id = p.id and m.status in ('pending','missed') order by coalesce(m.forecast_date, m.due_date) limit 1) next_name,
       coalesce((select coalesce(m.forecast_date, m.due_date) < current_date from milestones m where m.project_id = p.id and m.status in ('pending','missed') order by coalesce(m.forecast_date, m.due_date) limit 1), false) next_overdue,
       ((select count(*) from signoffs so where so.project_id = p.id and so.status = 'pending') + (select count(*) from dependencies d where d.project_id = p.id and d.owner_side = 'client' and d.status in ('open','blocked')))::int awaiting,
       (select full_name from profiles where id = p.rgs_pm_id) rgs_pm, si.city, si.region, si.type site_type, si.lat, si.lng
     from projects p left join sites si on si.id = p.site_id`));
  return Object.fromEntries(r.map((x) => [x.id, x]));
}
