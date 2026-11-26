/* SAMPLE commercial, support and workforce data for Phase C. All figures and people are fictional. */
import type { Client } from "pg";

type Insert = (table: string, row: Record<string, unknown>) => Promise<string>;
type Ctx = { db: Client; insert: Insert; day: (o: number) => string; ts: (o: number, h?: number) => string; int: (a: number, b: number) => number; org: string; people: Record<string, string> };
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function seedCommercial(x: Ctx) {
  const { db, insert, day, ts, int, org, people } = x;
  const q = async <T,>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];
  const projects = await q<{ id: string; ref: string; client_company_id: string; site_id: string; contract_value: string; po_number: string; start_date: string }>("select id, ref, client_company_id, site_id, contract_value, po_number, start_date::text from projects order by ref");
  const P = Object.fromEntries(projects.map((p) => [p.ref, p]));
  const prof = Object.fromEntries((await q<{ email: string; id: string }>("select email, id from profiles")).map((r) => [r.email, r.id]));
  let inv = (await q<{ n: number }>("select count(*)::int n from invoices"))[0].n + 1;
  const invRef = () => `INV-26-${String(inv++).padStart(4, "0")}`;

  // Payments for rental invoices already marked paid.
  for (const i of await q<{ id: string; client_company_id: string; total: string; due_date: string }>("select id, client_company_id, total, due_date::text from invoices where status = 'paid'")) {
    await insert("payments", { org_id: org, client_company_id: i.client_company_id, invoice_id: i.id, amount: i.total, paid_on: i.due_date, method: "bank_transfer", reference: `TT-${int(400000, 499999)}`, recorded_by: people.fin });
  }

  // Advance payment (10%) invoiced and paid at the start of each project except Karan (Aramco pays no advance on this PO).
  for (const ref of ["PRJ-26-001", "PRJ-26-002", "PRJ-26-003"]) {
    const p = P[ref];
    const amt = r2(Number(p.contract_value) * 0.1), vat = r2(amt * 0.15);
    await db.query("update projects set advance_paid_on = start_date + 10 where id = $1", [p.id]);
    const id = await insert("invoices", { org_id: org, client_company_id: p.client_company_id, site_id: p.site_id, project_id: p.id, kind: "advance", ref: invRef(), status: "paid", subtotal: amt, vat, total: amt + vat, po_number: p.po_number, due_date: p.start_date, issued_at: `${p.start_date}T08:00:00Z`, zatca_status: "cleared", notes: "Advance payment 10% against bank guarantee (sample)." });
    await insert("invoice_lines", { org_id: org, invoice_id: id, description: `Advance payment 10% of contract value (${ref})`, description_ar: "دفعة مقدمة 10% من قيمة العقد", qty: 1, unit: "lot", rate: amt, amount: amt });
    await insert("payments", { org_id: org, client_company_id: p.client_company_id, invoice_id: id, amount: amt + vat, paid_on: p.start_date, method: "bank_transfer", reference: `TT-ADV-${ref.slice(-3)}`, recorded_by: people.fin });
  }

  // One certified claim per project with certified quantities, matching the measurement sheets already approved.
  const claim = async (ref: string, cref: string, issuedOffset: number, dueOffset: number, paid: boolean) => {
    const p = P[ref];
    const work = await q<{ code: string; name: string; uom: string; qty: string; rate: string }>("select code, name, uom, approved_qty qty, rate from project_areas where project_id = $1 and approved_qty > 0 order by sort", [p.id]);
    const gross = r2(work.reduce((t, l) => t + Number(l.qty) * Number(l.rate), 0));
    const retention = r2(gross * 0.1), recovery = r2(Math.min(gross * 0.1, Number(p.contract_value) * 0.1)), net = r2(gross - retention - recovery), vat = r2(net * 0.15);
    const invId = await insert("invoices", { org_id: org, client_company_id: p.client_company_id, site_id: p.site_id, project_id: p.id, kind: "progress", ref: invRef(), status: paid ? "paid" : "issued", subtotal: net, vat, total: net + vat, po_number: p.po_number, due_date: day(dueOffset), issued_at: ts(issuedOffset), zatca_status: "cleared", period_to: day(issuedOffset - 2) });
    for (const [d, a, amt] of [[`Work certified this period (${cref})`, "الأعمال المعتمدة لهذه الفترة", gross], ["Less retention 10%", "خصم المحتجزات 10%", -retention], ["Less advance payment recovery", "خصم استرداد الدفعة المقدمة", -recovery]] as const) {
      await insert("invoice_lines", { org_id: org, invoice_id: invId, description: d, description_ar: a, qty: 1, unit: "lot", rate: amt, amount: amt });
    }
    const cid = await insert("payment_claims", { org_id: org, client_company_id: p.client_company_id, project_id: p.id, ref: cref, seq: 1, period_to: day(issuedOffset - 2), gross_cumulative: gross, previous_gross: 0, this_gross: gross, retention, advance_recovery: recovery, net, vat, total: net + vat,
      lines: JSON.stringify({ work: work.map((l) => ({ code: l.code, name: l.name, uom: l.uom, qty: Number(l.qty), rate: Number(l.rate), amount: r2(Number(l.qty) * Number(l.rate)) })), vos: [] }), status: "invoiced", invoice_id: invId, submitted_by: people.fin, created_at: ts(issuedOffset - 3) });
    await db.query("update invoices set payment_claim_id = $2 where id = $1", [invId, cid]);
    if (paid) await insert("payments", { org_id: org, client_company_id: p.client_company_id, invoice_id: invId, amount: net + vat, paid_on: day(dueOffset - 5), method: "bank_transfer", reference: `TT-${int(500000, 599999)}`, recorded_by: people.fin });
  };
  await claim("PRJ-26-003", "PC-26-0001", -9, 51, false);   // Sadara: issued, not yet due
  await claim("PRJ-26-001", "PC-26-0002", -40, 20, true);   // Al Bargash: paid
  await claim("PRJ-26-002", "PC-26-0003", -75, -15, false); // Qiddiya: 15 days overdue

  // Credit note draft for the Qiddiya over-billing found by the materials reconciliation.
  const qRental = (await q<{ id: string; ref: string }>("select i.id, i.ref from invoices i join sites s on s.id = i.site_id where s.code = 'QDY' and i.kind = 'rental' and i.status = 'issued' limit 1"))[0];
  if (qRental) {
    const amount = r2(410 * 0.2 * 12);
    await insert("credit_notes", { org_id: org, client_company_id: P["PRJ-26-002"].client_company_id, invoice_id: qRental.id, ref: "CN-26-001", kind: "credit", reason: "Rental charged on 410 boards (BD-390) already returned on DN-38817; 12 days credited.", lines: JSON.stringify([{ description: "410 × BD-390 × 12 days × SAR 0.20", amount }]), subtotal: amount, vat: r2(amount * 0.15), total: r2(amount * 1.15), status: "draft", created_by: people.fin });
  }

  // Support tickets.
  const T = (ref: string, prj: string, f: Record<string, unknown>, msgs: [string, string, boolean][]) => insert("tickets", { org_id: org, client_company_id: P[prj].client_company_id, project_id: P[prj].id, ref, ...f }).then(async (id) => {
    let k = 0;
    for (const [author, body, internal] of msgs) await insert("ticket_messages", { org_id: org, client_company_id: P[prj].client_company_id, ticket_id: id, author_id: author, body, internal, created_at: ts(-3 + k++ * 0.2) });
    return id;
  });
  await T("TK-26-0001", "PRJ-26-001", { category: "portal", priority: "low", subject: "How do I add our procurement manager to the portal?", status: "closed", raised_by: people.cBargash, assignee_id: people.admin, respond_by: ts(-10), resolve_by: ts(-5), first_response_at: ts(-11), resolved_at: ts(-11), satisfaction: 5, created_at: ts(-12) },
    [[people.cBargash, "Layla in procurement needs to approve variations above SAR 100,000. How do we add her?", false], [people.admin, "Done: Layla Hamdan is added as Client finance & procurement. She will see VOs above SAR 100,000 in My sign-offs.", false]]);
  await T("TK-26-0002", "PRJ-26-002", { category: "defect", priority: "high", subject: "Damp patch on B2 wall at grid 7 after dewatering pump stopped", status: "open", raised_by: prof["client.qiddiya@demo.rgs"], respond_by: ts(-1, 4), resolve_by: ts(2), created_at: ts(-1, 0) },
    [[prof["client.qiddiya@demo.rgs"], "About 1 m² damp patch on the crystalline-treated wall at grid 7, level B2. Started after the dewatering pump stopped overnight. Photos to follow.", false]]);
  await T("TK-26-0003", "PRJ-26-003", { category: "billing", priority: "normal", subject: "Clarify advance recovery on the first progress invoice", status: "waiting_client", raised_by: prof["procurement.sadara@demo.rgs"], assignee_id: people.fin, respond_by: ts(-3), resolve_by: ts(2), first_response_at: ts(-3), created_at: ts(-4) },
    [[prof["procurement.sadara@demo.rgs"], "Why is the advance recovery equal to the retention amount on PC-26-0001?", false], [people.fin, "Both are 10% of the certified value this period (contract terms: 10% retention, advance recovered at 10% per claim until fully recovered). Can you confirm the PO terms on your side match?", false], [people.fin, "Sadara PO SDR-PO-78550 clause 7.2 matches. Waiting for Grace to confirm.", true]]);

  // Contact directory.
  const C = (prj: string, side: string, name: string, role_label: string, role_label_ar: string, phone: string, email: string, hours: string, sort: number) =>
    insert("project_contacts", { org_id: org, client_company_id: P[prj].client_company_id, project_id: P[prj].id, side, name, role_label, role_label_ar, phone, email, hours, sort });
  for (const p of projects) {
    await C(p.ref, "rgs", "Imran Qureshi", "RGS project manager", "مدير المشروع - RGS", "+966 13 812 6611 (sample)", "ops@demo.rgs", "Sun–Thu 07:00–17:00", 0);
    await C(p.ref, "rgs", "Joseph Mathew", "Site supervisor", "مشرف الموقع", "+966 5X XXX 1201 (sample)", "supervisor@demo.rgs", "On site, 24/7 for emergencies", 1);
    await C(p.ref, "rgs", "Nasser Al-Qahtani", "HSE manager", "مدير السلامة", "+966 5X XXX 1301 (sample)", "hse@demo.rgs", "24/7 incident line", 2);
    await C(p.ref, "rgs", "Huda Al-Shehri", "Billing & accounts", "الفوترة والحسابات", "+966 13 814 2413 (sample)", "finance@demo.rgs", "Sun–Thu 08:00–16:00", 3);
  }

  // Portal help FAQ (visible to clients, bilingual).
  const kb = await insert("kb_documents", { org_id: org, title: "RGS client portal help", kind: "faq", staff_only: false, language: "en" });
  const faq: [string, string][] = [
    ["Signing off", "Open My sign-offs. Check the item, then type your full name exactly as shown and press Sign & approve. To reject, write the reason in the comment box. Variations above SAR 100,000 need both your project manager and procurement."],
    ["Site instructions", "Go to Instructions & changes, pick the project and describe the instruction. RGS either acknowledges it within the contract or sends a priced variation for your approval."],
    ["Review codes", "A = approved, B = approved with comments (work may proceed), C = revise and resubmit, D = rejected. Codes B, C and D need at least one comment."],
    ["Retention and advance", "Each progress claim deducts 10% retention and recovers the advance at 10% of the claim until it is fully recovered (sample terms). Half the retention is released at completion, the rest after the defects liability period."],
    ["Warranty claims", "Open Support, choose Warranty claim and pick the warranty from the list. RGS inspects within 24 hours. Warranties start on the date you sign completion."],
    ["Response times", "Support targets (sample): urgent reply within 2 h and resolve within 24 h; high 4 h / 3 days; normal 8 h / 5 days; low 24 h / 10 days."],
  ];
  let i = 0;
  for (const [heading, content] of faq) await insert("kb_chunks", { org_id: org, kb_document_id: kb, chunk_index: i++, heading, content });
  const kbAr = await insert("kb_documents", { org_id: org, title: "مساعدة بوابة عملاء RGS", kind: "faq", staff_only: false, language: "ar" });
  const faqAr: [string, string][] = [
    ["التوقيع", "افتح صفحة توقيعاتي، راجع البند، ثم اكتب اسمك الكامل كما يظهر واضغط توقيع واعتماد. للرفض اكتب السبب في خانة الملاحظات. أوامر التغيير فوق 100,000 ريال تحتاج مدير المشروع والمشتريات."],
    ["مطالبات الضمان", "افتح الدعم واختر مطالبة ضمان ثم اختر الضمان من القائمة. تفحص RGS الموقع خلال 24 ساعة."],
    ["المحتجزات والدفعة المقدمة", "يخصم من كل مطالبة 10% محتجزات ويسترد 10% من الدفعة المقدمة حتى تُسترد بالكامل. يُفرج عن نصف المحتجزات عند الإنجاز والباقي بعد فترة الضمان."],
  ];
  i = 0;
  for (const [heading, content] of faqAr) await insert("kb_chunks", { org_id: org, kb_document_id: kbAr, chunk_index: i++, heading, content });

  // Insulation and waterproofing crews (new trades).
  const sites = Object.fromEntries((await q<{ code: string; id: string }>("select code, id from sites")).map((s) => [s.code, s.id]));
  const crew: [string, string, string, string, string, string[]][] = [
    ["RGS-2001", "Abdullah Al-Harbi", "عبدالله الحربي", "Saudi Arabia", "waterproofing_foreman", ["BRG"]],
    ["RGS-2002", "Rafiq Hossain", "رفيق حسين", "Bangladesh", "waterproofing_applicator", ["BRG"]],
    ["RGS-2003", "Mahmoud Saleh", "محمود صالح", "Egypt", "waterproofing_applicator", ["QDY"]],
    ["RGS-2004", "Turki Al-Shammari", "تركي الشمري", "Saudi Arabia", "waterproofing_applicator", ["QDY"]],
    ["RGS-2005", "Biju Varghese", "بيجو فارغيز", "India", "insulation_foreman", ["SDR"]],
    ["RGS-2006", "Shahid Iqbal", "شاهد إقبال", "Pakistan", "insulator", ["SDR"]],
    ["RGS-2007", "Ramon Cruz", "رامون كروز", "Philippines", "insulator", ["KRN"]],
    ["RGS-2008", "Naveen Kumar", "نافين كومار", "India", "insulator", ["KRN"]],
  ];
  for (const [no, name, name_ar, nat, trade, [site]] of crew) {
    const w = await insert("workers", { org_id: org, employee_no: no, full_name: name, full_name_ar: name_ar, nationality: nat, trade, grade: "B", iqama_no: nat === "Saudi Arabia" ? null : `2${int(100000000, 999999999)}`, iqama_expiry: nat === "Saudi Arabia" ? null : day(int(120, 600)), status: "active", current_site_id: sites[site], languages: nat === "Saudi Arabia" || nat === "Egypt" ? ["ar"] : ["en"] });
    await insert("certifications", { org_id: org, worker_id: w, kind: "working_at_height", number: `WAH-${int(100000, 999999)}`, issuer: "Accredited body (sample)", issued_on: day(-300), expires_on: day(no === "RGS-2008" ? 12 : int(100, 600)), verified: true });
    if (site === "KRN") {
      await insert("certifications", { org_id: org, worker_id: w, kind: "h2s", number: `H2S-${int(100000, 999999)}`, issuer: "Approved provider (sample)", issued_on: day(-200), expires_on: day(int(60, 400)), verified: true });
      await insert("certifications", { org_id: org, worker_id: w, kind: "aramco_id", number: `ARC-${int(100000, 999999)}`, issuer: "Saudi Aramco", issued_on: day(-200), expires_on: day(int(60, 400)), verified: true });
      // Naveen has no BOSIET: the competency check blocks him from offshore work.
      if (no !== "RGS-2008") await insert("certifications", { org_id: org, worker_id: w, kind: "opito_bosiet", number: `BOS-${int(100000, 999999)}`, issuer: "OPITO centre (sample)", issued_on: day(-500), expires_on: day(int(90, 700)), verified: true });
    }
    await insert("crew_assignments", { org_id: org, worker_id: w, site_id: sites[site], role: trade, start_date: day(-int(10, 40)), status: "confirmed" });
  }
}
