#!/usr/bin/env python3
"""
render_frames.py — Full YouTube Shorts renderer with visuals + TTS audio.
Generates animated frames with gradients, particle effects, text animations,
progress bars, and uses macOS 'say' for voiceover audio.
"""

import argparse
import math
import os
import random
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow", file=sys.stderr)
    sys.exit(1)

WIDTH, HEIGHT = 1080, 1920
ORANGE = (247, 147, 26)
WHITE = (255, 255, 255)
GREEN = (34, 197, 94)
DARK_BG = (8, 8, 12)
ACCENT_DARK = (20, 15, 30)


def get_font(size):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
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


def draw_text_block(draw, text, font, color, y, max_width=WIDTH - 160, center=True):
    lines = wrap_text(text, font, max_width, draw)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (WIDTH - tw) // 2 if center else 80
        draw.text((x + 3, y + 3), line, fill=(0, 0, 0), font=font)
        draw.text((x + 1, y + 1), line, fill=(0, 0, 0), font=font)
        draw.text((x, y), line, fill=color, font=font)
        y += th + 14
    return y


def text_height(draw, text, font, max_width=WIDTH - 160):
    lines = wrap_text(text, font, max_width, draw)
    total = 0
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        total += (bbox[3] - bbox[1]) + 14
    return total


def draw_gradient_bg(img):
    draw = ImageDraw.Draw(img)
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        r = int(DARK_BG[0] + (ACCENT_DARK[0] - DARK_BG[0]) * ratio)
        g = int(DARK_BG[1] + (ACCENT_DARK[1] - DARK_BG[1]) * ratio)
        b = int(DARK_BG[2] + (ACCENT_DARK[2] - DARK_BG[2]) * ratio)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))


def draw_particles(draw, seed, count=40):
    rng = random.Random(seed)
    for _ in range(count):
        x = rng.randint(0, WIDTH)
        y = rng.randint(0, HEIGHT)
        size = rng.randint(1, 4)
        alpha = rng.randint(15, 60)
        factor = alpha / 255.0
        if rng.random() > 0.5:
            c = (int(ORANGE[0] * factor), int(ORANGE[1] * factor), int(ORANGE[2] * factor))
        else:
            c = (int(255 * factor), int(255 * factor), int(255 * factor))
        draw.ellipse([x, y, x + size, y + size], fill=c)


def draw_glow_line(draw, y_pos, color, width_pct=0.6):
    margin = int(WIDTH * (1 - width_pct) / 2)
    for offset in range(6, 0, -1):
        factor = max(10, 40 - offset * 6) / 255.0
        c = (int(color[0] * factor), int(color[1] * factor), int(color[2] * factor))
        draw.line([(margin, y_pos + offset), (WIDTH - margin, y_pos + offset)], fill=c, width=1)
        draw.line([(margin, y_pos - offset), (WIDTH - margin, y_pos - offset)], fill=c, width=1)
    draw.line([(margin, y_pos), (WIDTH - margin, y_pos)], fill=color, width=2)


def draw_progress_bar(draw, progress, y_pos):
    bar_w = WIDTH - 160
    x_start = 80
    draw.rounded_rectangle([x_start, y_pos, x_start + bar_w, y_pos + 4], radius=2, fill=(40, 40, 50))
    fill_w = int(bar_w * progress)
    if fill_w > 0:
        draw.rounded_rectangle([x_start, y_pos, x_start + fill_w, y_pos + 4], radius=2, fill=ORANGE)


def draw_logo_area(draw, font_small):
    for y in range(60):
        draw.line([(0, y), (WIDTH, y)], fill=(ORANGE[0] // 8, ORANGE[1] // 8, ORANGE[2] // 8))
    draw.text((80, 70), "ARMEDCAPITAL", fill=ORANGE, font=font_small)
    draw.ellipse([60, 76, 70, 86], fill=ORANGE)


def make_hook_frame(title, hook, seed, progress):
    img = Image.new("RGB", (WIDTH, HEIGHT), DARK_BG)
    draw_gradient_bg(img)
    draw = ImageDraw.Draw(img)
    draw_particles(draw, seed, count=50)
    font_small = get_font(20)
    font_title = get_font(48)
    font_hook = get_font(54)
    draw_logo_area(draw, font_small)
    if title:
        draw_text_block(draw, title, font_title, ORANGE, 180)
    draw_glow_line(draw, 340, ORANGE, 0.5)
    if hook:
        h = text_height(draw, hook, font_hook)
        start_y = (HEIGHT - h) // 2 - 50
        draw_text_block(draw, hook, font_hook, WHITE, start_y)
    draw_glow_line(draw, HEIGHT - 200, (60, 60, 80), 0.3)
    draw_progress_bar(draw, progress, HEIGHT - 120)
    hint_font = get_font(16)
    draw.text((WIDTH // 2 - 40, HEIGHT - 90), "WATCH MORE", fill=(100, 100, 120), font=hint_font)
    return img


def make_body_frame(title, body_text, seg_idx, total_segs, seed, progress):
    img = Image.new("RGB", (WIDTH, HEIGHT), DARK_BG)
    draw_gradient_bg(img)
    draw = ImageDraw.Draw(img)
    draw_particles(draw, seed + seg_idx, count=35)
    font_small = get_font(20)
    font_title = get_font(40)
    font_body = get_font(42)
    draw_logo_area(draw, font_small)
    if title:
        draw_text_block(draw, title, font_title, ORANGE, 180)
    draw_glow_line(draw, 300, (40, 40, 60), 0.4)
    if body_text:
        h = text_height(draw, body_text, font_body)
        start_y = (HEIGHT - h) // 2 - 30
        draw_text_block(draw, body_text, font_body, WHITE, start_y)
    dot_y = HEIGHT - 220
    total_w = total_segs * 16
    start_x = (WIDTH - total_w) // 2
    for i in range(total_segs):
        x = start_x + i * 16
        if i == seg_idx:
            draw.ellipse([x, dot_y, x + 10, dot_y + 10], fill=ORANGE)
        else:
            draw.ellipse([x, dot_y, x + 6, dot_y + 6], fill=(50, 50, 60))
    draw_progress_bar(draw, progress, HEIGHT - 120)
    return img


def make_cta_frame(title, cta_text, seed, progress):
    img = Image.new("RGB", (WIDTH, HEIGHT), DARK_BG)
    draw_gradient_bg(img)
    draw = ImageDraw.Draw(img)
    draw_particles(draw, seed + 999, count=60)
    font_small = get_font(20)
    font_title = get_font(44)
    font_cta = get_font(52)
    font_sub = get_font(24)
    draw_logo_area(draw, font_small)
    if title:
        draw_text_block(draw, title, font_title, ORANGE, 180)
    draw_glow_line(draw, 340, GREEN, 0.5)
    if cta_text:
        h = text_height(draw, cta_text, font_cta)
        start_y = (HEIGHT - h) // 2 - 60
        draw_text_block(draw, cta_text, font_cta, GREEN, start_y)
    sub_y = (HEIGHT + text_height(draw, cta_text, font_cta)) // 2 + 40
    draw_text_block(draw, "TAP SUBSCRIBE  |  TURN ON NOTIFICATIONS", font_sub, (120, 120, 140), sub_y)
    btn_y = sub_y + 80
    btn_w = 300
    btn_x = (WIDTH - btn_w) // 2
    draw.rounded_rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + 50], radius=25, outline=GREEN, width=2)
    btn_font = get_font(22)
    draw.text((btn_x + 70, btn_y + 12), "SUBSCRIBE", fill=GREEN, font=btn_font)
    draw_progress_bar(draw, progress, HEIGHT - 120)
    return img


def generate_tts_audio(text, out_path, rate=175):
    try:
        aiff_path = out_path + ".aiff"
        subprocess.run(["say", "-r", str(rate), "-o", aiff_path, text], check=True, timeout=60, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-i", aiff_path, "-c:a", "aac", "-b:a", "128k", out_path], check=True, timeout=30, capture_output=True)
        os.remove(aiff_path)
        return True
    except Exception as e:
        print(f"TTS warning: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--hook", default="")
    parser.add_argument("--script", default="")
    parser.add_argument("--cta", default="")
    parser.add_argument("--duration", type=int, default=45)
    parser.add_argument("--mp4", default="", help="Output final MP4 path")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    seed = hash(args.title + args.hook) % 10000

    words = args.script.split() if args.script else []
    segments = []
    for i in range(0, len(words), 8):
        segments.append(" ".join(words[i:i + 8]))

    hook_dur = 3.5 if args.hook else 0.0
    cta_dur = 4.5 if args.cta else 0.0

    scenes = []
    if args.hook:
        scenes.append(("hook", args.hook, hook_dur))
    if segments:
        body_time = max(1.0, args.duration - hook_dur - cta_dur)
        per_seg = max(2.5, body_time / len(segments))
        for seg in segments:
            scenes.append(("body", seg, per_seg))
    if args.cta:
        scenes.append(("cta", args.cta, cta_dur))
    if not scenes:
        scenes.append(("body", "", float(args.duration)))

    total_dur = sum(s[2] for s in scenes)
    total_segs = sum(1 for s in scenes if s[0] == "body")

    concat_lines = []
    body_idx = 0
    elapsed = 0.0

    for i, (stype, text, dur) in enumerate(scenes):
        fname = f"scene_{i:03d}.png"
        fpath = os.path.join(args.out_dir, fname)
        progress = (elapsed + dur / 2) / total_dur

        if stype == "hook":
            img = make_hook_frame(args.title, text, seed, progress)
        elif stype == "cta":
            img = make_cta_frame(args.title, text, seed, progress)
        else:
            img = make_body_frame(args.title, text, body_idx, total_segs, seed, progress)
            body_idx += 1

        img.save(fpath)
        concat_lines.append(f"file '{fname}'")
        concat_lines.append(f"duration {dur:.2f}")
        elapsed += dur

    if scenes:
        concat_lines.append(f"file 'scene_{len(scenes)-1:03d}.png'")

    concat_path = os.path.join(args.out_dir, "concat.txt")
    with open(concat_path, "w") as f:
        f.write("\n".join(concat_lines) + "\n")

    full_narration = " ".join(filter(None, [args.hook, args.script, args.cta]))
    audio_path = os.path.join(args.out_dir, "voiceover.m4a")
    has_audio = False
    if full_narration.strip():
        has_audio = generate_tts_audio(full_narration, audio_path, rate=175)

    if args.mp4:
        os.makedirs(os.path.dirname(args.mp4) or ".", exist_ok=True)
        if has_audio:
            cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_path, "-i", audio_path, "-vf", "fps=25", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-c:a", "aac", "-b:a", "128k", "-pix_fmt", "yuv420p", "-shortest", "-t", str(args.duration), args.mp4]
        else:
            cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_path, "-vf", "fps=25", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-t", str(args.duration), args.mp4]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            print(f"FFMPEG_ERROR:{result.stderr[-500:]}", file=sys.stderr)
            sys.exit(1)
        print(f"OK:{len(scenes)}:audio={'yes' if has_audio else 'no'}:mp4={args.mp4}")
    else:
        print(f"OK:{len(scenes)}:audio={'yes' if has_audio else 'no'}")


if __name__ == "__main__":
    main()
