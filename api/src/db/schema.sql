-- ============================================================
-- Autonomous Prime — Supabase Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- ORGANIZATIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists orgs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text,
  plan_tier             text not null default 'starter'
                          check (plan_tier in ('starter', 'pro', 'agency')),
  stripe_customer_id    text unique,
  subscription_status   text default 'inactive',
  jobs_used_this_month  int  not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists orgs_updated_at on orgs;
create trigger orgs_updated_at before update on orgs
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- ORG MEMBERS
-- ─────────────────────────────────────────────────────────────
create table if not exists org_members (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  clerk_user_id   text,           -- null until user accepts invite
  email           text not null,
  role            text not null default 'editor'
                    check (role in ('owner', 'admin', 'editor', 'reviewer', 'client')),
  invite_status   text not null default 'accepted'
                    check (invite_status in ('pending', 'accepted', 'revoked')),
  invited_by      text,
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, email)
);

alter table org_members add column if not exists clerk_user_id text;
alter table org_members add column if not exists role text not null default 'editor';
alter table org_members add column if not exists invite_status text not null default 'accepted';
alter table org_members add column if not exists invited_by text;
alter table org_members add column if not exists joined_at timestamptz;
alter table org_members add column if not exists updated_at timestamptz not null default now();
alter table org_members drop constraint if exists org_members_role_check;
alter table org_members add constraint org_members_role_check
  check (role in ('owner', 'admin', 'editor', 'reviewer', 'client'));
alter table org_members drop constraint if exists org_members_invite_status_check;
alter table org_members add constraint org_members_invite_status_check
  check (invite_status in ('pending', 'accepted', 'revoked'));

create index if not exists org_members_clerk_idx on org_members(clerk_user_id);
create index if not exists org_members_org_idx   on org_members(org_id);
drop trigger if exists org_members_updated_at on org_members;
create trigger org_members_updated_at before update on org_members
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- BRANDS
-- ─────────────────────────────────────────────────────────────
create table if not exists brands (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  name            text not null,
  slug            text,
  status          text not null default 'active'
                    check (status in ('active', 'archived')),
  niche           text,
  tone            text default 'professional'
                    check (tone in ('professional', 'casual', 'authoritative', 'conversational')),
  voice_style     text,
  target_keywords text[],
  cta_default_url text,
  default_timezone text default 'America/New_York',
  default_locale   text default 'en-US',
  wp_url           text,
  wp_user          text,
  wp_app_password  text,           -- store encrypted in production
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, slug)
);

alter table brands add column if not exists slug text;
alter table brands add column if not exists status text not null default 'active';
alter table brands add column if not exists default_timezone text default 'America/New_York';
alter table brands add column if not exists default_locale text default 'en-US';
alter table brands add column if not exists updated_at timestamptz not null default now();
alter table brands add column if not exists voice_style text;
alter table brands drop constraint if exists brands_status_check;
alter table brands add constraint brands_status_check
  check (status in ('active', 'archived'));

create index if not exists brands_org_idx on brands(org_id);
drop trigger if exists brands_updated_at on brands;
create trigger brands_updated_at before update on brands
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- JOBS (content jobs)
-- ─────────────────────────────────────────────────────────────
create table if not exists jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  brand_id        uuid references brands(id) on delete set null,
  submitted_by    text,           -- clerk_user_id
  job_type        text not null default 'content_pipeline',
  topic           text not null,
  keywords        text[],
  input_payload   jsonb not null default '{}'::jsonb,
  aspect_ratio    text default '16:9',
  status          text not null default 'queued'
                    check (status in ('queued','running','completed','failed','retrying','canceled','awaiting_review','revision_requested','approved','rejected')),
  latest_run_id   uuid,
  current_revision_number int not null default 1,
  pipeline_id     text,           -- legacy Python pipeline ID
  retry_count     int  default 0,
  error_msg       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table jobs add column if not exists job_type text not null default 'content_pipeline';
alter table jobs add column if not exists input_payload jsonb not null default '{}'::jsonb;
alter table jobs add column if not exists latest_run_id uuid;
alter table jobs add column if not exists current_revision_number int not null default 1;
alter table jobs add column if not exists error_msg text;
alter table jobs add column if not exists owner_user_id text;
alter table jobs add column if not exists review_assignee_user_id text;
alter table jobs add column if not exists publish_assignee_user_id text;
alter table jobs add column if not exists waiting_on text;
alter table jobs add column if not exists review_due_at timestamptz;
alter table jobs add column if not exists publish_due_at timestamptz;
alter table jobs add column if not exists revision_due_at timestamptz;
alter table jobs add column if not exists sla_state text not null default 'on_track';
alter table jobs add column if not exists archived_at timestamptz;
alter table jobs add column if not exists published_at timestamptz;
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('queued','running','completed','failed','retrying','canceled','awaiting_review','revision_requested','approved','rejected'));
alter table jobs drop constraint if exists jobs_sla_state_check;
alter table jobs add constraint jobs_sla_state_check
  check (sla_state in ('on_track', 'at_risk', 'overdue', 'blocked'));

drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

create index if not exists jobs_org_idx    on jobs(org_id);
create index if not exists jobs_status_idx on jobs(status);
create index if not exists jobs_brand_idx  on jobs(brand_id);

-- Atomic job + initial run creation (used by /saas/jobs)
create or replace function create_job_with_run(
  p_org_id uuid,
  p_brand_id uuid,
  p_topic text,
  p_keywords text[],
  p_aspect_ratio text,
  p_input_payload jsonb,
  p_submitted_by text,
  p_owner_user_id text
) returns json as $$
declare
  v_job jobs%rowtype;
  v_run job_runs%rowtype;
begin
  insert into jobs (
    org_id,
    brand_id,
    submitted_by,
    owner_user_id,
    waiting_on,
    topic,
    keywords,
    input_payload,
    aspect_ratio,
    status,
    job_type,
    current_revision_number
  )
  values (
    p_org_id,
    p_brand_id,
    p_submitted_by,
    p_owner_user_id,
    'content_generation',
    p_topic,
    p_keywords,
    coalesce(p_input_payload, '{}'::jsonb),
    coalesce(nullif(p_aspect_ratio, ''), '16:9'),
    'queued',
    'content_pipeline',
    1
  )
  returning * into v_job;

  insert into job_runs (
    job_id,
    org_id,
    brand_id,
    run_number,
    triggered_by,
    trigger_type,
    status
  )
  values (
    v_job.id,
    p_org_id,
    p_brand_id,
    1,
    p_owner_user_id,
    'initial',
    'queued'
  )
  returning * into v_run;

  update jobs set latest_run_id = v_run.id where id = v_job.id;

  return json_build_object('job', row_to_json(v_job), 'run', row_to_json(v_run));
end;
$$ language plpgsql;

create table if not exists job_runs (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete set null,
  run_number        int not null default 1,
  triggered_by      text,
  trigger_type      text not null default 'initial'
                      check (trigger_type in ('initial','manual_retry','auto_retry','revision')),
  status            text not null default 'queued'
                      check (status in ('queued','running','completed','failed','retrying','canceled')),
  python_pipeline_id text,
  started_at        timestamptz,
  completed_at      timestamptz,
  error_code        text,
  error_message     text,
  retry_count       int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table job_runs add column if not exists run_number int not null default 1;
alter table job_runs add column if not exists triggered_by text;
alter table job_runs add column if not exists trigger_type text not null default 'initial';
alter table job_runs add column if not exists python_pipeline_id text;
alter table job_runs add column if not exists started_at timestamptz;
alter table job_runs add column if not exists completed_at timestamptz;
alter table job_runs add column if not exists error_code text;
alter table job_runs add column if not exists error_message text;
alter table job_runs add column if not exists retry_count int not null default 0;
alter table job_runs add column if not exists updated_at timestamptz not null default now();
alter table job_runs drop constraint if exists job_runs_trigger_type_check;
alter table job_runs add constraint job_runs_trigger_type_check
  check (trigger_type in ('initial','manual_retry','auto_retry','revision'));
alter table job_runs drop constraint if exists job_runs_status_check;
alter table job_runs add constraint job_runs_status_check
  check (status in ('queued','running','completed','failed','retrying','canceled'));

create index if not exists job_runs_job_idx on job_runs(job_id);
create index if not exists job_runs_org_idx on job_runs(org_id);
create index if not exists job_runs_status_idx on job_runs(status);
drop trigger if exists job_runs_updated_at on job_runs;
create trigger job_runs_updated_at before update on job_runs
  for each row execute function set_updated_at();

create table if not exists job_steps (
  id              uuid primary key default gen_random_uuid(),
  job_run_id      uuid not null references job_runs(id) on delete cascade,
  step_key        text not null,
  provider        text,
  status          text not null default 'queued'
                    check (status in ('queued','running','completed','failed','skipped','canceled')),
  attempt_count   int not null default 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  input_payload   jsonb not null default '{}'::jsonb,
  output_payload  jsonb not null default '{}'::jsonb,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_run_id, step_key)
);

alter table job_steps add column if not exists provider text;
alter table job_steps add column if not exists attempt_count int not null default 0;
alter table job_steps add column if not exists started_at timestamptz;
alter table job_steps add column if not exists completed_at timestamptz;
alter table job_steps add column if not exists input_payload jsonb not null default '{}'::jsonb;
alter table job_steps add column if not exists output_payload jsonb not null default '{}'::jsonb;
alter table job_steps add column if not exists error_message text;
alter table job_steps add column if not exists updated_at timestamptz not null default now();
alter table job_steps drop constraint if exists job_steps_status_check;
alter table job_steps add constraint job_steps_status_check
  check (status in ('queued','running','completed','failed','skipped','canceled'));

create index if not exists job_steps_run_idx on job_steps(job_run_id);
drop trigger if exists job_steps_updated_at on job_steps;
create trigger job_steps_updated_at before update on job_steps
  for each row execute function set_updated_at();

create table if not exists job_events (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  job_run_id      uuid references job_runs(id) on delete cascade,
  org_id          uuid not null references orgs(id) on delete cascade,
  brand_id        uuid references brands(id) on delete set null,
  event_type      text not null,
  from_status     text,
  to_status       text,
  message         text,
  metadata        jsonb not null default '{}'::jsonb,
  actor_type      text not null default 'system'
                    check (actor_type in ('user','system','worker')),
  actor_id        text,
  created_at      timestamptz not null default now()
);

create index if not exists job_events_job_idx on job_events(job_id);
create index if not exists job_events_run_idx on job_events(job_run_id);

-- ─────────────────────────────────────────────────────────────
-- ASSETS (images, audio, video per job)
-- ─────────────────────────────────────────────────────────────
create table if not exists assets (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  job_run_id   uuid references job_runs(id) on delete cascade,
  org_id       uuid not null references orgs(id) on delete cascade,
  brand_id     uuid references brands(id) on delete set null,
  type         text not null check (type in ('image','audio','video')),
  provider     text,             -- replicate, elevenlabs, ffmpeg, etc.
  storage_url  text,
  local_path   text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table assets add column if not exists job_run_id uuid references job_runs(id) on delete cascade;
alter table assets add column if not exists brand_id uuid references brands(id) on delete set null;
alter table assets add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists assets_job_idx on assets(job_id);
create index if not exists assets_org_brand_type_idx on assets(org_id, brand_id, type, created_at desc);

alter table assets add column if not exists name text;
alter table assets add column if not exists title text;
alter table assets add column if not exists description text;
alter table assets add column if not exists mime_type text;
alter table assets add column if not exists file_ext text;
alter table assets add column if not exists byte_size bigint;
alter table assets add column if not exists duration_seconds numeric;
alter table assets add column if not exists width int;
alter table assets add column if not exists height int;
alter table assets add column if not exists checksum text;
alter table assets add column if not exists storage_key text;
alter table assets add column if not exists source_type text default 'generated';
alter table assets add column if not exists usage_status text default 'active';
alter table assets add column if not exists created_by text;

create table if not exists asset_links (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  brand_id        uuid references brands(id) on delete set null,
  asset_id        uuid not null references assets(id) on delete cascade,
  entity_type     text not null,
  entity_id       text not null,
  role            text not null default 'primary',
  created_by      text,
  created_at      timestamptz not null default now(),
  unique (asset_id, entity_type, entity_id, role)
);

create index if not exists asset_links_asset_idx on asset_links(asset_id);
create index if not exists asset_links_entity_idx on asset_links(entity_type, entity_id);

create table if not exists activity_log (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  brand_id        uuid references brands(id) on delete set null,
  entity_type     text not null,
  entity_id       text not null,
  action          text not null,
  actor_type      text not null default 'system'
                    check (actor_type in ('user','system','worker')),
  actor_id        text,
  actor_email     text,
  summary         text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists activity_log_org_idx on activity_log(org_id, created_at desc);
create index if not exists activity_log_entity_idx on activity_log(entity_type, entity_id);

create table if not exists job_validations (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  job_run_id      uuid references job_runs(id) on delete cascade,
  org_id          uuid not null references orgs(id) on delete cascade,
  brand_id        uuid references brands(id) on delete set null,
  rule_key        text not null,
  severity        text not null default 'error'
                    check (severity in ('error', 'warning', 'info')),
  status          text not null default 'fail'
                    check (status in ('pass', 'fail', 'skipped')),
  message         text,
  field_ref       text,
  metadata        jsonb not null default '{}'::jsonb,
  computed_at     timestamptz not null default now(),
  unique (job_id, rule_key)
);

create index if not exists job_validations_job_idx on job_validations(job_id);

create table if not exists provider_credentials (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete set null,
  provider_key      text not null,
  scope             text not null default 'workspace'
                      check (scope in ('workspace', 'brand')),
  display_name      text not null,
  category          text not null default 'other',
  status            text not null default 'configured'
                      check (status in ('configured', 'incomplete', 'invalid', 'disabled')),
  config            jsonb not null default '{}'::jsonb,
  secret_refs       jsonb not null default '{}'::jsonb,
  last_tested_at    timestamptz,
  last_test_status  text default 'unknown'
                      check (last_test_status in ('unknown', 'connected', 'degraded', 'failed')),
  last_test_message text,
  created_by        text,
  updated_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table provider_credentials add column if not exists category text not null default 'other';
create index if not exists provider_credentials_org_idx on provider_credentials(org_id, provider_key);
drop trigger if exists provider_credentials_updated_at on provider_credentials;
create trigger provider_credentials_updated_at before update on provider_credentials
  for each row execute function set_updated_at();

create table if not exists queue_snapshots (
  job_id              uuid primary key references jobs(id) on delete cascade,
  org_id              uuid not null references orgs(id) on delete cascade,
  brand_id            uuid references brands(id) on delete set null,
  queue_state         text not null,
  blocked_reasons     jsonb not null default '[]'::jsonb,
  next_action         text,
  ready_for_publish   boolean not null default false,
  latest_run_status   text,
  review_status       text,
  validation_summary  jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);

create index if not exists queue_snapshots_org_idx on queue_snapshots(org_id, queue_state);
drop trigger if exists queue_snapshots_updated_at on queue_snapshots;
create trigger queue_snapshots_updated_at before update on queue_snapshots
  for each row execute function set_updated_at();

create table if not exists publish_targets (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete set null,
  platform          text not null,
  content_type      text not null,
  offer_id          text,
  offer_name        text,
  cta_id            text,
  cta_url           text,
  cta_label         text,
  landing_page_id   text,
  landing_page_url  text,
  meta_title        text,
  meta_description  text,
  expected_revenue_cents int,
  monetization_path jsonb not null default '{}'::jsonb,
  schedule_state    text not null default 'unscheduled'
                      check (schedule_state in ('unscheduled', 'scheduled', 'published', 'canceled')),
  scheduled_at      timestamptz,
  published_at      timestamptz,
  status            text not null default 'draft'
                      check (status in ('draft', 'ready', 'blocked', 'published', 'failed')),
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists publish_targets_job_idx on publish_targets(job_id);
create index if not exists publish_targets_org_platform_idx on publish_targets(org_id, platform, schedule_state);
drop trigger if exists publish_targets_updated_at on publish_targets;
create trigger publish_targets_updated_at before update on publish_targets
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- APPROVALS
-- ─────────────────────────────────────────────────────────────
create table if not exists approvals (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  org_id          uuid not null references orgs(id) on delete cascade,
  reviewer_id     text,           -- clerk_user_id
  action          text not null check (action in ('approved','rejected','edited')),
  note            text,
  edited_content  text,
  created_at      timestamptz not null default now()
);

create index if not exists approvals_job_idx on approvals(job_id);
create index if not exists approvals_org_idx on approvals(org_id);

create table if not exists review_threads (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  org_id          uuid not null references orgs(id) on delete cascade,
  brand_id        uuid references brands(id) on delete set null,
  current_status  text not null default 'pending'
                    check (current_status in ('pending','approved','rejected','revision_requested')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_id)
);

alter table review_threads add column if not exists current_status text not null default 'pending';
alter table review_threads add column if not exists updated_at timestamptz not null default now();
alter table review_threads add column if not exists assignee_user_id text;
alter table review_threads add column if not exists due_at timestamptz;
alter table review_threads add column if not exists waiting_on text;
alter table review_threads drop constraint if exists review_threads_current_status_check;
alter table review_threads add constraint review_threads_current_status_check
  check (current_status in ('pending','approved','rejected','revision_requested'));

create index if not exists review_threads_job_idx on review_threads(job_id);
drop trigger if exists review_threads_updated_at on review_threads;
create trigger review_threads_updated_at before update on review_threads
  for each row execute function set_updated_at();

create table if not exists review_actions (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references review_threads(id) on delete cascade,
  job_id           uuid not null references jobs(id) on delete cascade,
  revision_number  int not null default 1,
  action           text not null check (action in ('approve','reject','request_revision','comment')),
  note             text,
  metadata         jsonb not null default '{}'::jsonb,
  created_by       text,
  created_at       timestamptz not null default now()
);

alter table review_actions add column if not exists revision_number int not null default 1;
alter table review_actions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table review_actions add column if not exists created_by text;
alter table review_actions drop constraint if exists review_actions_action_check;
alter table review_actions add constraint review_actions_action_check
  check (action in ('approve','reject','request_revision','comment'));

create index if not exists review_actions_thread_idx on review_actions(thread_id);
create index if not exists review_actions_job_idx on review_actions(job_id);

create table if not exists review_comments (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references review_threads(id) on delete cascade,
  job_id            uuid not null references jobs(id) on delete cascade,
  job_run_id        uuid references job_runs(id) on delete set null,
  parent_comment_id uuid references review_comments(id) on delete cascade,
  body              text not null,
  anchor_type       text,
  anchor_ref        text,
  created_by        text,
  created_at        timestamptz not null default now()
);

alter table review_comments add column if not exists job_run_id uuid references job_runs(id) on delete set null;
alter table review_comments add column if not exists parent_comment_id uuid references review_comments(id) on delete cascade;
alter table review_comments add column if not exists anchor_type text;
alter table review_comments add column if not exists anchor_ref text;
alter table review_comments add column if not exists created_by text;

create index if not exists review_comments_thread_idx on review_comments(thread_id);
create index if not exists review_comments_job_idx on review_comments(job_id);

create table if not exists provider_connections (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete cascade,
  provider_key      text not null,
  display_name      text not null,
  category          text not null default 'other'
                      check (category in ('cms','llm','voice','commerce','automation','other')),
  status            text not null default 'disconnected'
                      check (status in ('connected','degraded','disconnected','error')),
  config            jsonb not null default '{}'::jsonb,
  secret_ref        text,
  last_tested_at    timestamptz,
  last_success_at   timestamptz,
  last_error_at     timestamptz,
  last_error_message text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, brand_id, provider_key)
);

alter table provider_connections add column if not exists provider_key text;
alter table provider_connections add column if not exists display_name text;
alter table provider_connections add column if not exists category text not null default 'other';
alter table provider_connections add column if not exists status text not null default 'disconnected';
alter table provider_connections add column if not exists config jsonb not null default '{}'::jsonb;
alter table provider_connections add column if not exists secret_ref text;
alter table provider_connections add column if not exists last_tested_at timestamptz;
alter table provider_connections add column if not exists last_success_at timestamptz;
alter table provider_connections add column if not exists last_error_at timestamptz;
alter table provider_connections add column if not exists last_error_message text;
alter table provider_connections add column if not exists created_by text;
alter table provider_connections add column if not exists updated_at timestamptz not null default now();
alter table provider_connections drop constraint if exists provider_connections_category_check;
alter table provider_connections add constraint provider_connections_category_check
  check (category in ('cms','llm','voice','commerce','automation','other'));
alter table provider_connections drop constraint if exists provider_connections_status_check;
alter table provider_connections add constraint provider_connections_status_check
  check (status in ('connected','degraded','disconnected','error'));

create index if not exists provider_connections_org_idx on provider_connections(org_id);
create index if not exists provider_connections_brand_idx on provider_connections(brand_id);
drop trigger if exists provider_connections_updated_at on provider_connections;
create trigger provider_connections_updated_at before update on provider_connections
  for each row execute function set_updated_at();

create table if not exists provider_health_checks (
  id                     uuid primary key default gen_random_uuid(),
  provider_connection_id uuid not null references provider_connections(id) on delete cascade,
  org_id                 uuid not null references orgs(id) on delete cascade,
  brand_id               uuid references brands(id) on delete set null,
  status                 text not null check (status in ('healthy','degraded','failed')),
  latency_ms             int,
  response_code          int,
  message                text,
  details                jsonb not null default '{}'::jsonb,
  checked_by             text,
  checked_at             timestamptz not null default now()
);

create index if not exists provider_health_checks_connection_idx on provider_health_checks(provider_connection_id);

alter table provider_credentials add column if not exists access_level text not null default 'workspace';
alter table provider_credentials add column if not exists admin_only boolean not null default false;
alter table provider_credentials add column if not exists last_rotated_at timestamptz;
alter table provider_credentials add column if not exists last_used_at timestamptz;
alter table provider_credentials add column if not exists set_by text;
alter table provider_credentials drop constraint if exists provider_credentials_access_level_check;
alter table provider_credentials add constraint provider_credentials_access_level_check
  check (access_level in ('workspace', 'admin_only'));

alter table publish_targets add column if not exists assignee_user_id text;
alter table publish_targets add column if not exists waiting_on text;
alter table publish_targets add column if not exists offer_id text;
alter table publish_targets add column if not exists offer_name text;
alter table publish_targets add column if not exists cta_id text;
alter table publish_targets add column if not exists provider_response_id text;
alter table publish_targets add column if not exists provider_post_url text;
alter table publish_targets add column if not exists landing_page_id text;
alter table publish_targets add column if not exists landing_page_url text;
alter table publish_targets add column if not exists last_submitted_at timestamptz;
alter table publish_targets add column if not exists last_confirmed_at timestamptz;
alter table publish_targets add column if not exists publish_result_status text not null default 'draft';
alter table publish_targets add column if not exists publish_attempt_count int not null default 0;
alter table publish_targets add column if not exists last_error_message text;
alter table publish_targets add column if not exists expected_revenue_cents int;
alter table publish_targets add column if not exists monetization_path jsonb not null default '{}'::jsonb;
alter table publish_targets drop constraint if exists publish_targets_publish_result_status_check;
alter table publish_targets add constraint publish_targets_publish_result_status_check
  check (publish_result_status in ('draft', 'submitted', 'accepted', 'published', 'failed', 'partial'));
create index if not exists publish_targets_offer_idx on publish_targets(org_id, offer_id);

create table if not exists job_snapshots (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete set null,
  revision_number   int not null default 1,
  snapshot_type     text not null
                      check (snapshot_type in ('before_retry', 'before_revision', 'before_publish', 'approved', 'manual')),
  job_payload       jsonb not null default '{}'::jsonb,
  publish_payload   jsonb not null default '[]'::jsonb,
  validation_payload jsonb not null default '{}'::jsonb,
  created_by        text,
  created_at        timestamptz not null default now()
);

create index if not exists job_snapshots_job_idx on job_snapshots(job_id, created_at desc);

create table if not exists publish_attempts (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references jobs(id) on delete cascade,
  publish_target_id   uuid references publish_targets(id) on delete cascade,
  org_id              uuid not null references orgs(id) on delete cascade,
  brand_id            uuid references brands(id) on delete set null,
  platform            text not null,
  status              text not null default 'submitted'
                        check (status in ('submitted', 'accepted', 'published', 'failed', 'partial')),
  provider_response_id text,
  provider_post_url   text,
  submitted_at        timestamptz not null default now(),
  accepted_at         timestamptz,
  published_at        timestamptz,
  failed_at           timestamptz,
  message             text,
  metadata            jsonb not null default '{}'::jsonb,
  created_by          text
);

create index if not exists publish_attempts_job_idx on publish_attempts(job_id, submitted_at desc);

create table if not exists in_app_notifications (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete set null,
  user_id           text,
  entity_type       text not null,
  entity_id         text not null,
  notification_type text not null,
  title             text not null,
  body              text,
  severity          text not null default 'info'
                      check (severity in ('info', 'warning', 'error', 'success')),
  read_at           timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists in_app_notifications_org_idx on in_app_notifications(org_id, created_at desc);

create table if not exists saved_views (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  user_id           text,
  view_type         text not null
                      check (view_type in ('jobs', 'queue', 'reviews', 'assets', 'activity')),
  name              text not null,
  filters           jsonb not null default '{}'::jsonb,
  is_default        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists saved_views_org_idx on saved_views(org_id, view_type);
drop trigger if exists saved_views_updated_at on saved_views;
create trigger saved_views_updated_at before update on saved_views
  for each row execute function set_updated_at();

create table if not exists entity_locks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  entity_type       text not null,
  entity_id         text not null,
  locked_by         text not null,
  lock_reason       text,
  acquired_at       timestamptz not null default now(),
  expires_at        timestamptz not null,
  metadata          jsonb not null default '{}'::jsonb,
  unique (org_id, entity_type, entity_id)
);

create index if not exists entity_locks_org_idx on entity_locks(org_id, entity_type, entity_id);
create index if not exists provider_health_checks_org_idx on provider_health_checks(org_id);

create table if not exists workspace_onboarding (
  workspace_id             uuid primary key references orgs(id) on delete cascade,
  current_step             text not null default 'workspace',
  completed_steps          text[] not null default '{}'::text[],
  is_complete              boolean not null default false,
  first_brand_id           uuid references brands(id) on delete set null,
  first_job_id             uuid references jobs(id) on delete set null,
  first_scheduled_entry_id text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table workspace_onboarding add column if not exists current_step text not null default 'workspace';
alter table workspace_onboarding add column if not exists completed_steps text[] not null default '{}'::text[];
alter table workspace_onboarding add column if not exists is_complete boolean not null default false;
alter table workspace_onboarding add column if not exists first_brand_id uuid references brands(id) on delete set null;
alter table workspace_onboarding add column if not exists first_job_id uuid references jobs(id) on delete set null;
alter table workspace_onboarding add column if not exists first_scheduled_entry_id text;
alter table workspace_onboarding add column if not exists updated_at timestamptz not null default now();

drop trigger if exists workspace_onboarding_updated_at on workspace_onboarding;
create trigger workspace_onboarding_updated_at before update on workspace_onboarding
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- PHASE 4: TEMPLATES, CLIENT PORTAL, WHITE LABEL, SUGGESTIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists content_templates (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references orgs(id) on delete cascade,
  brand_id          uuid references brands(id) on delete cascade,
  template_kind     text not null
                      check (template_kind in ('blog_post', 'youtube_description', 'tiktok_script', 'cta_block', 'landing_page', 'workflow_preset', 'content_preset')),
  scope             text not null default 'workspace'
                      check (scope in ('system', 'workspace', 'brand')),
  visibility        text not null default 'workspace'
                      check (visibility in ('private', 'workspace', 'marketplace')),
  name              text not null,
  description       text,
  body_template     text not null default '',
  config            jsonb not null default '{}'::jsonb,
  tags              text[] not null default '{}'::text[],
  is_active         boolean not null default true,
  usage_count       int not null default 0,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists content_templates_org_idx on content_templates(org_id, template_kind, visibility);
create index if not exists content_templates_brand_idx on content_templates(brand_id, template_kind);
drop trigger if exists content_templates_updated_at on content_templates;
create trigger content_templates_updated_at before update on content_templates
  for each row execute function set_updated_at();

create table if not exists client_portal_configs (
  org_id                 uuid primary key references orgs(id) on delete cascade,
  portal_slug            text,
  is_enabled             boolean not null default false,
  allow_approvals        boolean not null default true,
  allow_calendar         boolean not null default true,
  allow_reports          boolean not null default true,
  allowed_report_keys    text[] not null default '{overview,analytics,revenue}'::text[],
  welcome_message        text,
  theme                  jsonb not null default '{}'::jsonb,
  created_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists client_portal_configs_updated_at on client_portal_configs;
create trigger client_portal_configs_updated_at before update on client_portal_configs
  for each row execute function set_updated_at();

create table if not exists client_portal_permissions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references orgs(id) on delete cascade,
  member_id              uuid not null references org_members(id) on delete cascade,
  brand_id               uuid references brands(id) on delete cascade,
  can_view_approvals     boolean not null default true,
  can_view_calendar      boolean not null default true,
  can_view_reports       boolean not null default true,
  allowed_report_keys    text[] not null default '{overview,analytics}'::text[],
  created_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (member_id, brand_id)
);

create index if not exists client_portal_permissions_org_idx on client_portal_permissions(org_id, member_id);
drop trigger if exists client_portal_permissions_updated_at on client_portal_permissions;
create trigger client_portal_permissions_updated_at before update on client_portal_permissions
  for each row execute function set_updated_at();

create table if not exists workspace_branding (
  workspace_id           uuid primary key references orgs(id) on delete cascade,
  brand_name             text,
  app_label              text,
  logo_url               text,
  favicon_url            text,
  marketing_site_url     text,
  custom_domain          text,
  domain_status          text not null default 'draft'
                           check (domain_status in ('draft', 'pending_verification', 'verified', 'failed')),
  primary_color          text,
  accent_color           text,
  theme                  jsonb not null default '{}'::jsonb,
  css_variables          jsonb not null default '{}'::jsonb,
  custom_css             text,
  support_email          text,
  created_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists workspace_branding_updated_at on workspace_branding;
create trigger workspace_branding_updated_at before update on workspace_branding
  for each row execute function set_updated_at();

create table if not exists optimization_suggestions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references orgs(id) on delete cascade,
  brand_id               uuid references brands(id) on delete set null,
  job_id                 uuid references jobs(id) on delete cascade,
  entity_type            text not null
                           check (entity_type in ('workspace', 'job', 'review', 'publish_target', 'calendar')),
  entity_id              text not null,
  suggestion_type        text not null
                           check (suggestion_type in ('missing_cta', 'weak_title', 'missing_assets', 'schedule_gap', 'quality_improvement', 'approval_bottleneck', 'throughput_risk')),
  severity               text not null default 'info'
                           check (severity in ('info', 'warning', 'critical')),
  title                  text not null,
  description            text,
  suggested_action       text,
  status                 text not null default 'open'
                           check (status in ('open', 'dismissed', 'applied')),
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists optimization_suggestions_org_idx on optimization_suggestions(org_id, status, created_at desc);
drop trigger if exists optimization_suggestions_updated_at on optimization_suggestions;
create trigger optimization_suggestions_updated_at before update on optimization_suggestions
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references orgs(id) on delete cascade,
  stripe_subscription_id  text unique not null,
  plan_tier               text not null,
  status                  text not null,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table subscriptions add column if not exists current_period_start timestamptz;

drop trigger if exists subscriptions_updated_at on subscriptions;
create trigger subscriptions_updated_at before update on subscriptions
  for each row execute function set_updated_at();

create index if not exists subscriptions_org_idx on subscriptions(org_id);

create table if not exists billing_state_events (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references orgs(id) on delete cascade,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  event_type              text not null,
  subscription_status     text,
  billing_status          text,
  plan_tier               text,
  failed_payment          boolean not null default false,
  payload                 jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now()
);

create index if not exists billing_state_events_org_idx on billing_state_events(org_id, created_at desc);

-- Records incoming webhook events for idempotency / replay protection
create table if not exists webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,                -- e.g. 'stripe'
  event_id           text not null,                -- provider event ID
  event_type         text,
  org_id             uuid references orgs(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  payload            jsonb not null default '{}'::jsonb,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  unique (provider, event_id)
);

create index if not exists webhook_events_provider_idx on webhook_events(provider, received_at desc);

-- ─────────────────────────────────────────────────────────────
-- REVENUE EVENTS
-- ─────────────────────────────────────────────────────────────
create table if not exists revenue_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  brand_id      uuid references brands(id) on delete set null,
  job_id        uuid references jobs(id) on delete set null,
  type          text not null,   -- subscription_payment, affiliate_click, sale
  amount_cents  int  not null default 0,
  description   text,
  post_id       text,
  platform      text,
  cta_id        text,
  landing_page_id text,
  offer_id      text,
  currency      text default 'usd',
  stripe_event_id text,
  stripe_invoice_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  metadata      jsonb not null default '{}'::jsonb,
  source_url    text,
  period_start  timestamptz,
  period_end    timestamptz,
  recorded_at   timestamptz not null default now()
);

alter table revenue_events add column if not exists post_id text;
alter table revenue_events add column if not exists platform text;
alter table revenue_events add column if not exists cta_id text;
alter table revenue_events add column if not exists landing_page_id text;
alter table revenue_events add column if not exists offer_id text;
alter table revenue_events add column if not exists currency text default 'usd';
alter table revenue_events add column if not exists stripe_event_id text;
alter table revenue_events add column if not exists stripe_invoice_id text;
alter table revenue_events add column if not exists stripe_customer_id text;
alter table revenue_events add column if not exists stripe_subscription_id text;
alter table revenue_events add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists revenue_events_org_idx on revenue_events(org_id);
create index if not exists revenue_events_brand_idx on revenue_events(brand_id);
create index if not exists revenue_events_offer_idx on revenue_events(org_id, offer_id, recorded_at desc);
create index if not exists revenue_events_landing_page_idx on revenue_events(org_id, landing_page_id, recorded_at desc);

-- ─────────────────────────────────────────────────────────────
-- EMAIL AUTORESPONDER
-- ─────────────────────────────────────────────────────────────

-- SMTP CONFIG (one per org)
create table if not exists email_smtp_configs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id) on delete cascade,
  from_name          text not null default 'Autonomous Prime',
  gmail_user         text not null,
  gmail_app_password text not null,
  base_url           text not null default 'http://localhost:3001',
  is_verified        boolean default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (org_id)
);

-- EMAIL SEQUENCES
create table if not exists email_sequences (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  description  text,
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual','new_subscriber','form_submission','tag_applied','webhook')),
  trigger_tag  text,
  status       text not null default 'active'
    check (status in ('active','paused','archived')),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists email_sequences_org_idx on email_sequences(org_id);

drop trigger if exists email_sequences_updated_at on email_sequences;
create trigger email_sequences_updated_at before update on email_sequences
  for each row execute function set_updated_at();

-- EMAIL STEPS
create table if not exists email_steps (
  id          uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references email_sequences(id) on delete cascade,
  org_id      uuid not null,
  step_number int  not null,
  subject     text not null,
  body_html   text not null default '',
  body_plain  text,
  delay_days  int  not null default 0,
  is_active   boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (sequence_id, step_number)
);

create index if not exists email_steps_sequence_idx on email_steps(sequence_id);

drop trigger if exists email_steps_updated_at on email_steps;
create trigger email_steps_updated_at before update on email_steps
  for each row execute function set_updated_at();

-- SUBSCRIBERS / CONTACTS
create table if not exists email_subscribers (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  email             text not null,
  first_name        text,
  last_name         text,
  tags              text[] default '{}',
  status            text not null default 'active'
    check (status in ('active','paused','unsubscribed','bounced')),
  unsubscribe_token text unique default encode(gen_random_bytes(32), 'hex'),
  source            text default 'manual',
  metadata          jsonb default '{}',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (org_id, email)
);

create index if not exists email_subscribers_org_idx    on email_subscribers(org_id);
create index if not exists email_subscribers_status_idx on email_subscribers(status);
create index if not exists email_subscribers_token_idx  on email_subscribers(unsubscribe_token);

drop trigger if exists email_subscribers_updated_at on email_subscribers;
create trigger email_subscribers_updated_at before update on email_subscribers
  for each row execute function set_updated_at();

-- ENROLLMENTS (one row per subscriber+sequence pair)
create table if not exists email_enrollments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  subscriber_id uuid not null references email_subscribers(id) on delete cascade,
  sequence_id   uuid not null references email_sequences(id)   on delete cascade,
  current_step  int  not null default 1,
  status        text not null default 'active'
    check (status in ('active','paused','completed','unsubscribed','cancelled')),
  enrolled_at   timestamptz default now(),
  next_send_at  timestamptz,
  last_sent_at  timestamptz,
  completed_at  timestamptz,
  unique (subscriber_id, sequence_id)
);

create index if not exists email_enrollments_due_idx on email_enrollments(status, next_send_at);
create index if not exists email_enrollments_org_idx on email_enrollments(org_id);

-- SEND LOG (one row per email sent)
create table if not exists email_send_log (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  enrollment_id uuid references email_enrollments(id),
  subscriber_id uuid references email_subscribers(id),
  sequence_id   uuid references email_sequences(id),
  step_id       uuid references email_steps(id),
  to_email      text not null,
  subject       text not null,
  status        text not null default 'sent'
    check (status in ('pending','sent','failed','bounced')),
  error_message text,
  tracking_id   text unique default encode(gen_random_bytes(16), 'hex'),
  sent_at       timestamptz default now()
);

create index if not exists email_send_log_org_idx      on email_send_log(org_id);
create index if not exists email_send_log_tracking_idx on email_send_log(tracking_id);
create index if not exists email_send_log_sequence_idx on email_send_log(sequence_id);

-- TRACKING EVENTS (opens, clicks, unsubscribes)
create table if not exists email_tracking_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid,
  send_log_id   uuid references email_send_log(id),
  subscriber_id uuid references email_subscribers(id),
  sequence_id   uuid references email_sequences(id),
  step_id       uuid references email_steps(id),
  event_type    text not null check (event_type in ('open','click','unsubscribe')),
  link_url      text,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz default now()
);

create index if not exists email_tracking_events_log_idx on email_tracking_events(send_log_id);
create index if not exists email_tracking_events_org_idx on email_tracking_events(org_id);

-- EMAIL CAPTURE FORMS
create table if not exists email_forms (
  id               uuid        primary key default gen_random_uuid(),
  org_id           uuid        not null references orgs(id) on delete cascade,
  name             text        not null,
  headline         text        not null default 'Subscribe to our newsletter',
  description      text        not null default '',
  button_text      text        not null default 'Subscribe Now',
  success_message  text        not null default 'You''re in! Check your inbox.',
  collect_name     boolean     not null default true,
  sequence_id      uuid        references email_sequences(id) on delete set null,
  redirect_url     text        not null default '',
  primary_color    text        not null default '#58a6ff',
  bg_color         text        not null default '#ffffff',
  text_color       text        not null default '#111827',
  border_radius    integer     not null default 8,
  custom_css       text        not null default '',
  is_active        boolean     not null default true,
  submission_count integer     not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists email_forms_org_id_idx on email_forms(org_id);
create index if not exists email_forms_active_idx on email_forms(is_active);

-- ─────────────────────────────────────────────────────────────
-- STORED PROCEDURES
-- ─────────────────────────────────────────────────────────────

-- Increment jobs_used_this_month atomically
create or replace function increment_jobs_used(org_id_input uuid)
returns void language plpgsql as $$
begin
  update orgs
  set jobs_used_this_month = jobs_used_this_month + 1
  where id = org_id_input;
end $$;

-- Reset all orgs' monthly counters (call via pg_cron on 1st of each month)
create or replace function reset_monthly_job_counters()
returns void language plpgsql as $$
begin
  update orgs set jobs_used_this_month = 0;
end $$;

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (optional — app enforces org_id scoping)
-- ─────────────────────────────────────────────────────────────
-- RLS is disabled here because the API uses the service-role key.
-- Enable and configure policies if you want Supabase client-side access.

-- alter table orgs          enable row level security;
-- alter table org_members   enable row level security;
-- alter table brands        enable row level security;
-- alter table jobs          enable row level security;
-- alter table assets        enable row level security;
-- alter table approvals     enable row level security;
-- alter table subscriptions enable row level security;
-- alter table revenue_events enable row level security;
