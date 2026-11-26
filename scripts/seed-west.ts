/* SAMPLE western-region projects (Jeddah, Makkah, Rabigh). All companies, people, quantities and rates are fictional. */
import type { Client } from "pg";
import { stagePct, type ServiceLine } from "../src/lib/service-lines";

type Insert = (table: string, row: Record<string, unknown>) => Promise<string>;
type Ctx = { db: Client; insert: Insert; day: (o: number) => string; org: string; people: Record<string, string> };

export async function seedWest({ db, insert, day, org, people }: Ctx) {
  const company = (name: string, name_ar: string, vat: string, oracle: string) => insert("client_companies", { org_id: org, name, name_ar, vat_number: vat, oracle_customer_id: oracle });
  const cc = {
    jeddah: await company("Red Sea Gateway Developments (Sample)", "بوابة البحر الأحمر للتطوير (عينة)", "300000000000403", "C-10110"),
    makkah: await company("Makkah Hospitality Towers Co. (Sample)", "شركة أبراج مكة للضيافة (عينة)", "300000000000503", "C-10124"),
    rabigh: await company("West Coast Refining (Sample)", "الساحل الغربي للتكرير (عينة)", "300000000000603", "C-10131"),
  };
  const P = (full_name: string, full_name_ar: string, email: string, role: string, title: string, c: string, locale = "en") =>
    insert("profiles", { org_id: org, full_name, full_name_ar, email, role, title, client_company_id: c, locale });
  const pp = {
    jPm: await P("Rakan Al-Sulami", "راكان السلمي", "client.jeddah@demo.rgs", "client_admin", "Development Manager", cc.jeddah, "ar"),
    jPmc: await P("Sofia Marques", "صوفيا ماركيز", "consultant.jeddah@demo.rgs", "client_consultant", "Resident Engineer, Coastal PMC (Sample)", cc.jeddah),
    mPm: await P("Abdulrahman Al-Hindi", "عبدالرحمن الهندي", "client.makkah@demo.rgs", "client_admin", "Facilities Director", cc.makkah, "ar"),
    rPm: await P("Mazen Al-Juhani", "مازن الجهني", "client.rabigh@demo.rgs", "client_admin", "Turnaround Manager", cc.rabigh),
  };
  const site = (c: string, code: string, name: string, name_ar: string, type: string, city: string, lat: number, lng: number, access: string) =>
    insert("sites", { org_id: org, client_company_id: c, code, name, name_ar, type, city, region: "Makkah Province", lat, lng, access_requirements: access });
  const sites = {
    jeddah: await site(cc.jeddah, "JED", "Corniche Residences Tower 2", "أبراج كورنيش ريزيدنس 2", "high_rise", "Jeddah", 21.6, 39.11,
      "Urban site on the Corniche. Deliveries 23:00–06:00. High humidity: check dew point before coating; marine air, stainless fixings only."),
    makkah: await site(cc.makkah, "MKH", "Al Aziziyah Hotel Towers", "أبراج فندق العزيزية", "high_rise", "Makkah", 21.41, 39.87,
      "Inside the Haram boundary: only Muslim crew may enter, check before assigning. No work permits during Hajj; reduced hours in Ramadan; deliveries outside prayer times. Summer midday outdoor work ban 12:00–15:00 (15 Jun – 15 Sep)."),
    rabigh: await site(cc.rabigh, "RBG", "Rabigh Coastal Refinery · CDU-2", "مصفاة رابغ الساحلية · وحدة التقطير 2", "petrochemical", "Rabigh", 22.8, 39.03,
      "Plant induction, H2S awareness and gas test before entry; permit-to-work per job. Turnaround window, 24 h shifts."),
  };

  type A = { line: ServiceLine; code: string; name: string; name_ar: string; system: string; uom: string; boq: number; rate: number; installed: number; approved: number; stage: string; partial?: number; start: number; finish: number };
  async function project(def: { key: keyof typeof sites; ref: string; name: string; name_ar: string; description: string; lines: ServiceLine[]; value: number; po: string; start: number; end: number; dlp: number; consultant?: string; clientPm: string; areas: A[] }) {
    const c = cc[def.key];
    const id = await insert("projects", {
      org_id: org, client_company_id: c, site_id: sites[def.key], ref: def.ref, name: def.name, name_ar: def.name_ar, description: def.description,
      service_lines: def.lines, status: "active", contract_value: def.value, po_number: def.po, start_date: day(def.start), end_date: day(def.end), dlp_months: def.dlp,
      consultant_name: def.consultant ?? null, rgs_pm_id: people.ops, client_pm_id: def.clientPm,
    });
    let k = 0;
    for (const a of def.areas) {
      const aid = await insert("project_areas", {
        org_id: org, client_company_id: c, project_id: id, service_line: a.line, code: a.code, name: a.name, name_ar: a.name_ar, system: a.system, uom: a.uom,
        boq_qty: a.boq, rate: a.rate, installed_qty: a.installed, approved_qty: a.approved, stage: a.stage, stage_pct: a.stage === "complete" ? 100 : stagePct(a.line, a.stage, a.partial ?? 0.5),
        status: a.stage === "complete" ? "complete" : a.installed > 0 || a.stage !== "not_started" ? "in_progress" : "not_started", planned_start: day(a.start), planned_finish: day(a.finish), sort: k++,
      });
      if (a.installed > 0) for (let d = 0; d < 4; d++) await insert("progress_entries", { org_id: org, client_company_id: c, project_id: id, area_id: aid, entry_date: day(-(4 - d) * 3), qty: d === 3 ? a.installed - 3 * Math.round(a.installed / 4) : Math.round(a.installed / 4), stage: a.stage, reported_by: people.sup });
    }
    return { id, company: c };
  }
  const M = (p: { id: string; company: string }, name: string, name_ar: string, due: number, status: string, line: string | null, forecast?: number, sort = 0) =>
    insert("milestones", { org_id: org, client_company_id: p.company, project_id: p.id, service_line: line, name, name_ar, due_date: day(due), forecast_date: forecast != null ? day(forecast) : null, status, achieved_at: status === "achieved" ? day(due - 1) : null, sort });

  const p5 = await project({
    key: "jeddah", ref: "PRJ-26-005", name: "Corniche Residences T2 · Basement, Podium and Roof Waterproofing with Heat Insulation", name_ar: "كورنيش ريزيدنس 2 · العزل المائي للقبو والمنصة والسطح مع العزل الحراري",
    description: "High water table on the Corniche: B1–B2 PU-bitumen tanking with protection board, podium PVC membrane, roof APP + XPS heat insulation and white reflective coat. 10-year joint warranty (sample).",
    lines: ["waterproofing", "insulation"], value: 1780000, po: "RSG-PO-2210", start: -45, end: 75, dlp: 24, consultant: "Coastal PMC (Sample)", clientPm: pp.jPm,
    areas: [
      { line: "waterproofing", code: "WP-B12", name: "B1–B2 retaining walls tanking", name_ar: "عزل جدران القبو B1–B2", system: "PU-bitumen + protection board", uom: "m2", boq: 4200, rate: 62, installed: 2900, approved: 2400, stage: "membrane", partial: 0.75, start: -40, finish: 10 },
      { line: "waterproofing", code: "WP-POD", name: "Podium deck", name_ar: "سطح المنصة", system: "PVC 1.5 mm mechanically fixed", uom: "m2", boq: 2600, rate: 95, installed: 600, approved: 0, stage: "membrane", partial: 0.2, start: -10, finish: 35 },
      { line: "waterproofing", code: "WP-RF", name: "Main roof membrane", name_ar: "غشاء السطح الرئيسي", system: "APP 2 × 4 mm", uom: "m2", boq: 1450, rate: 85, installed: 0, approved: 0, stage: "not_started", start: 20, finish: 55 },
      { line: "insulation", code: "IN-RF", name: "Roof heat insulation & reflective coat", name_ar: "العزل الحراري للسطح والطلاء العاكس", system: "XPS 50 mm + SRI ≥ 78 coating", uom: "m2", boq: 1450, rate: 58, installed: 0, approved: 0, stage: "not_started", start: 35, finish: 70 },
    ],
  });
  await M(p5, "B2 walls tanked and protected", "اكتمال عزل جدران B2", -2, "missed", "waterproofing", 6, 0);
  await M(p5, "Podium membrane complete", "اكتمال غشاء المنصة", 35, "pending", "waterproofing", undefined, 1);
  await M(p5, "Roof flood test passed", "نجاح اختبار الغمر للسطح", 60, "pending", "waterproofing", undefined, 2);

  const p6 = await project({
    key: "makkah", ref: "PRJ-26-006", name: "Al Aziziyah Hotel Towers · Roof Heat-proofing, Waterproofing and Access Scaffold", name_ar: "أبراج فندق العزيزية · العزل الحراري والمائي للأسطح مع السقالات",
    description: "Three tower roofs re-proofed before the season: strip old screed, liquid PU membrane, XPS heat insulation, foam concrete to falls, tiled finish. Edge access scaffold on each roof. Work sequenced around Hajj and Ramadan.",
    lines: ["insulation", "waterproofing", "scaffolding"], value: 1390000, po: "MHT-0094", start: -30, end: 50, dlp: 24, clientPm: pp.mPm,
    areas: [
      { line: "scaffolding", code: "SC-EDGE", name: "Roof edge access scaffold (3 towers)", name_ar: "سقالات حواف الأسطح", system: "System scaffold with edge protection", uom: "m3", boq: 1800, rate: 11, installed: 1800, approved: 1800, stage: "handover", partial: 1, start: -28, finish: -18 },
      { line: "waterproofing", code: "WP-TA", name: "Tower A roof membrane", name_ar: "غشاء سطح البرج A", system: "Liquid PU 2 mm", uom: "m2", boq: 1100, rate: 70, installed: 1100, approved: 900, stage: "flood_test", partial: 0.5, start: -20, finish: 0 },
      { line: "insulation", code: "IN-TA", name: "Tower A heat insulation", name_ar: "العزل الحراري للبرج A", system: "XPS 50 mm + foam concrete", uom: "m2", boq: 1100, rate: 48, installed: 0, approved: 0, stage: "not_started", start: 2, finish: 18 },
      { line: "waterproofing", code: "WP-TB", name: "Tower B roof membrane", name_ar: "غشاء سطح البرج B", system: "Liquid PU 2 mm", uom: "m2", boq: 1050, rate: 70, installed: 420, approved: 0, stage: "membrane", partial: 0.4, start: -8, finish: 15 },
    ],
  });
  await M(p6, "Edge scaffold handed over", "تسليم سقالات الحواف", -18, "achieved", "scaffolding", undefined, 0);
  await M(p6, "Tower A flood test witnessed", "حضور اختبار الغمر للبرج A", 1, "pending", "waterproofing", undefined, 1);
  await M(p6, "All roofs complete before the season", "اكتمال جميع الأسطح قبل الموسم", 48, "pending", null, undefined, 2);

  const p7 = await project({
    key: "rabigh", ref: "PRJ-26-007", name: "Rabigh CDU-2 Turnaround · Hot Insulation and Access Scaffolding", name_ar: "رابغ وحدة التقطير 2 · العزل الساخن والسقالات",
    description: "Crude column and furnace transfer lines: strip, CUI inspection windows, reinstate mineral wool + aluminium cladding; access scaffolds up to 42 m on the column.",
    lines: ["scaffolding", "insulation"], value: 2650000, po: "WCR-PO-5571", start: -20, end: 35, dlp: 12, clientPm: pp.rPm,
    areas: [
      { line: "scaffolding", code: "SC-COL", name: "Crude column C-201 access (42 m)", name_ar: "سقالات برج التقطير C-201", system: "Tube & coupler, 21 lifts", uom: "m3", boq: 6200, rate: 14.5, installed: 5000, approved: 4200, stage: "erection", partial: 0.8, start: -18, finish: -2 },
      { line: "insulation", code: "IN-TL", name: "Furnace transfer lines 16–24 in", name_ar: "خطوط النقل من الفرن", system: "Mineral wool 100 mm + Al 1.0 mm", uom: "lm", boq: 520, rate: 420, installed: 160, approved: 0, stage: "insulation", partial: 0.35, start: -10, finish: 20 },
      { line: "insulation", code: "IN-COL", name: "Column C-201 shell", name_ar: "غلاف البرج C-201", system: "Mineral wool 75 mm + Al cladding", uom: "m2", boq: 900, rate: 260, installed: 0, approved: 0, stage: "not_started", start: 0, finish: 28 },
    ],
  });
  await M(p7, "C-201 scaffold handed over", "تسليم سقالات البرج", -2, "missed", "scaffolding", 2, 0);
  await M(p7, "Transfer lines reinstated", "إعادة عزل خطوط النقل", 20, "pending", "insulation", undefined, 1);

  return { projects: [p5, p6, p7].map((p) => p.id) };
}
