# Render Deployment

Autonomous Prime is now wired for a cleaner Render shape:

- `autonomous-prime-web`
  Public Python web service
  Serves the built React app, `/api/*`, `/ws`, and proxies `/saas/*`
- `autonomous-prime-saas`
  Private Node service for billing, workspaces, jobs, reviews, integrations, and plan gating
- `autonomous-prime-commerce`
  Private Node service for landing pages, offer catalog, CTA attribution, and revenue events

## What Changed

- The Python edge now proxies `/saas/*` to the SaaS API using `SAAS_API_URL`
- Internal service URLs now accept Render `host:port` values and auto-normalize them to `http://host:port`
- Scheduler startup is controlled by `ENABLE_SCHEDULER`
- A Render blueprint is included in [render.yaml](/c:/Users/Mark%20g/Desktop/Automous%20Prime/render.yaml)
- A Docker image is included for the public Python web service in [Dockerfile](/c:/Users/Mark%20g/Desktop/Automous%20Prime/Dockerfile)

## Required Environment Variables

Set these before expecting the stack to work fully:

- Public web service:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `COMMERCE_API_URL`
  - `SAAS_API_URL`
  - `OUTPUTS_DIR`
  - `DATA_DIR`
  - `ENABLE_SCHEDULER=false`

- SaaS API:
  - `FRONTEND_URL`
  - `PYTHON_API_URL`
  - `INTERNAL_API_TOKEN`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`

- Commerce API:
  - `APP_URL`
  - `COMMERCE_DB_PATH`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

## Important Notes

- `ENABLE_SCHEDULER` should stay `false` on the public web service unless you intentionally want the web instance to own scheduled jobs.
- `OUTPUTS_DIR` and `COMMERCE_DB_PATH` should point to mounted disks on Render.
- The `/saas` browser path no longer depends on Vite dev proxying once deployed.
- Coqui TTS is not part of the Render blueprint. Keep it local or replace it with a hosted provider first.
