import "server-only";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser } from "./db";

/* Support tickets with response/resolution targets (SLA), warranty claims, and escalation. */

export class SupportError extends Error {}
export const SLA_HOURS: Record<string, { respond: number; resolve: number }> = {
  urgent: { respond: 2, resolve: 24 }, high: { respond: 4, resolve: 72 }, normal: { respond: 8, resolve: 120 }, low: { respond: 24, resolve: 240 },
};
export const CATEGORIES = ["defect", "warranty_claim", "billing", "safety", "portal", "general"] as const;

export type Ticket = { id: string; ref: string; category: string; priority: string; subject: string; status: string; project_ref: string | null; warranty_ref: string | null; client: string; raised_by_name: string | null; assignee_name: string | null; respond_by: string; resolve_by: string; first_response_at: string | null; resolved_at: string | null; escalated_at: string | null; satisfaction: number | null; created_at: string };

export async function listTickets(s: Session, openOnly = false) {
  return withUser(s, (db) => rows<Ticket>(db,
    `select t.id, t.ref, t.category, t.priority, t.subject, t.status, p.ref project_ref, w.ref warranty_ref, c.name client, rb.full_name raised_by_name, a.full_name assignee_name,
            t.respond_by, t.resolve_by, t.first_response_at, t.resolved_at, t.escalated_at, t.satisfaction, t.created_at
     from tickets t join client_companies c on c.id = t.client_company_id left join projects p on p.id = t.project_id left join warranties w on w.id = t.warranty_id
     left join profiles rb on rb.id = t.raised_by left join profiles a on a.id = t.assignee_id
     where (not $1 or t.status not in ('resolved','closed'))
     order by t.status in ('resolved','closed'), case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.resolve_by`, [openOnly]));
}

export async function getTicket(s: Session, id: string) {
  return withUser(s, async (db) => {
    const t = (await rows<Ticket & { project_id: string | null; client_company_id: string }>(db,
      `select t.*, p.ref project_ref, w.ref warranty_ref, c.name client, rb.full_name raised_by_name, a.full_name assignee_name from tickets t join client_companies c on c.id = t.client_company_id
       left join projects p on p.id = t.project_id left join warranties w on w.id = t.warranty_id left join profiles rb on rb.id = t.raised_by left join profiles a on a.id = t.assignee_id where t.id = $1`, [id]))[0];
    if (!t) return null;
    // RLS hides internal notes from clients.
    const messages = await rows<{ id: string; body: string; internal: boolean; created_at: string; author: string | null; staff: boolean }>(db,
      `select m.id, m.body, m.internal, m.created_at, pr.full_name author, coalesce(pr.role not like 'client_%', true) staff from ticket_messages m left join profiles pr on pr.id = m.author_id where m.ticket_id = $1 order by m.created_at`, [id]);
    return { ...t, messages };
  });
}

/** Clients open tickets for their own company; staff can log one on a client's behalf. A warranty claim also books an inspection. */
export async function createTicket(s: Session, x: { category: string; priority: string; subject: string; body: string; projectId?: string | null; warrantyId?: string | null; clientCompanyId?: string }) {
  if (!(CATEGORIES as readonly string[]).includes(x.category)) throw new SupportError("Pick a category.");
  if (!SLA_HOURS[x.priority]) throw new SupportError("Pick a priority.");
  if (x.subject.trim().length < 5 || x.body.trim().length < 10) throw new SupportError("Give a short subject and describe the issue.");
  if (x.category === "warranty_claim" && !x.warrantyId) throw new SupportError("Pick the warranty this claim is under.");
  const company = s.isStaff ? x.clientCompanyId : s.clientCompanyId;
  if (!company) throw new SupportError("Which client is this for?");
  if (x.warrantyId) {
    const w = await withUser(s, (db) => one<{ status: string; ends_on: string | null }>(db, "select status, ends_on::text from warranties where id = $1", [x.warrantyId]));
    if (!w) throw new SupportError("Warranty not found.");
    if (w.status !== "active") throw new SupportError("That warranty isn't active yet (it starts at completion). Raise a defect ticket instead.");
  }
  const sla = SLA_HOURS[x.priority];
  const ref = await withSystem((db) => one<{ ref: string }>(db, `select 'TK-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from tickets where org_id = $1`, [s.orgId]));
  const t = await withUser(s, (db) => one<{ id: string }>(db,
    `insert into tickets (org_id, client_company_id, project_id, warranty_id, ref, category, priority, subject, raised_by, respond_by, resolve_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(hours => $10), now() + make_interval(hours => $11)) returning id`,
    [s.orgId, company, x.projectId || null, x.warrantyId || null, ref!.ref, x.category, x.priority, x.subject.slice(0, 200), s.id, sla.respond, sla.resolve]));
  await withUser(s, (db) => db.query("insert into ticket_messages (org_id, client_company_id, ticket_id, author_id, body) values ($1,$2,$3,$4,$5)", [s.orgId, company, t!.id, s.id, x.body.slice(0, 4000)]));
  await withSystem(async (db) => {
    await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest(array['ops_manager']), 'ticket', $2, $3, $4",
      [s.orgId, `${ref!.ref} [${x.priority}] ${x.subject}`, `تذكرة ${ref!.ref}`, `/ops/support/${t!.id}`]);
    if (x.category === "warranty_claim") {
      await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key, entity_type, entity_id)
        values ($1,$2,$3,'inspector', current_date + 1, 'urgent', 'agent', 'warranty', $4, 'ticket', $5)`,
        [s.orgId, company, `Warranty claim ${ref!.ref}: inspect on site within 24 h (${x.subject.slice(0, 60)})`, `warranty:${t!.id}`, t!.id]);
    }
    if (x.category === "safety") await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'hse_training','ticket',$2,$3,$4)", [s.orgId, `Safety ticket ${ref!.ref}: ${x.subject}`, `تذكرة سلامة ${ref!.ref}`, `/ops/support/${t!.id}`]);
  }, { actorId: s.id });
  return { ref: ref!.ref, id: t!.id, respondH: sla.respond, resolveH: sla.resolve };
}

export async function replyTicket(s: Session, id: string, body: string, opts: { internal?: boolean; status?: string } = {}) {
  if (body.trim().length < 2) throw new SupportError("Write a reply.");
  const t = await withUser(s, (db) => one<{ id: string; org_id: string; client_company_id: string; status: string; first_response_at: string | null; ref: string; raised_by: string | null }>(db, "select id, org_id, client_company_id, status, first_response_at, ref, raised_by from tickets where id = $1", [id]));
  if (!t) throw new SupportError("Ticket not found.");
  if (t.status === "closed") throw new SupportError("This ticket is closed. Open a new one.");
  const internal = s.isStaff && !!opts.internal;
  await withUser(s, (db) => db.query("insert into ticket_messages (org_id, client_company_id, ticket_id, author_id, body, internal) values ($1,$2,$3,$4,$5,$6)", [t.org_id, t.client_company_id, id, s.id, body.slice(0, 4000), internal]));
  let status = t.status;
  if (s.isStaff && !internal) status = opts.status && ["in_progress", "waiting_client", "resolved"].includes(opts.status) ? opts.status : t.status === "open" ? "in_progress" : t.status;
  if (!s.isStaff) status = t.status === "waiting_client" || t.status === "resolved" ? "in_progress" : t.status;
  await withSystem(async (db) => {
    await db.query(`update tickets set status = $2, first_response_at = case when $3 and first_response_at is null then now() else first_response_at end,
                    resolved_at = case when $2 = 'resolved' then now() else resolved_at end, assignee_id = coalesce(assignee_id, case when $3 then $4::uuid end) where id = $1`, [id, status, s.isStaff && !internal, s.id]);
    if (s.isStaff && !internal) await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'ticket',$3,$4,$5)", [t.org_id, t.client_company_id, `RGS replied on ${t.ref}${status === "resolved" ? " (resolved)" : ""}`, `رد RGS على ${t.ref}`, `/client/support/${id}`]);
  }, { actorId: s.id });
  return status === "resolved" ? `${t.ref} resolved. The client can confirm and rate it.` : "Reply sent.";
}

export async function closeTicket(s: Session, id: string, satisfaction: number | null) {
  const t = await withUser(s, (db) => one<{ status: string; ref: string }>(db, "select status, ref from tickets where id = $1", [id]));
  if (!t) throw new SupportError("Ticket not found.");
  if (t.status !== "resolved" && !s.isStaff) throw new SupportError("RGS marks it resolved first; then you can close it.");
  await withSystem((db) => db.query("update tickets set status = 'closed', satisfaction = $2, resolved_at = coalesce(resolved_at, now()) where id = $1", [id, satisfaction && satisfaction >= 1 && satisfaction <= 5 ? satisfaction : null]), { actorId: s.id });
  return `${t.ref} closed${satisfaction ? `, rated ${satisfaction}/5` : ""}. Thank you.`;
}

export async function listContacts(s: Session) {
  return withUser(s, (db) => rows<{ project_ref: string; project_name: string; side: string; name: string; role_label: string; role_label_ar: string | null; phone: string | null; email: string | null; hours: string | null }>(db,
    "select p.ref project_ref, p.name project_name, c.side, c.name, c.role_label, c.role_label_ar, c.phone, c.email, c.hours from project_contacts c join projects p on p.id = c.project_id order by p.ref, c.sort"));
}

/** SLA watcher: escalate tickets past their response or resolution target. */
export async function runSupportWatcher(orgId: string) {
  return withSystem(async (db) => {
    const late = await rows<{ id: string; ref: string; subject: string; client_company_id: string; kind: string }>(db,
      `select id, ref, subject, client_company_id, case when first_response_at is null and respond_by < now() then 'response' else 'resolution' end kind
       from tickets where org_id = $1 and status not in ('resolved','closed') and escalated_at is null and ((first_response_at is null and respond_by < now()) or resolve_by < now())`, [orgId]);
    for (const t of late) {
      await db.query("update tickets set escalated_at = now(), priority = case priority when 'low' then 'normal' when 'normal' then 'high' else priority end where id = $1", [t.id]);
      await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key, entity_type, entity_id) values ($1,$2,$3,'ops_manager', current_date, 'urgent', 'watcher', 'support', $4, 'ticket', $5) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, t.client_company_id, `${t.ref} missed its ${t.kind} target: ${t.subject.slice(0, 70)}`, `sla:${t.id}`, t.id]);
    }
    const summary = `${late.length} ticket(s) escalated for missed SLA.`;
    await db.query(`insert into agent_runs (org_id, agent, channel, status, input, output, mode, completed_at) values ($1,'briefing','cron','completed',$2,$3,'mock',now())`,
      [orgId, JSON.stringify({ text: "Support SLA watcher" }), JSON.stringify({ summary, reply: summary })]);
    return { escalated: late.length, summary };
  });
}
