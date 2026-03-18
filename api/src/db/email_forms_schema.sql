-- ============================================================
-- Email Capture Forms
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS email_forms (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  headline          TEXT        NOT NULL DEFAULT 'Subscribe to our newsletter',
  description       TEXT        NOT NULL DEFAULT '',
  button_text       TEXT        NOT NULL DEFAULT 'Subscribe Now',
  success_message   TEXT        NOT NULL DEFAULT 'You''re in! Check your inbox.',
  collect_name      BOOLEAN     NOT NULL DEFAULT true,
  sequence_id       UUID        REFERENCES email_sequences(id) ON DELETE SET NULL,
  redirect_url      TEXT        NOT NULL DEFAULT '',
  primary_color     TEXT        NOT NULL DEFAULT '#58a6ff',
  bg_color          TEXT        NOT NULL DEFAULT '#ffffff',
  text_color        TEXT        NOT NULL DEFAULT '#111827',
  border_radius     INTEGER     NOT NULL DEFAULT 8,
  custom_css        TEXT        NOT NULL DEFAULT '',
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  submission_count  INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_forms_org_id_idx ON email_forms(org_id);
CREATE INDEX IF NOT EXISTS email_forms_active_idx ON email_forms(is_active);
