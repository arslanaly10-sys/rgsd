-- Visual project experience: project photo gallery (illustrations now, real site photos as they arrive)
-- and a schematic site-area layout per project.

create table project_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_company_id uuid not null references client_companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  area_id uuid references project_areas(id) on delete set null,
  service_line text,
  stage text check (stage in ('before','during','after')),
  kind text not null check (kind in ('illustration','photo')),
  src text,                                    -- public path for illustrations
  document_id uuid references documents(id) on delete cascade,  -- uploaded photo (served through /api/files with RLS)
  caption text not null,
  caption_ar text,
  taken_on date,
  credit text,                                 -- e.g. "Illustration · not an RGS site photo"
  is_cover boolean not null default false,
  visible_to_client boolean not null default true,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'illustration' and src is not null) or (kind = 'photo' and document_id is not null))
);
create index project_photos_project_idx on project_photos (project_id, created_at desc);
create unique index project_photos_one_cover on project_photos (project_id) where is_cover;

alter table project_photos enable row level security;
create policy staff_all on project_photos for all to authenticated using (org_id = app.org() and app.is_staff()) with check (org_id = app.org() and app.is_staff());
create policy client_read on project_photos for select to authenticated using (org_id = app.org() and client_company_id = app.client_company() and visible_to_client);
grant select, insert, update, delete on project_photos to authenticated, service_role;
revoke all on project_photos from anon;
create trigger audit_project_photos after insert or update or delete on project_photos for each row execute function app.audit();

-- Schematic position of each area on the project's site layout (x, y, w, h in a 0–100 grid; shape rect|tank).
alter table project_areas add column layout jsonb;
