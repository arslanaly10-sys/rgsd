/* Standard inspection & test plan (ITP) templates per service line. SAMPLE criteria based on common KSA practice;
 * replace with RGS's approved ITPs. Pure and client-safe. `stage` ties each step to the progress stage it belongs to. */

export type TemplateItem = {
  seq: number;
  title: string;
  title_ar: string;
  kind: "inspection" | "test" | "hold" | "witness";
  stage: string;
  test_kind?: "flood_test" | "adhesion" | "thickness" | "holiday" | "moisture" | "dew_point" | "substrate_temp" | "visual" | "overlap";
  criteria: string;
  acceptance?: { min?: number; max?: number; unit?: string; equals?: string };
};

export type Template = { code: string; service_line: "scaffolding" | "waterproofing" | "insulation"; system: string; name: string; name_ar: string; items: TemplateItem[] };

export const TEMPLATES: Template[] = [
  {
    code: "ITP-WP-BIT", service_line: "waterproofing", system: "bituminous", name: "Bituminous membrane (APP/SBS torch-on)", name_ar: "الأغشية البيتومينية (APP/SBS بالحرارة)",
    items: [
      { seq: 1, stage: "surface_prep", kind: "inspection", test_kind: "visual", title: "Substrate clean, cured, falls to drains", title_ar: "السطح نظيف ومعالج وميول نحو المصارف", criteria: "Concrete ≥ 28 days, no laitance, falls ≥ 1%" },
      { seq: 2, stage: "surface_prep", kind: "test", test_kind: "moisture", title: "Substrate moisture", title_ar: "رطوبة السطح", criteria: "Moisture meter ≤ 5%", acceptance: { max: 5, unit: "%" } },
      { seq: 3, stage: "primer", kind: "test", test_kind: "substrate_temp", title: "Substrate temperature at application", title_ar: "حرارة السطح عند التطبيق", criteria: "≤ 45 °C (summer: work 05:00–11:00)", acceptance: { max: 45, unit: "°C" } },
      { seq: 4, stage: "membrane", kind: "inspection", test_kind: "overlap", title: "Laps and bitumen bleed", title_ar: "التراكبات وخروج البيتومين", criteria: "Side laps ≥ 100 mm, end laps ≥ 150 mm, continuous bleed", acceptance: { min: 100, unit: "mm" } },
      { seq: 5, stage: "membrane", kind: "inspection", test_kind: "visual", title: "Upstands, outlets and terminations", title_ar: "الحواف والمصارف والنهايات", criteria: "Upstands ≥ 150 mm above finished level, termination bar sealed" },
      { seq: 6, stage: "flood_test", kind: "hold", test_kind: "flood_test", title: "48 h flood test (client witness)", title_ar: "اختبار غمر 48 ساعة (بحضور العميل)", criteria: "50 mm water for 48 h, no drop in level, no leaks below", acceptance: { equals: "no_leak" } },
      { seq: 7, stage: "protection", kind: "inspection", test_kind: "visual", title: "Protection board / screed", title_ar: "لوح أو صبة الحماية", criteria: "Placed within 7 days of a passed flood test" },
    ],
  },
  {
    code: "ITP-WP-LIQ", service_line: "waterproofing", system: "liquid", name: "Liquid-applied membrane (PU / PU-bitumen)", name_ar: "الأغشية السائلة (بولي يوريثان)",
    items: [
      { seq: 1, stage: "surface_prep", kind: "test", test_kind: "moisture", title: "Substrate moisture", title_ar: "رطوبة السطح", criteria: "≤ 5%", acceptance: { max: 5, unit: "%" } },
      { seq: 2, stage: "primer", kind: "test", test_kind: "dew_point", title: "Dew point margin", title_ar: "الفرق عن نقطة الندى", criteria: "Surface ≥ 3 °C above dew point", acceptance: { min: 3, unit: "°C" } },
      { seq: 3, stage: "membrane", kind: "test", test_kind: "thickness", title: "Dry film thickness", title_ar: "سماكة الطبقة الجافة", criteria: "≥ 2.0 mm at every reading", acceptance: { min: 2.0, unit: "mm" } },
      { seq: 4, stage: "membrane", kind: "test", test_kind: "adhesion", title: "Pull-off adhesion", title_ar: "اختبار الالتصاق", criteria: "≥ 1.5 MPa", acceptance: { min: 1.5, unit: "MPa" } },
      { seq: 5, stage: "membrane", kind: "test", test_kind: "holiday", title: "Holiday (pinhole) test", title_ar: "اختبار الثقوب", criteria: "No holidays", acceptance: { equals: "none" } },
      { seq: 6, stage: "flood_test", kind: "hold", test_kind: "flood_test", title: "48 h flood / tank fill test (client witness)", title_ar: "اختبار غمر 48 ساعة (بحضور العميل)", criteria: "No level drop, no damp patches", acceptance: { equals: "no_leak" } },
      { seq: 7, stage: "protection", kind: "inspection", test_kind: "visual", title: "Protection layer", title_ar: "طبقة الحماية", criteria: "Complete, no damage to membrane" },
    ],
  },
  {
    code: "ITP-WP-CRY", service_line: "waterproofing", system: "crystalline", name: "Crystalline waterproofing", name_ar: "العزل الكريستالي",
    items: [
      { seq: 1, stage: "surface_prep", kind: "inspection", test_kind: "visual", title: "Open-pored, saturated surface", title_ar: "سطح مفتوح المسام ومشبع", criteria: "Water-jetted, saturated surface dry" },
      { seq: 2, stage: "membrane", kind: "test", test_kind: "thickness", title: "Application rate", title_ar: "معدل التطبيق", criteria: "≥ 1.5 kg/m² over 2 coats", acceptance: { min: 1.5, unit: "kg/m²" } },
      { seq: 3, stage: "protection", kind: "witness", test_kind: "visual", title: "Curing (moist 3 days) witnessed", title_ar: "المعالجة بالرطوبة 3 أيام", criteria: "Kept moist, protected from sun and wind" },
    ],
  },
  {
    code: "ITP-IN-ROOF", service_line: "insulation", system: "roof", name: "Roof heat insulation (XPS + foam concrete)", name_ar: "العزل الحراري للسطح",
    items: [
      { seq: 1, stage: "surface_prep", kind: "inspection", test_kind: "visual", title: "Waterproofing flood-tested and released", title_ar: "اعتماد اختبار الغمر للعزل المائي", criteria: "Linked flood test passed" },
      { seq: 2, stage: "insulation", kind: "test", test_kind: "thickness", title: "Board thickness", title_ar: "سماكة الألواح", criteria: "≥ 50 mm, joints staggered and tight", acceptance: { min: 50, unit: "mm" } },
      { seq: 3, stage: "cladding", kind: "inspection", test_kind: "visual", title: "Foam concrete to falls", title_ar: "الخرسانة الرغوية للميول", criteria: "Falls ≥ 1% to outlets, no ponding" },
      { seq: 4, stage: "inspection", kind: "witness", test_kind: "visual", title: "Final inspection (client witness)", title_ar: "الفحص النهائي بحضور العميل", criteria: "Complete, protected, outlets clear" },
    ],
  },
  {
    code: "ITP-IN-HOT", service_line: "insulation", system: "hot", name: "Hot insulation with metal cladding", name_ar: "العزل الساخن مع الكسوة المعدنية",
    items: [
      { seq: 1, stage: "surface_prep", kind: "inspection", test_kind: "visual", title: "Pipe paint system complete (CUI check)", title_ar: "اكتمال الطلاء (فحص التآكل تحت العزل)", criteria: "Coating approved, surface dry" },
      { seq: 2, stage: "insulation", kind: "test", test_kind: "thickness", title: "Insulation thickness", title_ar: "سماكة العزل", criteria: "Specified thickness −0 / +5 mm (≥ 50 mm small bore)", acceptance: { min: 50, unit: "mm" } },
      { seq: 3, stage: "cladding", kind: "test", test_kind: "overlap", title: "Cladding overlap and banding", title_ar: "تراكب الكسوة والأحزمة", criteria: "Overlap ≥ 50 mm, bands ≤ 300 mm centres, shed water", acceptance: { min: 50, unit: "mm" } },
      { seq: 4, stage: "inspection", kind: "witness", test_kind: "visual", title: "Sealing at supports and protrusions (client witness)", title_ar: "الإحكام عند الدعامات (بحضور العميل)", criteria: "Sealed, removable covers fitted at inspection points" },
    ],
  },
  {
    code: "ITP-IN-COLD", service_line: "insulation", system: "cold", name: "Cold insulation with vapour barrier", name_ar: "العزل البارد مع حاجز البخار",
    items: [
      { seq: 1, stage: "surface_prep", kind: "inspection", test_kind: "visual", title: "Surface dry, line at ambient", title_ar: "السطح جاف والخط بدرجة الجو", criteria: "No condensation at application" },
      { seq: 2, stage: "insulation", kind: "test", test_kind: "thickness", title: "PIR thickness", title_ar: "سماكة PIR", criteria: "≥ 60 mm, joints staggered and sealed", acceptance: { min: 60, unit: "mm" } },
      { seq: 3, stage: "cladding", kind: "inspection", test_kind: "visual", title: "Vapour barrier continuous", title_ar: "استمرارية حاجز البخار", criteria: "No breaks, mastic at all joints" },
      { seq: 4, stage: "inspection", kind: "hold", test_kind: "visual", title: "Final inspection before cool-down (client hold)", title_ar: "الفحص النهائي قبل التبريد (نقطة توقف)", criteria: "Released by client QA before the line is cooled" },
    ],
  },
];

export function templateFor(serviceLine: string, system: string | null): Template | undefined {
  const s = (system ?? "").toLowerCase();
  // Liquid systems first: "PU-bitumen" is a liquid coating, not a torch-on membrane.
  if (serviceLine === "waterproofing") return TEMPLATES.find((t) => t.code === (/\bpu\b|pu-|liquid|polyurea|acrylic|cementitious/.test(s) ? "ITP-WP-LIQ" : /crystal/.test(s) ? "ITP-WP-CRY" : /app|bitum|torch|sbs/.test(s) ? "ITP-WP-BIT" : "ITP-WP-LIQ"));
  if (serviceLine === "insulation") return TEMPLATES.find((t) => t.code === (/xps|roof|foam/.test(s) ? "ITP-IN-ROOF" : /pir|cold|vapour/.test(s) ? "ITP-IN-COLD" : "ITP-IN-HOT"));
  return undefined;
}

/** Pass/fail from the acceptance criteria. Text results use `equals`; numbers use min/max on every reading. */
export function judge(acceptance: TemplateItem["acceptance"] | null | undefined, readings: (number | string)[]): "passed" | "failed" | null {
  if (!acceptance || !readings.length) return null;
  if (acceptance.equals != null) return readings.every((r) => String(r) === acceptance.equals) ? "passed" : "failed";
  const nums = readings.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  if (acceptance.min != null && nums.some((n) => n < acceptance.min!)) return "failed";
  if (acceptance.max != null && nums.some((n) => n > acceptance.max!)) return "failed";
  return "passed";
}
