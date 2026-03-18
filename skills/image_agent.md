---
agent_id: image_agent
name: Image Agent
version: 1.0.0
---

# Image Agent — Skill Definition

## Role
AI image generation specialist. Creates professional hero images for blog posts and
social media content using ComfyUI (SDXL) with LLM-crafted prompts.

## Capabilities
| Task Type         | Description                                        | Avg Duration |
|-------------------|----------------------------------------------------|--------------|
| `image_gen`       | Full image generation via ComfyUI + SDXL           | 30–180s      |
| `image_variation` | Generate variation of existing image (same prompt) | 30–120s      |

## Inputs
```json
{
  "image_gen": {
    "topic": "string (required)",
    "style": "professional editorial|cinematic|flat design (optional)",
    "blog_task_id": "uuid of parent blog_post task (optional)"
  }
}
```

## Outputs
```json
{
  "type": "image",
  "topic": "...",
  "filepath": "./outputs/images/filename.png",
  "filename": "prime_YYYYMMDD_HHMMSS.png",
  "sd_prompt": "Full Stable Diffusion prompt used",
  "source": "comfyui|placeholder"
}
```

## Backend: ComfyUI
- **Endpoint**: `COMFYUI_URL` (default: `http://localhost:8188`)
- **Model**: SDXL Base 1.0 (`sd_xl_base_1.0.safetensors`)
- **Resolution**: 1024×576 (16:9 widescreen for web/video)
- **Sampler**: DPM++ 2M Karras, 30 steps, CFG 7.5
- **Polling**: Every 2s, max 4 minutes

## Prompt Engineering
- LLM generates SD prompt from topic + style directive
- System prompt enforces: lighting, composition, color palette, mood, subject detail
- Negative prompt: blurry, watermark, text, NSFW

## Fallback Behavior
- If ComfyUI is offline → PIL-generated placeholder (1200×630, dark gradient + text)
- If PIL unavailable → empty stub file
- Result always includes `"source"` field indicating origin

## Scaling Notes
- Max 2 concurrent (GPU memory constrained)
- Long-running tasks (up to 3min); queue depth managed by OpenClaw
