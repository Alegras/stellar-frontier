#!/usr/bin/env python3
"""Сборка зацикленной GIF для главного меню из Wan2.2-видео (crossfade loop) + постер."""
import os, shutil, subprocess, sys
from PIL import Image

ROOT = r"N:\AI\stellar-frontier"
RAW = os.path.join(ROOT, "tools", "art-dlc", "menu-raw")
PUB = os.path.join(ROOT, "apps", "web", "public", "menu")
FF = r"D:\ffmpeg\bin\ffmpeg.exe"
VIDEO = os.path.join(RAW, "video_test.webm")
W, H = 480, 270          # итоговая GIF-канва
FPS = 12
COLORS = 96
CROSS = 8                # кадров crossfade на стыке цикла

os.makedirs(PUB, exist_ok=True)
frames_dir = os.path.join(RAW, "frames")
shutil.rmtree(frames_dir, ignore_errors=True)
os.makedirs(frames_dir)
subprocess.run([FF, "-y", "-i", VIDEO, os.path.join(frames_dir, "f_%03d.png")],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
print("frames:", len(files))

imgs = [Image.open(os.path.join(frames_dir, f)).convert("RGB") for f in files]
imgs = [im.resize((W, H), Image.Resampling.LANCZOS) for im in imgs]
N = len(imgs)

# crossfade: последние CROSS кадров плавно переходят в первый (бесшовный loop)
seq = list(imgs)
last = imgs[-1]
for j in range(1, CROSS):
    t = j / CROSS
    blend = Image.blend(last, imgs[0], t)
    seq.append(blend)
print("loop frames:", len(seq))

seq_dir = os.path.join(RAW, "seq")
shutil.rmtree(seq_dir, ignore_errors=True)
os.makedirs(seq_dir)
for i, im in enumerate(seq):
    im.save(os.path.join(seq_dir, f"s_{i:03d}.png"))
pal = os.path.join(RAW, "palette.png")
subprocess.run([FF, "-y", "-framerate", str(FPS), "-i", os.path.join(seq_dir, "s_%03d.png"),
                "-vf", f"palettegen=max_colors={COLORS}:stats_mode=full", pal],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
gif_path = os.path.join(PUB, "stellar-battle.gif")
subprocess.run([FF, "-y", "-framerate", str(FPS), "-i", os.path.join(seq_dir, "s_%03d.png"), "-i", pal,
                "-lavfi", f"paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", gif_path],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
print("gif:", gif_path, os.path.getsize(gif_path), "B")

# постер: keyframe (kinematic frame) -> 640x360 PNG-8
key = Image.open(os.path.join(RAW, "keyframe_raw.png")).convert("RGB")
kw, kh = key.size
target_ratio = 640 / 360
if kw / kh > target_ratio:
    nw = int(kh * target_ratio); left = (kw - nw) // 2; key = key.crop((left, 0, left + nw, kh))
else:
    nh = int(kw / target_ratio); top = (kh - nh) // 2; key = key.crop((0, top, kw, top + nh))
poster = key.resize((640, 360), Image.Resampling.LANCZOS).quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
poster_path = os.path.join(PUB, "stellar-battle-poster.png")
poster.save(poster_path, format="PNG", optimize=True)
print("poster:", poster_path, os.path.getsize(poster_path), "B")

# проверка loop/кадров
g = Image.open(gif_path)
print("GIF check:", g.size, "frames=", g.n_frames, "loop=", g.info.get("loop"), "duration_ms=", g.info.get("duration"))
