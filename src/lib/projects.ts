import "server-only";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser, type Db } from "./db";
import { requiredSigners, stagePct, STAGES, type ServiceLine } from "./service-lines";
import { activateWarranties, advanceArea } from "./quality";
import { onClaimCertified } from "./commercial";

/* Projects (contracts), delivery tracking and the client sign-off engine. Reads run under RLS as the user. */

export type ProjectSummary = {
  id: string; ref: string; name: string; name_ar: string | null; status: string; service_lines: ServiceLine[]; client: string; client_ar: string | null; site_code: string | null;
  contract_value: number; approved_vos: number; revised_value: number; boq_value: number; installed_value: number; certified_value: number;
  progress_pct: number; stage_pct: number; time_pct: number; start_date: string | null; end_date: string | null;
  blocked_deps: number; open_client_deps: number; overdue_milestones: number; pending_signoffs: number; retention_pct: number; po_number: string | null;
};

const PROJECT_SQL = `
  select p.id, p.ref, p.name, p.name_ar, p.status, p.service_lines, c.name client, c.name_ar client_ar, si.code site_code, p.start_date::text, p.end_date::text, p.retention_pct, p.po_number,
    p.contract_value::float8 contract_value,
    coalesce((select sum(amount) from variations v where v.project_id = p.id and v.status = 'approved'), 0)::float8 approved_vos,
    coalesce((select sum(boq_qty * rate) from project_areas a where a.project_id = p.id), 0)::float8 boq_value,
    coalesce((select sum(least(installed_qty, boq_qty) * rate) from project_areas a where a.project_id = p.id), 0)::float8 installed_value,
    coalesce((select sum(approved_qty * rate) from project_areas a where a.project_id = p.id), 0)::float8 certified_value,
    coalesce((select sum(stage_pct * boq_qty * rate) / nullif(sum(boq_qty * rate), 0) from project_areas a where a.project_id = p.id), 0)::float8 stage_pct,
    (select count(*) from dependencies d where d.project_id = p.id and d.status = 'blocked')::int blocked_deps,
    (select count(*) from dependencies d where d.project_id = p.id and d.status in ('open','blocked') and d.owner_side = 'client')::int open_client_deps,
    (select count(*) from milestones m where m.project_id = p.id and m.status = 'pending' and (m.due_date < current_date or m.forecast_date > m.due_date))::int overdue_milestones,
    (select count(*) from signoffs s where s.project_id = p.id and s.status = 'pending')::int pending_signoffs
  from projects p join client_companies c on c.id = p.client_company_id left join sites si on si.id = p.site_id`;

function finish(r: Omit<ProjectSummary, "revised_value" | "progress_pct" | "time_pct">): ProjectSummary {
  const total = r.start_date && r.end_date ? new Date(r.end_date).getTime() - new Date(r.start_date).getTime() : 0;
  const elapsed = r.start_date ? Date.now() - new Date(r.start_date).getTime() : 0;
  return {
    ...r,
    revised_value: r.contract_value + r.approved_vos,
    progress_pct: r.boq_value ? Math.round((r.installed_value / r.boq_value) * 1000) / 10 : 0,
    stage_pct: Math.round(r.stage_pct * 10) / 10,
    time_pct: total > 0 ? Math.max(0, Math.min(100, Math.round((elapsed / total) * 100))) : 0,
  };
}

export async function listProjects(s: Session) {
  return withUser(s, async (db) => (await rows<Omit<ProjectSummary, "revised_value" | "progress_pct" | "time_pct">>(db, `${PROJECT_SQL} order by p.ref`)).map(finish));
}

export type Area = { id: string; project_id: string; project_ref: string; service_line: ServiceLine; code: string; name: string; name_ar: string | null; system: string | null; uom: string; boq_qty: number; rate: number; installed_qty: number; approved_qty: number; stage: string; stage_pct: number; status: string; planned_start: string | null; planned_finish: string | null; last_entry: string | null; layout: { x: number; y: number; w: number; h: number; shape: "rect" | "tank" | "rack" } | null };

export async function listAreas(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<Area>(db,
    `select a.id, a.project_id, p.ref project_ref, a.service_line, a.code, a.name, a.name_ar, a.system, a.uom, a.boq_qty::float8 boq_qty, a.rate::float8 rate,
            a.installed_qty::float8 installed_qty, a.approved_qty::float8 approved_qty, a.stage, a.stage_pct::float8 stage_pct, a.status, a.planned_start::text, a.planned_finish::text, a.layout,
            (select max(entry_date)::text from progress_entries e where e.area_id = a.id) last_entry
     from project_areas a join projects p on p.id = a.project_id where ($1::uuid is null or a.project_id = $1) order by p.ref, a.sort`, [projectId ?? null]));
}

export async function getProject(s: Session, id: string) {
  return withUser(s, async (db) => {
    const p = await one<Omit<ProjectSummary, "revised_value" | "progress_pct" | "time_pct"> & { description: string | null; consultant_name: string | null; dlp_months: number; advance_pct: number }>(db,
      PROJECT_SQL.replace("select p.id,", "select p.description, p.consultant_name, p.dlp_months, p.advance_pct, p.id,") + " where p.id = $1", [id]);
    if (!p) return null;
    return { ...finish(p), description: p.description, consultant_name: p.consultant_name, dlp_months: p.dlp_months, advance_pct: Number(p.advance_pct), retention_pct: Number(p.retention_pct) };
  });
}

export async function listMilestones(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<{ id: string; project_id: string; project_ref: string; project_name: string; service_line: string | null; name: string; name_ar: string | null; due_date: string; forecast_date: string | null; status: string; achieved_at: string | null }>(db,
    `select m.id, m.project_id, p.ref project_ref, p.name project_name, m.service_line, m.name, m.name_ar, m.due_date::text, m.forecast_date::text, m.status, m.achieved_at::text
     from milestones m join projects p on p.id = m.project_id where ($1::uuid is null or m.project_id = $1) order by m.status = 'achieved', m.due_date`, [projectId ?? null]));
}

export async function listDependencies(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<{ id: string; project_id: string; project_ref: string; area_code: string | null; area_name: string | null; kind: string; description: string; owner_side: string; status: string; due_date: string | null; scaffold_tag: string | null; scaffold_status: string | null }>(db,
    `select d.id, d.project_id, p.ref project_ref, a.code area_code, a.name area_name, d.kind, d.description, d.owner_side, d.status, d.due_date::text, sc.tag_no scaffold_tag, sc.status scaffold_status
     from dependencies d join projects p on p.id = d.project_id left join project_areas a on a.id = d.area_id left join scaffolds sc on sc.id = d.scaffold_id
     where ($1::uuid is null or d.project_id = $1)
     order by case d.status when 'blocked' then 0 when 'open' then 1 else 2 end, d.due_date nulls last`, [projectId ?? null]));
}

export async function listInstructions(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<{ id: string; project_id: string; project_ref: string; ref: string; title: string; description: string | null; status: string; response: string | null; issued_at: string; issuer: string | null; vo_ref: string | null; vo_amount: string | null; vo_status: string | null; vo_id: string | null }>(db,
    `select i.id, i.project_id, p.ref project_ref, i.ref, i.title, i.description, i.status, i.response, i.issued_at, pr.full_name issuer, v.ref vo_ref, v.amount vo_amount, v.status vo_status, v.id vo_id
     from instructions i join projects p on p.id = i.project_id left join profiles pr on pr.id = i.issued_by
     left join lateral (select id, ref, amount, status from variations where instruction_id = i.id order by created_at desc limit 1) v on true
     where ($1::uuid is null or i.project_id = $1) order by i.issued_at desc`, [projectId ?? null]));
}

export type Signoff = { id: string; project_id: string | null; project_ref: string | null; kind: string; entity_type: string | null; entity_id: string | null; title: string; title_ar: string | null; summary: string | null; amount: string | null; required_roles: string[]; approvals: { role: string; name: string; decision: string; comment?: string; at: string }[]; status: string; requested_at: string; due_date: string | null };

export async function listSignoffs(s: Session, opts: { status?: string; projectId?: string } = {}) {
  return withUser(s, (db) => rows<Signoff>(db,
    `select so.id, so.project_id, p.ref project_ref, so.kind, so.entity_type, so.entity_id, so.title, so.title_ar, so.summary, so.amount, so.required_roles, so.approvals, so.status, so.requested_at, so.due_date::text
     from signoffs so left join projects p on p.id = so.project_id
     where ($1::text is null or so.status = $1) and ($2::uuid is null or so.project_id = $2) order by so.status = 'pending' desc, so.due_date nulls last`, [opts.status ?? null, opts.projectId ?? null]));
}

/** What still needs this person's signature: pending items where their role is required and hasn't signed. */
export const awaitingMe = (s: Session, so: Signoff) => so.status === "pending" && so.required_roles.includes(s.role) && !so.approvals.some((a) => a.role === s.role);

// ───────────────────────── Sign-off engine ─────────────────────────

/** Roles actually present at the client; a required role the client doesn't have falls back to the client PM. */
async function effectiveRoles(db: Db, clientCompanyId: string, roles: string[]) {
  const have = new Set((await rows<{ role: string }>(db, "select distinct role from profiles where client_company_id = $1", [clientCompanyId])).map((r) => r.role));
  const eff = roles.filter((r) => have.has(r));
  return eff.length ? eff : ["client_admin"];
}

export async function requestSignoff(db: Db, x: { orgId: string; clientCompanyId: string; projectId: string | null; kind: Parameters<typeof requiredSigners>[0]; entityType: string; entityId: string; title: string; titleAr?: string; summary?: string; amount?: number; dueInDays?: number; requestedBy: string }) {
  const roles = await effectiveRoles(db, x.clientCompanyId, requiredSigners(x.kind, x.amount ?? 0));
  const r = await one<{ id: string }>(db,
    `insert into signoffs (org_id, client_company_id, project_id, kind, entity_type, entity_id, title, title_ar, summary, amount, required_roles, requested_by, due_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, current_date + $13::int) returning id`,
    [x.orgId, x.clientCompanyId, x.projectId, x.kind, x.entityType, x.entityId, x.title, x.titleAr ?? null, x.summary ?? null, x.amount ?? null, roles, x.requestedBy, x.dueInDays ?? 3]);
  await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'signoff',$3,$4,'/client/signoffs')",
    [x.orgId, x.clientCompanyId, `Sign-off needed: ${x.title}`, `مطلوب توقيعك: ${x.titleAr ?? x.title}`]);
  return r!.id;
}

export class SignoffError extends Error {}

/** A client signs or rejects. When every required role has approved, the effect is applied (measurement certified, VO approved, hold point released). */
export async function decideSignoff(s: Session, id: string, decision: "approved" | "rejected", comment: string | null, signatureName: string) {
  if (s.isStaff) throw new SignoffError("Only the client can sign off.");
  // Visibility check under RLS (own company only).
  const so = await withUser(s, (db) => one<Signoff & { client_company_id: string; org_id: string }>(db, "select * from signoffs where id = $1", [id]));
  if (!so) throw new SignoffError("Sign-off not found.");
  if (so.status !== "pending") throw new SignoffError(`Already ${so.status}.`);
  if (!so.required_roles.includes(s.role)) throw new SignoffError("Your role isn't one of the required signatories for this item.");
  if (so.approvals.some((a) => a.role === s.role)) throw new SignoffError("Your role has already signed this item.");
  if (signatureName.trim().toLowerCase() !== s.fullName.trim().toLowerCase()) throw new SignoffError(`Type your full name exactly as “${s.fullName}” to sign.`);
  if (decision === "rejected" && (comment?.trim().length ?? 0) < 5) throw new SignoffError("Say why you are rejecting so RGS can fix it.");

  return withSystem(async (db) => {
    const locked = await one<{ approvals: Signoff["approvals"]; status: string }>(db, "select approvals, status from signoffs where id = $1 for update", [id]);
    if (locked!.status !== "pending") throw new SignoffError(`Already ${locked!.status}.`);
    const approvals = [...locked!.approvals, { role: s.role, user_id: s.id, name: s.fullName, decision, comment: comment ?? undefined, at: new Date().toISOString() }];
    const done = decision === "rejected" || so.required_roles.every((r) => approvals.some((a) => a.role === r && a.decision === "approved"));
    const status = decision === "rejected" ? "rejected" : done ? "approved" : "pending";
    await db.query("update signoffs set approvals = $2, status = $3, decided_at = case when $3 <> 'pending' then now() else null end where id = $1", [id, JSON.stringify(approvals), status]);
    let effect = "";
    if (status !== "pending") effect = await applySignoff(db, so, status as "approved" | "rejected", comment);
    await db.query(`insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['ops_manager','estimator']), 'signoff_decision', $2, $3, $4`,
      [so.org_id, `${s.companyName}: ${so.title} ${status === "pending" ? `signed by ${s.fullName}, waiting for others` : status}`, `${so.title_ar ?? so.title}: ${status}`, so.project_id ? `/ops/projects/${so.project_id}` : "/ops/signoffs"]);
    return { status, effect, waitingFor: so.required_roles.filter((r) => !approvals.some((a) => a.role === r)) };
  }, { actorId: s.id });
}

async function applySignoff(db: Db, so: Signoff & { org_id: string }, status: "approved" | "rejected", comment: string | null) {
  if (so.kind === "measurement" && so.entity_id) {
    await db.query("update measurements set status = $2 where id = $1", [so.entity_id, status]);
    if (status === "approved") {
      const m = await one<{ lines: { code: string; cum_qty: number }[]; project_id: string }>(db, "select lines, project_id from measurements where id = $1", [so.entity_id]);
      for (const l of m?.lines ?? []) await db.query("update project_areas set approved_qty = greatest(approved_qty, $3) where project_id = $1 and code = $2", [m!.project_id, l.code, l.cum_qty]);
      return "Quantities certified: they can now be claimed.";
    }
    return "Measurement returned to RGS for correction.";
  }
  if (so.kind === "variation" && so.entity_id) {
    await db.query("update variations set status = $2, decided_at = now() where id = $1", [so.entity_id, status]);
    await db.query("update instructions set status = case when $2 = 'approved' then 'closed' else status end where id = (select instruction_id from variations where id = $1)", [so.entity_id, status]);
    return status === "approved" ? "Variation approved: the revised contract value is updated." : `Variation rejected${comment ? `: ${comment}` : ""}.`;
  }
  if (so.kind === "hold_point" && so.entity_type === "project_area" && so.entity_id && status === "approved") {
    // Release the hold point: move the area past its test stage.
    const a = await one<{ service_line: ServiceLine; stage: string }>(db, "select service_line, stage from project_areas where id = $1", [so.entity_id]);
    if (a) {
      const st = STAGES[a.service_line];
      const i = st.findIndex((x) => x.key === a.stage);
      const next = st[i + 1]?.key ?? "complete";
      await db.query("update project_areas set stage = $2, stage_pct = $3 where id = $1", [so.entity_id, next, stagePct(a.service_line, next, 0)]);
      await db.query("update milestones set status = 'achieved', achieved_at = current_date where project_id = (select project_id from project_areas where id = $1) and status = 'pending' and name ilike '%flood test%'", [so.entity_id]);
      return `Hold point released: work moves on to ${next.replace(/_/g, " ")}.`;
    }
  }
  if ((so.kind === "hold_point" || so.kind === "inspection") && so.entity_type === "itp_step" && so.entity_id) {
    const st = await one<{ area_id: string; project_id: string; title: string; test_kind: string | null; client_company_id: string; org_id: string; code: string }>(db,
      "select st.area_id, st.project_id, st.title, st.test_kind, st.client_company_id, st.org_id, a.code from itp_steps st join project_areas a on a.id = st.area_id where st.id = $1", [so.entity_id]);
    if (!st) return "";
    if (status === "approved") {
      await db.query("update itp_steps set status = 'passed' where id = $1", [so.entity_id]);
      if (st.test_kind === "flood_test") await db.query("update milestones set status = 'achieved', achieved_at = current_date where project_id = $1 and status = 'pending' and name ilike '%flood test%'", [st.project_id]);
      const before = await one<{ stage: string }>(db, "select stage from project_areas where id = $1", [st.area_id]);
      await advanceArea(db, st.area_id);
      const after = await one<{ stage: string }>(db, "select stage from project_areas where id = $1", [st.area_id]);
      return `${so.kind === "hold_point" ? "Hold point released" : "Witness point accepted"}: ${st.code} ${st.title}.${after?.stage !== before?.stage ? ` Work moves on to ${after?.stage.replace(/_/g, " ")}.` : ""}`;
    }
    // Rejected by the client: the step fails and an NCR is raised for RGS to act on.
    await db.query("update itp_steps set status = 'failed', result_note = coalesce(result_note, '') || $2 where id = $1", [so.entity_id, ` Client rejected: ${comment ?? ""}`]);
    const ref = (await one<{ ref: string }>(db, `select 'NCR-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 3, '0') ref from findings where org_id = $1 and ref like 'NCR-%'`, [st.org_id]))!.ref;
    await db.query(`insert into findings (org_id, client_company_id, project_id, area_id, itp_step_id, ref, kind, source, severity, title, description, raised_side, due_date)
      values ($1,$2,$3,$4,$5,$6,'ncr','itp','high',$7,$8,'client', current_date + 3)`, [st.org_id, st.client_company_id, st.project_id, st.area_id, so.entity_id, ref, `${st.code}: ${st.title} rejected at client witness`, comment]);
    return `Rejected. ${ref} raised for RGS to correct.`;
  }
  if (so.kind === "claim" && so.entity_id) return onClaimCertified(db, so.entity_id, status);
  if (so.kind === "completion" && so.project_id && status === "approved") {
    await db.query("update projects set status = 'completed' where id = $1", [so.project_id]);
    await activateWarranties(db, so.project_id);
    return "Completion certified: the defects liability period starts today and the warranties are active.";
  }
  return "";
}

// ───────────────────────── Delivery actions (staff) ─────────────────────────

export async function logProgress(s: Session, x: { areaId: string; qty: number; stage: string; partial: number; notes?: string }) {
  return withUser(s, async (db) => {
    const a = await one<{ id: string; org_id: string; client_company_id: string; project_id: string; service_line: ServiceLine; boq_qty: string; installed_qty: string; code: string }>(db, "select * from project_areas where id = $1", [x.areaId]);
    if (!a) throw new Error("Area not found.");
    const valid = ["not_started", "complete", ...STAGES[a.service_line].map((st) => st.key)];
    if (!valid.includes(x.stage)) throw new Error("Unknown stage for this service line.");
    await db.query("insert into progress_entries (org_id, client_company_id, project_id, area_id, qty, stage, notes, reported_by) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [a.org_id, a.client_company_id, a.project_id, a.id, x.qty, x.stage, x.notes ?? null, s.id]);
    const installed = Number(a.installed_qty) + x.qty;
    await db.query(`update project_areas set installed_qty = $2::numeric, stage = $3::text, stage_pct = $4::numeric,
                    status = case when $3::text = 'complete' then 'complete' when $2::numeric > 0 or $3::text <> 'not_started' then 'in_progress' else status end where id = $1`,
      [a.id, installed, x.stage, stagePct(a.service_line, x.stage, x.partial)]);
    return { code: a.code, installed, over: installed > Number(a.boq_qty) };
  });
}

/** Build a measurement sheet from installed − already certified quantities, submit it and request the client signatures. */
export async function submitMeasurement(s: Session, projectId: string) {
  return withSystem(async (db) => {
    const p = await one<{ org_id: string; client_company_id: string; ref: string }>(db, "select org_id, client_company_id, ref from projects where id = $1", [projectId]);
    if (!p || p.org_id !== s.orgId) throw new Error("Project not found.");
    if (await one(db, "select 1 from measurements where project_id = $1 and status = 'submitted'", [projectId])) throw new Error("A measurement sheet is already waiting for the client. Wait for it to be signed first.");
    const areas = await rows<{ code: string; name: string; uom: string; installed_qty: string; approved_qty: string; boq_qty: string; rate: string }>(db, "select code, name, uom, installed_qty, approved_qty, boq_qty, rate from project_areas where project_id = $1 order by sort", [projectId]);
    const lines = areas.map((a) => {
      const cum = Math.min(Number(a.installed_qty), Number(a.boq_qty)), prev = Number(a.approved_qty), thisQ = Math.max(0, cum - prev);
      return { code: a.code, name: a.name, uom: a.uom, prev_qty: prev, this_qty: thisQ, cum_qty: cum, rate: Number(a.rate), amount: Math.round(thisQ * Number(a.rate) * 100) / 100 };
    }).filter((l) => l.this_qty > 0);
    if (!lines.length) throw new Error("Nothing new to measure: every installed quantity is already certified.");
    const total = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
    const ref = await one<{ ref: string }>(db, `select 'MS-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from measurements where org_id = $1`, [s.orgId]);
    const m = await one<{ id: string }>(db, `insert into measurements (org_id, client_company_id, project_id, ref, period_from, period_to, status, lines, total_value, submitted_by)
      values ($1,$2,$3,$4, date_trunc('month', current_date)::date, current_date, 'submitted', $5, $6, $7) returning id`, [s.orgId, p.client_company_id, projectId, ref!.ref, JSON.stringify(lines), total, s.id]);
    await requestSignoff(db, { orgId: s.orgId, clientCompanyId: p.client_company_id, projectId, kind: "measurement", entityType: "measurement", entityId: m!.id, title: `Measurement sheet ${ref!.ref}`, titleAr: `كشف الكميات ${ref!.ref}`, summary: lines.map((l) => `${l.code} ${l.this_qty} ${l.uom}`).join(", "), amount: total, requestedBy: s.id });
    return { ref: ref!.ref, total, lines: lines.length };
  }, { actorId: s.id });
}

/** Price an instruction as a variation and send it to the client; above SAR 100,000 it also needs client procurement. */
export async function submitVariation(s: Session, x: { instructionId: string; title: string; description?: string; lines: { description: string; qty: number; uom: string; rate: number }[]; daysImpact: number }) {
  return withSystem(async (db) => {
    const i = await one<{ org_id: string; client_company_id: string; project_id: string; ref: string }>(db, "select org_id, client_company_id, project_id, ref from instructions where id = $1", [x.instructionId]);
    if (!i || i.org_id !== s.orgId) throw new Error("Instruction not found.");
    const lines = x.lines.filter((l) => l.qty > 0 && l.rate >= 0).map((l) => ({ ...l, amount: Math.round(l.qty * l.rate * 100) / 100 }));
    if (!lines.length) throw new Error("Add at least one priced line.");
    const amount = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
    const ref = await one<{ ref: string }>(db, `select 'VO-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from variations where org_id = $1`, [s.orgId]);
    const v = await one<{ id: string }>(db, `insert into variations (org_id, client_company_id, project_id, instruction_id, ref, title, description, lines, amount, days_impact, status, submitted_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',now(),$11) returning id`, [s.orgId, i.client_company_id, i.project_id, x.instructionId, ref!.ref, x.title, x.description ?? null, JSON.stringify(lines), amount, x.daysImpact, s.id]);
    await db.query("update instructions set status = 'vo_required', response = coalesce(response, $2) where id = $1", [x.instructionId, `Priced as ${ref!.ref}.`]);
    await requestSignoff(db, { orgId: s.orgId, clientCompanyId: i.client_company_id, projectId: i.project_id, kind: "variation", entityType: "variation", entityId: v!.id, title: `${ref!.ref} ${x.title}`, summary: `From your instruction ${i.ref}. ${x.daysImpact ? `+${x.daysImpact} day(s).` : "No time impact."}`, amount, dueInDays: 5, requestedBy: s.id });
    return { ref: ref!.ref, amount };
  }, { actorId: s.id });
}

export async function raiseInstruction(s: Session, x: { projectId: string; title: string; description?: string }) {
  const p = await withUser(s, (db) => one<{ org_id: string; client_company_id: string; ref: string }>(db, "select org_id, client_company_id, ref from projects where id = $1", [x.projectId]));
  if (!p) throw new Error("Project not found.");
  const ref = await withSystem((db) => one<{ ref: string }>(db, `select 'SI-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from instructions where org_id = $1`, [s.orgId]));
  // Clients insert under their own RLS policy; staff record instructions received verbally or by email.
  await withUser(s, (db) => db.query("insert into instructions (org_id, client_company_id, project_id, ref, title, description, issued_by) values ($1,$2,$3,$4,$5,$6,$7)",
    [p.org_id, p.client_company_id, x.projectId, ref!.ref, x.title, x.description ?? null, s.id]));
  await withSystem((db) => db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['ops_manager','estimator']), 'instruction', $2, $3, '/ops/instructions'",
    [p.org_id, `New site instruction ${ref!.ref} on ${p.ref}: ${x.title}`, `تعليمات موقع جديدة ${ref!.ref}`]));
  return { ref: ref!.ref };
}

export async function respondInstruction(s: Session, id: string, status: "acknowledged" | "rejected" | "closed", response: string) {
  return withUser(s, (db) => db.query("update instructions set status = $2, response = $3 where id = $1", [id, status, response]));
}

/** Cross-service check: a dependency on a scaffold is met once that scaffold is green. */
export async function refreshScaffoldDependencies(orgId: string) {
  return withSystem(async (db) => {
    const met = await db.query(`update dependencies d set status = 'met', met_at = now() from scaffolds sc
      where d.scaffold_id = sc.id and d.org_id = $1 and d.status in ('open','blocked') and sc.status = 'green' returning d.id`, [orgId]);
    const blocked = await db.query(`update dependencies d set status = 'blocked' from scaffolds sc
      where d.scaffold_id = sc.id and d.org_id = $1 and d.status = 'open' and sc.status in ('red','yellow','erecting') returning d.id`, [orgId]);
    return { met: met.rowCount ?? 0, blocked: blocked.rowCount ?? 0 };
  });
}

// ───────────────────────── What changed (activity) ─────────────────────────

const ENTITY_LABEL: Record<string, string> = {
  projects: "Project", project_areas: "Area", progress_entries: "Progress", milestones: "Milestone", dependencies: "Dependency", instructions: "Instruction",
  variations: "Variation", signoffs: "Sign-off", measurements: "Measurement", scaffolds: "Scaffold", inspections: "Inspection", invoices: "Invoice", requests: "Request", quotes: "Quote",
};

export type Activity = { at: string; actor: string | null; actor_kind: string; entity: string; text: string; link: string | null };

function describe(entity: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string | null {
  const a = after ?? {}, b = before ?? {};
  const changed = (k: string) => action === "update" && JSON.stringify(a[k]) !== JSON.stringify(b[k]);
  switch (entity) {
    case "progress_entries": return action === "insert" ? `logged ${a.qty} on an area${a.stage ? ` (stage: ${String(a.stage).replace(/_/g, " ")})` : ""}${a.notes ? `: “${a.notes}”` : ""}` : null;
    case "project_areas": return changed("approved_qty") ? `certified ${a.code} up to ${a.approved_qty}` : changed("stage") ? `moved ${a.code} to ${String(a.stage).replace(/_/g, " ")}` : null;
    case "milestones": return changed("status") ? `marked “${a.name}” ${a.status}` : changed("forecast_date") ? `re-forecast “${a.name}” to ${a.forecast_date}` : action === "insert" ? `added milestone “${a.name}”` : null;
    case "dependencies": return changed("status") ? `dependency “${String(a.description).slice(0, 60)}” is now ${a.status}` : action === "insert" ? `added dependency “${String(a.description).slice(0, 60)}”` : null;
    case "instructions": return action === "insert" ? `issued ${a.ref}: ${a.title}` : changed("status") ? `${a.ref} is now ${String(a.status).replace(/_/g, " ")}` : null;
    case "variations": return a.status === "draft" ? null : changed("status") || action === "insert" ? `${a.ref} ${a.status} (SAR ${Number(a.amount).toLocaleString("en")})` : null;
    case "signoffs": return action === "insert" ? `requested sign-off: ${a.title}` : changed("status") ? `sign-off ${a.status}: ${a.title}` : changed("approvals") ? `signed: ${a.title}` : null;
    case "measurements": return changed("status") && a.status !== "draft" ? `${a.ref} ${a.status}` : null;
    case "scaffolds": return changed("status") ? `${a.tag_no} tag changed ${b.status} → ${a.status}` : null;
    case "inspections": return action === "insert" ? `inspected a scaffold: ${String(a.result).toUpperCase()}` : null;
    case "invoices": return changed("status") && ["issued", "paid"].includes(String(a.status)) ? `${a.ref} ${a.status}` : null;
    case "requests": return action === "insert" ? `logged request ${a.ref}: ${a.title}` : changed("status") ? `${a.ref} is now ${a.status}` : null;
    case "quotes": return changed("status") && !["draft", "pending_approval"].includes(String(a.status)) ? `${a.ref} ${a.status}` : null;
    default: return null;
  }
}

/** Human-readable activity: business events from the records themselves (under RLS) plus status changes from the audit log. */
export async function activityFeed(s: Session, opts: { projectId?: string; limit?: number } = {}): Promise<Activity[]> {
  const limit = opts.limit ?? 60;
  const pid = opts.projectId ?? null;
  const base = s.isStaff ? "/ops" : "/client";
  const events = await withUser(s, (db) => rows<{ at: string; actor: string | null; entity: string; text: string; project_id: string | null }>(db,
    `select * from (
       select e.created_at at, pr.full_name actor, 'Progress' entity, a.code || ' ' || a.name || ': +' || trim(to_char(e.qty, 'FM999G999D99')) || ' ' || a.uom || coalesce(' · ' || replace(e.stage, '_', ' '), '') || coalesce(' · “' || e.notes || '”', '') text, e.project_id
         from progress_entries e join project_areas a on a.id = e.area_id left join profiles pr on pr.id = e.reported_by where ($1::uuid is null or e.project_id = $1)
       union all
       select i.issued_at, pr.full_name, 'Instruction', 'issued ' || i.ref || ': ' || i.title, i.project_id from instructions i left join profiles pr on pr.id = i.issued_by where ($1::uuid is null or i.project_id = $1)
       union all
       select v.submitted_at, pr.full_name, 'Variation', v.ref || ' submitted for approval: SAR ' || trim(to_char(v.amount, 'FM999G999G999')), v.project_id from variations v left join profiles pr on pr.id = v.created_by where v.submitted_at is not null and ($1::uuid is null or v.project_id = $1)
       union all
       select v.decided_at, null, 'Variation', v.ref || ' ' || v.status, v.project_id from variations v where v.decided_at is not null and ($1::uuid is null or v.project_id = $1)
       union all
       select so.requested_at, pr.full_name, 'Sign-off', 'requested sign-off: ' || so.title, so.project_id from signoffs so left join profiles pr on pr.id = so.requested_by where ($1::uuid is null or so.project_id = $1)
       union all
       select (x->>'at')::timestamptz, x->>'name', 'Sign-off', (x->>'decision') || ': ' || so.title || coalesce(' · “' || (x->>'comment') || '”', ''), so.project_id
         from signoffs so cross join jsonb_array_elements(so.approvals) x where ($1::uuid is null or so.project_id = $1)
       union all
       select m.achieved_at::timestamptz, null, 'Milestone', 'achieved: ' || m.name, m.project_id from milestones m where m.status = 'achieved' and ($1::uuid is null or m.project_id = $1)
       union all
       select i.inspected_at, pr.full_name, 'Inspection', sc.tag_no || ' inspected: ' || upper(i.result) || coalesce(' · ' || i.restrictions, ''), null
         from inspections i join scaffolds sc on sc.id = i.scaffold_id left join profiles pr on pr.id = i.inspector_id where $1::uuid is null and i.inspected_at > now() - interval '21 days'
     ) ev where at is not null order by at desc limit $2`, [pid, limit]));
  // Status changes not captured as their own records (tags, dependencies, re-forecasts, certified quantities).
  const raw = await withSystem((db) => rows<{ created_at: string; actor: string | null; actor_kind: string; action: string; entity_type: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(db,
    `select l.created_at, p.full_name actor, l.actor_kind, l.action, l.entity_type, l.before, l.after from audit_log l left join profiles p on p.id = l.actor_id
     where l.org_id = $1 and l.action = 'update' and l.entity_type = any(array['scaffolds','dependencies','milestones','project_areas','invoices','quotes','requests'])
       and ($2::uuid is null or coalesce(l.after, l.before)->>'client_company_id' = $2::text)
       and ($3::uuid is null or coalesce(l.after, l.before)->>'project_id' = $3::text)
     order by l.id desc limit 200`, [s.orgId, s.isStaff ? null : s.clientCompanyId, pid]));
  const changes: Activity[] = [];
  for (const r of raw) {
    const text = describe(r.entity_type, r.action, r.before, r.after);
    if (text) changes.push({ at: r.created_at, actor: r.actor, actor_kind: r.actor_kind, entity: ENTITY_LABEL[r.entity_type], text, link: (r.after?.project_id as string) ? `${base}/projects/${r.after!.project_id}` : null });
  }
  return [...events.map((e) => ({ at: e.at, actor: e.actor, actor_kind: "user", entity: e.entity, text: e.text, link: e.project_id ? `${base}/projects/${e.project_id}` : null })), ...changes]
    .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, limit);
}
