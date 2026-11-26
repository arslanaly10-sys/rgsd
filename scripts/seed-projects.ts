/* SAMPLE multi-service projects for Phase A. All names, quantities, rates and people are fictional. */
import type { Client } from "pg";
import { stagePct, type ServiceLine } from "../src/lib/service-lines";

type Insert = (table: string, row: Record<string, unknown>) => Promise<string>;
type Ctx = {
  db: Client; insert: Insert; day: (o: number) => string; ts: (o: number, h?: number) => string; int: (a: number, b: number) => number;
  org: string; rc: string; cc: Record<string, string>; sites: Record<string, string>; jobs: Record<string, string>; people: Record<string, string>;
};

export async function seedProjects(x: Ctx) {
  const { db, insert, day, ts, int, org, rc, cc, sites, jobs, people } = x;

  // ── More client-side people: consultants (PMC), client HSE, client procurement ──
  await db.query("update profiles set role = 'client_admin', title = 'Client Project Manager' where id = $1", [people.cBargash]);
  const P = (full_name: string, full_name_ar: string, email: string, role: string, title: string, company: string, locale = "en") =>
    insert("profiles", { org_id: org, full_name, full_name_ar, email, role, title, client_company_id: company, locale });
  const pp = {
    pmcBargash: await P("Omar Saeed", "عمر سعيد", "consultant.bargash@demo.rgs", "client_consultant", "Resident Engineer, Gulf Project Consultants (Sample)", cc.bargash),
    finBargash: await P("Layla Hamdan", "ليلى حمدان", "procurement.bargash@demo.rgs", "client_finance", "Procurement Manager", cc.bargash, "ar"),
    qPm: await P("Saad Al-Otaibi", "سعد العتيبي", "client.qiddiya@demo.rgs", "client_admin", "Package Manager", cc.qiddiya, "ar"),
    qPmc: await P("Peter Walsh", "بيتر والش", "consultant.qiddiya@demo.rgs", "client_consultant", "QA/QC Lead, Arena PMC (Sample)", cc.qiddiya),
    qFin: await P("Nora Al-Harbi", "نورة الحربي", "procurement.qiddiya@demo.rgs", "client_finance", "Commercial Manager", cc.qiddiya, "ar"),
    sHse: await P("Ahmed Bakr", "أحمد بكر", "hse.sadara@demo.rgs", "client_hse", "Area HSE Coordinator", cc.sadara),
    sFin: await P("Grace Lim", "غريس ليم", "procurement.sadara@demo.rgs", "client_finance", "Contracts Engineer", cc.sadara),
  };

  // ── SAMPLE rates for waterproofing and insulation ──
  const rates: [string, string, string, string, string, number, string][] = [
    ["WP-APP2", "waterproofing", "APP modified bitumen membrane, 2 × 4 mm, torch-applied", "غشاء بيتوميني معدل APP طبقتان 4 مم", "m2", 85, "waterproofing"],
    ["WP-PU", "waterproofing", "Liquid-applied PU membrane 2 mm", "غشاء بولي يوريثان سائل 2 مم", "m2", 70, "waterproofing"],
    ["WP-PUB", "waterproofing", "PU-bitumen hybrid coating, below grade", "طلاء بولي يوريثان بيتوميني تحت الأرض", "m2", 62, "waterproofing"],
    ["WP-CRY", "waterproofing", "Crystalline waterproofing, 2 coats", "عزل كريستالي طبقتان", "m2", 38, "waterproofing"],
    ["WP-PVC", "waterproofing", "PVC membrane 1.5 mm, mechanically fixed", "غشاء PVC 1.5 مم مثبت ميكانيكياً", "m2", 95, "waterproofing"],
    ["WP-INJ", "waterproofing", "PU crack injection", "حقن الشقوق بالبولي يوريثان", "lm", 120, "waterproofing"],
    ["WP-FLOOD", "testing", "Flood test 48 h incl. report", "اختبار غمر 48 ساعة مع التقرير", "each", 1500, "waterproofing"],
    ["WP-PROT", "protection", "Protection screed 50 mm", "صبة حماية 50 مم", "m2", 32, "waterproofing"],
    ["INS-XPS50", "insulation", "Roof heat insulation XPS 50 mm", "عزل حراري للسطح XPS سماكة 50 مم", "m2", 48, "insulation"],
    ["INS-FOAM", "insulation", "Foam concrete to falls", "خرسانة رغوية للميول", "m3", 380, "insulation"],
    ["INS-MW-S", "insulation", "Hot insulation, mineral wool 50 mm + 0.7 mm Al cladding, 2–4 in pipe", "عزل ساخن صوف صخري 50 مم مع كسوة ألمنيوم، أنابيب 2–4 بوصة", "lm", 165, "insulation"],
    ["INS-MW-L", "insulation", "Hot insulation, mineral wool 75 mm + 0.8 mm Al cladding, 8–12 in pipe", "عزل ساخن صوف صخري 75 مم، أنابيب 8–12 بوصة", "lm", 290, "insulation"],
    ["INS-PIR", "insulation", "Cold insulation PIR 60 mm + vapour barrier + Al cladding", "عزل بارد PIR 60 مم مع حاجز بخار وكسوة ألمنيوم", "lm", 340, "insulation"],
    ["INS-EQ", "insulation", "Equipment insulation + cladding", "عزل المعدات مع الكسوة", "m2", 260, "insulation"],
    ["INS-REMOV", "insulation", "Removable insulation cover (valve / flange)", "غطاء عزل قابل للإزالة (صمام / شفة)", "each", 650, "insulation"],
  ];
  for (const [code, category, description, description_ar, unit, rate, service_line] of rates) {
    await insert("rate_items", { org_id: org, rate_card_id: rc, code, category, description, description_ar, unit, rate, service_line });
  }

  const scaffold = async (site: string, like: string) =>
    (await db.query("select id, tag_no from scaffolds where site_id = $1 and location_desc ilike $2 order by (status = 'yellow') desc, tag_no limit 1", [site, `%${like}%`])).rows[0] as { id: string; tag_no: string } | undefined;

  type AreaDef = { line: ServiceLine; code: string; name: string; name_ar: string; system: string; uom: string; boq: number; rate: number; installed: number; approved: number; stage: string; partial?: number; start: number; finish: number };
  async function project(def: { key: string; ref: string; name: string; name_ar: string; description: string; lines: ServiceLine[]; value: number; po: string; start: number; end: number; dlp: number; consultant?: string; clientPm: string; job?: string; areas: AreaDef[] }) {
    const site = sites[def.key];
    const company = (await db.query("select client_company_id from sites where id = $1", [site])).rows[0].client_company_id;
    const id = await insert("projects", {
      org_id: org, client_company_id: company, site_id: site, job_id: def.job ?? null, ref: def.ref, name: def.name, name_ar: def.name_ar, description: def.description,
      service_lines: def.lines, status: "active", contract_value: def.value, po_number: def.po, start_date: day(def.start), end_date: day(def.end), dlp_months: def.dlp,
      consultant_name: def.consultant ?? null, rgs_pm_id: people.ops, client_pm_id: def.clientPm,
    });
    const areas: Record<string, string> = {};
    let k = 0;
    for (const a of def.areas) {
      const pct = a.installed >= a.boq && a.stage === "complete" ? 100 : stagePct(a.line, a.stage, a.partial ?? 0.5);
      areas[a.code] = await insert("project_areas", {
        org_id: org, client_company_id: company, project_id: id, service_line: a.line, code: a.code, name: a.name, name_ar: a.name_ar, system: a.system, uom: a.uom,
        boq_qty: a.boq, rate: a.rate, installed_qty: a.installed, approved_qty: a.approved, stage: a.stage, stage_pct: pct,
        status: a.stage === "complete" ? "complete" : a.installed > 0 || a.stage !== "not_started" ? "in_progress" : "not_started",
        planned_start: day(a.start), planned_finish: day(a.finish), sort: k++,
      });
      // Daily progress reports that add up to the installed quantity.
      if (a.installed > 0) {
        const n = Math.min(12, Math.max(3, Math.round(a.installed / (a.boq / 10))));
        let left = a.installed;
        for (let d = 0; d < n; d++) {
          const q = d === n - 1 ? left : Math.round(a.installed / n);
          left -= q;
          await insert("progress_entries", { org_id: org, client_company_id: company, project_id: id, area_id: areas[a.code], entry_date: day(-(n - d) * 2), qty: q, stage: a.stage, notes: d === n - 1 ? "Crew of 8, work continues tomorrow." : null, reported_by: people.sup });
        }
      }
    }
    return { id, company, areas };
  }

  // ── P1: Al Bargash roof & podium waterproofing + roof heat insulation ──
  const p1 = await project({
    key: "bargash", ref: "PRJ-26-001", name: "Al Bargash Tower · Roof & Podium Waterproofing and Heat Insulation", name_ar: "برج البرقاش · العزل المائي والحراري للسطح والمنصة",
    description: "Main roof L32 and podium deck: APP 2-layer membrane, XPS 50 mm with foam concrete to falls, PU membrane on podium, crystalline in planters. 10-year RGS + manufacturer warranty (sample).",
    lines: ["waterproofing", "insulation"], value: 1465000, po: "BRG-2026-071", start: -70, end: 50, dlp: 24, consultant: "Gulf Project Consultants (Sample)", clientPm: people.cBargash,
    areas: [
      { line: "waterproofing", code: "WP-R1", name: "Main roof L32 waterproofing", name_ar: "العزل المائي للسطح الرئيسي", system: "APP 2 × 4 mm torch-on", uom: "m2", boq: 1850, rate: 85, installed: 1850, approved: 1500, stage: "flood_test", partial: 0.6, start: -60, finish: -10 },
      { line: "insulation", code: "IN-R1", name: "Main roof heat insulation", name_ar: "العزل الحراري للسطح الرئيسي", system: "XPS 50 mm + foam concrete to falls", uom: "m2", boq: 1850, rate: 48, installed: 1400, approved: 1100, stage: "insulation", partial: 0.75, start: -30, finish: 10 },
      { line: "waterproofing", code: "WP-P1", name: "Podium deck", name_ar: "سطح المنصة", system: "Liquid PU 2 mm", uom: "m2", boq: 2400, rate: 70, installed: 900, approved: 0, stage: "membrane", partial: 0.35, start: -20, finish: 25 },
      { line: "waterproofing", code: "WP-PL", name: "Planters & wet areas", name_ar: "أحواض الزراعة والمناطق الرطبة", system: "Crystalline 2 coats", uom: "m2", boq: 620, rate: 38, installed: 0, approved: 0, stage: "not_started", start: 10, finish: 35 },
    ],
  });
  // ── P2: Qiddiya basement & water tank waterproofing ──
  const p2 = await project({
    key: "qiddiya", ref: "PRJ-26-002", name: "Qiddiya Arena · Basement and Water Tank Waterproofing", name_ar: "ساحة القدية · العزل المائي للقبو وخزان المياه",
    description: "B2 retaining walls crystalline, raft PU-bitumen, potable water tank T1 PU (NSF-type potable grade, sample). Flood tests witnessed by the PMC.",
    lines: ["waterproofing"], value: 980000, po: "QJV-PO-3402", start: -55, end: 60, dlp: 24, consultant: "Arena PMC (Sample)", clientPm: pp.qPm,
    areas: [
      { line: "waterproofing", code: "WP-B2W", name: "B2 retaining walls", name_ar: "الجدران الاستنادية للقبو B2", system: "Crystalline 2 coats", uom: "m2", boq: 3200, rate: 38, installed: 3200, approved: 3200, stage: "complete", start: -50, finish: -15 },
      { line: "waterproofing", code: "WP-RAFT", name: "Raft foundation", name_ar: "اللبشة الخرسانية", system: "PU-bitumen hybrid", uom: "m2", boq: 4100, rate: 62, installed: 2600, approved: 2000, stage: "membrane", partial: 0.6, start: -35, finish: 20 },
      { line: "waterproofing", code: "WP-T1", name: "Water tank T1 (potable)", name_ar: "خزان المياه T1", system: "PU potable grade 2 mm", uom: "m2", boq: 680, rate: 70, installed: 680, approved: 0, stage: "flood_test", partial: 0.2, start: -25, finish: 0 },
    ],
  });
  // ── P3: Sadara Unit 4 hot & cold insulation during the turnaround ──
  const sdrScaf = await scaffold(sites.sadara, "E-417");
  const p3 = await project({
    key: "sadara", ref: "PRJ-26-003", name: "Sadara Unit 4 · Turnaround Hot & Cold Insulation with Access", name_ar: "صدارة الوحدة 4 · العزل الساخن والبارد مع السقالات",
    description: "PR-4 pipe rack hot lines (mineral wool + aluminium cladding), cold lines (PIR + vapour barrier), E-417 shell, removable covers for CUI inspection points. Access by RGS scaffolds.",
    lines: ["insulation", "scaffolding"], value: 2240000, po: "SDR-PO-78550", start: -40, end: 40, dlp: 12, clientPm: people.cSadara, job: jobs.sadara,
    areas: [
      { line: "insulation", code: "IN-H1", name: "PR-4 hot lines 2–4 in", name_ar: "خطوط ساخنة 2–4 بوصة", system: "Mineral wool 50 mm + Al 0.7 mm", uom: "lm", boq: 2600, rate: 165, installed: 1900, approved: 1500, stage: "cladding", partial: 0.6, start: -35, finish: 10 },
      { line: "insulation", code: "IN-H2", name: "PR-4 hot lines 8–12 in", name_ar: "خطوط ساخنة 8–12 بوصة", system: "Mineral wool 75 mm + Al 0.8 mm", uom: "lm", boq: 1200, rate: 290, installed: 450, approved: 300, stage: "insulation", partial: 0.4, start: -20, finish: 20 },
      { line: "insulation", code: "IN-C1", name: "Cold lines (chilled water)", name_ar: "الخطوط الباردة", system: "PIR 60 mm + vapour barrier + Al", uom: "lm", boq: 900, rate: 340, installed: 120, approved: 0, stage: "insulation", partial: 0.15, start: -5, finish: 30 },
      { line: "insulation", code: "IN-E1", name: "Exchanger E-417 shell", name_ar: "غلاف المبادل E-417", system: "Mineral wool 75 mm + SS cladding", uom: "m2", boq: 140, rate: 260, installed: 0, approved: 0, stage: "not_started", start: 5, finish: 25 },
      { line: "insulation", code: "IN-RC", name: "Removable covers (CUI points)", name_ar: "أغطية قابلة للإزالة", system: "Removable jackets", uom: "each", boq: 60, rate: 650, installed: 18, approved: 18, stage: "cladding", partial: 0.3, start: -15, finish: 30 },
    ],
  });
  // ── P4: Karan offshore insulation reinstatement working from RGS scaffolds ──
  const krnScaf = await scaffold(sites.karan, "Riser");
  const p4 = await project({
    key: "karan", ref: "PRJ-26-004", name: "Karan 52/60 · Offshore Insulation Reinstatement", name_ar: "كران 52/60 · إعادة العزل البحري",
    description: "Reinstate insulation and cladding after corrosion repairs on cellar deck and riser balcony. All work at height from RGS scaffolds; boat transfer weather windows apply.",
    lines: ["insulation", "scaffolding"], value: 1120000, po: "4500121560", start: -25, end: 65, dlp: 12, clientPm: people.cAramco, job: jobs.karan,
    areas: [
      { line: "insulation", code: "IN-K1", name: "Cellar deck piping 2–4 in", name_ar: "أنابيب السطح السفلي", system: "Mineral wool 50 mm + Al 0.7 mm", uom: "lm", boq: 1200, rate: 205, installed: 300, approved: 0, stage: "insulation", partial: 0.3, start: -15, finish: 30 },
      { line: "insulation", code: "IN-K2", name: "Riser balcony 8–12 in", name_ar: "شرفة الرافعة", system: "Mineral wool 75 mm + Al 0.8 mm", uom: "lm", boq: 380, rate: 360, installed: 0, approved: 0, stage: "not_started", start: 5, finish: 40 },
      { line: "insulation", code: "IN-K3", name: "Removable covers", name_ar: "أغطية قابلة للإزالة", system: "Removable jackets", uom: "each", boq: 40, rate: 820, installed: 0, approved: 0, stage: "not_started", start: 10, finish: 50 },
    ],
  });

  // ── Milestones ──
  const M = (p: { id: string; company: string }, name: string, name_ar: string, due: number, status: string, line: string | null, forecast?: number, achieved?: number, sort = 0) =>
    insert("milestones", { org_id: org, client_company_id: p.company, project_id: p.id, service_line: line, name, name_ar, due_date: day(due), forecast_date: forecast != null ? day(forecast) : null, status, achieved_at: achieved != null ? day(achieved) : null, sort });
  await M(p1, "Main roof membrane complete", "اكتمال غشاء السطح الرئيسي", -10, "achieved", "waterproofing", undefined, -12, 0);
  await M(p1, "Main roof flood test passed", "نجاح اختبار الغمر للسطح", -3, "pending", "waterproofing", 2, undefined, 1);
  await M(p1, "Podium waterproofing complete", "اكتمال عزل المنصة", 25, "pending", "waterproofing", 28, undefined, 2);
  await M(p1, "Handover & warranty certificates", "التسليم وشهادات الضمان", 50, "pending", null, 52, undefined, 3);
  await M(p2, "B2 walls complete", "اكتمال جدران B2", -15, "achieved", "waterproofing", undefined, -16, 0);
  await M(p2, "Tank T1 flood test witnessed", "اختبار غمر الخزان بحضور الاستشاري", 0, "pending", "waterproofing", 1, undefined, 1);
  await M(p2, "Raft waterproofing complete", "اكتمال عزل اللبشة", 20, "pending", "waterproofing", 32, undefined, 2);
  await M(p3, "PR-4 bays 1–6 hot insulation", "عزل الخطوط الساخنة للفتحات 1–6", -5, "achieved", "insulation", undefined, -6, 0);
  await M(p3, "Cold lines insulated", "اكتمال عزل الخطوط الباردة", 15, "pending", "insulation", 22, undefined, 1);
  await M(p3, "Turnaround mechanical completion", "الإنجاز الميكانيكي للإيقاف الدوري", 40, "pending", null, 40, undefined, 2);
  await M(p4, "Cellar deck complete", "اكتمال السطح السفلي", 30, "pending", "insulation", 34, undefined, 0);
  await M(p4, "Riser balcony complete", "اكتمال شرفة الرافعة", 45, "pending", "insulation", 45, undefined, 1);

  // ── Dependencies (work cannot start or continue until these are met) ──
  const D = (p: { id: string; company: string; areas: Record<string, string> }, area: string | null, kind: string, description: string, owner: string, status: string, due: number | null, scaffoldId?: string | null) =>
    insert("dependencies", { org_id: org, client_company_id: p.company, project_id: p.id, area_id: area ? p.areas[area] : null, kind, description, owner_side: owner, status, due_date: due != null ? day(due) : null, scaffold_id: scaffoldId ?? null, met_at: status === "met" ? ts(-5) : null });
  await D(p1, "WP-P1", "work_front", "Podium deck released by the main contractor (MEP sleeves complete)", "client", "met", -22);
  await D(p1, "WP-PL", "client_info", "Confirm planter drainage outlet positions (drawing rev C)", "client", "open", -2);
  await D(p1, "WP-P1", "submittal", "PU membrane material submittal approved (code A or B)", "rgs", "met", -25);
  await D(p1, "WP-R1", "weather", "No torch-on work when substrate is above 45 °C or during sandstorms; work 05:00–11:00 in summer", "rgs", "open", null);
  await D(p2, "WP-RAFT", "work_front", "Raft area C concrete pour and curing (main contractor schedule)", "client", "blocked", -4);
  await D(p2, "WP-RAFT", "permit", "Dewatering kept running until waterproofing and protection are complete", "client", "met", -30);
  await D(p2, "WP-T1", "material", "Potable-water suitability certificate for tank coating submitted", "rgs", "met", -10);
  await D(p3, "IN-E1", "cross_service", `Scaffold ${sdrScaf?.tag_no ?? "at E-417"} must be green-tagged before insulators start on the shell`, "rgs", sdrScaf ? "blocked" : "open", 5, sdrScaf?.id);
  await D(p3, "IN-C1", "material", "PIR sections and vapour-barrier mastic delivery (supplier ETA)", "rgs", "open", 3);
  await D(p3, null, "permit", "Cold work permit per area from Sadara PTW office each shift", "client", "met", null);
  await D(p4, "IN-K2", "cross_service", `Scaffold ${krnScaf?.tag_no ?? "on riser balcony"} must be green-tagged (riser balcony access)`, "rgs", "open", 5, krnScaf?.id);
  await D(p4, null, "weather", "Supply boat weather window: Hs below 1.5 m and wind below 25 kn for crew transfer", "client", "open", null);

  // ── Instructions → variations ──
  const si1 = await insert("instructions", { org_id: org, client_company_id: p1.company, project_id: p1.id, ref: "SI-26-0007", title: "Waterproof 14 new AHU plinths on the main roof", description: "Additional AHU plinths added by MEP (drawing M-RF-210 rev D). Waterproof and detail upstands before membrane protection.", issued_by: people.cBargash, issued_at: ts(-6), status: "vo_required", response: "Agreed. Priced as VO-26-0004 (upstand detailing + 2-layer APP on plinths)." });
  const vo1 = await insert("variations", { org_id: org, client_company_id: p1.company, project_id: p1.id, instruction_id: si1, ref: "VO-26-0004", title: "AHU plinth waterproofing (14 nos)", description: "APP 2-layer on plinth tops and upstands, angle fillets, termination bars.", lines: [{ description: "APP 2 × 4 mm on plinths and upstands", qty: 420, uom: "m2", rate: 85, amount: 35700 }, { description: "Angle fillets and termination bars", qty: 14, uom: "each", rate: 450, amount: 6300 }, { description: "Flood test (roof section)", qty: 3, uom: "each", rate: 1600, amount: 4800 }], amount: 46800, days_impact: 3, status: "submitted", submitted_at: ts(-3), created_by: people.est });
  const si2 = await insert("instructions", { org_id: org, client_company_id: p2.company, project_id: p2.id, ref: "SI-26-0009", title: "Extend raft waterproofing to 3 lift pits and 2 sump pits", description: "Lift pits LP-1 to LP-3 and sumps SP-1, SP-2 deepened per structural rev F.", issued_by: pp.qPm, issued_at: ts(-8), status: "vo_required", response: "Priced as VO-26-0005, including crystalline to pit walls and PU-bitumen to bases." });
  const vo2 = await insert("variations", { org_id: org, client_company_id: p2.company, project_id: p2.id, instruction_id: si2, ref: "VO-26-0005", title: "Lift pit and sump waterproofing", description: "Crystalline on walls, PU-bitumen on bases, injection at construction joints.", lines: [{ description: "Crystalline 2 coats, pit walls", qty: 1450, uom: "m2", rate: 38, amount: 55100 }, { description: "PU-bitumen, pit bases", qty: 640, uom: "m2", rate: 62, amount: 39680 }, { description: "PU injection at joints", qty: 280, uom: "lm", rate: 120, amount: 33600 }], amount: 128380, days_impact: 6, status: "submitted", submitted_at: ts(-2), created_by: people.est });
  await insert("instructions", { org_id: org, client_company_id: p4.company, project_id: p4.id, ref: "SI-26-0011", title: "Replace damaged cladding on 6 additional spools (cellar deck)", description: "Found during inspection on 22 Nov. Spools CD-31 to CD-36.", issued_by: people.cAramco, issued_at: ts(-1), status: "issued" });

  // ── Measurements and the sign-off inbox ──
  const signoff = (p: { id: string; company: string }, kind: string, entity_type: string, entity_id: string | null, title: string, title_ar: string, summary: string, amount: number | null, roles: string[], due: number, status = "pending", approvals: unknown[] = []) =>
    insert("signoffs", { org_id: org, client_company_id: p.company, project_id: p.id, kind, entity_type, entity_id, title, title_ar, summary, amount, required_roles: roles, approvals: JSON.stringify(approvals), status, requested_by: people.ops, requested_at: ts(-2), due_date: day(due), decided_at: status === "pending" ? null : ts(-20) });
  const ms1 = await insert("measurements", { org_id: org, client_company_id: p1.company, project_id: p1.id, ref: "MS-26-0012", period_from: day(-30), period_to: day(-5), status: "submitted", submitted_by: people.ops,
    lines: [{ code: "WP-R1", name: "Main roof L32 waterproofing", uom: "m2", prev_qty: 1500, this_qty: 350, cum_qty: 1850, rate: 85, amount: 29750 }, { code: "IN-R1", name: "Main roof heat insulation", uom: "m2", prev_qty: 1100, this_qty: 300, cum_qty: 1400, rate: 48, amount: 14400 }, { code: "WP-P1", name: "Podium deck", uom: "m2", prev_qty: 0, this_qty: 900, cum_qty: 900, rate: 70, amount: 63000 }],
    total_value: 107150 });
  await signoff(p1, "measurement", "measurement", ms1, "Measurement sheet MS-26-0012 (November)", "كشف الكميات MS-26-0012 (نوفمبر)", "Roof waterproofing 350 m², roof insulation 300 m², podium 900 m² this period.", 107150, ["client_admin", "client_consultant"], 3);
  await signoff(p1, "variation", "variation", vo1, "VO-26-0004 AHU plinth waterproofing", "أمر تغيير VO-26-0004", "From your instruction SI-26-0007. +3 days.", 46800, ["client_admin"], 4);
  await signoff(p2, "variation", "variation", vo2, "VO-26-0005 Lift pit and sump waterproofing", "أمر تغيير VO-26-0005", "From your instruction SI-26-0009. Above SAR 100,000: needs the package manager and procurement. +6 days.", 128380, ["client_admin", "client_finance"], 5);
  await signoff(p2, "hold_point", "project_area", p2.areas["WP-T1"], "Hold point: 48 h flood test, water tank T1", "نقطة توقف: اختبار الغمر 48 ساعة للخزان T1", "Tank filled 26 Nov 06:00. Witness the level check at 06:00 on 28 Nov before draining.", null, ["client_consultant"], 2);
  const ms0 = await insert("measurements", { org_id: org, client_company_id: p3.company, project_id: p3.id, ref: "MS-26-0010", period_from: day(-40), period_to: day(-12), status: "approved", submitted_by: people.ops,
    lines: [{ code: "IN-H1", name: "PR-4 hot lines 2–4 in", uom: "lm", prev_qty: 0, this_qty: 1500, cum_qty: 1500, rate: 165, amount: 247500 }, { code: "IN-H2", name: "PR-4 hot lines 8–12 in", uom: "lm", prev_qty: 0, this_qty: 300, cum_qty: 300, rate: 290, amount: 87000 }, { code: "IN-RC", name: "Removable covers", uom: "each", prev_qty: 0, this_qty: 18, cum_qty: 18, rate: 650, amount: 11700 }],
    total_value: 346200 });
  await signoff(p3, "measurement", "measurement", ms0, "Measurement sheet MS-26-0010 (October)", "كشف الكميات MS-26-0010 (أكتوبر)", "Approved.", 346200, ["client_admin"], -10, "approved", [{ role: "client_admin", user_id: people.cSadara, name: "Elena Petrova", decision: "approved", at: ts(-11) }]);

  void int;
  return { projects: [p1, p2, p3, p4].map((p) => p.id) };
}
