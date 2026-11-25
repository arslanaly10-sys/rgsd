-- Row level security, helper functions and audit trail.
-- The app sets per transaction:  set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<profile id>","role":"authenticated","actor_kind":"user|agent","run_id":"..."}', true);
-- With Supabase Auth the same claims arrive from the JWT, so the policies work unchanged.

create schema if not exists app;

create or replace function app.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function app.claim(name text) returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> name
$$;

create or replace function app.org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = app.uid()
$$;

create or replace function app.role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = app.uid()
$$;

create or replace function app.client_company() returns uuid
language sql stable security definer set search_path = public as $$
  select client_company_id from profiles where id = app.uid()
$$;

create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role not like 'client_%' from profiles where id = app.uid()), false)
$$;

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Enable RLS everywhere.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 1) Staff of the org: full access to every org table.
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join pg_tables p on p.tablename = c.table_name and p.schemaname = 'public'
    where c.table_schema = 'public' and c.column_name = 'org_id'
  loop
    execute format(
      'create policy staff_all on public.%I for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff())', t);
  end loop;
end $$;

create policy staff_all on organizations for all to authenticated
  using (id = app.org() and app.is_staff()) with check (id = app.org() and app.is_staff());

-- 2) Client users: read rows of their own company only.
do $$
declare t text;
begin
  foreach t in array array['sites','jobs','scaffolds','inspections','defects','on_hire','movements','incidents','documents','requests']
  loop
    execute format(
      'create policy client_read on public.%I for select to authenticated using (org_id = app.org() and client_company_id = app.client_company())', t);
  end loop;
end $$;

create policy member_read on organizations for select to authenticated using (id = app.org());
create policy client_read on client_companies for select to authenticated using (id = app.client_company());

-- Clients see staff names (inspector, supervisor) and colleagues, never other clients.
create policy client_read on profiles for select to authenticated
  using (org_id = app.org() and (id = app.uid() or client_company_id = app.client_company() or role not like 'client_%'));
create policy self_update on profiles for update to authenticated
  using (id = app.uid()) with check (id = app.uid() and role = app.role() and client_company_id is not distinct from app.client_company());

-- Quotes and invoices: clients only see issued documents, never drafts.
create policy client_read on quotes for select to authenticated
  using (org_id = app.org() and client_company_id = app.client_company() and status in ('sent','accepted','rejected','expired'));
create policy client_read on quote_lines for select to authenticated
  using (exists (select 1 from quotes q where q.id = quote_id));
create policy client_read on invoices for select to authenticated
  using (org_id = app.org() and client_company_id = app.client_company() and status in ('issued','paid'));
create policy client_read on invoice_lines for select to authenticated
  using (exists (select 1 from invoices i where i.id = invoice_id));

-- Catalog is public to org members (for client self-service quotes).
create policy member_read on items for select to authenticated using (org_id = app.org());

-- Knowledge: clients see non-staff docs that are general or theirs.
create policy client_read on kb_documents for select to authenticated
  using (org_id = app.org() and not staff_only and (client_company_id is null or client_company_id = app.client_company()));
create policy client_read on kb_chunks for select to authenticated
  using (exists (select 1 from kb_documents d where d.id = kb_document_id));

-- Clients may create requests for their own company.
create policy client_insert on requests for insert to authenticated
  with check (org_id = app.org() and client_company_id = app.client_company() and created_by = app.uid());

-- Agent runs: clients see their own conversations.
create policy own_runs on agent_runs for select to authenticated using (user_id = app.uid());
create policy own_runs_insert on agent_runs for insert to authenticated
  with check (user_id = app.uid() and org_id = app.org());
create policy own_steps on agent_steps for select to authenticated
  using (exists (select 1 from agent_runs r where r.id = run_id));

-- Notifications: addressed to the user, their role, or (for clients) their company.
create policy own_notifications on notifications for select to authenticated
  using (org_id = app.org() and (
    user_id = app.uid()
    or (user_id is null and role = app.role())
    or (user_id is null and role is null and client_company_id is not null and client_company_id = app.client_company())));
create policy own_notifications_update on notifications for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());

-- Client confirmations (e.g. accept indicative quote) can be addressed to a client company.
create policy client_read on approval_requests for select to authenticated
  using (org_id = app.org() and client_company_id = app.client_company() and 'client_admin' = any(approver_roles));

-- ───────────────────────── Audit trail ─────────────────────────
create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old); v_org := old.org_id; v_id := old.id;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old); v_after := to_jsonb(new); v_org := new.org_id; v_id := new.id;
    if v_before = v_after then return new; end if;
  else
    v_after := to_jsonb(new); v_org := new.org_id; v_id := new.id;
  end if;
  insert into audit_log (org_id, actor_id, actor_kind, action, entity_type, entity_id, before, after, run_id)
  values (
    v_org, app.uid(),
    coalesce(nullif(app.claim('actor_kind'), ''), case when app.uid() is null then 'system' else 'user' end),
    lower(tg_op), tg_table_name, v_id, v_before, v_after,
    nullif(app.claim('run_id'), '')::uuid);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'requests','quotes','jobs','scaffolds','inspections','defects','movements','on_hire','dispatch_plans',
    'workers','certifications','crew_assignments','invoices','incidents','documents','approval_requests',
    'rate_items','agent_policies','memories','profiles','client_companies','sites','integrations']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit()', t);
  end loop;
end $$;

-- Audit log is append-only for everyone except the owner.
revoke update, delete on audit_log from authenticated;
