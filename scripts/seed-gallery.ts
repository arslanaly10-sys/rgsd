/* Illustrated gallery and schematic area layouts for every sample project. Illustrations are badged in the UI and never presented as site photos. */
import type { Client } from "pg";

type Insert = (table: string, row: Record<string, unknown>) => Promise<string>;
type Ctx = { db: Client; insert: Insert; day: (o: number) => string; org: string; people: Record<string, string> };

// [scene, service, stage, caption EN, caption AR, days ago, area code hint]
type Shot = [string, string | null, "before" | "during" | "after" | null, string, string, number, string?];
const SHOTS: Record<string, Shot[]> = {
  "PRJ-26-001": [
    ["roof-waterproofing", "waterproofing", "during", "Main roof L32: APP membrane, second layer going down", "السطح L32: الطبقة الثانية من الغشاء", 12, "WP-R1"],
    ["roof-waterproofing-alt", "waterproofing", "after", "Main roof ready for the 48 h flood test", "السطح جاهز لاختبار الغمر", 4, "WP-R1"],
    ["tower-facade", null, "during", "Al Bargash Tower from the podium", "برج البرقاش من المنصة", 20],
    ["villa-waterproofing", "insulation", "during", "XPS boards and foam concrete to falls", "ألواح XPS والخرسانة الرغوية للميول", 8, "IN-R1"],
    ["basement-waterproofing-alt", "waterproofing", "before", "Podium deck surface preparation", "تجهيز سطح المنصة", 18, "WP-P1"],
  ],
  "PRJ-26-002": [
    ["basement-waterproofing", "waterproofing", "during", "Raft PU-bitumen coat, grid C–F", "طلاء اللبشة بالبولي يوريثان البيتوميني", 6, "WP-RAFT"],
    ["basement-waterproofing-alt", "waterproofing", "after", "B2 retaining walls complete, crystalline 2 coats", "اكتمال الجدران الاستنادية B2", 15, "WP-B2W"],
    ["tank-insulation-alt", "waterproofing", "during", "Potable water tank T1 before flood test", "خزان المياه T1 قبل اختبار الغمر", 3, "WP-T1"],
  ],
  "PRJ-26-003": [
    ["plant-scaffold", "scaffolding", "during", "Unit 4 columns: access scaffolds for the turnaround", "الوحدة 4: سقالات الأبراج للصيانة", 9],
    ["pipe-rack-insulation", "insulation", "during", "PR-4 hot lines: mineral wool and aluminium cladding", "خطوط PR-4 الساخنة: صوف صخري وكسوة ألمنيوم", 5, "IN-H1"],
    ["pipe-rack-insulation-alt", "insulation", "before", "PR-4 8–12 in lines stripped for CUI inspection", "خطوط 8–12 بوصة بعد الإزالة لفحص التآكل", 16, "IN-H2"],
    ["plant-scaffold-alt", "scaffolding", "after", "E-417 access scaffold handed over (green tag)", "تسليم سقالة E-417 (بطاقة خضراء)", 2],
    ["tank-insulation", "insulation", "during", "Cold lines: PIR and vapour barrier", "الخطوط الباردة: PIR وحاجز بخار", 1, "IN-C1"],
  ],
  "PRJ-26-004": [
    ["offshore-platform", "scaffolding", "during", "Karan cellar deck: under-deck scaffold for insulation crews", "كران: سقالة تحت السطح لفرق العزل", 7],
    ["offshore-platform-alt", "insulation", "during", "Riser balcony after corrosion repair, ready to insulate", "شرفة الرافعة بعد إصلاح التآكل", 3, "IN-K2"],
    ["jetty-pipe-rack", "scaffolding", "before", "Boat transfer of materials from Tanajib", "نقل المواد بالقارب من تناجيب", 12],
  ],
  "PRJ-26-005": [
    ["basement-waterproofing", "waterproofing", "during", "B2 tanking against the high water table", "عزل جدران B2 مقابل منسوب المياه المرتفع", 4, "WP-B12"],
    ["tower-facade-alt", null, "during", "Corniche Residences Tower 2", "أبراج كورنيش ريزيدنس 2", 10],
    ["roof-waterproofing", "waterproofing", "before", "Podium deck ready for PVC membrane", "سطح المنصة جاهز لغشاء PVC", 2, "WP-POD"],
  ],
  "PRJ-26-006": [
    ["hotel-roof", "insulation", "during", "Tower A roof: liquid PU membrane before heat insulation", "سطح البرج A: غشاء بولي يوريثان قبل العزل الحراري", 3, "WP-TA"],
    ["hotel-roof-alt", "scaffolding", "after", "Roof edge access scaffold on all three towers", "سقالات حواف الأسطح على الأبراج الثلاثة", 17, "SC-EDGE"],
    ["roof-waterproofing-alt", "waterproofing", "during", "Tower B membrane, first coat", "غشاء البرج B، الطبقة الأولى", 1, "WP-TB"],
  ],
  "PRJ-26-007": [
    ["refinery-coast", "scaffolding", "during", "C-201 crude column access scaffold, 42 m", "سقالة برج التقطير C-201 بارتفاع 42 م", 5, "SC-COL"],
    ["refinery-coast-alt", "insulation", "during", "Transfer lines: CUI windows and reinstatement", "خطوط النقل: نوافذ فحص التآكل وإعادة العزل", 2, "IN-TL"],
    ["fireproofing-steel", "scaffolding", "before", "Furnace structure before scaffold erection", "هيكل الفرن قبل تركيب السقالات", 14],
  ],
};

/** Simple schematic: lay areas out on a 100 × 60 grid; tanks as circles, lines/racks as long bars. */
function layoutFor(areas: { code: string; name: string }[]) {
  const out: Record<string, { x: number; y: number; w: number; h: number; shape: "rect" | "tank" | "rack" }> = {};
  let x = 4, y = 6, rowH = 0;
  for (const a of areas) {
    const n = `${a.code} ${a.name}`.toLowerCase();
    const shape = /tank|t1\b|shell|exchanger|column/.test(n) ? "tank" : /line|rack|pipe|riser|deck piping|transfer/.test(n) ? "rack" : "rect";
    const w = shape === "rack" ? 42 : shape === "tank" ? 18 : 28, h = shape === "rack" ? 10 : shape === "tank" ? 18 : 16;
    if (x + w > 96) { x = 4; y += rowH + 7; rowH = 0; }
    out[a.code] = { x, y, w, h, shape };
    x += w + 5; rowH = Math.max(rowH, h);
  }
  return out;
}

export async function seedGallery({ db, insert, day, org, people }: Ctx) {
  const projects = (await db.query<{ id: string; ref: string; client_company_id: string }>("select id, ref, client_company_id from projects order by ref")).rows;
  for (const p of projects) {
    const areas = (await db.query<{ id: string; code: string; name: string }>("select id, code, name from project_areas where project_id = $1 order by sort", [p.id])).rows;
    const lay = layoutFor(areas);
    for (const a of areas) await db.query("update project_areas set layout = $2 where id = $1", [a.id, JSON.stringify(lay[a.code])]);
    const byCode = Object.fromEntries(areas.map((a) => [a.code, a.id]));
    let first = true;
    for (const [scene, line, stage, cap, capAr, ago, area] of SHOTS[p.ref] ?? []) {
      await insert("project_photos", {
        org_id: org, client_company_id: p.client_company_id, project_id: p.id, area_id: area ? byCode[area] ?? null : null, service_line: line, stage, kind: "illustration",
        src: `/gallery/${scene}.svg`, caption: cap, caption_ar: capAr, taken_on: day(-ago), credit: "Illustration · not an RGS site photo", is_cover: first, uploaded_by: people.ops,
      });
      first = false;
    }
  }
}
