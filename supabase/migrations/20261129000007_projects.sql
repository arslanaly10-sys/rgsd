-- Phase A: multi-service projects (scaffolding, waterproofing, insulation), delivery tracking and client sign-offs.

-- New client-side roles: consultant/PMC, client HSE & QA/QC, client finance & procurement.
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'admin','ops_manager','estimator','site_supervisor','inspector','yard_logistics','hse_training','finance',
  'client_admin','client_user','client_consultant','client_hse','client_finance'));

-- Rate cards cover every service line.
alter table rate_items add column service_line text not null default 'scaffolding' check (service_line in ('scaffolding','waterproofing','insulation'));
alter table rate_items drop constraint rate_items_category_check;
alter table rate_items add constraint rate_items_category_check check (category in (
  'erection','dismantle','rental','mobilisation','uplift','labour','transport','inspection','design',
  'waterproofing','insulation','cladding','testing','protection','preparation'));

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  ref text not null,
  name text not null,
  name_ar text,
  description text,
  service_lines text[] not null default '{}',
  status text not null default 'active' check (status in ('planned','active','on_hold','completed','closed')),
  contract_value numeric(14,2) not null default 0,
  po_number text,
  start_date date,
  end_date date,
  retention_pct numeric(5,2) not null default 10,
  advance_pct numeric(5,2) not null default 10,
  dlp_months int not null default 12,
  consultant_name text,
  rgs_pm_id uuid references profiles(id),
  client_pm_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

create table project_areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  service_line text not null check (service_line in ('scaffolding','waterproofing','insulation')),
  code text not null,
  name text not null,
  name_ar text,
  system text,                       -- e.g. 'APP 2 × 4 mm + XPS 50 mm + screed'
  uom text not null check (uom in ('m2','lm','m3','each','lot')),
  boq_qty numeric(14,2) not null,
  rate numeric(12,2) not null,
  installed_qty numeric(14,2) not null default 0,   -- reported by RGS crews
  approved_qty numeric(14,2) not null default 0,    -- signed by the client on measurement sheets
  stage text not null default 'not_started',
  stage_pct numeric(5,2) not null default 0,         -- stage-weighted progress
  status text not null default 'not_started' check (status in ('not_started','in_progress','on_hold','complete')),
  planned_start date,
  planned_finish date,
  sort int not null default 0,
  unique (project_id, code)
);

create table progress_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  area_id uuid not null references project_areas(id) on delete cascade,
  entry_date date not null default current_date,
  qty numeric(14,2) not null default 0,
  stage text,
  notes text,
  photos text[] not null default '{}',
  reported_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table measurements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  ref text not null,
  period_from date not null,
  period_to date not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  lines jsonb not null default '[]',   -- [{area_id, code, name, uom, prev_qty, this_qty, cum_qty, rate, amount}]
  total_value numeric(14,2) not null default 0,
  submitted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  service_line text,
  name text not null,
  name_ar text,
  due_date date not null,
  forecast_date date,
  status text not null default 'pending' check (status in ('pending','achieved','missed')),
  achieved_at date,
  sort int not null default 0
);

create table dependencies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  area_id uuid references project_areas(id) on delete cascade,
  kind text not null check (kind in ('permit','work_front','submittal','material','weather','cross_service','client_info')),
  description text not null,
  owner_side text not null check (owner_side in ('client','rgs')),
  status text not null default 'open' check (status in ('open','met','blocked','waived')),
  due_date date,
  scaffold_id uuid references scaffolds(id) on delete set null,   -- cross-service: work needs this scaffold green
  met_at timestamptz,
  created_at timestamptz not null default now()
);

create table instructions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  ref text not null,
  title text not null,
  description text,
  issued_by uuid references profiles(id),
  issued_at timestamptz not null default now(),
  status text not null default 'issued' check (status in ('issued','acknowledged','vo_required','closed','rejected')),
  response text,
  unique (org_id, ref)
);

create table variations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  instruction_id uuid references instructions(id) on delete set null,
  ref text not null,
  title text not null,
  description text,
  lines jsonb not null default '[]',
  amount numeric(14,2) not null default 0,
  days_impact int not null default 0,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','withdrawn')),
  submitted_at timestamptz,
  decided_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

-- One inbox for everything a client must sign: measurements, hold points, variations, completion, documents.
create table signoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  kind text not null check (kind in ('measurement','hold_point','variation','completion','inspection','document')),
  entity_type text,
  entity_id uuid,
  title text not null,
  title_ar text,
  summary text,
  amount numeric(14,2),
  required_roles text[] not null,           -- every listed client role must approve (e.g. client_admin + client_finance above SAR 100,000)
  approvals jsonb not null default '[]',    -- [{role, user_id, name, decision, comment, at}]
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  due_date date,
  decided_at timestamptz
);
create index signoffs_pending_idx on signoffs (client_company_id, status);

alter table invoices add column project_id uuid references projects(id) on delete set null;

-- RLS for the new tables: staff of the org get everything; client users read their own company's rows.
do $$
declare t text;
begin
  foreach t in array array['projects','project_areas','progress_entries','measurements','milestones','dependencies','instructions','variations','signoffs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff())', t);
    execute format('create policy client_read on public.%I for select to authenticated using (org_id = app.org() and client_company_id = app.client_company())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit()', t);
  end loop;
end $$;

-- Clients see draft measurements/VOs only once submitted.
drop policy client_read on measurements;
create policy client_read on measurements for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and status <> 'draft');
drop policy client_read on variations;
create policy client_read on variations for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and status <> 'draft');

-- Clients may issue site instructions on their own projects.
create policy client_insert on instructions for insert to authenticated
  with check (org_id = app.org() and client_company_id = app.client_company() and issued_by = app.uid());
