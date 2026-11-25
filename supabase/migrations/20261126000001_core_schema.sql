-- RGS OneSite core schema.
-- Conventions: every table has org_id. Tables a client may see also have client_company_id.
-- Access is enforced by RLS (see 20261126000002_rls.sql) using the JWT claims the app sets per request.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ───────────────────────── Tenancy & people ─────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  created_at timestamptz not null default now()
);

create table client_companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  name_ar text,
  cr_number text,
  vat_number text,
  oracle_customer_id text,
  is_sample boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key default gen_random_uuid(), -- equals auth.users.id when using Supabase Auth
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  full_name text not null,
  full_name_ar text,
  email text not null unique,
  phone text,
  title text,
  role text not null check (role in (
    'admin','ops_manager','estimator','site_supervisor','inspector','yard_logistics','hse_training','finance',
    'client_admin','client_user')),
  locale text not null default 'en' check (locale in ('en','ar')),
  created_at timestamptz not null default now(),
  check ((role like 'client_%') = (client_company_id is not null))
);

-- ───────────────────────── Sites & jobs ─────────────────────────
create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  code text not null,
  name text not null,
  name_ar text,
  type text not null check (type in ('offshore','petrochemical','high_rise','marine','infrastructure','entertainment','industrial')),
  city text,
  region text,
  lat double precision,
  lng double precision,
  access_requirements text,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table rate_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  currency text not null default 'SAR',
  is_sample boolean not null default true,
  valid_from date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table rate_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  rate_card_id uuid not null references rate_cards(id) on delete cascade,
  code text not null,
  category text not null check (category in ('erection','dismantle','rental','mobilisation','uplift','labour','transport','inspection','design')),
  description text not null,
  description_ar text,
  unit text not null check (unit in ('m3','m2','lm','day','week','month','trip','lot','hour','each','pct')),
  rate numeric(12,2) not null,
  unique (rate_card_id, code)
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  ref text not null,
  source text not null default 'portal' check (source in ('portal','web','whatsapp','email','phone','voice')),
  title text not null,
  description text,
  scaffold_type text,
  required_by date,
  status text not null default 'new' check (status in ('new','triage','estimating','quoted','won','lost','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  created_by uuid references profiles(id),
  ai_summary jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  request_id uuid references requests(id) on delete set null,
  ref text not null,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','sent','accepted','rejected','expired')),
  kind text not null default 'firm' check (kind in ('indicative','firm','tender')),
  currency text not null default 'SAR',
  subtotal numeric(14,2) not null default 0,
  vat_rate numeric(5,4) not null default 0.15,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  valid_until date,
  assumptions text,
  assumptions_ar text,
  prepared_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  ai_generated boolean not null default false,
  ai_confidence numeric(4,3),
  created_at timestamptz not null default now(),
  unique (org_id, ref, version)
);

create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  quote_id uuid not null references quotes(id) on delete cascade,
  rate_item_id uuid references rate_items(id) on delete set null,
  description text not null,
  description_ar text,
  qty numeric(14,3) not null,
  unit text not null,
  rate numeric(12,2) not null,
  amount numeric(14,2) not null,
  sort int not null default 0
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  quote_id uuid references quotes(id) on delete set null,
  ref text not null,
  title text not null,
  title_ar text,
  status text not null default 'planned' check (status in ('planned','mobilising','active','on_hold','demobilising','closed')),
  start_date date,
  end_date date,
  supervisor_id uuid references profiles(id),
  po_number text,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

-- ───────────────────────── Scaffolds & inspections ─────────────────────────
create table scaffolds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  tag_no text not null,
  qr_code text not null,
  location_desc text,
  type text not null check (type in ('tube_coupler','system_cuplock','system_ringlock','mobile_tower','suspended','cantilever','birdcage','mast_climber','hoist')),
  load_class text,              -- e.g. 'Class 3 · 2.0 kN/m²'
  duty text check (duty in ('light','medium','heavy','special')),
  height_m numeric(7,2),
  length_m numeric(7,2),
  width_m numeric(7,2),
  volume_m3 numeric(10,2),
  status text not null default 'erecting' check (status in ('erecting','green','yellow','red','dismantled')),
  restrictions text,            -- what yellow (restricted use) means for this scaffold
  erected_at date,
  last_inspected_at timestamptz,
  next_inspection_due date,
  created_at timestamptz not null default now(),
  unique (org_id, tag_no)
);

create table inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  scaffold_id uuid not null references scaffolds(id) on delete cascade,
  inspector_id uuid references profiles(id),
  type text not null check (type in ('handover','periodic_7day','after_weather','after_modification','ad_hoc')),
  checklist jsonb not null default '[]',   -- [{code, label, result: pass|fail|na, note}]
  result text not null check (result in ('green','yellow','red')),
  restrictions text,
  notes text,
  photos text[] not null default '{}',
  ai_findings jsonb,                       -- [{code, description, severity, confidence, bbox?}]
  ai_suggested_result text check (ai_suggested_result in ('green','yellow','red')),
  offline_id text unique,                  -- idempotency key from the field PWA outbox
  inspected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table defects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  scaffold_id uuid not null references scaffolds(id) on delete cascade,
  inspection_id uuid references inspections(id) on delete set null,
  code text not null,
  description text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','fixed','verified')),
  photo text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- ───────────────────────── Fleet & logistics ─────────────────────────
create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('yard','site','vehicle')),
  name text not null,
  name_ar text,
  site_id uuid references sites(id) on delete cascade,
  city text
);

create table items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  name_ar text,
  category text not null check (category in ('tube','fitting','board','system','accessory','mast_climber','hoist','ppe')),
  unit text not null default 'each',
  weight_kg numeric(10,2) not null default 0,
  replacement_value numeric(12,2) not null default 0,
  rental_rate_day numeric(10,3) not null default 0,
  unique (org_id, sku)
);

create table stock (
  org_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  qty numeric(14,2) not null default 0,
  reserved numeric(14,2) not null default 0,
  primary key (item_id, location_id)
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plate text not null,
  kind text not null check (kind in ('flatbed','trailer','crane_truck','pickup','boat_charter')),
  capacity_kg numeric(10,0) not null,
  driver_name text,
  base_location_id uuid references locations(id),
  status text not null default 'available' check (status in ('available','in_use','maintenance'))
);

create table movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  kind text not null check (kind in ('delivery','return','transfer','adjustment','loss')),
  ref text not null,
  from_location_id uuid references locations(id),
  to_location_id uuid references locations(id),
  delivery_note_no text,
  vehicle_id uuid references vehicles(id),
  status text not null default 'planned' check (status in ('planned','in_transit','completed','cancelled')),
  scheduled_for date,
  completed_at timestamptz,
  document_path text,
  ai_extracted jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table movement_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  movement_id uuid not null references movements(id) on delete cascade,
  item_id uuid not null references items(id),
  qty numeric(14,2) not null
);

create table on_hire (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  item_id uuid not null references items(id),
  qty numeric(14,2) not null,
  rate_day numeric(10,3) not null,
  start_date date not null,
  end_date date,
  status text not null default 'on_hire' check (status in ('on_hire','off_hire_requested','returned')),
  off_hire_requested_at timestamptz,
  last_billed_until date
);

create table dispatch_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan_date date not null,
  status text not null default 'draft' check (status in ('draft','approved','executed','discarded')),
  plan jsonb not null,
  created_by_agent boolean not null default true,
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ───────────────────────── Workforce ─────────────────────────
create table workers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_no text not null,
  full_name text not null,
  full_name_ar text,
  nationality text,
  trade text not null check (trade in ('scaffolder','advanced_scaffolder','scaffold_supervisor','scaffold_inspector','rigger','helper','driver','hse_officer')),
  grade text,
  iqama_no text,
  iqama_expiry date,
  phone text,
  languages text[] not null default '{}',
  status text not null default 'active' check (status in ('active','on_leave','demobilised')),
  current_site_id uuid references sites(id) on delete set null,
  unique (org_id, employee_no)
);

create table certifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  worker_id uuid not null references workers(id) on delete cascade,
  kind text not null check (kind in ('cisrs','citb','opito_bosiet','tuv_scaffold','aramco_id','aramco_scaffold_card','first_aid','working_at_height','h2s','rigging','driving_licence')),
  number text,
  issuer text,
  issued_on date,
  expires_on date,
  document_path text,
  ai_extracted jsonb,
  verified boolean not null default false
);

create table training_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  title_ar text,
  kind text not null,
  scheduled_on date not null,
  trainer text,
  capacity int not null default 12,
  location text
);

create table training_attendees (
  session_id uuid not null references training_sessions(id) on delete cascade,
  worker_id uuid not null references workers(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  status text not null default 'enrolled' check (status in ('enrolled','attended','passed','failed','no_show')),
  primary key (session_id, worker_id)
);

create table crew_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  worker_id uuid not null references workers(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  role text,
  start_date date not null,
  end_date date,
  status text not null default 'confirmed' check (status in ('proposed','confirmed','ended')),
  proposed_by_agent boolean not null default false
);

-- ───────────────────────── Finance ─────────────────────────
create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  ref text not null,
  period_from date,
  period_to date,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','issued','paid','void')),
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  currency text not null default 'SAR',
  po_number text,
  due_date date,
  zatca_status text not null default 'not_submitted' check (zatca_status in ('not_submitted','cleared','reported','rejected')),
  zatca_uuid text,
  oracle_invoice_id text,
  created_by_agent boolean not null default false,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  description_ar text,
  qty numeric(14,3) not null,
  unit text not null,
  rate numeric(12,3) not null,
  amount numeric(14,2) not null,
  source jsonb
);

-- ───────────────────────── HSE, documents, knowledge ─────────────────────────
create table incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  scaffold_id uuid references scaffolds(id) on delete set null,
  kind text not null check (kind in ('near_miss','first_aid','lti','property_damage','observation')),
  title text not null,
  description text,
  root_cause text,
  lessons text,
  tags text[] not null default '{}',
  occurred_at timestamptz not null,
  reported_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  entity_type text,
  entity_id uuid,
  kind text not null check (kind in ('drawing','rfq','boq','method_statement','design_calc','certificate','photo','delivery_note','invoice','permit','procedure','other')),
  title text not null,
  storage_path text,
  mime text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  ai_extracted jsonb,
  created_at timestamptz not null default now()
);

create table kb_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade, -- null = RGS internal knowledge
  title text not null,
  kind text not null check (kind in ('procedure','method_statement','client_spec','standard_note','past_quote','lesson_learned','faq')),
  language text not null default 'en',
  source_document_id uuid references documents(id) on delete set null,
  staff_only boolean not null default true,
  created_at timestamptz not null default now()
);

create table kb_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kb_document_id uuid not null references kb_documents(id) on delete cascade,
  chunk_index int not null,
  heading text,
  content text not null,
  embedding vector(1024),
  tsv tsvector generated always as (to_tsvector('simple', coalesce(heading,'') || ' ' || content)) stored
);
create index kb_chunks_tsv_idx on kb_chunks using gin (tsv);
create index kb_chunks_trgm_idx on kb_chunks using gin (content gin_trgm_ops);

-- ───────────────────────── Agent system ─────────────────────────
create table agent_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  tool text not null,
  tier int not null check (tier between 0 and 3),
  allowed_roles text[] not null default '{}',   -- roles that may trigger this tool at all
  auto_roles text[] not null default '{}',      -- roles whose T2 calls run without approval
  approver_roles text[] not null default '{}',  -- roles that may approve
  description text,
  unique (org_id, tool)
);

create table memories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  scope text not null check (scope in ('org','client','site','user')),
  scope_id uuid,
  client_company_id uuid references client_companies(id) on delete cascade,
  content text not null,
  source text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table agent_examples (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  agent text not null,
  task text not null,
  input jsonb not null,
  output jsonb not null,
  corrected_output jsonb,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  status text not null default 'queued' check (status in ('queued','running','waiting','completed','failed','cancelled')),
  input jsonb not null default '{}',
  state jsonb not null default '{}',
  current_step text,
  error text,
  attempts int not null default 0,
  next_run_at timestamptz not null default now(),
  locked_until timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflow_runs_due_idx on workflow_runs (status, next_run_at);

create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  name text not null,
  status text not null check (status in ('running','completed','failed','waiting')),
  output jsonb,
  attempts int not null default 1,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workflow_run_id, name)
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  client_company_id uuid references client_companies(id) on delete cascade,
  agent text not null,
  channel text not null default 'web' check (channel in ('web','whatsapp','email','voice','cron','workflow')),
  conversation_id uuid,
  status text not null default 'running' check (status in ('running','waiting_approval','completed','failed')),
  input jsonb,
  output jsonb,
  model text,
  prompt_version text,
  mode text not null default 'mock' check (mode in ('mock','live')),
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric(10,5) not null default 0,
  latency_ms int,
  parent_run_id uuid references agent_runs(id) on delete set null,
  workflow_run_id uuid references workflow_runs(id) on delete set null,
  feedback text check (feedback in ('up','down')),
  feedback_note text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index agent_runs_conv_idx on agent_runs (conversation_id, created_at);

create table agent_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references agent_runs(id) on delete cascade,
  idx int not null,
  kind text not null check (kind in ('llm','tool','handoff','approval','guardrail')),
  name text not null,
  input jsonb,
  output jsonb,
  tier int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete set null,
  workflow_run_id uuid references workflow_runs(id) on delete set null,
  tool text not null,
  tier int not null,
  summary text not null,
  summary_ar text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','executed','failed')),
  approver_roles text[] not null default '{}',
  requested_by uuid references profiles(id),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text,
  result jsonb,
  created_at timestamptz not null default now()
);

create table channel_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email','voice','web')),
  direction text not null check (direction in ('in','out')),
  external_id text,
  from_addr text,
  to_addr text,
  subject text,
  body text,
  attachments jsonb not null default '[]',
  run_id uuid references agent_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  title text not null,
  title_ar text,
  description text,
  assignee_role text,
  assignee_id uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  source text not null default 'user' check (source in ('user','agent','watcher')),
  watcher text,
  dedupe_key text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text,
  client_company_id uuid references client_companies(id) on delete cascade,
  kind text not null,
  title text not null,
  title_ar text,
  body text,
  body_ar text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('oracle_erp','m365','zatca','whatsapp','email_inbox','qiwa','muqeem','gosi','client_permit')),
  status text not null default 'not_connected' check (status in ('not_connected','csv_only','connected','error')),
  config jsonb not null default '{}',   -- non-secret settings only
  last_sync_at timestamptz,
  unique (org_id, kind)
);

create table audit_log (
  id bigserial primary key,
  org_id uuid,
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user','agent','system')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  run_id uuid,
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index scaffolds_site_idx on scaffolds (site_id, status);
create index scaffolds_due_idx on scaffolds (next_inspection_due) where status in ('green','yellow');
create index inspections_scaffold_idx on inspections (scaffold_id, inspected_at desc);
create index on_hire_site_idx on on_hire (site_id, status);
create index certs_expiry_idx on certifications (expires_on);
create index workers_iqama_idx on workers (iqama_expiry);
create index requests_client_idx on requests (client_company_id, status);
create index approvals_status_idx on approval_requests (org_id, status);
create index tasks_status_idx on tasks (org_id, status, due_date);
