-- Pin search_path on the claim helpers (Supabase linter 0011). They only use pg_catalog functions.
alter function app.uid() set search_path = '';
alter function app.claim(text) set search_path = '';
