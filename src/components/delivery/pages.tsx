import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { daysUntil, fmtDate, fmtNum, fmtSAR, type Loc } from "@/lib/format";
import { activityFeed, awaitingMe, getProject, listAreas, listDependencies, listInstructions, listMilestones, listProjects, listSignoffs } from "@/lib/projects";
import { SERVICE_META, SERVICE_LINES } from "@/lib/service-lines";
import { markAllReadAction, triageAction } from "@/lib/actions/delivery";
import { SubmitButton } from "../submit-button";
import { ButtonLink, Card, Flash, Kpi, Mono, PageHeader, Pill, statusTone, Table, Td } from "../ui";
import { ActivityList, AreasTable, Bar, Commercials, DependencyList, health, InstructionList, MeasureButton, MilestoneList, NewInstructionForm, ProjectCards, ServiceChip, SignoffCard, tx } from "./views";

type P = { s: Session; base: "/ops" | "/client"; msg?: string };
const loc = async () => (await getLocale()) as Loc;

export async function ProjectsPage({ s, base, msg }: P) {
  const l = await loc();
  const list = await listProjects(s);
  const by = (line: string) => list.filter((p) => p.service_lines.includes(line as never)).length;
  return (
    <>
      <PageHeader title={tx(l, "Projects", "المشاريع")} sub={tx(l, "Contracts across scaffolding, waterproofing and insulation: progress against time, value and what is waiting.", "العقود في السقالات والعزل المائي والحراري: التقدم مقابل الوقت والقيمة وما ينتظر.")} />
      <Flash msg={msg} />
      <div className="mb-4 flex flex-wrap gap-2">{SERVICE_LINES.map((x) => <span key={x} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm"><ServiceChip line={x} l={l} /><span className="tabular text-muted">{by(x)}</span></span>)}</div>
      <ProjectCards list={list} base={base} l={l} />
    </>
  );
}

export async function ProjectDetailPage({ s, base, msg, id }: P & { id: string }) {
  const l = await loc();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await getProject(s, id);
  if (!p) notFound();
  const [areas, ms, deps, ins, sos, act] = await Promise.all([listAreas(s, id), listMilestones(s, id), listDependencies(s, id), listInstructions(s, id), listSignoffs(s, { projectId: id }), activityFeed(s, { projectId: id, limit: 25 })]);
  const back = `${base}/projects/${id}`;
  const h = health(p);
  const staff = s.isStaff;
  return (
    <>
      <Link href={`${base}/projects`} className="text-sm text-muted hover:text-ink">← {tx(l, "Projects", "المشاريع")}</Link>
      <PageHeader title={`${p.ref} · ${l === "ar" && p.name_ar ? p.name_ar : p.name}`} sub={`${l === "ar" && p.client_ar ? p.client_ar : p.client}${p.consultant_name ? ` · ${tx(l, "Consultant", "الاستشاري")}: ${p.consultant_name}` : ""} · PO ${p.po_number ?? "—"} · ${fmtDate(p.start_date, l)} – ${fmtDate(p.end_date, l)}`}
        actions={<><Pill tone={h.tone}>{tx(l, h.en, h.ar)}</Pill>{p.service_lines.map((x) => <ServiceChip key={x} line={x} l={l} />)}<ButtonLink href={`/reports/${id}`} variant="ghost">{tx(l, "Weekly report", "التقرير الأسبوعي")}</ButtonLink>{staff && <MeasureButton projectId={id} back={back} />}</>} />
      <Flash msg={msg} />
      {p.description && <p className="-mt-2 mb-4 max-w-[80ch] text-sm text-muted">{p.description}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Installed vs time", "المنجز مقابل المدة")} value={`${p.progress_pct}%`} hint={`${tx(l, "time elapsed", "من المدة")} ${p.time_pct}% · ${tx(l, "stage-weighted", "مرجح")} ${p.stage_pct}%`} tone={h.tone === "red" ? "red" : h.tone === "yellow" ? "yellow" : "brand"} />
        <Kpi label={tx(l, "Revised contract value", "قيمة العقد المعدلة")} value={fmtSAR(p.revised_value, l)} hint={`${tx(l, "incl. approved VOs", "شامل أوامر التغيير")} ${fmtSAR(p.approved_vos, l)}`} />
        <Kpi label={tx(l, "Certified by client", "معتمد من العميل")} value={fmtSAR(p.certified_value, l)} hint={`${tx(l, "installed", "منجز")} ${fmtSAR(p.installed_value, l)}`} />
        <Kpi label={tx(l, "Waiting", "بالانتظار")} value={`${p.pending_signoffs}`} hint={`${tx(l, "sign-offs", "توقيعات")} · ${p.blocked_deps} ${tx(l, "blocked", "معطل")} · ${p.overdue_milestones} ${tx(l, "slipping", "متأخر")}`} tone={p.pending_signoffs || p.blocked_deps ? "yellow" : "default"} />
      </div>
      <div className="mt-4"><Card title={tx(l, "Progress by area", "التقدم حسب المنطقة")}><AreasTable areas={areas} l={l} staff={staff && ["admin", "ops_manager", "site_supervisor", "estimator"].includes(s.role)} back={back} /></Card></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title={tx(l, "Commitments & milestones", "الالتزامات والمراحل")}><MilestoneList items={ms} l={l} staff={staff} back={back} /></Card>
        <Card title={tx(l, "Dependencies", "الاعتماديات")}><DependencyList items={deps} l={l} s={s} back={back} /></Card>
        <Card title={tx(l, "Sign-offs", "التوقيعات")}>{sos.length ? <div className="grid gap-3">{sos.slice(0, 6).map((so) => <SignoffCard key={so.id} so={so} s={s} l={l} back={back} />)}</div> : <p className="text-sm text-muted">{tx(l, "None.", "لا يوجد.")}</p>}</Card>
        <Card title={tx(l, "Commercial position", "الموقف التجاري")}><Commercials p={p} l={l} /><p className="mt-3 text-xs text-muted">{tx(l, `Defects liability ${p.dlp_months} months · advance ${p.advance_pct}% · retention ${p.retention_pct}% (SAMPLE terms)`, `فترة الضمان ${p.dlp_months} شهراً · الدفعة المقدمة ${p.advance_pct}% · المحتجزات ${p.retention_pct}%`)}</p></Card>
        <Card title={tx(l, "Instructions & changes", "التعليمات والتغييرات")}><InstructionList items={ins} l={l} staff={staff} back={back} /></Card>
        <Card title={tx(l, "What changed", "ما الذي تغير")}><ActivityList items={act} l={l} /></Card>
      </div>
    </>
  );
}

export async function ProgressPage({ s, base, msg }: P) {
  const l = await loc();
  const areas = await listAreas(s);
  const canLog = s.isStaff && ["admin", "ops_manager", "site_supervisor", "estimator"].includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Progress", "التقدم")} sub={tx(l, "Every area, measured two ways: installed quantity against the BOQ, and stage-weighted completion. Certified quantities are the ones the client has signed.", "كل منطقة بطريقتين: الكمية المنجزة مقابل جدول الكميات، والإنجاز المرجح بالمراحل. الكميات المعتمدة هي ما وقّعه العميل.")} />
      <Flash msg={msg} />
      <Card><AreasTable areas={areas} l={l} staff={canLog} back={`${base}/progress`} /></Card>
    </>
  );
}

export async function MilestonesPage({ s, base, msg }: P) {
  const l = await loc();
  const ms = await listMilestones(s);
  return (<><PageHeader title={tx(l, "Commitments & milestones", "الالتزامات والمراحل")} sub={tx(l, "What RGS committed to and when, with the current forecast. Slipping items are flagged before the date passes.", "ما التزمت به RGS ومتى، مع التوقع الحالي. يتم التنبيه للبنود المتأخرة قبل حلول الموعد.")} /><Flash msg={msg} /><Card><MilestoneList items={ms} l={l} staff={s.isStaff} back={`${base}/milestones`} /></Card></>);
}

export async function DependenciesPage({ s, base, msg }: P) {
  const l = await loc();
  const deps = await listDependencies(s);
  const clientOpen = deps.filter((d) => d.owner_side === "client" && d.status !== "met" && d.status !== "waived").length;
  return (<><PageHeader title={tx(l, "Dependencies", "الاعتماديات")} sub={tx(l, "What must be true before work can start or continue: permits, work fronts, approved submittals, materials, weather windows and green-tagged scaffolds.", "ما يجب توفره قبل بدء العمل أو استمراره: التصاريح وإتاحة المواقع والمستندات المعتمدة والمواد ونوافذ الطقس والسقالات المعتمدة.")} />
    <Flash msg={msg} />
    {!s.isStaff && clientOpen > 0 && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-600">{tx(l, `${clientOpen} item(s) need action from your side.`, `${clientOpen} بند يحتاج إجراء من جانبكم.`)}</div>}
    <Card><DependencyList items={deps} l={l} s={s} back={`${base}/dependencies`} /></Card></>);
}

export async function InstructionsPage({ s, base, msg }: P) {
  const l = await loc();
  const [ins, projects] = await Promise.all([listInstructions(s), listProjects(s)]);
  const canIssue = s.isStaff || ["client_admin", "client_user", "client_consultant"].includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Instructions & changes", "التعليمات والتغييرات")} sub={tx(l, "Site instructions from the client, RGS's response, and priced variation orders for approval. Every change has a written trail.", "تعليمات الموقع من العميل ورد RGS وأوامر التغيير المسعرة للاعتماد. لكل تغيير سجل مكتوب.")} />
      <Flash msg={msg} />
      {canIssue && <Card title={tx(l, "Issue a site instruction", "إصدار تعليمات موقع")} className="mb-4"><NewInstructionForm projects={projects} l={l} back={`${base}/instructions`} /></Card>}
      <InstructionList items={ins} l={l} staff={s.isStaff} back={`${base}/instructions`} />
    </>
  );
}

export async function SignoffsPage({ s, base, msg }: P) {
  const l = await loc();
  const all = await listSignoffs(s);
  const mine = all.filter((x) => awaitingMe(s, x));
  const rest = all.filter((x) => !awaitingMe(s, x));
  return (
    <>
      <PageHeader title={s.isStaff ? tx(l, "Client sign-offs", "توقيعات العملاء") : tx(l, "My sign-offs", "توقيعاتي")} sub={tx(l, "Measurement sheets, variations, hold points and completion certificates. Above SAR 100,000 a variation needs both the client PM and procurement.", "كشوف الكميات وأوامر التغيير ونقاط التوقف وشهادات الإنجاز. أوامر التغيير فوق 100,000 ريال تحتاج مدير المشروع والمشتريات.")} />
      <Flash msg={msg} />
      {!s.isStaff && <h2 className="eyebrow mb-2">{tx(l, "Waiting for your signature", "بانتظار توقيعك")} ({mine.length})</h2>}
      <div className="grid gap-3">{(s.isStaff ? all : mine).map((so) => <SignoffCard key={so.id} so={so} s={s} l={l} back={`${base}/signoffs`} />)}</div>
      {!s.isStaff && mine.length === 0 && <Card><p className="py-4 text-center text-sm text-muted">{tx(l, "Nothing is waiting for you.", "لا يوجد ما ينتظرك.")}</p></Card>}
      {!s.isStaff && rest.length > 0 && (<><h2 className="eyebrow mb-2 mt-6">{tx(l, "Other sign-offs on your projects", "توقيعات أخرى على مشاريعك")}</h2><div className="grid gap-3">{rest.map((so) => <SignoffCard key={so.id} so={so} s={s} l={l} back={`${base}/signoffs`} />)}</div></>)}
    </>
  );
}

export async function ActivityPage({ s }: P) {
  const l = await loc();
  const items = await activityFeed(s, { limit: 100 });
  return (<><PageHeader title={tx(l, "What changed", "ما الذي تغير")} sub={tx(l, "Progress reports, instructions, variations, sign-offs, tag changes and milestones, newest first.", "تقارير التقدم والتعليمات وأوامر التغيير والتوقيعات وتغييرات البطاقات والمراحل، الأحدث أولاً.")} /><Card><ActivityList items={items} l={l} /></Card></>);
}

export async function ReportsPage({ s }: P) {
  const l = await loc();
  const list = await listProjects(s);
  return (
    <>
      <PageHeader title={tx(l, "Reports", "التقارير")} sub={tx(l, "Weekly progress report per project in English and Arabic, ready to print or save as PDF.", "تقرير تقدم أسبوعي لكل مشروع بالعربية والإنجليزية، جاهز للطباعة أو الحفظ.")} />
      <Card>
        <ul className="divide-y divide-line">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><Mono>{p.ref}</Mono> <span className="font-medium">{l === "ar" && p.name_ar ? p.name_ar : p.name}</span><div className="text-xs text-muted">{p.client}</div></div>
              <ButtonLink href={`/reports/${p.id}`} variant="ghost">{tx(l, "Open weekly report", "فتح التقرير الأسبوعي")}</ButtonLink>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export async function NotificationsPage({ s, base, msg }: P) {
  const l = await loc();
  const list = await withUser(s, (db) => rows<{ id: string; title: string; title_ar: string | null; link: string | null; kind: string; created_at: string; read: boolean }>(db,
    `select n.id, n.title, n.title_ar, n.link, n.kind, n.created_at, exists (select 1 from notification_reads r where r.notification_id = n.id and r.user_id = $1) read
     from notifications n order by n.created_at desc limit 100`, [s.id]));
  return (
    <>
      <PageHeader title={tx(l, "Notifications", "الإشعارات")} actions={<form action={markAllReadAction}><input type="hidden" name="back" value={`${base}/notifications`} /><SubmitButton className="rounded-lg border border-line bg-panel px-3 py-2 text-sm font-semibold">{tx(l, "Mark all read", "تعليم الكل كمقروء")}</SubmitButton></form>} />
      <Flash msg={msg} />
      <Card>
        {list.length ? (
          <ul className="divide-y divide-line">
            {list.map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-3 py-2.5 ${n.read ? "text-muted" : ""}`}>
                <span className="flex min-w-0 items-start gap-2">{!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="unread" />}<span>{l === "ar" && n.title_ar ? n.title_ar : n.title}<span className="block text-xs text-muted">{fmtDate(n.created_at, l)} · {n.kind.replace(/_/g, " ")}</span></span></span>
                {n.link && <Link href={n.link.startsWith("/client") && s.isStaff ? n.link.replace("/client", "/ops") : n.link} className="shrink-0 text-xs font-semibold text-brand">{tx(l, "Open", "فتح")} →</Link>}
              </li>
            ))}
          </ul>
        ) : <p className="py-6 text-center text-sm text-muted">{tx(l, "No notifications.", "لا توجد إشعارات.")}</p>}
      </Card>
    </>
  );
}

// ───────────────────────── Staff-only ─────────────────────────

export async function OversightPage({ s }: P) {
  const l = await loc();
  const list = await listProjects(s);
  const sum = (k: keyof (typeof list)[number]) => list.reduce((a, p) => a + Number(p[k] ?? 0), 0);
  // Value per service line from that line's own BOQ (a multi-service project is split, never double-counted).
  const [areas, onHire] = await Promise.all([listAreas(s), withUser(s, (db) => rows<{ v: number }>(db, "select coalesce(sum(qty * rate_day), 0)::float8 v from on_hire where status <> 'returned'"))]);
  const byLine = SERVICE_LINES.map((line) => ({
    line,
    projects: list.filter((p) => p.service_lines.includes(line)).length,
    value: areas.filter((a) => a.service_line === line).reduce((t, a) => t + a.boq_qty * a.rate, 0),
    installed: areas.filter((a) => a.service_line === line).reduce((t, a) => t + Math.min(a.installed_qty, a.boq_qty) * a.rate, 0),
  }));
  return (
    <>
      <PageHeader title={tx(l, "Management oversight", "الإشراف الإداري")} sub={tx(l, "Portfolio across all clients and service lines: schedule health, contract value, cash position and what is stuck.", "المحفظة لجميع العملاء وخطوط الخدمة: صحة الجدول والقيمة والموقف النقدي وما هو متوقف.")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Revised contract value", "قيمة العقود المعدلة")} value={fmtSAR(sum("revised_value"), l)} hint={`${list.length} ${tx(l, "active projects", "مشاريع نشطة")}`} tone="brand" />
        <Kpi label={tx(l, "Installed, not yet certified", "منجز غير معتمد")} value={fmtSAR(Math.max(0, sum("installed_value") - sum("certified_value")), l)} hint={tx(l, "work done the client hasn't signed", "عمل منجز لم يوقعه العميل")} tone="yellow" />
        <Kpi label={tx(l, "Retention held", "المحتجزات")} value={fmtSAR(list.reduce((a, p) => a + (p.certified_value * Number(p.retention_pct)) / 100, 0), l)} />
        <Kpi label={tx(l, "Stuck", "متوقف")} value={`${sum("blocked_deps")} / ${sum("pending_signoffs")}`} hint={tx(l, "blocked dependencies / pending sign-offs", "اعتماديات معطلة / توقيعات معلقة")} tone={sum("blocked_deps") ? "red" : "default"} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">{byLine.map((b) => <div key={b.line} className="rounded-xl border border-line bg-panel p-4" style={{ borderTop: `3px solid ${SERVICE_META[b.line].accent}` }}><ServiceChip line={b.line} l={l} />{b.line === "scaffolding"
        ? <><div className="mt-2 font-display text-xl font-semibold tabular">{fmtSAR(onHire[0]?.v ?? 0, l)}<span className="text-sm font-normal text-muted"> / {tx(l, "day on hire", "يوم إيجار")}</span></div><div className="text-xs text-muted">{tx(l, "access for", "سقالات لـ")} {b.projects} {tx(l, "project(s) plus rental jobs", "مشروع إضافة لأعمال الإيجار")}</div></>
        : <><div className="mt-2 font-display text-xl font-semibold tabular">{fmtSAR(b.value, l)}</div><div className="text-xs text-muted">{tx(l, "BOQ value", "قيمة جدول الكميات")} · {fmtSAR(b.installed, l)} {tx(l, "installed", "منجز")} · {b.projects} {tx(l, "project(s)", "مشروع")}</div></>}</div>)}</div>
      <div className="mt-4"><Card title={tx(l, "Portfolio", "المحفظة")}>
        <Table minWidth={900} head={[tx(l, "Project", "المشروع"), tx(l, "Health", "الحالة"), tx(l, "Installed vs time", "المنجز مقابل المدة"), tx(l, "Revised value", "القيمة المعدلة"), tx(l, "Certified", "المعتمد"), tx(l, "Uncertified work", "عمل غير معتمد"), tx(l, "Blocked", "معطل"), tx(l, "Slipping", "متأخر"), tx(l, "Sign-offs", "التوقيعات")]}>
          {list.map((p) => { const h = health(p); return (
            <tr key={p.id}>
              <Td><Link href={`/ops/projects/${p.id}`} className="hover:text-brand"><Mono>{p.ref}</Mono></Link><div className="max-w-[260px] text-xs text-muted">{p.client}</div><div className="mt-1 flex gap-1">{p.service_lines.map((x) => <ServiceChip key={x} line={x} l={l} />)}</div></Td>
              <Td><Pill tone={h.tone}>{tx(l, h.en, h.ar)}</Pill></Td>
              <Td className="w-44"><div className="mb-1 text-xs tabular">{p.progress_pct}% / {p.time_pct}%</div><Bar value={p.progress_pct} marker={p.time_pct} tone={h.tone === "red" ? "red" : "brand"} /></Td>
              <Td className="tabular whitespace-nowrap">{fmtSAR(p.revised_value, l)}</Td>
              <Td className="tabular whitespace-nowrap">{fmtSAR(p.certified_value, l)}</Td>
              <Td className="tabular whitespace-nowrap">{fmtSAR(Math.max(0, p.installed_value - p.certified_value), l)}</Td>
              <Td className={`tabular ${p.blocked_deps ? "font-semibold text-tag-red" : ""}`}>{p.blocked_deps}</Td>
              <Td className={`tabular ${p.overdue_milestones ? "font-semibold text-tag-red" : ""}`}>{p.overdue_milestones}</Td>
              <Td className="tabular">{p.pending_signoffs}</Td>
            </tr>); })}
        </Table>
      </Card></div>
    </>
  );
}

export async function TriagePage({ s, msg }: P) {
  const l = await loc();
  const reqs = await withUser(s, (db) => rows<{ id: string; ref: string; title: string; source: string; status: string; priority: string; created_at: string; client: string; site_code: string | null; ai_summary: { questions?: string[]; quote_ref?: string } | null; docs: number }>(db,
    `select r.id, r.ref, r.title, r.source, r.status, r.priority, r.created_at, c.name client, si.code site_code, r.ai_summary,
            (select count(*) from documents d where d.entity_type = 'request' and d.entity_id = r.id)::int docs
     from requests r join client_companies c on c.id = r.client_company_id left join sites si on si.id = r.site_id
     where r.status in ('new','triage','estimating') order by case r.priority when 'urgent' then 0 when 'high' then 1 else 2 end, r.created_at`));
  const SLA_H = { urgent: 4, high: 24, normal: 48, low: 72 } as Record<string, number>;
  const cols = [["new", tx(l, "New", "جديد")], ["triage", tx(l, "Triage", "فرز")], ["estimating", tx(l, "Estimating", "قيد التسعير")]] as const;
  return (
    <>
      <PageHeader title={tx(l, "Triage", "الفرز")} sub={tx(l, "New requests from the portal, WhatsApp, email and phone, with the response-time clock. Urgent: 4 h, high: 24 h, normal: 48 h (SAMPLE targets).", "الطلبات الجديدة مع ساعة زمن الاستجابة.")} />
      <Flash msg={msg} />
      <div className="grid gap-4 lg:grid-cols-3">
        {cols.map(([key, label]) => (
          <section key={key} className="rounded-xl border border-line bg-panel/60 p-3">
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">{label}<span className="tabular text-muted">{reqs.filter((r) => r.status === key).length}</span></h2>
            <ul className="grid gap-2">
              {reqs.filter((r) => r.status === key).map((r) => {
                const age = Math.round((Date.now() - new Date(r.created_at).getTime()) / 3600000);
                const sla = SLA_H[r.priority] ?? 48;
                return (
                  <li key={r.id} className="rounded-lg border border-line bg-panel p-3">
                    <div className="flex items-center justify-between gap-2"><Link href={`/ops/requests/${r.id}`} className="hover:text-brand"><Mono>{r.ref}</Mono></Link><Pill tone={statusTone(r.priority)}>{r.priority}</Pill></div>
                    <p className="mt-1 text-sm font-medium leading-snug">{r.title}</p>
                    <p className="text-xs text-muted">{r.client}{r.site_code ? ` · ${r.site_code}` : ""} · {r.source}{r.docs ? ` · ${r.docs} doc(s)` : ""}</p>
                    <p className={`mt-1 text-xs font-semibold ${age > sla ? "text-tag-red" : age > sla * 0.75 ? "text-tag-yellow" : "text-muted"}`}>{age} h {tx(l, "old", "")} · {tx(l, "target", "الهدف")} {sla} h{age > sla ? ` · ${tx(l, "late", "متأخر")}` : ""}</p>
                    {r.ai_summary?.questions?.length ? <p className="mt-1 text-xs text-tag-yellow">{r.ai_summary.questions.length} {tx(l, "question(s) for the client", "أسئلة للعميل")}</p> : null}
                    <form action={triageAction} className="mt-2 flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      {key !== "triage" && <SubmitButton name="status" value="triage" className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold">→ Triage</SubmitButton>}
                      {key !== "estimating" && <SubmitButton name="status" value="estimating" className="rounded-md bg-ink px-2 py-1 text-[11px] font-semibold text-white">→ Estimating</SubmitButton>}
                      <SubmitButton name="status" value="cancelled" className="rounded-md px-2 py-1 text-[11px] text-muted">Cancel</SubmitButton>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** Client overview: the four things clients judge contractors on, then projects and what needs them. */
export async function ClientOverviewKpis({ s }: { s: Session }) {
  const l = await loc();
  const [projects, sos, k] = await Promise.all([
    listProjects(s),
    listSignoffs(s, { status: "pending" }),
    withUser(s, (db) => rows<{ resp_h: number | null; last_incident: string | null; red: number; open_inv: number }>(db,
      `select (select avg(extract(epoch from (v.submitted_at - i.issued_at)) / 3600) from variations v join instructions i on i.id = v.instruction_id where v.submitted_at is not null)::float8 resp_h,
              (select max(occurred_at)::text from incidents where kind in ('lti','first_aid')) last_incident,
              (select count(*) from scaffolds where status = 'red')::int red,
              (select coalesce(sum(total),0) from invoices where status = 'issued')::float8 open_inv`)),
  ]);
  const mine = sos.filter((x) => awaitingMe(s, x));
  const onTrack = projects.filter((p) => health(p).tone === "green").length;
  const r = k[0];
  const daysSafe = r.last_incident ? -(daysUntil(r.last_incident) ?? 0) : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label={tx(l, "Waiting for your signature", "بانتظار توقيعك")} value={fmtNum(mine.length, l)} tone={mine.length ? "brand" : "default"} href="/client/signoffs" hint={mine[0] ? (l === "ar" && mine[0].title_ar ? mine[0].title_ar : mine[0].title) : tx(l, "All clear", "لا يوجد")} />
      <Kpi label={tx(l, "RGS response to your instructions", "زمن استجابة RGS لتعليماتك")} value={r.resp_h != null ? `${fmtNum(r.resp_h, l, 0)} h` : "—"} hint={tx(l, "average, instruction → priced variation", "متوسط من التعليمات إلى أمر التغيير")} />
      <Kpi label={tx(l, "Safety", "السلامة")} value={daysSafe != null ? `${daysSafe} ${tx(l, "days", "يوم")}` : tx(l, "No recordables", "لا حوادث مسجلة")} hint={`${tx(l, "since last recordable incident", "منذ آخر حادث مسجل")} · ${r.red} ${tx(l, "red-tagged scaffolds", "سقالات حمراء")}`} tone={r.red ? "red" : "default"} href="/client/scaffolds?status=red" />
      <Kpi label={tx(l, "Projects on track", "المشاريع في المسار")} value={`${onTrack} / ${projects.length}`} hint={`${tx(l, "open invoices", "فواتير مفتوحة")} ${fmtSAR(r.open_inv, l)}`} href="/client/projects" />
    </div>
  );
}
