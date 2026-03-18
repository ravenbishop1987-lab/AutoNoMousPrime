---
agent_id: video_agent
name: Video Agent
version: 1.0.0
---

# Video Agent — Skill Definition

## Role
Video production specialist. Assembles hero images and audio narrations into
professionally captioned MP4 videos using FFmpeg for YouTube and social platforms.

## Capabilities
| Task Type        | Description                                          | Avg Duration |
|------------------|------------------------------------------------------|--------------|
| `video_caption`  | Image + audio → captioned MP4 (burn-in subtitles)   | 15–120s      |
| `video_assemble` | Multi-image slideshow with audio and transitions     | 30–180s      |

## Inputs
```json
{
  "video_caption": {
    "topic": "string (required)",
    "image_path": "/path/to/hero.png (required)",
    "audio_path": "/path/to/narration.wav (required)",
    "captions": "Plain text captions (optional — auto-converted to SRT)",
    "image_task_id": "UUID of image task (optional)",
    "audio_task_id": "UUID of audio task (optional)"
  }
}
```

## Outputs
```json
{
  "type": "video",
  "topic": "...",
  "filepath": "./outputs/video/video_YYYYMMDD_HHMMSS.mp4",
  "image_source": "/path/to/source.png",
  "audio_source": "/path/to/source.wav"
}
```

## FFmpeg Pipeline
1. **Input**: Still image (loop) + WAV audio
2. **Scale**: `1280×720` (720p, letterboxed if needed)
3. **Codec**: H.264 (libx264) + AAC audio @ 192kbps
4. **Duration**: Matches audio length (`-shortest`)
5. **Captions**: Burned-in SRT via `subtitles=` filter
   - Font size 22, white text, black outline
6. **Output**: MP4 (yuv420p, web-compatible)

## Subtitle Generation
When plain text captions are provided:
- Auto-converted to SRT (8 words per segment, 3s per segment)
- Burned into video (not as external track)
- Styled: white text, black outline, 22pt

## Fallback
- If image or audio path missing → returns stub result with `"filepath": null`
- Downstream tasks (distribution) check for null and skip video upload

## Scaling Notes
- Max **1 concurrent** task (CPU/GPU intensive)
- FFmpeg timeout: 10 minutes
- GPU acceleration auto-detected by FFmpeg if available
