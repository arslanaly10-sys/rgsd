/*
 * Seeds SAMPLE data for demos. Sites are named after public RGS projects (rgsksa.com);
 * every person, number, tag, rate and record below is fictional.
 * Dates are relative to today so the demo always looks current.
 */
import { Client } from "pg";
import { loadEnv } from "./env";

loadEnv();

// Deterministic PRNG so the seed is stable between runs.
let s = 20261126;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const day = (offset: number) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const ts = (offset: number, hour = 9) => `${day(offset)}T${String(hour).padStart(2, "0")}:00:00Z`;

const db = new Client({ connectionString: process.env.DATABASE_URL });

async function insert<T extends Record<string, unknown>>(table: string, row: T): Promise<string> {
  const keys = Object.keys(row);
  const vals = keys.map((k) => {
    const v = row[k];
    return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && v.length && typeof v[0] === "object" ? JSON.stringify(v) : v;
  });
  const sql = `insert into ${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`;
  const r = await db.query(sql, vals);
  return r.rows[0]?.id;
}

async function main() {
  await db.connect();
  await db.query("begin");
  // Clear (child tables cascade from organizations)
  await db.query("delete from audit_log; delete from organizations;");

  const org = await insert("organizations", { name: "Resa Gulf Scaffolding Co. Ltd.", name_ar: "شركة ريسا الخليج للسقالات" });

  // ── Client companies (SAMPLE) ──
  const cc = {
    aramco: await insert("client_companies", { org_id: org, name: "Saudi Aramco · Offshore Projects (Sample)", name_ar: "أرامكو السعودية · المشاريع البحرية (عينة)", vat_number: "300000000000003", oracle_customer_id: "C-10021" }),
    sadara: await insert("client_companies", { org_id: org, name: "Sadara Chemical Company (Sample)", name_ar: "شركة صدارة للكيميائيات (عينة)", vat_number: "300000000000103", oracle_customer_id: "C-10045" }),
    bargash: await insert("client_companies", { org_id: org, name: "Al Bargash Developments (Sample)", name_ar: "البرقاش للتطوير (عينة)", vat_number: "300000000000203", oracle_customer_id: "C-10078" }),
    qiddiya: await insert("client_companies", { org_id: org, name: "Qiddiya Contractors JV (Sample)", name_ar: "تحالف مقاولي القدية (عينة)", vat_number: "300000000000303", oracle_customer_id: "C-10093" }),
  };

  // ── People (fictional) ──
  const P = (full_name: string, full_name_ar: string, email: string, role: string, title: string, client_company_id: string | null = null, locale = "en") =>
    insert("profiles", { org_id: org, full_name, full_name_ar, email, role, title, client_company_id, locale });
  const people = {
    admin: await P("Khalid Al-Mutairi", "خالد المطيري", "admin@demo.rgs", "admin", "Systems Administrator"),
    ops: await P("Imran Qureshi", "عمران قريشي", "ops@demo.rgs", "ops_manager", "Operations Manager"),
    est: await P("Rania Haddad", "رانيا حداد", "estimating@demo.rgs", "estimator", "Senior Estimator"),
    sup: await P("Joseph Mathew", "جوزيف ماثيو", "supervisor@demo.rgs", "site_supervisor", "Site Supervisor · Offshore"),
    insp: await P("Arjun Nair", "أرجون ناير", "inspector@demo.rgs", "inspector", "Scaffold Inspector (CISRS)"),
    yard: await P("Bilal Ahmed", "بلال أحمد", "yard@demo.rgs", "yard_logistics", "Yard & Logistics Lead"),
    hse: await P("Nasser Al-Qahtani", "ناصر القحطاني", "hse@demo.rgs", "hse_training", "HSE & Training Manager", null, "ar"),
    fin: await P("Huda Al-Shehri", "هدى الشهري", "finance@demo.rgs", "finance", "Billing Accountant", null, "ar"),
    cAramco: await P("Mohammed Al-Dossary", "محمد الدوسري", "client.aramco@demo.rgs", "client_admin", "Construction Engineer", cc.aramco, "ar"),
    cSadara: await P("Elena Petrova", "إيلينا بتروفا", "client.sadara@demo.rgs", "client_admin", "Maintenance Planner", cc.sadara),
    cBargash: await P("Faris Al-Ghamdi", "فارس الغامدي", "client.bargash@demo.rgs", "client_user", "Project Manager", cc.bargash, "ar"),
  };

  // ── Sites (named after public RGS projects) ──
  const siteDefs = [
    { key: "karan", cc: cc.aramco, code: "KRN", name: "Karan 52/60 Auxiliary Platforms", name_ar: "منصات كران 52/60 المساعدة", type: "offshore", city: "Arabian Gulf", lat: 27.7, lng: 50.2, access: "Offshore: BOSIET + H2S + Aramco ID required. Crew change by boat from Tanajib, weather window dependent." },
    { key: "safaniyah", cc: cc.aramco, code: "SFN", name: "Safaniyah Offshore Platform", name_ar: "منصة السفانية البحرية", type: "offshore", city: "Safaniyah", lat: 28.0, lng: 48.8, access: "Offshore: BOSIET + H2S + Aramco ID. Hot work permits issued by platform PTW office." },
    { key: "sadara", cc: cc.sadara, code: "SDR", name: "Sadara Chemical Complex · Unit 4", name_ar: "مجمع صدارة للكيميائيات · الوحدة 4", type: "petrochemical", city: "Jubail", lat: 27.0, lng: 49.6, access: "Plant induction, gas test before entry, permit-to-work per job. Turnaround window in Q1." },
    { key: "bargash", cc: cc.bargash, code: "BRG", name: "Al Bargash Tower · Facade Mast Climbers", name_ar: "برج البرقاش · منصات الواجهات", type: "high_rise", city: "Khobar", lat: 26.28, lng: 50.21, access: "Urban site, deliveries 22:00–05:00 only (municipality). Mast climber operators need TÜV card." },
    { key: "qiddiya", cc: cc.qiddiya, code: "QDY", name: "Qiddiya Skyline Package", name_ar: "حزمة أفق القدية", type: "entertainment", city: "Riyadh", lat: 24.6, lng: 46.2, access: "Remote site, 45 km from Riyadh. Daily wind check: stop work above 38 km/h on exposed lifts." },
    { key: "marine", cc: cc.aramco, code: "RTM", name: "Ras Tanura Marine Terminal Jetty", name_ar: "رصيف رأس تنورة البحري", type: "marine", city: "Ras Tanura", lat: 26.64, lng: 50.16, access: "Marine: corrosion-resistant galvanised components only. Life jackets mandatory over water." },
  ] as const;
  const sites: Record<string, string> = {};
  for (const d of siteDefs) {
    sites[d.key] = await insert("sites", { org_id: org, client_company_id: d.cc, code: d.code, name: d.name, name_ar: d.name_ar, type: d.type, city: d.city, region: "Eastern Province", lat: d.lat, lng: d.lng, access_requirements: d.access });
  }
  await db.query("update sites set region = 'Riyadh' where code = 'QDY'");
  const siteCc = Object.fromEntries(siteDefs.map((d) => [d.key, d.cc]));

  // ── Rate card (SAMPLE, editable by admin) ──
  const rc = await insert("rate_cards", { org_id: org, name: "Standard Rate Card 2026 (SAMPLE)", is_sample: true, valid_from: day(-330) });
  const rates: [string, string, string, string, string, number][] = [
    ["ERC-TC", "erection", "Erect tube & coupler scaffold", "تركيب سقالة أنابيب ووصلات", "m3", 14.5],
    ["ERC-SYS", "erection", "Erect system scaffold (Cuplock/Ringlock)", "تركيب سقالة نظامية", "m3", 11.0],
    ["DSM-TC", "dismantle", "Dismantle tube & coupler scaffold", "فك سقالة أنابيب ووصلات", "m3", 6.0],
    ["DSM-SYS", "dismantle", "Dismantle system scaffold", "فك سقالة نظامية", "m3", 4.5],
    ["RNT-M3W", "rental", "Scaffold material rental", "تأجير مواد السقالات", "week", 1.8],
    ["RNT-MC", "rental", "Mast climber platform rental", "تأجير منصة تسلق الصاري", "month", 18500],
    ["RNT-HST", "rental", "Material/passenger hoist rental", "تأجير رافعة مواد/ركاب", "month", 14200],
    ["MOB-ON", "mobilisation", "Mobilisation onshore (per trip)", "التحريك البري (لكل رحلة)", "trip", 1650],
    ["MOB-OFF", "mobilisation", "Mobilisation offshore incl. marine transfer", "التحريك البحري شامل النقل", "trip", 9800],
    ["UPL-OFF", "uplift", "Offshore working uplift", "علاوة العمل البحري", "pct", 35],
    ["UPL-NIGHT", "uplift", "Night shift uplift", "علاوة الوردية الليلية", "pct", 20],
    ["LAB-SCF", "labour", "Scaffolder (day rate, 10h)", "عامل سقالات (يومي 10 ساعات)", "day", 420],
    ["LAB-SUP", "labour", "Scaffold supervisor (day rate)", "مشرف سقالات (يومي)", "day", 780],
    ["INS-7D", "inspection", "Periodic inspection & tagging (per scaffold)", "فحص دوري ووسم (لكل سقالة)", "each", 95],
    ["DES-CALC", "design", "Engineered design & calculation (per design)", "تصميم هندسي وحسابات", "each", 3800],
    ["TRN-HAUL", "transport", "Haulage flatbed (per trip, Eastern Province)", "نقل بشاحنة مسطحة", "trip", 950],
  ];
  const rateIds: Record<string, string> = {};
  for (const [code, category, description, description_ar, unit, rate] of rates) {
    rateIds[code] = await insert("rate_items", { org_id: org, rate_card_id: rc, code, category, description, description_ar, unit, rate });
  }

  // ── Catalog ──
  const itemDefs: [string, string, string, string, string, number, number, number][] = [
    ["TB-640", "Steel tube 6.4 m (48.3 mm)", "أنبوب فولاذي 6.4 م", "tube", "each", 25.6, 180, 0.35],
    ["TB-400", "Steel tube 4.0 m", "أنبوب فولاذي 4.0 م", "tube", "each", 16.0, 115, 0.25],
    ["TB-300", "Steel tube 3.0 m", "أنبوب فولاذي 3.0 م", "tube", "each", 12.0, 90, 0.2],
    ["TB-150", "Steel tube 1.5 m", "أنبوب فولاذي 1.5 م", "tube", "each", 6.0, 48, 0.12],
    ["CP-DBL", "Double (right-angle) coupler", "وصلة مزدوجة", "fitting", "each", 1.1, 22, 0.05],
    ["CP-SWV", "Swivel coupler", "وصلة دوارة", "fitting", "each", 1.2, 24, 0.05],
    ["CP-SLV", "Sleeve coupler", "وصلة جلبة", "fitting", "each", 1.0, 20, 0.04],
    ["CP-PUT", "Putlog coupler", "وصلة بوتلوغ", "fitting", "each", 0.6, 12, 0.03],
    ["BP-STD", "Base plate", "قاعدة سقالة", "fitting", "each", 1.5, 18, 0.03],
    ["BD-390", "Scaffold board 3.9 m (BS 2482)", "لوح سقالة 3.9 م", "board", "each", 21.0, 95, 0.2],
    ["BD-TOE", "Toe board 2.4 m", "لوح حماية قدم", "board", "each", 9.0, 40, 0.08],
    ["CL-STD3", "Cuplock standard 3.0 m", "قائم كبلوك 3.0 م", "system", "each", 17.3, 160, 0.3],
    ["CL-LED25", "Cuplock ledger 2.5 m", "عارضة كبلوك 2.5 م", "system", "each", 9.2, 95, 0.18],
    ["CL-TRN13", "Cuplock transom 1.3 m", "عرضية كبلوك 1.3 م", "system", "each", 7.0, 80, 0.15],
    ["RL-STD3", "Ringlock standard 3.0 m", "قائم رينغلوك 3.0 م", "system", "each", 15.8, 170, 0.32],
    ["AC-LAD", "Aluminium access ladder 6 m", "سلم ألمنيوم 6 م", "accessory", "each", 18.0, 650, 2.5],
    ["AC-STR", "Stair tower module", "وحدة برج سلالم", "accessory", "each", 85.0, 4200, 12],
    ["MC-UNIT", "Mast climbing work platform (twin mast)", "منصة عمل بتسلق الصاري", "mast_climber", "each", 4200, 310000, 610],
    ["HS-2T", "Material hoist 2 t", "رافعة مواد 2 طن", "hoist", "each", 3500, 240000, 470],
    ["PP-HRN", "Full body harness + double lanyard", "حزام أمان كامل", "ppe", "each", 2.2, 450, 1.5],
  ];
  const items: Record<string, { id: string; rate: number }> = {};
  for (const [sku, name, name_ar, category, unit, w, val, rate] of itemDefs) {
    items[sku] = { id: await insert("items", { org_id: org, sku, name, name_ar, category, unit, weight_kg: w, replacement_value: val, rental_rate_day: rate }), rate };
  }

  // ── Locations & stock ──
  const yardDammam = await insert("locations", { org_id: org, kind: "yard", name: "Dammam 2nd Industrial Yard", name_ar: "ساحة الدمام الصناعية الثانية", city: "Dammam" });
  const yardJubail = await insert("locations", { org_id: org, kind: "yard", name: "Jubail Support Yard", name_ar: "ساحة الجبيل المساندة", city: "Jubail" });
  const siteLoc: Record<string, string> = {};
  for (const d of siteDefs) siteLoc[d.key] = await insert("locations", { org_id: org, kind: "site", name: d.name, name_ar: d.name_ar, site_id: sites[d.key], city: d.city });
  const bigQty: Record<string, number> = { "TB-640": 9000, "TB-400": 7000, "TB-300": 6000, "TB-150": 5000, "CP-DBL": 60000, "CP-SWV": 25000, "CP-SLV": 18000, "CP-PUT": 20000, "BP-STD": 9000, "BD-390": 14000, "BD-TOE": 7000, "CL-STD3": 5000, "CL-LED25": 7000, "CL-TRN13": 5000, "RL-STD3": 2500, "AC-LAD": 300, "AC-STR": 60, "MC-UNIT": 6, "HS-2T": 4, "PP-HRN": 700 };
  for (const [sku, q] of Object.entries(bigQty)) {
    await insert("stock", { org_id: org, item_id: items[sku].id, location_id: yardDammam, qty: Math.round(q * 0.6) });
    // Jubail runs low on boards and swivels to give the forecaster something to find.
    const jubail = sku === "BD-390" ? 180 : sku === "CP-SWV" ? 900 : Math.round(q * 0.25);
    await insert("stock", { org_id: org, item_id: items[sku].id, location_id: yardJubail, qty: jubail });
  }

  // ── Vehicles ──
  const vehicles = [
    ["ر س ط 4821", "flatbed", 22000, "Sajid Khan"],
    ["ر س ط 4822", "flatbed", 22000, "Ramesh Kumar"],
    ["ب ح د 1190", "trailer", 30000, "Abdul Rauf"],
    ["ب ح د 1191", "crane_truck", 12000, "Saleh Al-Harbi"],
    ["ن ق ل 7302", "pickup", 1500, "Thomas George"],
  ] as const;
  const vehicleIds: string[] = [];
  for (const [plate, kind, cap, driver] of vehicles) vehicleIds.push(await insert("vehicles", { org_id: org, plate, kind, capacity_kg: cap, driver_name: driver, base_location_id: yardDammam }));

  // ── Jobs ──
  const jobs: Record<string, string> = {};
  const jobDefs = [
    ["karan", "J-26-0141", "Auxiliary platform access & painting scaffolds", "سقالات الوصول والدهان للمنصة المساعدة", -120, 75, "4500118823"],
    ["safaniyah", "J-26-0152", "Riser and boat landing maintenance access", "سقالات صيانة الرافعات ومرسى القوارب", -60, 120, "4500119107"],
    ["sadara", "J-26-0133", "Unit 4 turnaround access (columns & heaters)", "سقالات الإيقاف الدوري للوحدة 4", -150, 40, "SDR-PO-77812"],
    ["bargash", "J-26-0160", "Facade mast climbers & hoists", "منصات الواجهة والرافعات", -90, 210, "BRG-2026-044"],
    ["qiddiya", "J-26-0171", "Skyline structure access scaffolds", "سقالات الوصول لهيكل الأفق", -45, 180, "QJV-PO-3310"],
    ["marine", "J-26-0175", "Jetty underdeck cantilever scaffolds", "سقالات كابولية أسفل الرصيف", -20, 95, null],
  ] as const;
  for (const [key, ref, title, title_ar, start, end, po] of jobDefs) {
    jobs[key] = await insert("jobs", { org_id: org, client_company_id: siteCc[key], site_id: sites[key], ref, title, title_ar, status: "active", start_date: day(start), end_date: day(end), supervisor_id: people.sup, po_number: po });
  }

  // ── Scaffolds + inspections ──
  const locs: Record<string, string[]> = {
    karan: ["Cellar deck east", "Main deck crane pedestal", "Riser balcony", "Flare boom walkway", "Wellhead area W-3", "Mezzanine deck north", "Boat landing"],
    safaniyah: ["Riser guard", "Sump caisson", "Helideck underside", "Production deck south", "Boat landing ladder"],
    sadara: ["Column C-401 platform 2", "Heater H-402 firebox", "Pipe rack PR-4 bay 12", "Exchanger E-417 bundle pull", "Reactor R-404 manway", "Cooling tower CT-4", "Compressor house K-410"],
    bargash: ["Facade north elevation", "Facade east elevation", "Podium canopy", "Core wall lift shaft"],
    qiddiya: ["Arena truss bay A", "Arena truss bay B", "Stair core 2", "Roof edge protection grid 7"],
    marine: ["Jetty berth 3 underdeck", "Loading arm platform", "Fender panel 12"],
  };
  const typesBy: Record<string, string[]> = {
    karan: ["tube_coupler", "tube_coupler", "cantilever", "suspended"],
    safaniyah: ["tube_coupler", "cantilever", "suspended"],
    sadara: ["system_cuplock", "tube_coupler", "birdcage", "mobile_tower", "system_cuplock"],
    bargash: ["mast_climber", "hoist", "system_ringlock"],
    qiddiya: ["system_ringlock", "system_cuplock", "birdcage"],
    marine: ["cantilever", "tube_coupler", "suspended"],
  };
  const loadClasses = ["Class 2 · 1.5 kN/m²", "Class 3 · 2.0 kN/m²", "Class 4 · 3.0 kN/m²", "Class 6 · 6.0 kN/m²"];
  const checklistItems = [
    ["FND", "Foundations, sole boards and base plates"],
    ["STD", "Standards plumb and joints staggered"],
    ["LED", "Ledgers and transoms correctly spaced and fixed"],
    ["BRC", "Bracing (façade, ledger, plan) complete"],
    ["TIE", "Ties / anchors at required spacing"],
    ["PLT", "Platform fully boarded, boards secured"],
    ["GRD", "Guardrails 950 mm min, mid-rail fitted"],
    ["TOE", "Toe boards 150 mm min"],
    ["ACC", "Safe access (ladder/stair) secured, 1 m above landing"],
    ["LDG", "Loading within duty class, no overloading"],
    ["CPL", "Couplers tight and undamaged"],
    ["SGN", "Tag holder and signage in place"],
  ] as const;
  const defectTexts: Record<string, [string, string]> = {
    TOE: ["Toe board missing on lift 3, east side", "medium"],
    GRD: ["Mid-rail removed at access gate and not reinstated", "high"],
    BRC: ["Façade brace missing between bays 4–5", "high"],
    FND: ["Base plate without sole board on soft ground", "medium"],
    PLT: ["Boards not secured, trap end on working platform", "high"],
    TIE: ["Tie removed by others near the riser", "critical"],
    ACC: ["Ladder not tied at top", "medium"],
    LDG: ["Material stacked above duty rating", "high"],
  };
  const inspectorIds = [people.insp];
  let tagSeq = 1;
  for (const d of siteDefs) {
    const count = d.key === "sadara" ? 16 : d.key === "karan" ? 12 : d.key === "bargash" ? 6 : 8;
    for (let i = 0; i < count; i++) {
      const type = pick(typesBy[d.key]);
      const h = type === "mast_climber" ? int(60, 120) : int(4, 28);
      const l = type === "mobile_tower" ? 2.5 : int(4, 30);
      const w = type === "mobile_tower" ? 1.3 : pick([1.0, 1.3, 1.5, 2.0]);
      const roll = rnd();
      const status = roll < 0.66 ? "green" : roll < 0.82 ? "yellow" : roll < 0.9 ? "red" : roll < 0.95 ? "erecting" : "dismantled";
      const erected = -int(10, 140);
      // Some due dates already passed so the compliance watcher has work.
      const lastInspect = status === "erecting" ? null : -int(0, 9);
      const due = lastInspect === null ? null : lastInspect + 7;
      const tag = `${d.code}-${String(tagSeq++).padStart(4, "0")}`;
      const restrictions = status === "yellow" ? pick([
        "Restricted: harness must be clipped on, guardrail removed for pipe spool lift",
        "Restricted: max 2 persons, no material storage on platform",
        "Restricted: access from north ladder only",
      ]) : null;
      const scaffold = await insert("scaffolds", {
        org_id: org, client_company_id: d.cc, site_id: sites[d.key], job_id: jobs[d.key], tag_no: tag, qr_code: `rgs://scaffold/${tag}`,
        location_desc: pick(locs[d.key]), type, load_class: pick(loadClasses), duty: pick(["light", "medium", "heavy"]),
        height_m: h, length_m: l, width_m: w, volume_m3: Math.round(h * l * w * 10) / 10,
        status, restrictions, erected_at: day(erected),
        last_inspected_at: lastInspect === null ? null : ts(lastInspect, int(6, 15)), next_inspection_due: due === null ? null : day(due),
      });
      if (status === "erecting") continue;
      // History: handover + periodic inspections
      const n = int(1, 4);
      for (let k = n; k >= 0; k--) {
        const when = (lastInspect ?? 0) - k * 7;
        const isLast = k === 0;
        const result = isLast ? (status === "dismantled" ? "green" : status) : "green";
        const failed = result === "red" ? pick(Object.keys(defectTexts)) : result === "yellow" ? "GRD" : null;
        const checklist = checklistItems.map(([code, label]) => ({ code, label, result: code === failed ? "fail" : "pass" }));
        const insp = await insert("inspections", {
          org_id: org, client_company_id: d.cc, scaffold_id: scaffold, inspector_id: pick(inspectorIds),
          type: k === n ? "handover" : "periodic_7day", checklist, result,
          restrictions: result === "yellow" ? restrictions : null,
          notes: result === "green" ? "Inspected and found fit for use." : null,
          ai_suggested_result: result,
          inspected_at: ts(when, int(6, 15)),
        });
        if (isLast && failed) {
          const [text, sev] = defectTexts[failed] ?? ["Non-conformance found", "medium"];
          await insert("defects", { org_id: org, client_company_id: d.cc, scaffold_id: scaffold, inspection_id: insp, code: failed, description: text, severity: result === "red" ? (sev === "medium" ? "high" : sev) : "low", status: "open" });
        }
      }
    }
  }

  // ── On-hire material per site ──
  const hireSets: Record<string, [string, number][]> = {
    karan: [["TB-640", 1400], ["TB-300", 900], ["CP-DBL", 9000], ["CP-SWV", 2600], ["BD-390", 2100], ["BD-TOE", 800], ["AC-LAD", 40]],
    safaniyah: [["TB-640", 900], ["TB-400", 700], ["CP-DBL", 6000], ["BD-390", 1300], ["PP-HRN", 30]],
    sadara: [["CL-STD3", 1800], ["CL-LED25", 2600], ["CL-TRN13", 1600], ["BD-390", 3100], ["TB-400", 1200], ["CP-DBL", 7400], ["AC-STR", 12]],
    bargash: [["MC-UNIT", 4], ["HS-2T", 2], ["RL-STD3", 600]],
    qiddiya: [["RL-STD3", 1100], ["CL-STD3", 900], ["CL-LED25", 1300], ["BD-390", 1500], ["AC-STR", 8]],
    marine: [["TB-640", 500], ["CP-DBL", 3200], ["CP-SWV", 900], ["BD-390", 600]],
  };
  for (const [key, set] of Object.entries(hireSets)) {
    for (const [sku, qty] of set) {
      const start = -int(20, 120);
      const overdueReturn = key === "sadara" && (sku === "AC-STR" || sku === "CL-TRN13");
      await insert("on_hire", {
        org_id: org, client_company_id: siteCc[key], site_id: sites[key], job_id: jobs[key], item_id: items[sku].id, qty, rate_day: items[sku].rate,
        start_date: day(start), status: overdueReturn ? "off_hire_requested" : "on_hire",
        off_hire_requested_at: overdueReturn ? ts(-9) : null, last_billed_until: day(-26),
      });
    }
  }

  // ── Movements (deliveries / returns) ──
  let mv = 1;
  for (const [key, set] of Object.entries(hireSets)) {
    for (let k = 0; k < 2; k++) {
      const completed = k === 0;
      const m = await insert("movements", {
        org_id: org, client_company_id: siteCc[key], site_id: sites[key], kind: completed ? "delivery" : pick(["delivery", "return"]), ref: `MV-${String(mv++).padStart(5, "0")}`,
        from_location_id: key === "sadara" ? yardJubail : yardDammam, to_location_id: siteLoc[key], delivery_note_no: `DN-${int(30000, 39999)}`,
        vehicle_id: pick(vehicleIds), status: completed ? "completed" : "planned", scheduled_for: completed ? day(-int(5, 40)) : day(int(1, 3)),
        completed_at: completed ? ts(-int(5, 40)) : null, created_by: people.yard,
      });
      for (const [sku, qty] of set.slice(0, 3)) await insert("movement_lines", { org_id: org, movement_id: m, item_id: items[sku].id, qty: Math.round(qty * 0.2) });
    }
  }
  // A shrinkage pattern for the anomaly agent: delivered more than returned at Qiddiya.
  const lossMv = await insert("movements", { org_id: org, client_company_id: cc.qiddiya, site_id: sites.qiddiya, kind: "return", ref: `MV-${String(mv++).padStart(5, "0")}`, from_location_id: siteLoc.qiddiya, to_location_id: yardDammam, delivery_note_no: "DN-38817", status: "completed", completed_at: ts(-3), scheduled_for: day(-3), created_by: people.yard });
  await insert("movement_lines", { org_id: org, movement_id: lossMv, item_id: items["BD-390"].id, qty: 410 });

  // ── Workers & certifications ──
  const first = ["Mohammed", "Ahmed", "Rajesh", "Suresh", "Imran", "Asif", "Jomon", "Ramesh", "Faisal", "Anil", "Bilal", "Tariq", "Sanjay", "Nadeem", "Ali", "Manoj", "Hassan", "Vinod", "Shafiq", "Deepak"];
  const last = ["Khan", "Kumar", "Pillai", "Hussain", "Ali", "Singh", "Thomas", "Shaikh", "Rahman", "Yadav", "Iqbal", "Varghese", "Abbas", "Nair", "Malik"];
  const nat = ["India", "Pakistan", "Bangladesh", "Philippines", "Nepal", "Saudi Arabia", "Egypt"];
  const trades = ["scaffolder", "scaffolder", "scaffolder", "advanced_scaffolder", "helper", "helper", "scaffold_supervisor", "scaffold_inspector", "rigger", "driver", "hse_officer"];
  const siteKeys = siteDefs.map((d) => d.key);
  for (let i = 1; i <= 64; i++) {
    const trade = pick(trades);
    const site = i <= 58 ? pick(siteKeys) : null;
    const iqamaOffset = i % 13 === 0 ? int(-5, 25) : int(40, 700);
    const worker = await insert("workers", {
      org_id: org, employee_no: `RGS-${String(1000 + i)}`, full_name: `${pick(first)} ${pick(last)}`, nationality: pick(nat), trade,
      grade: pick(["A", "B", "C"]), iqama_no: `2${int(100000000, 999999999)}`, iqama_expiry: day(iqamaOffset), phone: `+9665${int(10000000, 99999999)}`,
      languages: pick([["en", "hi"], ["ur", "en"], ["ar"], ["ml", "en"], ["bn"], ["tl", "en"]]), status: i > 61 ? "on_leave" : "active",
      current_site_id: site ? sites[site] : null,
    });
    const certs: string[] = ["working_at_height", "first_aid"];
    if (trade.includes("scaffold")) certs.push(pick(["cisrs", "citb", "tuv_scaffold"]), "aramco_scaffold_card");
    if (site === "karan" || site === "safaniyah") certs.push("opito_bosiet", "h2s", "aramco_id");
    if (trade === "rigger") certs.push("rigging");
    if (trade === "driver") certs.push("driving_licence");
    for (const kind of certs) {
      const exp = rnd() < 0.12 ? int(-10, 28) : int(35, 900);
      await insert("certifications", { org_id: org, worker_id: worker, kind, number: `${kind.slice(0, 3).toUpperCase()}-${int(100000, 999999)}`, issuer: kind.startsWith("aramco") ? "Saudi Aramco" : kind === "opito_bosiet" ? "OPITO centre (sample)" : "Accredited body (sample)", issued_on: day(exp - 730), expires_on: day(exp), verified: rnd() > 0.2 });
    }
    if (site) await insert("crew_assignments", { org_id: org, worker_id: worker, site_id: sites[site], job_id: jobs[site], role: trade, start_date: day(-int(5, 100)), status: "confirmed" });
  }
  const tr1 = await insert("training_sessions", { org_id: org, title: "CISRS Basic Scaffolder refresher", title_ar: "تجديد شهادة عامل السقالات الأساسية", kind: "cisrs", scheduled_on: day(6), trainer: "RGS Training Centre", capacity: 14, location: "Dammam Training Centre" });
  await insert("training_sessions", { org_id: org, title: "Working at height & rescue", title_ar: "العمل على المرتفعات والإنقاذ", kind: "working_at_height", scheduled_on: day(11), trainer: "RGS Training Centre", capacity: 20, location: "Jubail Support Yard" });
  await insert("training_sessions", { org_id: org, title: "H2S awareness (offshore crew)", title_ar: "التوعية بغاز كبريتيد الهيدروجين", kind: "h2s", scheduled_on: day(15), trainer: "Approved provider (sample)", capacity: 16, location: "Dammam Training Centre" });
  void tr1;

  // ── Requests & quotes ──
  const reqDefs = [
    { cc: cc.sadara, site: "sadara", ref: "RQ-26-0412", source: "email", title: "Access for E-417 bundle pull during Q1 turnaround", desc: "Need a birdcage plus two tower scaffolds around exchanger E-417, approx 9 m working height, 6 x 4 m footprint. Drawings attached. Needed by start of turnaround.", type: "birdcage", req: 18, status: "estimating", prio: "high" },
    { cc: cc.aramco, site: "karan", ref: "RQ-26-0415", source: "whatsapp", title: "Cantilever scaffold under cellar deck for valve replacement", desc: "Cantilever off main deck beams, 8 m long, 1.3 m wide, 2 lifts. Offshore crew change Thursday.", type: "cantilever", req: 7, status: "new", prio: "urgent" },
    { cc: cc.bargash, site: "bargash", ref: "RQ-26-0402", source: "portal", title: "Extend mast climber on east elevation by 12 masts", desc: "Facade programme moved up. Need additional 12 mast sections and one more platform for 3 months.", type: "mast_climber", req: 21, status: "quoted", prio: "normal" },
    { cc: cc.qiddiya, site: "qiddiya", ref: "RQ-26-0398", source: "email", title: "Edge protection grid 8 for roof works", desc: "Ringlock edge protection, 140 lm, 1.2 m high with toe boards.", type: "system_ringlock", req: 10, status: "won", prio: "normal" },
    { cc: cc.aramco, site: "marine", ref: "RQ-26-0417", source: "phone", title: "Underdeck access berth 4 inspection", desc: "Suspended scaffold for underdeck inspection, approx 30 m along berth 4, galvanised only.", type: "suspended", req: 25, status: "triage", prio: "normal" },
  ];
  const reqIds: Record<string, string> = {};
  for (const r of reqDefs) {
    reqIds[r.ref] = await insert("requests", { org_id: org, client_company_id: r.cc, site_id: sites[r.site], ref: r.ref, source: r.source, title: r.title, description: r.desc, scaffold_type: r.type, required_by: day(r.req), status: r.status, priority: r.prio, created_by: r.source === "portal" ? people.cBargash : null, created_at: ts(-int(1, 12)) });
  }
  async function quote(ref: string, reqRef: string, client: string, status: string, lines: [string, number][], ai: boolean, validDays = 30) {
    let subtotal = 0;
    const rows: { code: string; qty: number; rate: number; amount: number }[] = [];
    for (const [code, qty] of lines) {
      const rate = rates.find((x) => x[0] === code)![5];
      const amount = Math.round(qty * rate * 100) / 100;
      subtotal += amount;
      rows.push({ code, qty, rate, amount });
    }
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const q = await insert("quotes", { org_id: org, client_company_id: client, request_id: reqIds[reqRef], ref, status, kind: "firm", subtotal, vat, total: subtotal + vat, valid_until: day(validDays), assumptions: "Rates are SAMPLE values. Excludes client permits and standby caused by others. Weekly rental charged from delivery to return.", assumptions_ar: "الأسعار قيم تجريبية. لا تشمل تصاريح العميل أو التوقف بسبب الغير. يحتسب الإيجار الأسبوعي من التسليم حتى الإرجاع.", prepared_by: people.est, approved_by: status === "draft" ? null : people.ops, ai_generated: ai, ai_confidence: ai ? 0.82 : null });
    let i = 0;
    for (const r of rows) {
      const ri = rates.find((x) => x[0] === r.code)!;
      await insert("quote_lines", { org_id: org, quote_id: q, rate_item_id: rateIds[r.code], description: ri[2], description_ar: ri[3], qty: r.qty, unit: ri[4], rate: r.rate, amount: r.amount, sort: i++ });
    }
    return q;
  }
  await quote("QT-26-0388", "RQ-26-0402", cc.bargash, "sent", [["RNT-MC", 3], ["MOB-ON", 2], ["LAB-SUP", 6]], true);
  await quote("QT-26-0379", "RQ-26-0398", cc.qiddiya, "accepted", [["ERC-SYS", 202], ["DSM-SYS", 202], ["RNT-M3W", 2424], ["MOB-ON", 2]], false);
  await quote("QT-26-0391", "RQ-26-0412", cc.sadara, "draft", [["ERC-TC", 216], ["DSM-TC", 216], ["RNT-M3W", 1296], ["INS-7D", 18], ["MOB-ON", 1]], true);

  // ── Invoices ──
  let inv = 1;
  for (const d of siteDefs) {
    for (const [offset, status] of [[-56, "paid"], [-26, "issued"]] as const) {
      const lines = hireSets[d.key].slice(0, 4).map(([sku, qty]) => ({ sku, qty, days: 30, rate: items[sku].rate }));
      const subtotal = Math.round(lines.reduce((a, l) => a + l.qty * l.days * l.rate, 0) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const id = await insert("invoices", { org_id: org, client_company_id: d.cc, site_id: sites[d.key], job_id: jobs[d.key], ref: `INV-26-${String(inv++).padStart(4, "0")}`, period_from: day(offset - 30), period_to: day(offset), status, subtotal, vat, total: subtotal + vat, po_number: jobDefs.find((j) => j[0] === d.key)![6], due_date: day(offset + 60), zatca_status: "cleared", zatca_uuid: crypto.randomUUID(), issued_at: ts(offset + 1) });
      for (const l of lines) {
        const it = itemDefs.find((x) => x[0] === l.sku)!;
        await insert("invoice_lines", { org_id: org, invoice_id: id, description: `Rental: ${it[1]} × ${l.qty} for ${l.days} days`, description_ar: `إيجار: ${it[2]} × ${l.qty} لمدة ${l.days} يوم`, qty: l.qty * l.days, unit: "item-day", rate: l.rate, amount: Math.round(l.qty * l.days * l.rate * 100) / 100, source: { sku: l.sku } });
      }
    }
  }

  // ── Incidents (lessons learned) ──
  await insert("incidents", { org_id: org, client_company_id: cc.sadara, site_id: sites.sadara, kind: "near_miss", title: "Board slipped at trap end during heater access", description: "Unsecured board end tipped when a worker stepped near the end of the platform.", root_cause: "Board overhang above 4× thickness and not tied after modification by others.", lessons: "After any modification, re-inspect before use. Tie boards on platforms that others may alter. Check overhang 50–150 mm.", tags: ["boards", "modification", "trap end"], occurred_at: ts(-34) });
  await insert("incidents", { org_id: org, client_company_id: cc.aramco, site_id: sites.karan, kind: "observation", title: "Tie removed by piping crew near riser", description: "Piping contractor removed a tie to fit a spool and did not inform the scaffold team.", root_cause: "Interface between trades; tie locations not marked.", lessons: "Mark ties with high-visibility tape offshore. Add 'do not remove ties' to permit briefing. Red-tag until reinstated.", tags: ["ties", "offshore", "interface"], occurred_at: ts(-12) });
  await insert("incidents", { org_id: org, client_company_id: cc.qiddiya, site_id: sites.qiddiya, kind: "property_damage", title: "Sheeting caught by wind on roof grid 6", description: "Debris netting acted as a sail during gusts of about 45 km/h; two ties pulled.", root_cause: "Netting added without a design check for wind load.", lessons: "Any sheeting or netting needs a design check and extra ties. Stop work above 38 km/h on exposed lifts.", tags: ["wind", "sheeting", "design"], occurred_at: ts(-51) });

  // ── Knowledge base (SAMPLE procedures) ──
  async function kb(title: string, kind: string, chunks: [string, string][], opts: { staff_only?: boolean; client?: string | null; language?: string } = {}) {
    const doc = await insert("kb_documents", { org_id: org, title, kind, staff_only: opts.staff_only ?? true, client_company_id: opts.client ?? null, language: opts.language ?? "en" });
    let i = 0;
    for (const [heading, content] of chunks) await insert("kb_chunks", { org_id: org, kb_document_id: doc, chunk_index: i++, heading, content });
  }
  await kb("RGS Scaffold Inspection & Tagging Procedure (SAMPLE)", "procedure", [
    ["Tag colours", "GREEN: inspected, complete and safe for use within its duty class. YELLOW: restricted use; the tag states the restriction (for example harness clipped on, max persons, access route). RED: do not use; incomplete, under modification or failed inspection. Only a competent scaffold inspector may change a tag."],
    ["Inspection frequency", "Inspect at handover, at intervals not exceeding 7 days, after any modification, after adverse weather (wind above 38 km/h, heavy rain, sandstorm) and after any incident. Record each inspection in the register with photos."],
    ["Clearing a red tag", "A red tag may only be cleared by a competent inspector after the defect is corrected and re-inspected. The agent may propose, never clear, a red tag."],
  ], { staff_only: false });
  await kb("Method Statement: Tube & Coupler Erection Offshore (SAMPLE)", "method_statement", [
    ["Pre-start", "Confirm PTW, BOSIET and H2S certificates, Aramco ID and weather window. Toolbox talk in the crew's language. Tools tethered at height over open grating or sea."],
    ["Materials", "Galvanised tubes and drop-forged couplers only. Inspect every component on the boat landing before lifting. Quarantine damaged items with red paint."],
    ["Erection", "Start from sound bearing, use sole boards and base plates. Fit ledgers and transoms to design spacing. Fix ties as erection proceeds. Fit guardrails at 950 mm, mid-rails and 150 mm toe boards before handover."],
  ]);
  await kb("Estimating Guide: Volume & Take-off Rules (SAMPLE)", "procedure", [
    ["Volume", "Scaffold volume (m³) = length × width × height of the working envelope. Birdcages measured on plan area × height. Minimum charge 20 m³ per scaffold."],
    ["Take-off ratios (tube & coupler)", "Per 100 m³ typical: 38 tubes 6.4 m, 22 tubes 3.0 m, 210 double couplers, 60 swivel couplers, 44 boards 3.9 m, 18 toe boards, 12 base plates. Adjust +15% for complex pipework."],
    ["Offshore", "Add offshore uplift on labour, marine mobilisation per trip, and 10% contingency for weather standby."],
  ]);
  await kb("Client spec: Saudi Aramco scaffold requirements summary (SAMPLE, not an official document)", "client_spec", [
    ["Competency", "Scaffolders and inspectors must hold valid client scaffold cards. Offshore workers also need BOSIET and H2S. Cards are checked at gate and on platform."],
    ["Tagging", "Use the client's three-colour tag system and keep tag holders at every access point. Record inspections daily on high-risk units."],
  ], { client: cc.aramco });
  await kb("دليل الأسئلة الشائعة للعملاء (عينة)", "faq", [
    ["طلب سقالة", "يمكن طلب سقالة عبر البوابة أو واتساب أو البريد الإلكتروني. أرفق المخططات وارتفاع العمل وتاريخ الحاجة. يصلك عرض سعر مبدئي فوراً ثم عرض نهائي بعد مراجعة المقدّر."],
    ["إنهاء الإيجار", "اطلب إنهاء الإيجار من صفحة الموقع. يتوقف احتساب الإيجار من تاريخ الطلب إذا كانت المواد جاهزة للاستلام."],
  ], { staff_only: false, language: "ar" });

  // ── Memories (client & site specific) ──
  await insert("memories", { org_id: org, scope: "client", scope_id: cc.sadara, client_company_id: cc.sadara, content: "Sadara requires quotes split by turnaround work order number; send to the maintenance planner and copy procurement.", source: "seed" });
  await insert("memories", { org_id: org, scope: "site", scope_id: sites.bargash, client_company_id: cc.bargash, content: "Deliveries to Al Bargash only between 22:00 and 05:00 (municipality restriction).", source: "seed" });
  await insert("memories", { org_id: org, scope: "client", scope_id: cc.aramco, client_company_id: cc.aramco, content: "Aramco offshore quotes must state marine mobilisation separately and include weather standby terms.", source: "seed" });

  // ── Agent autonomy policies (tiered by risk) ──
  const staffAll = ["admin", "ops_manager", "estimator", "site_supervisor", "inspector", "yard_logistics", "hse_training", "finance"];
  const everyone = [...staffAll, "client_admin", "client_user"];
  const policies: [string, number, string[], string[], string[], string][] = [
    ["search_knowledge", 0, everyone, [], [], "Search procedures, specs and past work with citations"],
    ["query_records", 0, everyone, [], [], "Read scaffolds, sites, stock, workers within the user's access"],
    ["create_task", 1, staffAll, [], [], "Create a task or reminder"],
    ["draft_quote", 1, ["admin", "ops_manager", "estimator"], [], [], "Draft a priced quote (not sent)"],
    ["indicative_quote", 1, everyone, [], [], "Instant indicative price for a client request"],
    ["create_request", 1, everyone, [], [], "Log a client scaffold request"],
    ["propose_tag_status", 1, ["admin", "ops_manager", "inspector", "site_supervisor"], [], [], "Suggest tag colour from checklist and photos"],
    ["reserve_stock", 2, ["admin", "ops_manager", "yard_logistics", "estimator"], ["ops_manager", "yard_logistics"], ["ops_manager", "yard_logistics"], "Reserve yard stock for a job"],
    ["assign_crew", 2, ["admin", "ops_manager", "site_supervisor"], ["ops_manager"], ["ops_manager"], "Assign workers to a site"],
    ["request_off_hire", 2, everyone, ["ops_manager", "yard_logistics"], ["ops_manager", "yard_logistics"], "Request collection of material from a site"],
    ["approve_dispatch_plan", 2, ["admin", "ops_manager", "yard_logistics"], [], ["ops_manager", "yard_logistics"], "Confirm tomorrow's delivery and pickup plan"],
    ["send_quote", 3, ["admin", "ops_manager", "estimator"], [], ["ops_manager", "admin"], "Send a quote to a client"],
    ["issue_invoice", 3, ["admin", "finance", "ops_manager"], [], ["finance", "admin"], "Issue an invoice and submit to ZATCA"],
    ["set_tag_status", 3, ["admin", "inspector", "ops_manager"], [], ["inspector"], "Change a scaffold tag (red tag clearance needs a competent inspector)"],
    ["message_client", 3, staffAll, [], ["ops_manager", "estimator", "admin"], "Send WhatsApp or email to a client"],
  ];
  for (const [tool, tier, allowed_roles, auto_roles, approver_roles, description] of policies) {
    await insert("agent_policies", { org_id: org, tool, tier, allowed_roles, auto_roles, approver_roles, description });
  }

  // ── Integrations status ──
  for (const [kind, status] of [["oracle_erp", "csv_only"], ["m365", "not_connected"], ["zatca", "csv_only"], ["whatsapp", "not_connected"], ["email_inbox", "not_connected"], ["qiwa", "csv_only"], ["muqeem", "not_connected"], ["gosi", "not_connected"], ["client_permit", "not_connected"]]) {
    await insert("integrations", { org_id: org, kind, status });
  }

  // ── Channel messages (sample inbound) ──
  await insert("channel_messages", { org_id: org, client_company_id: cc.aramco, channel: "whatsapp", direction: "in", from_addr: "+9665XXXXXX12", body: "Salam, we need cantilever scaffold under cellar deck Karan for valve change, 8m long 2 lifts, crew change Thursday. Can you send price?", created_at: ts(-1, 7) });
  await insert("channel_messages", { org_id: org, client_company_id: cc.sadara, channel: "email", direction: "in", from_addr: "planner@sadara.example", to_addr: "rfq@rgsksa.example", subject: "RFQ – E-417 bundle pull access, TA 2027", body: "Dear RGS, please quote access scaffolding for E-417 bundle pull per attached drawing. Working height 9 m, footprint 6 x 4 m. Regards, Maintenance Planning", attachments: [{ name: "E-417-GA.pdf", kind: "drawing" }], created_at: ts(-3, 10) });

  // Clear audit noise from seeding.
  await db.query("delete from audit_log");
  await db.query("commit");

  const counts = await db.query(`select
    (select count(*) from sites) sites, (select count(*) from scaffolds) scaffolds, (select count(*) from inspections) inspections,
    (select count(*) from workers) workers, (select count(*) from certifications) certs, (select count(*) from on_hire) on_hire,
    (select count(*) from invoices) invoices, (select count(*) from kb_chunks) kb_chunks`);
  console.log("seeded", counts.rows[0]);
  await db.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await db.query("rollback"); } catch {}
  process.exit(1);
});
