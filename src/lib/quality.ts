import "server-only";
import { randomUUID } from "node:crypto";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser, type Db } from "./db";
import { judge } from "./quality-templates";
import { requestSignoff } from "./projects";
import { stagePct, STAGES, type ServiceLine } from "./service-lines";
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, putFile, sniffMime } from "./storage";

/* Quality (ITP steps, findings/CAPA), HSE KPIs, document control, handover and warranties. */

export class QualityError extends Error {}
const QA_ROLES = ["admin", "ops_manager", "inspector", "site_supervisor", "hse_training"];
const nextRef = async (db: Db, table: string, prefix: string, orgId: string) =>
  (await one<{ ref: string }>(db, `select '${prefix}-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(${table === "controlled_documents" ? "number" : "ref"} from '\\d+$')::int), 0) + 1)::text, 3, '0') ref from ${table} where org_id = $1 and ${table === "controlled_documents" ? "number" : "ref"} like '${prefix}-%'`, [orgId]))!.ref;

// ───────────────────────── ITP ─────────────────────────

export type ItpStep = { id: string; project_id: string; project_ref: string; area_id: string; area_code: string; area_name: string; service_line: ServiceLine; seq: number; title: string; title_ar: string | null; kind: string; test_kind: string | null; criteria: string | null; acceptance: { min?: number; max?: number; unit?: string; equals?: string } | null; status: string; readings: { value: number | string; location?: string; at?: string }[]; result_note: string | null; inspected_at: string | null; inspector: string | null; signoff_id: string | null; evidence: string[] };

export async function listItp(s: Session, f: { projectId?: string; status?: string } = {}) {
  return withUser(s, (db) => rows<ItpStep>(db,
    `select st.id, st.project_id, p.ref project_ref, st.area_id, a.code area_code, a.name area_name, a.service_line, st.seq, st.title, st.title_ar, st.kind, st.test_kind, st.criteria, st.acceptance, st.status, st.readings, st.result_note, st.inspected_at, pr.full_name inspector, st.signoff_id, st.evidence
     from itp_steps st join project_areas a on a.id = st.area_id join projects p on p.id = st.project_id left join profiles pr on pr.id = st.inspected_by
     where ($1::uuid is null or st.project_id = $1) and ($2::text is null or st.status = $2) order by p.ref, a.sort, st.seq`, [f.projectId ?? null, f.status ?? null]));
}

/** Record readings for a step. Tests pass or fail against the acceptance criteria; a failure raises an NCR; hold and witness points go to the client to sign. */
export async function recordItpStep(s: Session, x: { stepId: string; readings: (number | string)[]; note?: string; passVisual?: boolean }) {
  if (!QA_ROLES.includes(s.role)) throw new QualityError("Only inspectors, supervisors, HSE or operations can record ITP results.");
  return withSystem(async (db) => {
    const st = await one<ItpStep & { org_id: string; client_company_id: string; area_stage: string }>(db,
      `select st.*, a.code area_code, a.service_line, a.stage area_stage, p.ref project_ref from itp_steps st join project_areas a on a.id = st.area_id join projects p on p.id = st.project_id where st.id = $1 for update of st`, [x.stepId]);
    if (!st || st.org_id !== s.orgId) throw new QualityError("ITP step not found.");
    if (["passed", "awaiting_client"].includes(st.status)) throw new QualityError(`This step is already ${st.status.replace("_", " ")}.`);
    const readings = x.readings.filter((r) => String(r).trim() !== "");
    let result: "passed" | "failed" | null = judge(st.acceptance, readings);
    if (!st.acceptance) result = x.passVisual === false ? "failed" : "passed";
    if (!result) throw new QualityError("Enter at least one reading for this test.");
    const needsClient = result === "passed" && (st.kind === "hold" || st.kind === "witness");
    const status = result === "failed" ? "failed" : needsClient ? "awaiting_client" : "passed";
    await db.query("update itp_steps set status = $2, readings = $3, result_note = $4, inspected_by = $5, inspected_at = now() where id = $1",
      [st.id, status, JSON.stringify(readings.map((v, i) => ({ value: v, location: `Point ${i + 1}`, at: new Date().toISOString() }))), x.note ?? null, s.id]);
    let extra = "";
    if (result === "failed") {
      const ref = await nextRef(db, "findings", "NCR", s.orgId);
      await db.query(`insert into findings (org_id, client_company_id, project_id, area_id, itp_step_id, ref, kind, source, severity, title, description, raised_by, raised_side, due_date)
        values ($1,$2,$3,$4,$5,$6,'ncr','itp','high',$7,$8,$9,'rgs', current_date + 3)`,
        [s.orgId, st.client_company_id, st.project_id, st.area_id, st.id, ref, `${st.area_code}: ${st.title} failed`, `Readings ${readings.join(", ")} against "${st.criteria}". ${x.note ?? ""}`.trim(), s.id]);
      extra = ` ${ref} raised: plan the corrective action.`;
    }
    if (needsClient) {
      const so = await requestSignoff(db, { orgId: s.orgId, clientCompanyId: st.client_company_id, projectId: st.project_id, kind: st.kind === "hold" ? "hold_point" : "inspection", entityType: "itp_step", entityId: st.id,
        title: `${st.kind === "hold" ? "Hold point" : "Witness point"}: ${st.title}, ${st.area_code}`, titleAr: st.title_ar ?? undefined, summary: `RGS result: ${readings.join(", ")}${st.acceptance?.unit ? ` ${st.acceptance.unit}` : ""}. ${x.note ?? ""}`.trim(), dueInDays: 1, requestedBy: s.id });
      await db.query("update itp_steps set signoff_id = $2 where id = $1", [st.id, so]);
      extra = " Sent to the client to witness and sign.";
    }
    if (status === "passed") await advanceArea(db, st.area_id);
    return { status, message: `${st.area_code} step ${st.seq} ${status.replace("_", " ")}.${extra}` };
  }, { actorId: s.id });
}

/** When every step of the area's current stage has passed, move the area to its next stage. */
export async function advanceArea(db: Db, areaId: string) {
  const a = await one<{ service_line: ServiceLine; stage: string }>(db, "select service_line, stage from project_areas where id = $1", [areaId]);
  if (!a || ["complete", "not_started"].includes(a.stage)) return;
  const tpl = await rows<{ status: string; stage: string | null }>(db,
    `select st.status, (select it->>'stage' from checklist_templates t, jsonb_array_elements(t.items) it where t.id = st.template_id and (it->>'seq')::int = st.seq) stage from itp_steps st where st.area_id = $1`, [areaId]);
  const thisStage = tpl.filter((t) => t.stage === a.stage);
  if (!thisStage.length || thisStage.some((t) => !["passed", "waived"].includes(t.status))) return;
  const order = STAGES[a.service_line].map((x) => x.key);
  const next = order[order.indexOf(a.stage) + 1] ?? "complete";
  await db.query("update project_areas set stage = $2, stage_pct = $3, status = case when $2 = 'complete' then 'complete' else status end where id = $1", [areaId, next, next === "complete" ? 100 : stagePct(a.service_line, next, 0)]);
}

// ───────────────────────── Findings & corrective actions ─────────────────────────

export type Finding = { id: string; ref: string; project_id: string | null; project_ref: string | null; area_code: string | null; kind: string; source: string; severity: string; title: string; description: string | null; raised_side: string; raised_by_name: string | null; status: string; due_date: string | null; root_cause: string | null; correction: string | null; corrective_action: string | null; preventive_action: string | null; owner_name: string | null; action_due: string | null; verified_at: string | null; closed_at: string | null; closed_by_name: string | null; created_at: string };

export async function listFindings(s: Session, f: { projectId?: string; open?: boolean; kind?: string } = {}) {
  return withUser(s, (db) => rows<Finding>(db,
    `select f.id, f.ref, f.project_id, p.ref project_ref, a.code area_code, f.kind, f.source, f.severity, f.title, f.description, f.raised_side, rb.full_name raised_by_name, f.status, f.due_date::text,
            f.root_cause, f.correction, f.corrective_action, f.preventive_action, ow.full_name owner_name, f.action_due::text, f.verified_at, f.closed_at, cb.full_name closed_by_name, f.created_at
     from findings f left join projects p on p.id = f.project_id left join project_areas a on a.id = f.area_id left join profiles rb on rb.id = f.raised_by
     left join profiles ow on ow.id = f.action_owner left join profiles cb on cb.id = f.closed_by
     where ($1::uuid is null or f.project_id = $1) and (not $2 or f.status not in ('closed','rejected')) and ($3::text is null or f.kind = $3)
     order by (f.status in ('closed','rejected')), case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, f.due_date nulls last`,
    [f.projectId ?? null, !!f.open, f.kind ?? null]));
}

/** Clients raise observations on their projects; staff raise NCRs, HSE findings, audit items and punch-list items. */
export async function raiseFinding(s: Session, x: { projectId: string; areaId?: string | null; kind: string; severity: string; title: string; description?: string }) {
  const kind = s.isStaff ? x.kind : "observation";
  if (!["ncr", "observation", "punch", "hse", "audit"].includes(kind)) throw new QualityError("Unknown finding type.");
  if (!["low", "medium", "high", "critical"].includes(x.severity)) throw new QualityError("Pick a severity.");
  const p = await withUser(s, (db) => one<{ client_company_id: string }>(db, "select client_company_id from projects where id = $1", [x.projectId]));
  if (!p) throw new QualityError("Project not found.");
  const ref = await withSystem((db) => nextRef(db, "findings", "NCR", s.orgId));
  const due = { critical: 1, high: 3, medium: 7, low: 14 }[x.severity as "low"];
  await withUser(s, (db) => db.query(`insert into findings (org_id, client_company_id, project_id, area_id, ref, kind, source, severity, title, description, raised_by, raised_side, due_date)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, current_date + $13::int)`,
    [s.orgId, p.client_company_id, x.projectId, x.areaId || null, ref, kind, s.isStaff ? (kind === "hse" ? "hse" : kind === "punch" ? "handover" : "inspection") : "client", x.severity, x.title, x.description ?? null, s.id, s.isStaff ? "rgs" : "client", due]));
  await withSystem((db) => s.isStaff
    ? db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'finding',$3,$4,'/client/findings')", [s.orgId, p.client_company_id, `${ref}: ${x.title}`, `${ref}: ${x.title}`])
    : db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['ops_manager','hse_training','inspector']), 'finding', $2, $3, '/ops/findings'", [s.orgId, `Client observation ${ref}: ${x.title}`, `ملاحظة من العميل ${ref}`]));
  return { ref, due };
}

/** CAPA lifecycle: open → action_planned → verification → closed. Client-raised items and NCRs are closed by the client. */
export async function updateFinding(s: Session, id: string, step: "plan" | "verify" | "close" | "reopen", x: { root_cause?: string; correction?: string; corrective_action?: string; preventive_action?: string; action_due?: string; note?: string }) {
  const f = await withUser(s, (db) => one<{ id: string; org_id: string; client_company_id: string; status: string; kind: string; raised_side: string; ref: string; description: string | null }>(db, "select id, org_id, client_company_id, status, kind, raised_side, ref, description from findings where id = $1", [id]));
  if (!f) throw new QualityError("Finding not found.");
  const clientCloses = f.raised_side === "client" || f.kind === "ncr";
  if (step === "plan") {
    if (!s.isStaff) throw new QualityError("RGS plans the corrective action.");
    if (!["open", "action_planned"].includes(f.status)) throw new QualityError(`${f.ref} is ${f.status.replace("_", " ")}.`);
    if ((x.root_cause?.trim().length ?? 0) < 5 || (x.corrective_action?.trim().length ?? 0) < 5) throw new QualityError("Write the root cause and the corrective action.");
    await withSystem((db) => db.query(`update findings set status = 'action_planned', root_cause = $2, correction = $3, corrective_action = $4, preventive_action = $5, action_owner = $6, action_due = $7 where id = $1`,
      [id, x.root_cause, x.correction ?? null, x.corrective_action, x.preventive_action ?? null, s.id, x.action_due || null]), { actorId: s.id });
    return `${f.ref}: corrective action planned.`;
  }
  if (step === "verify") {
    if (!s.isStaff) throw new QualityError("RGS confirms the action is done.");
    if (f.status !== "action_planned") throw new QualityError("Plan the corrective action first.");
    await withSystem(async (db) => {
      await db.query("update findings set status = 'verification', verified_by = $2, verified_at = now(), description = coalesce(description, '') || $3 where id = $1", [id, s.id, x.note ? `\nDone: ${x.note}` : ""]);
      if (clientCloses) await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'finding',$3,$4,'/client/corrective')",
        [f.org_id, f.client_company_id, `${f.ref} is ready for your close-out`, `${f.ref} جاهز للإغلاق`]);
    }, { actorId: s.id });
    return clientCloses ? `${f.ref}: action done, sent to the client to close.` : `${f.ref}: action done and verified. Close it when satisfied.`;
  }
  if (step === "close") {
    if (f.status !== "verification") throw new QualityError("Only items in verification can be closed.");
    if (clientCloses && s.isStaff && s.role !== "admin") throw new QualityError("The client closes this item.");
    if (!s.isStaff && !["client_admin", "client_consultant", "client_hse"].includes(s.role)) throw new QualityError("Your role can't close findings.");
    await withSystem((db) => db.query("update findings set status = 'closed', closed_by = $2, closed_at = now() where id = $1", [id, s.id]), { actorId: s.id });
    return `${f.ref} closed.`;
  }
  // reopen: the client isn't satisfied with the verification
  if (f.status !== "verification") throw new QualityError("Only items in verification can be sent back.");
  if ((x.note?.trim().length ?? 0) < 5) throw new QualityError("Say what is still wrong.");
  await withSystem(async (db) => {
    await db.query("update findings set status = 'action_planned', verified_at = null, description = coalesce(description, '') || $2 where id = $1", [id, `\nReturned by ${s.fullName}: ${x.note}`]);
    await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['ops_manager','inspector']), 'finding', $2, $3, '/ops/corrective'", [f.org_id, `${f.ref} returned by the client: ${x.note}`, `${f.ref} أعيد من العميل`]);
  }, { actorId: s.id });
  return `${f.ref} sent back to RGS.`;
}

// ───────────────────────── HSE ─────────────────────────

export async function hseKpis(s: Session, projectId?: string) {
  return withUser(s, async (db) => {
    const r = await one<{ hours: number; headcount: number; lti: number; first_aid: number; near_miss: number; observations: number; last_lti: string | null; last_recordable: string | null; talks: number; attendance: number; permits: number; chemicals: number; waste_kg: number; open_hse: number }>(db,
      `select coalesce((select sum(hours) from manhours m where ($1::uuid is null or m.project_id = $1)), 0)::float8 hours,
              coalesce((select sum(headcount) from manhours m where m.month = date_trunc('month', current_date)::date and ($1::uuid is null or m.project_id = $1)), 0)::int headcount,
              (select count(*) from incidents i where i.kind = 'lti' and ($1::uuid is null or i.site_id = (select site_id from projects where id = $1)))::int lti,
              (select count(*) from incidents i where i.kind = 'first_aid' and ($1::uuid is null or i.site_id = (select site_id from projects where id = $1)))::int first_aid,
              (select count(*) from incidents i where i.kind = 'near_miss' and ($1::uuid is null or i.site_id = (select site_id from projects where id = $1)))::int near_miss,
              ((select count(*) from incidents i where i.kind = 'observation' and ($1::uuid is null or i.site_id = (select site_id from projects where id = $1))) + (select count(*) from findings f where f.kind = 'hse' and ($1::uuid is null or f.project_id = $1)))::int observations,
              (select max(occurred_at)::text from incidents where kind = 'lti') last_lti,
              (select max(occurred_at)::text from incidents where kind in ('lti','first_aid')) last_recordable,
              (select count(*) from toolbox_talks t where t.held_on > current_date - 30 and ($1::uuid is null or t.project_id = $1))::int talks,
              coalesce((select sum(attendees) from toolbox_talks t where t.held_on > current_date - 30 and ($1::uuid is null or t.project_id = $1)), 0)::int attendance,
              (select count(*) from permits p where p.status = 'active' and p.valid_to > now() and ($1::uuid is null or p.project_id = $1))::int permits,
              (select count(*) from chemical_register)::int chemicals,
              coalesce((select sum(qty) from waste_log w where w.unit = 'kg' and ($1::uuid is null or w.project_id = $1)), 0)::float8 waste_kg,
              (select count(*) from findings f where f.kind = 'hse' and f.status not in ('closed','rejected') and ($1::uuid is null or f.project_id = $1))::int open_hse`, [projectId ?? null]);
    const k = r!;
    return { ...k, trir: k.hours ? (k.lti * 200000) / k.hours : 0, ltifr: k.hours ? (k.lti * 1000000) / k.hours : 0 };
  });
}

// ───────────────────────── Document control ─────────────────────────

export type ControlledDoc = { id: string; project_id: string; project_ref: string; number: string; title: string; title_ar: string | null; doc_type: string; service_line: string | null; current_rev: string | null; status: string; required_for_handover: boolean;
  revs: { id: string; rev: string; transmittal_ref: string | null; submitted_at: string | null; due_date: string | null; review_code: string | null; reviewed_at: string | null; reviewer: string | null; comments: { no: number; comment: string; response?: string }[]; document_id: string | null }[] };

export async function listDocuments(s: Session, f: { projectId?: string; pendingReview?: boolean } = {}) {
  return withUser(s, async (db) => {
    const docs = await rows<Omit<ControlledDoc, "revs">>(db,
      `select d.id, d.project_id, p.ref project_ref, d.number, d.title, d.title_ar, d.doc_type, d.service_line, d.current_rev, d.status, d.required_for_handover
       from controlled_documents d join projects p on p.id = d.project_id where ($1::uuid is null or d.project_id = $1) and (not $2 or d.status = 'under_review') order by d.number`, [f.projectId ?? null, !!f.pendingReview]);
    const revs = await rows<ControlledDoc["revs"][number] & { controlled_document_id: string }>(db,
      `select r.id, r.controlled_document_id, r.rev, r.transmittal_ref, r.submitted_at, r.due_date::text, r.review_code, r.reviewed_at, pr.full_name reviewer, r.comments, r.document_id
       from document_revisions r left join profiles pr on pr.id = r.reviewed_by where r.controlled_document_id = any($1) order by r.submitted_at nulls last`, [docs.map((d) => d.id)]);
    return docs.map((d) => ({ ...d, revs: revs.filter((r) => r.controlled_document_id === d.id) }));
  });
}

const CODE_STATUS: Record<string, string> = { A: "approved", B: "approved_with_comments", C: "revise_resubmit", D: "rejected" };
export const REVIEWERS = ["client_consultant", "client_admin", "client_hse"];

/** Client or consultant reviews the latest revision: A approved, B approved with comments, C revise and resubmit, D rejected. */
export async function reviewDocument(s: Session, revId: string, code: "A" | "B" | "C" | "D", comments: string[]) {
  if (s.isStaff || !REVIEWERS.includes(s.role)) throw new QualityError("Reviews are done by the client's engineer, consultant or QA/HSE.");
  if ((code === "C" || code === "D" || code === "B") && !comments.some((c) => c.trim())) throw new QualityError("Codes B, C and D need at least one comment.");
  const r = await withUser(s, (db) => one<{ id: string; controlled_document_id: string; review_code: string | null; submitted_at: string | null; number: string; org_id: string; rev: string }>(db,
    "select r.id, r.controlled_document_id, r.review_code, r.submitted_at, d.number, d.org_id, r.rev from document_revisions r join controlled_documents d on d.id = r.controlled_document_id where r.id = $1", [revId]));
  if (!r || !r.submitted_at) throw new QualityError("Revision not found.");
  if (r.review_code) throw new QualityError(`Already reviewed (code ${r.review_code}).`);
  return withSystem(async (db) => {
    const latest = await one<{ id: string }>(db, "select id from document_revisions where controlled_document_id = $1 and submitted_at is not null order by submitted_at desc limit 1", [r.controlled_document_id]);
    if (latest?.id !== revId) throw new QualityError("Only the latest submitted revision can be reviewed.");
    const list = comments.map((c) => c.trim()).filter(Boolean).map((comment, i) => ({ no: i + 1, comment, by: s.fullName }));
    await db.query("update document_revisions set review_code = $2, reviewed_by = $3, reviewed_at = now(), comments = $4 where id = $1", [revId, code, s.id, JSON.stringify(list)]);
    await db.query("update controlled_documents set status = $2 where id = $1", [r.controlled_document_id, CODE_STATUS[code]]);
    let unblocked = 0;
    if (code === "A" || code === "B") unblocked = (await db.query("update dependencies set status = 'met', met_at = now() where controlled_document_id = $1 and status <> 'met'", [r.controlled_document_id])).rowCount ?? 0;
    await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['estimator','ops_manager']), 'document_review', $2, $3, '/ops/docreview'",
      [r.org_id, `${r.number} rev ${r.rev} reviewed: code ${code}`, `${r.number} مراجعة: ${code}`]);
    return `${r.number} rev ${r.rev}: code ${code}.${unblocked ? ` ${unblocked} dependency(ies) now met.` : ""}${code === "C" ? " RGS will respond to the comments and resubmit." : ""}`;
  }, { actorId: s.id });
}

/** RGS submits a new revision (with a file), answering the previous revision's comments. */
export async function submitRevision(s: Session, x: { documentId: string; file?: File | null; responses?: string[] }) {
  if (!s.isStaff || !["admin", "ops_manager", "estimator", "hse_training", "site_supervisor"].includes(s.role)) throw new QualityError("Your role can't submit documents.");
  const d = await withUser(s, (db) => one<{ id: string; org_id: string; client_company_id: string; project_id: string; number: string; current_rev: string | null; status: string }>(db, "select * from controlled_documents where id = $1", [x.documentId]));
  if (!d) throw new QualityError("Document not found.");
  if (["approved", "under_review"].includes(d.status)) throw new QualityError(d.status === "approved" ? "Already approved (code A)." : "A revision is already under review.");
  let docId: string | null = null;
  if (x.file && x.file.size) {
    if (x.file.size > MAX_UPLOAD_BYTES) throw new QualityError("File is larger than 15 MB.");
    const buf = Buffer.from(await x.file.arrayBuffer());
    const mime = sniffMime(buf, x.file.type);
    if (!mime) throw new QualityError("Upload a PDF, image or text file.");
    const key = `${d.org_id}/documents/${randomUUID()}.${ALLOWED_UPLOADS[mime]}`;
    await putFile(key, buf, mime);
    docId = (await withSystem((db) => one<{ id: string }>(db, "insert into documents (org_id, client_company_id, entity_type, entity_id, kind, title, storage_path, mime, size_bytes, uploaded_by) values ($1,$2,'controlled_document',$3,'other',$4,$5,$6,$7,$8) returning id",
      [d.org_id, d.client_company_id, d.id, x.file!.name.slice(0, 200), key, mime, x.file!.size, s.id])))!.id;
  }
  return withSystem(async (db) => {
    const prev = await one<{ id: string; rev: string; comments: { no: number; comment: string; response?: string }[]; submitted_at: string | null }>(db,
      "select id, rev, comments, submitted_at from document_revisions where controlled_document_id = $1 order by submitted_at desc nulls first limit 1", [d.id]);
    let rev: string;
    if (prev && !prev.submitted_at) {
      // A draft revision exists: submit it.
      rev = prev.rev;
      await db.query("update document_revisions set submitted_by = $2, submitted_at = now(), due_date = current_date + 7, transmittal_ref = $3, document_id = coalesce($4, document_id) where id = $1",
        [prev.id, s.id, `TR-${d.number.split("-")[1]}-${Date.now() % 1000}`, docId]);
    } else {
      if (prev && x.responses?.length) {
        const answered = prev.comments.map((c, i) => ({ ...c, response: x.responses?.[i]?.trim() || c.response }));
        if (answered.some((c) => !c.response)) throw new QualityError("Answer every comment from the last review before resubmitting.");
        await db.query("update document_revisions set comments = $2 where id = $1", [prev.id, JSON.stringify(answered)]);
      } else if (prev?.comments.length && prev.comments.some((c) => !c.response)) throw new QualityError("Answer every comment from the last review before resubmitting.");
      rev = prev ? (/^\d+$/.test(prev.rev) ? String(Number(prev.rev) + 1) : String.fromCharCode(prev.rev.charCodeAt(0) + 1)) : "0";
      await db.query(`insert into document_revisions (org_id, client_company_id, controlled_document_id, rev, document_id, transmittal_ref, submitted_by, submitted_at, due_date) values ($1,$2,$3,$4,$5,$6,$7, now(), current_date + 7)`,
        [d.org_id, d.client_company_id, d.id, rev, docId, `TR-${d.number.split("-")[1]}-${Date.now() % 1000}`, s.id]);
    }
    await db.query("update controlled_documents set status = 'under_review', current_rev = $2 where id = $1", [d.id, rev]);
    await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'document_review',$3,$4,'/client/docreview')", [d.org_id, d.client_company_id, `${d.number} rev ${rev} submitted for your review`, `${d.number} مراجعة ${rev} مقدمة لمراجعتكم`]);
    return `${d.number} rev ${rev} submitted for review (7-day target).`;
  }, { actorId: s.id });
}

// ───────────────────────── Evidence ─────────────────────────

export async function listEvidence(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<{ id: string; title: string; entity_type: string | null; mime: string | null; created_at: string; project_ref: string | null; context: string | null; uploader: string | null }>(db,
    `select d.id, d.title, d.entity_type, d.mime, d.created_at, coalesce(p1.ref, p2.ref) project_ref,
            coalesce(sc.tag_no || ' inspection', a.code || ' ' || a.name, cd.number) context, pr.full_name uploader
     from documents d
     left join inspections i on d.entity_type = 'inspection' and i.id = d.entity_id left join scaffolds sc on sc.id = i.scaffold_id
     left join project_areas a on d.entity_type = 'project_area' and a.id = d.entity_id left join projects p1 on p1.id = a.project_id
     left join controlled_documents cd on d.entity_type = 'controlled_document' and cd.id = d.entity_id left join projects p2 on p2.id = cd.project_id
     left join profiles pr on pr.id = d.uploaded_by
     where d.storage_path is not null and d.entity_type in ('inspection','project_area','controlled_document','request')
       and ($1::uuid is null or a.project_id = $1 or cd.project_id = $1)
     order by d.created_at desc limit 120`, [projectId ?? null]));
}

export async function uploadEvidence(s: Session, areaId: string, file: File, caption: string) {
  if (!s.isStaff) throw new QualityError("RGS uploads site evidence.");
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new QualityError("Choose a file up to 15 MB.");
  const a = await withUser(s, (db) => one<{ org_id: string; client_company_id: string; code: string }>(db, "select org_id, client_company_id, code from project_areas where id = $1", [areaId]));
  if (!a) throw new QualityError("Area not found.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf, file.type);
  if (!mime) throw new QualityError("Upload a photo or PDF.");
  const key = `${a.org_id}/evidence/${randomUUID()}.${ALLOWED_UPLOADS[mime]}`;
  await putFile(key, buf, mime);
  await withSystem((db) => db.query("insert into documents (org_id, client_company_id, entity_type, entity_id, kind, title, storage_path, mime, size_bytes, uploaded_by) values ($1,$2,'project_area',$3,'photo',$4,$5,$6,$7,$8)",
    [a.org_id, a.client_company_id, areaId, (caption || file.name).slice(0, 200), key, mime, file.size, s.id]), { actorId: s.id });
  return `Evidence added to ${a.code}.`;
}

// ───────────────────────── Handover & warranty ─────────────────────────

export async function handoverReadiness(s: Session, projectId: string) {
  return withUser(s, async (db) => {
    const r = await one<{ areas: number; areas_done: number; steps: number; steps_done: number; open_findings: number; open_punch: number; docs_required: number; docs_ok: number; warranties: number; completion_pending: number }>(db,
      `select (select count(*) from project_areas where project_id = $1)::int areas,
              (select count(*) from project_areas where project_id = $1 and status = 'complete')::int areas_done,
              (select count(*) from itp_steps where project_id = $1 and status <> 'waived')::int steps,
              (select count(*) from itp_steps where project_id = $1 and status = 'passed')::int steps_done,
              (select count(*) from findings where project_id = $1 and kind <> 'punch' and status not in ('closed','rejected'))::int open_findings,
              (select count(*) from findings where project_id = $1 and kind = 'punch' and status not in ('closed','rejected'))::int open_punch,
              (select count(*) from controlled_documents where project_id = $1 and required_for_handover)::int docs_required,
              (select count(*) from controlled_documents where project_id = $1 and required_for_handover and status in ('approved','approved_with_comments'))::int docs_ok,
              (select count(*) from warranties where project_id = $1)::int warranties,
              (select count(*) from signoffs where project_id = $1 and kind = 'completion' and status = 'pending')::int completion_pending`, [projectId]);
    const k = r!;
    const checks = [
      { key: "areas", ok: k.areas > 0 && k.areas_done === k.areas, en: `All areas complete (${k.areas_done}/${k.areas})`, ar: `اكتمال جميع المناطق (${k.areas_done}/${k.areas})` },
      { key: "itp", ok: k.steps > 0 && k.steps_done === k.steps, en: `All ITP steps passed (${k.steps_done}/${k.steps})`, ar: `اجتياز جميع خطوات الفحص (${k.steps_done}/${k.steps})` },
      { key: "findings", ok: k.open_findings === 0, en: `No open NCRs or observations (${k.open_findings} open)`, ar: `لا ملاحظات مفتوحة (${k.open_findings})` },
      { key: "punch", ok: k.open_punch === 0, en: `Punch list closed (${k.open_punch} open)`, ar: `قائمة الملاحظات النهائية مغلقة (${k.open_punch})` },
      { key: "docs", ok: k.docs_required > 0 && k.docs_ok === k.docs_required, en: `Handover documents approved (${k.docs_ok}/${k.docs_required})`, ar: `اعتماد مستندات التسليم (${k.docs_ok}/${k.docs_required})` },
      { key: "warranty", ok: k.warranties > 0, en: `Warranties registered (${k.warranties})`, ar: `تسجيل الضمانات (${k.warranties})` },
    ];
    return { ...k, checks, ready: checks.every((c) => c.ok), score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100) };
  });
}

export async function requestCompletion(s: Session, projectId: string, override: boolean) {
  if (!["admin", "ops_manager"].includes(s.role)) throw new QualityError("Only operations can request completion.");
  const h = await handoverReadiness(s, projectId);
  if (h.completion_pending) throw new QualityError("A completion sign-off is already waiting for the client.");
  if (!h.ready && !override) throw new QualityError(`Not ready: ${h.checks.filter((c) => !c.ok).map((c) => c.en).join("; ")}.`);
  return withSystem(async (db) => {
    const p = await one<{ ref: string; client_company_id: string }>(db, "select ref, client_company_id from projects where id = $1", [projectId]);
    await requestSignoff(db, { orgId: s.orgId, clientCompanyId: p!.client_company_id, projectId, kind: "completion", entityType: "project", entityId: projectId, title: `Completion & handover: ${p!.ref}`, titleAr: `الإنجاز والتسليم: ${p!.ref}`,
      summary: h.ready ? "All handover checks met. Signing starts the defects liability period and activates the warranties." : `Requested with open items: ${h.checks.filter((c) => !c.ok).map((c) => c.en).join("; ")}.`, dueInDays: 7, requestedBy: s.id });
    return `Completion sign-off sent to the client for ${p!.ref}.`;
  }, { actorId: s.id });
}

export async function listWarranties(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<{ id: string; ref: string; project_ref: string; project_name: string; area_code: string | null; system: string; coverage: string; coverage_ar: string | null; kind: string; manufacturer: string | null; years: number; starts_on: string | null; ends_on: string | null; status: string; conditions: string | null; client: string; client_ar: string | null }>(db,
    `select w.id, w.ref, p.ref project_ref, p.name project_name, a.code area_code, w.system, w.coverage, w.coverage_ar, w.kind, w.manufacturer, w.years, w.starts_on::text, w.ends_on::text, w.status, w.conditions, c.name client, c.name_ar client_ar
     from warranties w join projects p on p.id = w.project_id join client_companies c on c.id = w.client_company_id left join project_areas a on a.id = w.area_id
     where ($1::uuid is null or w.project_id = $1) order by w.ref`, [projectId ?? null]));
}

/** Called when the client signs completion: warranties start today. */
export async function activateWarranties(db: Db, projectId: string) {
  await db.query("update warranties set status = 'active', starts_on = current_date, ends_on = current_date + make_interval(years => years), issued_at = now() where project_id = $1 and status = 'pending'", [projectId]);
}
