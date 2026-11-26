import "server-only";
import type { Session } from "./auth";
import { rows, withSystem, withUser } from "./db";
import { activityFeed, awaitingMe, listDependencies, listMilestones, listSignoffs, type Signoff } from "./projects";
import { REVIEWERS } from "./quality";
import { clientCaps } from "./roles";

/*
 * The client overview: what this person can do, what waits on their organisation (and whether they
 * personally can act), commitments on both sides, what changed since their last visit, and a summary
 * of what needs attention in which every statement links to the record behind it.
 */

const KIND: Record<string, [string, string]> = {
  measurement: ["Measurement approval", "اعتماد الكميات"], hold_point: ["Hold point release", "تحرير نقطة توقف"], variation: ["Change approval", "اعتماد تغيير"],
  completion: ["Completion acceptance", "قبول الإنجاز"], inspection: ["Inspection sign-off", "توقيع فحص"], document: ["Document review", "مراجعة مستند"], claim: ["Payment claim certification", "اعتماد مستخلص"],
  dependency: ["Action by your organisation", "إجراء من جهتكم"],
};
const ROLE: Record<string, [string, string]> = {
  client_admin: ["Project manager / approver", "مدير المشروع"], client_consultant: ["Consultant / PMC", "الاستشاري"], client_finance: ["Procurement / finance", "المشتريات / المالية"],
  client_hse: ["HSE / QA", "السلامة والجودة"], client_user: ["Any requester", "أي مقدم طلب"],
};
export const kindLabel = (k: string, l: "en" | "ar") => (KIND[k] ? KIND[k][l === "ar" ? 1 : 0] : k);
export const roleLabel = (r: string, l: "en" | "ar") => (ROLE[r] ? ROLE[r][l === "ar" ? 1 : 0] : r);

const d = (x: string | null) => (x ? new Date(x).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export type Pending = { id: string; kind: string; title: string; title_ar: string | null; ref: string | null; project_ref: string | null; due: string | null; overdue: boolean; whoCan: string[]; canAct: boolean; href: string };

/** Record this visit; returns the start of "since your last visit". */
export async function touchVisit(s: Session) {
  const r = await withSystem(async (db) => {
    const p = (await rows<{ last_visit_at: string | null; prev_visit_at: string | null }>(db, "select last_visit_at, prev_visit_at from profiles where id = $1", [s.id]))[0];
    // A new visit starts after 30 minutes away.
    if (!p?.last_visit_at || Date.now() - new Date(p.last_visit_at).getTime() > 30 * 60_000) {
      await db.query("update profiles set prev_visit_at = last_visit_at, last_visit_at = now() where id = $1", [s.id]);
      return p?.last_visit_at ?? null;
    }
    await db.query("update profiles set last_visit_at = now() where id = $1", [s.id]);
    return p.prev_visit_at;
  });
  return r ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
}

export async function clientHome(s: Session) {
  const caps = clientCaps(s.role);
  const since = await touchVisit(s);
  const [sos, docs, deps, ms, feed] = await Promise.all([
    listSignoffs(s, { status: "pending" }),
    withUser(s, (db) => rows<{ id: string; number: string; title: string; project_ref: string; due: string | null; rev_id: string }>(db,
      `select d.id, d.number, d.title, p.ref project_ref, coalesce(r.due_date, (r.submitted_at + interval '14 days')::date)::text due, r.id rev_id
       from controlled_documents d join projects p on p.id = d.project_id
       join document_revisions r on r.controlled_document_id = d.id and r.review_code is null and r.submitted_at is not null where d.status = 'under_review'`)),
    listDependencies(s), listMilestones(s), activityFeed(s, { limit: 80 }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const pending: Pending[] = [
    ...sos.map((so: Signoff) => {
      const left = so.required_roles.filter((r) => !so.approvals.some((a) => a.role === r));
      return { id: so.id, kind: so.kind, title: so.title, title_ar: so.title_ar, ref: so.entity_type ? null : null, project_ref: so.project_ref, due: so.due_date, overdue: !!so.due_date && so.due_date < today, whoCan: left, canAct: awaitingMe(s, so), href: `/client/signoffs#so-${so.id}` };
    }),
    ...docs.map((d) => ({ id: d.id, kind: "document", title: `Review ${d.number} · ${d.title}`, title_ar: null, ref: d.number, project_ref: d.project_ref, due: d.due, overdue: !!d.due && d.due < today, whoCan: REVIEWERS, canAct: REVIEWERS.includes(s.role), href: "/client/docreview" })),
    ...deps.filter((d) => d.owner_side === "client" && d.status !== "done").map((d) => ({ id: d.id, kind: "dependency", title: d.description, title_ar: null, ref: d.area_code, project_ref: d.project_ref, due: d.due_date, overdue: !!d.due_date && d.due_date < today, whoCan: ["client_admin", "client_user"], canAct: caps.request, href: "/client/dependencies" })),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const commitments = [
    ...ms.filter((m) => m.status !== "achieved").map((m) => {
      const due = m.forecast_date ?? m.due_date;
      return { key: `m-${m.id}`, title: m.name, title_ar: m.name_ar, project_ref: m.project_ref, due, owner: "RGS", state: due < today ? "late" : m.forecast_date && m.forecast_date > m.due_date ? "risk" : "ok", href: "/client/milestones" };
    }),
    ...deps.filter((d) => d.owner_side === "client" && d.status !== "done").map((d) => ({ key: `d-${d.id}`, title: d.description, title_ar: null, project_ref: d.project_ref, due: d.due_date ?? today, owner: "client", state: d.status === "blocked" || (d.due_date && d.due_date < today) ? "late" : "ok", href: "/client/dependencies" })),
  ].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);

  const sinceMs = new Date(since).getTime();
  const changes = feed.filter((a) => new Date(a.at).getTime() > sinceMs);

  // "Needs attention": every statement carries the record it came from.
  const attention: { text: string; text_ar: string; evidence: { label: string; href: string }[]; tone: "red" | "yellow" }[] = [];
  const overdue = pending.filter((p) => p.overdue);
  if (overdue.length) attention.push({ tone: "red", text: `${overdue.length} item(s) waiting on your organisation are overdue; the oldest is “${overdue[0].title}”.`, text_ar: `${overdue.length} بنود بانتظاركم متأخرة.`, evidence: overdue.slice(0, 3).map((p) => ({ label: p.ref ?? p.project_ref ?? kindLabel(p.kind, "en"), href: p.href })) });
  const risky = commitments.filter((c) => c.state !== "ok");
  for (const c of risky.slice(0, 2)) attention.push({ tone: c.state === "late" ? "red" : "yellow", text: `“${c.title}” (${c.project_ref}) is ${c.state === "late" ? "late" : "at risk"}${c.owner === "client" ? " and needs your organisation" : ""}; now due ${d(c.due)}.`, text_ar: `«${c.title_ar ?? c.title}» ${c.state === "late" ? "متأخر" : "معرض للتأخر"}.`, evidence: [{ label: c.project_ref ?? "Commitment", href: c.href }] });
  const cas = await withUser(s, (db) => rows<{ ref: string; due_date: string | null; n: number }>(db,
    "select ref, due_date::text, count(*) over ()::int n from findings where status in ('open','action_planned','verification') order by due_date nulls last limit 1"));
  if (cas.length) attention.push({ tone: "yellow", text: `${cas[0].n} corrective action(s) are open; ${cas[0].ref} is due ${d(cas[0].due_date)}.`, text_ar: `${cas[0].n} إجراءات تصحيحية مفتوحة.`, evidence: [{ label: cas[0].ref, href: `/client/corrective#${cas[0].ref}` }] });
  const inv = await withUser(s, (db) => rows<{ ref: string; days: number }>(db, "select ref, (current_date - due_date)::int days from invoices where status = 'issued' and due_date < current_date order by due_date limit 1"));
  if (inv.length) attention.push({ tone: "yellow", text: `Invoice ${inv[0].ref} is ${inv[0].days} day(s) past due.`, text_ar: `الفاتورة ${inv[0].ref} متأخرة ${inv[0].days} يوم.`, evidence: [{ label: inv[0].ref, href: "/client/statement" }] });

  return { caps, since, pending, mine: pending.filter((p) => p.canAct).length, commitments, changes, attention };
}
