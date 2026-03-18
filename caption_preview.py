"""
Caption style preview — generates 4 sample images showing each style.
Run: python caption_preview.py
Output: caption_samples/ folder
"""
import subprocess, os, textwrap
from pathlib import Path

FFMPEG = os.getenv("FFMPEG_BIN", "ffmpeg")
OUT = Path("caption_samples")
OUT.mkdir(exist_ok=True)

SAMPLE_TEXT = "Build passive income with AI automation"
W, H = 1280, 720

STYLES = {
    "1_tiktok": {
        "label": "TikTok — Bold Impact, thick outline",
        "font": "Impact",
        "size": 72,
        "color": "white",
        "borderw": 6,
        "bordercolor": "black",
        "shadowx": 0, "shadowy": 0,
        "box": 0,
    },
    "2_youtube": {
        "label": "YouTube — White on dark box",
        "font": "Arial",
        "size": 56,
        "color": "white",
        "borderw": 0,
        "bordercolor": "black",
        "shadowx": 0, "shadowy": 0,
        "box": 1,
        "boxcolor": "black@0.6",
        "boxborderw": 14,
    },
    "3_neon_yellow": {
        "label": "Neon Yellow — High visibility",
        "font": "Arial",
        "size": 60,
        "color": "yellow",
        "borderw": 4,
        "bordercolor": "black",
        "shadowx": 2, "shadowy": 2,
        "box": 0,
    },
    "4_minimal": {
        "label": "Clean Minimal — White + soft shadow",
        "font": "Arial",
        "size": 56,
        "color": "white",
        "borderw": 2,
        "bordercolor": "black",
        "shadowx": 3, "shadowy": 3,
        "box": 0,
    },
}

for name, s in STYLES.items():
    out_file = OUT / f"{name}.png"
    dt = (
        f"drawtext=text='{SAMPLE_TEXT}':"
        f"font={s['font']}:"
        f"fontsize={s['size']}:"
        f"fontcolor={s['color']}:"
        f"borderw={s['borderw']}:"
        f"bordercolor={s['bordercolor']}:"
        f"shadowx={s.get('shadowx',0)}:"
        f"shadowy={s.get('shadowy',0)}:"
        f"x=(w-text_w)/2:"
        f"y=h-text_h-60"
    )
    if s.get("box"):
        dt += f":box=1:boxcolor={s['boxcolor']}:boxborderw={s['boxborderw']}"

    cmd = [
        FFMPEG, "-y",
        "-f", "lavfi", "-i", f"color=c=0x1a1a2e:size={W}x{H}:rate=1",
        "-vf", dt,
        "-frames:v", "1",
        str(out_file),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode == 0:
        print(f"OK  {s['label']}  ->  {out_file}")
    else:
        print(f"FAIL {name}:", result.stderr.decode()[-200:])

print(f"\nOpen the 'caption_samples' folder to compare.")
