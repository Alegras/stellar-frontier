#!/usr/bin/env python3
"""
task-63 (M5b): пиксель-арт для «Сетки командования».
Процедурно, детерминированно, палитра проекта (PALETTE_HEX ≤32 на ассет).

Выход: apps/web/public/battle/**
  tiles/<kind>.png  32×36 frame strips (empty/dust/asteroid/nebula/mines/gravity/wreck)
  units/<faction>/<class>.png 64×64 strips, 6 кадров [idle0,idle1,move0,move1,attack0,attack1]
  effects/<name>.png 64×64 strips 6 кадров
  bg/*.png (генерируются отдельно Qwen-скриптом battle_backdrop.py)
  manifest.json (path/frameW/frameH/frames/fps/loop/anchor + palette + hex geometry)

Запуск: python tools/art-battle/generate_battle_art.py [--bg]
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import sys
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUB = os.path.join(ROOT, "apps", "web", "public", "battle")
SHOTS = os.path.join(ROOT, "docs", "shots")
PAL_HEX = [
    "#05070E", "#0A1020", "#101A2E", "#142038", "#1B2A4A", "#233A5C", "#2E4A70", "#38414F",
    "#5C6878", "#8C99A8", "#B7C2D0", "#E8EEF7", "#FFFFFF", "#F5C542", "#B8862A", "#6BE675",
    "#3FA35A", "#4FC3F7", "#2A7CA8", "#7A5CFF", "#FF5A5A", "#A33030", "#F08A24", "#FFCF6B",
    "#3A2B5C", "#6BE08A",
]
PAL = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in PAL_HEX]
(SPACE, SPACE_DEEP, SPACE_FAR, HULL_SHADE, NEB1, NEB2, NEB3, METAL_SHADOW,
 METAL2, METAL1, TEXT2, TEXT, WHITE, GOLD, GOLD_DARK, OK, OK_DARK, SHIELD, SHIELD_DARK,
 PSI, ENEMY, ENEMY_DARK, WARN, WARN_LIGHT, MIST, CHORUS) = PAL

TILE_W, TILE_H = 32, 36
UNIT = 64
CLASSES = ["corvette", "frigate", "destroyer", "cruiser", "battleship", "carrier", "titan", "colossus"]

TILES = {
    "empty":    dict(frames=1, fps=0, loop=False, kind="static"),
    "dust":     dict(frames=1, fps=0, loop=False, kind="dust"),
    "asteroid": dict(frames=4, fps=2, loop=True, kind="asteroid"),
    "nebula":   dict(frames=4, fps=2, loop=True, kind="nebula"),
    "mines":    dict(frames=6, fps=5, loop=True, kind="mines"),
    "gravity":  dict(frames=4, fps=2, loop=True, kind="gravity"),
    "wreck":    dict(frames=1, fps=0, loop=False, kind="wreck"),
}

EFFECTS = {
    "laser_shot": dict(frames=6, fps=12, loop=False),
    "kinetic_shot": dict(frames=6, fps=12, loop=False),
    "shield_hit": dict(frames=6, fps=12, loop=False),
    "death_explosion": dict(frames=6, fps=10, loop=False),
}

FACTIONS = {
    "player": dict(main=SHIELD, dark=SHIELD_DARK, glow=WHITE, hull_hi=TEXT2 if False else METAL1),
    "enemy": dict(main=ENEMY, dark=ENEMY_DARK, glow=WARN_LIGHT, hull_hi=METAL1),
}
FACTIONS["player"]["hull_hi"] = METAL1


def hex_points(w=TILE_W, h=TILE_H):
    cx, cy = w / 2.0, h / 2.0
    r = h / 2.0
    pts = []
    for i in range(6):
        ang = math.radians(60 * i - 90)
        pts.append((cx + r * math.cos(ang) * 0.94, cy + r * math.sin(ang)))
    return pts


HEX = hex_points()


def hex_mask():
    m = Image.new("L", (TILE_W, TILE_H), 0)
    ImageDraw.Draw(m).polygon([(round(x), round(y)) for x, y in HEX], fill=255)
    return m


HEX_MASK = hex_mask()


def tile_canvas():
    return Image.new("RGBA", (TILE_W, TILE_H), (0, 0, 0, 0))


def clip_hex(img: Image.Image) -> Image.Image:
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), HEX_MASK)
    return out


def px(img, x, y, color):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((int(x), int(y)), color + (255,) if len(color) == 3 else color)


def hex_edge(img, color=SPACE):
    # контур гекса 1 px
    d = ImageDraw.Draw(img)
    d.polygon([(round(x), round(y)) for x, y in HEX], outline=color + (255,), width=1)


# ------------------------------------------------------------------ TILES
def tile_frame(kind: str, frame: int, rnd: random.Random) -> Image.Image:
    img = tile_canvas()
    d = ImageDraw.Draw(img)
    if kind == "empty":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_DEEP + (255,))
        for _ in range(2):
            x, y = rnd.randrange(8, 25), rnd.randrange(8, 29)
            px(img, x, y, TEXT2)
        hex_edge(img)
    elif kind == "dust":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_FAR + (255,))
        for _ in range(7):
            x, y = rnd.randrange(6, 27), rnd.randrange(6, 31)
            px(img, x, y, rnd.choice([NEB3, METAL_SHADOW, NEB2]))
        hex_edge(img)
    elif kind == "asteroid":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_DEEP + (255,))
        n = 6
        for i in range(n):
            ang = frame * (2 * math.pi / 4) + i * (2 * math.pi / n)
            rad = 5 + (i % 3) * 3
            cx, cy = 16 + math.cos(ang) * rad * 0.7, 18 + math.sin(ang) * rad * 0.55
            size = 2 + (i % 3)
            d.ellipse([cx - size, cy - size, cx + size, cy + size], fill=METAL_SHADOW + (255,))
            d.ellipse([cx - size + 1, cy - size + 1, cx - size + 2, cy - size + 2], fill=METAL2 + (255,))
        hex_edge(img)
    elif kind == "nebula":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_DEEP + (255,))
        for i in range(14):
            x = 4 + (i * 7 + frame * 3) % 25
            y = 5 + (i * 11 + frame * 2) % 27
            px(img, x, y, rnd.choice([NEB1, NEB2, NEB3]))
        # пара «облачных» штрихов
        for i in range(3):
            y = 10 + i * 7 + (frame % 2)
            d.line([(7, y), (24, y + 1)], fill=NEB2 + (255,), width=1)
        hex_edge(img)
    elif kind == "mines":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_DEEP + (255,))
        pulse = [0, 1, 2, 1, 0, 1][frame % 6]
        for (mx, my) in ((10, 13), (20, 17), (14, 25)):
            px(img, mx, my, ENEMY_DARK)
            if pulse >= 1:
                px(img, mx + 1, my, WARN)
            if pulse >= 2:
                px(img, mx, my - 1, WARN_LIGHT)
                px(img, mx + 1, my - 1, WARN)
        hex_edge(img)
    elif kind == "gravity":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_FAR + (255,))
        for i in range(4):
            r = 3 + ((frame + i) % 4) * 2
            pts = [(16 + math.cos(a) * r, 18 + math.sin(a) * r * 0.8)
                   for a in [k * math.pi / 6 for k in range(12)]]
            col = MIST if (frame + i) % 2 == 0 else PSI
            for (x, y) in pts:
                px(img, round(x), round(y), col)
        hex_edge(img)
    elif kind == "wreck":
        d.polygon([(round(x), round(y)) for x, y in HEX], fill=SPACE_DEEP + (255,))
        for i in range(9):
            x, y = rnd.randrange(7, 25), rnd.randrange(8, 30)
            w = rnd.choice([1, 2, 3])
            d.rectangle([x, y, x + w, y + 1], fill=rnd.choice([METAL1, METAL2, METAL_SHADOW]) + (255,))
        hex_edge(img)
    return clip_hex(img)


# ------------------------------------------------------------------ UNITS
@dataclass(frozen=True)
class ShipProfile:
    body: tuple  # (x0,y0)-(x1,y1) центр x=32
    length: int
    width: int
    wings: str
    turrets: int
    engines: int


PROFILES = {
    "corvette":   ShipProfile((22, 30, 42, 46), 26, 12, "dart", 1, 2),
    "frigate":    ShipProfile((20, 28, 44, 46), 32, 14, "fins", 1, 2),
    "destroyer":  ShipProfile((18, 30, 46, 44), 38, 12, "spinal", 2, 3),
    "cruiser":    ShipProfile((17, 26, 47, 46), 40, 18, "block", 2, 3),
    "battleship": ShipProfile((14, 24, 50, 48), 46, 22, "heavy", 3, 4),
    "carrier":    ShipProfile((14, 26, 50, 44), 48, 20, "deck", 0, 4),
    "titan":      ShipProfile((10, 22, 54, 48), 54, 26, "ornate", 4, 5),
    "colossus":   ShipProfile((8, 20, 56, 52), 56, 32, "ring", 5, 6),
}


def hull_polygons(cls: str):
    """Возвращает (корпус, крылья) — списки полигонов в координатах 64×64."""
    p = PROFILES[cls]
    x0, y0, x1, y1 = p.body
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    body = [(cx, y0), (x1, y0 + (y1 - y0) * 0.35), (x1 - 3, y1), (cx, y1 + 2),
            (x0 + 3, y1), (x0, y0 + (y1 - y0) * 0.35)]
    wings = []
    if p.wings == "dart":
        wings = [[(x0 + 2, y0 + 6), (x0 - 4, y0 + 14), (x0 + 5, y0 + 12)],
                 [(x1 - 2, y0 + 6), (x1 + 4, y0 + 14), (x1 - 5, y0 + 12)]]
    elif p.wings == "fins":
        wings = [[(x0 + 2, y0 + 4), (x0 - 7, y0 + 16), (x0 + 6, y0 + 12)],
                 [(x1 - 2, y0 + 4), (x1 + 7, y0 + 16), (x1 - 6, y0 + 12)]]
    elif p.wings == "spinal":
        wings = [[(cx - 2, y0 - 8), (cx + 2, y0 - 8), (cx + 2, y0 + 6), (cx - 2, y0 + 6)],
                 [(x0 + 1, y0 + 8), (x0 - 6, y0 + 20), (x0 + 7, y0 + 14)],
                 [(x1 - 1, y0 + 8), (x1 + 6, y0 + 20), (x1 - 7, y0 + 14)]]
    elif p.wings == "block":
        wings = [[(x0 + 1, y0 + 6), (x0 - 6, y0 + 18), (x0 + 8, y0 + 16)],
                 [(x1 - 1, y0 + 6), (x1 + 6, y0 + 18), (x1 - 8, y0 + 16)]]
    elif p.wings == "heavy":
        wings = [[(x0 + 2, y0 + 2), (x0 - 8, y0 + 12), (x0 - 4, y0 + 22), (x0 + 8, y0 + 18)],
                 [(x1 - 2, y0 + 2), (x1 + 8, y0 + 12), (x1 + 4, y0 + 22), (x1 - 8, y0 + 18)]]
    elif p.wings == "deck":
        wings = [[(x0 + 2, y0 + 2), (x0 - 5, y0 + 10), (x0 + 8, y0 + 10)],
                 [(x1 - 2, y0 + 2), (x1 + 5, y0 + 10), (x1 - 8, y0 + 10)]]
    elif p.wings == "ornate":
        wings = [[(x0 + 2, y0), (x0 - 9, y0 + 14), (x0 - 3, y0 + 24), (x0 + 10, y0 + 18)],
                 [(x1 - 2, y0), (x1 + 9, y0 + 14), (x1 + 3, y0 + 24), (x1 - 10, y0 + 18)],
                 [(x0 + 4, y1 - 6), (x0 - 6, y1 + 2), (x0 + 12, y1)],
                 [(x1 - 4, y1 - 6), (x1 + 6, y1 + 2), (x1 - 12, y1)]]
    elif p.wings == "ring":
        wings = [[(x0, y0 + 4), (x0 - 8, y0 + 16), (x0 - 6, y1 + 2), (x0 + 6, y1)],
                 [(x1, y0 + 4), (x1 + 8, y0 + 16), (x1 + 6, y1 + 2), (x1 - 6, y1)]]
    return body, wings


def draw_unit(cls: str, faction: str, frame: int, rnd: random.Random) -> Image.Image:
    img = Image.new("RGBA", (UNIT, UNIT), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = FACTIONS[faction]
    body, wings = hull_polygons(cls)
    bob = [0, 1, -1, 1, 0, -1][frame % 6]
    bank = [0, 1, -1, 2, -2, 0][frame % 6]
    attack = frame >= 4
    dy = bob
    dx = bank if not attack else 1
    # крылья (тень)
    for w in wings:
        pts = [(x + dx, y + dy + 1) for (x, y) in w]
        d.polygon([(round(x), round(y)) for x, y in pts], fill=METAL_SHADOW + (255,))
        pts2 = [(x + dx, y + dy) for (x, y) in w]
        d.polygon([(round(x), round(y)) for x, y in pts2], fill=METAL2 + (255,))
        # акцент фракции на кромке крыла
        d.line([(round(pts2[0][0]), round(pts2[0][1])), (round(pts2[1][0]), round(pts2[1][1]))],
               fill=f["main"] + (255,), width=1)
    # корпус
    pts = [(x + dx, y + dy) for (x, y) in body]
    d.polygon([(round(x), round(y)) for x, y in pts], fill=METAL2 + (255,))
    d.polygon([(round(x), round(y)) for x, y in [(x + dx, y + dy) for (x, y) in body[:4]]], fill=METAL1 + (255,))
    # контур корпуса
    d.line([(round(x), round(y)) for x, y in pts + pts[:1]], fill=SPACE + (255,), width=1)
    # блик/панели
    d.line([(round(pts[3][0]), round(pts[3][1])), (round(pts[2][0]), round(pts[2][1]))], fill=TEXT2 + (255,), width=1)
    # акцентная полоса фракции
    d.line([(round(pts[1][0]), round(pts[1][1])), (round(pts[4][0]), round(pts[4][1]))], fill=f["dark"] + (255,), width=1)
    # башни
    for i in range(PROFILES[cls].turrets):
        tx = 26 + i * (12 / max(1, PROFILES[cls].turrets - 1)) if PROFILES[cls].turrets > 1 else 32
        ty = 38 + dy
        d.ellipse([tx - 2, ty - 2, tx + 2, ty + 2], fill=METAL_SHADOW + (255,))
        d.ellipse([tx - 1, ty - 1, tx + 1, ty + 1], fill=METAL1 + (255,))
        if attack:
            d.ellipse([tx - 1, ty - 3, tx + 1, ty - 1], fill=WARN_LIGHT + (255,))
    # двигатели: свечение зависит от кадра
    eng_scale = [1, 2, 3, 2, 1, 1][frame % 6]
    for i in range(PROFILES[cls].engines):
        ex = 24 + i * (16 / max(1, PROFILES[cls].engines - 1)) if PROFILES[cls].engines > 1 else 32
        ey = 46 + dy
        d.rectangle([ex - 1, ey, ex + 1, ey + 1], fill=METAL_SHADOW + (255,))
        d.rectangle([ex, ey + 1, ex + 1, ey + eng_scale], fill=f["main"] + (255,))
        px(img, ex, ey + eng_scale + 1, f["glow"])
    # выстрел/вспышка
    if attack:
        mx = int(pts[0][0])
        my = int(pts[0][1])
        d.ellipse([mx - 2, my - 3, mx + 2, my + 1], fill=f["glow"] + (255,))
        d.line([(mx, my - 4), (mx, my + 2)], fill=f["main"] + (255,), width=1)
        d.line([(mx - 3, my - 2), (mx + 3, my - 2)], fill=f["main"] + (255,), width=1)
    # count-бейдж не рисуем (UI), якорь снизу
    return img


# ------------------------------------------------------------------ EFFECTS
def effect_frame(name: str, frame: int) -> Image.Image:
    img = Image.new("RGBA", (UNIT, UNIT), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = 32, 32
    if name == "laser_shot":
        x = 6 + frame * 9
        for i, col in ((0, WHITE), (1, SHIELD)):
            d.rectangle([x - 8, cy - 2 + i, x, cy + 1 + i], fill=col + (255,))
        d.rectangle([x - 2, cy - 3, x + 2, cy + 2], fill=WHITE + (255,))
        d.point((x + 3, cy), fill=SHIELD + (255,))
    elif name == "kinetic_shot":
        x = 8 + frame * 8
        d.rectangle([x, cy - 1, x + 2, cy + 1], fill=WARN_LIGHT + (255,))
        d.rectangle([x + 2, cy - 1, x + 3, cy], fill=WARN + (255,))
        for i in range(3):
            d.point((x - 3 - i * 2, cy + (i % 2) * 2 - 1), fill=WARN + (255,))
    elif name == "shield_hit":
        r = 6 + frame * 5
        alpha = max(0, 255 - frame * 40)
        for k in range(0, 360, 30):
            a = math.radians(k)
            x = cx + math.cos(a) * r
            y = cy + math.sin(a) * r * 0.75
            px(img, round(x), round(y), SHIELD + (alpha,))
        for k in range(0, 360, 60):
            a = math.radians(k)
            px(img, round(cx + math.cos(a) * (r - 2)), round(cy + math.sin(a) * (r - 2) * 0.75), WHITE + (alpha,))
    elif name == "death_explosion":
        r = 4 + frame * 5
        cols = [WHITE, WARN_LIGHT, WARN, ENEMY, ENEMY_DARK]
        for i, col in enumerate(cols):
            rr = max(1, r - i * 2)
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=col + (max(0, 220 - frame * 35),), width=1)
        rnd = random.Random(777 + frame)
        for _ in range(10 + frame * 3):
            a = rnd.random() * math.pi * 2
            dist = rnd.random() * (6 + frame * 5)
            px(img, round(cx + math.cos(a) * dist), round(cy + math.sin(a) * dist * 0.85),
               rnd.choice([METAL1, METAL2, WARN_LIGHT, WARN]) + (255,))
    return img


# ------------------------------------------------------------------ BUILD
def save_strip(frames: list[Image.Image], path: str) -> dict:
    w, h = frames[0].size
    strip = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        strip.paste(fr, (i * w, 0))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    strip.save(path, format="PNG", optimize=True)
    return {"frameW": w, "frameH": h, "frames": len(frames), "bytes": os.path.getsize(path),
            "colors": len(strip.getcolors(maxcolors=4096) or [])}


def build_tiles(manifest: dict) -> None:
    rnd = random.Random(4242)
    for kind, spec in TILES.items():
        frames = [tile_frame(kind, f, random.Random(1000 + f)) for f in range(spec["frames"])]
        rel = f"tiles/{kind}.png"
        info = save_strip(frames, os.path.join(PUB, rel))
        manifest["tiles"][kind] = {
            "path": rel, "frameW": info["frameW"], "frameH": info["frameH"],
            "frames": info["frames"], "fps": spec["fps"], "loop": spec["loop"],
            "anchor": [16, 18], "bytes": info["bytes"], "colors": info["colors"],
        }


def build_units(manifest: dict) -> None:
    for faction in ("player", "enemy"):
        manifest["units"][faction] = {}
        for cls in CLASSES:
            frames = [draw_unit(cls, faction, f, random.Random(2000 + f)) for f in range(6)]
            rel = f"units/{faction}/{cls}.png"
            info = save_strip(frames, os.path.join(PUB, rel))
            manifest["units"][faction][cls] = {
                "path": rel, "frameW": info["frameW"], "frameH": info["frameH"],
                "frames": info["frames"], "fps": 6, "loop": True, "anchor": [32, 56],
                "frameOrder": ["idle_0", "idle_1", "move_0", "move_1", "attack_0", "attack_1"],
                "bytes": info["bytes"], "colors": info["colors"],
            }


def build_effects(manifest: dict) -> None:
    for name, spec in EFFECTS.items():
        frames = [effect_frame(name, f) for f in range(spec["frames"])]
        rel = f"effects/{name}.png"
        info = save_strip(frames, os.path.join(PUB, rel))
        manifest["effects"][name] = {
            "path": rel, "frameW": info["frameW"], "frameH": info["frameH"],
            "frames": info["frames"], "fps": spec["fps"], "loop": spec["loop"], "anchor": [32, 32],
            "bytes": info["bytes"], "colors": info["colors"],
        }


def font(size=14):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build_previews(manifest: dict) -> None:
    from PIL import ImageDraw as ID
    # tiles
    sheet = Image.new("RGB", (4 * 72 + 5 * 10, 2 * 88 + 3 * 10 + 30), (5, 7, 14))
    d = ID.Draw(sheet)
    d.text((10, 8), "M5b · terrain hex tiles 32×36 (middle frame ×2)", fill=(232, 238, 247), font=font(14))
    for i, kind in enumerate(TILES):
        rel = manifest["tiles"][kind]["path"]
        n = manifest["tiles"][kind]["frames"]
        mid = min(n - 1, n // 2)
        im = Image.open(os.path.join(PUB, rel)).crop((mid * 32, 0, (mid + 1) * 32, 36))
        bg = Image.new("RGB", (32, 36), (10, 16, 32)); bg.paste(im, (0, 0), im)
        x = 10 + (i % 4) * 82
        y = 30 + (i // 4) * 88
        sheet.paste(bg.resize((64, 72), Image.NEAREST), (x, y))
        d.text((x, y + 74), kind, fill=(183, 194, 208), font=font(11))
    sheet.save(os.path.join(SHOTS, "battle-tiles.png"))
    # units: player first frame ×2 (8 cols) + enemy row
    sheet = Image.new("RGB", (8 * 136 + 10, 2 * 150 + 30), (5, 7, 14))
    d = ID.Draw(sheet)
    d.text((10, 8), "M5b · units 64×64 (idle_0 ×2): player (top) / enemy (bottom)", fill=(232, 238, 247), font=font(14))
    for row, faction in enumerate(("player", "enemy")):
        for col, cls in enumerate(CLASSES):
            rel = manifest["units"][faction][cls]["path"]
            im = Image.open(os.path.join(PUB, rel)).crop((0, 0, 64, 64))
            bg = Image.new("RGB", (64, 64), (8, 12, 24)); bg.paste(im, (0, 0), im)
            x = 10 + col * 136
            y = 30 + row * 150
            sheet.paste(bg.resize((128, 128), Image.NEAREST), (x, y))
            d.text((x, y + 130), f"{faction[:1]}:{cls}", fill=(183, 194, 208), font=font(11))
    sheet.save(os.path.join(SHOTS, "battle-units.png"))
    # effects: 4 rows × 6 frames ×2
    cell = 64
    sheet = Image.new("RGB", (6 * cell + 7 * 8, 4 * (cell + 20) + 30), (5, 7, 14))
    d = ID.Draw(sheet)
    d.text((8, 8), "M5b · effects 64×64, 6 frames", fill=(232, 238, 247), font=font(14))
    for row, name in enumerate(EFFECTS):
        rel = manifest["effects"][name]["path"]
        for f in range(6):
            im = Image.open(os.path.join(PUB, rel)).crop((f * 64, 0, (f + 1) * 64, 64))
            bg = Image.new("RGB", (64, 64), (8, 12, 24)); bg.paste(im, (0, 0), im)
            x = 8 + f * (cell + 8)
            y = 30 + row * (cell + 20)
            sheet.paste(bg, (x, y))
        d.text((8, 30 + row * (cell + 20) + 66), name, fill=(183, 194, 208), font=font(11))
    sheet.save(os.path.join(SHOTS, "battle-effects.png"))
    # overview
    bgp = os.path.join(PUB, "bg", "battle-backdrop.png")
    sheet = Image.new("RGB", (1600, 760), (5, 7, 14))
    d = ID.Draw(sheet)
    d.text((16, 10), "M5b · арт «Сетки командования» (task-63): тайлы, юниты, эффекты, фон (Qwen)", fill=(232, 238, 247), font=font(16))
    if os.path.exists(bgp):
        bg = Image.open(bgp).convert("RGB").resize((960, 540), Image.LANCZOS)
        sheet.paste(bg, (16, 40))
    tu = Image.open(os.path.join(SHOTS, "battle-units.png")).convert("RGB").resize((600, 300), Image.LANCZOS)
    sheet.paste(tu, (990, 40))
    tt = Image.open(os.path.join(SHOTS, "battle-tiles.png")).convert("RGB").resize((600, 200), Image.LANCZOS)
    sheet.paste(tt, (990, 350))
    te = Image.open(os.path.join(SHOTS, "battle-effects.png")).convert("RGB").resize((600, 250), Image.LANCZOS)
    sheet.paste(te, (990, 560))
    d.text((16, 590), "bg/battle-backdrop.png 1920×1080", fill=(183, 194, 208), font=font(12))
    sheet.save(os.path.join(SHOTS, "battle-preview.png"))


def update_manifest(manifest: dict) -> None:
    total = 0
    hashes = {}
    for group in ("tiles",):
        pass
    def assets():
        for t in manifest["tiles"].values():
            yield t
        for fac in manifest["units"].values():
            for u in fac.values():
                yield u
        for e in manifest["effects"].values():
            yield e
        for b in manifest["backgrounds"].values():
            yield b
    for a in assets():
        total += a.get("bytes", 0)
        p = os.path.join(PUB, a["path"])
        if os.path.exists(p):
            hashes[a["path"]] = hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]
    manifest["totalBytes"] = total
    manifest["sha256_16"] = hashes
    with open(os.path.join(PUB, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def main() -> int:
    os.makedirs(PUB, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    manifest = {
        "version": 1,
        "part": "XV-b · grid battle",
        "palette": PAL_HEX,
        "hex": {"orientation": "pointy-top", "frameW": TILE_W, "frameH": TILE_H, "anchor": [16, 18], "axial": True},
        "tiles": {},
        "units": {},
        "effects": {},
        "backgrounds": {},
    }
    build_tiles(manifest)
    build_units(manifest)
    build_effects(manifest)
    # backgrounds (если уже сгенерированы Qwen-скриптом)
    for name, rel, w, h in (("backdrop", "bg/battle-backdrop.png", 1920, 1080),
                            ("battlefield2d", "bg/battlefield-2d.png", 640, 360)):
        p = os.path.join(PUB, rel)
        if os.path.exists(p):
            manifest["backgrounds"][name] = {"path": rel, "width": w, "height": h, "bytes": os.path.getsize(p)}
        else:
            manifest["backgrounds"][name] = {"path": rel, "width": w, "height": h, "bytes": 0, "pending": True}
    update_manifest(manifest)
    build_previews(manifest)
    print("tiles:", len(manifest["tiles"]), "units:", sum(len(v) for v in manifest["units"].values()),
          "effects:", len(manifest["effects"]), "totalBytes:", manifest["totalBytes"], flush=True)
    print("manifest:", os.path.join(PUB, "manifest.json"), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
