-- Hierarchy and personal agents.
-- position: the person's job (general manager, QS, foreman, client procurement...). role stays the permission set.
alter table profiles add column position text;
alter table profiles add column reports_to uuid references profiles(id) on delete set null;

-- Approval limits by position (SAR, before VAT). Null max = unlimited.
create table approval_limits (
  id uuid not null default gen_random_uuid() unique,
  org_id uuid not null references organizations(id) on delete cascade,
  position text not null,
  kind text not null check (kind in ('quote','credit_note','invoice','variation')),
  max_amount numeric(14,2),
  primary key (org_id, position, kind)
);
alter table approval_requests add column amount numeric(14,2);
alter table approval_requests add column approver_positions text[];

-- One personal agent per person.
create table personal_agents (
  profile_id uuid primary key references profiles(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  name text not null,
  persona text not null,
  autonomy text not null default 'routine' check (autonomy in ('drafts','routine')),
  paused boolean not null default false,
  last_cycle_at timestamptz,
  created_at timestamptz not null default now()
);
create table agent_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  job text not null,
  label text not null,
  schedule text not null,          -- daily | weekly:<0-6> | monthly:<1-28>
  enabled boolean not null default true,
  last_run_at timestamptz,
  unique (profile_id, job)
);
-- What each agent did or prepared for its owner.
create table agent_inbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  job text,
  kind text not null check (kind in ('briefing','done','draft','chase','triage','handoff','alert')),
  title text not null,
  body text,
  link text,
  payload jsonb not null default '{}',
  status text not null default 'info' check (status in ('info','proposed','approved','dismissed','done')),
  dedupe_key text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index agent_inbox_owner_idx on agent_inbox (profile_id, created_at desc);
create unique index agent_inbox_dedupe on agent_inbox (profile_id, dedupe_key) where dedupe_key is not null;

-- Work passed between agents and people along a chain (e.g. request → quote → approval → client).
create table agent_handoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  chain text not null,             -- e.g. request:<id>
  step int not null,
  from_label text not null,        -- "Mohammed's agent (Aramco PM)"
  to_label text not null,
  action text not null,
  link text,
  status text not null default 'done' check (status in ('done','waiting','approved','rejected')),
  created_at timestamptz not null default now()
);
create index agent_handoffs_chain_idx on agent_handoffs (chain, step);

create table org_settings (
  id uuid not null default gen_random_uuid() unique,
  org_id uuid primary key references organizations(id) on delete cascade,
  ai_mode text not null default 'auto' check (ai_mode in ('auto','mock','live')),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['approval_limits','personal_agents','agent_jobs','agent_inbox','agent_handoffs','org_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;
create policy staff_read on approval_limits for select to authenticated using (org_id = app.org() and app.is_staff());
create policy admin_write on approval_limits for all to authenticated using (org_id = app.org() and app.role() = 'admin') with check (org_id = app.org() and app.role() = 'admin');
-- Each person sees and manages only their own agent; admins can read all for audit.
create policy own on personal_agents for all to authenticated using (profile_id = app.uid() or (org_id = app.org() and app.role() = 'admin')) with check (profile_id = app.uid());
create policy own on agent_jobs for all to authenticated using (profile_id = app.uid() or (org_id = app.org() and app.role() = 'admin')) with check (profile_id = app.uid());
create policy own on agent_inbox for all to authenticated using (profile_id = app.uid() or (org_id = app.org() and app.role() = 'admin')) with check (profile_id = app.uid());
create policy staff_all on agent_handoffs for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff());
create policy client_read on agent_handoffs for select to authenticated using (org_id = app.org() and client_company_id = app.client_company());
create policy staff_read on org_settings for select to authenticated using (org_id = app.org() and app.is_staff());
create policy admin_write on org_settings for all to authenticated using (org_id = app.org() and app.role() = 'admin') with check (org_id = app.org() and app.role() = 'admin');
create trigger audit_approval_limits after insert or update or delete on approval_limits for each row execute function app.audit();
create trigger audit_org_settings after insert or update or delete on org_settings for each row execute function app.audit();
