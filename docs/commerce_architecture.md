# Autonomous Prime Commerce Architecture

## Architecture Overview

- Frontend: React dashboard in `ui/`
- Commerce backend: Node.js + TypeScript service in `services/commerce-api/`
- AI and automation: Python orchestrator and FastAPI dashboard in `core/`, `agents/`, and `dashboard/`

The Python app remains the main operator surface. Commerce runs as a modular Node service so CTA rendering, Stripe checkout, webhooks, and attribution stay isolated from agent execution concerns.

## System Flow

1. Content pipeline generates article, social copy, video assets, and metadata in Python.
2. Review queue edits CTA text, link, type, landing page, and offer before approval.
3. Python dashboard proxies CTA preview, checkout, and revenue calls to the Node commerce service.
4. Landing page CTA click records an attribution event.
5. Node creates the Stripe Checkout Session with post, platform, CTA, landing page, and offer metadata.
6. Stripe sends webhook events for products, prices, and completed payments.
7. Node stores revenue and attribution events in SQLite.
8. React dashboard reads revenue analytics and CTA variants through the Python proxy.

## Database Schema

Core tables in `services/commerce-api/sql/schema.sql`:

- `stripe_products`
- `stripe_prices`
- `offers`
- `landing_pages`
- `post_ctas`
- `attribution_events`
- `revenue_events`

Primary attribution keys:

- `post_id`
- `platform`
- `cta_id`
- `landing_page_id`
- `offer_id`

## API Routes

### Python proxy routes

- `POST /api/commerce/cta/preview`
- `POST /api/commerce/checkout-session`
- `GET /api/commerce/revenue`

### Node commerce routes

- `POST /api/ctas/preview`
- `POST /api/ctas`
- `GET /api/ctas`
- `GET /api/catalog/offers`
- `POST /api/catalog/offers`
- `GET /api/catalog/landing-pages`
- `POST /api/catalog/landing-pages`
- `GET /api/catalog/stripe/products`
- `GET /api/catalog/stripe/prices`
- `POST /api/track/click`
- `GET /api/track/events`
- `POST /api/stripe/checkout-session`
- `POST /api/stripe/webhook`
- `GET /api/revenue/summary`
- `GET /api/revenue/timeline`

## React Component Structure

- `CommercePanel.tsx`
  - CTA Manager
  - CTA Preview
  - Offer + Landing Page linking
  - Stripe Checkout launcher
  - Revenue attribution snapshot

## Node Service Structure

- `src/server.ts`
- `src/config.ts`
- `src/lib/db.ts`
- `src/lib/cta.ts`
- `src/lib/ids.ts`
- `src/routes/ctas.ts`
- `src/routes/catalog.ts`
- `src/routes/attribution.ts`
- `src/routes/stripe.ts`
- `src/routes/revenue.ts`

## Python Hooks

- `core/commerce_client.py` provides outbound calls to the Node commerce service.
- `dashboard/api.py` exposes those actions to the React app under `/api/commerce/*`.

## First Pass Scope

Implemented in this pass:

- platform-aware CTA preview logic
- CTA persistence endpoints
- Stripe checkout session creation
- Stripe webhook ingestion for products, prices, and completed payments
- revenue summary endpoint
- attribution click tracking
- React commerce tab and Python proxy

Still to layer on later:

- review-queue inline CTA editing for each approval item
- landing-page renderer with direct checkout links
- deeper offer selection in the automated content pipeline
