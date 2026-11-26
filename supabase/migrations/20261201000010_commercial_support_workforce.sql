-- Phase C: progress claims (retention, advance recovery), payments, credit/debit notes, support tickets, project contacts, workforce trades.

alter table signoffs drop constraint signoffs_kind_check;
alter table signoffs add constraint signoffs_kind_check check (kind in ('measurement','hold_point','variation','completion','inspection','document','claim'));

alter table workers drop constraint workers_trade_check;
alter table workers add constraint workers_trade_check check (trade in ('scaffolder','advanced_scaffolder','scaffold_supervisor','scaffold_inspector','rigger','helper','driver','hse_officer','insulator','insulation_foreman','waterproofing_applicator','waterproofing_foreman'));

alter table invoices add column kind text not null default 'rental' check (kind in ('rental','progress','advance','retention_release'));
alter table projects add column advance_paid_on date;

create table payment_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  ref text not null,
  seq int not null,
  period_to date not null,
  gross_cumulative numeric(14,2) not null,   -- certified work + approved variations to date
  previous_gross numeric(14,2) not null,
  this_gross numeric(14,2) not null,
  retention numeric(14,2) not null,
  advance_recovery numeric(14,2) not null,
  net numeric(14,2) not null,
  vat numeric(14,2) not null,
  total numeric(14,2) not null,
  lines jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft','submitted','certified','rejected','invoiced')),
  invoice_id uuid references invoices(id) on delete set null,
  submitted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);
alter table invoices add column payment_claim_id uuid references payment_claims(id) on delete set null;

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  method text not null default 'bank_transfer' check (method in ('bank_transfer','cheque','sadad','other')),
  reference text,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  ref text not null,
  kind text not null default 'credit' check (kind in ('credit','debit')),
  reason text not null,
  lines jsonb not null default '[]',
  subtotal numeric(14,2) not null,
  vat numeric(14,2) not null,
  total numeric(14,2) not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','issued','void')),
  qr_tlv text,
  issued_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  warranty_id uuid references warranties(id) on delete set null,
  ref text not null,
  category text not null check (category in ('portal','defect','billing','safety','general','warranty_claim')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  subject text not null,
  status text not null default 'open' check (status in ('open','in_progress','waiting_client','resolved','closed')),
  raised_by uuid references profiles(id),
  assignee_id uuid references profiles(id),
  respond_by timestamptz not null,
  resolve_by timestamptz not null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  escalated_at timestamptz,
  satisfaction int check (satisfaction between 1 and 5),
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);
create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null,
  internal boolean not null default false,   -- RGS-only notes, never shown to the client
  created_at timestamptz not null default now()
);

create table project_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  side text not null check (side in ('rgs','client','consultant')),
  name text not null,
  role_label text not null,
  role_label_ar text,
  phone text,
  email text,
  hours text,
  sort int not null default 0
);

do $$
declare t text;
begin
  foreach t in array array['payment_claims','payments','credit_notes','tickets','ticket_messages','project_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff())', t);
    execute format('create policy client_read on public.%I for select to authenticated using (org_id = app.org() and client_company_id = app.client_company())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit()', t);
  end loop;
end $$;

-- Clients don't see drafts, nor RGS-internal ticket notes.
drop policy client_read on payment_claims;
create policy client_read on payment_claims for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and status <> 'draft');
drop policy client_read on credit_notes;
create policy client_read on credit_notes for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and status = 'issued');
drop policy client_read on ticket_messages;
create policy client_read on ticket_messages for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and not internal);
-- Clients open tickets and post (non-internal) messages on their own tickets.
create policy client_insert on tickets for insert to authenticated
  with check (org_id = app.org() and client_company_id = app.client_company() and raised_by = app.uid());
create policy client_insert on ticket_messages for insert to authenticated
  with check (org_id = app.org() and client_company_id = app.client_company() and author_id = app.uid() and not internal);

create index tickets_status_idx on tickets (org_id, status, resolve_by);
create index payments_invoice_idx on payments (invoice_id);
