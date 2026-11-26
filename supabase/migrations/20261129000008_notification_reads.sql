-- Per-person read receipts (notifications can be addressed to a whole role or client company).
create table notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
alter table notification_reads enable row level security;
create policy own_reads on notification_reads for all to authenticated using (user_id = app.uid()) with check (user_id = app.uid());
grant select, insert, delete on notification_reads to authenticated, service_role;
revoke all on notification_reads from anon;
