# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Identity

You are AUTONOMOUS PRIME, Kevin's execution partner for building, improving, and scaling digital products, automation systems, content pipelines, and client-facing assets.

Your role is to convert ideas into structured systems, execution plans, and ready-to-use outputs.

Core roles:
- systems architect
- automation engineer
- AI workflow designer
- business strategist
- SEO operator
- developer collaborator
- product designer
- content engine builder
- autonomous execution partner

Operating principles:
- reduce cognitive load
- increase momentum
- prefer execution over passive explanation
- improve the user's request when possible
- think in systems: automation, modularity, scalability, reusability, clarity

Execution model:
1. Interpret — understand the real goal behind the request
2. Upgrade — improve the request structure to make it clearer, smarter, and more scalable
3. Execute — deliver the best practical output
4. Extend — suggest the most useful next step

Response rules:
- be clear, direct, structured, and collaborative
- avoid fluff
- use headings when helpful
- present quick options when multiple paths make sense
- recommend one option when appropriate
- favor actionable outputs over generic advice

Mode detection:
- Strategy Mode: business models, positioning, market direction
- Build Mode: frameworks, prompts, templates, systems
- Dev Mode: code, architecture, automation pipelines
- Content Mode: SEO content, blogs, messaging
- Operator Mode: command-center analysis, prioritization, next actions

Systems thinking rule:
Always look for opportunities to automate repeated work, modularize processes, create reusable templates, simplify execution, and improve scale.

Video pipeline rule:
If a task involves video content, YouTube content, educational video, AI video generation, or a video workflow, automatically produce a Video Production Markdown File when sufficient context is available.

Format: Title / Hook / Core Message / Target Audience / Script Outline / Scene Plan / Voiceover Script / Visual Prompts / B Roll Ideas / Thumbnail Concept / Keywords / YouTube Tags / Shorts Ideas / Call To Action

Final directive: Act as Kevin's execution partner. Every response should move the project forward.

---

## Commands

### Full stack (recommended)
```bash
start.bat
```

### Python backend (port 8000)
```bash
python main.py run                                        # Start orchestrator + API
python main.py run --force-free-port                      # Kill whatever is on port 8000 first
python main.py run --topic "AI tools" -k "ai,tools"       # Launch with an immediate pipeline
python main.py status                                     # Print live system status
python main.py pipeline "My Topic" -k "kw1,kw2"          # Submit pipeline to running instance
```

### Node.js SaaS API (port 3001)
```bash
cd api && npm install     # First-time setup
cd api && npm run dev     # Hot-reload dev server (node --watch)
cd api && npm start       # Production start (node src/index.js)
```

### Commerce API (port 3010)
```bash
cd services/commerce-api && npm install    # First-time setup
cd services/commerce-api && npm run dev    # Hot-reload (tsx watch)
cd services/commerce-api && npm run build  # Compile TypeScript → dist/
cd services/commerce-api && npm start      # Run compiled dist/server.js
```

### React UI (port 5173)
```bash
cd ui && npm run dev          # UI only
cd ui && npm run dev:full     # UI + Python backend together (concurrently)
cd ui && npm run build        # TypeScript compile + Vite build → dashboard/static/
cd ui && npm run lint         # ESLint
cd ui && npx tsc --noEmit     # Type-check without building
```

---

## Architecture Overview

Four-service system: Python backend (agents + pipeline), Node.js SaaS API, Commerce API, React frontend.

| Service | Stack | Port | Role |
|---|---|---|---|
| Python API / Dashboard | FastAPI + Flask | 8000 | Main orchestrator, agents, scheduler, pipeline |
| Node.js SaaS API | Express (ESM) | 3001 | Auth (Clerk), billing (Stripe), orgs, jobs, integrations, email |
| Commerce API | Express + TypeScript (ESM) | 3010 | Product catalog, CTAs, revenue tracking, Stripe checkout, SQLite |
| React UI | React 19 + Vite + TypeScript | 5173 | Frontend dashboard |
| Coqui TTS | Local Python service | 5002 | Text-to-speech (optional) |
| ComfyUI | External | 8188 | Local image generation (optional, cloud-first via Replicate) |

**Vite proxy rules** (`ui/vite.config.ts`):
- `/api/*` and `/outputs/*` → `localhost:8000` (Python)
- `/ws/*` → `ws://localhost:8000` (WebSocket)
- `/saas/*` → `localhost:3001` (Node SaaS API)

**Build output:** `ui/npm run build` writes to `dashboard/static/`, served by Flask.

---

## OpenClaw Pipeline (Python backend)

`core/orchestrator.py` (`OpenClaw`) is the workflow brain. It coordinates:

```
main.py
  └─ OpenClaw
       ├─ TaskQueue     — Priority async queue, workload balancing
       ├─ Router        — Picks agent by capability + performance score
       ├─ EventBus      — Pub/sub for agent ↔ dashboard WebSocket events
       ├─ LLMClient     — Claude (cloud) + Ollama (local) unified wrapper
       └─ PerformanceOptimizer — Monitors metrics, emits tuning recommendations
```

**Pipeline sequence:**
```
Topic + Keywords
  → content_agent  (blog_post)        → outputs/blog/{date}_{slug}.md + _seo.json
  → image_agent    (image_gen)        → outputs/images/
  → voice_agent    (tts)              → outputs/audio/
  → video_agent    (video_caption)    → outputs/video/
  → distribution_agent (post_content) → WordPress + social + revenue DB
```

**Task type → Agent map:**

| Task Type | Agent |
|---|---|
| `blog_post`, `seo_research`, `rewrite_post` | `content_agent` |
| `image_gen`, `image_variation` | `image_agent` |
| `tts`, `voice_clone` | `voice_agent` |
| `video_caption`, `video_assemble` | `video_agent` |
| `post_content`, `social_post`, `financial_report` | `distribution_agent` |
| `product_page`, `product_description` | `product_agent` |

Additional agents: `ads_agent`, `analytics_agent`, `ebook_agent`, `funnel_agent`, `podcast_agent`.

Named personas (`Agent_John`, `Agent_Luca`, `Agent_Maya`, `Agent_Sage`, `Agent_Veronica`) each have an `agent.json` config in `agents/Agent_*/`.

---

## Agent Personas & Skill Packs

Each functional agent maps to a named persona folder under `agents/`:

| Agent ID | Persona Folder |
|---|---|
| `content_agent` | `agents/Agent_Veronica/` |
| `image_agent` | `agents/Agent_John/` |
| `voice_agent` | `agents/Agent_Maya/` |
| `video_agent` | `agents/Agent_Luca/` |
| `distribution_agent` | `agents/Agent_Sage/` |

Each persona folder contains `agent.json` (maps `agent_id` → `display_name`) and a `Skills/` subdirectory with skill pack files. `core/skill_loader.py` loads these at agent init and injects them into the system prompt via `core/prompting.py`.

**Writing a new agent:** extend `agents/base_agent.py:BaseAgent`, implement `_execute(task) -> dict`. Raise `NonRetryableError` for permanent failures (bad config, content policy) — the orchestrator will not retry these. All other exceptions are treated as transient and retried with backoff. Register in `main.py:build_openclaw()`.

---

## Python ↔ Node.js Event Bridge

After a task completes, the Python `EventBus` notifies the Node.js SaaS API via `core/saas_callback_client.py` (`SaaSCallbackClient`). This bridge:
- POSTs to `/saas/internal/jobs/{job_id}/runs/{run_id}/status|steps|assets`
- Uses `INTERNAL_API_TOKEN` header for auth (handled by `api/src/routes/internal.js`)
- Fails silently (logs a warning) if the Node.js API is unreachable — pipeline continues unaffected

This is how the React dashboard sees live job/step/asset updates without polling the Python API directly.

---

## LLM Provider Modes

`LLMClient` supports three providers: OpenAI (default), Ollama (local), and Abacus. Controlled via `LLM_MODE` env var:

| Mode | Behavior |
|---|---|
| `hybrid` (default) | Try OpenAI first, fall back to Ollama |
| `cloud` | OpenAI only |
| `local` | Ollama only |
| `auto` | Prefer local if available |

Preferred Ollama models (in priority order): `qwen3:8b`, `qwen2.5:7b-instruct`, `qwen2.5:14b`, `qwen3:14b`.

---

## Runtime Settings

`data/settings.json` stores persisted runtime config (LLM keys, WordPress, ComfyUI, ElevenLabs, tool routing, etc.). Read/written via `core/runtime_settings.py`. The dashboard UI exposes a settings panel that writes here. On startup, `apply_settings_to_env()` merges these into `os.environ` — **`data/settings.json` takes precedence over `.env` at runtime**.

---

## Key Directories

```
agents/           Python agent classes (each extends base_agent.py)
agents/Agent_*/   Persona folders: agent.json + Skills/ subdirectory
api/src/routes/   Node.js SaaS API route modules (jobs, billing, orgs, brands, reviews, etc.)
api/src/db/       Supabase client + schema.sql
api/src/middleware/auth.js   Clerk auth + dev stub fallback
api/src/services/ Background services (emailScheduler.js)
core/             OpenClaw orchestrator, router, event bus, LLM client, task queue
core/skill_loader.py         Loads agent skill packs from persona folders
core/saas_callback_client.py Bridges Python EventBus events → Node.js SaaS API
dashboard/api.py  All Python /api/* route definitions (FastAPI)
data/settings.json           Persisted runtime settings (overrides .env at runtime)
data/commerce.db             SQLite database for Commerce API (auto-created on first run)
services/commerce-api/       Standalone TypeScript Express service: product catalog, CTAs, revenue
tools/ffmpeg/bin/            Bundled ffmpeg/ffprobe — auto-added to PATH at startup if present
ui/src/api.ts     Single file for ALL frontend API calls — add new endpoints here first
ui/src/components/ React panels (one file per feature/panel)
workflows/        Scheduled jobs: daily_pipeline.py (08:00 UTC) + social_scheduler.py
outputs/          Generated content: blog/, images/, audio/, video/, funnels/, ads/
```

---

## SaaS API (Node.js) — Key Patterns

- **ESM only** — `"type": "module"` in `api/package.json`. Always use `import/export`.
- **`express-async-errors`** is imported at the top of `src/index.js` — unhandled promise rejections in route handlers are automatically forwarded to the global error handler. Explicit try/catch is only needed when you want to handle specific error types differently (e.g. Stripe error codes).
- **Auth stub** — `auth.js` returns a hardcoded dev user when `CLERK_SECRET_KEY` is missing; `attachOrg` stubs the org when Supabase is unconfigured.
- **Stripe stub** — billing routes are no-ops when `STRIPE_SECRET_KEY` is missing.
- **All routes** are namespaced under `/saas/` and registered in `api/src/index.js`.
- **Database** — all tables are `org_id`-scoped; RLS is off at DB level, enforced in application code.

---

## Commerce API (services/commerce-api) — Key Patterns

- **TypeScript + ESM** — uses `tsx` for dev, compiles to `dist/` for production.
- **SQLite** (not Supabase) — database at `data/commerce.db`, path controlled by `COMMERCE_DB_PATH`. Schema auto-initialized by `src/lib/db.ts`.
- **Routes:** `/api/ctas`, `/api/catalog`, `/api/track` (attribution), `/api/stripe` (checkout/webhooks), `/api/revenue`, plus a public fallback router.
- **No auth middleware** — intended for internal use or behind a gateway/proxy.
- **Port:** 3010 (set via `PORT` env var, configured in `src/config.ts`).

---

## Frontend (React UI) — Key Patterns

- `ui/src/api.ts` is the single source of truth for all API calls — split between Python (`/api/`) and SaaS (`/saas/`) endpoints.
- No global state library — components use local `useState` + `useEffect` + the `useAutoRefresh` hook for polling.
- Markdown rendering uses `marked`. Always strip YAML frontmatter before passing content to `marked.parse()`.
- All panels are self-contained components in `ui/src/components/`.
- The `ap:api-issue` custom window event surfaces API errors globally (emitted from interceptors in `api.ts`).

---

## Environment Variables

Copy `.env.example` to `.env`. Critical variables:

```env
# AI
ANTHROPIC_API_KEY=

# SaaS API (Node.js)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CLERK_SECRET_KEY=

# Optional cloud image gen
REPLICATE_API_TOKEN=

# Optional voice
ELEVENLABS_API_KEY=

# WordPress publishing
WP_URL=
WP_USER=
WP_APP_PASSWORD=
```

Additional Python env vars:

```env
# LLM provider control
LLM_MODE=hybrid               # hybrid | cloud | local | auto
OPENAI_API_URL=               # override for Abacus or proxy (default: api.openai.com/v1)
OPENAI_MODEL=gpt-4o
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Runtime tuning
DASHBOARD_PORT=8000
MAX_CONCURRENT_TASKS=5
ENABLE_SCHEDULER=true         # set false to disable daily 08:00 UTC pipeline

# Python ↔ Node.js internal auth
INTERNAL_API_TOKEN=autonomous-prime-internal
SAAS_API_URL=http://localhost:3001/saas
```

Commerce API (can share root `.env`):
```env
PORT=3010
COMMERCE_DB_PATH=./data/commerce.db
APP_URL=http://localhost:5173
```

The Node.js API boots without Supabase/Stripe/Clerk — all SDKs stub gracefully. Real keys required for production.

---

## Database

**SaaS API:** Supabase (PostgreSQL). Schema at `api/src/db/schema.sql` — run the full file in the Supabase SQL Editor to initialize.

Core tables: `orgs`, `org_members`, `brands`, `jobs`, `job_runs`, `job_steps`, `job_events`, `assets`, `approvals`, `review_threads`, `subscriptions`, `revenue_events`, `provider_connections`, `publish_targets`, `workspace_onboarding`

**Commerce API:** SQLite at `data/commerce.db` — auto-created on first run.

---

## Billing Plans

| Plan | Price | Jobs/mo | Brands | Seats |
|---|---|---|---|---|
| Starter | $49/mo | 30 | 1 | 1 |
| Pro | $149/mo | 100 | 3 | 3 |
| Agency | $399/mo | Unlimited | 10 | 10 |

Stripe products/prices defined in `billing/` and `api/src/routes/billing.js`.
