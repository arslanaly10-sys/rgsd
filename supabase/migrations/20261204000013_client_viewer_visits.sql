-- Read-only client role ("customer viewer") and last-visit tracking for "what changed since your last visit".
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'admin','ops_manager','estimator','site_supervisor','inspector','yard_logistics','hse_training','finance',
  'client_admin','client_user','client_consultant','client_hse','client_finance','client_viewer'));
alter table profiles add column last_visit_at timestamptz;
alter table profiles add column prev_visit_at timestamptz;
