-- Day 3: estimating. Quotes keep the extracted scope and take-off they were priced from.
alter table quotes add column scope jsonb, add column takeoff jsonb, add column workflow_run_id uuid references workflow_runs(id) on delete set null,
  add column questions text[] not null default '{}', add column client_decision_note text, add column decided_at timestamptz;
alter table requests add column workflow_run_id uuid references workflow_runs(id) on delete set null;

-- Client accept/reject goes through a server action that checks access, then updates only status fields.
