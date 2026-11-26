# RGS OneSite: Critical Review and Portal Expansion Plan

Reviewer stance: client-portal lead with Saudi contracting experience across scaffolding, waterproofing and thermal insulation.
Scope: the platform as built through Day 5, measured against (a) what Saudi clients such as Aramco, Sadara, PMCs and developers expect from a contractor portal, and (b) the section list of our team's earlier prototype.

---

## 1. Verdict

The agent engine is strong for an MVP: tiered approvals, RLS, traces, durable workflows, offline inspections, and estimating through invoicing. **The client portal is the weak half.** Clients today can look (tags, quotes, invoices) and do three things (request, accept a quote, ask for off-hire). A Saudi owner's engineer expects to **run the contract** through the portal: instructions, variations, hold points, sign-offs, submittals, measurements, handover, warranty. We also only model scaffolding, while RGS sells "all your construction needs in one partner".

The gaps below are ranked **P0** (blocks a credible pitch to RGS or Aramco), **P1** (needed before real use) and **P2** (needed at scale).

---

## 2. What is missing or weak

### P0: blocks a credible pitch

| # | Gap | Why it matters in KSA | Fix |
|---|---|---|---|
| 1 | **Scaffolding-only data model.** No waterproofing or insulation scopes, units, rates, QA or warranties. | RGS's pitch is "one partner". Turnaround packages bundle scaffold, insulation and painting; roofs bundle waterproofing and heat insulation. | Service-line model: each line has its own scope schema, units (m², lm by pipe NPS and thickness, fittings), rate card, ITP and warranty rules. |
| 2 | **No Project/contract layer.** Only jobs per site. | Owners manage by contract or PO: value, VOs, milestones, progress %, retention. | Projects with service lines, areas/zones, BOQ, milestones, progress (measured and stage-weighted), budget vs actual. |
| 3 | **One-way client portal.** No instructions, variations or sign-offs. | Site instructions and VOs are where margin is won or lost. Without a signed instruction trail RGS can't claim. | Instructions & changes (client instruction → RGS VO → priced → client approval) and **My sign-offs** inbox: hold points, measurements, VOs, completion. |
| 4 | **No document control.** Uploads exist; no submittals, revisions or review codes. | Method statements, material submittals and shop drawings go through A/B/C/D review before work. Missing approved submittals means stop-work. | Document register with revisions, transmittals, A/B/C/D review by client or consultant, comment resolution, "latest approved" rule. |
| 5 | **Quality is scaffold-only and hard-coded.** No ITP, hold points, tests or NCR/CAPA lifecycle. | Flood tests, adhesion and thickness checks are client hold points. NCR close-out is audited. | Checklist templates per service line; ITP with hold/witness points; tests with evidence; findings → corrective actions → verification → client close-out. |
| 6 | **Demo-only sign-in.** No invites, client user admin, MFA or SSO. | An Aramco IT review stops here. | Supabase Auth (email OTP + MFA), client-admin invites, Azure AD SSO path, session policies. |
| 7 | **Not deployed; production DB empty.** | Nobody can see it. | Deploy to Vercel, seed once, protected preview link. |
| 8 | **Tests live outside the repo.** No CI. | Every change risks regressions; reviewers will ask. | Commit the Playwright suites; GitHub Actions runs build, typecheck and e2e on a fresh Postgres. |

### P1: needed before real use

- **Notifications are written but never shown.** There is no bell or notification centre, so red-tag and approval alerts sit unread in the table. Easy fix, high impact.
- **Commercial depth:** progress claims from signed measurements, retention, advance recovery, credit/debit notes (the Qiddiya over-billing case needs one), statement of account and ageing, Oracle sync.
- **Arabic is UI-deep, not content-deep.** Agent briefs, PDF line items and generated notes are mostly English. No Hijri dates where clients expect them. Full-text search uses the `simple` config (weak for Arabic).
- **AI never run live.** Mock mode only; no eval suite; the vector column is empty (search is keyword-only); no per-user cost limits screen.
- **Workforce (Day 6) not built:** certificate and iqama OCR, competency matrix, crew allocation against offshore cards, Saudization (Nitaqat), Qiwa/Muqeem.
- **Weather is a rule in text, not data.** The 38 km/h wind stop and waterproofing application limits (rain, dew point, substrate temperature in summer) need a forecast feed and checks.
- **No audit log viewer**, though everything is logged.
- **Approvals rejected by Finance leave invoices "pending approval"** (status not rolled back). Similar edge cases need a sweep.

### P2: at scale

Pagination and caching; Sentry/observability; backup and restore drills; KSA data residency move; accessibility audit; equipment certification (thorough examination of mast climbers and hoists); client satisfaction surveys; multi-company support for other Tamimi entities; native app if Android scanning or offline needs grow.

---

## 3. Saudi-market insights that should shape the portal

1. **Clients rate contractors on four things:** response time, safety record, documentation at handover, invoice accuracy. Put all four on the client overview as live numbers.
2. **Aramco / Sadara / SABIC work runs on ITPs and approved submittals.** The portal should block "start work" on an area until its method statement and material submittal are code A or B, and its permit and work-front prerequisites are met (Dependencies).
3. **Waterproofing:**
   - **Warranty claims are the biggest reputational risk.** Joint 10-year RGS + manufacturer warranties need a warranty register, the manufacturer inspection record, the flood-test evidence and a leak-claim workflow.
   - **Summer substrate temperatures and sandstorms limit application windows.** The planner should know this.
4. **Industrial insulation:**
   - It is measured per linear metre by pipe size and thickness, with fittings converted using equivalent-length factors.
   - Removable covers and inspection windows matter for corrosion-under-insulation (CUI) programmes. This opens recurring maintenance contracts.
   - Offshore insulation depends on RGS scaffolds being green-tagged: a cross-service dependency the portal can show.
5. **Payment cycles are long and retention is normal.** A clear statement of account, claim status and retention-release dates in the portal measurably shortens collection.
6. **Arabic-first for government and semi-government clients.** Generated documents need Arabic content, not just Arabic labels.
7. **Cybersecurity:** Aramco requires third-party cybersecurity compliance from contractors that handle its data. Design for MFA, SSO, data classification and access reviews now; certify later.

---

## 4. Target structure (from our earlier prototype) mapped to OneSite

| Group | Section | Today | Plan |
|---|---|---|---|
| Workspace | Overview | Partial (scaffold KPIs) | Per-role overview: response time, safety, documents, invoice accuracy; service-line tiles |
| | Management oversight | Missing | Portfolio heat-map across projects: progress vs plan, margin, risks, overdue sign-offs, cash |
| | Projects | Partial (jobs) | **New**: contracts with service lines, areas, BOQ, milestones, budget vs actual |
| | Reports | Missing | Bilingual weekly progress, HSE monthly, commercial status; scheduled email |
| Delivery | What changed | Partial (audit log, agent feed) | Human-readable activity stream per project, filterable |
| | Progress | Missing | Measured quantities + stage-weighted %, daily reports with photos, S-curve |
| | Commitments and milestones | Missing | Contract milestones, promised dates, slippage alerts |
| | Dependencies | Missing | Prerequisites (permits, work fronts, submittals, materials, weather, cross-service) gate area start |
| | Handover | Missing | Punch list, handover dossier (as-built, test certs, warranties), completion certificate sign-off |
| Customer interface | Requests | Exists | Add service line and areas; route to the right estimator |
| | Triage | Partial (status) | Triage board with SLA clock, AI classification, assignment |
| | Instructions and changes | Missing | Site instructions → variation orders → pricing → client approval |
| | My sign-offs | Partial (quote accept) | One inbox: hold points, measurements, VOs, completion, documents |
| Quality and safety | Inspections | Scaffold only | Generalised to ITP inspections for all service lines; scaffold tagging stays |
| | Findings | Partial (defects) | Findings from inspections, audits and client observations |
| | Corrective actions | Missing | NCR/CAPA: root cause, action, owner, due date, verification, client close-out |
| | Checklist templates | Hard-coded | Template builder per service line and client, versioned |
| | HSE | Partial (incidents) | KPIs (man-hours, LTI, TRIR, LTIFR), permits/JSAs, toolbox talks, MSDS/chemical register, waste |
| Document control | Documents | Partial (uploads) | Register with revisions, transmittals, "latest approved" |
| | Photos & evidence | Partial | Evidence library linked to areas, tests and sign-offs; geotag and time |
| | Document reviews | Missing | A/B/C/D review by client or consultant, comment sheet, resubmission |
| Help | Support | Missing | Tickets with SLA, warranty claims, AI help assistant, contact directory |
| Stage 1 review | Design system, Data model, Permission matrix, Access tester, Interface states, Architecture | Docs only | Live admin-only pages; the access tester shows what any chosen user can see and do (backed by RLS) |

---

## 5. Revised plan

- **Phase A: portal restructure and delivery.** New navigation (the groups above) for staff and clients. Service lines (scaffolding, waterproofing, insulation) with sample rates and scopes. Projects with areas, BOQ, milestones, budget vs actual. Progress (measured + stage-weighted). Dependencies. What changed. Requests and triage. Instructions → VOs. My sign-offs. Notification centre. Sample projects for all three lines.
- **Phase B: quality and documents.** Checklist templates and ITPs with hold/witness points and tests. Findings and CAPA. HSE KPIs, permits/JSA, toolbox talks, MSDS. Documents, evidence, A/B/C/D reviews. Handover dossier and warranty register.
- **Phase C: commercial and support.** Progress claims from signed measurements with retention and advance recovery; credit/debit notes; statement of account and ageing. Support tickets with SLA, warranty claims, help assistant, contacts. Workforce and certifications (former Day 6).
- **Phase D: hardening and go-live.** Stage 1 review pages including the access tester. Real auth (OTP, MFA, invites). Email / WhatsApp / SMS adapters (in-app until accounts exist). Live AI with an eval suite. Tests in CI. Deployment.

Each phase ends with a full regression run, a push and screenshots.

All rates, standards references and sample projects remain **SAMPLE** until RGS supplies its own.
