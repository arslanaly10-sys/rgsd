-- OneSite never uses the anon role (all access is per signed-in user under RLS).
-- Supabase grants anon broad default privileges on public tables; remove them as defence in depth.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
