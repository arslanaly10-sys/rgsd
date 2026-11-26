/* Scaffold inspection checklist and tag rules. Pure and client-safe: the field app and the server use the same rules.
 * Based on common Aramco / OSHA 1926.451 / EN 12811 inspection points (SAMPLE, to be replaced by RGS's own form). */

export type TagStatus = "green" | "yellow" | "red";
export type ItemResult = "pass" | "fail" | "na";
export type Severity = "low" | "medium" | "high" | "critical";

export type ChecklistItem = {
  code: string;
  en: string;
  ar: string;
  /** critical: a fail means the scaffold must not be used (red). minor: may be used with a restriction (yellow). */
  weight: "critical" | "minor";
  restriction?: { en: string; ar: string };
};

export const CHECKLIST: ChecklistItem[] = [
  { code: "FND", en: "Foundations, sole boards and base plates sound", ar: "الأساسات وألواح القاعدة والقواعد سليمة", weight: "critical" },
  { code: "STD", en: "Standards plumb, joints staggered", ar: "القوائم رأسية والوصلات متناوبة", weight: "critical" },
  { code: "LED", en: "Ledgers and transoms at correct spacing and fixed", ar: "العوارض والعرضيات بالمسافات الصحيحة ومثبتة", weight: "critical" },
  { code: "BRC", en: "Bracing complete (façade, ledger, plan)", ar: "التدعيم مكتمل", weight: "critical" },
  { code: "TIE", en: "Ties / anchors at required spacing", ar: "الروابط والمثبتات بالمسافات المطلوبة", weight: "critical" },
  { code: "PLT", en: "Platform fully boarded, boards secured, no trap ends", ar: "المنصة مغطاة بالكامل والألواح مثبتة", weight: "critical" },
  { code: "GRD", en: "Guardrail ≥ 950 mm and mid-rail fitted", ar: "درابزين لا يقل عن 950 مم مع درابزين أوسط", weight: "critical" },
  { code: "TOE", en: "Toe boards ≥ 150 mm", ar: "ألواح حماية القدم لا تقل عن 150 مم", weight: "minor", restriction: { en: "No work or storage near open edges; barricade the area below", ar: "لا عمل أو تخزين قرب الحواف المفتوحة؛ تطويق المنطقة أسفلها" } },
  { code: "ACC", en: "Safe access: ladder/stair secured, 1 m above landing", ar: "وصول آمن: السلم مثبت ويرتفع 1 م فوق المنصة", weight: "minor", restriction: { en: "Use the alternative access only; this ladder is out of use", ar: "استخدم الوصول البديل فقط" } },
  { code: "LDG", en: "Loading within duty class, no overloading", ar: "الحمولة ضمن الفئة دون تحميل زائد", weight: "critical" },
  { code: "CPL", en: "Couplers tight, components undamaged", ar: "الوصلات مشدودة والمكونات سليمة", weight: "critical" },
  { code: "SGN", en: "Tag holder and signage at each access point", ar: "حامل البطاقة واللافتات عند كل مدخل", weight: "minor", restriction: { en: "Tag displayed at main access only", ar: "البطاقة معروضة عند المدخل الرئيسي فقط" } },
  { code: "HAR", en: "Harness required? (exposed edge or incomplete guardrail)", ar: "هل يلزم حزام الأمان؟", weight: "minor", restriction: { en: "Harness must be worn and clipped on at all times", ar: "يجب ارتداء حزام الأمان وتثبيته دائماً" } },
];

export type Finding = { code: string; description: string; severity: Severity; confidence: number; source: "checklist" | "ai" };

export const rank: Record<TagStatus, number> = { green: 0, yellow: 1, red: 2 };

/** The tag the evidence supports. The inspector decides; choosing a less severe tag needs a written reason. */
export function suggestTag(checklist: { code: string; result: ItemResult }[], ai: Finding[] = []): { status: TagStatus; reasons: string[]; restrictions: string[]; restrictionsAr: string[] } {
  const fails = checklist.filter((c) => c.result === "fail").map((c) => CHECKLIST.find((x) => x.code === c.code)).filter(Boolean) as ChecklistItem[];
  const reasons: string[] = [];
  let status: TagStatus = "green";
  for (const f of fails) {
    reasons.push(`${f.code}: ${f.en}`);
    status = f.weight === "critical" ? "red" : status === "red" ? "red" : "yellow";
  }
  for (const a of ai) {
    if (a.confidence < 0.6) continue;
    reasons.push(`AI (${Math.round(a.confidence * 100)}%): ${a.description}`);
    if (a.severity === "critical" || a.severity === "high") status = "red";
    else if (a.severity === "medium" && status === "green") status = "yellow";
  }
  const minor = fails.filter((f) => f.weight === "minor" && f.restriction);
  return { status, reasons, restrictions: minor.map((f) => f.restriction!.en), restrictionsAr: minor.map((f) => f.restriction!.ar) };
}

export const TAG_ROLES = {
  /** Any result, including clearing a red tag: the competent person. */
  full: ["inspector", "admin"],
  /** May only make a scaffold safe (red). */
  redOnly: ["site_supervisor", "ops_manager"],
} as const;
