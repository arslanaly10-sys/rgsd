import "server-only";
import { z } from "zod";
import type { Session } from "@/lib/auth";
import { one, rows, withSystem, withUser } from "@/lib/db";
import { daysUntil, fmtNum, fmtSAR } from "@/lib/format";
import { estimateRequest } from "@/lib/workflows/estimate";
import { executeDispatchPlan, planDispatch, reconcile } from "@/lib/fleet";
import { draftInvoices, issueInvoice } from "@/lib/billing";
import { activeRates, price, SCAFFOLD_TYPES, Scope, takeoff } from "@/lib/estimating";
import { expiries, onHireBySite, opsKpis, scaffolds, siteSummaries, stockByYard } from "@/lib/queries";

/** runId is null when an action starts from the interface rather than from an agent run. */
export type ToolCtx = { session: Session; runId: string | null; locale: "en" | "ar" };
export type ToolOutput = { brief_en: string; brief_ar: string; [k: string]: unknown };

type ToolDef<S extends z.ZodObject> = {
  name: string;
  description: string;
  schema: S;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<ToolOutput>;
};

const def = <S extends z.ZodObject>(t: ToolDef<S>) => t;
const actor = (ctx: ToolCtx) => ({ id: ctx.session.id, actorKind: "agent" as const, runId: ctx.runId ?? undefined });

const siteCode = z.string().regex(/^[A-Z]{3}$/).describe("Three-letter site code, e.g. SDR, KRN, BRG").optional();

async function resolveSite(ctx: ToolCtx, code?: string) {
  if (!code) return undefined;
  // Read as the user: a client can only resolve their own sites.
  return withUser(actor(ctx), (db) =>
    one<{ id: string; code: string; name: string; name_ar: string | null; client_company_id: string; type: string }>(db, "select id, code, name, name_ar, client_company_id, type from sites where code = $1", [code]),
  );
}

const certAr: Record<string, string> = { cisrs: "بطاقة CISRS", citb: "CITB", opito_bosiet: "OPITO BOSIET", tuv_scaffold: "TÜV سقالات", aramco_id: "هوية أرامكو", aramco_scaffold_card: "بطاقة سقالات أرامكو", first_aid: "الإسعافات الأولية", working_at_height: "العمل على المرتفعات", h2s: "كبريتيد الهيدروجين", rigging: "الرفع", driving_licence: "رخصة القيادة", iqama: "الإقامة" };
const tagAr: Record<string, string> = { green: "أخضر", yellow: "أصفر", red: "أحمر", erecting: "قيد التركيب", dismantled: "مفككة" };

// ───────────────────────── T0: read ─────────────────────────

const query_scaffolds = def({
  name: "query_scaffolds",
  description: "List scaffolds with tag status, location and next 7-day inspection date. Filter by site, tag colour, or only those due/overdue.",
  schema: z.object({ site_code: siteCode, status: z.enum(["green", "yellow", "red", "erecting", "dismantled"]).optional(), due_only: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }),
  async run(ctx, i) {
    const list = await scaffolds(ctx.session, { site: i.site_code, status: i.status, due: i.due_only });
    const top = list.slice(0, i.limit ?? 12);
    const items = top.map((s) => ({ tag: s.tag_no, site: s.site_code, status: s.status, location: s.location_desc, restrictions: s.restrictions, next_due: s.next_inspection_due, days_to_due: daysUntil(s.next_inspection_due), open_defects: s.open_defects }));
    const what = [i.status ? `${i.status}-tagged` : "", i.due_only ? "due or overdue" : ""].filter(Boolean).join(", ") || "matching";
    const lineEn = (x: (typeof items)[number]) => `• ${x.tag} (${x.site}) ${x.status}: ${x.location}${x.days_to_due != null && ["green", "yellow"].includes(x.status) ? (x.days_to_due < 0 ? `, overdue ${-x.days_to_due} d` : `, due in ${x.days_to_due} d`) : ""}${x.open_defects ? `, ${x.open_defects} open defect(s)` : ""}`;
    const lineAr = (x: (typeof items)[number]) => `• ${x.tag} (${x.site}) ${tagAr[x.status] ?? x.status}: ${x.location}${x.days_to_due != null && ["green", "yellow"].includes(x.status) ? (x.days_to_due < 0 ? `، متأخر ${-x.days_to_due} يوم` : `، مستحق خلال ${x.days_to_due} يوم`) : ""}`;
    return {
      total: list.length,
      scaffolds: items,
      brief_en: list.length ? `${list.length} ${what} scaffold(s)${i.site_code ? ` at ${i.site_code}` : ""}.\n${items.map(lineEn).join("\n")}${list.length > items.length ? `\n…and ${list.length - items.length} more in the register.` : ""}` : `No ${what} scaffolds${i.site_code ? ` at ${i.site_code}` : ""}.`,
      brief_ar: list.length ? `عدد السقالات: ${list.length}${i.site_code ? ` في ${i.site_code}` : ""}.\n${items.map(lineAr).join("\n")}` : `لا توجد سقالات مطابقة${i.site_code ? ` في ${i.site_code}` : ""}.`,
    };
  },
});

const get_site_status = def({
  name: "get_site_status",
  description: "Live status of one site: tag mix, inspections due, material on hire per day, crew size and access requirements.",
  schema: z.object({ site_code: z.string().regex(/^[A-Z]{3}$/) }),
  async run(ctx, i) {
    const s = (await siteSummaries(ctx.session)).find((x) => x.code === i.site_code);
    const site = await resolveSite(ctx, i.site_code);
    if (!s || !site) return { error: "site_not_found", brief_en: `I can't find site ${i.site_code} in your access.`, brief_ar: `لا أجد الموقع ${i.site_code} ضمن صلاحياتك.` };
    const access = await withUser(actor(ctx), (db) => one<{ access_requirements: string | null }>(db, "select access_requirements from sites where id = $1", [site.id]));
    return {
      site: s,
      access_requirements: access?.access_requirements,
      brief_en: `${s.code} · ${s.name}: ${s.green} green, ${s.yellow} yellow, ${s.red} red; ${s.due} inspection(s) due. On hire ${fmtSAR(s.onhire_day, "en")}/day, crew ${s.crew}.${access?.access_requirements ? `\nAccess: ${access.access_requirements}` : ""}`,
      brief_ar: `${s.code} · ${s.name_ar ?? s.name}: ${s.green} أخضر، ${s.yellow} أصفر، ${s.red} أحمر؛ ${s.due} فحص مستحق. الإيجار ${fmtSAR(s.onhire_day, "ar")} يومياً، الطاقم ${s.crew}.`,
    };
  },
});

const search_knowledge = def({
  name: "search_knowledge",
  description: "Search RGS procedures, method statements, client specs, estimating rules and lessons learned. Returns excerpts with their source title to cite.",
  schema: z.object({ query: z.string().min(2).max(300) }),
  async run(ctx, i) {
    const words = i.query.toLowerCase().match(/[\p{L}\d]{3,}/gu)?.slice(0, 8) ?? [];
    const hits = await withUser(actor(ctx), (db) =>
      rows<{ title: string; heading: string | null; content: string; rank: number }>(
        db,
        `select d.title, c.heading, c.content,
                ts_rank(c.tsv, to_tsquery('simple', $1)) + (select count(*) from unnest($2::text[]) w where c.content ilike '%'||w||'%' or c.heading ilike '%'||w||'%') * 0.1 rank
         from kb_chunks c join kb_documents d on d.id = c.kb_document_id
         where c.tsv @@ to_tsquery('simple', $1) or exists (select 1 from unnest($2::text[]) w where c.content ilike '%'||w||'%' or c.heading ilike '%'||w||'%')
         order by rank desc limit 4`,
        [words.length ? words.join(" | ") : "scaffold", words],
      ),
    );
    // Lessons learned from incidents (staff only via RLS).
    const lessons = ctx.session.isStaff
      ? await withUser(actor(ctx), (db) => rows<{ title: string; lessons: string }>(db, `select title, lessons from incidents where lessons is not null and exists (select 1 from unnest($1::text[]) w where lessons ilike '%'||w||'%' or title ilike '%'||w||'%' or array_to_string(tags,' ') ilike '%'||w||'%') limit 2`, [words]))
      : [];
    if (!hits.length && !lessons.length) return { results: [], brief_en: "I found nothing in the knowledge base for that. Try other words, or ask HSE to add the procedure.", brief_ar: "لم أجد شيئاً في قاعدة المعرفة. جرّب كلمات أخرى." };
    const cite = hits.map((h) => `• ${h.heading ? `${h.heading}: ` : ""}${h.content}\n  — ${h.title}`);
    const les = lessons.map((x) => `• Lesson learned (${x.title}): ${x.lessons}`);
    return { results: hits, lessons, brief_en: [...cite, ...les].join("\n"), brief_ar: [...cite, ...les].join("\n") };
  },
});

const list_expiring = def({
  name: "list_expiring",
  description: "Workers whose certificates (CISRS, Aramco card, BOSIET, H2S, first aid…) or iqamas expire within N days, optionally at one site.",
  schema: z.object({ within_days: z.number().int().min(0).max(365).optional(), site_code: siteCode }),
  async run(ctx, i) {
    const list = (await expiries(ctx.session, i.within_days ?? 30)).filter((x) => !i.site_code || x.site_code === i.site_code);
    const expired = list.filter((x) => (daysUntil(x.expires_on) ?? 0) < 0).length;
    const lines = list.slice(0, 12).map((x) => { const d = daysUntil(x.expires_on) ?? 0; return `• ${x.full_name} (${x.employee_no}, ${x.site_code ?? "no site"}): ${x.kind.replace(/_/g, " ")} ${d < 0 ? `expired ${-d} d ago` : `expires in ${d} d`}`; });
    const linesAr = list.slice(0, 12).map((x) => { const d = daysUntil(x.expires_on) ?? 0; return `• ${x.full_name} (${x.employee_no}، ${x.site_code ?? "بلا موقع"}): ${certAr[x.kind] ?? x.kind} ${d < 0 ? `انتهت قبل ${-d} يوم` : `تنتهي خلال ${d} يوم`}`; });
    return {
      total: list.length, expired, items: list.slice(0, 30),
      brief_en: list.length ? `${list.length} certificate(s)/iqama(s) expire within ${i.within_days ?? 30} days${i.site_code ? ` at ${i.site_code}` : ""}; ${expired} already expired. Workers with expired site-critical cards should not be on site.\n${lines.join("\n")}` : "Nothing expiring in that window.",
      brief_ar: list.length ? `${list.length} شهادة/إقامة تنتهي خلال ${i.within_days ?? 30} يوماً، منها ${expired} منتهية بالفعل.\n${linesAr.join("\n")}` : "لا يوجد شيء ينتهي في هذه الفترة.",
    };
  },
});

const stock_check = def({
  name: "stock_check",
  description: "Yard stock (Dammam, Jubail) and quantity on hire per catalog item. Filter by SKU or words like 'boards', 'couplers'.",
  schema: z.object({ sku: z.string().optional(), query: z.string().optional() }),
  async run(ctx, i) {
    const all = await stockByYard(ctx.session);
    const q = (i.query ?? "").toLowerCase();
    const cat = /board|لوح/.test(q) ? "board" : /coupler|fitting|وصل/.test(q) ? "fitting" : /tube|أنبوب/.test(q) ? "tube" : /cuplock|ringlock|system/.test(q) ? "system" : null;
    const list = all.filter((x) => (i.sku ? x.sku === i.sku : cat ? x.category === cat : true));
    const low = list.filter((x) => Number(x.jubail) < 300 && ["board", "fitting"].includes(x.category));
    const lines = list.slice(0, 12).map((x) => `• ${x.sku} ${x.name}: Dammam ${fmtNum(x.dammam, "en")}, Jubail ${fmtNum(x.jubail, "en")}, on hire ${fmtNum(x.on_hire, "en")}`);
    return {
      items: list, low_at_jubail: low.map((x) => x.sku),
      brief_en: `${lines.join("\n")}${low.length ? `\nLow at Jubail: ${low.map((x) => x.sku).join(", ")}. Consider a transfer from Dammam before the Sadara turnaround.` : ""}`,
      brief_ar: `${lines.join("\n")}${low.length ? `\nمخزون منخفض في الجبيل: ${low.map((x) => x.sku).join("، ")}.` : ""}`,
    };
  },
});

const onhire_summary = def({
  name: "onhire_summary",
  description: "Material on hire per site with daily rental value and off-hire requests waiting for collection.",
  schema: z.object({ site_code: siteCode }),
  async run(ctx, i) {
    const list = (await onHireBySite(ctx.session)).filter((x) => !i.site_code || x.site_code === i.site_code);
    const perDay = list.reduce((a, x) => a + Number(x.qty) * Number(x.rate_day), 0);
    const waiting = list.filter((x) => x.status === "off_hire_requested");
    const lines = list.slice(0, 12).map((x) => `• ${x.site_code} ${x.item} × ${fmtNum(x.qty, "en")}${x.status === "off_hire_requested" ? " (off-hire requested, not yet collected)" : ""}`);
    return {
      lines: list.length, per_day: perDay, waiting_collection: waiting.length,
      brief_en: `${list.length} line(s) on hire${i.site_code ? ` at ${i.site_code}` : ""}, ${fmtSAR(perDay, "en")} per day.${waiting.length ? ` ${waiting.length} off-hire request(s) still waiting for collection; rental keeps running until collected.` : ""}\n${lines.join("\n")}`,
      brief_ar: `${list.length} بند مؤجر${i.site_code ? ` في ${i.site_code}` : ""}، بقيمة ${fmtSAR(perDay, "ar")} يومياً.${waiting.length ? ` ${waiting.length} طلب إنهاء إيجار بانتظار الاستلام.` : ""}`,
    };
  },
});

const daily_brief = def({
  name: "daily_brief",
  description: "Management brief: inspections due, red tags, rental value, unbilled rental, expiring certificates and open requests, with the top risks.",
  schema: z.object({}),
  async run(ctx) {
    const k = (await opsKpis(ctx.session))!;
    const sites = await siteSummaries(ctx.session);
    const worst = [...sites].sort((a, b) => b.red * 3 + b.due - (a.red * 3 + a.due))[0];
    const en = [
      `Today across ${k.sites} active site(s):`,
      `• ${k.due} inspection(s) due or overdue, ${k.red} red tag(s), ${k.yellow} yellow (restricted).`,
      `• On hire ${fmtSAR(k.onhire_day, "en")}/day. Unbilled rental since last invoice ≈ ${fmtSAR(k.unbilled, "en")}.`,
      ctx.session.isStaff ? `• ${k.expiring} certificate(s)/iqama(s) expire within 30 days. ${k.open_requests} open request(s).` : "",
      worst ? `Top risk: ${worst.code} (${worst.red} red, ${worst.due} due). Clear overdue inspections there first.` : "",
    ].filter(Boolean).join("\n");
    const ar = [
      `اليوم في ${k.sites} موقع نشط:`,
      `• ${k.due} فحص مستحق أو متأخر، ${k.red} بطاقة حمراء، ${k.yellow} صفراء.`,
      `• قيمة الإيجار ${fmtSAR(k.onhire_day, "ar")} يومياً. الإيجار غير المفوتر ≈ ${fmtSAR(k.unbilled, "ar")}.`,
      ctx.session.isStaff ? `• ${k.expiring} شهادة/إقامة تنتهي خلال 30 يوماً. ${k.open_requests} طلب مفتوح.` : "",
      worst ? `أعلى خطر: ${worst.code} (${worst.red} حمراء، ${worst.due} مستحقة).` : "",
    ].filter(Boolean).join("\n");
    return { kpis: k, brief_en: en, brief_ar: ar };
  },
});

// ───────────────────────── T1: low-risk writes ─────────────────────────

const create_task = def({
  name: "create_task",
  description: "Create a task or reminder for a person or role, with a due date.",
  schema: z.object({ title: z.string().min(3).max(200), due_in_days: z.number().int().min(0).max(90).optional(), assignee_role: z.string().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() }),
  async run(ctx, i) {
    const t = await withUser(actor(ctx), (db) =>
      one<{ id: string; due_date: string }>(db, `insert into tasks (org_id, title, assignee_role, assignee_id, due_date, priority, source) values ($1,$2,$3,$4, current_date + $5::int, $6, 'agent') returning id, due_date`,
        [ctx.session.orgId, i.title, i.assignee_role ?? null, i.assignee_role ? null : ctx.session.id, i.due_in_days ?? 1, i.priority ?? "normal"]),
    );
    return { task_id: t!.id, brief_en: `Task created: “${i.title}”, due in ${i.due_in_days ?? 1} day(s).`, brief_ar: `تم إنشاء مهمة: «${i.title}»، مستحقة خلال ${i.due_in_days ?? 1} يوم.` };
  },
});

const remember = def({
  name: "remember",
  description: "Save a fact the agents should remember for a client or site (rules, contacts, preferences). Do not store personal data.",
  schema: z.object({ content: z.string().min(5).max(500), site_code: siteCode }),
  async run(ctx, i) {
    const site = await resolveSite(ctx, i.site_code);
    await withUser(actor(ctx), (db) =>
      db.query("insert into memories (org_id, scope, scope_id, client_company_id, content, source, created_by) values ($1,$2,$3,$4,$5,'agent',$6)",
        [ctx.session.orgId, site ? "site" : "org", site?.id ?? null, site?.client_company_id ?? null, i.content, ctx.session.id]),
    );
    return { brief_en: `Saved to ${site ? `${site.code} site` : "company"} memory.`, brief_ar: `تم الحفظ في ذاكرة ${site ? `موقع ${site.code}` : "الشركة"}.` };
  },
});

const create_request = def({
  name: "create_request",
  description: "Log a client scaffold request (scope, site, needed-by date) so the estimating team picks it up.",
  schema: z.object({ site_code: siteCode, title: z.string().min(3).max(200), description: z.string().max(2000).optional(), scaffold_type: z.string().optional(), required_in_days: z.number().int().min(0).max(365).optional() }),
  async run(ctx, i) {
    const site = await resolveSite(ctx, i.site_code);
    const clientId = ctx.session.clientCompanyId ?? site?.client_company_id;
    if (!clientId) return { error: "need_site", brief_en: "Which site is this for? Tell me the site code (for example SDR or KRN).", brief_ar: "لأي موقع هذا الطلب؟ أخبرني برمز الموقع." };
    const ref = await withSystem((db) => one<{ ref: string }>(db, `select 'RQ-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from requests where org_id = $1`, [ctx.session.orgId]));
    await withUser(actor(ctx), (db) =>
      db.query(`insert into requests (org_id, client_company_id, site_id, ref, source, title, description, scaffold_type, required_by, priority, created_by)
                values ($1,$2,$3,$4,'portal',$5,$6,$7, current_date + $8::int, 'normal', $9)`,
        [ctx.session.orgId, clientId, site?.id ?? null, ref!.ref, i.title, i.description ?? null, i.scaffold_type ?? null, i.required_in_days ?? 7, ctx.session.id]),
    );
    return { ref: ref!.ref, brief_en: `Request ${ref!.ref} logged${site ? ` for ${site.code}` : ""}. An RGS estimator will confirm a firm quote.`, brief_ar: `تم تسجيل الطلب ${ref!.ref}${site ? ` للموقع ${site.code}` : ""}. سيؤكد مقدّر RGS العرض النهائي.` };
  },
});

const indicative_quote = def({
  name: "indicative_quote",
  description: "Instant indicative price for a scaffold from dimensions, type and hire weeks, using the active rate card. Not binding; an estimator confirms the firm quote.",
  schema: z.object({
    scaffold_type: z.string(), length_m: z.number().positive().max(500), width_m: z.number().positive().max(50), height_m: z.number().positive().max(200),
    weeks: z.number().int().min(1).max(104), offshore: z.boolean().optional(), site_code: siteCode,
  }),
  async run(ctx, i) {
    // Rates are internal (RLS hides them from clients): the engine reads them as the system and only the computed price is returned.
    const scope = Scope.parse({
      items: [{ description: `${i.scaffold_type.replace(/_/g, " ")} ${i.length_m}×${i.width_m}×${i.height_m} m`, scaffold_type: (SCAFFOLD_TYPES as readonly string[]).includes(i.scaffold_type) ? i.scaffold_type : "tube_coupler", length_m: i.length_m, width_m: i.width_m, height_m: i.height_m }],
      hire_weeks: i.weeks, offshore: !!i.offshore, site_code: i.site_code, confidence: 0.5,
    });
    const to = await takeoff(ctx.session.orgId, scope);
    const p = price(scope, to, await activeRates(ctx.session.orgId));
    const linesEn = p.lines.map((l) => `• ${l.description}: ${l.unit === "lot" ? "" : `${fmtNum(l.qty, "en", 1)} ${l.unit} → `}${fmtSAR(l.amount, "en")}`).join("\n");
    const linesAr = p.lines.map((l) => `• ${l.description_ar}: ${fmtSAR(l.amount, "ar")}`).join("\n");
    return {
      indicative: true, sample_rates: true, volume_m3: to.volume_m3, weight_kg: to.total_weight_kg, lines: p.lines, subtotal: p.subtotal, vat: p.vat, total: p.total,
      brief_en: `Indicative price for ${i.scaffold_type.replace(/_/g, " ")} ${i.length_m} × ${i.width_m} × ${i.height_m} m (${to.volume_m3} m³, about ${fmtNum(to.total_weight_kg / 1000, "en", 1)} t of material) for ${i.weeks} week(s)${i.offshore ? ", offshore" : ""}:\n${linesEn}\nSubtotal ${fmtSAR(p.subtotal, "en")} + VAT 15% ${fmtSAR(p.vat, "en")} = **${fmtSAR(p.total, "en")}**.\nIndicative only, based on SAMPLE rates. An RGS estimator confirms the firm quote after checking drawings and access.`,
      brief_ar: `سعر مبدئي لسقالة ${i.length_m} × ${i.width_m} × ${i.height_m} م (${to.volume_m3} م³) لمدة ${i.weeks} أسبوع${i.offshore ? "، بحري" : ""}:\n${linesAr}\nالمجموع ${fmtSAR(p.subtotal, "ar")} + ضريبة 15% ${fmtSAR(p.vat, "ar")} = **${fmtSAR(p.total, "ar")}**.\nسعر مبدئي بأسعار تجريبية. يؤكد المقدّر العرض النهائي بعد مراجعة المخططات.`,
    };
  },
});

// ───────────────────────── T2 / T3: business, money, safety, client-facing ─────────────────────────

const request_off_hire = def({
  name: "request_off_hire",
  description: "Request collection of material from a site (stops rental once collected). Optionally one SKU only.",
  schema: z.object({ site_code: z.string().regex(/^[A-Z]{3}$/), sku: z.string().optional(), note: z.string().max(500).optional() }),
  async run(ctx, i) {
    const site = await resolveSite(ctx, i.site_code);
    if (!site) return { error: "site_not_found", brief_en: `Site ${i.site_code} is not in your access.`, brief_ar: `الموقع ${i.site_code} ليس ضمن صلاحياتك.` };
    const n = await withSystem(async (db) => {
      const r = await db.query(`update on_hire set status='off_hire_requested', off_hire_requested_at = now()
                                where site_id = $1 and status = 'on_hire' and ($2::text is null or item_id = (select id from items where sku = $2 and org_id = on_hire.org_id))`, [site.id, i.sku ?? null]);
      await db.query(`insert into tasks (org_id, client_company_id, title, title_ar, assignee_role, due_date, priority, source, entity_type, entity_id)
                      values ($1,$2,$3,$4,'yard_logistics', current_date + 2, 'high', 'agent', 'site', $5)`,
        [ctx.session.orgId, site.client_company_id, `Collect off-hired material from ${site.code}${i.sku ? ` (${i.sku})` : ""}`, `استلام المواد المنتهي إيجارها من ${site.code}`, site.id]);
      return r.rowCount ?? 0;
    }, { runId: ctx.runId ?? undefined, actorId: ctx.session.id });
    return { lines_updated: n, brief_en: `Off-hire requested for ${n} line(s) at ${site.code}. Yard & Logistics has a collection task due in 2 days.`, brief_ar: `تم طلب إنهاء الإيجار لـ ${n} بند في ${site.code}. لدى فريق الساحة مهمة استلام خلال يومين.` };
  },
});

const send_quote = def({
  name: "send_quote",
  description: "Send a prepared quote to the client (email/portal). Always requires approval.",
  schema: z.object({ quote_ref: z.string().regex(/^QT-\d{2}-\d{4}$/) }),
  async run(ctx, i) {
    const q = await withUser(actor(ctx), (db) => one<{ id: string; status: string; client_company_id: string; total: string }>(db, "select id, status, client_company_id, total from quotes where ref = $1 order by version desc limit 1", [i.quote_ref]));
    if (!q) return { error: "not_found", brief_en: `Quote ${i.quote_ref} not found.`, brief_ar: `العرض ${i.quote_ref} غير موجود.` };
    await withSystem(async (db) => {
      await db.query("update quotes set status='sent', approved_by = coalesce(approved_by, $2) where id = $1", [q.id, ctx.session.id]);
      await db.query("update requests set status='quoted' where id = (select request_id from quotes where id = $1) and status in ('new','triage','estimating')", [q.id]);
      await db.query("insert into channel_messages (org_id, client_company_id, channel, direction, subject, body) values ($1,$2,'email','out',$3,$4)",
        [ctx.session.orgId, q.client_company_id, `Quotation ${i.quote_ref}`, `Please find quotation ${i.quote_ref} (total ${fmtSAR(q.total, "en", 2)}) in your RGS portal.`]);
    }, { runId: ctx.runId ?? undefined, actorId: ctx.session.id });
    return { brief_en: `Quote ${i.quote_ref} sent to the client and visible in their portal.`, brief_ar: `تم إرسال العرض ${i.quote_ref} إلى العميل.` };
  },
});

const set_tag_status = def({
  name: "set_tag_status",
  description: "Change a scaffold's tag (green / yellow with restriction / red). Needs a competent inspector's approval; red-tag clearance is never automatic.",
  schema: z.object({ tag_no: z.string().regex(/^[A-Z]{3}-\d{4}$/), status: z.enum(["green", "yellow", "red"]), restrictions: z.string().max(300).optional(), reason: z.string().max(500).optional() }),
  async run(ctx, i) {
    const s = await withUser(actor(ctx), (db) => one<{ id: string; status: string }>(db, "select id, status from scaffolds where tag_no = $1", [i.tag_no]));
    if (!s) return { error: "not_found", brief_en: `Scaffold ${i.tag_no} not found.`, brief_ar: `السقالة ${i.tag_no} غير موجودة.` };
    await withSystem((db) => db.query(
      `update scaffolds set status = $2, restrictions = $3, last_inspected_at = case when $2 = 'green' then now() else last_inspected_at end,
              next_inspection_due = case when $2 in ('green','yellow') then current_date + 7 else next_inspection_due end where id = $1`,
      [s.id, i.status, i.status === "yellow" ? i.restrictions ?? "Restricted use, see tag" : null]), { runId: ctx.runId ?? undefined, actorId: ctx.session.id });
    return { from: s.status, to: i.status, brief_en: `${i.tag_no} changed from ${s.status} to ${i.status}. Next inspection due in 7 days.`, brief_ar: `تم تغيير ${i.tag_no} من ${tagAr[s.status]} إلى ${tagAr[i.status]}.` };
  },
});

const estimate_request = def({
  name: "estimate_request",
  description: "Run the Estimator workflow on a logged request: read its RFQ/drawings, extract scope, do the material take-off and stock check, price it and save a DRAFT quote for an estimator to review. Does not send anything to the client.",
  schema: z.object({ request_ref: z.string().regex(/^RQ-\d{2}-\d{4}$/) }),
  async run(ctx, i) {
    const r = await withUser(actor(ctx), (db) => one<{ id: string }>(db, "select id from requests where ref = $1", [i.request_ref]));
    if (!r) return { error: "not_found", brief_en: `Request ${i.request_ref} not found.`, brief_ar: `الطلب ${i.request_ref} غير موجود.` };
    const res = await estimateRequest(ctx.session.orgId, r.id, ctx.session.id);
    if (!res.quote) return { error: "workflow_failed", detail: res.error, brief_en: `The estimate for ${i.request_ref} stopped: ${res.error ?? res.status}. It will retry automatically.`, brief_ar: `توقف التسعير للطلب ${i.request_ref} وسيُعاد تلقائياً.` };
    const q = await withUser(actor(ctx), (db) => one<{ questions: string[]; ai_confidence: string }>(db, "select questions, ai_confidence from quotes where id = $1", [res.quote!.quoteId]));
    const qs = q?.questions ?? [];
    return {
      quote_id: res.quote.quoteId, quote_ref: res.quote.ref, total: res.quote.total, link: `/ops/quotes/${res.quote.quoteId}`,
      brief_en: `Draft ${res.quote.ref} ready for ${i.request_ref}: ${fmtSAR(res.quote.total, "en")} incl. VAT, confidence ${Math.round(Number(q?.ai_confidence ?? 0) * 100)}%. Review it at /ops/quotes/${res.quote.quoteId}.${qs.length ? `\nAsk the client first:\n${qs.map((x) => `• ${x}`).join("\n")}` : ""}`,
      brief_ar: `المسودة ${res.quote.ref} جاهزة للطلب ${i.request_ref}: ${fmtSAR(res.quote.total, "ar")} شامل الضريبة. راجعها قبل الإرسال.`,
    };
  },
});

const reconcile_materials = def({
  name: "reconcile_materials",
  description: "Compare delivered, returned and on-hire quantities per site and item. Finds material on site that isn't billed (or is lost) and rental charged on material that already came back.",
  schema: z.object({ site_code: siteCode }),
  async run(ctx, i) {
    const gaps = await reconcile(ctx.session, i.site_code);
    if (!gaps.length) return { gaps: [], brief_en: `Delivered, returned and on-hire quantities match${i.site_code ? ` at ${i.site_code}` : " at every site"}.`, brief_ar: "الكميات المسلّمة والمرتجعة والمؤجرة متطابقة." };
    const en = gaps.slice(0, 10).map((g) => g.kind === "unbilled_or_lost"
      ? `• ${g.site_code} ${g.sku}: ${g.variance} on site but not on hire (delivered ${g.delivered}, returned ${g.returned}, on hire ${g.on_hire}). ≈ ${fmtSAR(g.value, "en")} of stock unbilled or lost.`
      : `• ${g.site_code} ${g.sku}: rental still charged on ${-g.variance} that came back (on hire ${g.on_hire}, should be ${g.expected_on_site}).`);
    const ar = gaps.slice(0, 10).map((g) => g.kind === "unbilled_or_lost" ? `• ${g.site_code} ${g.sku}: ${g.variance} في الموقع غير مؤجرة` : `• ${g.site_code} ${g.sku}: إيجار يُحتسب على ${-g.variance} تمت إعادتها`);
    return { gaps, brief_en: `${gaps.length} material gap(s):\n${en.join("\n")}`, brief_ar: `${gaps.length} فرق في المواد:\n${ar.join("\n")}` };
  },
});

const plan_dispatch = def({
  name: "plan_dispatch",
  description: "Draft the delivery and collection plan for a date: assigns trucks by weight, orders stops by distance, respects night-only sites and offshore boat transfers. Saves a draft for approval.",
  schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, default tomorrow") }),
  async run(ctx, i) {
    const date = i.date ?? new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const { planId, plan } = await planDispatch(ctx.session, date);
    if (!plan.trips.length && !plan.unassigned.length) return { plan_id: planId, plan, brief_en: `Nothing to dispatch on ${date}: no planned deliveries and every off-hire collection is already on its way.`, brief_ar: `لا يوجد ما يُوزّع يوم ${date}.` };
    const trips = plan.trips.map((t, k) => `• Trip ${k + 1} ${t.vehicle.plate} (${t.vehicle.kind}, ${t.vehicle.driver ?? "driver tbc"}), ${t.window}: ${t.stops.map((x) => `${x.kind === "delivery" ? "deliver" : "collect"} ${x.site_code}`).join(" → ")} · ${(t.load_kg / 1000).toFixed(1)} t (${t.utilisation}%) · ~${t.est_km} km, ${t.est_hours} h`);
    return {
      plan_id: planId, plan, link: "/ops/fleet/dispatch",
      brief_en: `Draft dispatch plan for ${date}: ${plan.trips.length} trip(s).\n${trips.join("\n")}${plan.warnings.length ? `\nNotes:\n${plan.warnings.map((w) => `• ${w}`).join("\n")}` : ""}\nApprove it on Fleet → Dispatch (plan ${planId.slice(0, 8)}).`,
      brief_ar: `مسودة خطة التوزيع ليوم ${date}: ${plan.trips.length} رحلة. اعتمدها من صفحة التوزيع.`,
    };
  },
});

const approve_dispatch_plan = def({
  name: "approve_dispatch_plan",
  description: "Confirm a draft dispatch plan: trucks are assigned to deliveries and collection movements are created.",
  schema: z.object({ plan_id: z.string().uuid() }),
  async run(ctx, i) {
    const r = await executeDispatchPlan(ctx.session, i.plan_id);
    return { ...r, brief_en: `Dispatch plan confirmed: ${r.trips} trip(s), ${r.deliveries} delivery(ies) in transit, ${r.collections} collection(s) created.`, brief_ar: `تم اعتماد خطة التوزيع: ${r.trips} رحلة.` };
  },
});

const draft_invoices = def({
  name: "draft_invoices",
  description: "Draft rental invoices for on-hire days not yet billed (one per site). Drafts only; Finance issues them after approval.",
  schema: z.object({ site_code: siteCode }),
  async run(ctx, i) {
    const created = await draftInvoices(ctx.session.orgId, { siteCode: i.site_code, actorId: ctx.session.id });
    if (!created.length) return { created: [], brief_en: "Nothing to draft: every site is billed up to yesterday or already has an unissued invoice.", brief_ar: "لا يوجد ما يُفوتر حالياً." };
    return { created, brief_en: `${created.length} draft invoice(s):\n${created.map((c) => `• ${c.ref} ${c.site}: ${fmtSAR(c.total, "en", 2)}${c.missingPo ? " (no PO yet: Finance has a task)" : ""}`).join("\n")}\nReview them on Billing and submit for issue.`, brief_ar: `${created.length} مسودة فاتورة جاهزة للمراجعة.` };
  },
});

const issue_invoice = def({
  name: "issue_invoice",
  description: "Issue an invoice to the client with the ZATCA QR code. Always needs Finance approval.",
  schema: z.object({ invoice_ref: z.string().regex(/^INV-\d{2}-\d{4}$/) }),
  async run(ctx, i) {
    const r = await issueInvoice(ctx.session, i.invoice_ref);
    if (!r.ok) return { error: "cannot_issue", brief_en: r.error, brief_ar: r.error };
    return { ...r, brief_en: `${r.ref} issued (${fmtSAR(r.total, "en", 2)}) with ZATCA QR. It is in the client's portal. ZATCA clearance needs the live Fatoora integration.`, brief_ar: `تم إصدار ${r.ref} مع رمز زاتكا.` };
  },
});

export const TOOLS = { reconcile_materials, plan_dispatch, approve_dispatch_plan, draft_invoices, issue_invoice, estimate_request, query_scaffolds, get_site_status, search_knowledge, list_expiring, stock_check, onhire_summary, daily_brief, create_task, remember, create_request, indicative_quote, request_off_hire, send_quote, set_tag_status };
export type ToolName = keyof typeof TOOLS;

export function toolSpecs(names: readonly ToolName[]) {
  return names.map((n) => ({ name: TOOLS[n].name, description: TOOLS[n].description, input_schema: z.toJSONSchema(TOOLS[n].schema) as Record<string, unknown> }));
}
