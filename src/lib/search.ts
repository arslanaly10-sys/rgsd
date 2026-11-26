import "server-only";
import type { Session } from "./auth";
import { rows, withUser } from "./db";

/* Global search across projects, areas, documents, sign-offs, findings, tickets, invoices and scaffold tags. Runs under RLS as the user. */

export type Hit = { kind: string; ref: string; title: string; sub: string | null; href: string };

export async function search(s: Session, qRaw: string): Promise<Hit[]> {
  const q = qRaw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const base = s.isStaff ? "/ops" : "/client";
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return withUser(s, (db) => rows<Hit>(db,
    `select * from (
       select 'Project' kind, p.ref, p.name title, c.name sub, $2 || '/projects/' || p.id href, 0 o from projects p join client_companies c on c.id = p.client_company_id where p.ref ilike $1 or p.name ilike $1 or c.name ilike $1
       union all select 'Site area', a.code, a.name, p.ref, $2 || '/projects/' || p.id || '?tab=areas', 1 from project_areas a join projects p on p.id = a.project_id where a.code ilike $1 or a.name ilike $1 or a.system ilike $1
       union all select 'Document', d.number, d.title, p.ref, $2 || '/documents', 2 from controlled_documents d join projects p on p.id = d.project_id where d.number ilike $1 or d.title ilike $1
       union all select 'Sign-off', coalesce(p.ref, ''), so.title, so.status, $2 || '/signoffs#so-' || so.id, 3 from signoffs so left join projects p on p.id = so.project_id where so.title ilike $1
       union all select 'Finding', f.ref, f.title, f.status, $2 || '/corrective#' || f.ref, 4 from findings f where f.ref ilike $1 or f.title ilike $1
       union all select 'Ticket', t.ref, t.subject, t.status, $2 || '/support/' || t.id, 5 from tickets t where t.ref ilike $1 or t.subject ilike $1
       union all select 'Invoice', i.ref, coalesce(i.kind, 'invoice') || ' invoice', i.status, case when $2 = '/ops' then '/ops/billing/' || i.id else '/client/billing' end, 6 from invoices i where i.ref ilike $1
       union all select 'Scaffold tag', sc.tag_no, coalesce(sc.location_desc, ''), sc.status, $2 || '/scaffolds/' || sc.tag_no, 7 from scaffolds sc where sc.tag_no ilike $1 or sc.location_desc ilike $1
       union all select 'Milestone', coalesce(p.ref, ''), m.name, m.status, $2 || '/milestones', 8 from milestones m join projects p on p.id = m.project_id where m.name ilike $1
     ) x order by o, ref limit 60`, [like, base]));
}
