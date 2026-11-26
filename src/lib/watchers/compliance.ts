import "server-only";
import { rows, withSystem } from "@/lib/db";

/*
 * Tag compliance watcher (runs daily by cron, or on demand).
 * - Every green/yellow scaffold past its 7-day inspection gets one task for the inspectors (deduplicated per due date).
 * - Repeated defects (same defect twice in 30 days, or two red tags) become an HSE investigation task.
 * The watcher never changes a tag: that stays with a competent inspector.
 */
export async function runComplianceWatcher(orgId: string) {
  const started = Date.now();
  const result = await withSystem(async (db) => {
    const overdue = await rows<{ id: string; tag_no: string; site_code: string; client_company_id: string; next_inspection_due: string; days: number; status: string; location_desc: string | null }>(db,
      `select sc.id, sc.tag_no, si.code site_code, sc.client_company_id, sc.next_inspection_due::text, (current_date - sc.next_inspection_due)::int days, sc.status, sc.location_desc
       from scaffolds sc join sites si on si.id = sc.site_id
       where sc.org_id = $1 and sc.status in ('green','yellow') and sc.next_inspection_due < current_date order by sc.next_inspection_due`, [orgId]);
    let created = 0;
    for (const o of overdue) {
      const r = await db.query(
        `insert into tasks (org_id, client_company_id, title, title_ar, description, assignee_role, due_date, priority, source, watcher, dedupe_key, entity_type, entity_id)
         values ($1,$2,$3,$4,$5,'inspector', current_date, $6, 'watcher', 'tag_compliance', $7, 'scaffold', $8) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, o.client_company_id, `Inspect ${o.tag_no} (${o.site_code}): ${o.days} day(s) overdue`, `افحص ${o.tag_no} (${o.site_code}): متأخر ${o.days} يوم`,
          `${o.location_desc ?? ""}. Tag stays ${o.status} on paper but is out of date: inspect today or red-tag it.`, o.days >= 3 ? "urgent" : "high", `overdue:${o.id}:${o.next_inspection_due}`, o.id]);
      created += r.rowCount ?? 0;
    }
    // Escalate long-overdue ones on the task (priority) — already urgent at 3+ days.
    const repeats = await rows<{ scaffold_id: string; tag_no: string; site_code: string; client_company_id: string; code: string; n: number }>(db,
      `select d.scaffold_id, sc.tag_no, si.code site_code, sc.client_company_id, d.code, count(*)::int n
       from defects d join scaffolds sc on sc.id = d.scaffold_id join sites si on si.id = sc.site_id
       where d.org_id = $1 and d.created_at > now() - interval '30 days' group by 1,2,3,4,5 having count(*) >= 2
       union all
       select i.scaffold_id, sc.tag_no, si.code, sc.client_company_id, 'RED', count(*)::int
       from inspections i join scaffolds sc on sc.id = i.scaffold_id join sites si on si.id = sc.site_id
       where i.org_id = $1 and i.result = 'red' and i.inspected_at > now() - interval '30 days' group by 1,2,3,4 having count(*) >= 2`, [orgId]);
    let investigations = 0;
    for (const r of repeats) {
      const ins = await db.query(
        `insert into tasks (org_id, client_company_id, title, title_ar, description, assignee_role, due_date, priority, source, watcher, dedupe_key, entity_type, entity_id)
         values ($1,$2,$3,$4,$5,'hse_training', current_date + 3, 'high', 'watcher', 'repeat_defects', $6, 'scaffold', $7) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, r.client_company_id, `Investigate repeat ${r.code === "RED" ? "red tags" : `${r.code} defects`} on ${r.tag_no} (${r.site_code}): ${r.n} in 30 days`, `تحقيق في تكرار العيوب على ${r.tag_no}`,
          "Same problem keeps coming back. Check for interference by other trades, design or erection method, and add a lesson learned.", `repeat:${r.scaffold_id}:${r.code}:${new Date().toISOString().slice(0, 7)}`, r.scaffold_id]);
      investigations += ins.rowCount ?? 0;
    }
    if (created) {
      await db.query(`insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'inspector','overdue_inspections',$2,$3,'/ops/tasks')`,
        [orgId, `${created} new overdue inspection task(s). ${overdue.length} scaffold(s) are past their 7-day inspection.`, `${created} مهمة فحص متأخرة جديدة`]);
    }
    const summary = `${overdue.length} overdue scaffold(s), ${created} new inspection task(s), ${investigations} new repeat-defect investigation(s).`;
    await db.query(`insert into agent_runs (org_id, agent, channel, status, input, output, mode, latency_ms, completed_at) values ($1,'inspector','cron','completed',$2,$3,'mock',$4,now())`,
      [orgId, JSON.stringify({ text: "Tag compliance watcher" }), JSON.stringify({ summary, reply: summary, overdue: overdue.map((o) => `${o.tag_no} ${o.days}d`) }), Date.now() - started]);
    return { overdue: overdue.length, created, investigations, summary };
  });
  return result;
}

export async function runAllWatchers() {
  const orgs = await withSystem((db) => rows<{ id: string }>(db, "select id from organizations"));
  const out = [];
  for (const o of orgs) out.push({ org: o.id, compliance: await runComplianceWatcher(o.id) });
  return out;
}
