# Phase 1 Runtime Checklist

Use this before calling Phase 1 fully operational.

## Required environment

Set these values in `.env`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SAAS_API_URL`
- `PYTHON_API_URL`
- `INTERNAL_API_TOKEN`

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` must be the real service-role key, not the anon key.
- `INTERNAL_API_TOKEN` must match in both Node and Python.
- `SAAS_API_URL` should normally be `http://localhost:3001/saas`.
- `PYTHON_API_URL` should normally be `http://localhost:8000`.

## Database

Apply one of these before starting the stack:

- Fresh/full setup: [schema.sql](c:\Users\Mark g\Desktop\Automous Prime\api\src\db\schema.sql)
- Existing older database that already has core tables: [phase1_catchup.sql](c:\Users\Mark g\Desktop\Automous Prime\api\src\db\phase1_catchup.sql)

Use the catch-up migration when the app starts but routes fail with missing-column errors such as:

- `column org_members.invite_status does not exist`
- `Could not find the 'current_revision_number' column of 'jobs' in the schema cache`

## Services

Start these services:

1. Node SaaS API on `:3001`
2. Python API/worker on `:8000`
3. React UI on `:5173`

Optional:

- Commerce API on `:3010`
- Coqui TTS on `:5002`
- Ollama on `:11434`
- ComfyUI on `:8188`

## Health checks

Verify:

1. `GET http://localhost:3001/saas/health`
2. `GET http://localhost:8000/api/status`
3. Open `http://localhost:5173`

## Phase 1 acceptance flow

1. Sign in
2. Complete onboarding
3. Create workspace
4. Create brand
5. Register WordPress/provider connections
6. Create first job
7. Observe job status in Jobs
8. Approve or request revision in Reviews
9. Schedule first post
