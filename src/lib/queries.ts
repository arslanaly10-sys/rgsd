import "server-only";
import type { Session } from "./auth";
import { one, rows, withUser } from "./db";

/* All reads run as the signed-in user, so RLS scopes client users to their own company automatically. */

export async function navBadges(s: Session) {
  return withUser(s, async (db) => {
    const r = await one<{ requests: number; overdue: number; expiring: number; approvals: number }>(
      db,
      `select
        (select count(*) from requests where status in ('new','triage'))::int requests,
        (select count(*) from scaffolds where status in ('green','yellow') and next_inspection_due < current_date)::int overdue,
        ((select count(*) from certifications where expires_on <= current_date + 30) +
         (select count(*) from workers where iqama_expiry <= current_date + 30))::int expiring,
        (select count(*) from approval_requests where status = 'pending' and $1 = any(approver_roles))::int approvals`,
      [s.role],
    );
    return r!;
  });
}

export async function opsKpis(s: Session) {
  return withUser(s, (db) =>
    one<{
      sites: number; standing: number; due: number; red: number; yellow: number; green: number; onhire_day: string;
      expiring: number; open_requests: number; unbilled: string;
    }>(
      db,
      `select
        (select count(*) from sites where status='active')::int sites,
        (select count(*) from scaffolds where status not in ('dismantled'))::int standing,
        (select count(*) from scaffolds where status in ('green','yellow') and next_inspection_due <= current_date)::int due,
        (select count(*) from scaffolds where status='red')::int red,
        (select count(*) from scaffolds where status='yellow')::int yellow,
        (select count(*) from scaffolds where status='green')::int green,
        (select coalesce(sum(qty*rate_day),0) from on_hire where status <> 'returned') onhire_day,
        ((select count(*) from certifications where expires_on <= current_date + 30) +
         (select count(*) from workers where iqama_expiry <= current_date + 30))::int expiring,
        (select count(*) from requests where status in ('new','triage','estimating'))::int open_requests,
        (select coalesce(sum(qty*rate_day*greatest(0, current_date - greatest(start_date, coalesce(last_billed_until, start_date)))),0)
           from on_hire where status <> 'returned') unbilled`,
    ),
  );
}

export type SiteSummary = {
  id: string; code: string; name: string; name_ar: string | null; type: string; city: string | null; client: string; client_ar: string | null;
  green: number; yellow: number; red: number; due: number; onhire_day: string; crew: number;
};

export async function siteSummaries(s: Session) {
  return withUser(s, (db) =>
    rows<SiteSummary>(
      db,
      `select si.id, si.code, si.name, si.name_ar, si.type, si.city, c.name client, c.name_ar client_ar,
         count(*) filter (where sc.status='green')::int green,
         count(*) filter (where sc.status='yellow')::int yellow,
         count(*) filter (where sc.status='red')::int red,
         count(*) filter (where sc.status in ('green','yellow') and sc.next_inspection_due <= current_date)::int due,
         coalesce((select sum(qty*rate_day) from on_hire oh where oh.site_id = si.id and oh.status <> 'returned'),0) onhire_day,
         coalesce((select count(*) from crew_assignments ca where ca.site_id = si.id and ca.status='confirmed'),0)::int crew
       from sites si join client_companies c on c.id = si.client_company_id
       left join scaffolds sc on sc.site_id = si.id
       group by si.id, c.name, c.name_ar order by si.code`,
    ),
  );
}

export type ScaffoldRow = {
  id: string; tag_no: string; site_code: string; site_name: string; site_name_ar: string | null; location_desc: string | null; type: string;
  status: string; restrictions: string | null; load_class: string | null; height_m: string; length_m: string; width_m: string; volume_m3: string;
  last_inspected_at: string | null; next_inspection_due: string | null; open_defects: number;
};

export async function scaffolds(s: Session, f: { site?: string; status?: string; due?: boolean; q?: string } = {}) {
  return withUser(s, (db) =>
    rows<ScaffoldRow>(
      db,
      `select sc.id, sc.tag_no, si.code site_code, si.name site_name, si.name_ar site_name_ar, sc.location_desc, sc.type, sc.status, sc.restrictions,
              sc.load_class, sc.height_m, sc.length_m, sc.width_m, sc.volume_m3, sc.last_inspected_at, sc.next_inspection_due,
              (select count(*) from defects d where d.scaffold_id = sc.id and d.status='open')::int open_defects
       from scaffolds sc join sites si on si.id = sc.site_id
       where ($1::text is null or si.code = $1)
         and ($2::text is null or sc.status = $2)
         and (not $3 or (sc.status in ('green','yellow') and sc.next_inspection_due <= current_date + 1))
         and ($4::text is null or sc.tag_no ilike '%'||$4||'%' or sc.location_desc ilike '%'||$4||'%')
       order by case sc.status when 'red' then 0 when 'yellow' then 1 when 'erecting' then 2 when 'green' then 3 else 4 end,
                sc.next_inspection_due nulls last, sc.tag_no`,
      [f.site || null, f.status || null, !!f.due, f.q || null],
    ),
  );
}

export async function siteOptions(s: Session) {
  return withUser(s, (db) => rows<{ code: string; name: string; name_ar: string | null }>(db, "select code, name, name_ar from sites order by code"));
}

export type RequestRow = {
  id: string; ref: string; title: string; source: string; status: string; priority: string; required_by: string | null; created_at: string;
  client: string; client_ar: string | null; site_code: string | null; quote_id: string | null; quote_ref: string | null; quote_status: string | null; quote_total: string | null;
};

export async function requestsList(s: Session) {
  return withUser(s, (db) =>
    rows<RequestRow>(
      db,
      `select r.id, r.ref, r.title, r.source, r.status, r.priority, r.required_by, r.created_at, c.name client, c.name_ar client_ar, si.code site_code,
              q.id quote_id, q.ref quote_ref, q.status quote_status, q.total quote_total
       from requests r join client_companies c on c.id = r.client_company_id
       left join sites si on si.id = r.site_id
       left join lateral (select id, ref, status, total from quotes where request_id = r.id order by version desc, created_at desc limit 1) q on true
       order by case r.status when 'new' then 0 when 'triage' then 1 when 'estimating' then 2 else 3 end, r.required_by nulls last`,
    ),
  );
}

export type QuoteRow = { id: string; ref: string; status: string; kind: string; total: string; valid_until: string | null; ai_generated: boolean; client: string; client_ar: string | null; request_ref: string | null; created_at: string };

export async function quotesList(s: Session) {
  return withUser(s, (db) =>
    rows<QuoteRow>(
      db,
      `select q.id, q.ref, q.status, q.kind, q.total, q.valid_until, q.ai_generated, c.name client, c.name_ar client_ar, r.ref request_ref, q.created_at
       from quotes q join client_companies c on c.id = q.client_company_id left join requests r on r.id = q.request_id
       order by q.created_at desc`,
    ),
  );
}

export async function stockByYard(s: Session) {
  return withUser(s, (db) =>
    rows<{ sku: string; name: string; name_ar: string | null; category: string; dammam: string; jubail: string; on_hire: string }>(
      db,
      `select i.sku, i.name, i.name_ar, i.category,
         coalesce(sum(st.qty) filter (where l.name like 'Dammam%'),0) dammam,
         coalesce(sum(st.qty) filter (where l.name like 'Jubail%'),0) jubail,
         coalesce((select sum(qty) from on_hire oh where oh.item_id = i.id and oh.status <> 'returned'),0) on_hire
       from items i left join stock st on st.item_id = i.id left join locations l on l.id = st.location_id
       group by i.id order by i.category, i.sku`,
    ),
  );
}

export async function onHireBySite(s: Session) {
  return withUser(s, (db) =>
    rows<{ id: string; site_code: string; site_name: string; site_name_ar: string | null; sku: string; item: string; item_ar: string | null; qty: string; rate_day: string; start_date: string; status: string; off_hire_requested_at: string | null }>(
      db,
      `select oh.id, si.code site_code, si.name site_name, si.name_ar site_name_ar, i.sku, i.name item, i.name_ar item_ar, oh.qty, oh.rate_day, oh.start_date, oh.status, oh.off_hire_requested_at
       from on_hire oh join sites si on si.id = oh.site_id join items i on i.id = oh.item_id
       where oh.status <> 'returned' order by (oh.status = 'off_hire_requested') desc, si.code, i.sku`,
    ),
  );
}

export async function movementsUpcoming(s: Session) {
  return withUser(s, (db) =>
    rows<{ ref: string; kind: string; status: string; scheduled_for: string | null; site_code: string | null; plate: string | null; driver: string | null; dn: string | null; lines: number }>(
      db,
      `select m.ref, m.kind, m.status, m.scheduled_for, si.code site_code, v.plate, v.driver_name driver, m.delivery_note_no dn,
              (select count(*) from movement_lines ml where ml.movement_id = m.id)::int lines
       from movements m left join sites si on si.id = m.site_id left join vehicles v on v.id = m.vehicle_id
       order by (m.status = 'planned') desc, m.scheduled_for desc nulls last limit 20`,
    ),
  );
}

export async function expiries(s: Session, withinDays = 45) {
  return withUser(s, (db) =>
    rows<{ worker_id: string; employee_no: string; full_name: string; trade: string; site_code: string | null; kind: string; expires_on: string }>(
      db,
      `select w.id worker_id, w.employee_no, w.full_name, w.trade, si.code site_code, c.kind, c.expires_on
         from certifications c join workers w on w.id = c.worker_id left join sites si on si.id = w.current_site_id
        where c.expires_on <= current_date + $1::int
       union all
       select w.id, w.employee_no, w.full_name, w.trade, si.code, 'iqama', w.iqama_expiry
         from workers w left join sites si on si.id = w.current_site_id
        where w.iqama_expiry <= current_date + $1::int
       order by expires_on`,
      [withinDays],
    ),
  );
}

export async function crewBySite(s: Session) {
  return withUser(s, (db) =>
    rows<{ code: string; name: string; name_ar: string | null; scaffolders: number; supervisors: number; inspectors: number; other: number }>(
      db,
      `select si.code, si.name, si.name_ar,
         count(*) filter (where w.trade in ('scaffolder','advanced_scaffolder'))::int scaffolders,
         count(*) filter (where w.trade = 'scaffold_supervisor')::int supervisors,
         count(*) filter (where w.trade = 'scaffold_inspector')::int inspectors,
         count(*) filter (where w.trade not in ('scaffolder','advanced_scaffolder','scaffold_supervisor','scaffold_inspector'))::int other
       from sites si left join workers w on w.current_site_id = si.id and w.status = 'active'
       group by si.id order by si.code`,
    ),
  );
}

export async function invoicesList(s: Session) {
  return withUser(s, (db) =>
    rows<{ id: string; ref: string; client: string; client_ar: string | null; site_code: string | null; period_from: string | null; period_to: string | null; status: string; total: string; due_date: string | null; zatca_status: string; created_by_agent: boolean }>(
      db,
      `select i.id, i.ref, c.name client, c.name_ar client_ar, si.code site_code, i.period_from, i.period_to, i.status, i.total, i.due_date, i.zatca_status, i.created_by_agent
       from invoices i join client_companies c on c.id = i.client_company_id left join sites si on si.id = i.site_id
       order by i.created_at desc, i.ref desc`,
    ),
  );
}

export async function approvalsList(s: Session) {
  return withUser(s, (db) =>
    rows<{ id: string; tool: string; tier: number; summary: string; summary_ar: string | null; status: string; approver_roles: string[]; created_at: string; payload: Record<string, unknown>; decided_at: string | null }>(
      db,
      `select id, tool, tier, summary, summary_ar, status, approver_roles, created_at, payload, decided_at
       from approval_requests order by (status='pending') desc, created_at desc limit 50`,
    ),
  );
}

export async function policies(s: Session) {
  return withUser(s, (db) =>
    rows<{ tool: string; tier: number; allowed_roles: string[]; auto_roles: string[]; approver_roles: string[]; description: string | null }>(
      db,
      "select tool, tier, allowed_roles, auto_roles, approver_roles, description from agent_policies order by tier, tool",
    ),
  );
}

export async function recentAgentRuns(s: Session, limit = 8) {
  return withUser(s, (db) =>
    rows<{ id: string; agent: string; channel: string; status: string; created_at: string; summary: string | null }>(
      db,
      `select id, agent, channel, status, created_at, output->>'summary' summary from agent_runs order by created_at desc limit $1`,
      [limit],
    ),
  );
}

export async function inspectionRound(s: Session) {
  return withUser(s, (db) =>
    rows<{ id: string; tag_no: string; status: string; location_desc: string | null; site_code: string; site_name: string; site_name_ar: string | null; type: string; next_inspection_due: string | null; restrictions: string | null }>(
      db,
      `select sc.id, sc.tag_no, sc.status, sc.location_desc, si.code site_code, si.name site_name, si.name_ar site_name_ar, sc.type, sc.next_inspection_due, sc.restrictions
       from scaffolds sc join sites si on si.id = sc.site_id
       where sc.status in ('green','yellow','red') and (sc.next_inspection_due <= current_date + 1 or sc.status = 'red')
       order by sc.next_inspection_due nulls first, sc.tag_no`,
    ),
  );
}

export async function clientOverview(s: Session) {
  return withUser(s, async (db) => {
    const quotes = await rows<{ id: string; ref: string; status: string; total: string; valid_until: string | null }>(db, "select id, ref, status, total, valid_until from quotes order by created_at desc limit 5");
    const invoices = await rows<{ ref: string; status: string; total: string; due_date: string | null }>(db, "select ref, status, total, due_date from invoices order by created_at desc limit 5");
    const reqs = await rows<{ ref: string; title: string; status: string; required_by: string | null }>(db, "select ref, title, status, required_by from requests order by created_at desc limit 5");
    return { quotes, invoices, reqs };
  });
}
