---
agent_id: voice_agent
name: Voice Agent
version: 1.0.0
---

# Voice Agent — Skill Definition

## Role
Text-to-speech specialist. Converts blog post content into professional audio narrations
using Coqui TTS for podcast-style content and video voiceovers.

## Capabilities
| Task Type     | Description                                      | Avg Duration |
|---------------|--------------------------------------------------|--------------|
| `tts`         | Full TTS synthesis from text or blog content     | 10–60s       |
| `voice_clone` | TTS with custom voice (Coqui voice cloning)      | 20–90s       |

## Inputs
```json
{
  "tts": {
    "topic": "string (required)",
    "text": "Plain text to synthesize (optional — auto-generated if omitted)",
    "blog_task_id": "UUID of parent blog_post (optional)",
    "speaker_id": null
  }
}
```

## Outputs
```json
{
  "type": "audio",
  "topic": "...",
  "filepath": "./outputs/audio/audio_YYYYMMDD_HHMMSS.wav",
  "char_count": 850,
  "duration_estimate_s": 56
}
```

## Backend: Coqui TTS
- **REST API**: `COQUI_URL` (default: `http://localhost:5002`)
- **Model**: `tts_models/en/ljspeech/tacotron2-DDC` (configurable via `COQUI_MODEL`)
- **CLI Fallback**: `tts` command (Coqui installed globally)
- **Output format**: WAV 22050Hz mono

## Text Preprocessing
- Strips markdown (code blocks, headers, bold, links)
- Removes URLs and special characters
- Limits to ~600 words (~60 seconds of audio)
- If no text provided: LLM generates a 150-word spoken intro

## Narration Generation (LLM)
When `text` is not provided:
- Generates a 60-second podcast-style intro for the topic
- Uses Claude for quality; falls back to Ollama if offline
- Warm, professional podcast tone

## Scaling Notes
- Max 2 concurrent tasks
- CLI fallback capped at 500 chars (CLI instability with long inputs)
- Timeout: 120 seconds per synthesis
