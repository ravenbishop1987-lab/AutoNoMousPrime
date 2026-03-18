# Phase 3: Monetization And Plan Gating Layer

## 1. Phase 3 architecture

Phase 3 is split across the existing service boundaries:

- `api/`
  - Workspace billing, Stripe subscription visibility, and plan enforcement.
  - Source of truth for SaaS entitlements: content jobs, voice minutes, video jobs, brands, connected sites, and team members.
  - Publishes monetization-aware metadata into `publish_targets`.
- `services/commerce-api/`
  - Offer-side monetization analytics and attribution.
  - Tracks revenue by offer, landing page, CTA, post, and platform.
  - Tracks offer subscription lifecycle and failed payment state from Stripe webhooks.
- `ui/`
  - Billing panel shows active subscription, billing health, cancel state, failed-payment state, and plan usage.
  - Revenue panel shows monetization dashboards, CTA conversion reporting, landing-page sales, and subscription state.
  - Social planner supports linked offer, CTA, landing page, and expected revenue path.
- `Python dashboard + agents`
  - Continue to own scheduling and execution.
  - Planner payload now carries monetization path metadata without changing the scheduler contract.

## 2. Database schema updates

Supabase (`api/src/db/schema.sql`)

- `subscriptions`
  - add `current_period_start`
- `billing_state_events`
  - new subscription/billing event log for Stripe lifecycle visibility
- `revenue_events`
  - add attribution fields: `post_id`, `platform`, `cta_id`, `landing_page_id`, `offer_id`
  - add Stripe references: `stripe_event_id`, `stripe_invoice_id`, `stripe_customer_id`, `stripe_subscription_id`
  - add `currency`, `metadata`
- `publish_targets`
  - add monetization path fields: `offer_id`, `offer_name`, `cta_id`, `landing_page_id`, `landing_page_url`
  - add `expected_revenue_cents`, `monetization_path`

Commerce SQLite (`services/commerce-api/sql/schema.sql`)

- `post_ctas`
  - add `variant_label`
- `attribution_events`
  - add `metadata_json`
- `revenue_events`
  - add `description`, `stripe_customer_id`, `stripe_subscription_id`, `metadata_json`
- `subscription_events`
  - new table for tracked customer subscription state, billing state, and failed payment events

## 3. Stripe related API routes

Workspace billing (`api/`)

- `GET /saas/billing/status`
  - returns plan, expanded entitlements, usage, subscription state, billing status
- `POST /saas/billing/checkout`
  - create hosted subscription checkout
- `POST /saas/billing/portal`
  - open Stripe customer portal
- `POST /saas/billing/change-plan`
  - swap active price
- `POST /saas/billing/cancel`
  - cancel at period end
- `POST /saas/webhooks/stripe`
  - sync plan tier, subscription status, billing state events, and subscription payment revenue

Offer monetization (`services/commerce-api/`)

- `POST /api/stripe/checkout-session`
  - create monetized offer checkout sessions with attribution metadata
- `POST /api/stripe/webhook`
  - sync Stripe products/prices
  - record offer purchases
  - record offer subscription state and failed payment events

## 4. Revenue tracking logic

- Checkout creation persists `checkout_started` attribution with `post_id`, `platform`, `cta_id`, `landing_page_id`, and `offer_id`.
- Stripe `checkout.session.completed` persists:
  - `revenue_events`
  - `purchase` attribution events
  - subscription events when checkout mode is `subscription`
- Stripe subscription and invoice events persist:
  - current subscription state
  - billing state
  - failed payment count
- Revenue dashboards aggregate:
  - revenue by offer
  - revenue by landing page
  - revenue by CTA variant
  - revenue by post
  - revenue by platform
  - recent revenue events
  - subscription state summary

## 5. Plan gating logic

Centralized in `api/src/lib/planConfig.js` and `api/src/middleware/planGuard.js`.

- Starter
  - 30 content jobs
  - 0 voice minutes
  - 0 video jobs
  - 1 brand
  - 1 connected site
  - 1 team member
- Pro
  - 100 content jobs
  - 180 voice minutes
  - 20 video jobs
  - 3 brands
  - 3 connected sites
  - 3 team members
- Agency
  - unlimited content jobs
  - unlimited voice minutes
  - unlimited video jobs
  - 10 brands
  - 10 connected sites
  - 10 team members

Enforced on:

- job creation
- job retry
- review-requested reruns
- brand creation
- workspace member invites
- WordPress and CMS connection creation

Usage is derived from live data:

- content jobs: `orgs.jobs_used_this_month`
- voice minutes: audio asset duration in current billing window
- video jobs: jobs flagged as video in current billing window
- brands: `brands`
- connected sites: brand WordPress URLs + connected CMS integrations
- team members: non-revoked `org_members`

## 6. Dashboard screen structure

Billing screen

- current plan card
- subscription state badges
- billing window
- entitlement usage rows
- upgrade/change-plan cards

Revenue screen

- top-line cards: revenue, orders, CTA clicks, visit-to-sale rate
- revenue timeline
- revenue by offer
- revenue by platform
- CTA variant performance table
- landing page conversion table
- subscription state summary
- recent revenue events

Planner surfaces

- planner override form includes:
  - linked offer
  - CTA variant
  - landing page
  - expected revenue
- internal planner cards show the monetization path alongside scheduled content
- job publish target details now surface linked monetization metadata

## 7. First pass code plan

Completed in this pass

- central plan config and usage summarization
- expanded billing status payload and UI
- plan guards for jobs, sites, and seats
- monetization schema extensions
- Stripe webhook enrichment for subscription-state reporting
- revenue summary expansion for offers, CTAs, landing pages, posts, platforms, and subscription states
- planner metadata fields in the UI

Next implementation slice

- add explicit migration scripts instead of schema-only updates
- backfill older commerce events into `subscription_events`
- expose a dedicated SaaS monetization route if the workspace dashboard should stop proxying through Python
- attach planner monetization metadata directly to Supabase scheduling records when the scheduler is moved off SQLite
