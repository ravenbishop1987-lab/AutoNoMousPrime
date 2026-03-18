# Autonomous Prime Phase 1: Core SaaS Foundation

## Scope

This phase hardens Autonomous Prime into a usable SaaS without expanding product surface area. It focuses on:

1. User accounts and permissions
2. Workspace and brand separation
3. Job status and retry system
4. Approval notes and revision flow
5. Integration health dashboard
6. Onboarding wizard

Not included in Phase 1:

- Advanced analytics
- White label
- Marketplace features
- Cross-workspace automation packs

## 1. Phase 1 architecture

Autonomous Prime should remain a 3-layer system:

- React app in [`ui/src/App.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\App.tsx) for SaaS UX, onboarding, workspace switching, jobs, approvals, and integration health.
- Node SaaS API in [`api/src/index.js`](c:\Users\Mark g\Desktop\Automous Prime\api\src\index.js) as the system of record for auth, RBAC, workspaces, brands, job metadata, approvals, integration state, and onboarding.
- Python execution layer in [`dashboard/api.py`](c:\Users\Mark g\Desktop\Automous Prime\dashboard\api.py) and [`main.py`](c:\Users\Mark g\Desktop\Automous Prime\main.py) for orchestration, pipelines, agent execution, and provider health probes that require runtime access.

Recommended ownership:

- React owns navigation, forms, status rendering, approval UX, and wizard flow.
- Node owns tenancy boundaries, persistence, RBAC, auditability, and lifecycle state transitions.
- Python owns execution events, step-level pipeline progress, retries of internal agent steps, and provider runtime checks.

### Proposed runtime model

1. User authenticates.
2. Node resolves `user -> workspace membership -> active workspace -> active brand`.
3. React sends `workspace_id` and optional `brand_id` on SaaS-scoped requests.
4. Node creates a durable `job_runs` record and dispatches execution to Python.
5. Python emits status callbacks back to Node.
6. Node updates canonical job state and exposes it to React.
7. Approval actions happen in Node and may trigger a new revision run in Python.

### Key design decisions

- Treat `orgs` as `workspaces` for Phase 1 to avoid a second tenancy model.
- Keep `brands` as children of `workspaces`.
- Move canonical job state into Node/Postgres, not Python memory.
- Use Python as a worker, not the source of truth for approvals or tenancy.
- Introduce audit-friendly append-only event tables for job transitions and approval actions.

## 2. Required database schema

The existing schema in [`api/src/db/schema.sql`](c:\Users\Mark g\Desktop\Automous Prime\api\src\db\schema.sql) is a starting point, but it needs stronger tenancy, workflow, and health models.

### Core tenancy tables

#### `workspaces`

Rename or alias current `orgs`.

- `id uuid pk`
- `name text`
- `slug text unique`
- `owner_user_id text`
- `plan_tier text`
- `status text check ('active','suspended','canceled')`
- `default_brand_id uuid null`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `users`

Optional local mirror of auth provider users for profile and joins.

- `id text pk`
- `email text unique`
- `display_name text`
- `avatar_url text`
- `last_login_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `workspace_members`

Extend current `org_members`.

- `id uuid pk`
- `workspace_id uuid fk`
- `user_id text null`
- `email text`
- `role text check ('owner','admin','editor','reviewer')`
- `invite_status text check ('pending','accepted','revoked')`
- `invited_by text`
- `joined_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`
- unique `(workspace_id, email)`

### Brand and context separation

#### `brands`

Keep, but make it a complete execution boundary.

- `id uuid pk`
- `workspace_id uuid fk`
- `name text`
- `slug text`
- `status text check ('active','archived')`
- `niche text`
- `tone text`
- `voice_style text`
- `target_keywords text[]`
- `default_timezone text`
- `default_locale text`
- `default_wordpress_connection_id uuid null`
- `created_at timestamptz`
- `updated_at timestamptz`
- unique `(workspace_id, slug)`

#### `brand_assets`

- `id uuid pk`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `asset_type text check ('image','audio','video','document','template')`
- `name text`
- `storage_key text`
- `source text`
- `metadata jsonb`
- `created_by text`
- `created_at timestamptz`

#### `content_calendars`

- `id uuid pk`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `name text`
- `provider text check ('internal','wordpress')`
- `timezone text`
- `created_at timestamptz`

#### `calendar_entries`

- `id uuid pk`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `calendar_id uuid fk`
- `job_id uuid null`
- `status text check ('draft','scheduled','published','canceled')`
- `content_type text`
- `scheduled_at timestamptz`
- `published_at timestamptz null`
- `payload jsonb`
- `created_by text`
- `created_at timestamptz`
- `updated_at timestamptz`

### Job lifecycle

#### `jobs`

Represents the logical content request.

- `id uuid pk`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `created_by text`
- `job_type text`
- `topic text`
- `input_payload jsonb`
- `current_revision_number int default 1`
- `status text check ('queued','running','completed','failed','retrying','canceled','awaiting_review','revision_requested','approved')`
- `latest_run_id uuid null`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `job_runs`

Represents each attempt, including retries and revisions.

- `id uuid pk`
- `job_id uuid fk`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `run_number int`
- `triggered_by text`
- `trigger_type text check ('initial','manual_retry','auto_retry','revision')`
- `status text check ('queued','running','completed','failed','retrying','canceled')`
- `python_pipeline_id text null`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `error_code text null`
- `error_message text null`
- `retry_count int default 0`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `job_steps`

Step-level visibility for blog, image, voice, video, review, publish.

- `id uuid pk`
- `job_run_id uuid fk`
- `step_key text`
- `provider text`
- `status text check ('queued','running','completed','failed','skipped','canceled')`
- `attempt_count int default 0`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `input_payload jsonb`
- `output_payload jsonb`
- `error_message text null`

#### `job_events`

Append-only audit log.

- `id uuid pk`
- `job_id uuid fk`
- `job_run_id uuid null`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `event_type text`
- `from_status text null`
- `to_status text null`
- `message text`
- `metadata jsonb`
- `actor_type text check ('user','system','worker')`
- `actor_id text null`
- `created_at timestamptz`

### Approval and revision flow

#### `review_threads`

- `id uuid pk`
- `job_id uuid fk`
- `workspace_id uuid fk`
- `brand_id uuid fk`
- `current_status text check ('pending','approved','rejected','revision_requested')`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `review_actions`

- `id uuid pk`
- `thread_id uuid fk`
- `job_id uuid fk`
- `revision_number int`
- `action text check ('approve','reject','request_revision','comment')`
- `note text`
- `metadata jsonb`
- `created_by text`
- `created_at timestamptz`

#### `review_comments`

- `id uuid pk`
- `thread_id uuid fk`
- `job_id uuid fk`
- `job_run_id uuid null`
- `parent_comment_id uuid null`
- `body text`
- `anchor_type text null`
- `anchor_ref text null`
- `created_by text`
- `created_at timestamptz`

### Integration and provider health

#### `provider_connections`

- `id uuid pk`
- `workspace_id uuid fk`
- `brand_id uuid null`
- `provider_key text`
- `display_name text`
- `category text check ('cms','llm','voice','commerce','automation','other')`
- `status text check ('connected','degraded','disconnected','error')`
- `config jsonb`
- `secret_ref text`
- `last_tested_at timestamptz null`
- `last_success_at timestamptz null`
- `last_error_at timestamptz null`
- `last_error_message text null`
- `created_by text`
- `created_at timestamptz`
- `updated_at timestamptz`
- unique `(workspace_id, brand_id, provider_key)`

#### `provider_health_checks`

- `id uuid pk`
- `provider_connection_id uuid fk`
- `workspace_id uuid fk`
- `brand_id uuid null`
- `status text check ('healthy','degraded','failed')`
- `latency_ms int null`
- `response_code int null`
- `message text`
- `details jsonb`
- `checked_by text`
- `checked_at timestamptz`

### Onboarding

#### `workspace_onboarding`

- `workspace_id uuid pk`
- `current_step text`
- `completed_steps text[]`
- `is_complete boolean default false`
- `first_brand_id uuid null`
- `first_job_id uuid null`
- `first_scheduled_entry_id uuid null`
- `created_at timestamptz`
- `updated_at timestamptz`

## 3. API routes

Node should own Phase 1 API routes under `/saas`.

### Auth and membership

- `GET /saas/session`
  Returns user, active workspace, role, available workspaces.
- `POST /saas/workspaces`
  Create workspace and owner membership.
- `GET /saas/workspaces`
  List user workspaces.
- `POST /saas/workspaces/:workspaceId/switch`
  Set active workspace.
- `GET /saas/workspaces/:workspaceId/members`
  List members.
- `POST /saas/workspaces/:workspaceId/members`
  Invite member with role.
- `PATCH /saas/workspaces/:workspaceId/members/:memberId`
  Change role.
- `DELETE /saas/workspaces/:workspaceId/members/:memberId`
  Revoke/remove member.

### Brands and calendars

- `GET /saas/workspaces/:workspaceId/brands`
- `POST /saas/workspaces/:workspaceId/brands`
- `GET /saas/brands/:brandId`
- `PATCH /saas/brands/:brandId`
- `GET /saas/brands/:brandId/calendars`
- `POST /saas/brands/:brandId/calendars`
- `GET /saas/brands/:brandId/calendar-entries`
- `POST /saas/brands/:brandId/calendar-entries`

### Jobs

- `GET /saas/jobs`
  Filter by `workspace_id`, `brand_id`, `status`, `created_by`.
- `POST /saas/jobs`
  Create job and first `job_run`.
- `GET /saas/jobs/:jobId`
  Return job, latest run, steps, assets, review thread.
- `POST /saas/jobs/:jobId/retry`
  Create retry `job_run` if latest run failed.
- `POST /saas/jobs/:jobId/cancel`
  Cancel queued or running job.
- `GET /saas/job-runs/:runId`
  Detailed run diagnostics.
- `GET /saas/job-runs/:runId/events`
  Timeline for UI.

### Reviews and revisions

- `GET /saas/jobs/:jobId/review`
- `POST /saas/jobs/:jobId/review/comment`
- `POST /saas/jobs/:jobId/review/approve`
- `POST /saas/jobs/:jobId/review/reject`
- `POST /saas/jobs/:jobId/review/request-revision`
  Creates a new `job_run` with `trigger_type='revision'`.

### Integrations

- `GET /saas/integrations`
  All workspace and brand provider connections.
- `POST /saas/integrations`
  Create or upsert a provider connection.
- `PATCH /saas/integrations/:connectionId`
  Update config.
- `POST /saas/integrations/:connectionId/test`
  Run live health check.
- `GET /saas/integrations/health`
  Dashboard summary by provider.

### Onboarding

- `GET /saas/onboarding`
  Current wizard state.
- `POST /saas/onboarding/start`
- `POST /saas/onboarding/workspace`
- `POST /saas/onboarding/wordpress`
- `POST /saas/onboarding/providers`
- `POST /saas/onboarding/first-job`
- `POST /saas/onboarding/review`
- `POST /saas/onboarding/schedule`
- `POST /saas/onboarding/complete`

### Worker callback routes

These are internal and authenticated with a service token.

- `POST /saas/internal/jobs/:jobId/runs/:runId/status`
- `POST /saas/internal/jobs/:jobId/runs/:runId/steps`
- `POST /saas/internal/jobs/:jobId/runs/:runId/assets`
- `POST /saas/internal/integrations/health`

## 4. React screen structure

The current single-tab app in [`ui/src/App.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\App.tsx) should evolve into route-based SaaS screens.

### App shell

- `AuthLayout`
- `WorkspaceSwitcher`
- `MainNav`
- `BrandContextSwitcher`
- `NotificationsTray`

### Screens

#### `Auth`

- Sign in
- Accept invite
- Restore session

#### `OnboardingWizard`

Steps:

1. Create workspace
2. Create first brand
3. Connect WordPress
4. Connect providers
5. Create first content job
6. Review output
7. Schedule first post

#### `DashboardHome`

- Workspace summary
- Recent jobs
- Approvals waiting
- Integration health summary
- Onboarding completion state

#### `WorkspaceSettings`

- Workspace profile
- Members and roles
- Billing link
- Security and audit actions

#### `BrandSettings`

- Brand metadata
- Content defaults
- Calendar binding
- WordPress connection
- Brand assets

#### `JobsList`

- Status filters
- Workspace/brand filters
- Retry and cancel actions
- Job health badges

#### `JobDetail`

- Job summary
- Run timeline
- Step breakdown
- Output preview
- Errors and retry CTA
- Review thread

#### `ReviewInbox`

- Pending reviews
- My assigned items
- Approve/reject/revision actions

#### `IntegrationsDashboard`

- Cards for WordPress, Stripe, Claude, ElevenLabs, Abacus
- Last test result
- Latency and error message
- Re-test action
- Brand-scoped vs workspace-scoped indicator

#### `Calendar`

- Scheduled posts by brand
- Create/edit schedule
- Show source job and review state

## 5. Node service structure

The current route folder in [`api/src/routes`](c:\Users\Mark g\Desktop\Automous Prime\api\src\routes) should be backed by services instead of route-heavy logic.

### Recommended structure

```text
api/src/
  index.js
  db/
    supabase.js
    schema.sql
  middleware/
    auth.js
    workspace.js
    roles.js
    serviceAuth.js
  routes/
    auth.js
    workspaces.js
    brands.js
    jobs.js
    reviews.js
    integrations.js
    onboarding.js
    webhooks.js
    internal.js
  services/
    auth/
      sessionService.js
      membershipService.js
    workspaces/
      workspaceService.js
      workspaceMemberService.js
    brands/
      brandService.js
      calendarService.js
    jobs/
      jobService.js
      jobRunService.js
      jobEventService.js
      jobDispatchService.js
      retryPolicyService.js
    reviews/
      reviewService.js
      revisionService.js
    integrations/
      providerConnectionService.js
      providerHealthService.js
    onboarding/
      onboardingService.js
  lib/
    errors.js
    validators.js
    enums.js
```

### Service responsibilities

- `workspaceService`
  Tenant lookup, switching, creation.
- `membershipService`
  Invitations, role assignment, seat checks.
- `jobService`
  Logical job creation and status transitions.
- `jobRunService`
  Attempt lifecycle, retries, cancellation, run history.
- `jobDispatchService`
  Outbound call to Python and callback auth.
- `reviewService`
  Comment, approve, reject, request revision.
- `providerHealthService`
  Persist health checks and aggregate dashboard summaries.
- `onboardingService`
  Wizard state machine and completion tracking.

## 6. Python hooks if needed

Python should expose worker hooks instead of carrying tenant logic.

### Required hooks

In [`dashboard/api.py`](c:\Users\Mark g\Desktop\Automous Prime\dashboard\api.py):

- Accept `job_id`, `job_run_id`, `workspace_id`, `brand_id`.
- Include these IDs in all pipeline and step events.
- Add callback client to Node SaaS API for:
  - run started
  - step started
  - step completed
  - step failed
  - asset created
  - run completed
  - run failed
  - run canceled

### Recommended Python modules

```text
core/
  saas_callback_client.py
  execution_context.py
  provider_health.py
  retry_hooks.py
```

### Python responsibilities

- Report runtime state back to Node.
- Run provider probes for services only Python can realistically validate at runtime.
- Respect cancellation requests from Node.
- Return structured errors per step so React can show actionable failure states.

### Provider health checks to implement

- WordPress: authenticated `users/me` or post draft probe.
- Stripe: lightweight API auth check if Python uses it directly, otherwise Node-owned.
- Claude: model list or lightweight request.
- ElevenLabs: model or voices endpoint.
- Abacus: chat completion smoke test.
- Configured services: generic ping metadata plus latest error.

## 7. First pass code plan

### Pass 1: data and tenancy

- Expand schema for workspaces, membership roles, provider connections, jobs, job runs, job events, and reviews.
- Replace `viewer` with `reviewer`, and add `admin`.
- Add workspace-aware middleware to Node.
- Make all existing brand and job routes workspace scoped.

### Pass 2: canonical job lifecycle

- Split `jobs` into logical job plus run history.
- Add status enum support for `queued`, `running`, `completed`, `failed`, `retrying`, `canceled`.
- Add Node callback endpoints for Python status updates.
- Update job list and detail responses for step-level history.

### Pass 3: approvals and revisions

- Add review thread tables and APIs.
- Add UI for comments, approve, reject, request revision.
- Route revision requests into new `job_run` records.

### Pass 4: integration health

- Add provider connection CRUD.
- Add health check execution path.
- Build integrations dashboard in React.

### Pass 5: onboarding

- Convert current onboarding into a persisted wizard.
- Save step progress server-side.
- Implement first-job -> review -> first-schedule happy path.

### Pass 6: UX hardening

- Add route guards by role and onboarding state.
- Add empty states, error states, and retry buttons.
- Add audit/event timeline to job detail.

## 8. Recommended order of implementation

1. Schema migration and enum cleanup
   Current schema and routes already overlap with this work, so this removes future rework first.
2. Workspace-aware auth and RBAC
   Everything else depends on correct tenant and role resolution.
3. Canonical job/job_run model plus Python callbacks
   Status reliability is the trust foundation for the product.
4. Retry and cancel flows
   Users need recoverability before deeper workflow polish.
5. Review thread and revision requests
   This closes the loop between generated output and human approval.
6. Integration connection model and health dashboard
   This makes provider readiness visible and debuggable.
7. Persisted onboarding wizard
   Build this after the underlying workspace, providers, jobs, review, and scheduling pieces exist.
8. Final UI consolidation and cleanup
   Replace current mixed `/api` and `/saas` onboarding/account flow with one consistent SaaS shell.

## Notes on current codebase fit

- [`api/src/routes/orgs.js`](c:\Users\Mark g\Desktop\Automous Prime\api\src\routes\orgs.js) is the right base for `workspaces`, but roles need to expand to `owner`, `admin`, `editor`, `reviewer`.
- [`api/src/routes/jobs.js`](c:\Users\Mark g\Desktop\Automous Prime\api\src\routes\jobs.js) should stop treating one row as both job and attempt.
- [`api/src/routes/brands.js`](c:\Users\Mark g\Desktop\Automous Prime\api\src\routes\brands.js) is already close to Phase 1 brand separation, but it needs stronger workspace scoping and connection IDs instead of storing secrets directly on the brand row.
- [`dashboard/api.py`](c:\Users\Mark g\Desktop\Automous Prime\dashboard\api.py) already has service test endpoints and pipeline execution hooks; it should become the execution worker plus health probe layer.
- [`ui/src/components/OnboardingFlow.tsx`](c:\Users\Mark g\Desktop\Automous Prime\ui\src\components\OnboardingFlow.tsx) should be upgraded from local first-run UX to a persisted server-backed wizard.

## Minimum viable Phase 1 definition of done

- A user can sign in, create a workspace, invite teammates, and assign roles.
- A workspace can hold multiple brands with isolated settings, calendars, and provider connections.
- Every job has a visible status, run history, failure reason, retry action, and cancel action.
- Reviewers can comment, approve, reject, or request revision with notes.
- The app shows health state for WordPress, Stripe, Claude, ElevenLabs, Abacus, and any configured service.
- A new user can complete onboarding from workspace creation to first scheduled post without using raw settings screens.
