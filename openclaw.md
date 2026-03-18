# OpenClaw System Instructions

OpenClaw is the workflow brain of Autonomous Prime.
It orchestrates 5 specialized agents to run an end-to-end AI content business.

## Architecture

```
main.py
  └─ OpenClaw (core/orchestrator.py)
       ├─ TaskQueue     — Priority async queue, workload balancing
       ├─ Router        — Agent selection by capability + performance score
       ├─ EventBus      — Pub/sub for agent ↔ dashboard communication
       ├─ LLMClient     — Claude API (cloud) + Ollama (local) unified wrapper
       ├─ PerformanceOptimizer — Monitors metrics, emits recommendations
       └─ 5 Agents
            ├─ ContentAgent     — SEO blog posts (Claude / Ollama)
            ├─ ImageAgent       — ComfyUI SDXL image generation
            ├─ VoiceAgent       — Coqui TTS narration
            ├─ VideoAgent       — FFmpeg caption assembly
            └─ DistributionAgent — WordPress + social + revenue DB
```

## Full Pipeline Flow

```
Topic + Keywords
     │
     ▼
[content_agent]  blog_post task
     │  result: filepath, slug, title
     ├──────────────────────────────────┐
     ▼                                  ▼
[image_agent]                    [voice_agent]
image_gen task                   tts task
result: image filepath           result: audio filepath
     │                                  │
     └──────────────┬───────────────────┘
                    ▼
              [video_agent]
              video_caption task
              result: video filepath
                    │
                    ▼
          [distribution_agent]
          post_content task
          → WordPress publish
          → Social media snippet
          → Revenue event logged
```

## Task Types & Agent Map

| Task Type          | Agent               |
|--------------------|---------------------|
| `blog_post`        | content_agent       |
| `seo_research`     | content_agent       |
| `image_gen`        | image_agent         |
| `image_variation`  | image_agent         |
| `tts`              | voice_agent         |
| `voice_clone`      | voice_agent         |
| `video_caption`    | video_agent         |
| `video_assemble`   | video_agent         |
| `post_content`     | distribution_agent  |
| `social_post`      | distribution_agent  |
| `financial_report` | distribution_agent  |

## Environment Variables

See `.env.example` for all configuration options.
Key variables:
- `ANTHROPIC_API_KEY` — Claude API key
- `OLLAMA_BASE_URL` — Local LLM (fallback)
- `COMFYUI_URL` — Image generation
- `COQUI_URL` — Text-to-speech
- `WP_URL` / `WP_USER` / `WP_APP_PASSWORD` — WordPress publishing
- `DASHBOARD_PORT` — Web dashboard (default 8000)

## Starting the System

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start everything (orchestrator + dashboard + scheduler)
python main.py run

# Submit a one-shot pipeline
python main.py pipeline "AI tools for freelancers" -k "ai tools,freelance software"

# Check status
python main.py status
```

## Dashboard

Access at `http://localhost:8000`

- Real-time agent load and task queue via WebSocket
- Revenue tracking dashboard
- One-click pipeline launcher
- Performance optimizer recommendations
- Recent event log

## Optimization Loop

The PerformanceOptimizer runs every 5 minutes:
1. Evaluates each agent's success rate and avg task time
2. Detects queue depth spikes
3. Emits recommendations to dashboard and logs
4. Router scores = success_rate × (1 / (1 + current_load))
   → Higher scoring agents get tasks preferentially
