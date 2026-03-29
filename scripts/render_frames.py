#!/usr/bin/env python3
"""
render_frames.py — Generate text-overlay PNG frames for YouTube Shorts.
Outputs unique frames + concat.txt for ffmpeg concat demuxer.
Much faster than generating every frame individually.

Usage:
  python3 render_frames.py --out-dir /path/to/frames \
    --title "My Title" --hook "Opening hook" \
    --script "Full narration text here..." \
    --cta "Subscribe now!" --duration 45
"""

import argparse
import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow", file=sys.stderr)
    sys.exit(1)

WIDTH, HEIGHT = 1080, 1920
BG_COLOR = (10, 10, 10)
ORANGE = (247, 147, 26)
WHITE = (255, 255, 255)
GREEN = (34, 197, 94)
DARK_OVERLAY = (20, 20, 20)


def get_font(size):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def wrap_text(text, font, max_width, draw):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def draw_centered_text(draw, text, font, color, y, max_width=WIDTH - 140):
    lines = wrap_text(text, font, max_width, draw)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (WIDTH - tw) // 2
        # Drop shadow
        draw.text((x + 2, y + 2), line, fill=(0, 0, 0), font=font)
        draw.text((x, y), line, fill=color, font=font)
        y += th + 12
    return y


def text_block_height(draw, text, font, max_width=WIDTH - 140):
    lines = wrap_text(text, font, max_width, draw)
    total = 0
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        total += (bbox[3] - bbox[1]) + 12
    return total


def make_frame(title, subtitle, subtitle_color, font_title, font_sub):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Subtle gradient overlay at top and bottom
    for i in range(200):
        alpha = int(40 * (1 - i / 200))
        c = (BG_COLOR[0] + alpha, BG_COLOR[1] + alpha, BG_COLOR[2] + alpha)
        draw.line([(0, i), (WIDTH, i)], fill=c)
        draw.line([(0, HEIGHT - 1 - i), (WIDTH, HEIGHT - 1 - i)], fill=c)

    # Title at top
    if title:
        draw_centered_text(draw, title, font_title, ORANGE, 240)

    # Subtitle centered
    if subtitle:
        h = text_block_height(draw, subtitle, font_sub)
        start_y = (HEIGHT - h) // 2
        draw_centered_text(draw, subtitle, font_sub, subtitle_color, start_y)

    # Branding bar at bottom
    small = get_font(18)
    draw.text((WIDTH // 2 - 60, HEIGHT - 100), "ArmedCapital", fill=(100, 100, 100), font=small)

    return img


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--hook", default="")
    parser.add_argument("--script", default="")
    parser.add_argument("--cta", default="")
    parser.add_argument("--duration", type=int, default=45)
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    font_title = get_font(52)
    font_hook = get_font(42)
    font_body = get_font(36)
    font_cta = get_font(40)

    # Break script into segments (~8 words each for readability)
    words = args.script.split() if args.script else []
    segments = []
    for i in range(0, len(words), 8):
        segments.append(" ".join(words[i:i + 8]))

    # Build scene list: (text, color, font, duration_seconds)
    scenes = []
    hook_dur = 3.0 if args.hook else 0.0
    cta_dur = 4.0 if args.cta else 0.0

    if args.hook:
        scenes.append((args.hook, WHITE, font_hook, hook_dur))

    if segments:
        body_time = max(1.0, args.duration - hook_dur - cta_dur)
        per_seg = max(2.0, body_time / len(segments))
        for seg in segments:
            scenes.append((seg, WHITE, font_body, per_seg))

    if args.cta:
        scenes.append((args.cta, GREEN, font_cta, cta_dur))

    if not scenes:
        scenes.append(("", WHITE, font_body, float(args.duration)))

    # Generate one PNG per scene + concat.txt
    concat_lines = []
    for i, (text, color, font, dur) in enumerate(scenes):
        fname = f"scene_{i:03d}.png"
        fpath = os.path.join(args.out_dir, fname)
        img = make_frame(args.title, text, color, font_title, font)
        img.save(fpath)
        concat_lines.append(f"file '{fname}'")
        concat_lines.append(f"duration {dur:.2f}")

    # Repeat last frame (ffmpeg concat needs it)
    if concat_lines:
        last_fname = f"scene_{len(scenes)-1:03d}.png"
        concat_lines.append(f"file '{last_fname}'")

    concat_path = os.path.join(args.out_dir, "concat.txt")
    with open(concat_path, "w") as f:
        f.write("\n".join(concat_lines) + "\n")

    print(f"OK:{len(scenes)}")


if __name__ == "__main__":
    main()
