import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, DueLabel, Flash, PageHeader, Pill, statusTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { daysUntil, type Loc } from "@/lib/format";
import { completeTask, runWatchersNow } from "./actions";

export default async function Tasks({ searchParams }: { searchParams: Promise<{ msg?: string; all?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { msg, all } = await searchParams;
  const showAll = all === "1";
  const list = await withUser(s, (db) => rows<{ id: string; title: string; title_ar: string | null; description: string | null; assignee_role: string | null; due_date: string | null; priority: string; source: string; watcher: string | null; entity_type: string | null; entity_id: string | null; tag_no: string | null }>(db,
    `select t.*, sc.tag_no from tasks t left join scaffolds sc on t.entity_type = 'scaffold' and sc.id = t.entity_id
     where t.status = 'open' and ($1 or t.assignee_id = $2 or t.assignee_role = $3)
     order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.due_date nulls last limit 200`, [showAll, s.id, s.role]));
  const dt = (key: string, v?: Record<string, number>) => t(`dash.${key}`, v);
  const canRun = ["admin", "ops_manager", "hse_training"].includes(s.role);
  return (
    <>
      <PageHeader title="Tasks" sub="Work assigned to you or your role by people, agents and the background watchers."
        actions={<>
          <Link href={showAll ? "/ops/tasks" : "/ops/tasks?all=1"} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm font-semibold">{showAll ? "Show mine" : "Show all"}</Link>
          {canRun && <form action={runWatchersNow}><SubmitButton className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white" pending="Running…">Run compliance watcher now</SubmitButton></form>}
        </>} />
      <Flash msg={msg} />
      <Card>
        {list.length === 0 ? <p className="py-6 text-center text-sm text-muted">No open tasks{showAll ? "" : " for you"}.</p> : (
          <ul className="divide-y divide-line">
            {list.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={statusTone(x.priority)}>{t(`status.${x.priority}`)}</Pill>
                    {x.source !== "user" && <Pill tone="dark">{x.watcher ?? x.source}</Pill>}
                    {x.assignee_role && <span className="text-xs text-muted">{t(`roles.${x.assignee_role}`)}</span>}
                  </div>
                  <p className="mt-1 font-medium">{l === "ar" && x.title_ar ? x.title_ar : x.title}</p>
                  {x.description && <p className="text-sm text-muted">{x.description}</p>}
                  {x.tag_no && <Link href={`/ops/scaffolds/${x.tag_no}`} className="text-xs font-semibold text-brand">{x.tag_no} →</Link>}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <DueLabel days={daysUntil(x.due_date)} t={dt} />
                  <form action={completeTask}><input type="hidden" name="id" value={x.id} /><SubmitButton className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-canvas">Done</SubmitButton></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
