-- ============================================================
-- Autonomous Prime — Phase 1 catch-up migration
-- Use this when an older Supabase project already has core tables
-- but is missing Phase 1 SaaS columns, constraints, and tables.
-- Safe to rerun.
-- ============================================================

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

alter table if exists orgs
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists orgs_updated_at on orgs;
create trigger orgs_updated_at before update on orgs
for each row execute function set_updated_at();

alter table if exists org_members add column if not exists clerk_user_id text;
alter table if exists org_members add column if not exists role text not null default 'editor';
alter table if exists org_members add column if not exists invite_status text not null default 'accepted';
alter table if exists org_members add column if not exists invited_by text;
alter table if exists org_members add column if not exists joined_at timestamptz;
alter table if exists org_members add column if not exists updated_at timestamptz not null default now();
alter table if exists org_members drop constraint if exists org_members_role_check;
alter table if exists org_members add constraint org_members_role_check
  check (role in ('owner', 'admin', 'editor', 'reviewer'));
alter table if exists org_members drop constraint if exists org_members_invite_status_check;
alter table if exists org_members add constraint org_members_invite_status_check
  check (invite_status in ('pending', 'accepted', 'revoked'));
create index if not exists org_members_clerk_idx on org_members(clerk_user_id);
create index if not exists org_members_org_idx on org_members(org_id);
drop trigger if exists org_members_updated_at on org_members;
create trigger org_members_updated_at before update on org_members
for each row execute function set_updated_at();

alter table if exists brands add column if not exists slug text;
alter table if exists brands add column if not exists status text not null default 'active';
alter table if exists brands add column if not exists voice_style text;
alter table if exists brands add column if not exists default_timezone text default 'America/New_York';
alter table if exists brands add column if not exists default_locale text default 'en-US';
alter table if exists brands add column if not exists updated_at timestamptz not null default now();
alter table if exists brands drop constraint if exists brands_status_check;
alter table if exists brands add constraint brands_status_check
  check (status in ('active', 'archived'));
create index if not exists brands_org_idx on brands(org_id);
drop trigger if exists brands_updated_at on brands;
create trigger brands_updated_at before update on brands
for each row execute function set_updated_at();

alter table if exists jobs add column if not exists job_type text not null default 'content_pipeline';
alter table if exists jobs add column if not exists input_payload jsonb not null default '{}'::jsonb;
alter table if exists jobs add column if not exists latest_run_id uuid;
alter table if exists jobs add column if not exists current_revision_number int not null default 1;
alter table if exists jobs add column if not exists error_msg text;
alter table if exists jobs add column if not exists updated_at timestamptz not null default now();
alter table if exists jobs drop constraint if exists jobs_status_check;
alter table if exists jobs add constraint jobs_status_check
  check (status in (
    'queued','running','completed','failed','retrying','canceled',
    'awaiting_review','revision_requested','approved','rejected'
  ));
create index if not exists jobs_org_idx on jobs(org_id);
create index if not exists jobs_status_idx on jobs(status);
create index if not exists jobs_brand_idx on jobs(brand_id);
drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at before update on jobs
for each row execute function set_updated_at();

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  run_number int not null default 1,
  triggered_by text,
  trigger_type text not null default 'initial',
  status text not null default 'queued',
  python_pipeline_id text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  retry_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists job_runs add column if not exists run_number int not null default 1;
alter table if exists job_runs add column if not exists triggered_by text;
alter table if exists job_runs add column if not exists trigger_type text not null default 'initial';
alter table if exists job_runs add column if not exists status text not null default 'queued';
alter table if exists job_runs add column if not exists python_pipeline_id text;
alter table if exists job_runs add column if not exists started_at timestamptz;
alter table if exists job_runs add column if not exists completed_at timestamptz;
alter table if exists job_runs add column if not exists error_code text;
alter table if exists job_runs add column if not exists error_message text;
alter table if exists job_runs add column if not exists retry_count int not null default 0;
alter table if exists job_runs add column if not exists updated_at timestamptz not null default now();
alter table if exists job_runs drop constraint if exists job_runs_trigger_type_check;
alter table if exists job_runs add constraint job_runs_trigger_type_check
  check (trigger_type in ('initial','manual_retry','auto_retry','revision'));
alter table if exists job_runs drop constraint if exists job_runs_status_check;
alter table if exists job_runs add constraint job_runs_status_check
  check (status in ('queued','running','completed','failed','retrying','canceled'));
create index if not exists job_runs_job_idx on job_runs(job_id);
create index if not exists job_runs_org_idx on job_runs(org_id);
create index if not exists job_runs_status_idx on job_runs(status);
drop trigger if exists job_runs_updated_at on job_runs;
create trigger job_runs_updated_at before update on job_runs
for each row execute function set_updated_at();

create table if not exists job_steps (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid not null references job_runs(id) on delete cascade,
  step_key text not null,
  provider text,
  status text not null default 'queued',
  attempt_count int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_run_id, step_key)
);

alter table if exists job_steps add column if not exists provider text;
alter table if exists job_steps add column if not exists status text not null default 'queued';
alter table if exists job_steps add column if not exists attempt_count int not null default 0;
alter table if exists job_steps add column if not exists started_at timestamptz;
alter table if exists job_steps add column if not exists completed_at timestamptz;
alter table if exists job_steps add column if not exists input_payload jsonb not null default '{}'::jsonb;
alter table if exists job_steps add column if not exists output_payload jsonb not null default '{}'::jsonb;
alter table if exists job_steps add column if not exists error_message text;
alter table if exists job_steps add column if not exists updated_at timestamptz not null default now();
alter table if exists job_steps drop constraint if exists job_steps_status_check;
alter table if exists job_steps add constraint job_steps_status_check
  check (status in ('queued','running','completed','failed','skipped','canceled'));
create index if not exists job_steps_run_idx on job_steps(job_run_id);
drop trigger if exists job_steps_updated_at on job_steps;
create trigger job_steps_updated_at before update on job_steps
for each row execute function set_updated_at();

create table if not exists job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  job_run_id uuid references job_runs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  actor_type text not null default 'system',
  actor_id text,
  created_at timestamptz not null default now()
);

create index if not exists job_events_job_idx on job_events(job_id);
create index if not exists job_events_run_idx on job_events(job_run_id);

alter table if exists assets add column if not exists job_run_id uuid references job_runs(id) on delete cascade;
alter table if exists assets add column if not exists brand_id uuid references brands(id) on delete set null;
alter table if exists assets add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists review_threads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  current_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);

alter table if exists review_threads add column if not exists brand_id uuid references brands(id) on delete set null;
alter table if exists review_threads add column if not exists current_status text not null default 'pending';
alter table if exists review_threads add column if not exists updated_at timestamptz not null default now();
alter table if exists review_threads drop constraint if exists review_threads_current_status_check;
alter table if exists review_threads add constraint review_threads_current_status_check
  check (current_status in ('pending','approved','rejected','revision_requested'));
create index if not exists review_threads_job_idx on review_threads(job_id);
drop trigger if exists review_threads_updated_at on review_threads;
create trigger review_threads_updated_at before update on review_threads
for each row execute function set_updated_at();

create table if not exists review_actions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references review_threads(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  revision_number int not null default 1,
  action text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

alter table if exists review_actions add column if not exists revision_number int not null default 1;
alter table if exists review_actions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists review_actions add column if not exists created_by text;
alter table if exists review_actions drop constraint if exists review_actions_action_check;
alter table if exists review_actions add constraint review_actions_action_check
  check (action in ('approve','reject','request_revision','comment'));
create index if not exists review_actions_thread_idx on review_actions(thread_id);
create index if not exists review_actions_job_idx on review_actions(job_id);

create table if not exists review_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references review_threads(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  job_run_id uuid references job_runs(id) on delete set null,
  parent_comment_id uuid references review_comments(id) on delete cascade,
  body text not null,
  anchor_type text,
  anchor_ref text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table if exists review_comments add column if not exists job_run_id uuid references job_runs(id) on delete set null;
alter table if exists review_comments add column if not exists parent_comment_id uuid references review_comments(id) on delete cascade;
alter table if exists review_comments add column if not exists anchor_type text;
alter table if exists review_comments add column if not exists anchor_ref text;
alter table if exists review_comments add column if not exists created_by text;
create index if not exists review_comments_thread_idx on review_comments(thread_id);
create index if not exists review_comments_job_idx on review_comments(job_id);

create table if not exists provider_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  provider_key text not null,
  display_name text not null,
  category text not null default 'other',
  status text not null default 'disconnected',
  config jsonb not null default '{}'::jsonb,
  secret_ref text,
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, brand_id, provider_key)
);

alter table if exists provider_connections add column if not exists brand_id uuid references brands(id) on delete cascade;
alter table if exists provider_connections add column if not exists provider_key text;
alter table if exists provider_connections add column if not exists display_name text;
alter table if exists provider_connections add column if not exists category text not null default 'other';
alter table if exists provider_connections add column if not exists status text not null default 'disconnected';
alter table if exists provider_connections add column if not exists config jsonb not null default '{}'::jsonb;
alter table if exists provider_connections add column if not exists secret_ref text;
alter table if exists provider_connections add column if not exists last_tested_at timestamptz;
alter table if exists provider_connections add column if not exists last_success_at timestamptz;
alter table if exists provider_connections add column if not exists last_error_at timestamptz;
alter table if exists provider_connections add column if not exists last_error_message text;
alter table if exists provider_connections add column if not exists created_by text;
alter table if exists provider_connections add column if not exists updated_at timestamptz not null default now();
alter table if exists provider_connections drop constraint if exists provider_connections_category_check;
alter table if exists provider_connections add constraint provider_connections_category_check
  check (category in ('cms','llm','voice','commerce','automation','other'));
alter table if exists provider_connections drop constraint if exists provider_connections_status_check;
alter table if exists provider_connections add constraint provider_connections_status_check
  check (status in ('connected','degraded','disconnected','error'));
create index if not exists provider_connections_org_idx on provider_connections(org_id);
create index if not exists provider_connections_brand_idx on provider_connections(brand_id);
drop trigger if exists provider_connections_updated_at on provider_connections;
create trigger provider_connections_updated_at before update on provider_connections
for each row execute function set_updated_at();

create table if not exists provider_health_checks (
  id uuid primary key default gen_random_uuid(),
  provider_connection_id uuid not null references provider_connections(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  status text not null,
  latency_ms int,
  response_code int,
  message text,
  details jsonb not null default '{}'::jsonb,
  checked_by text,
  checked_at timestamptz not null default now()
);

create index if not exists provider_health_checks_connection_idx on provider_health_checks(provider_connection_id);
create index if not exists provider_health_checks_org_idx on provider_health_checks(org_id);

create table if not exists workspace_onboarding (
  workspace_id uuid primary key references orgs(id) on delete cascade,
  current_step text not null default 'workspace',
  completed_steps text[] not null default '{}'::text[],
  is_complete boolean not null default false,
  first_brand_id uuid references brands(id) on delete set null,
  first_job_id uuid references jobs(id) on delete set null,
  first_scheduled_entry_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists workspace_onboarding add column if not exists current_step text not null default 'workspace';
alter table if exists workspace_onboarding add column if not exists completed_steps text[] not null default '{}'::text[];
alter table if exists workspace_onboarding add column if not exists is_complete boolean not null default false;
alter table if exists workspace_onboarding add column if not exists first_brand_id uuid references brands(id) on delete set null;
alter table if exists workspace_onboarding add column if not exists first_job_id uuid references jobs(id) on delete set null;
alter table if exists workspace_onboarding add column if not exists first_scheduled_entry_id text;
alter table if exists workspace_onboarding add column if not exists updated_at timestamptz not null default now();
drop trigger if exists workspace_onboarding_updated_at on workspace_onboarding;
create trigger workspace_onboarding_updated_at before update on workspace_onboarding
for each row execute function set_updated_at();

alter table if exists subscriptions
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists subscriptions_updated_at on subscriptions;
create trigger subscriptions_updated_at before update on subscriptions
for each row execute function set_updated_at();

-- Optional local-debug shortcut. Keep commented in normal use.
-- alter table if exists orgs disable row level security;
-- alter table if exists org_members disable row level security;
-- alter table if exists brands disable row level security;
-- alter table if exists jobs disable row level security;
-- alter table if exists job_runs disable row level security;
-- alter table if exists job_steps disable row level security;
-- alter table if exists job_events disable row level security;
-- alter table if exists review_threads disable row level security;
-- alter table if exists review_actions disable row level security;
-- alter table if exists review_comments disable row level security;
-- alter table if exists provider_connections disable row level security;
-- alter table if exists provider_health_checks disable row level security;
-- alter table if exists workspace_onboarding disable row level security;
-- alter table if exists assets disable row level security;
-- alter table if exists subscriptions disable row level security;
