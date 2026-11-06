#!/usr/bin/env python3
"""
task-45: комикс/фон/карточки DLC через локальную Qwen-Image 2.1 (ComfyUI).

- comic 640x240 (генерим 1536x576): повреждённая станция справа, рейдеры/обломки,
  корабль игрока; БЕЗ текста и БЕЗ пузырей; верх затемняется под DOM-бабблы.
- background station_light_1 640x360 (генерим 1152x648): интерьер дока; fore 640x48
  вырезается из низа фона с альфа-рампом (параллакс-слой).
- cards 320x180 (генерим 1024x576): q_pro_01_first_light, q_pro_02_quiet_dock, placeholder;
  без запечённого текста, ≤24 цветов.
Пост: downscale LANCZOS + лёгкий unsharp, PNG-8, без дизеринга. Обновляет manifest/sha,
превью docs/shots, аудит всех 31 ассетов (размеры/пустоты/обрезка).

Запуск: python tools/art-dlc/qwen_scenery.py [--only comic|bg|cards]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qwen_portraits as q  # noqa: E402

ROOT = q.ROOT
DLC = q.DLC
SHOTS = q.SHOTS
SEED = 5150
NEG = ("text, letters, words, numbers, caption, subtitle, speech bubble, white rectangle, dialogue box, "
       "watermark, logo, signature, UI overlay, hud, frame border, duplicate ship, deformed geometry, "
       "blurry, low quality, photograph, 3d render, jpeg artifacts")

ASSETS = {
    "comic": {
        "path": "comics/q_pro_01_first_light_01.png",
        "prompt": ("Pixel art sci-fi comic panel, wide cinematic space scene: a badly damaged civilian space "
                   "station on the RIGHT side with a torn hull, broken solar panels, sparks and floating debris; "
                   "three angular pirate raider ships with red engine glow attacking from the left; the player's "
                   "small corvette in the lower left with a bright engine trail; starfield and dark purple nebula "
                   "background; the TOP THIRD of the frame is empty dark space, clean and free of objects, "
                   "reserved for speech bubbles; dramatic lighting, strong rim light, limited colour palette, "
                   "crisp pixel shading, 1990s sci-fi game cutscene style"),
        "w": 1536, "h": 576, "out": (640, 240), "colors": 32,
    },
    "bg": {
        "path": "backgrounds/station_light_1.png",
        "prompt": ("Pixel art interior of a space station docking bay, wide angle: a huge window showing a blue "
                   "planet and stars, metal gantry and crane, stacked cargo crates, yellow-black warning stripes, "
                   "cables and pipes, a glowing holographic panel on the right wall, dark navy and grey palette, "
                   "cinematic side light, crisp pixel shading, 1990s sci-fi game background"),
        "w": 1152, "h": 648, "out": (640, 360), "colors": 32,
    },
    "q1": {
        "path": "cards/q_pro_01_first_light.png",
        "prompt": ("Pixel art quest card background, wide 16:9 sci-fi scene: a damaged civilian space station "
                   "with a broken ring, a small corvette approaching, golden decorative border frame, dark navy "
                   "background with stars, empty darker area on the left side for interface text overlay, "
                   "crisp pixel shading, limited palette, no interface elements"),
        "w": 1024, "h": 576, "out": (320, 180), "colors": 24,
    },
    "q2": {
        "path": "cards/q_pro_02_quiet_dock.png",
        "prompt": ("Pixel art quest card background, wide 16:9 sci-fi scene: a quiet damaged station dock at "
                   "night, a small courier ship docked, cyan floodlights, teal and dark navy palette, decorative "
                   "border frame, empty darker area on the left for interface text, crisp pixel shading, "
                   "limited palette, no interface elements"),
        "w": 1024, "h": 576, "out": (320, 180), "colors": 24,
    },
    "placeholder": {
        "path": "cards/placeholder.png",
        "prompt": ("Pixel art quest card placeholder background, wide 16:9: dark navy sci-fi background with a "
                   "dark silhouette of a hooded figure in the centre and a golden diamond emblem, subtle "
                   "decorative border, tiny stars, minimal and clean, empty darker area on the left, crisp pixel "
                   "shading, limited palette, no interface elements"),
        "w": 1024, "h": 576, "out": (320, 180), "colors": 24,
    },
}


def gen_image(prompt: str, w: int, h: int, seed: int, prefix: str) -> Image.Image:
    pid = q.submit(q.t2i_graph(prompt, seed, w, h, steps=25))
    t0 = time.time()
    hist = q.wait(pid, timeout=1200)
    meta = hist["outputs"]["8"]["images"][0]
    img = q.fetch_image(meta)
    print(f"  generated {prefix} {w}x{h} in {time.time()-t0:.1f}s -> {meta['filename']}", flush=True)
    return img


def post(img: Image.Image, out_size: tuple[int, int], colors: int, path: str) -> tuple[int, int]:
    small = img.resize(out_size, Image.Resampling.LANCZOS)
    small = small.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=2))
    qimg = small.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    qimg.save(path, format="PNG", optimize=True)
    return len(qimg.getcolors(maxcolors=256) or []), os.path.getsize(path)


def darken_top(path: str, percent=0.28) -> None:
    """Верх комикса держим тёмным/чистым под DOM-бабблы: мягкий градиент затемнения сверху."""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    band = int(h * percent)
    overlay = Image.new("L", (w, h), 0)
    od = ImageDraw.Draw(overlay)
    for y in range(band):
        alpha = int(150 * (1 - y / band) ** 1.4)
        od.line([(0, y), (w, y)], fill=alpha)
    dark = Image.new("RGB", (w, h), (5, 7, 14))
    img = Image.composite(dark, img, overlay)
    img.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, format="PNG", optimize=True)


def make_fore(bg_path: str, fore_path: str) -> tuple[int, int]:
    """Передний слой параллакса 640x48 из нижней части фона (альфа-рамп сверху)."""
    bg = Image.open(bg_path).convert("RGB")
    w, h = bg.size
    strip = bg.crop((0, h - 48, w, h)).convert("RGBA")
    alpha = Image.new("L", (w, 48), 255)
    ad = ImageDraw.Draw(alpha)
    for y in range(10):
        ad.line([(0, y), (w, y)], fill=int(255 * (y / 10)))
    strip.putalpha(alpha)
    rgba = strip.copy()
    # PNG-8 с прозрачностью
    p = rgba.convert("P", palette=Image.Palette.ADAPTIVE, colors=32)
    os.makedirs(os.path.dirname(fore_path), exist_ok=True)
    p.save(fore_path, format="PNG", optimize=True)
    return 32, os.path.getsize(fore_path)


def update_manifest() -> dict:
    path = os.path.join(DLC, "manifest.json")
    manifest = json.load(open(path, encoding="utf-8"))
    by_path = {a["path"]: a for a in manifest["assets"]}
    for key, spec in ASSETS.items():
        if spec["path"] not in by_path:
            continue
        a = by_path[spec["path"]]
        with Image.open(os.path.join(DLC, spec["path"])) as im:
            a["colors"] = len(im.getcolors(maxcolors=256) or [])
        a["bytes"] = os.path.getsize(os.path.join(DLC, spec["path"]))
        a["generator"] = f"qwen-image-2.1 (local ComfyUI, seed {SEED}, {spec['w']}x{spec['h']} -> {spec['out'][0]}x{spec['out'][1]})"
    # fore
    fore_rel = "backgrounds/station_light_1_fore.png"
    if fore_rel in by_path:
        a = by_path[fore_rel]
        with Image.open(os.path.join(DLC, fore_rel)) as im:
            a["colors"] = len(im.getcolors(maxcolors=256) or [])
        a["bytes"] = os.path.getsize(os.path.join(DLC, fore_rel))
        a["generator"] = "derived from Qwen background (bottom 48 px, alpha ramp)"
    total = sum(a["bytes"] for a in manifest["assets"])
    manifest["totalBytes"] = total
    manifest["totalKb"] = round(total / 1024, 1)
    manifest["sha256_16"] = {}
    for a in manifest["assets"]:
        with open(os.path.join(DLC, a["path"]), "rb") as fh:
            manifest["sha256_16"][a["path"]] = hashlib.sha256(fh.read()).hexdigest()[:16]
    manifest["sceneryPipeline"] = {
        "generator": "qwen-image-2.1-UC-fp8 + qwen3vl_8b (local ComfyUI)",
        "comic": "1536x576 t2i, 25 steps, cfg 1, euler/simple, seed %d; top band darkened for DOM bubbles" % SEED,
        "background": "1152x648 t2i -> 640x360; fore = bottom 48 px with alpha ramp",
        "cards": "1024x576 t2i -> 320x180, 24 colours, no baked text",
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest


def font(size=14):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build_previews() -> None:
    comic = Image.open(os.path.join(DLC, "comics/q_pro_01_first_light_01.png")).convert("RGB")
    bg = Image.open(os.path.join(DLC, "backgrounds/station_light_1.png")).convert("RGB")
    fore = Image.open(os.path.join(DLC, "backgrounds/station_light_1_fore.png")).convert("RGBA")
    cards = [Image.open(os.path.join(DLC, "cards/n.png")).convert("RGB") if False else
             Image.open(os.path.join(DLC, p)).convert("RGB")
             for p in ("cards/q_pro_01_first_light.png", "cards/q_pro_02_quiet_dock.png", "cards/placeholder.png")]
    # comic x2
    comic.resize((1280, 480), Image.NEAREST).save(os.path.join(SHOTS, "dlc-comic.png"))
    # scene x2 + fore
    scene = bg.resize((1280, 720), Image.NEAREST)
    f2 = fore.resize((1280, 96), Image.NEAREST)
    scene.paste(f2, (0, 720 - 96), f2)
    scene.save(os.path.join(SHOTS, "dlc-scene.png"))
    # cards x2
    cell = (640, 360)
    sheet = Image.new("RGB", (3 * cell[0] + 4 * 12, cell[1] + 2 * 12 + 40), (5, 7, 14))
    d = ImageDraw.Draw(sheet)
    titles = ["q_pro_01_first_light", "q_pro_02_quiet_dock", "placeholder"]
    for i, c in enumerate(cards):
        x = 12 + i * (cell[0] + 12)
        sheet.paste(c.resize(cell, Image.NEAREST), (x, 36))
        d.text((x, 12), titles[i], fill=(232, 238, 247), font=font(14))
    sheet.save(os.path.join(SHOTS, "dlc-cards.png"))
    # общий лист
    sheet2 = Image.new("RGB", (1600, 900), (5, 7, 14))
    d2 = ImageDraw.Draw(sheet2)
    d2.text((16, 10), "DLC XIV · Qwen-Image: комикс 640×240, фон 640×360+fore, карточки 320×180 (×2 nearest)", fill=(232, 238, 247), font=font(16))
    sheet2.paste(comic.resize((640, 240), Image.NEAREST), (16, 44))
    d2.text((16, 292), "comic q_pro_01_first_light_01 — верх тёмный/чистый под DOM-бабблы, текст не запечён", fill=(183, 194, 208), font=font(12))
    sheet2.paste(bg.resize((640, 360), Image.NEAREST), (16, 320))
    f3 = fore.resize((640, 48), Image.NEAREST)
    sheet2.paste(f3, (16, 320 + 360 - 48), f3)
    d2.text((16, 692), "background station_light_1 + fore (параллакс)", fill=(183, 194, 208), font=font(12))
    for i, c in enumerate(cards):
        sheet2.paste(c.resize((320, 180), Image.NEAREST), (700 + (i % 2) * 336, 44 + (i // 2) * 220))
        d2.text((700 + (i % 2) * 336, 44 + (i // 2) * 220 + 186), titles[i], fill=(232, 238, 247), font=font(12))
    d2.text((700, 520), "cards 320x180, 24 цвета, без запечённого текста", fill=(183, 194, 208), font=font(12))
    sheet2.save(os.path.join(SHOTS, "dlc-preview.png"))


def audit() -> tuple[bool, list[str]]:
    manifest = json.load(open(os.path.join(DLC, "manifest.json"), encoding="utf-8"))
    problems: list[str] = []
    for a in manifest["assets"]:
        p = os.path.join(DLC, a["path"])
        try:
            with Image.open(p) as im:
                im.load()
                if im.size != (a["width"], a["height"]):
                    problems.append(f"{a['path']}: размер {im.size} != {(a['width'], a['height'])}")
                rgb = im.convert("RGB")
                small = rgb.resize((32, 32))
                px = list(small.getdata())
                uniq = len(set(px))
                mean = sum(sum(c) / 3 for c in px) / len(px)
                if uniq < 6:
                    problems.append(f"{a['path']}: слишком мало цветов/пусто (uniq={uniq})")
                if mean < 6:
                    problems.append(f"{a['path']}: почти чёрный (mean={mean:.1f})")
        except Exception as e:
            problems.append(f"{a['path']}: ошибка чтения: {e}")
    # комикс: верхняя треть тёмная
    comic = Image.open(os.path.join(DLC, "comics/q_pro_01_first_light_01.png")).convert("L")
    top = comic.crop((0, 0, comic.width, int(comic.height * 0.28)))
    top_mean = sum(top.getdata()) / (top.width * top.height)
    if top_mean > 60:
        problems.append(f"комикс: верх слишком светлый (mean={top_mean:.1f}), DOM-бабблы будут плохо читаться")
    print(f"AUDIT: assets={len(manifest['assets'])}, comic_top_mean={top_mean:.1f}, problems={len(problems)}")
    for pr in problems:
        print("  -", pr)
    return len(problems) == 0, problems


def main() -> int:
    global SEED
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()
    SEED = args.seed
    keys = [k for k in ASSETS if (not args.only or k == args.only)]
    for key in keys:
        spec = ASSETS[key]
        print(f"== {key}: {spec['out'][0]}x{spec['out'][1]}", flush=True)
        img = gen_image(spec["prompt"], spec["w"], spec["h"], SEED + (hash(key) % 1000), key)
        out_path = os.path.join(DLC, spec["path"])
        colors, size = post(img, spec["out"], spec["colors"], out_path)
        if key == "comic":
            darken_top(out_path)
            colors, size = len(Image.open(out_path).getcolors(maxcolors=256) or []), os.path.getsize(out_path)
        print(f"   saved {out_path} {colors}c {size}B", flush=True)
        if key == "bg":
            fore_colors, fore_size = make_fore(out_path, os.path.join(DLC, "backgrounds/station_light_1_fore.png"))
            print(f"   fore saved {fore_colors}c {fore_size}B", flush=True)
    update_manifest()
    build_previews()
    ok, _ = audit()
    print("manifest + previews updated" + (" | AUDIT OK" if ok else " | AUDIT FAIL"), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
