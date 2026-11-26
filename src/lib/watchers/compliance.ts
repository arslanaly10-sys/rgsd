import "server-only";
import { getSessionById } from "@/lib/auth";
import { draftInvoices } from "@/lib/billing";
import { one, rows, withSystem } from "@/lib/db";
import { reconcile } from "@/lib/fleet";
import { refreshScaffoldDependencies } from "@/lib/projects";
import { runSupportWatcher } from "@/lib/support";

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

/** Billing watcher: draft invoices for sites with 28+ unbilled on-hire days (monthly cycle). */
export async function runBillingWatcher(orgId: string) {
  const created = await draftInvoices(orgId, { minDays: 28 });
  const summary = created.length ? `${created.length} invoice draft(s): ${created.map((c) => `${c.ref} ${c.site}${c.missingPo ? " (no PO)" : ""}`).join(", ")}.` : "No sites due for billing.";
  await withSystem((db) => db.query(`insert into agent_runs (org_id, agent, channel, status, input, output, mode, completed_at) values ($1,'finance','cron','completed',$2,$3,'mock',now())`,
    [orgId, JSON.stringify({ text: "Billing watcher" }), JSON.stringify({ summary, reply: summary })]));
  return { created: created.length, summary };
}

/** Materials watcher: delivered − returned vs on-hire per site and item; any gap becomes a task (yard for losses, finance for over-billing). */
export async function runMaterialsWatcher(orgId: string) {
  const staff = await withSystem((db) => one<{ id: string }>(db, "select id from profiles where org_id = $1 and role = 'ops_manager' limit 1", [orgId]));
  if (!staff) return { gaps: 0, created: 0, summary: "No operations manager profile to run as." };
  const s = await getSessionById(staff.id);
  const gaps = await reconcile(s!);
  let created = 0;
  await withSystem(async (db) => {
    const month = new Date().toISOString().slice(0, 7);
    for (const g of gaps) {
      const unbilled = g.kind === "unbilled_or_lost";
      const r = await db.query(`insert into tasks (org_id, title, description, assignee_role, due_date, priority, source, watcher, dedupe_key)
        values ($1,$2,$3,$4, current_date + 2, 'high', 'watcher', 'materials', $5) on conflict (org_id, dedupe_key) do nothing`,
        [orgId,
          unbilled ? `${g.site_code}: ${g.variance} × ${g.sku} on site but not on hire (≈ SAR ${Math.round(g.value).toLocaleString("en")} of stock)` : `${g.site_code}: rental charged on ${-g.variance} × ${g.sku} that already came back`,
          unbilled ? `Delivered ${g.delivered}, returned ${g.returned}, on hire ${g.on_hire}. Either put the extra on hire (bill it) or find it: count on site.` : `Delivered ${g.delivered}, returned ${g.returned}, on hire ${g.on_hire}. Close the on-hire line from the return date and credit the client if already invoiced.`,
          unbilled ? "yard_logistics" : "finance", `material:${g.site_code}:${g.sku}:${g.kind}:${month}`]);
      created += r.rowCount ?? 0;
    }
    const summary = gaps.length ? `${gaps.length} material gap(s): ${gaps.map((g) => `${g.site_code} ${g.sku} ${g.variance > 0 ? "+" : ""}${g.variance}`).join(", ")}.` : "Delivered, returned and on-hire quantities all match.";
    await db.query(`insert into agent_runs (org_id, agent, channel, status, input, output, mode, completed_at) values ($1,'fleet','cron','completed',$2,$3,'mock',now())`,
      [orgId, JSON.stringify({ text: "Materials reconciliation watcher" }), JSON.stringify({ summary, reply: summary })]);
  });
  return { gaps: gaps.length, created };
}

/** Delivery watcher: cross-service dependencies, slipping milestones, overdue client prerequisites and sign-offs. */
export async function runDeliveryWatcher(orgId: string) {
  const deps = await refreshScaffoldDependencies(orgId);
  return withSystem(async (db) => {
    const week = new Date().toISOString().slice(0, 10);
    const slip = await rows<{ id: string; client_company_id: string; ref: string; name: string; due: string; forecast: string | null }>(db,
      `select m.id, m.client_company_id, p.ref, m.name, m.due_date::text due, m.forecast_date::text forecast from milestones m join projects p on p.id = m.project_id
       where m.org_id = $1 and m.status = 'pending' and (m.due_date < current_date or m.forecast_date > m.due_date)`, [orgId]);
    let created = 0;
    for (const m of slip) {
      const r = await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key) values ($1,$2,$3,'ops_manager', current_date + 1, 'high', 'watcher', 'delivery', $4) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, m.client_company_id, `${m.ref}: milestone “${m.name}” ${m.due < week ? "is past due" : `forecast ${m.forecast} is after the committed ${m.due}`}. Recovery plan or tell the client.`, `milestone:${m.id}:${m.forecast ?? m.due}`]);
      created += r.rowCount ?? 0;
    }
    const clientDeps = await rows<{ id: string; client_company_id: string; ref: string; description: string }>(db,
      `select d.id, d.client_company_id, p.ref, d.description from dependencies d join projects p on p.id = d.project_id
       where d.org_id = $1 and d.owner_side = 'client' and d.status in ('open','blocked') and d.due_date < current_date`, [orgId]);
    for (const d of clientDeps) {
      const r = await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key) values ($1,$2,$3,'ops_manager', current_date, 'high', 'watcher', 'delivery', $4) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, d.client_company_id, `${d.ref}: client prerequisite overdue: ${d.description.slice(0, 90)}. Chase the client in writing (delay may be claimable).`, `clientdep:${d.id}:${week}`]);
      if (r.rowCount) await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'dependency',$3,$4,'/client/dependencies')",
        [orgId, d.client_company_id, `Action needed from your side on ${d.ref}: ${d.description.slice(0, 80)}`, `مطلوب إجراء من جانبكم على ${d.ref}`]);
      created += r.rowCount ?? 0;
    }
    const lateSignoffs = (await rows<{ n: number }>(db, "select count(*)::int n from signoffs where org_id = $1 and status = 'pending' and due_date < current_date", [orgId]))[0]?.n ?? 0;
    const summary = `${deps.met} scaffold dependency(ies) now met, ${deps.blocked} blocked; ${slip.length} slipping milestone(s); ${clientDeps.length} overdue client prerequisite(s); ${lateSignoffs} overdue sign-off(s); ${created} new task(s).`;
    await db.query(`insert into agent_runs (org_id, agent, channel, status, input, output, mode, completed_at) values ($1,'briefing','cron','completed',$2,$3,'mock',now())`,
      [orgId, JSON.stringify({ text: "Delivery watcher" }), JSON.stringify({ summary, reply: summary })]);
    return { created, summary };
  });
}

/** Quality watcher: overdue corrective actions, overdue document reviews (client side), hold points waiting on the client. */
export async function runQualityWatcher(orgId: string) {
  return withSystem(async (db) => {
    const week = new Date().toISOString().slice(0, 10);
    let created = 0;
    const late = await rows<{ id: string; ref: string; title: string; client_company_id: string; status: string }>(db,
      "select id, ref, title, client_company_id, status from findings where org_id = $1 and status in ('open','action_planned') and coalesce(action_due, due_date) < current_date", [orgId]);
    for (const f of late) {
      const r = await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key, entity_type, entity_id)
        values ($1,$2,$3,'ops_manager', current_date, 'high', 'watcher', 'quality', $4, 'finding', $5) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, f.client_company_id, `${f.ref} overdue (${f.status.replace("_", " ")}): ${f.title.slice(0, 80)}`, `finding:${f.id}:${week}`, f.id]);
      created += r.rowCount ?? 0;
    }
    const reviews = await rows<{ number: string; client_company_id: string; days: number }>(db,
      `select d.number, d.client_company_id, (current_date - r.due_date)::int days from controlled_documents d join document_revisions r on r.controlled_document_id = d.id and r.rev = d.current_rev
       where d.org_id = $1 and d.status = 'under_review' and r.due_date < current_date`, [orgId]);
    for (const d of reviews) {
      const r = await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key) values ($1,$2,$3,'estimator', current_date, 'high', 'watcher', 'quality', $4) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, d.client_company_id, `${d.number} review is ${d.days} day(s) late on the client side: chase in writing (delays may be claimable)`, `review:${d.number}:${week}`]);
      if (r.rowCount) await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'document_review',$3,$4,'/client/docreview')", [orgId, d.client_company_id, `${d.number} is waiting for your review (${d.days} day(s) past the target)`, `${d.number} بانتظار مراجعتكم`]);
      created += r.rowCount ?? 0;
    }
    const holds = (await rows<{ n: number }>(db, "select count(*)::int n from itp_steps where org_id = $1 and status = 'awaiting_client' and inspected_at < now() - interval '1 day'", [orgId]))[0]?.n ?? 0;
    const summary = `${late.length} overdue corrective action(s), ${reviews.length} late document review(s), ${holds} hold point(s) waiting on clients over a day; ${created} new task(s).`;
    await db.query(`insert into agent_runs (org_id, agent, channel, status, input, output, mode, completed_at) values ($1,'inspector','cron','completed',$2,$3,'mock',now())`,
      [orgId, JSON.stringify({ text: "Quality watcher" }), JSON.stringify({ summary, reply: summary })]);
    return { created, summary };
  });
}

export async function runAllWatchers() {
  const orgs = await withSystem((db) => rows<{ id: string }>(db, "select id from organizations"));
  const out = [];
  for (const o of orgs) out.push({ org: o.id, compliance: await runComplianceWatcher(o.id), billing: await runBillingWatcher(o.id), materials: await runMaterialsWatcher(o.id), delivery: await runDeliveryWatcher(o.id), quality: await runQualityWatcher(o.id), support: await runSupportWatcher(o.id) });
  return out;
}
