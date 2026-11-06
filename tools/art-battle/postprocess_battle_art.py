#!/usr/bin/env python3
"""
task-63 (M5b): пост-обработка Qwen-исходников в пиксель-арт.
Исходники: tools/art-battle/qwen-raw/*.png (Qwen-Image 2.1) + sources.json (prompt/seed/model).
Выход: apps/web/public/battle/** (tiles/units/effects/bg + manifest.json) и превью docs/shots/battle-*.

Правила: палитра проекта ≤32 на ассет; тайлы ≤3 цветов (15a §7.7); strips;
анимация кадров — пост-обработка одного Qwen-исходника (поворот/сдвиг/пульс/масштаб/вспышка),
это фиксируется в manifest (framesFrom: "postprocess").
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUB = os.path.join(ROOT, "apps", "web", "public", "battle")
SHOTS = os.path.join(ROOT, "docs", "shots")
RAW = os.path.join(ROOT, "tools", "art-battle", "qwen-raw")
SOURCES = os.path.join(RAW, "sources.json")

PAL_HEX = [
    "#05070E", "#0A1020", "#101A2E", "#142038", "#1B2A4A", "#233A5C", "#2E4A70", "#38414F",
    "#5C6878", "#8C99A8", "#B7C2D0", "#E8EEF7", "#FFFFFF", "#F5C542", "#B8862A", "#6BE675",
    "#3FA35A", "#4FC3F7", "#2A7CA8", "#7A5CFF", "#FF5A5A", "#A33030", "#F08A24", "#FFCF6B",
    "#3A2B5C", "#6BE08A",
]
PAL = np.array([tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in PAL_HEX], dtype=np.int32)
(SPACE, SPACE_DEEP, SPACE_FAR, HULL_SHADE, NEB1, NEB2, NEB3, METAL_SHADOW,
 METAL2, METAL1, TEXT2, TEXT, WHITE, GOLD, GOLD_DARK, OK, OK_DARK, SHIELD, SHIELD_DARK,
 PSI, ENEMY, ENEMY_DARK, WARN, WARN_LIGHT, MIST, CHORUS) = [tuple(int(c) for c in row) for row in PAL]

TILE_W, TILE_H = 32, 36
UNIT = 64
CLASSES = ["corvette", "frigate", "destroyer", "cruiser", "battleship", "carrier", "titan", "colossus"]
TILES = {
    "empty": dict(frames=1, fps=0, loop=False),
    "asteroid": dict(frames=4, fps=2, loop=True),
    "nebula": dict(frames=4, fps=2, loop=True),
    "mines": dict(frames=6, fps=5, loop=True),
    "gravity": dict(frames=4, fps=2, loop=True),
    "wreck": dict(frames=1, fps=0, loop=False),
}
EFFECTS = {
    "laser_shot": dict(frames=6, fps=12, loop=False),
    "kinetic_shot": dict(frames=6, fps=12, loop=False),
    "shield_hit": dict(frames=6, fps=12, loop=False),
    "death_explosion": dict(frames=6, fps=10, loop=False),
}
FRAME_ORDER = ["idle_0", "idle_1", "move_0", "move_1", "attack_0", "attack_1"]


def hex_mask(size=(TILE_W, TILE_H)) -> Image.Image:
    w, h = size
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    cx, cy, r = w / 2, h / 2, h / 2
    pts = [(cx + r * math.cos(math.radians(60 * i - 90)) * 0.94,
            cy + r * math.sin(math.radians(60 * i - 90))) for i in range(6)]
    d.polygon([(round(x), round(y)) for x, y in pts], fill=255)
    return m


HEX_MASK = hex_mask()


def fallback_sources() -> dict:
    """Метаданные для уже сгенерированных Qwen-исходников, даже если sources.json не записался."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "qbs", os.path.join(os.path.dirname(os.path.abspath(__file__)), "qwen_battle_sources.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    out = {}
    def add(name, prompt, seed, w, h):
        out[name] = {"name": name, "path": os.path.relpath(os.path.join(RAW, name + ".png"), ROOT),
                     "prompt": prompt, "seed": seed, "model": "qwen-image-2.1-UC-fp8", "steps": m.STEPS, "w": w, "h": h}
    for i, (kind, desc) in enumerate(m.TILE_DESC.items()):
        add("tile_" + kind, m.style(desc) + " Square composition, object fills the frame.", m.SEED_BASE + i, 1024, 1024)
    idx = 0
    for faction in ("player", "enemy"):
        for cls, desc in m.CLASS_DESC.items():
            idx += 1
            add(f"unit_{faction}_{cls}", m.style(f"{desc}, top-down three-quarter view spaceship", m.FACTION_DESC[faction]),
                m.SEED_BASE + 100 + idx, 1024, 1024)
    for i, (name, desc) in enumerate(m.EFFECT_DESC.items()):
        add("fx_" + name, m.style(desc) + " Horizontal composition, centered.", m.SEED_BASE + 300 + i, 1024, 512)
    add("bg_backdrop", "Wide cinematic space battle background ...", m.SEED_BASE + 400, 1600, 900)
    add("bg_battlefield2d", "Top-down isometric space battlefield ...", m.SEED_BASE + 401, 1280, 720)
    return {k: v for k, v in out.items() if os.path.exists(os.path.join(RAW, k + ".png"))}


def load_sources() -> dict:
    src = fallback_sources()
    if os.path.exists(SOURCES):
        with open(SOURCES, encoding="utf-8") as f:
            for a in json.load(f).get("assets", []):
                if os.path.exists(os.path.join(ROOT, a["path"])):
                    src[a["name"]] = a
    return src


def key_black(img: Image.Image, thresh: int = 30, tol: int | None = None) -> Image.Image:
    """Убрать фон Qwen: flood fill от краёв по цвету, близкому к фону (медиана рамки)."""
    rgb = img.convert("RGB")
    arr = np.array(rgb).astype(np.int32)
    h, w = arr.shape[:2]
    border = np.concatenate([arr[0, :], arr[-1, :], arr[:, 0], arr[:, -1]])
    bg = np.median(border, axis=0)
    tol = 26 if tol is None else tol
    diff = np.abs(arr - bg).max(axis=2)
    dark = ((diff < tol) | (arr.max(axis=2) < thresh)).astype(np.uint8) * 255
    mask = Image.fromarray(dark, "L")
    for (x, y) in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
                   (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        if mask.getpixel((x, y)) == 255:
            ImageDraw.floodfill(mask, (x, y), 128)
    alpha = np.array(mask)
    alpha = np.where(alpha == 128, 0, 255).astype(np.uint8)
    out = rgb.convert("RGBA")
    out.putalpha(Image.fromarray(alpha, "L"))
    if out.getchannel("A").getextrema()[0] != 0 and tol < 70:
        return key_black(img, thresh=thresh, tol=tol + 22)
    if out.getchannel("A").getextrema()[0] != 0:
        # последний шанс: всё, что близко к цвету фона, делаем прозрачным без flood fill
        a2 = np.where(diff < max(tol, 70), 0, 255).astype(np.uint8)
        out.putalpha(Image.fromarray(a2, "L"))
    return out


def crop_content(img: Image.Image, pad=2) -> Image.Image:
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def to_palette(img: Image.Image, colors: int) -> Image.Image:
    """Квантование в colors цветов, затем каждый цвет -> ближайший цвет палитры проекта (≤32)."""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    rgb = rgba.convert("RGB")
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    qpal = q.getpalette() or []
    n = min(colors, len(qpal) // 3)
    if n == 0:
        # полностью прозрачный/одноцветный кадр — нечего квантовать
        out = Image.new("RGBA", rgb.size, (5, 7, 14, 0))
        return out
    remap = []
    for i in range(n):
        c = np.array(qpal[i * 3:i * 3 + 3], dtype=np.int32)
        d = ((PAL - c) ** 2).sum(axis=1)
        remap.append(int(np.argmin(d)))
    px = np.clip(np.array(q), 0, n - 1)
    flat = np.array(remap, dtype=np.uint8)
    out_idx = flat[px]
    out = Image.fromarray(out_idx, "P")
    pal_full = np.zeros((256, 3), dtype=np.uint8)
    pal_full[:len(PAL)] = PAL.astype(np.uint8)
    out.putpalette(pal_full.flatten().tolist())
    out.putalpha(alpha)
    return out


def fit_into(img: Image.Image, w: int, h: int, anchor_bottom=True) -> Image.Image:
    """Вписать объект в w×h без искажений (по большей стороне), посадить низом к низу."""
    c = crop_content(img)
    scale = min(w / c.width, h / c.height)
    nw, nh = max(1, int(c.width * scale)), max(1, int(c.height * scale))
    c = c.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x = (w - nw) // 2
    y = h - nh if anchor_bottom else (h - nh) // 2
    canvas.paste(c, (max(0, x), max(0, y)), c)
    return canvas


TILE_STYLE = {
    "empty":    (SPACE_DEEP, SPACE_FAR, TEXT2),
    "asteroid": (SPACE_DEEP, METAL_SHADOW, METAL2),
    "nebula":   (SPACE_DEEP, NEB1, NEB3),
    "mines":    (SPACE_DEEP, ENEMY_DARK, WARN),
    "gravity":  (SPACE_FAR, MIST, PSI),
    "wreck":    (SPACE_DEEP, METAL_SHADOW, METAL1),
    "dust":     (SPACE_FAR, NEB1, NEB2),
}


def style_tile(img: Image.Image, kind: str) -> Image.Image:
    base, mid, accent = TILE_STYLE.get(kind, TILE_STYLE["empty"])
    rgba = img.convert("RGBA")
    arr = np.array(rgba).astype(np.float32)
    rgb, alpha = arr[..., :3], arr[..., 3]
    lum = rgb.max(axis=2)
    mx = max(1.0, float(lum[alpha > 40].max()) if (alpha > 40).any() else 1.0)
    mask = alpha > 40
    # базовый цвет на весь гекс, дальше средний по яркости и акцент по самым ярким/цветным пикселям
    out = np.zeros((TILE_H, TILE_W, 4), dtype=np.uint8)
    out[..., :3] = base
    out[..., 3] = 0
    out[mask, 3] = 255
    mid_mask = mask & (lum > mx * 0.28)
    out[mid_mask, :3] = mid
    if kind in ("mines",):
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        accent_mask = mask & (r > 120) & (r > b * 1.25)
    elif kind in ("gravity",):
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        accent_mask = mask & (b > 90) & (r > g * 0.8) & (lum > mx * 0.5)
    else:
        accent_mask = mask & (lum > mx * (0.62 if kind == "empty" else 0.55))
    out[accent_mask, :3] = accent
    res = Image.fromarray(out, "RGBA")
    res.putalpha(Image.composite(res.getchannel("A"), Image.new("L", (TILE_W, TILE_H), 0), HEX_MASK))
    return res


def tile_from_source(img: Image.Image, kind: str = "empty", rotate=0.0, roll=(0, 0), zoom=1.0, brightness=1.0) -> Image.Image:
    c = crop_content(img)
    c = c.resize((96, 108), Image.Resampling.LANCZOS)
    if rotate:
        c = c.rotate(rotate, resample=Image.Resampling.BICUBIC, expand=False)
    if zoom != 1.0:
        nw, nh = int(c.width * zoom), int(c.height * zoom)
        c = c.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (96, 108), (0, 0, 0, 0))
        canvas.paste(c, ((96 - nw) // 2, (108 - nh) // 2), c)
        c = canvas
    c = c.resize((TILE_W, TILE_H), Image.Resampling.LANCZOS)
    if roll != (0, 0):
        c = Image.fromarray(np.roll(np.array(c), roll, axis=(0, 1)))
    if brightness != 1.0:
        arr = np.array(c).astype(np.float32)
        arr[..., :3] = np.clip(arr[..., :3] * brightness, 0, 255)
        c = Image.fromarray(arr.astype(np.uint8))
    out = Image.new("RGBA", (TILE_W, TILE_H), (0, 0, 0, 0))
    return style_tile(c, kind)


def brighten_faction(img: Image.Image, factor=1.4) -> Image.Image:
    arr = np.array(img.convert("RGBA")).astype(np.float32)
    rgb = arr[..., :3]
    # акцентные (насыщенные) пиксели усиливаем
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    sat = (mx - mn) > 40
    rgb[sat] = np.clip(rgb[sat] * factor, 0, 255)
    arr[..., :3] = rgb
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    return out


def add_muzzle(img: Image.Image, frame: int) -> Image.Image:
    out = img.copy()
    d = ImageDraw.Draw(out)
    cx = out.width // 2
    top = 6 if frame == 4 else 9
    col = (255, 255, 255, 255) if frame == 4 else (255, 207, 107, 255)
    d.line([(cx, top), (cx, top + 6)], fill=col, width=1)
    d.line([(cx - 3, top + 3), (cx + 3, top + 3)], fill=col, width=1)
    d.point((cx - 4, top + 4), fill=(79, 195, 247, 255))
    d.point((cx + 4, top + 4), fill=(79, 195, 247, 255))
    return out


def process_tiles(sources: dict, manifest: dict) -> None:
    for kind, spec in TILES.items():
        s = sources.get("tile_" + kind)
        if not s or not os.path.exists(os.path.join(ROOT, s["path"])):
            manifest["pending"].append("tiles/" + kind + ".png")
            continue
        src = key_black(Image.open(os.path.join(ROOT, s["path"])))
        frames = []
        for f in range(spec["frames"]):
            if kind == "asteroid":
                frames.append(tile_from_source(src, kind, rotate=f * 80))
            elif kind == "nebula":
                frames.append(tile_from_source(src, kind, roll=(f * 3, (f % 2) * 2)))
            elif kind == "mines":
                frames.append(tile_from_source(src, kind, brightness=[0.7, 1.0, 1.6, 1.1, 0.8, 1.3][f]))
            elif kind == "gravity":
                frames.append(tile_from_source(src, kind, zoom=[1.0, 1.07, 1.14, 1.07][f]))
            else:
                frames.append(tile_from_source(src, kind))
        info = save_strip(frames, "tiles/" + kind + ".png")
        manifest["tiles"][kind] = dict(
            path="tiles/" + kind + ".png", frameW=TILE_W, frameH=TILE_H, frames=spec["frames"],
            fps=spec["fps"], loop=spec["loop"], anchor=[16, 18], bytes=info["bytes"], colors=info["colors"],
            source=dict(prompt=s["prompt"], seed=s["seed"], model=s["model"], steps=s["steps"]),
        )


def process_units(sources: dict, manifest: dict) -> None:
    for faction in ("player", "enemy"):
        manifest["units"][faction] = {}
        for cls in CLASSES:
            s = sources.get(f"unit_{faction}_{cls}")
            if not s or not os.path.exists(os.path.join(ROOT, s["path"])):
                manifest["pending"].append(f"units/{faction}/{cls}.png")
                continue
            base = fit_into(key_black(Image.open(os.path.join(ROOT, s["path"]))), UNIT, UNIT)
            frames = []
            for f in range(6):
                im = base
                if f in (1, 2, 3):
                    shifted = Image.new("RGBA", (UNIT, UNIT), (0, 0, 0, 0))
                    shifted.paste(im, (0, 1), im)
                    im = shifted
                if f in (2, 3):
                    im = brighten_faction(im, 1.35 if f == 2 else 1.5)
                if f in (4, 5):
                    shifted = Image.new("RGBA", (UNIT, UNIT), (0, 0, 0, 0))
                    shifted.paste(im, (0, 2), im)
                    im = add_muzzle(brighten_faction(shifted, 1.2), f)
                if f == 1:
                    im = brighten_faction(im, 1.1)
                frames.append(to_palette(im, 24))
            info = save_strip(frames, f"units/{faction}/{cls}.png")
            manifest["units"][faction][cls] = dict(
                path=f"units/{faction}/{cls}.png", frameW=UNIT, frameH=UNIT, frames=6, fps=6, loop=True,
                anchor=[32, 56], frameOrder=FRAME_ORDER, bytes=info["bytes"], colors=info["colors"],
                frameSource="postprocess(Qwen source: bob/bank/glow/muzzle)",
                source=dict(prompt=s["prompt"], seed=s["seed"], model=s["model"], steps=s["steps"]),
            )


def process_effects(sources: dict, manifest: dict) -> None:
    for name, spec in EFFECTS.items():
        s = sources.get("fx_" + name)
        if not s or not os.path.exists(os.path.join(ROOT, s["path"])):
            manifest["pending"].append("effects/" + name + ".png")
            continue
        src = key_black(Image.open(os.path.join(ROOT, s["path"])))
        c = crop_content(src)
        frames = []
        for f in range(6):
            canvas = Image.new("RGBA", (UNIT, UNIT), (0, 0, 0, 0))
            if name in ("laser_shot", "kinetic_shot"):
                scale = 16.0 / max(c.size)
                part = c.resize((max(6, int(c.width * scale)), max(4, int(c.height * scale))), Image.Resampling.LANCZOS)
                x = -4 + f * 11
                canvas.paste(part, (x, UNIT // 2 - part.height // 2), part)
            else:
                zoom = [0.5, 0.7, 0.9, 1.0, 1.0, 0.9][f]
                base_side = 46.0
                scale = (base_side * zoom) / max(c.size)
                part = c.resize((max(4, int(c.width * scale)), max(4, int(c.height * scale))), Image.Resampling.LANCZOS)
                alpha = int(255 * [0.9, 1.0, 0.85, 0.65, 0.45, 0.25][f])
                part.putalpha(Image.eval(part.getchannel("A"), lambda a: int(a * alpha / 255)))
                pa = np.array(part)
                lum = pa[..., :3].max(axis=2)
                pa[..., 3] = np.where(lum > 55, pa[..., 3], 0)
                part = Image.fromarray(pa, "RGBA")
                canvas.paste(part, ((UNIT - part.width) // 2, (UNIT - part.height) // 2), part)
            # убрать тёмный «ореол» фона, оставшийся после фейда/масштаба
            arr = np.array(canvas).astype(np.float32)
            lum = arr[..., :3].max(axis=2)
            arr[..., 3] = np.where(lum < 46, 0, arr[..., 3])
            canvas = Image.fromarray(arr.astype(np.uint8), "RGBA")
            frames.append(to_palette(canvas, 16))
        info = save_strip(frames, "effects/" + name + ".png")
        manifest["effects"][name] = dict(
            path="effects/" + name + ".png", frameW=UNIT, frameH=UNIT, frames=6, fps=spec["fps"],
            loop=spec["loop"], anchor=[32, 32], bytes=info["bytes"], colors=info["colors"],
            frameSource="postprocess(Qwen source: motion/scale/fade)",
            source=dict(prompt=s["prompt"], seed=s["seed"], model=s["model"], steps=s["steps"]),
        )


def process_backgrounds(sources: dict, manifest: dict) -> None:
    for name, src_key, w, h in (("backdrop", "bg_backdrop", 1920, 1080),
                                ("battlefield2d", "bg_battlefield2d", 640, 360)):
        s = sources.get(src_key)
        if not s or not os.path.exists(os.path.join(ROOT, s["path"])):
            manifest["pending"].append(f"bg/{name}.png")
            continue
        img = Image.open(os.path.join(ROOT, s["path"])).convert("RGB").resize((w, h), Image.Resampling.LANCZOS)
        # лёгкое затемнение под UI + квантование 32
        arr = np.array(img).astype(np.float32) * 0.92
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        q = img.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        rel = f"bg/{ 'battle-backdrop.png' if name == 'backdrop' else 'battlefield-2d.png' }"
        os.makedirs(os.path.dirname(os.path.join(PUB, rel)), exist_ok=True)
        q.save(os.path.join(PUB, rel), format="PNG", optimize=True)
        manifest["backgrounds"][name] = dict(
            path=rel, width=w, height=h, bytes=os.path.getsize(os.path.join(PUB, rel)),
            colors=len(q.getcolors(maxcolors=256) or []),
            source=dict(prompt=s["prompt"], seed=s["seed"], model=s["model"], steps=s["steps"]),
        )


def save_strip(frames: list[Image.Image], rel: str) -> dict:
    w, h = frames[0].size
    strip = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        strip.paste(fr, (i * w, 0))
    path = os.path.join(PUB, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    strip.save(path, format="PNG", optimize=True)
    return {"bytes": os.path.getsize(path), "colors": len(strip.getcolors(maxcolors=512) or [])}


def font(size=14):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build_previews(manifest: dict) -> None:
    # тайлы
    sheet = Image.new("RGB", (4 * 72 + 5 * 10, 2 * 88 + 3 * 10 + 30), (5, 7, 14))
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), "M5b · terrain tiles 32×36 (Qwen source → pixel post, middle frame ×2)", fill=(232, 238, 247), font=font(14))
    for i, kind in enumerate(TILES):
        t = manifest["tiles"].get(kind)
        x, y = 10 + (i % 4) * 82, 30 + (i // 4) * 88
        if t:
            mid = min(t["frames"] - 1, t["frames"] // 2)
            im = Image.open(os.path.join(PUB, t["path"])).crop((mid * TILE_W, 0, (mid + 1) * TILE_W, TILE_H))
            bg = Image.new("RGB", (TILE_W, TILE_H), (10, 16, 32)); bg.paste(im, (0, 0), im)
            sheet.paste(bg.resize((64, 72), Image.NEAREST), (x, y))
        d.text((x, y + 74), kind + ("" if t else " · pending"), fill=(183, 194, 208), font=font(11))
    sheet.save(os.path.join(SHOTS, "battle-tiles.png"))
    # юниты
    sheet = Image.new("RGB", (8 * 136 + 10, 2 * 150 + 30), (5, 7, 14))
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), "M5b · units 64×64 (idle_0 ×2): player (top) / enemy (bottom) — Qwen sources", fill=(232, 238, 247), font=font(14))
    for row, faction in enumerate(("player", "enemy")):
        for col, cls in enumerate(CLASSES):
            u = manifest["units"].get(faction, {}).get(cls)
            x, y = 10 + col * 136, 30 + row * 150
            if u:
                im = Image.open(os.path.join(PUB, u["path"])).crop((0, 0, UNIT, UNIT))
                bg = Image.new("RGB", (UNIT, UNIT), (8, 12, 24)); bg.paste(im, (0, 0), im)
                sheet.paste(bg.resize((128, 128), Image.NEAREST), (x, y))
            d.text((x, y + 130), f"{faction[:1]}:{cls}" + ("" if u else " · pending"), fill=(183, 194, 208), font=font(11))
    sheet.save(os.path.join(SHOTS, "battle-units.png"))
    # эффекты
    sheet = Image.new("RGB", (6 * 72 + 7 * 8, 4 * 84 + 30), (5, 7, 14))
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), "M5b · effects 64×64, 6 frames (Qwen source → post)", fill=(232, 238, 247), font=font(14))
    for row, name in enumerate(EFFECTS):
        e = manifest["effects"].get(name)
        for f in range(6):
            x, y = 8 + f * 80, 30 + row * 84
            if e:
                im = Image.open(os.path.join(PUB, e["path"])).crop((f * UNIT, 0, (f + 1) * UNIT, UNIT))
                bg = Image.new("RGB", (UNIT, UNIT), (8, 12, 24)); bg.paste(im, (0, 0), im)
                sheet.paste(bg, (x, y))
        d.text((8, 30 + row * 84 + 66), name + ("" if e else " · pending"), fill=(183, 194, 208), font=font(11))
    sheet.save(os.path.join(SHOTS, "battle-effects.png"))
    # обзор
    sheet = Image.new("RGB", (1600, 900), (5, 7, 14))
    d = ImageDraw.Draw(sheet)
    d.text((16, 10), "M5b · арт «Сетки командования» (task-63): локальная Qwen-Image + пиксель-пост", fill=(232, 238, 247), font=font(16))
    for i, (name, file) in enumerate((("backdrop", "battle-backdrop.png"), ("battlefield-2d", "battlefield-2d.png"))):
        p = os.path.join(PUB, "bg", file)
        if os.path.exists(p):
            b = Image.open(p).convert("RGB")
            b.thumbnail((780, 440), Image.LANCZOS)
            sheet.paste(b, (16, 44 + i * 450))
            d.text((16, 44 + i * 450 + b.height + 4), "bg/" + file, fill=(183, 194, 208), font=font(12))
    sheet.save(os.path.join(SHOTS, "battle-preview.png"))


def main() -> int:
    sources = load_sources()
    manifest = {
        "version": 1,
        "part": "XV-b · grid battle",
        "generator": "qwen-image-2.1 (local ComfyUI) + pixel postprocess",
        "palette": PAL_HEX,
        "hex": {"orientation": "pointy-top", "frameW": TILE_W, "frameH": TILE_H, "anchor": [16, 18], "axial": True},
        "tiles": {}, "units": {"player": {}, "enemy": {}}, "effects": {}, "backgrounds": {},
        "pending": [],
    }
    process_tiles(sources, manifest)
    process_units(sources, manifest)
    process_effects(sources, manifest)
    process_backgrounds(sources, manifest)
    files = {}
    def walk():
        for t in manifest["tiles"].values():
            yield t
        for fac in manifest["units"].values():
            for u in fac.values():
                yield u
        for e in manifest["effects"].values():
            yield e
        for b in manifest["backgrounds"].values():
            yield b
    total = 0
    for a in walk():
        total += a.get("bytes", 0)
        files[a["path"]] = hashlib.sha256(open(os.path.join(PUB, a["path"]), "rb").read()).hexdigest()[:16]
    manifest["totalBytes"] = total
    manifest["sha256_16"] = files
    manifest["ready"] = len(manifest["pending"]) == 0
    with open(os.path.join(PUB, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    build_previews(manifest)
    print("ready:", len(manifest["tiles"]) + sum(len(v) for v in manifest["units"].values()) + len(manifest["effects"]) + len(manifest["backgrounds"]),
          "pending:", len(manifest["pending"]), "totalBytes:", total, flush=True)
    print("manifest:", os.path.join(PUB, "manifest.json"), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
