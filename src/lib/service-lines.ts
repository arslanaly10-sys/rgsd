/* Service lines RGS sells, with the stages used for stage-weighted progress. Pure and client-safe. */

export const SERVICE_LINES = ["scaffolding", "waterproofing", "insulation"] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const SERVICE_META: Record<ServiceLine, { en: string; ar: string; accent: string; units: string[] }> = {
  scaffolding: { en: "Scaffolding & Access", ar: "السقالات والوصول", accent: "#f9441a", units: ["m3", "lot", "each"] },
  waterproofing: { en: "Waterproofing", ar: "العزل المائي", accent: "#1f6feb", units: ["m2", "lm", "each"] },
  insulation: { en: "Insulation & Heat-proofing", ar: "العزل الحراري", accent: "#b7791f", units: ["m2", "lm", "m3", "each"] },
};

export type Stage = { key: string; en: string; ar: string; weight: number };

/** Stage weights add up to 100 per service line. */
export const STAGES: Record<ServiceLine, Stage[]> = {
  waterproofing: [
    { key: "surface_prep", en: "Surface preparation", ar: "تجهيز السطح", weight: 15 },
    { key: "primer", en: "Primer", ar: "البرايمر", weight: 10 },
    { key: "membrane", en: "Membrane / coating", ar: "الغشاء / الطلاء", weight: 45 },
    { key: "flood_test", en: "Flood test (48 h)", ar: "اختبار الغمر (48 ساعة)", weight: 15 },
    { key: "protection", en: "Protection / screed", ar: "الحماية / الصبة", weight: 15 },
  ],
  insulation: [
    { key: "surface_prep", en: "Surface prep / paint check", ar: "تجهيز السطح", weight: 10 },
    { key: "insulation", en: "Insulation layer", ar: "طبقة العزل", weight: 45 },
    { key: "cladding", en: "Cladding / vapour barrier", ar: "الكسوة / حاجز البخار", weight: 35 },
    { key: "inspection", en: "Thickness & seal inspection", ar: "فحص السماكة والإحكام", weight: 10 },
  ],
  scaffolding: [
    { key: "design", en: "Design & approval", ar: "التصميم والاعتماد", weight: 10 },
    { key: "erection", en: "Erection", ar: "التركيب", weight: 60 },
    { key: "handover", en: "Handover inspection", ar: "فحص التسليم", weight: 30 },
  ],
};

/** Cumulative stage-weighted % for an area that has completed the stages before `stage` and is `partial` (0–1) through it. */
export function stagePct(line: ServiceLine, stage: string, partial = 1) {
  if (stage === "not_started") return 0;
  if (stage === "complete") return 100;
  const st = STAGES[line];
  const i = st.findIndex((x) => x.key === stage);
  if (i < 0) return 0;
  return Math.round((st.slice(0, i).reduce((a, x) => a + x.weight, 0) + st[i].weight * partial) * 10) / 10;
}

export const VO_FINANCE_THRESHOLD = 100_000; // SAR: above this a variation also needs client finance/procurement approval

/** Which client roles must sign a given item. */
export function requiredSigners(kind: "measurement" | "hold_point" | "variation" | "completion" | "inspection" | "document" | "claim", amount = 0): string[] {
  switch (kind) {
    case "variation": return amount > VO_FINANCE_THRESHOLD ? ["client_admin", "client_finance"] : ["client_admin"];
    case "measurement": return ["client_admin", "client_consultant"];
    case "hold_point": return ["client_consultant"];
    case "completion": return ["client_admin", "client_hse"];
    case "claim": return ["client_admin", "client_finance"];
    default: return ["client_admin"];
  }
}
