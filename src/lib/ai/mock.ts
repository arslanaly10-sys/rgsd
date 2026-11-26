import type { CompletionRequest, CompletionResponse, Provider, ToolUseBlock } from "./types";

/*
 * Deterministic stand-in for Claude so the whole platform runs and demos with no API key.
 * Turn 1: read the user's words, pick tools and arguments with simple rules.
 * Turn 2: once tool results come back, answer from those results (tools return brief_en / brief_ar).
 * It is honest about being a mock: the UI shows "Mock AI" on every reply.
 */

const AR = /[؀-ۿ]/;

const SITE_WORDS: [RegExp, string][] = [
  [/\bKRN\b|karan|كران/i, "KRN"],
  [/\bSFN\b|safaniy|سفاني/i, "SFN"],
  [/\bSDR\b|sadara|صدارة/i, "SDR"],
  [/\bBRG\b|bargash|برقاش|البرقاش/i, "BRG"],
  [/\bQDY\b|qiddiya|القدية|قدية/i, "QDY"],
  [/\bRTM\b|ras tanura|jetty|رأس تنورة/i, "RTM"],
];

export function extractSite(text: string) {
  return SITE_WORDS.find(([re]) => re.test(text))?.[1];
}

function num(re: RegExp, text: string) {
  const m = text.match(re);
  return m ? Number(m[1]) : undefined;
}

export function extractDims(text: string) {
  const t = text.replace(/×/g, "x");
  const fp = t.match(/(\d+(?:\.\d+)?)\s*(?:m)?\s*x\s*(\d+(?:\.\d+)?)\s*m?/i);
  const length = num(/(\d+(?:\.\d+)?)\s*m\s*(?:long|length|طول)/i, t) ?? (fp ? Number(fp[1]) : undefined) ?? num(/(\d+(?:\.\d+)?)\s*(?:lm|linear)/i, t);
  const width = num(/(\d+(?:\.\d+)?)\s*m\s*(?:wide|width|عرض)/i, t) ?? (fp ? Number(fp[2]) : undefined);
  const lifts = num(/(\d+)\s*lifts?/i, t);
  const height = num(/(\d+(?:\.\d+)?)\s*m\s*(?:high|height|tall|working height|ارتفاع)/i, t) ?? num(/(?:height|ارتفاع)[^\d]{0,12}(\d+(?:\.\d+)?)/i, t) ?? (lifts ? lifts * 2 : undefined);
  const months = num(/(\d+)\s*(?:months?|أشهر|شهر)/i, t);
  const weeks = num(/(\d+)\s*(?:weeks?|أسابيع|اسابيع|أسبوع)/i, t) ?? (months ? months * 4.33 : undefined);
  return { length, width, height, weeks };
}

export function extractType(text: string) {
  if (/cantilever|كابول/i.test(text)) return "cantilever";
  if (/birdcage|قفص/i.test(text)) return "birdcage";
  if (/suspend|معلق/i.test(text)) return "suspended";
  if (/mast|صاري/i.test(text)) return "mast_climber";
  if (/hoist|رافعة/i.test(text)) return "hoist";
  if (/ringlock|رينغلوك/i.test(text)) return "system_ringlock";
  if (/cuplock|كبلوك|system/i.test(text)) return "system_cuplock";
  if (/tower|برج/i.test(text)) return "mobile_tower";
  return "tube_coupler";
}

type Plan = { name: string; input: Record<string, unknown> }[];

function plan(text: string, tools: Set<string>, agent: string): Plan {
  const p: Plan = [];
  const site = extractSite(text);
  const tag = text.match(/\b[A-Z]{3}-\d{4}\b/)?.[0];
  const quoteRef = text.match(/\bQT-\d{2}-\d{4}\b/i)?.[0]?.toUpperCase();
  const add = (name: string, input: Record<string, unknown> = {}) => tools.has(name) && p.push({ name, input });
  const status = /\bred\b|أحمر|حمراء/i.test(text) ? "red" : /\byellow\b|أصفر|صفراء/i.test(text) ? "yellow" : /\bgreen\b|أخضر|خضراء/i.test(text) ? "green" : undefined;

  const reqRef = text.match(/\bRQ-\d{2}-\d{4}\b/i)?.[0]?.toUpperCase();
  if (reqRef && /estimate|quote|price|draft|take.?off|سعّر|سعر|عرض/i.test(text)) { add("estimate_request", { request_ref: reqRef }); if (p.length) return p; }
  const prjRef = text.match(/\bPRJ-\d{2}-\d{3}\b/i)?.[0]?.toUpperCase();
  if (/sign.?off|signature|waiting for me|to sign|approve|توقيع|توقيعي/i.test(text) && !/tag|quote|invoice/i.test(text)) { add("my_signoffs"); if (p.length) return p; }
  if (prjRef && /instruct|extra|add(itional)?|change|تعليمات|إضافة/i.test(text)) { add("raise_instruction", { project_ref: prjRef, title: text.replace(prjRef, "").replace(/^(please\s+)?(record|raise|issue)( an?)? (site )?instruction( to| on| for)?:?\s*/i, "").trim().slice(0, 190) || "Site instruction" }); if (p.length) return p; }
  if (prjRef || /project|progress|milestone|waterproof|insulation|roof|basement|tank|مشروع|المشاريع|تقدم|عزل/i.test(text)) { add("project_status", prjRef ? { project_ref: prjRef } : {}); if (p.length) return p; }
  const invRef = text.match(/\bINV-\d{2}-\d{4}\b/i)?.[0]?.toUpperCase();
  if (invRef && /issue|send|أصدر/i.test(text)) { add("issue_invoice", { invoice_ref: invRef }); if (p.length) return p; }
  if (/reconcil|missing|loss|lost|shrink|variance|unbilled material|فرق|مفقود/i.test(text)) { add("reconcile_materials", { site_code: site }); if (p.length) return p; }
  if (/dispatch|route|trucks?\b|tomorrow'?s? (deliver|plan)|plan (the )?deliver|توزيع|شاحنات/i.test(text)) { add("plan_dispatch", {}); if (p.length) return p; }
  if (/(draft|run|prepare).{0,15}(invoice|billing)|bill(ing)? run|فوترة|فواتير/i.test(text)) { add("draft_invoices", { site_code: site }); if (p.length) return p; }
  if (/send\s+(the\s+)?quote|أرسل\s+العرض/i.test(text) && quoteRef) { add("send_quote", { quote_ref: quoteRef }); return p; }
  if (/(set|change|mark|clear|update|remove|lift).{0,20}tag|tag.{0,12}(to|as)\s+(green|yellow|red)|غي[ّ]?ر.{0,10}البطاقة|أزل.{0,10}البطاقة/i.test(text) && tag) {
    const target = (text.match(/\b(?:to|as)\s+(green|yellow|red)\b/i)?.[1]?.toLowerCase()) ?? (/clear|remove|lift|أزل|إزالة/i.test(text) ? "green" : status ?? "green");
    add("set_tag_status", { tag_no: tag, status: target, reason: text.slice(0, 200) }); return p;
  }
  if (/off.?hire|collect|pick.?up|return (the )?material|إنهاء الإيجار|استلام المواد/i.test(text)) {
    add("request_off_hire", { site_code: site, note: text.slice(0, 200) }); return p;
  }
  if (/remind|task|follow.?up|ذكرني|مهمة|تذكير/i.test(text)) {
    add("create_task", { title: text.replace(/^(please\s+)?(remind me to|create a task to)\s*/i, "").slice(0, 120), due_in_days: num(/in\s+(\d+)\s+days?/i, text) ?? 1 });
    return p;
  }
  if (/remember|note that|تذكر أن|احفظ/i.test(text)) { add("remember", { content: text.slice(0, 300), site_code: site }); return p; }
  if (/quote|price|cost|estimate|how much|سعر|عرض|تكلفة|كم/i.test(text) || (agent === "concierge" && /need|require|نحتاج|نريد|أحتاج/i.test(text))) {
    const d = extractDims(text);
    if (agent === "concierge" && /need|require|نحتاج|نريد|أحتاج/i.test(text)) add("create_request", { site_code: site, title: text.slice(0, 90), description: text.slice(0, 600), scaffold_type: extractType(text) });
    add("indicative_quote", { scaffold_type: extractType(text), length_m: d.length ?? 10, width_m: d.width ?? 1.3, height_m: d.height ?? 6, weeks: Math.round(d.weeks ?? 4), offshore: site === "KRN" || site === "SFN" || /offshore|بحري/i.test(text), site_code: site });
    return p;
  }
  if (/brief|summary|today|morning|overview|ملخص|اليوم|موجز/i.test(text)) { add("daily_brief"); return p; }
  if (/expir|cert|iqama|card|bosiet|h2s|training|إقام|شهاد|تدريب|بطاق(ة|ات) (أرامكو|السقالات)/i.test(text)) { add("list_expiring", { within_days: num(/(\d+)\s*days?/i, text) ?? 30, site_code: site }); return p; }
  if (/stock|yard|inventory|available|low on|boards?\b|couplers?|tubes?\b|مخزون|الساحة|متوفر|ألواح|الألواح/i.test(text)) { add("stock_check", { sku: text.match(/\b[A-Z]{2}-[A-Z0-9]{2,6}\b/)?.[0], query: text.slice(0, 80) }); return p; }
  if (/on.?hire|rental|hire|إيجار|مؤجر/i.test(text)) { add("onhire_summary", { site_code: site }); return p; }
  if (/procedure|how (do|should|to)|rule|standard|method|policy|إجراء|كيف|قاعدة|طريقة/i.test(text)) { add("search_knowledge", { query: text.slice(0, 200) }); return p; }
  if (status || /tag|overdue|due|inspect|scaffold|defect|فحص|سقال|متأخر|مستحق/i.test(text)) {
    add("query_scaffolds", { site_code: site, status, due_only: /overdue|due|مستحق|متأخر/i.test(text) });
    return p;
  }
  if (site) { add("get_site_status", { site_code: site }); return p; }
  return p;
}

let seq = 0;

export const mockProvider: Provider = {
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const last = req.messages[req.messages.length - 1];
    const firstUserText = [...req.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string")?.content as string | undefined;
    const locale = firstUserText && AR.test(firstUserText) ? "ar" : req.mockHints?.locale ?? "en";
    const usage = { input: Math.round(JSON.stringify(req.messages).length / 4), output: 0 };

    // Turn 2+: summarise tool results.
    if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) {
      const parts: string[] = [];
      for (const b of last.content) {
        if (b.type !== "tool_result") continue;
        try {
          const r = JSON.parse(b.content);
          parts.push(String((locale === "ar" ? r.brief_ar : r.brief_en) ?? r.brief_en ?? r.error ?? ""));
        } catch {
          parts.push(b.content);
        }
      }
      const text = parts.filter(Boolean).join("\n\n");
      usage.output = Math.round(text.length / 4);
      return { content: [{ type: "text", text }], stopReason: "end_turn", model: "mock-rgs-1", usage, mode: "mock" };
    }

    const text = typeof last.content === "string" ? last.content : last.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    const tools = new Set((req.tools ?? []).map((t) => t.name));
    const p = plan(text, tools, req.mockHints?.agent ?? "ops");
    if (p.length) {
      const content: ToolUseBlock[] = p.map((x) => ({ type: "tool_use", id: `mock_${Date.now()}_${seq++}`, name: x.name, input: x.input }));
      return { content, stopReason: "tool_use", model: "mock-rgs-1", usage, mode: "mock" };
    }
    const help =
      locale === "ar"
        ? "يمكنني مساعدتك في: حالة السقالات والبطاقات، الفحوصات المستحقة، عروض الأسعار المبدئية، طلبات إنهاء الإيجار، المخزون، الشهادات المنتهية، والإجراءات. جرّب: «ما السقالات الحمراء في صدارة؟»"
        : "I can help with scaffold and tag status, inspections due, indicative quotes, off-hire requests, yard stock, expiring certificates and procedures. Try: “Which scaffolds are red at Sadara?”";
    return { content: [{ type: "text", text: help }], stopReason: "end_turn", model: "mock-rgs-1", usage, mode: "mock" };
  },
};

/** Mock routing used when AI_MODE=mock (the live router asks the fast model). */
export function mockRoute(text: string, isStaff: boolean): string {
  if (!isStaff) return "concierge";
  if (/quote|price|cost|estimate|tender|rfq|boq|سعر|عرض|مناقصة/i.test(text)) return "estimator";
  if (/tag|inspect|defect|\bred\b|\byellow\b|overdue|scaffold|فحص|بطاقة|أحمر|عيوب/i.test(text)) return "inspector";
  if (/reconcil|missing|loss|shrink|variance|route|stock|yard|hire|deliver|dispatch|truck|collect|low on|boards?\b|couplers?|مخزون|إيجار|توصيل|شاحن|ألواح/i.test(text)) return "fleet";
  if (/cert|iqama|crew|worker|training|manpower|شهاد|إقام|عمال|تدريب/i.test(text)) return "workforce";
  if (/invoice|billing|zatca|payment|فاتور|زاتكا|فوترة/i.test(text)) return "finance";
  if (/procedure|how|rule|standard|إجراء|كيف/i.test(text)) return "inspector";
  return "briefing";
}
