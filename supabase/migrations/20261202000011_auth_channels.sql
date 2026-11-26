-- Phase D: real sign-in (email one-time codes, authenticator-app MFA, invitations), outbound channels
-- (email / WhatsApp / SMS) with per-person preferences, and a sign-in audit trail.
-- These tables are written by the server only (service role); RLS lets admins read them.

alter table profiles add column status text not null default 'active' check (status in ('active','invited','disabled'));
alter table profiles add column mfa_enabled boolean not null default false;
alter table profiles add column session_version int not null default 0;  -- bump to sign out everywhere
alter table profiles add column notify jsonb not null default '{"email": true, "whatsapp": false, "sms": false}';
alter table profiles add column last_login_at timestamptz;

alter table notifications add column dispatched_at timestamptz;
create index notifications_dispatch_idx on notifications (created_at) where dispatched_at is null;

-- TOTP secrets live apart from profiles so no user-facing query can ever select them.
create table auth_factors (
  profile_id uuid primary key references profiles(id) on delete cascade,
  totp_secret text not null,        -- base32; wrap with KMS in the KSA deployment
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_otps_email_idx on auth_otps (lower(email), created_at desc);

create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid references client_companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  email text not null,
  role text not null,
  token_hash text not null unique,
  invited_by uuid references profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  notification_id uuid references notifications(id) on delete set null,
  channel text not null check (channel in ('email','whatsapp','sms')),
  to_addr text not null,
  subject text,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','logged')),
  provider text,
  provider_id text,
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_status_idx on outbound_messages (status, created_at);

create table login_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  email text,
  event text not null,   -- otp_sent, otp_failed, signed_in, mfa_failed, mfa_enabled, invite_sent, invite_accepted, signed_out_everywhere, demo_sign_in
  detail text,
  ip text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['auth_factors','auth_otps','invites','outbound_messages','login_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- auth_factors, auth_otps: no policy at all → never readable by users.
create policy admin_read on invites for select to authenticated using (org_id = app.org() and (app.role() = 'admin' or (app.role() = 'client_admin' and client_company_id = app.client_company())));
create policy admin_read on outbound_messages for select to authenticated using (org_id = app.org() and (app.role() = 'admin' or profile_id = app.uid()));
create policy admin_read on login_events for select to authenticated using (org_id = app.org() and (app.role() = 'admin' or profile_id = app.uid()));
