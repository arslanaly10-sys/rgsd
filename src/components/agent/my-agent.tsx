import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { rows, withSystem } from "@/lib/db";
import { aiMode } from "@/lib/ai/provider";
import { ensureAgent } from "@/lib/agents/personal";
import { POSITION } from "@/lib/positions";
import { agentSettingsAction, decideItemAction, runAllAgentsAction, runMyAgentAction, toggleJobAction } from "@/lib/actions/agent";
import { SubmitButton } from "../submit-button";
import { tx } from "../delivery/views";
import { Card, Flash, Kpi, PageHeader, Pill, Table, Td } from "../ui";

type Item = { id: string; job: string | null; kind: string; title: string; body: string | null; link: string | null; status: string; created_at: string };
const KIND: Record<string, [string, "red" | "yellow" | "green" | "brand" | "neutral" | "dark"]> = {
  briefing: ["Briefing", "dark"], alert: ["Look at", "red"], draft: ["Draft", "brand"], done: ["Done for you", "green"], chase: ["Chased", "yellow"], triage: ["Triaged", "green"], handoff: ["Handoff", "neutral"],
};
const when = (d: string, l: "en" | "ar") => new Date(d).toLocaleString(l === "ar" ? "ar-SA" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

function ItemRow({ it, l, actions }: { it: Item; l: "en" | "ar"; actions?: boolean }) {
  const k = KIND[it.kind] ?? ["", "neutral"];
  return (
    <li className="grid gap-1 py-3" data-item={it.kind} data-status={it.status}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Pill tone={k[1]}>{k[0]}</Pill>{when(it.created_at, l)}{it.status === "approved" && <Pill tone="green">approved</Pill>}{it.status === "dismissed" && <Pill>dismissed</Pill>}</div>
      <div className="font-medium leading-snug">{it.link ? <Link href={it.link} className="hover:text-brand">{it.title}</Link> : it.title}</div>
      {it.body && <p className="whitespace-pre-line text-sm text-muted">{it.body}</p>}
      {actions && it.status === "proposed" && (
        <div className="mt-1 flex gap-2">
          <form action={decideItemAction}><input type="hidden" name="id" value={it.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white" pending="…">{tx(l, "Approve", "اعتماد")}</SubmitButton></form>
          <form action={decideItemAction}><input type="hidden" name="id" value={it.id} /><input type="hidden" name="decision" value="dismiss" /><SubmitButton className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold" pending="…">{tx(l, "Dismiss", "تجاهل")}</SubmitButton></form>
          {it.link && <Link href={it.link} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand">{tx(l, "Open", "فتح")} →</Link>}
        </div>
      )}
    </li>
  );
}

export async function MyAgentPage({ s, msg }: { s: Session; msg?: string }) {
  const l = (await getLocale()) as "en" | "ar";
  const t = await getTranslations();
  const a = await ensureAgent(s);
  const pos = POSITION[s.position] ?? POSITION.ops_manager;
  const [items, jobs, limits, boss, team] = await Promise.all([
    withSystem((db) => rows<Item>(db, "select id, job, kind, title, body, link, status, created_at::text from agent_inbox where profile_id = $1 order by created_at desc limit 120", [s.id])),
    withSystem((db) => rows<{ id: string; job: string; label: string; schedule: string; enabled: boolean; last_run_at: string | null }>(db, "select id, job, label, schedule, enabled, last_run_at::text from agent_jobs where profile_id = $1 order by label", [s.id])),
    s.isStaff ? withSystem((db) => rows<{ kind: string; max_amount: string | null }>(db, "select kind, max_amount from approval_limits where org_id = $1 and position = $2 order by kind", [s.orgId, s.position])) : Promise.resolve([]),
    withSystem((db) => rows<{ full_name: string; position: string | null }>(db, "select b.full_name, b.position from profiles p join profiles b on b.id = p.reports_to where p.id = $1", [s.id])),
    withSystem((db) => rows<{ full_name: string; position: string | null; name: string | null; last_cycle_at: string | null; proposed: number }>(db,
      "select p.full_name, p.position, a.name, a.last_cycle_at::text, (select count(*) from agent_inbox i where i.profile_id = p.id and i.status = 'proposed')::int proposed from profiles p left join personal_agents a on a.profile_id = p.id where p.reports_to = $1 order by p.full_name", [s.id])),
  ]);
  const latestBriefing = items.find((i) => i.kind === "briefing" && i.job === "briefing");
  const proposed = items.filter((i) => i.status === "proposed");
  const alerts = items.filter((i) => i.kind === "alert").slice(0, 12);
  const doneFor = items.filter((i) => ["done", "triage", "chase"].includes(i.kind)).slice(0, 15);
  const briefs = items.filter((i) => i.kind === "briefing" && i.job !== "briefing").slice(0, 8);
  const sched = (x: string) => (x === "daily" ? tx(l, "every day", "يومياً") : x.startsWith("weekly") ? tx(l, `every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(x.split(":")[1])]}`, "أسبوعياً") : tx(l, `on the ${x.split(":")[1]}th of each month`, "شهرياً"));
  return (
    <>
      <PageHeader title={a.name} sub={`${tx(l, pos.en, pos.ar)} · ${pos.mission}`}
        actions={<form action={runMyAgentAction}><SubmitButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending={tx(l, "Working…", "يعمل…")}>{tx(l, "Run my agent now", "شغّل وكيلي الآن")}</SubmitButton></form>} />
      <Flash msg={msg} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Needs your OK", "بانتظار موافقتك")} value={proposed.length} tone={proposed.length ? "brand" : "default"} />
        <Kpi label={tx(l, "To look at", "للاطلاع")} value={alerts.length} tone={alerts.length ? "red" : "default"} />
        <Kpi label={tx(l, "Done for you", "أنجزه وكيلك")} value={doneFor.length} />
        <Kpi label={tx(l, "Last run", "آخر تشغيل")} value={<span className="text-base">{a.last_cycle_at ? when(a.last_cycle_at, l) : "—"}</span>} hint={`${a.paused ? tx(l, "paused", "متوقف") : a.autonomy === "routine" ? tx(l, "routine work on its own", "ينجز الأعمال الروتينية") : tx(l, "drafts only", "مسودات فقط")} · AI ${aiMode()}`} />
      </div>
      {latestBriefing && <div className="mb-4 rounded-xl bg-ink px-5 py-4 text-white" data-briefing><div className="text-xs text-white/60">{when(latestBriefing.created_at, l)}</div><div className="text-lg font-semibold">{latestBriefing.title}</div></div>}
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-4">
          <Card title={`${tx(l, "Needs your OK", "بانتظار موافقتك")} · ${proposed.length}`}>
            {proposed.length ? <ul className="divide-y divide-line">{proposed.map((it) => <ItemRow key={it.id} it={it} l={l} actions />)}</ul> : <p className="text-sm text-muted">{tx(l, "Nothing waiting. Your agent puts drafts here when something needs your decision.", "لا شيء بانتظارك.")}</p>}
          </Card>
          <Card title={tx(l, "To look at", "للاطلاع")}>{alerts.length ? <ul className="divide-y divide-line">{alerts.map((it) => <ItemRow key={it.id} it={it} l={l} />)}</ul> : <p className="text-sm text-muted">{tx(l, "Nothing needs attention.", "لا شيء يحتاج انتباهاً.")}</p>}</Card>
          {briefs.length > 0 && <Card title={tx(l, "Reports from your agent", "تقارير وكيلك")}><ul className="divide-y divide-line">{briefs.map((it) => <ItemRow key={it.id} it={it} l={l} />)}</ul></Card>}
          <Card title={tx(l, "Done for you", "أنجزه وكيلك")}>{doneFor.length ? <ul className="divide-y divide-line">{doneFor.map((it) => <ItemRow key={it.id} it={it} l={l} />)}</ul> : <p className="text-sm text-muted">—</p>}</Card>
        </div>
        <div className="grid content-start gap-4">
          <Card title={tx(l, "How your agent works", "كيف يعمل وكيلك")}>
            <form action={agentSettingsAction} className="grid gap-2 text-sm">
              <label className="flex items-start gap-2"><input type="radio" name="autonomy" value="routine" defaultChecked={a.autonomy === "routine"} /> <span><strong>{tx(l, "Routine work on its own", "ينجز الروتين بنفسه")}</strong><span className="block text-xs text-muted">{tx(l, "Reads, reminders, chasing and reversible drafts happen automatically. Anything sent to a client or involving money comes to you or your approver.", "")}</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" name="autonomy" value="drafts" defaultChecked={a.autonomy === "drafts"} /> <span><strong>{tx(l, "Drafts only", "مسودات فقط")}</strong><span className="block text-xs text-muted">{tx(l, "It prepares everything; you approve each item.", "")}</span></span></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="paused" value="1" defaultChecked={a.paused} /> {tx(l, "Pause my agent", "إيقاف وكيلي مؤقتاً")}</label>
              <SubmitButton className="justify-self-start rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white" pending="…">{tx(l, "Save", "حفظ")}</SubmitButton>
            </form>
          </Card>
          <Card title={tx(l, "Standing jobs", "المهام الدورية")}>
            <ul className="divide-y divide-line text-sm">{jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 py-2"><span><span className={j.enabled ? "font-medium" : "text-muted line-through"}>{j.label}</span><span className="block text-xs text-muted">{sched(j.schedule)}{j.last_run_at ? ` · ${tx(l, "last", "آخر")} ${when(j.last_run_at, l)}` : ""}</span></span>
                <form action={toggleJobAction}><input type="hidden" name="id" value={j.id} /><SubmitButton className="rounded-md border border-line px-2 py-1 text-xs font-semibold" pending="…">{j.enabled ? tx(l, "Turn off", "إيقاف") : tx(l, "Turn on", "تشغيل")}</SubmitButton></form></li>
            ))}</ul>
          </Card>
          <Card title={tx(l, "Authority and reporting", "الصلاحيات والتسلسل")}>
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">{tx(l, "Position", "المنصب")}</dt><dd>{tx(l, pos.en, pos.ar)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">{tx(l, "Permission role", "الدور")}</dt><dd>{t(`roles.${s.role}`)}</dd></div>
              {boss[0] && <div className="flex justify-between gap-2"><dt className="text-muted">{tx(l, "Reports to", "يتبع")}</dt><dd>{boss[0].full_name} · {POSITION[boss[0].position ?? ""]?.en ?? ""}</dd></div>}
              {limits.map((x) => <div key={x.kind} className="flex justify-between gap-2"><dt className="text-muted">{tx(l, "Approves", "يعتمد")} {x.kind.replace("_", " ")}s</dt><dd className="tabular">{x.max_amount == null ? tx(l, "any amount", "أي مبلغ") : `≤ SAR ${Number(x.max_amount).toLocaleString("en")}`}</dd></div>)}
            </dl>
          </Card>
          {team.length > 0 && (
            <Card title={tx(l, "Your team's agents", "وكلاء فريقك")} action={s.position === "general_manager" || s.role === "admin" ? <Link href="/ops/agents/team" className="text-xs font-semibold text-brand">{tx(l, "All agents", "كل الوكلاء")} →</Link> : undefined}>
              <ul className="divide-y divide-line text-sm">{team.map((m, i) => <li key={i} className="flex justify-between gap-2 py-2"><span><span className="font-medium">{m.name ?? m.full_name}</span><span className="block text-xs text-muted">{POSITION[m.position ?? ""]?.en}{m.last_cycle_at ? ` · ${when(m.last_cycle_at, l)}` : ""}</span></span>{m.proposed > 0 && <Pill tone="brand">{m.proposed} {tx(l, "waiting", "بانتظار")}</Pill>}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export async function TeamAgentsPage({ s, msg }: { s: Session; msg?: string }) {
  const l = (await getLocale()) as "en" | "ar";
  const list = await withSystem((db) => rows<{ full_name: string; position: string | null; company: string | null; name: string; autonomy: string; paused: boolean; last_cycle_at: string | null; proposed: number; done: number; chased: number }>(db,
    `select p.full_name, p.position, c.name company, a.name, a.autonomy, a.paused, a.last_cycle_at::text,
            (select count(*) from agent_inbox i where i.profile_id = p.id and i.status = 'proposed')::int proposed,
            (select count(*) from agent_inbox i where i.profile_id = p.id and i.kind in ('done','triage'))::int done,
            (select count(*) from agent_inbox i where i.profile_id = p.id and i.kind = 'chase')::int chased
     from personal_agents a join profiles p on p.id = a.profile_id left join client_companies c on c.id = p.client_company_id
     where a.org_id = $1 order by c.name nulls first, p.full_name`, [s.orgId]));
  return (
    <>
      <PageHeader title={tx(l, "Everyone's agents", "وكلاء الجميع")} sub={tx(l, "One personal agent per person, RGS and clients. Each works within its owner's permissions and limits.", "وكيل شخصي لكل شخص.")}
        actions={s.role === "admin" || s.position === "general_manager" ? <form action={runAllAgentsAction}><SubmitButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending="…">{tx(l, "Run all agents now", "شغّل كل الوكلاء")}</SubmitButton></form> : undefined} />
      <Flash msg={msg} />
      <Card>
        <Table head={["Agent", "Owner", "Company", "Mode", "Waiting", "Done", "Chased", "Last run"]} minWidth={900}>
          {list.map((x, i) => (
            <tr key={i} data-agent-row>
              <Td className="font-medium">{x.name}</Td>
              <Td className="text-sm">{x.full_name}<div className="text-xs text-muted">{POSITION[x.position ?? ""]?.en}</div></Td>
              <Td className="text-xs">{x.company ?? "RGS"}</Td>
              <Td>{x.paused ? <Pill>paused</Pill> : <Pill tone={x.autonomy === "routine" ? "green" : "brand"}>{x.autonomy}</Pill>}</Td>
              <Td className="tabular">{x.proposed}</Td><Td className="tabular">{x.done}</Td><Td className="tabular">{x.chased}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{x.last_cycle_at ? when(x.last_cycle_at, l) : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
