/*
 * Positions: the job a person does. Their permission role stays as before; the position decides
 * their personal agent, reporting line and approval limits.
 */

export type Job = { job: string; label: string; schedule: string };
export type Position = {
  key: string; side: "rgs" | "client"; en: string; ar: string; role: string; reportsTo?: string;
  agent: string;                    // agent's role name, e.g. "Tender agent"
  mission: string;                  // what it does on its own
  jobs: Job[];
};

const D = (job: string, label: string, schedule = "daily"): Job => ({ job, label, schedule });

export const POSITIONS: Position[] = [
  // ── RGS ──
  { key: "general_manager", side: "rgs", en: "General Manager", ar: "المدير العام", role: "ops_manager", agent: "Portfolio agent",
    mission: "Watches margin, cash, risk and approvals across every project; brings you only what needs the GM.", jobs: [D("portfolio_risk", "Portfolio risk and cash"), D("approvals_over_limit", "Approvals above managers' limits")] },
  { key: "ops_manager", side: "rgs", en: "Operations Manager", ar: "مدير العمليات", role: "ops_manager", reportsTo: "general_manager", agent: "Operations agent",
    mission: "Runs the daily operations picture: sites, crews, tags, compliance watchers and what is slipping.", jobs: [D("ops_brief", "Operations brief"), D("run_watchers", "Compliance watchers")] },
  { key: "project_manager", side: "rgs", en: "Project Manager", ar: "مدير المشروع", role: "ops_manager", reportsTo: "ops_manager", agent: "Project agent",
    mission: "Keeps your projects on track: commitments at risk, client actions to chase, weekly reports drafted.", jobs: [D("commitments_at_risk", "Commitments at risk"), D("chase_client_actions", "Chase client actions"), D("weekly_reports", "Draft weekly reports", "weekly:4")] },
  { key: "estimator", side: "rgs", en: "Senior Estimator", ar: "مقدّر أول", role: "estimator", reportsTo: "ops_manager", agent: "Tender agent",
    mission: "Reads incoming RFQs from WhatsApp and email, logs them, prices them from the rate card and prepares quotes.", jobs: [D("inbox_triage", "Triage incoming RFQs"), D("price_new_requests", "Price new requests")] },
  { key: "sales_bd", side: "rgs", en: "Business Development Manager", ar: "مدير تطوير الأعمال", role: "estimator", reportsTo: "general_manager", agent: "Pipeline agent",
    mission: "Follows up quotes the client hasn't answered and keeps the pipeline current.", jobs: [D("quote_followup", "Follow up open quotes"), D("pipeline", "Pipeline summary", "weekly:0")] },
  { key: "commercial_qs", side: "rgs", en: "Commercial Manager / QS", ar: "المدير التجاري / مساح الكميات", role: "finance", reportsTo: "general_manager", agent: "Commercial agent",
    mission: "Finds certified work not yet claimed, prepares progress claims and checks variations.", jobs: [D("claims_ready", "Claims ready to submit", "monthly:25"), D("variations_open", "Open variations")] },
  { key: "finance", side: "rgs", en: "Billing Accountant", ar: "محاسب الفوترة", role: "finance", reportsTo: "commercial_qs", agent: "Billing agent",
    mission: "Drafts rental invoices for unbilled days and politely chases overdue payments.", jobs: [D("billing_run", "Draft rental invoices"), D("dunning", "Chase overdue invoices")] },
  { key: "qaqc_manager", side: "rgs", en: "QA/QC Manager", ar: "مدير ضبط وتأكيد الجودة", role: "inspector", reportsTo: "ops_manager", agent: "Quality agent",
    mission: "Spots NCR trends, keeps hold points and document reviews moving, prepares audits.", jobs: [D("ncr_trends", "NCR trends"), D("hold_points_due", "Hold points and reviews due")] },
  { key: "inspector", side: "rgs", en: "Scaffold Inspector", ar: "مفتش سقالات", role: "inspector", reportsTo: "qaqc_manager", agent: "Inspection agent",
    mission: "Plans today's inspection round from tags due and red tags open.", jobs: [D("inspection_round", "Today's inspection round")] },
  { key: "hse_training", side: "rgs", en: "HSE & Training Manager", ar: "مدير السلامة والتدريب", role: "hse_training", reportsTo: "general_manager", agent: "Safety agent",
    mission: "Prepares toolbox talks in the crews' languages, watches heat stress, permits and open HSE findings.", jobs: [D("toolbox_talk", "Toolbox talk in crew languages"), D("hse_watch", "Heat stress, permits and findings")] },
  { key: "hr_saudization", side: "rgs", en: "HR & Saudization Officer", ar: "مسؤول الموارد البشرية والسعودة", role: "hse_training", reportsTo: "general_manager", agent: "People agent",
    mission: "Books certificate refreshers, flags iqama renewals and tracks the Saudization ratio.", jobs: [D("cert_renewals", "Certificate refreshers"), D("iqama_saudization", "Iqama and Saudization")] },
  { key: "procurement", side: "rgs", en: "Procurement & Stores Lead", ar: "مسؤول المشتريات والمخازن", role: "yard_logistics", reportsTo: "ops_manager", agent: "Stores agent",
    mission: "Keeps yard stock above reorder levels and drafts purchase orders.", jobs: [D("reorder", "Stock below reorder level")] },
  { key: "yard_logistics", side: "rgs", en: "Yard & Logistics Lead", ar: "مسؤول الساحة واللوجستيات", role: "yard_logistics", reportsTo: "ops_manager", agent: "Dispatch agent",
    mission: "Plans tomorrow's deliveries and collections and reconciles material on site.", jobs: [D("dispatch_plan", "Tomorrow's dispatch plan")] },
  { key: "site_supervisor", side: "rgs", en: "Site Supervisor", ar: "مشرف الموقع", role: "site_supervisor", reportsTo: "project_manager", agent: "Site agent",
    mission: "Turns crews' voice reports into progress and reminds you what's due on site.", jobs: [D("site_day", "Today on site")] },
  { key: "foreman", side: "rgs", en: "Foreman", ar: "رئيس عمال", role: "site_supervisor", reportsTo: "site_supervisor", agent: "Crew agent",
    mission: "Takes your voice report in your language and logs the day's progress.", jobs: [D("site_day", "Today's work")] },
  { key: "document_controller", side: "rgs", en: "Document Controller", ar: "مراقب الوثائق", role: "site_supervisor", reportsTo: "qaqc_manager", agent: "Document agent",
    mission: "Chases overdue document reviews and keeps transmittals and revisions in order.", jobs: [D("doc_reviews_overdue", "Overdue document reviews")] },
  { key: "admin", side: "rgs", en: "IT & Systems Administrator", ar: "مسؤول الأنظمة", role: "admin", agent: "Access agent",
    mission: "Reviews who has access, who hasn't set up MFA and unusual sign-in activity.", jobs: [D("access_review", "Access review", "weekly:0")] },
  // ── Clients ──
  { key: "client_pm", side: "client", en: "Client Project Manager", ar: "مدير مشروع العميل", role: "client_admin", agent: "Project agent",
    mission: "Tells you what needs your signature, what changed and what RGS is waiting for from you.", jobs: [D("my_decisions", "Decisions waiting for me")] },
  { key: "client_consultant", side: "client", en: "Consultant / PMC", ar: "الاستشاري", role: "client_consultant", reportsTo: "client_pm", agent: "Review agent",
    mission: "Prepares your review queue: hold points to witness and documents to code, with what to check.", jobs: [D("review_queue", "Review queue")] },
  { key: "client_hse", side: "client", en: "Client HSE / QA", ar: "السلامة والجودة لدى العميل", role: "client_hse", reportsTo: "client_pm", agent: "Safety agent",
    mission: "Summarises RGS's safety performance and open HSE findings on your sites.", jobs: [D("client_hse_digest", "HSE digest")] },
  { key: "client_procurement", side: "client", en: "Client Procurement / Finance", ar: "مشتريات / مالية العميل", role: "client_finance", reportsTo: "client_pm", agent: "Claim-check agent",
    mission: "Checks every claim and invoice against certified quantities and approved variations before you certify or pay.", jobs: [D("claim_check", "Check claims and invoices")] },
  { key: "client_executive", side: "client", en: "Client Executive (view only)", ar: "تنفيذي لدى العميل (عرض فقط)", role: "client_viewer", agent: "Executive digest",
    mission: "A short portfolio digest: progress, risks, money and safety, linked to the records.", jobs: [D("exec_digest", "Executive digest", "weekly:0")] },
  { key: "client_requester", side: "client", en: "Client Engineer", ar: "مهندس العميل", role: "client_user", reportsTo: "client_pm", agent: "Request agent",
    mission: "Keeps track of your requests and instructions and tells you when RGS responds.", jobs: [D("my_requests", "My requests")] },
];

export const POSITION = Object.fromEntries(POSITIONS.map((p) => [p.key, p]));
/** Default position for someone without one, from their permission role. */
export const defaultPosition = (role: string) =>
  ({ client_admin: "client_pm", client_consultant: "client_consultant", client_hse: "client_hse", client_finance: "client_procurement", client_viewer: "client_executive", client_user: "client_requester" } as Record<string, string>)[role] ?? (POSITION[role] ? role : "ops_manager");

export const SAMPLE_LIMITS: [string, string, number | null][] = [
  ["project_manager", "quote", 100_000], ["ops_manager", "quote", 500_000], ["general_manager", "quote", null],
  ["finance", "credit_note", 25_000], ["commercial_qs", "credit_note", 100_000], ["general_manager", "credit_note", null],
  ["finance", "invoice", 250_000], ["commercial_qs", "invoice", 1_000_000], ["general_manager", "invoice", null],
];
