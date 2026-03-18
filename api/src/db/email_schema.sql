-- ============================================================
-- Autonomous Prime — Email Autoresponder Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- SMTP CONFIG (one per org)
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- EMAIL SEQUENCES
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- EMAIL STEPS
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- SUBSCRIBERS / CONTACTS
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- ENROLLMENTS  (one row per subscriber+sequence pair)
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- SEND LOG  (one row per email sent)
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- TRACKING EVENTS  (opens, clicks, unsubscribes)
-- ─────────────────────────────────────────────────────────────
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
