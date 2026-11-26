import "server-only";
import { getSessionById, type Session } from "@/lib/auth";
import { one, rows, withSystem, withUser, type Db } from "@/lib/db";
import { claimPreview, statementOfAccount, submitClaim } from "@/lib/commercial";
import { awaitingMe, listProjects, listSignoffs } from "@/lib/projects";
import { hseKpis } from "@/lib/quality";
import { bookRefreshers, workforceSummary } from "@/lib/workforce";
import { runComplianceWatcher } from "@/lib/watchers/compliance";
import { POSITION } from "@/lib/positions";
import { invokeTool } from "./policy";
import { recordHandoff } from "./handoffs";

/*
 * Personal agents. Each person has one, named for them and shaped by their position. A cycle runs
 * the agent's standing jobs: routine reads and reversible writes happen on their own (autonomy
 * "routine"); anything external or financial becomes a draft for the owner, or an approval request.
 * Everything the agent does lands in its owner's inbox with a link to the record.
 */

type Item = { job?: string; kind: "briefing" | "done" | "draft" | "chase" | "triage" | "handoff" | "alert"; title: string; body?: string; link?: string; status?: "info" | "proposed" | "done"; payload?: Record<string, unknown>; dedupe?: string };
type Ctx = { s: Session; agentName: string; autonomy: "drafts" | "routine"; items: Item[]; runId: string | null };
type JobFn = (c: Ctx) => Promise<void>;

const sar = (n: number) => `SAR ${Math.round(n).toLocaleString("en")}`;
const bucket = (days: number) => Math.floor(Date.now() / (days * 86_400_000));
const base = (s: Session) => (s.isStaff ? "/ops" : "/client");

/** Notify someone else on the owner's behalf, at most once per entity every 3 days. */
async function chase(c: Ctx, x: { key: string; to: { userId?: string; role?: string; clientCompanyId?: string | null }; title: string; titleAr?: string; link: string }) {
  const dedupe = `chase:${x.key}:${bucket(3)}`;
  const fresh = await withSystem((db) => one(db, "select 1 from agent_inbox where profile_id = $1 and dedupe_key = $2", [c.s.id, dedupe]));
  if (fresh) return false;
  await withSystem((db) => db.query("insert into notifications (org_id, user_id, role, client_company_id, kind, title, title_ar, link) values ($1,$2,$3,$4,'agent_chase',$5,$6,$7)",
    [c.s.orgId, x.to.userId ?? null, x.to.role ?? null, x.to.clientCompanyId ?? null, `${c.agentName}: ${x.title}`, x.titleAr ?? x.title, x.link]));
  c.items.push({ kind: "chase", title: `Chased: ${x.title}`, link: x.link, status: "done", dedupe });
  return true;
}

const JOBS: Record<string, JobFn> = {
  // ── General manager ──
  async portfolio_risk(c) {
    const ps = await listProjects(c.s);
    const risky = ps.filter((p) => p.progress_pct + 10 < p.time_pct || p.overdue_milestones > 0 || p.blocked_deps > 0);
    const st = await statementOfAccount(c.s);
    const over = st.open.filter((o) => o.days > 30);
    c.items.push({ kind: "alert", title: `${risky.length} of ${ps.length} projects need attention; ${sar(st.total_outstanding)} outstanding, ${sar(over.reduce((t, o) => t + o.outstanding, 0))} over 30 days`,
      body: risky.map((p) => `• ${p.ref} ${p.name.split(" · ")[0]}: installed ${p.progress_pct}% vs time ${p.time_pct}%${p.overdue_milestones ? `, ${p.overdue_milestones} milestone(s) slipping` : ""}${p.blocked_deps ? `, ${p.blocked_deps} blocked` : ""}`).join("\n") || "All projects on track.", link: "/ops/oversight" });
  },
  async approvals_over_limit(c) {
    const a = await withSystem((db) => rows<{ id: string; summary: string; amount: string | null }>(db,
      "select id, summary, amount from approval_requests where org_id = $1 and status = 'pending' and $2 = any(approver_positions) order by created_at", [c.s.orgId, c.s.position]));
    for (const x of a) c.items.push({ kind: "alert", title: `Needs you: ${x.summary}`, link: "/ops/approvals", dedupe: `appr:${x.id}` });
  },
  // ── Operations ──
  async ops_brief(c) {
    const r = await invokeTool({ session: c.s, runId: c.runId, locale: c.s.locale }, "daily_brief", {});
    c.items.push({ kind: "done", title: "Operations brief prepared", body: String(r.output.brief_en ?? ""), link: "/ops" });
  },
  async run_watchers(c) {
    const r = await runComplianceWatcher(c.s.orgId);
    c.items.push({ kind: "done", title: `Compliance watchers ran: ${r.summary}`, link: "/ops/tasks", status: "done" });
  },
  // ── Project manager ──
  async commitments_at_risk(c) {
    const ms = await withUser(c.s, (db) => rows<{ name: string; ref: string; id: string; due: string; forecast: string | null }>(db,
      `select m.name, p.ref, p.id, m.due_date::text due, m.forecast_date::text forecast from milestones m join projects p on p.id = m.project_id
       where m.status <> 'achieved' and (p.rgs_pm_id = $1 or not exists (select 1 from projects x where x.rgs_pm_id = $1)) and (m.due_date < current_date or m.forecast_date > m.due_date) order by m.due_date`, [c.s.id]));
    for (const m of ms) c.items.push({ kind: "alert", title: `${m.ref}: “${m.name}” ${m.due < new Date().toISOString().slice(0, 10) ? "is late" : `slips to ${m.forecast}`}`, link: `/ops/projects/${m.id}?tab=commitments`, dedupe: `ms:${m.ref}:${m.name}:${bucket(1)}` });
  },
  async chase_client_actions(c) {
    const ds = await withUser(c.s, (db) => rows<{ id: string; description: string; ref: string; project_id: string; client_company_id: string }>(db,
      `select d.id, d.description, p.ref, p.id project_id, p.client_company_id from dependencies d join projects p on p.id = d.project_id
       where d.owner_side = 'client' and d.status in ('open','blocked') and d.due_date < current_date`));
    for (const d of ds) await chase(c, { key: `dep:${d.id}`, to: { clientCompanyId: d.client_company_id, role: "client_admin" }, title: `${d.ref}: please complete “${d.description}”; RGS work is waiting on it`, titleAr: `${d.ref}: يرجى إكمال «${d.description}»`, link: "/client/dependencies" });
  },
  async weekly_reports(c) {
    const ps = await listProjects(c.s);
    for (const p of ps) c.items.push({ kind: "draft", title: `Weekly report ready to send: ${p.ref}`, link: `/reports/${p.id}`, status: "proposed", payload: { action: "open" }, dedupe: `wr:${p.id}:${bucket(7)}` });
  },
  // ── Estimating & sales ──
  async inbox_triage(c) {
    const msgs = await withSystem((db) => rows<{ id: string; channel: string; from_addr: string | null; subject: string | null; body: string | null; client_company_id: string | null }>(db,
      "select id, channel, from_addr, subject, body, client_company_id from channel_messages where org_id = $1 and direction = 'in' and run_id is null order by created_at limit 10", [c.s.orgId]));
    for (const m of msgs) {
      const site = await withSystem((db) => one<{ code: string; id: string }>(db, "select code, id from sites where org_id = $1 and client_company_id is not distinct from $2 order by code limit 1", [c.s.orgId, m.client_company_id]));
      const text = `${m.subject ?? ""} ${m.body ?? ""}`;
      const code = text.match(/\b(KRN|SFN|SDR|BRG|QDY|RTM|JED|MKH|RBG)\b/)?.[0] ?? (/karan/i.test(text) ? "KRN" : /sadara|e-417/i.test(text) ? "SDR" : site?.code);
      const r = await invokeTool({ session: c.s, runId: c.runId, locale: c.s.locale }, "create_request", { site_code: code ?? "SDR", title: (m.subject || text).slice(0, 120).trim() || "Inbound enquiry", description: text.slice(0, 1500) });
      if (c.runId) await withSystem((db) => db.query("update channel_messages set run_id = $2 where id = $1", [m.id, c.runId]));
      const ref = String(r.output.ref ?? "");
      c.items.push({ kind: "triage", title: `${m.channel === "whatsapp" ? "WhatsApp" : "Email"} from ${m.from_addr ?? "unknown"} logged as ${ref || "a request"}`, body: (m.body ?? "").slice(0, 280), link: "/ops/requests", status: "done" });
      if (ref) {
        const req = await withSystem((db) => one<{ id: string; client_company_id: string }>(db, "select id, client_company_id from requests where ref = $1", [ref]));
        if (req) await recordHandoff({ orgId: c.s.orgId, clientCompanyId: req.client_company_id, chain: `request:${req.id}`, from: `${m.channel === "whatsapp" ? "WhatsApp" : "Email"} from the client`, to: c.agentName, action: `Read the message and logged ${ref}`, link: `/ops/requests/${req.id}` });
      }
    }
  },
  async price_new_requests(c) {
    const rq = await withSystem((db) => rows<{ id: string; ref: string; client_company_id: string }>(db,
      "select r.id, r.ref, r.client_company_id from requests r where r.org_id = $1 and r.status in ('new','triage') and not exists (select 1 from quotes q where q.request_id = r.id) order by r.created_at limit 5", [c.s.orgId]));
    for (const r of rq) {
      const out = await invokeTool({ session: c.s, runId: c.runId, locale: c.s.locale }, "estimate_request", { request_ref: r.ref });
      const q = await withSystem((db) => one<{ id: string; ref: string; total: string }>(db, "select id, ref, total from quotes where request_id = $1 order by created_at desc limit 1", [r.id]));
      c.items.push({ kind: q ? "draft" : "alert", title: q ? `Priced ${r.ref}: draft quote ${q.ref} (${sar(Number(q.total))}) ready to send` : `Couldn't price ${r.ref}: ${String(out.output.brief_en ?? "").slice(0, 120)}`, link: q ? `/ops/quotes/${q.id}` : `/ops/requests/${r.id}`, status: q ? "proposed" : "info", payload: q ? { action: "send_quote", quote_ref: q.ref } : {}, dedupe: `price:${r.id}` });
      if (q) await recordHandoff({ orgId: c.s.orgId, clientCompanyId: r.client_company_id, chain: `request:${r.id}`, from: c.agentName, to: c.s.fullName, action: `Took off quantities and priced ${q.ref} at ${sar(Number(q.total))}; draft waiting for review`, link: `/ops/quotes/${q.id}`, status: "waiting" });
    }
  },
  async quote_followup(c) {
    const qs = await withSystem((db) => rows<{ ref: string; id: string; client_company_id: string; total: string; days: number }>(db,
      "select ref, id, client_company_id, total, (current_date - created_at::date)::int days from quotes where org_id = $1 and status = 'sent' and created_at < now() - interval '5 days'", [c.s.orgId]));
    for (const q of qs) await chase(c, { key: `quote:${q.id}`, to: { clientCompanyId: q.client_company_id, role: "client_admin" }, title: `Quote ${q.ref} (${sar(Number(q.total))}) is waiting for your decision`, titleAr: `العرض ${q.ref} بانتظار قراركم`, link: `/client/quotes/${q.id}` });
  },
  async pipeline(c) {
    const r = await withSystem((db) => rows<{ status: string; n: number; v: number }>(db, "select status, count(*)::int n, coalesce(sum(total),0)::float8 v from quotes where org_id = $1 group by status", [c.s.orgId]));
    c.items.push({ kind: "briefing", title: "Pipeline", body: r.map((x) => `• ${x.status}: ${x.n} quote(s), ${sar(x.v)}`).join("\n"), link: "/ops/requests" });
  },
  // ── Commercial & finance ──
  async claims_ready(c) {
    const ps = await listProjects(c.s);
    for (const p of ps) {
      const pv = await withUser(c.s, (db) => claimPreview(db, p.id));
      if (pv.this_gross > 0) c.items.push({ kind: "draft", title: `${p.ref}: claim ${sar(pv.this_gross)} of newly certified work (net ${sar(pv.net)} + VAT)`, body: `Retention ${sar(pv.retention)}, advance recovery ${sar(pv.advance_recovery)}. Submitting sends it to the client to certify.`, link: "/ops/claims", status: "proposed", payload: { action: "submit_claim", projectId: p.id }, dedupe: `claim:${p.id}:${pv.gross_cumulative}` });
    }
  },
  async variations_open(c) {
    const v = await withUser(c.s, (db) => rows<{ ref: string; status: string; amount: string }>(db, "select ref, status, amount from variations where status in ('draft','submitted') order by created_at"));
    if (v.length) c.items.push({ kind: "briefing", title: `${v.length} variation(s) open`, body: v.map((x) => `• ${x.ref} ${x.status} ${sar(Number(x.amount))}`).join("\n"), link: "/ops/instructions" });
  },
  async billing_run(c) {
    const r = await invokeTool({ session: c.s, runId: c.runId, locale: c.s.locale }, "draft_invoices", {});
    c.items.push({ kind: "done", title: String(r.output.brief_en ?? "Billing run done").split("\n")[0], link: "/ops/billing", status: "done" });
  },
  async dunning(c) {
    const st = await statementOfAccount(c.s);
    for (const o of st.open.filter((x) => x.days > 0)) {
      const inv = await withSystem((db) => one<{ client_company_id: string }>(db, "select client_company_id from invoices where ref = $1", [o.ref]));
      if (inv) await chase(c, { key: `inv:${o.ref}`, to: { clientCompanyId: inv.client_company_id, role: "client_finance" }, title: `Invoice ${o.ref} (${sar(o.outstanding)}) is ${o.days} day(s) past due. If it's already paid, please share the remittance`, titleAr: `الفاتورة ${o.ref} متأخرة ${o.days} يوم`, link: "/client/statement" });
    }
  },
  // ── Quality ──
  async ncr_trends(c) {
    const r = await withUser(c.s, (db) => rows<{ kind: string; ref: string; n: number }>(db,
      "select f.kind, p.ref, count(*)::int n from findings f join projects p on p.id = f.project_id where f.created_at > now() - interval '60 days' group by f.kind, p.ref order by n desc"));
    const open = await withUser(c.s, (db) => one<{ n: number }>(db, "select count(*)::int n from findings where status in ('open','action_planned')"));
    c.items.push({ kind: "briefing", title: `Quality trend: ${open?.n ?? 0} finding(s) open`, body: r.map((x) => `• ${x.ref}: ${x.n} ${x.kind.toUpperCase()}`).join("\n") || "No findings in 60 days.", link: "/ops/findings" });
  },
  async hold_points_due(c) {
    const r = await withUser(c.s, (db) => rows<{ title: string; ref: string }>(db, "select st.title, p.ref from itp_steps st join projects p on p.id = st.project_id where st.status = 'awaiting_client' order by st.seq"));
    if (r.length) c.items.push({ kind: "alert", title: `${r.length} hold/witness point(s) waiting for the client`, body: r.map((x) => `• ${x.ref}: ${x.title}`).join("\n"), link: "/ops/inspections" });
  },
  async inspection_round(c) {
    const r = await invokeTool({ session: c.s, runId: c.runId, locale: c.s.locale }, "query_scaffolds", { due_only: true });
    c.items.push({ kind: "done", title: "Today's inspection round planned", body: String(r.output.brief_en ?? "").slice(0, 900), link: "/ops/scaffolds?due=1" });
  },
  // ── Safety & people ──
  async toolbox_talk(c) {
    const summer = [5, 6, 7, 8].includes(new Date().getMonth());
    const topic = summer ? "Heat stress" : "Working at height";
    const lines: Record<string, string> = summer ? {
      English: "Drink water every 15 minutes, rest in shade, no outdoor work 12:00–15:00. Tell your foreman at once if you feel dizzy.",
      Arabic: "اشرب الماء كل 15 دقيقة، واسترح في الظل، ولا عمل خارجي من 12:00 إلى 15:00. أخبر رئيس العمال فوراً إذا شعرت بدوار.",
      Urdu: "ہر 15 منٹ پانی پئیں، سائے میں آرام کریں، 12 سے 3 بجے تک باہر کام نہیں۔ چکر آئے تو فوراً فورمین کو بتائیں۔",
      Hindi: "हर 15 मिनट पानी पिएँ, छाँव में आराम करें, 12 से 3 बजे तक बाहर काम नहीं। चक्कर आए तो तुरंत फोरमैन को बताएँ।",
    } : {
      English: "Clip on at all times above 1.8 m, check the scaffold tag before you climb, never work on a red-tagged scaffold.",
      Arabic: "اربط الحزام دائماً فوق 1.8 م، وافحص بطاقة السقالة قبل الصعود، ولا تعمل أبداً على سقالة ببطاقة حمراء.",
      Urdu: "1.8 میٹر سے اوپر ہمیشہ ہک لگائیں، چڑھنے سے پہلے ٹیگ دیکھیں، سرخ ٹیگ والے اسکیفولڈ پر کبھی کام نہ کریں۔",
      Hindi: "1.8 मीटर से ऊपर हमेशा हुक लगाएँ, चढ़ने से पहले टैग जाँचें, लाल टैग वाले स्कैफ़ोल्ड पर कभी काम न करें।",
      Malayalam: "1.8 മീറ്ററിന് മുകളിൽ എപ്പോഴും ഹുക്ക് ഇടുക, കയറുന്നതിന് മുമ്പ് ടാഗ് പരിശോധിക്കുക, ചുവന്ന ടാഗുള്ള സ്കാഫോൾഡിൽ ഒരിക്കലും ജോലി ചെയ്യരുത്.",
      Tagalog: "Laging mag-clip sa itaas ng 1.8 m, tingnan ang tag bago umakyat, huwag magtrabaho sa scaffold na may pulang tag.",
      Bengali: "১.৮ মিটারের উপরে সবসময় হুক লাগান, ওঠার আগে ট্যাগ দেখুন, লাল ট্যাগের স্ক্যাফোল্ডে কখনো কাজ করবেন না।",
    };
    c.items.push({ kind: "draft", title: `Toolbox talk ready: ${topic} (${Object.keys(lines).length} languages)`, body: Object.entries(lines).map(([k, v]) => `${k}: ${v}`).join("\n"), link: "/ops/hse", status: "proposed", payload: { action: "acknowledge" }, dedupe: `tbt:${topic}:${bucket(1)}` });
  },
  async hse_watch(c) {
    const k = await hseKpis(c.s);
    const summer = [5, 6, 7, 8].includes(new Date().getMonth());
    c.items.push({ kind: "briefing", title: `Safety: TRIR ${k.trir.toFixed(2)}, ${k.open_hse ?? 0} open HSE finding(s)${summer ? "; midday work ban 12:00–15:00 in force" : ""}`, link: "/ops/hse" });
  },
  async cert_renewals(c) {
    const m = await bookRefreshers(c.s);
    c.items.push({ kind: "done", title: m, link: "/ops/workforce", status: "done" });
  },
  async iqama_saudization(c) {
    const w = await workforceSummary(c.s);
    const iq = await withUser(c.s, (db) => rows<{ employee_no: string; full_name: string; d: string }>(db, "select employee_no, full_name, iqama_expiry::text d from workers where iqama_expiry <= current_date + 30 and status = 'active' order by iqama_expiry"));
    c.items.push({ kind: "briefing", title: `Saudization ${w.active ? Math.round((w.saudi / w.active) * 100) : 0}% (${w.saudi}/${w.active}); ${iq.length} iqama(s) expire within 30 days`, body: iq.map((x) => `• ${x.employee_no} ${x.full_name}: ${x.d}`).join("\n"), link: "/ops/workforce" });
  },
  async reorder(c) {
    const low = await withSystem((db) => rows<{ sku: string; name: string; avail: number }>(db,
      "select i.sku, i.name, sum(st.qty - st.reserved)::float8 avail from items i join stock st on st.item_id = i.id where i.org_id = $1 and i.category in ('tube','fitting','board') group by i.sku, i.name having sum(st.qty - st.reserved) < 200 order by avail", [c.s.orgId]));
    for (const x of low) c.items.push({ kind: "draft", title: `Reorder ${x.sku} ${x.name}: ${Math.round(x.avail)} available (sample reorder level 200)`, body: `Draft PO for ${Math.max(200, 500 - Math.round(x.avail))} to the approved supplier.`, link: "/ops/fleet", status: "proposed", payload: { action: "po", sku: x.sku }, dedupe: `po:${x.sku}:${bucket(7)}` });
    if (!low.length) c.items.push({ kind: "done", title: "Stock checked: everything above reorder level", status: "done", link: "/ops/fleet" });
  },
  async dispatch_plan(c) {
    const r = await invokeTool({ session: c.s, runId: c.runId, locale: c.s.locale }, "plan_dispatch", {});
    c.items.push({ kind: "draft", title: "Tomorrow's dispatch plan drafted", body: String(r.output.brief_en ?? "").slice(0, 600), link: "/ops/fleet/dispatch", status: "proposed", payload: { action: "open" }, dedupe: `disp:${bucket(1)}` });
  },
  async site_day(c) {
    const a = await withUser(c.s, (db) => rows<{ code: string; name: string; ref: string }>(db, "select a.code, a.name, p.ref from project_areas a join projects p on p.id = a.project_id where a.status = 'in_progress' order by p.ref limit 8"));
    c.items.push({ kind: "briefing", title: `Today: ${a.length} area(s) in progress. Send your voice report when the shift ends`, body: a.map((x) => `• ${x.ref} ${x.code} ${x.name}`).join("\n"), link: "/field/report" });
  },
  async doc_reviews_overdue(c) {
    const r = await withSystem((db) => rows<{ number: string; client_company_id: string; due: string }>(db,
      "select d.number, d.client_company_id, r.due_date::text due from controlled_documents d join document_revisions r on r.controlled_document_id = d.id where d.org_id = $1 and r.review_code is null and r.submitted_at is not null and r.due_date < current_date", [c.s.orgId]));
    for (const x of r) await chase(c, { key: `doc:${x.number}`, to: { clientCompanyId: x.client_company_id, role: "client_consultant" }, title: `Review of ${x.number} was due ${x.due}; work on site depends on it`, titleAr: `مراجعة ${x.number} متأخرة`, link: "/client/docreview" });
    if (!r.length) c.items.push({ kind: "done", title: "All document reviews within their due dates", status: "done", link: "/ops/docreview" });
  },
  async access_review(c) {
    const r = await withSystem((db) => rows<{ full_name: string; role: string; mfa_enabled: boolean; last_login_at: string | null }>(db,
      "select full_name, role, mfa_enabled, last_login_at from profiles where org_id = $1 and status = 'active' and ((role in ('admin','finance') and not mfa_enabled) or last_login_at < now() - interval '30 days')", [c.s.orgId]));
    c.items.push({ kind: "briefing", title: `Access review: ${r.length} account(s) to look at`, body: r.map((x) => `• ${x.full_name} (${x.role})${!x.mfa_enabled && ["admin", "finance"].includes(x.role) ? ": no MFA" : ""}${x.last_login_at ? `, last sign-in ${x.last_login_at.slice(0, 10)}` : ""}`).join("\n"), link: "/ops/admin/people" });
  },
  // ── Client side ──
  async my_decisions(c) {
    const sos = (await listSignoffs(c.s, { status: "pending" })).filter((x) => awaitingMe(c.s, x));
    for (const so of sos) c.items.push({ kind: "alert", title: `Needs your signature: ${so.title}${so.due_date ? ` (due ${so.due_date})` : ""}`, link: `/client/signoffs#so-${so.id}`, dedupe: `so:${so.id}` });
    if (!sos.length) c.items.push({ kind: "done", title: "Nothing waiting for your signature", status: "done", link: "/client/signoffs" });
  },
  async review_queue(c) { await JOBS.my_decisions(c); },
  async client_hse_digest(c) {
    const k = await hseKpis(c.s);
    c.items.push({ kind: "briefing", title: `RGS safety on your sites: TRIR ${k.trir.toFixed(2)}, ${k.open_hse ?? 0} open HSE finding(s), ${k.talks ?? 0} toolbox talks`, link: "/client/hse" });
  },
  async claim_check(c) {
    const cl = await withUser(c.s, (db) => rows<{ ref: string; project_id: string; project_ref: string; gross_cumulative: string; status: string }>(db,
      "select c.ref, c.project_id, p.ref project_ref, c.gross_cumulative, c.status from payment_claims c join projects p on p.id = c.project_id where c.status in ('submitted','certified','invoiced') order by c.created_at desc"));
    for (const x of cl.slice(0, 5)) {
      const v = await withUser(c.s, (db) => one<{ certified: number; vos: number }>(db,
        "select coalesce((select sum(approved_qty * rate) from project_areas where project_id = $1), 0)::float8 certified, coalesce((select sum(amount) from variations where project_id = $1 and status = 'approved'), 0)::float8 vos", [x.project_id]));
      const allowed = (v?.certified ?? 0) + (v?.vos ?? 0);
      const gross = Number(x.gross_cumulative);
      const ok = gross <= allowed + 1;
      c.items.push({ kind: ok ? "done" : "alert", title: ok ? `${x.ref} (${x.project_ref}) checks out: ${sar(gross)} ≤ certified quantities and approved variations ${sar(allowed)}` : `${x.ref} (${x.project_ref}) claims ${sar(gross)} but certified + approved variations total ${sar(allowed)}: query before certifying`, link: "/client/claims", status: ok ? "done" : "info", dedupe: `cc:${x.ref}:${x.status}` });
    }
    if (!cl.length) c.items.push({ kind: "done", title: "No claims to check", status: "done", link: "/client/claims" });
  },
  async exec_digest(c) {
    const ps = await listProjects(c.s);
    const st = await statementOfAccount(c.s, c.s.clientCompanyId ?? undefined);
    c.items.push({ kind: "briefing", title: `Portfolio: ${ps.length} project(s), average progress ${ps.length ? Math.round(ps.reduce((t, p) => t + p.stage_pct, 0) / ps.length) : 0}%, ${sar(st.total_outstanding)} outstanding to RGS`,
      body: ps.map((p) => `• ${p.ref} ${p.name.split(" · ")[0]}: ${Math.round(p.stage_pct)}%${p.overdue_milestones ? `, ${p.overdue_milestones} milestone(s) slipping` : ""}`).join("\n"), link: "/client/projects" });
  },
  async my_requests(c) {
    const r = await withUser(c.s, (db) => rows<{ ref: string; title: string; status: string }>(db, "select ref, title, status from requests order by created_at desc limit 8"));
    c.items.push({ kind: "briefing", title: `${r.length} recent request(s)`, body: r.map((x) => `• ${x.ref} ${x.title}: ${x.status}`).join("\n"), link: "/client/requests" });
  },
};

const due = (schedule: string, last: string | null) => {
  if (!last) return true;
  const l = new Date(last), now = new Date();
  if (schedule === "daily") return now.toDateString() !== l.toDateString();
  const [k, v] = schedule.split(":");
  if (now.getTime() - l.getTime() < 20 * 3600_000) return false;
  if (k === "weekly") return now.getDay() === Number(v);
  if (k === "monthly") return now.getDate() === Number(v);
  return false;
};

export async function ensureAgent(s: Session) {
  return withSystem(async (db) => {
    let a = await one<{ name: string; persona: string; autonomy: "drafts" | "routine"; paused: boolean; last_cycle_at: string | null }>(db, "select name, persona, autonomy, paused, last_cycle_at from personal_agents where profile_id = $1", [s.id]);
    if (!a) {
      const pos = POSITION[s.position] ?? POSITION.ops_manager;
      await db.query("insert into personal_agents (profile_id, org_id, client_company_id, name, persona) values ($1,$2,$3,$4,$5) on conflict do nothing", [s.id, s.orgId, s.clientCompanyId, `${s.fullName.split(" ")[0]}'s ${pos.agent}`, pos.key]);
      for (const j of pos.jobs) await db.query("insert into agent_jobs (org_id, profile_id, job, label, schedule) values ($1,$2,$3,$4,$5) on conflict do nothing", [s.orgId, s.id, j.job, j.label, j.schedule]);
      a = await one(db, "select name, persona, autonomy, paused, last_cycle_at from personal_agents where profile_id = $1", [s.id]);
    }
    return a!;
  });
}

/** Run one person's agent: due jobs (or all when forced), then a briefing that sums up the cycle. */
export async function runAgentCycle(profileId: string, opts: { force?: boolean } = {}) {
  const s = await getSessionById(profileId);
  if (!s) return { ran: 0, items: 0 };
  const a = await ensureAgent(s);
  if (a.paused) return { ran: 0, items: 0, paused: true };
  const jobs = await withSystem((db) => rows<{ id: string; job: string; label: string; schedule: string; last_run_at: string | null }>(db, "select id, job, label, schedule, last_run_at from agent_jobs where profile_id = $1 and enabled order by job", [s.id]));
  const run = await withSystem((db) => one<{ id: string }>(db, "insert into agent_runs (org_id, client_company_id, user_id, agent, channel, status, input, mode) values ($1,$2,$3,'briefing','cron','running',$4,'mock') returning id",
    [s.orgId, s.clientCompanyId, s.id, JSON.stringify({ text: `${a.name}: scheduled cycle` })])).catch(() => null);
  const c: Ctx = { s, agentName: a.name, autonomy: a.autonomy, items: [], runId: run?.id ?? null };
  let ran = 0;
  for (const j of jobs) {
    if (!opts.force && !due(j.schedule, j.last_run_at)) continue;
    const fn = JOBS[j.job];
    if (!fn) continue;
    const before = c.items.length;
    try { await fn(c); } catch (e) { console.error(`[agent ${j.job}]`, e); c.items.push({ kind: "alert", title: `${j.label} could not run; the team has the error`, status: "info" }); }
    for (const it of c.items.slice(before)) it.job = j.job;
    await withSystem((db) => db.query("update agent_jobs set last_run_at = now() where id = $1", [j.id]));
    ran++;
  }
  // In "drafts" mode, nothing counts as done on its own: done items become proposals for the owner.
  if (c.autonomy === "drafts") for (const it of c.items) if (it.kind === "done") { it.kind = "draft"; it.status = "proposed"; }
  const counts = { alerts: c.items.filter((i) => i.kind === "alert").length, drafts: c.items.filter((i) => i.status === "proposed").length, done: c.items.filter((i) => i.kind === "done" || i.kind === "triage").length, chased: c.items.filter((i) => i.kind === "chase").length };
  if (ran) c.items.unshift({ kind: "briefing", job: "briefing", title: `${greeting()}: ${counts.alerts} to look at, ${counts.drafts} draft(s) for your OK, ${counts.done} done for you, ${counts.chased} chased`, link: `${base(s)}/agent`, status: "info" });
  let stored = 0;
  await withSystem(async (db: Db) => {
    for (const it of c.items) {
      const r = await db.query(`insert into agent_inbox (org_id, client_company_id, profile_id, job, kind, title, body, link, payload, status, dedupe_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
        [s.orgId, s.clientCompanyId, s.id, it.job ?? null, it.kind, it.title.slice(0, 300), it.body?.slice(0, 4000) ?? null, it.link ?? null, JSON.stringify(it.payload ?? {}), it.status ?? (it.kind === "draft" ? "proposed" : "info"), it.dedupe ?? null]);
      stored += r.rowCount ?? 0;
    }
    await db.query("update personal_agents set last_cycle_at = now() where profile_id = $1", [s.id]);
    if (run) await db.query("update agent_runs set status = 'completed', completed_at = now(), output = $2 where id = $1", [run.id, JSON.stringify({ summary: `${ran} job(s), ${stored} item(s)`, reply: c.items[0]?.title ?? "" })]);
  });
  return { ran, items: stored };
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Every active person's agent (cron). */
export async function runAllAgents() {
  const ps = await withSystem((db) => rows<{ id: string }>(db, "select p.id from profiles p left join personal_agents a on a.profile_id = p.id where p.status = 'active' and coalesce(a.paused, false) = false"));
  let ran = 0, items = 0;
  for (const p of ps) { const r = await runAgentCycle(p.id); ran += r.ran; items += r.items; }
  return { people: ps.length, jobs: ran, items, summary: `${ps.length} agents ran ${ran} job(s) and produced ${items} item(s).` };
}

/** The owner approves or dismisses what their agent proposed. Approving carries out the action. */
export async function decideInboxItem(s: Session, id: string, decision: "approve" | "dismiss") {
  const it = await withSystem((db) => one<{ id: string; profile_id: string; status: string; payload: { action?: string; quote_ref?: string; projectId?: string }; title: string; link: string | null }>(db,
    "select id, profile_id, status, payload, title, link from agent_inbox where id = $1", [id]));
  if (!it || it.profile_id !== s.id) throw new Error("Not found");
  if (it.status !== "proposed") return { message: "Already handled.", link: it.link };
  let message = "Done.";
  if (decision === "approve") {
    const p = it.payload ?? {};
    if (p.action === "send_quote" && p.quote_ref) {
      const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "send_quote", { quote_ref: p.quote_ref });
      message = String(r.output.brief_en ?? "");
      const q = await withSystem((db) => one<{ id: string; request_id: string | null; client_company_id: string; total: string }>(db, "select id, request_id, client_company_id, total from quotes where ref = $1", [p.quote_ref]));
      if (q?.request_id) await recordHandoff({ orgId: s.orgId, clientCompanyId: q.client_company_id, chain: `request:${q.request_id}`, from: s.fullName, to: r.kind === "approval" ? `Approver within limit (${(r.output.approver_positions as string[] | undefined)?.map((x) => POSITION[x]?.en ?? x).filter((x) => !/Client/.test(x)).join(" / ") || "manager"})` : "Client", action: r.kind === "approval" ? `Asked to send ${p.quote_ref} (${sar(Number(q.total))}); above the estimator's authority, so it went for approval` : `Sent ${p.quote_ref}`, link: "/ops/approvals", status: r.kind === "approval" ? "waiting" : "done" });
    } else if (p.action === "submit_claim" && p.projectId) {
      message = await submitClaim(s, p.projectId);
    } else message = `Noted: ${it.title}`;
  }
  await withSystem((db) => db.query("update agent_inbox set status = $2, decided_at = now() where id = $1", [id, decision === "approve" ? "approved" : "dismissed"]));
  return { message, link: it.link };
}
