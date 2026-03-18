# Autonomous Prime Phase 2: Operational Trust Layer

## Scope

Phase 2 turns the Phase 1 SaaS foundation into an operational system teams can trust day to day. The goal is not more surface area. The goal is clearer workflow state, stronger publishing safety, reusable assets, and better operator visibility.

This phase focuses on:

1. Asset library
2. Activity history and audit trail
3. Publishing safeguards
4. Search and filters
5. API key and provider settings manager
6. Queue intelligence

Not included in Phase 2:

- Advanced monetization analytics
- White label features
- Marketplace features
- AI performance scoring dashboards

## 1. Phase 2 architecture

Autonomous Prime should keep the same 3-layer split from Phase 1:

- React in [`ui/src/App.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\App.tsx) for workflow UX, filters, audit views, queue state, and asset browsing.
- Node SaaS API in [`api/src/index.js`](c:\Users\Mark g\Desktop\Automous Prime\api\src\index.js) as the canonical trust layer for metadata, validation, audit, asset indexing, and publishing readiness.
- Python execution layer in [`dashboard/api.py`](c:\Users\Mark g\Desktop\Automous Prime\dashboard\api.py) and [`main.py`](c:\Users\Mark g\Desktop\Automous Prime\main.py) for generation, pipeline execution, asset production, and step callbacks.

### Phase 2 responsibility model

- React owns operational visibility:
  - asset library
  - filtered list views
  - publish readiness panels
  - audit timeline rendering
  - queue state surfaces
- Node owns trust state:
  - asset records and relationships
  - durable audit entries
  - validation results
  - queue classification
  - provider credential metadata and health state
- Python owns execution signals:
  - generated asset metadata
  - pipeline step outputs
  - missing dependency signals from runtime
  - step blocked reasons and retryability

### Core Phase 2 design decisions

- Keep `jobs` as the logical content request and `job_runs` as execution attempts.
- Evolve `assets` into a proper central library instead of creating a separate media subsystem.
- Add normalized validation and audit tables instead of overloading `job_events.metadata`.
- Treat “ready to publish” as a computed state backed by durable validation results.
- Treat queue intelligence as a classification layer on top of jobs, runs, steps, assets, approvals, and validations.

### Runtime flow

1. User creates or edits a job.
2. Node stores job metadata and initial validation state.
3. Python generates outputs and sends step/asset callbacks.
4. Node records assets, audit entries, and validation changes.
5. Queue intelligence classifies the item into:
   - ready
   - blocked
   - failed
   - awaiting approval
   - missing assets
   - missing CTA
   - missing schedule
6. React presents filtered views for operators and reviewers.
7. Publish actions are rejected server-side if required validations still fail.

## 2. Database updates

Phase 2 should extend the existing schema in [`api/src/db/schema.sql`](c:\Users\Mark g\Desktop\Automous Prime\api\src\db\schema.sql).

### Expand `assets`

Current `assets` is too narrow. Convert it into the main asset library.

Add:

- `asset_kind text check ('image','audio','video','thumbnail','document','template','other')`
- `name text`
- `title text`
- `description text`
- `mime_type text`
- `file_ext text`
- `byte_size bigint`
- `duration_seconds numeric`
- `width int`
- `height int`
- `checksum text`
- `storage_key text`
- `source_type text check ('generated','uploaded','imported','external')`
- `source_ref text`
- `usage_status text check ('active','archived','deleted')`
- `created_by text`
- `updated_at timestamptz`

Keep:

- `job_id`
- `job_run_id`
- `org_id`
- `brand_id`
- `provider`
- `storage_url`
- `local_path`
- `metadata`

Indexes:

- `(org_id, brand_id, asset_kind, created_at desc)`
- `(job_id)`
- `(job_run_id)`
- `(checksum)`
- `(usage_status)`

### New `asset_links`

Links assets to jobs, posts, steps, landing pages, or future reusable objects.

- `id uuid pk`
- `org_id uuid fk`
- `brand_id uuid fk`
- `asset_id uuid fk`
- `entity_type text check ('job','job_run','job_step','post','calendar_entry','landing_page')`
- `entity_id text`
- `role text check ('primary','thumbnail','voiceover','background','attachment','reference')`
- `created_by text`
- `created_at timestamptz`
- unique `(asset_id, entity_type, entity_id, role)`

### New `activity_log`

Top-level audit trail for the product, broader than `job_events`.

- `id uuid pk`
- `org_id uuid fk`
- `brand_id uuid fk null`
- `entity_type text`
- `entity_id text`
- `action text`
- `actor_type text check ('user','system','worker')`
- `actor_id text null`
- `actor_email text null`
- `summary text`
- `metadata jsonb default '{}'::jsonb`
- `created_at timestamptz`

Recommended actions:

- `workspace.created`
- `brand.created`
- `job.created`
- `job.edited`
- `job.retried`
- `job.canceled`
- `review.approved`
- `review.rejected`
- `review.revision_requested`
- `schedule.created`
- `schedule.updated`
- `publish.started`
- `publish.completed`
- `publish.blocked`
- `asset.uploaded`
- `asset.generated`
- `asset.linked`
- `integration.updated`
- `provider.tested`

### New `job_validations`

Stores pre-publish and workflow validation state.

- `id uuid pk`
- `job_id uuid fk`
- `job_run_id uuid fk null`
- `org_id uuid fk`
- `brand_id uuid fk null`
- `rule_key text`
- `severity text check ('error','warning','info')`
- `status text check ('pass','fail','skipped')`
- `message text`
- `field_ref text null`
- `metadata jsonb default '{}'::jsonb`
- `computed_at timestamptz`
- unique `(job_id, rule_key)`

### New `publish_targets`

Normalizes what will be published where.

- `id uuid pk`
- `job_id uuid fk`
- `org_id uuid fk`
- `brand_id uuid fk`
- `platform text`
- `content_type text`
- `cta_url text`
- `cta_label text`
- `meta_title text`
- `meta_description text`
- `schedule_state text check ('unscheduled','scheduled','published','canceled')`
- `scheduled_at timestamptz null`
- `published_at timestamptz null`
- `status text check ('draft','ready','blocked','published','failed')`
- `created_by text`
- `updated_at timestamptz`

### New `provider_credentials`

This is the durable provider settings manager. Keep `provider_connections` for connection health and scope, but move secret/config ownership here.

- `id uuid pk`
- `org_id uuid fk`
- `brand_id uuid fk null`
- `provider_key text`
- `scope text check ('workspace','brand')`
- `display_name text`
- `status text check ('configured','incomplete','invalid','disabled')`
- `config jsonb`
- `secret_refs jsonb`
- `last_tested_at timestamptz null`
- `last_test_status text check ('unknown','connected','degraded','failed')`
- `last_test_message text null`
- `created_by text`
- `updated_by text`
- `created_at timestamptz`
- `updated_at timestamptz`
- unique `(org_id, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), provider_key, scope)`

### New `queue_snapshots`

Optional denormalized snapshot table to avoid recomputing queue state for every view.

- `job_id uuid pk`
- `org_id uuid fk`
- `brand_id uuid fk null`
- `queue_state text check ('ready','running','blocked','failed','awaiting_approval','missing_assets','missing_cta','missing_schedule','canceled','completed')`
- `blocked_reasons jsonb`
- `next_action text`
- `ready_for_publish boolean`
- `latest_run_status text`
- `review_status text null`
- `validation_summary jsonb`
- `updated_at timestamptz`

## 3. API routes

Add these Node routes under `/saas`.

### Asset library

- `GET /saas/assets`
  - filters: `brand_id`, `asset_kind`, `source_type`, `job_id`, `job_run_id`, `search`, `page`
- `POST /saas/assets`
  - create manual asset records for uploads/imports
- `GET /saas/assets/:id`
  - asset detail + links + source job
- `PATCH /saas/assets/:id`
  - edit title, description, usage state, metadata
- `POST /saas/assets/:id/link`
  - link asset to job/post/entity
- `POST /saas/assets/:id/archive`

### Activity and audit

- `GET /saas/activity`
  - filters: `entity_type`, `actor_id`, `brand_id`, `action`, `date_from`, `date_to`
- `GET /saas/jobs/:id/activity`
  - merged job timeline from `job_events`, `review_actions`, `activity_log`

### Publishing safeguards

- `GET /saas/jobs/:id/validations`
- `POST /saas/jobs/:id/validate`
  - recompute validation set
- `POST /saas/jobs/:id/publish-check`
  - returns `ready`, `blocking_errors`, `warnings`
- `POST /saas/jobs/:id/publish`
  - guarded publish endpoint, rejects when blocking validations exist

### Search and filtered workflow

- `GET /saas/jobs`
  - expand current route to support:
  - `status`
  - `platform`
  - `brand_id`
  - `content_type`
  - `approval_state`
  - `date_from`
  - `date_to`
  - `schedule_state`
  - `queue_state`
  - `search`

### Provider settings manager

- `GET /saas/provider-settings`
- `POST /saas/provider-settings`
- `PATCH /saas/provider-settings/:id`
- `POST /saas/provider-settings/:id/test`
- `GET /saas/provider-settings/status`

### Queue intelligence

- `GET /saas/queue`
  - filters: `queue_state`, `brand_id`, `platform`, `approval_state`
- `GET /saas/queue/summary`
  - counts for blocked, ready, failed, awaiting approval, missing assets, missing CTA, missing schedule
- `POST /saas/queue/recompute`

### Internal worker callbacks

Extend the internal route set:

- `POST /saas/internal/assets/upsert`
- `POST /saas/internal/jobs/:id/validation-results`
- `POST /saas/internal/jobs/:id/queue-state`
- `POST /saas/internal/activity`

## 4. React component updates

### New panels

- `AssetLibraryPanel.tsx`
  - grid/list toggle
  - asset preview
  - filters by kind, brand, source, job
  - asset detail drawer
- `ActivityPanel.tsx`
  - global audit timeline
  - actor/entity/action filters
- `QueuePanel.tsx`
  - queue buckets
  - blocked reason badges
  - quick actions for retry, review, fix metadata

### Update existing panels

#### [`JobsPanel.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\components\JobsPanel.tsx)

Add:

- search bar
- multi-filter toolbar
- queue state badge
- publish readiness summary
- linked assets section
- validation issues section
- schedule state and platform tags

#### [`ReviewInboxPanel.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\components\ReviewInboxPanel.tsx)

Add:

- linked asset previews
- validation warning chips
- publish readiness indicator

#### [`IntegrationsPanel.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\components\IntegrationsPanel.tsx)

Split into:

- provider credentials manager
- connection health cards
- last test feedback
- scope selector: workspace or brand

#### [`SettingsPanel.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\components\SettingsPanel.tsx)

Keep machine/runtime settings here, but move SaaS provider credentials out into the integrations/provider settings experience.

### Navigation updates

Add sidebar entries:

- `Assets`
- `Queue`
- `Activity`

Recommended grouping:

- `Operations`: Jobs, Reviews, Queue, Assets, Integrations
- `System`: Activity, Settings

## 5. Backend services

Create these Node service modules.

### `api/src/services/assets.js`

Responsibilities:

- create or update asset records
- link assets to jobs/posts
- normalize metadata from Python callbacks
- enforce workspace/brand scope

### `api/src/services/activityLog.js`

Responsibilities:

- write audit entries for user and system actions
- provide merged timeline formatting helpers
- standardize action verbs and metadata shape

### `api/src/services/validations.js`

Responsibilities:

- compute validation rules
- persist `job_validations`
- return blocking errors vs warnings
- provide `isPublishReady(jobId)`

### `api/src/services/providerSettings.js`

Responsibilities:

- store provider config metadata
- write secret references
- sync test results into `provider_credentials` and `provider_connections`

### `api/src/services/queueIntelligence.js`

Responsibilities:

- classify each job
- compute queue summary counts
- derive next-action labels
- maintain optional `queue_snapshots`

## 6. Queue intelligence logic

Queue intelligence should classify each job into one primary state using deterministic priority order.

### Input signals

- `jobs.status`
- latest `job_runs.status`
- `job_steps.status`
- `review_threads.current_status`
- `job_validations`
- linked required assets
- `publish_targets.schedule_state`
- presence of CTA/meta/platform fields

### Classification order

1. `canceled`
   - if job or latest run is canceled
2. `failed`
   - if latest run failed and retry is possible
3. `running`
   - if latest run is queued, running, or retrying
4. `awaiting_approval`
   - if review thread is pending
5. `missing_assets`
   - if required asset validations fail
6. `missing_cta`
   - if CTA validations fail
7. `missing_schedule`
   - if schedule/platform validations fail for publishable content
8. `blocked`
   - if any other blocking validation fails
9. `ready`
   - if validations pass and not waiting on review
10. `completed`
   - if published or fully completed

### Next action labels

Examples:

- `Upload image`
- `Add CTA`
- `Assign schedule`
- `Request review`
- `Retry failed run`
- `Approve for publish`
- `Publish now`

### Blocked reasons

Store as normalized keys:

- `missing_primary_image`
- `missing_audio`
- `missing_video`
- `missing_cta_url`
- `missing_cta_label`
- `missing_meta_title`
- `missing_meta_description`
- `missing_schedule`
- `missing_platform`
- `approval_required`
- `run_failed`
- `provider_unconfigured`

## 7. Validation rules

Validation rules should be deterministic and run in Node before publish and after important workflow changes.

### Core rules

- `job.topic.present`
- `job.brand.present` for brand-scoped workflows
- `job.platform.present`
- `job.content_type.present`

### Asset rules

- `asset.primary_image.present`
- `asset.audio.present` for audio/video publish types
- `asset.video.present` for video publish types
- `asset.thumbnail.present` for video platforms

### CTA rules

- `cta.url.present`
- `cta.label.present`

### Metadata rules

- `meta.title.present`
- `meta.description.present`

### Schedule rules

- `schedule.platform.present`
- `schedule.datetime.present`
- `schedule.state.valid`

### Approval rules

- `review.approved`
  - required when workspace settings demand approval for the content type

### Provider rules

- `provider.wordpress.configured` for WordPress publish
- `provider.social.configured` for social platform publish

### Validation output contract

Each rule returns:

- `rule_key`
- `severity`
- `status`
- `message`
- `field_ref`
- `metadata`

Only `severity = error` and `status = fail` should block publish.

## 8. First pass code plan

### Pass 1: Schema + services

1. add `activity_log`, `job_validations`, `asset_links`, `provider_credentials`, `queue_snapshots`
2. expand `assets`
3. add Node service modules for assets, activity, validations, provider settings, queue intelligence

### Pass 2: API

1. expand `/saas/jobs` filters
2. add `/saas/assets`
3. add `/saas/activity`
4. add `/saas/provider-settings`
5. add `/saas/queue`
6. add validation and guarded publish routes

### Pass 3: Python hooks

1. emit richer asset callbacks from Python
2. emit step blocked reasons and missing dependency signals
3. emit publishable output metadata per run

### Pass 4: React operations UX

1. build `QueuePanel`
2. build `AssetLibraryPanel`
3. build `ActivityPanel`
4. upgrade `JobsPanel` with filters and validation visibility
5. upgrade `IntegrationsPanel` into provider settings manager + health

### Pass 5: Guarded publishing

1. implement validation recompute on job change, asset change, review action, and scheduling update
2. reject publish when blocking validations exist
3. expose readiness summary in list and detail views

### Pass 6: Hardening

1. add end-to-end tests around:
   - missing CTA
   - missing image
   - missing schedule
   - approval required
   - retry after failure
2. backfill audit entries for key Phase 1 actions where possible

## Recommended implementation order

1. database changes
2. validation service
3. queue intelligence service
4. asset library service and routes
5. provider settings manager
6. jobs filter expansion
7. queue and asset React panels
8. activity timeline
9. guarded publish flow

This order delivers operational trust fastest because it makes the system explain itself before adding more operator actions.
