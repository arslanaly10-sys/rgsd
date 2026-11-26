import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { aiMode } from "@/lib/ai/provider";
import { runAccessTest } from "@/lib/access-test";
import { channelStatus } from "@/lib/channels";
import { rows, withSystem } from "@/lib/db";
import { authMode, listPeople, mfaRequiredRoles } from "@/lib/identity";
import { CLIENT_ROLES, STAFF_ROLES } from "@/lib/roles";
import { inviteAction, resetMfaAction, revokeInviteAction, setStatusAction } from "@/app/auth-actions";
import { dispatchNowAction } from "@/lib/actions/admin";
import { SubmitButton } from "../submit-button";
import { ButtonLink, Card, Confidence, DueLabel, Flash, Kpi, Mono, PageHeader, Pill, TagPill, Table, Td } from "../ui";

type P = { s: Session; msg?: string };
const field = "rounded-lg border border-line bg-panel px-3 py-2 text-sm";

// ───────────────────────── Hub ─────────────────────────
const SECTIONS: [string, string, string][] = [
  ["design", "Design system", "Colour tokens, type, components and RTL, as built in the app."],
  ["data-model", "Data model", "Every table, read live from the database: domain, columns, foreign keys, RLS policies, rows."],
  ["permissions", "Permission matrix", "Who can open each area, which agent tools each role can trigger, and the approval tier."],
  ["access", "Access tester", "Sign in as anyone (read-only) and prove what they can and can't see."],
  ["states", "Interface states", "Empty, loading, error, offline, pending approval, permission denied and RTL."],
  ["architecture", "Architecture", "How the pieces fit, what runs on a schedule, and which providers are connected."],
  ["people", "People & access", "Invite staff and clients, disable access, reset authenticators."],
  ["outbox", "Message outbox", "Every email / WhatsApp / SMS the platform sent or would send."],
];

export async function HubPage({ s }: P) {
  const [counts] = await withSystem((db) => rows<{ tables: number; rls: number; policies: number; migrations: number }>(db,
    `select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')::int tables,
            (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)::int rls,
            (select count(*) from pg_policies where schemaname = 'public')::int policies, (select count(*) from public._migrations)::int migrations`).catch(() => rows<{ tables: number; rls: number; policies: number; migrations: number }>(db, "select 0 tables, 0 rls, 0 policies, 0 migrations")));
  const ch = channelStatus();
  return (
    <>
      <PageHeader title="Stage 1 review" sub={`For RGS IT and admins. Signed in as ${s.fullName}. Everything here is read live from the running system.`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Tables" value={counts.tables} hint={`${counts.rls} with row-level security`} tone={counts.rls === counts.tables ? "default" : "red"} />
        <Kpi label="RLS policies" value={counts.policies} />
        <Kpi label="Migrations applied" value={counts.migrations} />
        <Kpi label="Sign-in mode" value={authMode() === "otp" ? "Email code + MFA" : "Demo picker"} hint={`MFA required: ${mfaRequiredRoles().join(", ")}`} tone={authMode() === "otp" ? "default" : "yellow"} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map(([slug, title, sub]) => (
          <Link key={slug} href={`/ops/admin/${slug}`} className="rounded-xl border border-line bg-panel p-4 transition hover:border-brand">
            <div className="font-semibold">{title}</div><p className="mt-1 text-sm text-muted">{sub}</p>
          </Link>
        ))}
      </div>
      <Card title="Readiness for go-live" className="mt-4">
        <ul className="grid gap-1.5 text-sm">
          {[
            [authMode() === "otp", "Production sign-in (AUTH_MODE=otp): persona picker removed, email codes, MFA for admin/finance"],
            [aiMode() === "live", `Live AI (AI_MODE): currently ${aiMode()}`],
            [ch.email !== "log only", `Email provider: ${ch.email}`],
            [ch.whatsapp !== "log only", `WhatsApp Business: ${ch.whatsapp}`],
            [ch.sms !== "log only", `SMS (Unifonic): ${ch.sms}`],
            [!!process.env.CRON_SECRET, "Cron secret set for workflows, watchers and notification dispatch"],
            [!!process.env.AUTH_SECRET && process.env.AUTH_SECRET !== "dev-only-insecure-secret", "AUTH_SECRET set (session signing and code hashing)"],
            [counts.rls === counts.tables, "Row-level security on every table"],
          ].map(([ok, label], i) => <li key={i} className="flex items-start gap-2"><span className={ok ? "text-tag-green" : "text-tag-yellow"}>{ok ? "✓" : "○"}</span>{label as string}</li>)}
        </ul>
      </Card>
    </>
  );
}

// ───────────────────────── Design system ─────────────────────────
const TOKENS = [["brand", "#f9441a", "RGS orange: primary actions, active nav"], ["brand-600", "#dc3510", "hover"], ["brand-50", "#fff3ee", "tints"], ["ink", "#141922", "rail, headings"], ["canvas", "#f5f6f8", "page"], ["panel", "#ffffff", "cards"], ["line", "#e3e6eb", "borders"], ["muted", "#5f6b7a", "secondary text (4.9:1)"], ["tag-green", "#15803d", "green tag / pass"], ["tag-yellow", "#a16207", "yellow tag / warning"], ["tag-red", "#c81e1e", "red tag / fail"]];

export async function DesignPage() {
  const t = await getTranslations();
  return (
    <>
      <PageHeader title="Design system" sub="RGS OneSite tokens and components. One brand across scaffolding, waterproofing and insulation; service lines get a coloured chip, not a separate theme." />
      <Card title="Colour tokens" className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {TOKENS.map(([n, hex, use]) => (
            <div key={n} className="rounded-lg border border-line p-2">
              <div className="h-12 rounded-md border border-line" style={{ background: `var(--color-${n})` }} />
              <div className="mt-1.5 text-xs font-semibold">{n}</div><div className="font-mono text-[11px] text-muted">{hex}</div><div className="text-[11px] text-muted">{use}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Type">
          <p className="eyebrow">Eyebrow · 11px caps</p>
          <h1 className="text-3xl font-semibold">Display · Poppins 30</h1>
          <h2 className="text-xl font-semibold">Heading · 20</h2>
          <p className="text-sm">Body · Inter 14. Numbers use <span className="tabular">tabular 1,234.50</span>. References use <Mono>PRJ-26-001</Mono>.</p>
          <p className="mt-2 text-sm" dir="rtl" lang="ar">النص العربي · IBM Plex Sans Arabic. يتم عكس الواجهة بالكامل في وضع RTL.</p>
        </Card>
        <Card title="Status & tags">
          <div className="flex flex-wrap gap-2">
            <TagPill status="green" label={t("tag.green")} /><TagPill status="yellow" label={t("tag.yellow")} /><TagPill status="red" label={t("tag.red")} />
            {(["neutral", "brand", "green", "yellow", "red", "dark"] as const).map((x) => <Pill key={x} tone={x}>{x}</Pill>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><Confidence value={0.92} /><Confidence value={0.6} /><Confidence value={0.3} /></div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs"><DueLabel days={-3} t={(k, v) => t(`dash.${k}`, v)} /><DueLabel days={0} t={(k, v) => t(`dash.${k}`, v)} /><DueLabel days={5} t={(k, v) => t(`dash.${k}`, v)} /></div>
        </Card>
        <Card title="Actions">
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="#">Primary</ButtonLink><ButtonLink href="#" variant="ghost">Secondary</ButtonLink>
            <button className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white">Compact</button>
            <button className="rounded-lg border border-tag-red px-4 py-2 text-sm font-semibold text-tag-red">Destructive</button>
            <button disabled className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white opacity-60">Disabled</button>
          </div>
          <p className="mt-3 text-xs text-muted">Rules: one primary action per card; destructive actions are outlined red and never primary; anything an AI agent proposes that changes data shows who approves it.</p>
        </Card>
        <Card title="KPI tiles">
          <div className="grid grid-cols-2 gap-3"><Kpi label="Default" value="12" /><Kpi label="Brand" value="3" tone="brand" /><Kpi label="Warning" value="SAR 41,000" tone="yellow" /><Kpi label="Critical" value="2" tone="red" hint="links to the list" /></div>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────── Data model ─────────────────────────
const DOMAINS: [string, RegExp][] = [
  ["Identity & access", /^(organizations|profiles|client_companies|invites|auth_|login_events|notification|outbound)/],
  ["Projects & delivery", /^(projects|project_|progress|measurements|milestones|dependencies|instructions|variations|signoffs)/],
  ["Quality, HSE & documents", /^(checklist|itp|findings|manhours|toolbox|permits|chemical|waste|controlled_documents|document_revisions|warranties|inspection|defect)/],
  ["Scaffolding & fleet", /^(sites|scaffold|stock|movement|yard|dispatch|material|tag)/],
  ["Commercial", /^(requests|quotes|quote_|rate|invoices|invoice_|payment|payments|credit_notes|tender)/],
  ["Workforce", /^(workers|certifications|crew|training)/],
  ["Support", /^(tickets|ticket_)/],
  ["AI agents & workflows", /^(agent|approval|memories|kb_|workflow|tasks|documents|integrations|eval)/],
];

export async function DataModelPage() {
  const tables = await withSystem((db) => rows<{ name: string; rls: boolean; cols: number; est: number; policies: string[]; fks: string[]; comment: string | null }>(db,
    `select c.relname name, c.relrowsecurity rls, (select count(*) from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname)::int cols,
            greatest(c.reltuples, 0)::int est, coalesce((select array_agg(p.policyname || ' (' || p.cmd || ')' order by p.policyname) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname), '{}') policies,
            coalesce((select array_agg(distinct cf.relname::text) from pg_constraint f join pg_class cf on cf.oid = f.confrelid where f.conrelid = c.oid and f.contype = 'f'), '{}') fks,
            obj_description(c.oid) comment
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname`));
  const groups = DOMAINS.map(([d, re]) => [d, tables.filter((t) => re.test(t.name))] as const);
  const rest = tables.filter((t) => !DOMAINS.some(([, re]) => re.test(t.name)));
  return (
    <>
      <PageHeader title="Data model" sub={`${tables.length} tables in Postgres (Supabase), read live from the catalogue. Every business table carries org_id; client-visible tables carry client_company_id, which RLS uses to keep companies apart.`} />
      <div className="grid gap-4">
        {[...groups, ["Other", rest] as const].filter(([, l]) => l.length).map(([d, list]) => (
          <Card key={d} title={`${d} · ${list.length}`}>
            <Table head={["Table", "Columns", "Rows (est.)", "References", "RLS policies"]} minWidth={900}>
              {list.map((t) => (
                <tr key={t.name}>
                  <Td><Mono>{t.name}</Mono>{!t.rls && <Pill tone="red">no RLS</Pill>}</Td>
                  <Td className="tabular">{t.cols}</Td>
                  <Td className="tabular">{t.est}</Td>
                  <Td className="text-xs text-muted">{t.fks.join(", ") || "—"}</Td>
                  <Td className="text-xs">{t.policies.length ? t.policies.join(" · ") : <span className="text-muted">{t.rls ? "none: server-only (deny all users)" : "—"}</span>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── Permission matrix ─────────────────────────
const AREAS: [string, string[]][] = [
  ["Overview, projects, delivery, quality, documents", ["*staff", "*client"]],
  ["Management oversight", ["admin", "ops_manager", "finance"]],
  ["Requests & quotes (pricing)", ["admin", "ops_manager", "estimator"]],
  ["Fleet & dispatch", ["admin", "ops_manager", "yard_logistics", "site_supervisor"]],
  ["Workforce & competency", ["*staff"]],
  ["Claims, invoices, statement", ["admin", "finance", "ops_manager", "client_admin", "client_finance"]],
  ["Record payments", ["admin", "finance"]],
  ["Credit / debit notes", ["admin", "finance", "ops_manager"]],
  ["Sign: measurements & hold points", ["client_admin", "client_consultant"]],
  ["Sign: variations ≤ SAR 100k", ["client_admin"]],
  ["Sign: variations > SAR 100k, claims", ["client_admin", "client_finance"]],
  ["Document reviews (A/B/C/D)", ["client_consultant", "client_admin", "client_hse"]],
  ["Support tickets", ["*staff", "*client"]],
  ["Invite people", ["admin", "client_admin"]],
  ["Stage 1 review, outbox, access tester", ["admin"]],
];
const ROLES = [...STAFF_ROLES, ...CLIENT_ROLES];

export async function PermissionsPage({ s }: P) {
  const t = await getTranslations();
  const pol = await withSystem((db) => rows<{ tool: string; tier: number; allowed_roles: string[]; auto_roles: string[]; approver_roles: string[]; description: string | null }>(db,
    "select tool, tier, allowed_roles, auto_roles, approver_roles, description from agent_policies where org_id = $1 order by tier, tool", [s.orgId]));
  const has = (rule: string[], r: string) => rule.includes(r) || (rule.includes("*staff") && (STAFF_ROLES as readonly string[]).includes(r)) || (rule.includes("*client") && (CLIENT_ROLES as readonly string[]).includes(r));
  const head = ["", ...ROLES.map((r) => <span key={r} className="block max-w-16 whitespace-normal text-[10px] leading-tight">{t(`roles.${r}`)}</span>)];
  return (
    <>
      <PageHeader title="Permission matrix" sub="Enforced in three places: the page (server checks the role), the database (row-level security per company), and the agent policy (tool tier and approvers). Agent tools below are read live from agent_policies." />
      <Card title="Areas and actions" className="mb-4">
        <Table head={head} minWidth={1200}>
          {AREAS.map(([a, rule]) => <tr key={a}><Td className="text-sm font-medium">{a}</Td>{ROLES.map((r) => <Td key={r} className="px-1 text-center">{has(rule, r) ? <span className="text-tag-green">●</span> : <span className="text-line">·</span>}</Td>)}</tr>)}
        </Table>
      </Card>
      <Card title={`Agent tools · ${pol.length}`} action={<span className="text-xs text-muted">● can use · A runs without approval · ✓ approves</span>}>
        <Table head={["Tool", "Tier", ...head.slice(1)]} minWidth={1300}>
          {pol.map((p) => (
            <tr key={p.tool}>
              <Td><Mono>{p.tool}</Mono><div className="max-w-56 text-[11px] text-muted">{p.description}</div></Td>
              <Td><Pill tone={p.tier >= 3 ? "red" : p.tier === 2 ? "yellow" : p.tier === 1 ? "brand" : "neutral"}>T{p.tier}</Pill></Td>
              {ROLES.map((r) => <Td key={r} className="px-1 text-center text-xs">{p.allowed_roles.includes(r) ? <span className="text-tag-green">{p.tier === 2 && p.auto_roles.includes(r) ? "A" : "●"}</span> : <span className="text-line">·</span>}{p.approver_roles.includes(r) ? <span className="text-brand">✓</span> : null}</Td>)}
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">T0 read · T1 reversible write · T2 operational change (approval unless the role runs it automatically) · T3 external/financial (always approved by someone else).</p>
      </Card>
    </>
  );
}

// ───────────────────────── Access tester ─────────────────────────
export async function AccessPage({ s, who }: P & { who?: string }) {
  const t = await getTranslations();
  const people = await withSystem((db) => rows<{ id: string; full_name: string; role: string; company: string | null }>(db,
    "select p.id, p.full_name, p.role, c.name company from profiles p left join client_companies c on c.id = p.client_company_id where p.org_id = $1 and p.status = 'active' order by p.client_company_id is not null, c.name, p.full_name", [s.orgId]));
  const target = people.find((p) => p.id === who);
  const r = target ? await runAccessTest(target.id) : null;
  return (
    <>
      <PageHeader title="Access tester" sub="Runs real read queries as the chosen person, with row-level security exactly as they'd have it, and checks each table against its rule. Read-only: the probe transaction is rolled back." />
      <Card className="mb-4">
        <form className="flex flex-wrap items-center gap-2">
          <select name="who" defaultValue={who ?? ""} aria-label="Person" className={`${field} min-w-72`}>
            <option value="">Choose a person…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {t(`roles.${p.role}`)}{p.company ? ` · ${p.company}` : ""}</option>)}
          </select>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Run access test</button>
        </form>
      </Card>
      {r && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Testing as" value={<span className="text-base">{r.session.fullName}</span>} hint={`${t(`roles.${r.session.role}`)}${r.session.companyName ? ` · ${r.session.companyName}` : ""}`} />
            <Kpi label="Checks passed" value={r.passed} />
            <Kpi label="Checks failed" value={r.failed} tone={r.failed ? "red" : "default"} />
            <Kpi label="Agent tools allowed" value={r.tools.length} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <Card title="Data visibility">
              <Table head={["Table", "Rule", "Visible", "Total", "Other company / not own", "Result"]} minWidth={720}>
                {r.probes.map((p) => (
                  <tr key={p.table} data-probe={p.table}>
                    <Td><Mono>{p.table}</Mono></Td>
                    <Td className="text-xs text-muted">{p.rule}</Td>
                    <Td className="tabular">{p.visible ?? <span className="text-xs text-muted">{p.note}</span>}</Td>
                    <Td className="tabular text-muted">{p.total}</Td>
                    <Td className="tabular">{p.foreign ?? "—"}{p.hidden ? <span className="text-tag-red"> +{p.hidden} hidden-state</span> : ""}</Td>
                    <Td>{p.ok ? <Pill tone="green">pass</Pill> : <Pill tone="red">FAIL</Pill>}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Agent tools this person can trigger">
              <ul className="grid gap-1 text-sm">
                {r.tools.map((x) => <li key={x.tool} className="flex items-center justify-between gap-2"><Mono>{x.tool}</Mono><span className="flex gap-1"><Pill tone={x.tier >= 3 ? "red" : x.tier === 2 ? "yellow" : "neutral"}>T{x.tier}</Pill>{x.tier >= 2 && <Pill tone={x.auto ? "green" : "brand"}>{x.auto ? "runs directly" : "needs approval"}</Pill>}{x.approver && <Pill tone="dark">approver</Pill>}</span></li>)}
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// ───────────────────────── Interface states ─────────────────────────
export function StatesPage() {
  return (
    <>
      <PageHeader title="Interface states" sub="Every screen handles these states the same way. Live examples, using the real components." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Empty"><Table head={["Ref", "Status"]} empty="Nothing here yet. New requests from clients appear here." minWidth={200}>{null}</Table></Card>
        <Card title="Loading"><div className="grid gap-2" aria-busy="true">{[80, 60, 70].map((w) => <div key={w} className="h-4 animate-pulse rounded bg-line" style={{ width: `${w}%` }} />)}</div><p className="mt-2 text-xs text-muted">Skeletons; buttons show “…” and disable while a form submits.</p></Card>
        <Card title="Success"><Flash msg="ok:PC-26-0004 sent to the client to certify." /></Card>
        <Card title="Error (validation)"><Flash msg="err:Describe the finding in a few words." /><p className="text-xs text-muted">Errors say what to do next. Nothing is half-saved: each action is one transaction.</p></Card>
        <Card title="Offline (field app)"><div className="rounded-lg bg-ink px-3 py-2 text-sm text-white">You&apos;re offline. 3 inspections are saved on this phone and will upload when you reconnect.</div></Card>
        <Card title="Waiting for approval"><div className="rounded-lg border border-line p-3 text-sm"><Pill tone="yellow">pending approval</Pill> <span className="ms-1">Issue CN-26-001 · approver: Finance</span><p className="mt-1 text-xs text-muted">AI and people never claim an approved action is done until it is.</p></div></Card>
        <Card title="Permission denied"><div className="rounded-lg bg-tag-red-bg px-3 py-2 text-sm text-tag-red">Only finance records payments.</div><p className="mt-1 text-xs text-muted">Controls the role can&apos;t use are hidden; the server still refuses if called directly.</p></Card>
        <Card title="Overdue / SLA missed"><div className="flex flex-wrap gap-2 text-sm"><Pill tone="red">overdue 4 d</Pill><span className="text-xs font-semibold text-tag-red">SLA missed · escalated</span></div></Card>
        <Card title="Right-to-left (Arabic)"><div dir="rtl" lang="ar" className="text-sm"><p className="font-semibold">المستخلصات</p><p className="text-muted">الصافي + الضريبة: <span className="tabular">ر.س 98,578.00</span> · <Mono>PC-26-0004</Mono></p></div></Card>
      </div>
    </>
  );
}

// ───────────────────────── Architecture ─────────────────────────
export async function ArchitecturePage() {
  const mig = await withSystem((db) => rows<{ name: string; applied_at: string }>(db, "select name, applied_at::text from public._migrations order by name")).catch(() => []);
  const ch = channelStatus();
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, tone = "var(--color-panel)") => (
    <g key={title}><rect x={x} y={y} width={w} height={h} rx="10" fill={tone} stroke="var(--color-line)" /><text x={x + 12} y={y + 22} fontSize="13" fontWeight="600" fill="var(--color-ink)">{title}</text><text x={x + 12} y={y + 40} fontSize="11" fill="var(--color-muted)">{sub}</text></g>
  );
  return (
    <>
      <PageHeader title="Architecture" sub="Next.js on Vercel (cloud now), Postgres on Supabase with row-level security, Claude for agents. Built to move to a KSA region (data residency) without code changes." />
      <Card title="System" className="mb-4">
        <svg viewBox="0 0 980 330" className="w-full" role="img" aria-label="Architecture diagram">
          {box(10, 20, 200, 56, "Staff portal /ops", "RGS teams, EN/AR")}
          {box(10, 92, 200, 56, "Client portal /client", "per-company, RLS")}
          {box(10, 164, 200, 56, "Field app /field", "offline PWA, QR tags")}
          {box(10, 236, 200, 56, "Channels in", "email · WhatsApp · voice")}
          {box(290, 20, 260, 130, "Next.js server", "pages, server actions, APIs", "var(--color-brand-50)")}
          {box(290, 164, 260, 128, "Agent runtime", "supervisor → 7 specialists · tool tiers T0–T3 · approvals · traces", "var(--color-brand-50)")}
          {box(630, 20, 340, 56, "Postgres (Supabase)", "72+ tables · RLS by org & company · audit trigger")}
          {box(630, 92, 340, 56, "Durable workflows + watchers", "Postgres leases · cron every 5 min / nightly")}
          {box(630, 164, 340, 56, `AI provider: ${aiMode()}`, "Claude (smart + fast) · mock fallback · evals")}
          {box(630, 236, 340, 56, "Outbound channels", `email ${ch.email} · WhatsApp ${ch.whatsapp} · SMS ${ch.sms}`)}
          {[[210, 48, 290, 60], [210, 120, 290, 90], [210, 192, 290, 110], [210, 264, 290, 230], [550, 60, 630, 48], [550, 110, 630, 120], [550, 228, 630, 192], [550, 250, 630, 264]].map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted)" strokeWidth="1.2" markerEnd="url(#arr)" />)}
          <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-muted)" /></marker></defs>
        </svg>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Security baseline">
          <ul className="list-disc ps-5 text-sm text-muted">
            <li>Sign-in by emailed one-time code; authenticator-app MFA for admin and finance; invitations only.</li>
            <li>Sessions are signed, expire in 12 h, and can be revoked everywhere (session version).</li>
            <li>Every query runs as the user under Postgres row-level security; system jobs are audited.</li>
            <li>AI tools are tiered; money and external actions always need a second person.</li>
            <li>Uploaded files are type-sniffed and size-limited; QR codes and certificates are not guessable.</li>
            <li>HSTS, CSP, frame-deny and related headers on every response.</li>
            <li>Aramco CCC / NCA ECC: designed for, certification later; KSA region move is a config change.</li>
          </ul>
        </Card>
        <Card title={`Migrations · ${mig.length}`}>
          <ul className="grid gap-1 text-xs">{mig.map((m) => <li key={m.name} className="flex justify-between gap-2"><Mono>{m.name}</Mono><span className="text-muted">{m.applied_at.slice(0, 16)}</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────── People & invitations ─────────────────────────
export async function PeoplePage({ s, msg }: P) {
  const t = await getTranslations();
  const [people, companies] = await Promise.all([listPeople(s), s.role === "admin" ? withSystem((db) => rows<{ id: string; name: string }>(db, "select id, name from client_companies where org_id = $1 order by name", [s.orgId])) : Promise.resolve([])]);
  const roles = s.role === "admin" ? [...STAFF_ROLES, ...CLIENT_ROLES] : CLIENT_ROLES;
  const invited = people.filter((p) => p.status === "invited");
  return (
    <>
      <PageHeader title={s.isStaff ? "People & access" : "Your team's access"} sub={s.isStaff ? "Invite RGS staff and client users. Disabling someone signs them out everywhere at once." : "Invite colleagues from your company to follow projects, sign off and see invoices."} />
      <Flash msg={msg} />
      <Card title="Invite someone" className="mb-4">
        <form action={inviteAction} className="grid gap-2 md:grid-cols-6">
          <input name="fullName" required minLength={3} aria-label="Full name" placeholder="Full name" className={`${field} md:col-span-2`} />
          <input name="email" type="email" required aria-label="Email" placeholder="name@company.com" className={`${field} md:col-span-2`} dir="ltr" />
          <select name="role" aria-label="Role" className={field}>{roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</select>
          <select name="locale" aria-label="Language" className={field}><option value="en">English</option><option value="ar">العربية</option></select>
          {s.role === "admin" && <select name="clientCompanyId" aria-label="Client company (client roles)" className={`${field} md:col-span-2`}><option value="">RGS staff (no company)</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <input name="phone" aria-label="Mobile (optional)" placeholder="+9665XXXXXXXX (optional)" className={`${field} md:col-span-2`} dir="ltr" />
          <SubmitButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending="…">Send invitation</SubmitButton>
        </form>
      </Card>
      {invited.length > 0 && (
        <Card title={`Waiting to accept · ${invited.length}`} className="mb-4">
          <ul className="divide-y divide-line text-sm">{invited.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><strong>{p.full_name}</strong> · {p.email} · {t(`roles.${p.role}`)}{p.company ? ` · ${p.company}` : ""}<span className="text-xs text-muted"> · expires {p.invite_expires?.slice(0, 10)}</span></span>
              {p.invite_id && <form action={revokeInviteAction}><input type="hidden" name="id" value={p.invite_id} /><SubmitButton className="rounded-md border border-line px-3 py-1 text-xs font-semibold" pending="…">Withdraw</SubmitButton></form>}</li>
          ))}</ul>
        </Card>
      )}
      <Card title={`People · ${people.length - invited.length}`}>
        <Table head={["Name", "Role", "Company", "MFA", "Last sign-in", "Status", ""]} minWidth={860}>
          {people.filter((p) => p.status !== "invited").map((p) => (
            <tr key={p.id}>
              <Td><div className="font-medium">{p.full_name}</div><div className="text-xs text-muted">{p.email}</div></Td>
              <Td className="text-xs">{t(`roles.${p.role}`)}</Td>
              <Td className="text-xs">{p.company ?? "RGS"}</Td>
              <Td>{p.mfa_enabled ? <Pill tone="green">on</Pill> : <Pill tone={mfaRequiredRoles().includes(p.role) ? "yellow" : "neutral"}>off</Pill>}</Td>
              <Td className="text-xs text-muted">{p.last_login_at ? new Date(p.last_login_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }) : "—"}</Td>
              <Td><Pill tone={p.status === "active" ? "green" : "red"}>{p.status}</Pill></Td>
              <Td className="whitespace-nowrap">
                {p.id !== s.id && <form action={setStatusAction} className="inline"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value={p.status === "active" ? "disabled" : "active"} /><SubmitButton className="rounded-md border border-line px-2 py-1 text-xs font-semibold" pending="…">{p.status === "active" ? "Disable" : "Restore"}</SubmitButton></form>}
                {s.role === "admin" && p.mfa_enabled && <form action={resetMfaAction} className="ms-1 inline"><input type="hidden" name="id" value={p.id} /><SubmitButton className="rounded-md border border-line px-2 py-1 text-xs font-semibold" pending="…">Reset MFA</SubmitButton></form>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

// ───────────────────────── Outbox ─────────────────────────
export async function OutboxPage({ s, msg }: P) {
  const [list, pending] = await Promise.all([
    withSystem((db) => rows<{ id: string; channel: string; to_addr: string; subject: string | null; body: string; status: string; provider: string | null; error: string | null; created_at: string; who: string | null }>(db,
      "select m.id, m.channel, m.to_addr, m.subject, m.body, m.status, m.provider, m.error, m.created_at, p.full_name who from outbound_messages m left join profiles p on p.id = m.profile_id where m.org_id = $1 or m.org_id is null order by m.created_at desc limit 100", [s.orgId])),
    withSystem((db) => rows<{ n: number }>(db, "select count(*)::int n from notifications where org_id = $1 and dispatched_at is null", [s.orgId])),
  ]);
  const ch = channelStatus();
  return (
    <>
      <PageHeader title="Message outbox" sub={`Email: ${ch.email} · WhatsApp: ${ch.whatsapp} · SMS: ${ch.sms}. Without a provider key, messages are logged here instead of sent. Sign-in codes and invitation links are redacted.`}
        actions={<form action={dispatchNowAction}><SubmitButton className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white" pending="…">Dispatch {pending[0].n} pending notification(s)</SubmitButton></form>} />
      <Flash msg={msg} />
      <Card>
        <Table head={["When", "Channel", "To", "Message", "Status"]} empty={list.length ? undefined : "No messages yet."} minWidth={820}>
          {list.map((m) => (
            <tr key={m.id}>
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(m.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Riyadh" })}</Td>
              <Td><Pill tone="dark">{m.channel}</Pill></Td>
              <Td className="text-xs">{m.who ?? "—"}<div className="text-muted" dir="ltr">{m.to_addr}</div></Td>
              <Td className="max-w-96"><div className="text-sm font-medium">{m.subject}</div><div className="line-clamp-2 whitespace-pre-wrap text-xs text-muted">{m.body}</div></Td>
              <Td><Pill tone={m.status === "sent" ? "green" : m.status === "failed" ? "red" : "neutral"}>{m.status}</Pill>{m.error && <div className="text-xs text-tag-red">{m.error}</div>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
