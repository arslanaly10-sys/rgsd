/* SAMPLE hierarchy, four fully staffed client stories, approval limits and one personal agent per person. All people are fictional. */
import type { Client } from "pg";
import { POSITION, POSITIONS, SAMPLE_LIMITS, defaultPosition } from "../src/lib/positions";

type Insert = (table: string, row: Record<string, unknown>) => Promise<string>;
type Ctx = { db: Client; insert: Insert; org: string };

export async function seedAgents({ db, insert, org }: Ctx) {
  const q = async <T,>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];
  const cc = Object.fromEntries((await q<{ id: string; name: string }>("select id, name from client_companies where org_id = $1", [org])).map((c) => [c.name.split(" ")[0].toLowerCase(), c.id]));
  const P = (full_name: string, full_name_ar: string, email: string, role: string, position: string, title: string, company: string | null = null, locale = "en") =>
    insert("profiles", { org_id: org, full_name, full_name_ar, email, role, position, title, client_company_id: company, locale });

  // ── RGS hierarchy: new positions ──
  await P("Fahad Al-Rashid", "فهد الراشد", "gm@demo.rgs", "ops_manager", "general_manager", "General Manager");
  await P("Sameer Khan", "سمير خان", "pm@demo.rgs", "ops_manager", "project_manager", "Project Manager · Insulation & Waterproofing");
  await P("Tariq Mahmood", "طارق محمود", "qs@demo.rgs", "finance", "commercial_qs", "Commercial Manager / QS");
  await P("Lina Farouk", "لينا فاروق", "bd@demo.rgs", "estimator", "sales_bd", "Business Development Manager");
  await P("Hesham Nabil", "هشام نبيل", "qaqc@demo.rgs", "inspector", "qaqc_manager", "QA/QC Manager");
  await P("Mona Al-Zahrani", "منى الزهراني", "hr@demo.rgs", "hse_training", "hr_saudization", "HR & Saudization Officer", null, "ar");
  await P("Ravi Shankar", "رافي شانكار", "stores@demo.rgs", "yard_logistics", "procurement", "Procurement & Stores Lead");
  await P("Mohammad Aslam", "محمد أسلم", "foreman@demo.rgs", "site_supervisor", "foreman", "Scaffolding Foreman · Karan");
  await P("Mariam Al-Shehri", "مريم الشهري", "docs@demo.rgs", "site_supervisor", "document_controller", "Document Controller");
  // Existing staff get their positions.
  await db.query(`update profiles set position = case role when 'admin' then 'admin' when 'ops_manager' then 'ops_manager' when 'estimator' then 'estimator' when 'site_supervisor' then 'site_supervisor'
    when 'inspector' then 'inspector' when 'yard_logistics' then 'yard_logistics' when 'hse_training' then 'hse_training' when 'finance' then 'finance' end where org_id = $1 and position is null and role not like 'client_%'`, [org]);

  // ── Four client stories, fully staffed ──
  // Aramco offshore: strict compliance.
  await P("Ibrahim Al-Ghamdi", "إبراهيم الغامدي", "inspection.aramco@demo.rgs", "client_consultant", "client_consultant", "Aramco Inspection Representative", cc.saudi);
  await P("Sultan Al-Harbi", "سلطان الحربي", "hse.aramco@demo.rgs", "client_hse", "client_hse", "Offshore Safety Advisor", cc.saudi, "ar");
  await P("Abeer Al-Qahtani", "عبير القحطاني", "procurement.aramco@demo.rgs", "client_finance", "client_procurement", "Contracts & Procurement", cc.saudi, "ar");
  await P("Waleed Al-Shammari", "وليد الشمري", "exec.aramco@demo.rgs", "client_viewer", "client_executive", "Division Head, Offshore Projects", cc.saudi, "ar");
  // Sadara: petrochemical turnaround, time-critical.
  await P("Marco Rossi", "ماركو روسي", "inspection.sadara@demo.rgs", "client_consultant", "client_consultant", "Turnaround Inspection Lead", cc.sadara);
  await P("Yasser Al-Mutlaq", "ياسر المطلق", "exec.sadara@demo.rgs", "client_viewer", "client_executive", "Turnaround Director", cc.sadara);
  // Al Bargash: private developer.
  await P("Dana Khalil", "دانة خليل", "hse.bargash@demo.rgs", "client_hse", "client_hse", "HSE Manager", cc.al);
  // Qiddiya: giga-project with a PMC.
  await P("Hamad Al-Dosari", "حمد الدوسري", "hse.qiddiya@demo.rgs", "client_hse", "client_hse", "Package HSE Lead", cc.qiddiya, "ar");
  await P("Hessa Al-Mansour", "حصة المنصور", "exec.qiddiya@demo.rgs", "client_viewer", "client_executive", "Programme Director", cc.qiddiya);
  await db.query("update profiles set position = case role when 'client_admin' then 'client_pm' when 'client_consultant' then 'client_consultant' when 'client_hse' then 'client_hse' when 'client_finance' then 'client_procurement' when 'client_viewer' then 'client_executive' else 'client_requester' end where org_id = $1 and position is null", [org]);

  // ── Reporting lines (first holder of the manager's position, same side and company) ──
  const people = await q<{ id: string; position: string; client_company_id: string | null; full_name: string }>("select id, position, client_company_id, full_name from profiles where org_id = $1 order by created_at", [org]);
  for (const p of people) {
    const boss = POSITION[p.position]?.reportsTo;
    if (!boss) continue;
    const m = people.find((x) => x.position === boss && x.client_company_id === p.client_company_id && x.id !== p.id);
    if (m) await db.query("update profiles set reports_to = $2 where id = $1", [p.id, m.id]);
  }

  // ── Approval limits (SAMPLE, editable by admin) ──
  for (const [position, kind, max] of SAMPLE_LIMITS) await insert("approval_limits", { org_id: org, position, kind, max_amount: max });

  // ── One personal agent per person, with its standing jobs ──
  for (const p of people) {
    const pos = POSITION[p.position ?? defaultPosition("ops_manager")] ?? POSITIONS[0];
    const first = p.full_name.split(" ")[0];
    await db.query("insert into personal_agents (profile_id, org_id, client_company_id, name, persona, autonomy) values ($1,$2,$3,$4,$5,'routine')",
      [p.id, org, p.client_company_id, `${first}'s ${pos.agent}`, pos.key]);
    for (const j of pos.jobs) await db.query("insert into agent_jobs (org_id, profile_id, job, label, schedule) values ($1,$2,$3,$4,$5)", [org, p.id, j.job, j.label, j.schedule]);
  }
  await insert("org_settings", { org_id: org, ai_mode: "auto" });
}
