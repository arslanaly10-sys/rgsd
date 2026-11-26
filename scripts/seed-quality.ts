/* SAMPLE quality, HSE, document control and warranty data for Phase B. All content is fictional. */
import type { Client } from "pg";
import { STAGES, type ServiceLine } from "../src/lib/service-lines";
import { TEMPLATES, templateFor } from "../src/lib/quality-templates";

type Insert = (table: string, row: Record<string, unknown>) => Promise<string>;
type Ctx = { db: Client; insert: Insert; day: (o: number) => string; ts: (o: number, h?: number) => string; org: string; people: Record<string, string> };

const READING: Record<string, (string | number)[]> = {
  moisture: [3.8, 4.1, 3.5], substrate_temp: [38, 41], dew_point: [6.5, 7.1], thickness: [2.3, 2.2, 2.4, 2.1], adhesion: [2.1, 1.9],
  holiday: ["none"], flood_test: ["no_leak"], overlap: [110, 120],
};

export async function seedQuality(x: Ctx) {
  const { db, insert, day, ts, org, people } = x;
  const q = async <T,>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];
  const prof = Object.fromEntries((await q<{ email: string; id: string }>("select email, id from profiles")).map((r) => [r.email, r.id]));

  // ── Templates (RGS standard) ──
  const tpl: Record<string, string> = {};
  for (const t of TEMPLATES) tpl[t.code] = await insert("checklist_templates", { org_id: org, service_line: t.service_line, system: t.system, code: t.code, name: t.name, name_ar: t.name_ar, items: JSON.stringify(t.items), created_by: people.hse });
  // A client-specific variant: Sadara wants a cold-insulation hold point witnessed by their own HSE.
  const sadara = (await q<{ id: string }>("select id from client_companies where name like 'Sadara%'"))[0].id;
  const coldVariant = TEMPLATES.find((t) => t.code === "ITP-IN-COLD")!;
  await insert("checklist_templates", { org_id: org, client_company_id: sadara, service_line: "insulation", system: "cold", code: "ITP-IN-COLD-SDR", name: "Cold insulation, Sadara variant", name_ar: "العزل البارد، نسخة صدارة", version: 1,
    items: JSON.stringify([...coldVariant.items.slice(0, 3), { ...coldVariant.items[3], title: "Final inspection witnessed by Sadara area HSE", criteria: "Sadara QA and HSE both release before cool-down" }]), created_by: people.hse });

  // ── ITP steps per area, consistent with each area's stage ──
  const areas = await q<{ id: string; client_company_id: string; project_id: string; service_line: ServiceLine; system: string | null; stage: string; code: string; project_ref: string }>(
    "select a.id, a.client_company_id, a.project_id, a.service_line, a.system, a.stage, a.code, p.ref project_ref from project_areas a join projects p on p.id = a.project_id order by p.ref, a.sort");
  const stepId: Record<string, string> = {};
  for (const a of areas) {
    const t = templateFor(a.service_line, a.system);
    if (!t) continue;
    const order = STAGES[a.service_line].map((s) => s.key);
    const cur = a.stage === "complete" ? order.length : a.stage === "not_started" ? -1 : order.indexOf(a.stage);
    for (const it of t.items) {
      const si = order.indexOf(it.stage);
      const done = si < cur;
      const atHold = it.kind === "hold" && si === cur && it.test_kind === "flood_test";
      const failedDft = a.code === "WP-RAFT" && it.test_kind === "thickness";
      const readings = done || atHold ? (failedDft ? [2.2, 1.6, 2.3] : READING[it.test_kind ?? ""] ?? []) : [];
      const status = failedDft ? "failed" : atHold ? "awaiting_client" : done ? "passed" : "pending";
      stepId[`${a.code}:${it.seq}`] = await insert("itp_steps", {
        org_id: org, client_company_id: a.client_company_id, project_id: a.project_id, area_id: a.id, template_id: tpl[t.code], seq: it.seq, title: it.title, title_ar: it.title_ar,
        kind: it.kind, test_kind: it.test_kind ?? null, criteria: it.criteria, acceptance: it.acceptance ? JSON.stringify(it.acceptance) : null, status,
        readings: JSON.stringify(readings.map((v, i) => ({ value: v, location: `Point ${i + 1}`, at: ts(-3 - i) }))),
        result_note: failedDft ? "Grid C4 reading 1.6 mm below the 2.0 mm minimum: NCR raised." : atHold ? "Water level marked; waiting for the client witness at 48 h." : null,
        inspected_by: done || atHold || failedDft ? people.insp : null, inspected_at: done || atHold || failedDft ? ts(-3) : null,
      });
    }
  }
  // Flood-test hold points become client sign-offs (Qiddiya's existing one now points at the ITP step; Al Bargash roof gets one).
  await db.query(`update signoffs set entity_type = 'itp_step', entity_id = $1 where kind = 'hold_point' and title ilike '%tank T1%'`, [stepId["WP-T1:6"]]);
  const p1 = (await q<{ id: string; client_company_id: string }>("select id, client_company_id from projects where ref = 'PRJ-26-001'"))[0];
  const roofHold = await insert("signoffs", { org_id: org, client_company_id: p1.client_company_id, project_id: p1.id, kind: "hold_point", entity_type: "itp_step", entity_id: stepId["WP-R1:6"],
    title: "Hold point: 48 h flood test, main roof L32", title_ar: "نقطة توقف: اختبار الغمر 48 ساعة للسطح الرئيسي", summary: "Roof flooded 25 Nov 07:00 to 50 mm. Witness the level and the slab soffit on 27 Nov 07:00.",
    required_roles: ["client_consultant"], approvals: "[]", status: "pending", requested_by: people.insp, requested_at: ts(-1), due_date: day(1) });
  await db.query("update itp_steps set signoff_id = $2 where id = $1", [stepId["WP-R1:6"], roofHold]);
  await db.query("update itp_steps set signoff_id = (select id from signoffs where entity_id = $1 limit 1) where id = $1", [stepId["WP-T1:6"]]);

  // ── Findings with corrective actions ──
  const proj = Object.fromEntries((await q<{ ref: string; id: string; client_company_id: string }>("select ref, id, client_company_id from projects")).map((r) => [r.ref, r]));
  const area = Object.fromEntries(areas.map((a) => [a.code, a.id]));
  let n = 1;
  const F = (prj: string, f: Record<string, unknown>) => insert("findings", { org_id: org, client_company_id: proj[prj].client_company_id, project_id: proj[prj].id, ref: `NCR-26-${String(n++).padStart(3, "0")}`, ...f });
  await F("PRJ-26-002", { area_id: area["WP-RAFT"], itp_step_id: stepId["WP-RAFT:3"], kind: "ncr", source: "itp", severity: "high", title: "Membrane DFT below minimum at raft grid C4", description: "Readings 2.2 / 1.6 / 2.3 mm against 2.0 mm minimum. Area 6 m² around grid C4.", raised_by: people.insp, raised_side: "rgs", status: "verification", due_date: day(2),
    root_cause: "Second coat thinned by the crew to speed up coverage in the heat; no wet-film gauge check on that bay.", correction: "Third coat applied to grid C4 bay; re-measured 2.2–2.4 mm.", corrective_action: "Wet-film gauge readings every 10 m² recorded on the daily report.", preventive_action: "Toolbox talk on mixing ratios and no thinning; supervisor sign-off of wet-film log before next bay.", action_owner: people.sup, action_due: day(-1) });
  await F("PRJ-26-001", { area_id: area["WP-P1"], kind: "observation", source: "client", severity: "medium", title: "Blistering at podium edge near drain D-7", description: "Three blisters about 50 mm diameter, seen during the client walk-down.", raised_by: prof["client.bargash@demo.rgs"], raised_side: "client", status: "open", due_date: day(3), created_at: ts(-1) });
  await F("PRJ-26-003", { area_id: area["IN-H1"], kind: "ncr", source: "inspection", severity: "medium", title: "Cladding overlap 30 mm at PR-4 bay 7", description: "Longitudinal overlap below 50 mm minimum on 4 m of line 6\"-P-4107.", raised_by: people.insp, raised_side: "rgs", status: "closed", due_date: day(-8),
    root_cause: "Sheet cut short to clear a pipe shoe.", correction: "Sheet replaced with correct overlap and a shoe cut-out.", corrective_action: "Pre-cut sheets checked against the pipe-shoe register.", preventive_action: "Added pipe-shoe step to the cladding ITP.", action_owner: people.sup, action_due: day(-10),
    verified_by: people.insp, verified_at: ts(-9), closed_by: prof["client.sadara@demo.rgs"], closed_at: ts(-8) });
  await F("PRJ-26-001", { area_id: area["WP-R1"], kind: "hse", source: "hse", severity: "high", title: "Torch-on work without a dedicated fire watch, roof L32", description: "Observed 13:10; crew of 3 torching with extinguisher 15 m away and no fire watch.", raised_by: people.hse, raised_side: "rgs", status: "closed", due_date: day(-15),
    root_cause: "Fire watch reassigned to material handling.", correction: "Work stopped; fire watch reinstated, extinguishers within 3 m.", corrective_action: "Hot-work permit now names the fire watch; no torching without them.", preventive_action: "Fire-watch roles added to every torch-on JSA across projects.", action_owner: people.hse, action_due: day(-16), verified_by: people.hse, verified_at: ts(-15), closed_by: people.hse, closed_at: ts(-15) });
  await F("PRJ-26-001", { area_id: area["WP-R1"], kind: "punch", source: "handover", severity: "low", title: "Touch up protection screed at parapet corners (4 nos)", raised_by: people.sup, raised_side: "rgs", status: "open", due_date: day(20) });
  await F("PRJ-26-004", { area_id: area["IN-K1"], kind: "observation", source: "client", severity: "low", title: "Insulation offcuts left on cellar deck grating", raised_by: prof["client.aramco@demo.rgs"], raised_side: "client", status: "action_planned", due_date: day(1),
    root_cause: "No waste bin on the cellar deck.", correction: "Area cleaned.", corrective_action: "Waste bag at each work front, end-of-shift housekeeping check.", action_owner: people.sup, action_due: day(1) });

  // ── HSE: man-hours, toolbox talks, permits with JSA, chemicals, waste ──
  const projs = await q<{ id: string; ref: string; client_company_id: string; site_id: string }>("select id, ref, client_company_id, site_id from projects");
  const crew: Record<string, number> = { "PRJ-26-001": 14, "PRJ-26-002": 10, "PRJ-26-003": 22, "PRJ-26-004": 9, "PRJ-26-005": 16, "PRJ-26-006": 12, "PRJ-26-007": 28 };
  for (const p of projs) {
    for (let mth = 2; mth >= 0; mth--) {
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - mth);
      const hc = Math.round(crew[p.ref] * (mth === 2 ? 0.6 : mth === 1 ? 0.9 : 1));
      await insert("manhours", { org_id: org, client_company_id: p.client_company_id, project_id: p.id, site_id: p.site_id, month: d.toISOString().slice(0, 10), hours: hc * 10 * (mth === 0 ? new Date().getUTCDate() : 26), headcount: hc });
    }
  }
  const talks: [string, string, string, string][] = [
    ["PRJ-26-001", "Torch-on hot work: fire watch, extinguishers within 3 m", "العمل الحراري: مراقب الحريق وطفايات على بعد 3 م", "ar"],
    ["PRJ-26-001", "Heat stress: water, shade, work 05:00–11:00", "الإجهاد الحراري: الماء والظل والعمل 05:00–11:00", "ur"],
    ["PRJ-26-002", "PU and primer handling: MSDS, gloves, ventilation in the tank", "التعامل مع البولي يوريثان والبرايمر: صحيفة السلامة والتهوية", "en"],
    ["PRJ-26-002", "Confined space entry: tank T1 gas test and standby", "دخول الأماكن المحصورة: فحص الغاز في الخزان T1", "ar"],
    ["PRJ-26-003", "Cutting cladding sheets: cut-resistant gloves, sharp edges", "قص ألواح الكسوة: قفازات مقاومة للقطع", "hi"],
    ["PRJ-26-003", "Working from scaffolds: check the tag before you climb", "العمل من السقالات: تحقق من البطاقة قبل الصعود", "en"],
    ["PRJ-26-004", "Boat transfer and personnel basket rules", "النقل بالقوارب وسلة الأفراد", "en"],
  ];
  let k = 0;
  for (const [ref, topic, topic_ar, language] of talks) {
    const p = projs.find((x) => x.ref === ref)!;
    await insert("toolbox_talks", { org_id: org, client_company_id: p.client_company_id, project_id: p.id, site_id: p.site_id, held_on: day(-(k++ % 5) - 1), topic, topic_ar, language, attendees: 8 + (k % 9), conducted_by: people.sup });
  }
  const P = (ref: string, f: Record<string, unknown>) => { const p = projs.find((x) => x.ref === ref)!; return insert("permits", { org_id: org, client_company_id: p.client_company_id, project_id: p.id, ...f }); };
  await P("PRJ-26-001", { area_id: area["WP-P1"], ref: "HW-BRG-1182", kind: "hot_work", issued_by: "Main contractor permit office (sample)", valid_from: ts(0, 5), valid_to: ts(0, 11), status: "active",
    jsa: JSON.stringify([{ step: "Torch membrane at upstands", hazard: "Fire, burns", control: "Dedicated fire watch, 2 × 9 kg DCP within 3 m, 60 min watch after" }, { step: "Gas cylinders on roof", hazard: "Leak, explosion", control: "Cylinder trolley, flashback arrestors, leak test at start" }, { step: "Work near roof edge", hazard: "Fall from height", control: "Edge protection inspected, harness inside 2 m of edge" }]) });
  await P("PRJ-26-002", { area_id: area["WP-T1"], ref: "CS-QDY-0331", kind: "confined_space", issued_by: "Arena PMC HSE (sample)", valid_from: ts(-1, 6), valid_to: ts(2, 18), status: "active",
    jsa: JSON.stringify([{ step: "Enter tank T1", hazard: "Oxygen deficiency, solvent vapour", control: "Gas test every 2 h, forced ventilation, standby man, rescue tripod" }]) });
  await P("PRJ-26-003", { ref: "CW-SDR-55410", kind: "cold_work", issued_by: "Sadara PTW office (sample)", valid_from: ts(0, 6), valid_to: ts(0, 18), status: "active", jsa: JSON.stringify([{ step: "Insulate live hot lines", hazard: "Burns from hot surfaces", control: "Line temperature checked, heat-resistant gloves" }]) });
  await P("PRJ-26-004", { area_id: area["IN-K1"], ref: "PTW-KRN-90217", kind: "work_at_height", issued_by: "Platform PTW office (sample)", valid_from: ts(0, 6), valid_to: ts(0, 18), status: "active", jsa: JSON.stringify([{ step: "Work from scaffold over open sea", hazard: "Dropped objects, fall", control: "Tool tethering, green-tagged scaffold only, harness clipped" }]) });
  const chems: [string, string, string, string, string[], string, string][] = [
    ["APP modified bitumen membrane 4 mm (generic)", "غشاء بيتوميني معدل 4 مم", "waterproofing", "Combustible solid", ["GHS02"], "Shaded, upright rolls", "Heat-resistant gloves"],
    ["Bitumen primer, solvent-based (generic)", "برايمر بيتوميني بالمذيبات", "waterproofing", "Flammable liquid Cat. 3", ["GHS02", "GHS07"], "Ventilated, < 35 °C", "Gloves, goggles, respirator in poor ventilation"],
    ["PU waterproofing membrane, 1-component (generic)", "غشاء بولي يوريثان أحادي", "waterproofing", "Sensitiser (isocyanate)", ["GHS07", "GHS08"], "Dry, sealed, 5–30 °C", "Nitrile gloves, goggles, respirator"],
    ["PU-bitumen hybrid coating (generic)", "طلاء بولي يوريثان بيتوميني", "waterproofing", "Irritant", ["GHS07"], "Sealed, shaded", "Gloves, goggles"],
    ["Crystalline waterproofing slurry (generic)", "ملاط عزل كريستالي", "waterproofing", "Corrosive to skin (alkaline)", ["GHS05"], "Dry", "Gloves, goggles, dust mask"],
    ["XPS insulation board (generic)", "ألواح XPS", "insulation", "Combustible", [], "Away from hot work", "Gloves"],
    ["Mineral wool pipe sections (generic)", "مقاطع صوف صخري", "insulation", "Skin/eye irritant (fibres)", [], "Dry, covered", "Long sleeves, gloves, FFP2 mask"],
    ["Vapour barrier mastic (generic)", "مانع بخار (ماستيك)", "insulation", "Flammable", ["GHS02"], "Ventilated, < 30 °C", "Gloves"],
  ];
  for (const [product, product_ar, service_line, hazard_class, ghs, storage, ppe] of chems) await insert("chemical_register", { org_id: org, product, product_ar, service_line, hazard_class, ghs, storage, ppe, msds_revised: day(-200) });
  for (const p of projs) await insert("waste_log", { org_id: org, client_company_id: p.client_company_id, project_id: p.id, logged_on: day(-4), kind: p.ref === "PRJ-26-003" || p.ref === "PRJ-26-004" ? "insulation_offcuts" : "membrane_offcuts", qty: 180 + projs.indexOf(p) * 60, disposal: "Licensed contractor (sample)", manifest_ref: `WM-${2600 + projs.indexOf(p)}` });
  await insert("waste_log", { org_id: org, client_company_id: proj["PRJ-26-002"].client_company_id, project_id: proj["PRJ-26-002"].id, logged_on: day(-2), kind: "empty_containers_hazardous", qty: 46, unit: "each", disposal: "Hazardous waste contractor (sample)", manifest_ref: "HW-0419" });

  // ── Document control: registers with A/B/C/D review history ──
  const D = async (prj: string, number: string, title: string, title_ar: string, doc_type: string, service_line: string | null, handover: boolean, revs: { rev: string; submitted: number | null; code?: string; reviewer?: string; reviewed?: number; due?: number; comments?: { no: number; comment: string; response?: string }[] }[]) => {
    const last = revs.at(-1)!;
    const status = !last.submitted && last.submitted !== 0 ? "draft" : !last.code ? "under_review" : { A: "approved", B: "approved_with_comments", C: "revise_resubmit", D: "rejected" }[last.code]!;
    const id = await insert("controlled_documents", { org_id: org, client_company_id: proj[prj].client_company_id, project_id: proj[prj].id, number, title, title_ar, doc_type, service_line, current_rev: last.rev, status, required_for_handover: handover });
    for (const r of revs) {
      await insert("document_revisions", { org_id: org, client_company_id: proj[prj].client_company_id, controlled_document_id: id, rev: r.rev, transmittal_ref: r.submitted != null ? `TR-${number.split("-")[1]}-${String(100 + revs.indexOf(r))}` : null,
        submitted_by: r.submitted != null ? people.est : null, submitted_at: r.submitted != null ? ts(r.submitted) : null, due_date: r.due != null ? day(r.due) : r.submitted != null ? day(r.submitted + 7) : null,
        review_code: r.code ?? null, reviewed_by: r.reviewer ? prof[r.reviewer] : null, reviewed_at: r.reviewed != null ? ts(r.reviewed) : null,
        comments: JSON.stringify((r.comments ?? []).map((c) => ({ ...c, by: r.reviewer ? "Reviewer" : "" }))) });
    }
    return id;
  };
  await D("PRJ-26-001", "RGS-BRG-MS-001", "Method statement: roof waterproofing and heat insulation", "بيان طريقة العمل: العزل المائي والحراري للسطح", "method_statement", "waterproofing", false,
    [{ rev: "0", submitted: -68, code: "C", reviewer: "consultant.bargash@demo.rgs", reviewed: -64, comments: [{ no: 1, comment: "Add summer working hours and substrate temperature limit.", response: "Added §6.3: 05:00–11:00, ≤ 45 °C." }, { no: 2, comment: "Fire watch duties for torch-on to be described.", response: "Added §8.1." }] }, { rev: "1", submitted: -62, code: "A", reviewer: "consultant.bargash@demo.rgs", reviewed: -60 }]);
  const puSub = await D("PRJ-26-001", "RGS-BRG-MAT-002", "Material submittal: liquid PU membrane system for podium", "اعتماد مواد: نظام البولي يوريثان للمنصة", "material_submittal", "waterproofing", false,
    [{ rev: "0", submitted: -40, code: "B", reviewer: "consultant.bargash@demo.rgs", reviewed: -33, comments: [{ no: 1, comment: "Provide UV-resistance data for exposed areas.", response: "Top coat datasheet attached; podium is covered by pavers." }] }]);
  await db.query("update dependencies set controlled_document_id = $1 where description ilike 'PU membrane material submittal%'", [puSub]);
  const sd = await D("PRJ-26-001", "RGS-BRG-SD-003", "Shop drawing: roof outlets, upstands and AHU plinth details", "مخططات تنفيذية: المصارف والحواف وقواعد وحدات التكييف", "shop_drawing", "waterproofing", true,
    [{ rev: "0", submitted: -20, code: "C", reviewer: "consultant.bargash@demo.rgs", reviewed: -16, comments: [{ no: 1, comment: "Upstand height at plinths to be 150 mm above screed, not slab.", response: "Revised detail 4." }, { no: 2, comment: "Show termination bar and sealant at parapet.", response: "Added detail 7." }] }, { rev: "1", submitted: -8, due: -1 }]);
  void sd;
  await D("PRJ-26-001", "RGS-BRG-ITP-004", "Inspection & test plan: waterproofing and roof insulation", "خطة الفحص والاختبار", "itp", "waterproofing", true, [{ rev: "0", submitted: -66, code: "A", reviewer: "consultant.bargash@demo.rgs", reviewed: -63 }]);
  await D("PRJ-26-001", "RGS-BRG-TR-005", "Flood test report: main roof L32", "تقرير اختبار الغمر: السطح الرئيسي", "test_report", "waterproofing", true, [{ rev: "0", submitted: null }]);
  await D("PRJ-26-001", "RGS-BRG-ASB-006", "As-built drawings: roof and podium waterproofing", "المخططات النهائية المنفذة", "as_built", "waterproofing", true, [{ rev: "0", submitted: null }]);
  await D("PRJ-26-002", "RGS-QDY-MS-001", "Method statement: crystalline and PU-bitumen below grade", "بيان طريقة العمل: العزل تحت الأرض", "method_statement", "waterproofing", false, [{ rev: "0", submitted: -54, code: "A", reviewer: "consultant.qiddiya@demo.rgs", reviewed: -50 }]);
  await D("PRJ-26-002", "RGS-QDY-MAT-002", "Material submittal: potable-grade PU for water tank T1", "اعتماد مواد: بولي يوريثان صالح لمياه الشرب", "material_submittal", "waterproofing", true,
    [{ rev: "0", submitted: -30, code: "B", reviewer: "consultant.qiddiya@demo.rgs", reviewed: -26, comments: [{ no: 1, comment: "Potable-water suitability certificate required before use.", response: "Certificate submitted 16 Nov." }] }]);
  await D("PRJ-26-002", "RGS-QDY-SD-003", "Shop drawing: lift pit and sump waterproofing (VO-26-0005)", "مخططات تنفيذية: حفر المصاعد والبيارات", "shop_drawing", "waterproofing", true, [{ rev: "0", submitted: -2, due: 3 }]);
  await D("PRJ-26-003", "RGS-SDR-MS-001", "Method statement: hot insulation and aluminium cladding", "بيان طريقة العمل: العزل الساخن والكسوة", "method_statement", "insulation", false, [{ rev: "0", submitted: -42, code: "A", reviewer: "client.sadara@demo.rgs", reviewed: -39 }]);
  await D("PRJ-26-003", "RGS-SDR-MS-002", "Method statement: cold insulation with vapour barrier", "بيان طريقة العمل: العزل البارد", "method_statement", "insulation", false,
    [{ rev: "0", submitted: -18, code: "D", reviewer: "client.sadara@demo.rgs", reviewed: -14, comments: [{ no: 1, comment: "Vapour barrier system not on Sadara approved list.", response: "Replaced with approved mastic system." }, { no: 2, comment: "No hold point before cool-down.", response: "Added ITP step 4 as Sadara hold point." }] }, { rev: "1", submitted: -5, due: 2 }]);
  await D("PRJ-26-003", "RGS-SDR-REG-003", "Removable cover register for CUI inspection points", "سجل الأغطية القابلة للإزالة", "other", "insulation", true, [{ rev: "0", submitted: -6, code: "A", reviewer: "client.sadara@demo.rgs", reviewed: -4 }]);
  await D("PRJ-26-004", "RGS-KRN-MS-001", "Method statement: offshore insulation reinstatement", "بيان طريقة العمل: إعادة العزل البحري", "method_statement", "insulation", false, [{ rev: "0", submitted: -24, code: "A", reviewer: "client.aramco@demo.rgs", reviewed: -21 }]);

  // ── Warranty register (starts at completion) ──
  const W = (prj: string, ref: string, areaCode: string | null, system: string, coverage: string, coverage_ar: string, kind: string, years: number, manufacturer: string | null, conditions: string) =>
    insert("warranties", { org_id: org, client_company_id: proj[prj].client_company_id, project_id: proj[prj].id, area_id: areaCode ? area[areaCode] : null, ref, system, coverage, coverage_ar, kind, years, manufacturer, conditions, status: "pending" });
  await W("PRJ-26-001", "WAR-26-001", "WP-R1", "APP 2 × 4 mm torch-on", "Watertightness of the main roof membrane", "إحكام غشاء السطح الرئيسي ضد تسرب المياه", "joint_manufacturer", 10, "Membrane manufacturer (sample)", "Valid with annual inspection of outlets; excludes damage by others and penetrations made after handover.");
  await W("PRJ-26-001", "WAR-26-002", "WP-P1", "Liquid PU 2 mm", "Watertightness of the podium deck", "إحكام سطح المنصة", "joint_manufacturer", 10, "PU system manufacturer (sample)", "Pavers to remain in place; no drilling through the membrane.");
  await W("PRJ-26-001", "WAR-26-003", "IN-R1", "XPS 50 mm + foam concrete", "Thermal insulation performance and falls", "أداء العزل الحراري والميول", "rgs", 5, null, "Excludes damage by others.");
  await W("PRJ-26-002", "WAR-26-004", "WP-B2W", "Crystalline 2 coats", "Below-grade watertightness, B2 walls", "إحكام الجدران تحت الأرض", "joint_manufacturer", 10, "Crystalline manufacturer (sample)", "Excludes structural cracking above 0.4 mm.");
  await W("PRJ-26-002", "WAR-26-005", "WP-T1", "PU potable grade 2 mm", "Watertightness of water tank T1", "إحكام خزان المياه T1", "joint_manufacturer", 10, "PU system manufacturer (sample)", "Annual tank inspection and cleaning to the manufacturer's guide.");
  await W("PRJ-26-003", "WAR-26-006", null, "Hot & cold insulation with cladding", "Workmanship of insulation and cladding", "جودة تنفيذ العزل والكسوة", "rgs", 2, null, "Excludes mechanical damage and removal by others.");
}
