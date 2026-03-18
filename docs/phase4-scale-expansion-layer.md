# Phase 4: Scale And Expansion Layer

## 1. Phase 4 architecture

Phase 4 extends the current product without changing the core workflow.

- `api/`
  - owns workspace analytics, template storage, client portal permissions, branding settings, and optimization suggestions
  - remains the system of record for tenant-scoped extension features
- `ui/`
  - adds four additive surfaces:
    - analytics
    - templates
    - client portal
    - branding
  - keeps jobs, approvals, queue, monetization, and planner flows intact
- `Python agents`
  - continue to execute content and publishing workflows
  - Phase 4 suggestion engine is heuristic first-pass in Node, but structured so Python/LLM scoring can replace or enrich it later
- `services/commerce-api/`
  - remains responsible for monetization attribution already added in Phase 3
  - analytics UI can combine workspace analytics with CTA and revenue analytics from commerce

## 2. Database additions

Added to [schema.sql](C:/Users/Mark%20g/Desktop/Automous%20Prime/api/src/db/schema.sql):

- `content_templates`
  - reusable templates for:
    - blog posts
    - YouTube descriptions
    - TikTok scripts
    - CTA blocks
    - landing pages
    - workflow presets
    - content presets
- `client_portal_configs`
  - workspace-level portal settings
  - controls approvals, calendar, reports, theme, slug
- `client_portal_permissions`
  - per-client member visibility by brand and report scope
- `workspace_branding`
  - white-label readiness settings
  - brand name, logo, favicon, theme, custom domain metadata, CSS tokens
- `optimization_suggestions`
  - persisted AI/heuristic recommendations for CTA, titles, assets, approvals, scheduling, and quality

Core schema update:

- `org_members.role`
  - now allows `client`

## 3. API routes

Analytics

- `GET /saas/analytics/overview`
  - job success rates
  - approval turnaround
  - platform activity
  - publish attempt totals
  - content throughput
  - quality signal summary

Templates

- `GET /saas/templates`
  - list workspace templates plus system templates
- `GET /saas/templates/library`
  - system marketplace/internal library
- `POST /saas/templates`
  - create workspace template
- `PATCH /saas/templates/:id`
  - update workspace template
- `POST /saas/templates/:id/duplicate`
  - copy a system or workspace template into the workspace library

Client portal

- `GET /saas/client-portal/settings`
- `POST /saas/client-portal/settings`
- `GET /saas/client-portal/clients`
- `POST /saas/client-portal/clients`
- `PATCH /saas/client-portal/clients/:memberId`
- `GET /saas/client-portal/overview`

White label readiness

- `GET /saas/white-label`
- `POST /saas/white-label`

Optimization suggestions

- `GET /saas/suggestions`
- `POST /saas/suggestions/run-scan`
- `POST /saas/suggestions/:id/status`

## 4. UX structure

New sidebar surfaces:

- `Analytics`
  - performance overview
  - throughput charts
  - platform activity
  - CTA performance crossover from commerce analytics
  - AI suggestions list
- `Templates`
  - create workspace templates
  - browse workspace library
  - copy from system marketplace/internal library
- `Client Portal`
  - agency-side settings and invites
  - client-side limited view for approvals, calendar, and selected reports
- `Branding`
  - white-label readiness inputs
  - theme tokens
  - domain metadata
  - readiness checklist

Important constraint:

- the job, review, queue, publish, and planner flows are unchanged
- Phase 4 only adds read, reuse, and scoped-access layers around them

## 5. AI suggestion logic

First-pass suggestion engine lives in [optimizationSuggestions.js](C:/Users/Mark%20g/Desktop/Automous%20Prime/api/src/services/optimizationSuggestions.js).

Current logic is heuristic and persistent:

- `missing_cta`
  - publish target has no CTA label or link
- `weak_title`
  - title missing, too short, too long, or poorly cased
- `missing_assets`
  - video path without a linked video asset
  - non-video path with no linked image asset
- `schedule_gap`
  - publish target not scheduled
  - workspace has no scheduled content at all
- `approval_bottleneck`
  - review pending longer than 24 hours

This is intentionally structured to evolve into a hybrid engine:

- heuristics for deterministic checks
- Python/LLM scoring for quality, clarity, title rewrites, CTA suggestions, and content improvement prompts

## 6. White label preparation plan

This pass prepares white-labeling without turning it on platform-wide.

Prepared now:

- per-workspace branding record
- logo and favicon URLs
- app label and brand name
- primary and accent color storage
- custom CSS token storage
- custom domain metadata and status
- support contact metadata
- client portal theme payload

Deferred intentionally:

- custom domain routing
- tenant-aware static asset hosting
- branded auth pages
- workspace-specific outbound email skins
- fully separate branded client-facing frontend

This keeps the system ready for branded experiences without destabilizing the current app shell.

## 7. First pass code plan

Implemented in this pass:

- additive schema for templates, client portal, branding, and suggestions
- analytics aggregation route
- system template library plus workspace templates
- client portal settings, membership, and scoped overview
- white-label readiness settings route
- heuristic suggestion generation and status management
- React panels for analytics, templates, client portal, and branding

Next expansion slice:

- connect template usage to job creation and planner defaults
- add template usage counters and “apply template” actions inside job/publish forms
- allow client comments and approval actions directly from the portal
- move suggestion scoring for title and quality improvements into Python/LLM-assisted evaluation
- enforce plan-based access for client portal and branding features if desired
- activate domain verification and branded asset delivery when ready
