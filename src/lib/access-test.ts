import "server-only";
import { getSessionById } from "./auth";
import { one, rows, withSystem, withUser } from "./db";

/*
 * Access tester: runs real queries AS a chosen person (RLS applies exactly as for them) and checks the
 * result against the rule for each table. Nothing is written: every probe runs inside a transaction
 * that is rolled back.
 */

export const PROBE_TABLES = [
  "projects", "project_areas", "project_photos", "signoffs", "variations", "instructions", "findings", "controlled_documents", "document_revisions", "warranties",
  "scaffolds", "inspections", "sites", "requests", "quotes", "invoices", "payment_claims", "payments", "credit_notes", "tickets", "ticket_messages",
  "workers", "certifications", "rate_items", "agent_runs", "approval_requests", "notifications", "invites", "outbound_messages", "login_events", "auth_otps", "auth_factors", "personal_agents", "agent_inbox", "agent_jobs", "agent_handoffs", "approval_limits",
] as const;

// Tables that hold RGS-internal data a client must never read at all.
const STAFF_ONLY = new Set(["workers", "certifications", "rate_items", "agent_runs", "approval_limits"]);
// Tables nobody reads through the app's user role.
const NOBODY = new Set(["auth_otps", "auth_factors"]);
// Tables where each person only sees their own rows unless admin.
const OWN_ONLY = new Set(["outbound_messages", "login_events", "personal_agents", "agent_inbox", "agent_jobs"]);
// Rows a client may see only in some states.
const CLIENT_HIDDEN: Record<string, string> = {
  project_photos: "not visible_to_client", payment_claims: "status = 'draft'", credit_notes: "status <> 'issued'", ticket_messages: "internal",
};

const HIDDEN_LABEL: Record<string, string> = { project_photos: "shared photos only", payment_claims: "no drafts", credit_notes: "issued only", ticket_messages: "no internal notes" };

export type Probe = { table: string; visible: number | null; total: number; foreign: number | null; hidden: number | null; rule: string; ok: boolean; note?: string };

export async function runAccessTest(profileId: string) {
  const s = await getSessionById(profileId);
  if (!s) throw new Error("Person not found");
  const meta = await withSystem((db) => rows<{ table_name: string; has_company: boolean; has_profile: boolean }>(db,
    `select t.table_name, exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'client_company_id') has_company,
            exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'profile_id') has_profile
     from information_schema.tables t where t.table_schema = 'public' and t.table_name = any($1)`, [PROBE_TABLES as unknown as string[]]));
  const m = Object.fromEntries(meta.map((x) => [x.table_name, x]));
  const totals = await withSystem(async (db) => Object.fromEntries(await Promise.all(PROBE_TABLES.filter((t) => m[t]).map(async (t) => [t, (await one<{ n: number }>(db, `select count(*)::int n from public.${t}`))!.n] as const))));

  const probes: Probe[] = [];
  await withUser(s, async (db) => {
    for (const t of PROBE_TABLES) {
      if (!m[t]) continue;
      await db.query("savepoint p");
      let visible: number | null = null, foreign: number | null = null, hidden: number | null = null, note: string | undefined;
      try {
        visible = (await one<{ n: number }>(db, `select count(*)::int n from public.${t}`))!.n;
        if (!s.isStaff && m[t].has_company) foreign = (await one<{ n: number }>(db, `select count(*)::int n from public.${t} where client_company_id is distinct from $1`, [s.clientCompanyId]))!.n;
        if (!s.isStaff && CLIENT_HIDDEN[t]) hidden = (await one<{ n: number }>(db, `select count(*)::int n from public.${t} where ${CLIENT_HIDDEN[t]}`))!.n;
        if (OWN_ONLY.has(t) && s.role !== "admin") foreign = (await one<{ n: number }>(db, `select count(*)::int n from public.${t} where profile_id is distinct from $1`, [s.id]))!.n;
      } catch (e) {
        note = (e as Error).message.includes("permission denied") ? "no grant" : (e as Error).message.slice(0, 80);
        await db.query("rollback to savepoint p");
      }
      const total = totals[t] ?? 0;
      let rule: string, ok: boolean;
      if (NOBODY.has(t)) { rule = "never readable"; ok = !visible; }
      else if (OWN_ONLY.has(t) && s.role !== "admin") { rule = "own rows only"; ok = !foreign; }
      else if (!s.isStaff && STAFF_ONLY.has(t)) { rule = "RGS internal"; ok = !visible; }
      else if (!s.isStaff && m[t].has_company) { rule = CLIENT_HIDDEN[t] ? `own company; ${HIDDEN_LABEL[t]}` : "own company only"; ok = !foreign && !hidden; }
      else if (s.isStaff && !(["invites"].includes(t) && s.role !== "admin")) { rule = "whole organisation"; ok = visible === total || OWN_ONLY.has(t); }
      else { rule = "admins only"; ok = !visible; }
      probes.push({ table: t, visible, total, foreign, hidden, rule, ok, note });
    }
    await db.query("rollback to savepoint p").catch(() => {});
  });
  const tools = await withSystem((db) => rows<{ tool: string; tier: number; auto: boolean; approver: boolean }>(db,
    "select tool, tier, $2 = any(auto_roles) auto, $2 = any(approver_roles) approver from agent_policies where org_id = $1 and $2 = any(allowed_roles) order by tier, tool", [s.orgId, s.role]));
  return { session: s, probes, tools, passed: probes.filter((p) => p.ok).length, failed: probes.filter((p) => !p.ok).length };
}
