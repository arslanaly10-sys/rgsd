-- Phase B: quality (checklist templates, ITPs with tests and hold points, findings with CAPA), HSE, document control, handover and warranties.

create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,   -- null = RGS standard; set = client-specific variant
  service_line text not null check (service_line in ('scaffolding','waterproofing','insulation')),
  system text,                       -- e.g. 'bituminous', 'liquid', 'hot', 'cold', 'roof'
  code text not null,
  name text not null,
  name_ar text,
  version int not null default 1,
  active boolean not null default true,
  items jsonb not null,              -- [{seq, title, title_ar, kind: inspection|test|hold|witness, test_kind?, criteria, acceptance?: {min?, max?, unit, equals?}}]
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, code, version)
);

create table itp_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  area_id uuid not null references project_areas(id) on delete cascade,
  template_id uuid references checklist_templates(id) on delete set null,
  seq int not null,
  title text not null,
  title_ar text,
  kind text not null check (kind in ('inspection','test','hold','witness')),
  test_kind text check (test_kind in ('flood_test','adhesion','thickness','holiday','moisture','dew_point','substrate_temp','visual','overlap')),
  criteria text,
  acceptance jsonb,                  -- {min, max, unit, equals}
  status text not null default 'pending' check (status in ('pending','passed','failed','waived','awaiting_client')),
  readings jsonb not null default '[]',   -- [{value, location, at}]
  result_note text,
  evidence uuid[] not null default '{}',  -- documents.id
  inspected_by uuid references profiles(id),
  inspected_at timestamptz,
  signoff_id uuid references signoffs(id) on delete set null,
  unique (area_id, seq)
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  area_id uuid references project_areas(id) on delete set null,
  scaffold_id uuid references scaffolds(id) on delete set null,
  itp_step_id uuid references itp_steps(id) on delete set null,
  ref text not null,
  kind text not null check (kind in ('ncr','observation','punch','hse','audit')),
  source text not null check (source in ('itp','inspection','client','audit','hse','handover')),
  severity text not null check (severity in ('low','medium','high','critical')),
  title text not null,
  description text,
  raised_by uuid references profiles(id),
  raised_side text not null check (raised_side in ('rgs','client')),
  status text not null default 'open' check (status in ('open','action_planned','verification','closed','rejected')),
  due_date date,
  root_cause text,
  correction text,              -- immediate fix
  corrective_action text,       -- stop it happening again here
  preventive_action text,       -- stop it happening elsewhere
  action_owner uuid references profiles(id),
  action_due date,
  evidence uuid[] not null default '{}',
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  closed_by uuid references profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

-- HSE
create table manhours (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  month date not null,
  hours numeric(12,1) not null,
  headcount int not null default 0,
  unique (site_id, project_id, month)
);
create table toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  held_on date not null,
  topic text not null,
  topic_ar text,
  language text not null default 'en',
  attendees int not null,
  conducted_by uuid references profiles(id)
);
create table permits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  area_id uuid references project_areas(id) on delete set null,
  ref text not null,
  kind text not null check (kind in ('hot_work','work_at_height','cold_work','confined_space','excavation','lifting')),
  issued_by text,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  status text not null default 'active' check (status in ('requested','active','closed','suspended')),
  jsa jsonb not null default '[]'      -- [{step, hazard, control}]
);
create table chemical_register (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  product text not null,
  product_ar text,
  service_line text not null,
  hazard_class text,
  ghs text[] not null default '{}',
  storage text,
  ppe text,
  msds_document_id uuid references documents(id) on delete set null,
  msds_revised date,
  approved boolean not null default true
);
create table waste_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  logged_on date not null,
  kind text not null check (kind in ('membrane_offcuts','empty_containers_hazardous','insulation_offcuts','cladding_scrap','general')),
  qty numeric(10,2) not null,
  unit text not null default 'kg',
  disposal text not null,
  manifest_ref text
);

-- Document control
create table controlled_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  number text not null,
  title text not null,
  title_ar text,
  doc_type text not null check (doc_type in ('method_statement','material_submittal','shop_drawing','itp','test_report','warranty','as_built','om_manual','certificate','other')),
  service_line text,
  current_rev text,
  status text not null default 'draft' check (status in ('draft','under_review','approved','approved_with_comments','revise_resubmit','rejected','superseded')),
  required_for_handover boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create table document_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  controlled_document_id uuid not null references controlled_documents(id) on delete cascade,
  rev text not null,
  document_id uuid references documents(id) on delete set null,   -- the file
  transmittal_ref text,
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  due_date date,
  review_code text check (review_code in ('A','B','C','D')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  comments jsonb not null default '[]',    -- [{no, comment, by, response?}]
  unique (controlled_document_id, rev)
);
alter table dependencies add column controlled_document_id uuid references controlled_documents(id) on delete set null;

-- Handover & warranty
create table warranties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  area_id uuid references project_areas(id) on delete set null,
  ref text not null,
  system text not null,
  coverage text not null,
  coverage_ar text,
  kind text not null check (kind in ('joint_manufacturer','rgs')),
  manufacturer text,
  years int not null,
  starts_on date,
  ends_on date,
  conditions text,
  status text not null default 'pending' check (status in ('pending','active','expired','void')),
  issued_at timestamptz,
  unique (org_id, ref)
);

do $$
declare t text;
begin
  foreach t in array array['itp_steps','findings','manhours','toolbox_talks','permits','waste_log','controlled_documents','document_revisions','warranties'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff())', t);
    execute format('create policy client_read on public.%I for select to authenticated using (org_id = app.org() and client_company_id = app.client_company())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit()', t);
  end loop;
  foreach t in array array['checklist_templates','chemical_register'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff())', t);
    execute format('create policy member_read on public.%I for select to authenticated using (org_id = app.org())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Clients only see document revisions once submitted, and never RGS-internal draft documents.
drop policy client_read on document_revisions;
create policy client_read on document_revisions for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and submitted_at is not null);
drop policy client_read on controlled_documents;
create policy client_read on controlled_documents for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and status <> 'draft');
-- Clients may raise observations (findings) on their own projects; closing and CAPA go through server actions.
create policy client_insert on findings for insert to authenticated
  with check (org_id = app.org() and client_company_id = app.client_company() and raised_side = 'client' and raised_by = app.uid());

create index itp_steps_area_idx on itp_steps (area_id, seq);
create index findings_status_idx on findings (client_company_id, status);
create index doc_rev_pending_idx on document_revisions (controlled_document_id) where review_code is null;

-- Client-specific checklist variants are visible only to that client (and RGS staff).
drop policy member_read on checklist_templates;
create policy member_read on checklist_templates for select to authenticated
  using (org_id = app.org() and (client_company_id is null or client_company_id = app.client_company() or app.is_staff()));
