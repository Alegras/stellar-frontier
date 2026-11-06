
#!/usr/bin/env python3
"""
Часть XIV, task-34: пиксель-арт DLC «Первый Свет».

Генерирует детерминированно, только палитра проекта (docs/10_art_direction.md §3,
apps/web/src/render/contracts.ts PALETTE_HEX) + 2 служебных цвета Части XIII:
  - портреты 128x128, 6 эмоций (14b enum): neutral, warm, cold, angry, afraid, sad;
  - 2 карточки квестов 320x180 (главный + побочный), без запечённого текста;
  - фон станции «Свет-1» 640x360 (+ передний слой параллакса 640x48 с альфой);
  - комикс-панель 640x240 с чистыми зонами под DOM-бабблы.
Без сторонних ассетов: всё рисуется примитивами (пиксельные операции + Bayer 4x4).

Выход: apps/web/public/dlc/**, docs/shots/dlc-*.png (превью), manifest.json.
Запуск: python tools/art-dlc/generate_dlc_art.py
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import sys
import zlib
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DLC = os.path.join(ROOT, "apps", "web", "public", "dlc")
SHOTS = os.path.join(ROOT, "docs", "shots")

# --- палитра проекта (PALETTE_HEX) + 2 служебных цвета Части XIII (13d §1.5)
PAL = [
    "#05070E", "#0A1020", "#101A2E", "#142038", "#1B2A4A", "#233A5C", "#2E4A70", "#38414F",
    "#5C6878", "#8C99A8", "#B7C2D0", "#E8EEF7", "#FFFFFF", "#F5C542", "#B8862A", "#6BE675",
    "#3FA35A", "#4FC3F7", "#2A7CA8", "#7A5CFF", "#FF5A5A", "#A33030", "#F08A24", "#FFCF6B",
    "#3A2B5C", "#6BE08A",
]  # fmt: skip
HEX = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in PAL]

# именованные роли (индексы — как в render/system/palette.ts)
SPACE, SPACE_DEEP, SPACE_FAR, HULL_SHADE, NEB1, NEB2, NEB3, METAL_SHADOW = HEX[0:8]
METAL2, METAL1, TEXT2, TEXT, WHITE, GOLD, GOLD_DARK, OK, OK_DARK, SHIELD, SHIELD_DARK = HEX[8:19]
PSI, ENEMY, ENEMY_DARK, WARN, WARN_LIGHT, MIST, CHORUS = HEX[19:26]

BAYER4 = np.array([
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
], dtype=np.float32) / 16.0


def hx(c: str) -> tuple[int, int, int]:
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


class Painter:
    """Пиксельный холст: RGB-изображение + операции без сглаживания + дизеринг Bayer 4x4."""

    def __init__(self, w: int, h: int, fill=SPACE):
        self.w, self.h = w, h
        self.img = Image.new("RGB", (w, h), fill)
        self.d = ImageDraw.Draw(self.img)

    # --- примитивы (все координаты целые, inclusive-exclusive как у PIL)
    def rect(self, x0, y0, x1, y1, c):
        if x1 <= x0 or y1 <= y0:
            return
        self.d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=c)

    def hline(self, x0, x1, y, c, t=1):
        self.rect(x0, y, x1, y + t, c)

    def vline(self, x, y0, y1, c, t=1):
        self.rect(x, y0, x + t, y1, c)

    def line(self, pts, c, t=1):
        self.d.line(pts, fill=c, width=t)

    def poly(self, pts, c):
        self.d.polygon(pts, fill=c)

    def ellipse(self, x0, y0, x1, y1, c):
        self.d.ellipse([x0, y0, x1 - 1, y1 - 1], fill=c)

    def pixel(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.d.point((x, y), fill=c)

    def noise_rect(self, x0, y0, x1, y1, colors, prob, rnd: random.Random):
        for y in range(y0, y1):
            for x in range(x0, x1):
                if rnd.random() < prob:
                    self.pixel(x, y, rnd.choice(colors))

    # --- дизеринг: прямоугольник/полигон из двух цветов (Bayer 4x4)
    def dither_rect(self, x0, y0, x1, y1, c_a, c_b, level=0.5):
        self.dither_mask(self._rect_mask(x0, y0, x1, y1), c_a, c_b, level)

    def dither_poly(self, pts, c_a, c_b, level=0.5):
        mask = Image.new("L", (self.w, self.h), 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        self.dither_mask(mask, c_a, c_b, level)

    def _rect_mask(self, x0, y0, x1, y1):
        mask = Image.new("L", (self.w, self.h), 0)
        ImageDraw.Draw(mask).rectangle([x0, y0, x1 - 1, y1 - 1], fill=255)
        return mask

    def dither_mask(self, mask_img, c_a, c_b, level=0.5):
        arr = np.asarray(self.img).copy()
        m = np.asarray(mask_img) > 0
        yy, xx = np.mgrid[0:self.h, 0:self.w]
        bay = BAYER4[yy % 4, xx % 4]
        sel_b = m & (bay < level)
        sel_a = m & ~sel_b
        arr[sel_a] = c_a
        arr[sel_b] = c_b
        self.img = Image.fromarray(arr)
        self.d = ImageDraw.Draw(self.img)

    # --- контур силуэта 1 px: тёмный по альфа-границе маски фигуры
    def outline_mask(self, mask_img, color=SPACE):
        arr = np.asarray(self.img).copy()
        m = np.asarray(mask_img) > 0
        grown = np.zeros_like(m)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.zeros_like(m)
                ys = slice(max(0, dy), self.h + min(0, dy))
                xs = slice(max(0, dx), self.w + min(0, dx))
                yt = slice(max(0, -dy), self.h + min(0, -dy))
                xt = slice(max(0, -dx), self.w + min(0, -dx))
                shifted[ys, xs] = m[yt, xt]
                grown |= shifted
        edge = grown & ~m
        arr[edge] = color
        self.img = Image.fromarray(arr)
        self.d = ImageDraw.Draw(self.img)

    def save_png8(self, path: str, max_colors: int):
        """PNG-8: индексированная палитра из реально использованных цветов (без сглаживания)."""
        arr = np.asarray(self.img)
        flat = arr.reshape(-1, 3)
        uniq = [tuple(int(v) for v in c) for c in np.unique(flat, axis=0)]
        if len(uniq) > max_colors:
            raise RuntimeError(f"{os.path.basename(path)}: {len(uniq)} цветов > {max_colors}")
        index = {c: i for i, c in enumerate(uniq)}
        idx = np.array([index[tuple(int(v) for v in px)] for px in flat], dtype=np.uint8).reshape(self.h, self.w)
        out = Image.fromarray(idx, mode="P")
        pal = []
        for c in uniq:
            pal.extend(c)
        pal.extend([0] * (768 - len(pal)))
        out.putpalette(pal)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        out.save(path, format="PNG", optimize=True)
        return len(uniq)


# ------------------------------------------------------------------ ПОРТРЕТЫ
# --------------------------------------------------------------- ПОРТРЕТЫ (v2)
# Редизайн task-39: 4 персонажа × 6 эмоций, 128×128, единый пайплайн.
# Анатомия: 3/4-поворот, три плана лица (лоб/скула/челюсть), 4 тона кожи,
# светотень плоскостями + Bayer 4×4 только в переходах, hair masses (затылок/чёлка/пряди),
# rim light по дальнему контуру, аккуратные глаза (веко/белок/радужка/зрачок/блик),
# брови, нос, губы; эмоции — мимикой (брови/веки/рот/румянец/пот/слёзы), без запечённого текста.
# Референсы/техники: docs/ART-NOTES.md (CC0 Cyberpunk Portraits by Hyptosis — только обучение).

@dataclass(frozen=True)
class Person:
    id: str
    name: str
    role: str
    kind: str                      # soldier | synth | admiral | counselor
    skin: tuple                    # (light, base, shade, deep)
    hair: tuple                    # (light, base, shade)
    brow: tuple
    iris: tuple
    lips: tuple                    # (line, lower-lip light)
    cloth: tuple                   # (light, base, shade)
    accent: tuple
    accent2: tuple
    bg: tuple                      # (plate, glow)
    rim: tuple                     # цвет контрового света
    hair_style: str                # short_swept | bob | crop | long_veil
    extras: tuple = ()
    age: int = 40


def _mk(hexes):
    return tuple(hx(h) for h in hexes)


def _portrait_seed(person_id: str, emotion: str) -> int:
    return (zlib.crc32(person_id.encode("utf-8")) ^ zlib.crc32(emotion.encode("utf-8"))) & 0xFFFF


TEIRA = Person(
    id="teira_os", name="Тейра Ос", role="наставник, командор", kind="soldier",
    skin=_mk(["#DCA05C", "#B87434", "#8A4E1C", "#5C3410"]),
    hair=_mk(["#5C6878", "#233A5C", "#0A1020"]),
    brow=hx("#233A5C"),
    iris=hx("#B8862A"),
    lips=_mk(["#4A2410", "#C98B55"]),
    cloth=_mk(["#2E4A70", "#1B2A4A", "#0A1020"]),
    accent=hx("#F5C542"), accent2=hx("#B8862A"),
    bg=_mk(["#0A1020", "#233A5C"]),
    rim=hx("#B7C2D0"),
    hair_style="short_swept",
    extras=("scar", "neuro_port", "rank"),
    age=44,
)

KIRA = Person(
    id="kira7", name="Кира-7", role="диспетчер Свет-1", kind="synth",
    skin=_mk(["#E6F4FA", "#B9D4DF", "#86A8B8", "#3A5668"]),
    hair=_mk(["#5C6878", "#2E3A44", "#141C24"]),
    brow=hx("#233A5C"),
    iris=hx("#4FC3F7"),
    lips=_mk(["#1E5A7A", "#8CD4EE"]),
    cloth=_mk(["#2A7CA8", "#233A5C", "#0A1020"]),
    accent=hx("#4FC3F7"), accent2=hx("#2A7CA8"),
    bg=_mk(["#0A1020", "#142038"]),
    rim=hx("#4FC3F7"),
    hair_style="bob",
    extras=("earcom", "synth_seams", "synth_glow"),
    age=6,
)

KAIN = Person(
    id="admiral_kain", name="Адмирал Кейн Ордо", role="адмирал флота", kind="admiral",
    skin=_mk(["#EFE6D6", "#CDBBA0", "#A28D70", "#5E5040"]),
    hair=_mk(["#FFFFFF", "#E8EEF7", "#A9B4C2"]),
    brow=hx("#5C6878"),
    iris=hx("#8C99A8"),
    lips=_mk(["#5C6878", "#C8B48E"]),
    cloth=_mk(["#233A5C", "#142038", "#05070E"]),
    accent=hx("#F5C542"), accent2=hx("#B8862A"),
    bg=_mk(["#0A1020", "#1B2A4A"]),
    rim=hx("#F5C542"),
    hair_style="crop",
    extras=("cyber_eye", "rank", "ribbons", "scars_old"),
    age=57,
)

SELEN = Person(
    id="counselor_selen", name="Советник Селена Вэр", role="советник по стратегии", kind="counselor",
    skin=_mk(["#E4CCA4", "#C3A070", "#94704A", "#503A22"]),
    hair=_mk(["#7A5CFF", "#3A2B5C", "#141026"]),
    brow=hx("#2E2340"),
    iris=hx("#7A5CFF"),
    lips=_mk(["#4E2A33", "#D8A8A0"]),
    cloth=_mk(["#4B3A72", "#3A2B5C", "#141026"]),
    accent=hx("#4FC3F7"), accent2=hx("#B7C2D0"),
    bg=_mk(["#0A1020", "#3A2B5C"]),
    rim=hx("#7A5CFF"),
    hair_style="long_veil",
    extras=("circlet", "earcom"),
    age=46,
)

PEOPLE = [TEIRA, KIRA, KAIN, SELEN]
EMOTIONS = ["neutral", "warm", "cold", "angry", "afraid", "sad"]

# 3/4-силуэт лица (поворот к зрителю влево: дальняя сторона — справа)
FACE_PTS = [
    (45, 32), (47, 22), (54, 15), (62, 12), (71, 15), (79, 21), (84, 29), (86, 38),
    (86, 46), (83, 54), (79, 61), (74, 68), (68, 74), (61, 77), (54, 73), (48, 66),
    (44, 57), (42, 47), (43, 38),
]

EYE_L = (52, 46)   # ближний глаз (к зрителю), середина лица
EYE_R = (72, 45)   # дальний глаз (перспективно чуть меньше/выше)
NOSE_Y = 56
MOUTH_Y = 65


def _poly_mask(pts):
    m = Image.new("L", (128, 128), 0)
    ImageDraw.Draw(m).polygon([(int(x), int(y)) for (x, y) in pts], fill=255)
    return m


def _ellipse_mask(box):
    m = Image.new("L", (128, 128), 0)
    ImageDraw.Draw(m).ellipse([int(v) for v in box], fill=255)
    return m


def _union_masks(masks):
    acc = np.zeros((128, 128), dtype=np.uint8)
    for m in masks:
        acc = np.maximum(acc, np.asarray(m))
    return Image.fromarray(acc)


def _fill(p: "Painter", mask, color):
    arr = np.asarray(p.img).copy()
    arr[np.asarray(mask) > 0] = color
    p.img = Image.fromarray(arr)
    p.d = ImageDraw.Draw(p.img)


def _shade(p: "Painter", mask, base, shade, level):
    p.dither_mask(mask, base, shade, level)


def _bg(p: "Painter", person: Person) -> None:
    p.rect(0, 0, 128, 128, SPACE)
    for gy in range(0, 128, 16):
        for gx in range(0, 128, 16):
            p.dither_rect(gx, gy, gx + 16, gy + 16, SPACE, SPACE_DEEP, 0.22)
    p.dither_mask(_ellipse_mask((24, 0, 108, 112)), SPACE_DEEP, person.bg[1], 0.07)
    p.dither_mask(_ellipse_mask((32, 2, 100, 104)), SPACE_DEEP, person.bg[1], 0.12)
    p.dither_mask(_ellipse_mask((40, 8, 92, 96)), SPACE_DEEP, person.bg[1], 0.16)
    p.dither_rect(0, 114, 128, 128, SPACE, SPACE_DEEP, 0.45)
    p.dither_rect(0, 0, 128, 8, SPACE, SPACE_DEEP, 0.45)
    p.rect(0, 0, 128, 2, SPACE)
    p.rect(0, 126, 128, 128, SPACE)
    p.rect(0, 0, 2, 128, SPACE)
    p.rect(126, 0, 128, 128, SPACE)
    for (x, y) in ((2, 2), (124, 2), (2, 124), (124, 124)):
        p.pixel(x, y, METAL_SHADOW)


def _shoulders(p: "Painter", person: Person, emo: str):
    dy = 1 if emo == "afraid" else (-1 if emo == "sad" else 0)
    pts = [(6, 128), (14, 104 + dy), (28, 94 + dy), (46, 88 + dy), (82, 88 + dy),
           (100, 94 + dy), (114, 104 + dy), (116, 128)]
    m = _poly_mask(pts)
    _fill(p, m, person.cloth[1])
    _shade(p, _poly_mask([(6, 128), (14, 104 + dy), (28, 94 + dy), (44, 97 + dy), (44, 128)]),
           person.cloth[1], person.cloth[0], 0.5)
    _shade(p, _poly_mask([(94, 100 + dy), (106, 98 + dy), (118, 108 + dy), (116, 128), (100, 128), (96, 104 + dy)]),
           person.cloth[1], person.cloth[2], 0.55)
    if person.kind in ("soldier", "admiral"):
        collar = [(46, 88 + dy), (54, 78 + dy), (74, 78 + dy), (82, 88 + dy), (76, 98 + dy), (52, 98 + dy)]
        _fill(p, _poly_mask(collar), person.cloth[2])
        _shade(p, _poly_mask([(54, 86 + dy), (64, 100 + dy), (74, 86 + dy)]), person.cloth[2], person.accent2, 0.55)
        p.line([(47, 88 + dy), (55, 85 + dy), (73, 85 + dy), (81, 88 + dy)], person.accent, 1)
        _fill(p, _poly_mask([(14, 108 + dy), (26, 100 + dy), (30, 106 + dy), (18, 122 + dy)]), person.accent2)
        p.line([(16, 117 + dy), (27, 110 + dy)], person.accent, 1)
        _fill(p, _poly_mask([(98, 100 + dy), (112, 106 + dy), (108, 112 + dy), (94, 106 + dy)]), person.accent2)
        p.line([(97, 109 + dy), (110, 115 + dy)], person.accent, 1)
        if "rank" in person.extras:
            for i in range(3):
                p.rect(60 + i * 5, 90 + dy, 63 + i * 5, 93 + dy, person.accent if i < 2 else person.accent2)
        if "ribbons" in person.extras:
            for i, c in enumerate((ENEMY, OK, SHIELD)):
                p.rect(84 + i * 5, 92 + dy, 87 + i * 5, 95 + dy, c)
                p.pixel(85 + i * 5, 93 + dy, WHITE)
    elif person.kind == "synth":
        collar = [(44, 98 + dy), (50, 88 + dy), (78, 88 + dy), (84, 98 + dy), (78, 100 + dy), (50, 100 + dy)]
        _fill(p, _poly_mask(collar), person.cloth[2])
        p.line([(46, 98 + dy), (52, 90 + dy), (76, 90 + dy), (82, 98 + dy)], person.accent2, 1)
        _fill(p, _poly_mask([(90, 98 + dy), (104, 110 + dy), (102, 108 + dy), (88, 104 + dy)]), person.accent2)
        _fill(p, _poly_mask([(92, 100 + dy), (101, 111 + dy), (100, 106 + dy), (91, 111 + dy)]), person.accent)
        p.line([(34, 100 + dy), (44, 98 + dy)], person.accent2, 1)
        p.line([(84, 100 + dy), (94, 104 + dy)], person.accent2, 1)
    else:  # counselor: высокий воротник-стойка, плащ
        collar = [(42, 100 + dy), (48, 82 + dy), (80, 82 + dy), (86, 100 + dy), (80, 106 + dy), (48, 106 + dy)]
        _fill(p, _poly_mask(collar), person.cloth[0])
        _shade(p, _poly_mask([(48, 78 + dy), (64, 100 + dy), (80, 78 + dy)]), person.cloth[0], person.cloth[1], 0.5)
        p.line([(44, 99 + dy), (49, 78 + dy), (79, 78 + dy), (84, 99 + dy)], person.accent2, 1)
        p.line([(52, 104 + dy), (64, 106 + dy), (76, 104 + dy)], person.accent2, 1)
        p.pixel(64, 98 + dy, person.accent)
        p.pixel(64, 100 + dy, person.accent)
        p.rect(62, 100 + dy, 66, 103 + dy, person.accent2)
        p.rect(63, 101 + dy, 65, 94 + dy, WHITE)
    p.line([(34, 112 + dy), (32, 128)], person.cloth[2], 1)
    p.line([(94, 110 + dy), (97, 128)], person.cloth[2], 1)
    return m


def _neck(p: "Painter", person: Person):
    # короткая широкая шея с трапециями: подбородок ~77, плечи ~88
    m = _poly_mask([(52, 70), (76, 70), (82, 92), (46, 92)])
    _fill(p, m, person.skin[1])
    # тень справа (дальняя сторона) и АО под челюстью — солидными плоскостями
    _fill(p, _poly_mask([(64, 70), (76, 70), (82, 92), (64, 92)]), person.skin[2])
    _fill(p, _poly_mask([(52, 70), (64, 70), (64, 79), (52, 79)]), person.skin[2])
    _fill(p, _poly_mask([(52, 84), (76, 84), (82, 92), (46, 92)]), person.skin[2])
    p.line([(64, 70), (64, 84)], person.skin[2], 1)
    # трапеции к плечам (сглаживают «шею-цилиндр»)
    _fill(p, _poly_mask([(46, 82), (52, 76), (52, 92), (42, 96)]), person.skin[1])
    _fill(p, _poly_mask([(76, 76), (82, 82), (86, 96), (76, 92)]), person.skin[2])
    return m


def _back_hair(p: "Painter", person: Person):
    style = person.hair_style
    if style == "short_swept":
        pts = [(38, 48), (35, 30), (41, 16), (52, 8), (70, 8), (82, 14), (89, 26), (89, 44),
               (85, 36), (81, 22), (68, 15), (54, 17), (45, 25), (41, 37)]
    elif style == "bob":
        pts = [(36, 64), (33, 34), (38, 16), (52, 6), (70, 6), (84, 12), (92, 28), (92, 48),
               (88, 68), (83, 52), (82, 26), (68, 16), (52, 18), (44, 30), (41, 52)]
    elif style == "crop":
        pts = [(42, 36), (43, 22), (50, 13), (62, 9), (74, 12), (83, 20), (86, 32),
               (83, 29), (79, 19), (67, 14), (55, 17), (47, 24), (44, 33)]
    else:  # long_veil
        pts = [(34, 74), (31, 38), (37, 16), (52, 6), (70, 5), (84, 11), (92, 28), (92, 58),
               (97, 86), (90, 88), (86, 64), (84, 40), (79, 18), (64, 11), (50, 14), (42, 26),
               (38, 48), (40, 74)]
    m = _poly_mask(pts)
    _fill(p, m, person.hair[1])
    _fill(p, _poly_mask([(38, 34), (42, 18), (54, 10), (66, 11), (60, 18), (48, 24), (42, 38)]), person.hair[0])
    _fill(p, _poly_mask([(74, 16), (86, 26), (89, 44), (85, 36), (81, 24), (77, 20)]), person.hair[2])
    if person.hair_style == "long_veil":
        _shade(p, _poly_mask([(34, 50), (38, 74), (44, 86), (38, 86), (33, 60)]), person.hair[1], person.hair[2], 0.5)
        _shade(p, _poly_mask([(88, 44), (92, 58), (97, 84), (90, 86), (86, 60)]), person.hair[1], person.hair[2], 0.5)
        _fill(p, _poly_mask([(84, 26), (87, 30), (88, 58), (92, 84), (88, 84), (85, 58), (83, 32)]), person.hair[0])
        p.line([(86, 32), (88, 56), (91, 80)], person.accent, 1)
    return m


def _face(p: "Painter", person: Person, emo: str):
    tilt = -1 if emo == "afraid" else (1 if emo == "sad" else 0)
    pts = [(x, y + tilt) for (x, y) in FACE_PTS]
    m = _poly_mask(pts)
    _fill(p, m, person.skin[1])

    # --- объёмная светотень: нормаль «полусферы» лица, свет сверху-слева,
    #     квантование в 4 тона кожи с Bayer 4×4 (структурный дизеринг, не «шум»)
    arr = np.asarray(p.img).copy()
    mask = np.asarray(m) > 0
    ys, xs = np.mgrid[0:128, 0:128]
    cy = 44 + tilt
    nx = (xs - 63.0) / 23.0
    ny = (ys - cy) / 26.0
    nz = np.sqrt(np.clip(1.0 - nx * nx - ny * ny, 0.0, 1.0))
    d = -nx * 0.45 - ny * 0.52 + nz * 0.72          # ламберт: свет сверху-слева
    d -= np.where(ys < 30 + tilt, 0.12, 0.0)        # АО от волос
    d -= np.where(ys > 68 + tilt, 0.14, 0.0)        # тень челюсти/шеи
    d -= np.where((xs > 76) & (ys > 42 + tilt), 0.06, 0.0)  # дальняя щека
    # скула-блик и лоб
    d += np.where(((xs - 50.0) ** 2 / 40.0 + (ys - (52 + tilt)) ** 2 / 18.0) < 1.0, 0.10, 0.0)
    v = np.clip((d - 0.02) / 0.9, 0.0, 1.0)
    tones = np.array([person.skin[3], person.skin[2], person.skin[1], person.skin[0]], dtype=np.uint8)
    idx = np.digitize(v, [0.18, 0.46, 0.72]).astype(np.int32)
    for k in range(4):
        sel = mask & (idx == k)
        arr[sel] = tones[k]
    edge = (mask & (idx == 1) & (np.roll(idx, 1, axis=1) == 2)) | (mask & (idx == 2) & (np.roll(idx, 1, axis=1) == 1))
    arr[edge] = person.skin[2]
    p.img = Image.fromarray(arr)
    p.d = ImageDraw.Draw(p.img)

    # --- линия челюсти 1 px и блик подбородка
    p.line([(69, 69 + tilt), (73, 66 + tilt), (71, 71 + tilt), (65, 74 + tilt)], person.skin[2], 1)
    p.pixel(61, 72 + tilt, person.skin[0])
    # 1 px тёмный контур по правому краю лица (объём)
    p.line([(84, 32 + tilt), (85, 41 + tilt), (82, 51 + tilt), (77, 59 + tilt), (72, 66 + tilt)], person.skin[3], 1)
    return m


def _ear(p: "Painter", person: Person):
    m = _poly_mask([(38, 40), (44, 38), (45, 48), (42, 55), (38, 53), (37, 46)])
    _fill(p, m, person.skin[1])
    _fill(p, _poly_mask([(38, 42), (42, 41), (43, 49), (39, 52)]), person.skin[2])
    p.line([(40, 43), (41, 50)], person.skin[2], 1)
    p.pixel(39, 45, person.skin[0])
    return m


def _front_hair(p: "Painter", person: Person):
    style = person.hair_style
    if style == "short_swept":
        pts = [(43, 23), (50, 14), (62, 11), (74, 13), (80, 19), (75, 21), (64, 19), (54, 22), (47, 26)]
        m = _poly_mask(pts)
        _fill(p, m, person.hair[1])
        # блик — узкая полоса, не «шлем»
        _fill(p, _poly_mask([(47, 20), (52, 15), (58, 14), (60, 18), (52, 20), (48, 23)]), person.hair[0])
        _fill(p, _poly_mask([(76, 16), (80, 20), (79, 26), (76, 22)]), person.hair[0])
        p.line([(50, 19), (58, 16)], person.hair[0], 1)
        # линия роста волос: пара тёмных штрихов у лба
        p.pixel(52, 22, person.hair[2])
        p.pixel(59, 21, person.hair[2])
        p.pixel(56, 20, person.hair[2])
        if person.age >= 40:
            for i in range(3):
                p.line([(76 + i, 18), (78 + i, 26)], person.hair[0], 1)
        return m
    if style == "bob":
        pts = [(44, 22), (50, 12), (64, 10), (78, 13), (84, 20), (80, 28), (70, 24), (56, 25), (48, 28)]
        m = _poly_mask(pts)
        _fill(p, m, person.hair[1])
        _fill(p, _poly_mask([(56, 12), (66, 11), (70, 22), (58, 25), (54, 20)]), person.hair[2])
        p.line([(64, 11), (63, 22)], person.hair[2], 1)
        p.line([(50, 16), (58, 13)], person.hair[0], 1)
        _fill(p, _poly_mask([(40, 28), (45, 26), (47, 52), (43, 60), (39, 54)]), person.hair[1])
        _fill(p, _poly_mask([(84, 26), (89, 30), (88, 56), (84, 62), (83, 50)]), person.hair[1])
        p.line([(43, 30), (42, 50)], person.hair[2], 1)
        p.line([(86, 32), (86, 52)], person.hair[2], 1)
        return m
    if style == "crop":
        pts = [(44, 32), (45, 20), (52, 13), (63, 10), (74, 13), (81, 21), (82, 30), (78, 26),
               (70, 18), (58, 18), (48, 24)]
        m = _poly_mask(pts)
        _fill(p, m, person.hair[1])
        _fill(p, _poly_mask([(46, 28), (47, 20), (56, 14), (68, 12), (78, 18), (72, 20), (58, 18), (49, 24)]), person.hair[0])
        p.line([(50, 20), (60, 16)], person.hair[0], 1)
        _fill(p, _poly_mask([(40, 30), (44, 28), (45, 46), (41, 48)]), person.hair[1])
        _fill(p, _poly_mask([(84, 28), (88, 32), (88, 48), (84, 50)]), person.hair[1])
        return m
    pts = [(44, 20), (52, 10), (64, 7), (76, 11), (84, 19), (80, 26), (70, 20), (58, 20), (48, 26)]
    m = _poly_mask(pts)
    _fill(p, m, person.hair[1])
    _fill(p, _poly_mask([(56, 12), (62, 9), (64, 24), (56, 26), (54, 20)]), person.hair[2])
    _fill(p, _poly_mask([(66, 9), (76, 12), (80, 22), (72, 24), (66, 20)]), person.hair[0])
    p.line([(64, 9), (63, 24)], person.hair[2], 1)
    _fill(p, _poly_mask([(38, 28), (43, 25), (45, 54), (42, 70), (37, 66), (36, 44)]), person.hair[1])
    _fill(p, _poly_mask([(37, 30), (41, 27), (43, 52), (39, 60)]), person.hair[2])
    _fill(p, _poly_mask([(83, 26), (87, 32), (88, 54), (91, 78), (86, 76), (84, 48)]), person.hair[1])
    p.line([(85, 34), (88, 60), (91, 78)], person.hair[0], 1)
    _fringe_over_forehead(p, person, style)
    return m


def _lower_hairline(p: "Painter", person: Person, style: str):
    """Опускает линию роста волос на 2–3 px: лоб не «маска», а нормальная треть лица."""
    if style == "short_swept":
        band = [(44, 25), (52, 20), (64, 19), (76, 21), (80, 24), (72, 27), (60, 25), (50, 28), (45, 28)]
    elif style == "bob":
        band = [(45, 26), (64, 25), (80, 25), (82, 29), (64, 30), (47, 30)]
    elif style == "crop":
        band = [(46, 30), (54, 23), (64, 21), (75, 24), (80, 31), (70, 28), (57, 29)]
    else:
        band = [(47, 26), (55, 21), (64, 20), (75, 22), (79, 26), (70, 25), (58, 26), (49, 29)]
    _fill(p, _poly_mask(band), person.hair[1])
    # тёмная кромка волос и пара штрихов — «волосы, а не шапка»
    p.line([(band[0][0] + 2, band[0][1] + 1), (band[1][0], band[1][1] + 1)], person.hair[2], 1)
    p.line([(band[3][0] - 2, band[3][1] + 1), (band[2][0], band[2][1] + 1)], person.hair[2], 1)


def _fringe_over_forehead(p: "Painter", person: Person, style: str):
    """Чёлка/пряди ниже линии роста волос: солидная форма + чёткая кромка (без точек на коже)."""
    if style == "short_swept":
        fringe = [(44, 26), (49, 21), (58, 19), (69, 21), (78, 26), (80, 31),
                  (72, 29), (66, 33), (58, 30), (51, 33), (46, 31)]
    elif style == "bob":
        fringe = [(44, 24), (54, 23), (65, 23), (78, 24), (82, 30), (74, 34),
                  (64, 32), (52, 34), (45, 31)]
    elif style == "crop":
        fringe = [(45, 30), (51, 25), (60, 23), (70, 25), (78, 29), (81, 33),
                  (71, 31), (60, 34), (50, 34)]
    else:
        fringe = [(46, 27), (53, 23), (62, 22), (73, 24), (79, 28), (74, 32),
                  (66, 30), (56, 33), (48, 33)]
    _fill(p, _poly_mask(fringe), person.hair[1])
    # блик на чёлке — 2 коротких штриха
    p.line([(50, 23), (57, 21)], person.hair[0], 1)
    p.line([(66, 22), (72, 24)], person.hair[0], 1)
    # чёткая кромка: 1 px тёмного контура по зигзагу
    p.line([(45, 31), (52, 33), (59, 30), (66, 33), (73, 29), (79, 31)], person.hair[2], 1)
    p.pixel(48, 30, person.hair[2])
    p.pixel(68, 30, person.hair[2])


def _eye(p: "Painter", person: Person, center, w: int, h: int, gaze: int, lid: int, far: bool):
    cx, cy = center
    h = max(4, h)
    # глазница: лёгкая тень над глазом
    p.line([(cx - w // 2 - 1, cy - 2), (cx, cy - 3), (cx + w // 2 + 1, cy - 2)], person.skin[2], 1)
    # контур: миндаль с приподнятыми уголками
    outer = [(cx - w // 2, cy + 2), (cx - w // 2 + 2, cy + 1), (cx, cy),
             (cx + w // 2 - 2, cy + 1), (cx + w // 2, cy + 2),
             (cx + w // 2 - 2, cy + h), (cx, cy + h + 1), (cx - w // 2 + 2, cy + h)]
    _fill(p, _poly_mask(outer), SPACE_DEEP)
    # белок (светлый, 2 px по высоте): полный при испуге, иначе 2 px по центру
    sclera = person.skin[0] if person.kind != "synth" else hx("#DDF2FA")
    _fill(p, _poly_mask([(cx - w // 2 + 1, cy + 2), (cx + w // 2 - 1, cy + 2),
                         (cx + w // 2 - 2, cy + h - 1), (cx - w // 2 + 2, cy + h - 1)]), sclera)
    # радужка 3×4 + зрачок 2×2 + блик
    ix = cx + gaze
    iy = cy + 1
    _fill(p, _poly_mask([(ix - 1, iy), (ix + 1, iy), (ix + 1, iy + 3), (ix - 1, iy + 3)]), person.iris)
    p.rect(ix, iy + 1, ix + 1, iy + 3, SPACE_DEEP)
    p.pixel(ix + 1, iy, WHITE if person.kind != "synth" else person.accent)
    p.pixel(ix - 1, iy + 2, person.accent if person.kind == "synth" else person.skin[2])
    # верхнее веко: 2 px + ресничная линия
    _fill(p, _poly_mask([(cx - w // 2 + 1, cy + 1), (cx + w // 2 - 1, cy + 1),
                         (cx + w // 2 - 2, cy + 2), (cx - w // 2 + 2, cy + 2)]),
          person.skin[2])
    p.line([(cx - w // 2, cy + 2), (cx, cy), (cx + w // 2, cy + 2)], person.skin[3], 1)
    # нижнее веко 1 px
    p.line([(cx - w // 2 + 2, cy + h), (cx, cy + h + 1), (cx + w // 2 - 2, cy + h)], person.skin[2], 1)


def _brow(p: "Painter", person: Person, x0: int, x1: int, y0: int, y1: int, thick: int):
    pts = [(x0, y0), (x1, y1), (x1, y1 + thick), (x0 + 1, y0 + thick - 1)]
    _fill(p, _poly_mask(pts), person.brow)
    p.pixel(x0, y0 + thick, person.brow)
    p.pixel(x0 + 1, y0 + thick + 1, person.brow)


def _nose(p: "Painter", person: Person, tilt: int):
    # мягкий нос: тень переносицы справа, 2 px блика на кончике, ноздри и тень основания
    p.line([(66, 42 + tilt), (66, 50 + tilt)], person.skin[2], 1)
    p.line([(61, 46 + tilt), (61, 51 + tilt)], person.skin[0], 1)
    p.line([(60, 54 + tilt), (64, 55 + tilt)], person.skin[0], 1)
    p.line([(57, 55 + tilt), (69, 55 + tilt)], person.skin[1], 1)
    p.pixel(58, 54 + tilt, person.skin[3])
    p.pixel(68, 54 + tilt, person.skin[3])
    p.line([(59, 56 + tilt), (68, 56 + tilt)], person.skin[2], 1)


def _mouth(p: "Painter", person: Person, cy: int, corners: int, width: int, open_h: int, full: bool):
    x0 = 63 - width // 2
    x1 = 63 + width // 2
    if open_h > 0:
        pts = [(x0, cy + corners), (63, cy + 1), (x1, cy + corners),
               (x1 - 1, cy + corners + open_h), (63, cy + open_h + 1), (x0 + 1, cy + corners + open_h)]
        _fill(p, _poly_mask(pts), hx("#2A0F14") if person.kind != "synth" else person.skin[3])
        p.line([(x0 + 2, cy + corners), (63, cy + 1), (x1 - 2, cy + corners)], WHITE, 1)
        p.line([(x0 + 3, cy + corners + open_h), (63, cy + open_h), (x1 - 3, cy + corners + open_h)], person.lips[0], 1)
        return
    if full:
        p.line([(x0, cy + corners), (63, cy + 1), (x1, cy + corners)], person.lips[0], 1)
        p.line([(x0 + 2, cy + 2 + corners), (63, cy + 3), (x1 - 2, cy + 2 + corners)], person.lips[1], 1)
        p.line([(x0 + 3, cy + 3 + corners), (63, cy + 4), (x1 - 3, cy + 3 + corners)], person.skin[2], 1)
        p.pixel(x0, cy + corners, person.skin[2])
        p.pixel(x1, cy + corners, person.skin[2])
    else:
        p.line([(x0, cy + corners), (63, cy + 1), (x1, cy + corners)], person.lips[0], 1)
        p.line([(x0 + 2, cy + 2 + corners), (63, cy + 3), (x1 - 2, cy + 2 + corners)], person.lips[1], 1)


def _features(p: "Painter", person: Person, emo: str):
    tilt = -1 if emo == "afraid" else (1 if emo == "sad" else 0)
    ey = EYE_L[1] + tilt
    if emo == "warm":
        brow_in, brow_out, thick = -2, -1, 2
        eye_l, eye_r, lid, gaze = 5, 4, 0, 0
        corners, width, open_h = 2, 10, 0
        full = True
    elif emo == "cold":
        brow_in, brow_out, thick = 0, -1, 2
        eye_l, eye_r, lid, gaze = 6, 5, 1, 2
        corners, width, open_h = 0, 10, 0
        full = False
    elif emo == "angry":
        brow_in, brow_out, thick = 3, -2, 2
        eye_l, eye_r, lid, gaze = 5, 4, 2, 0
        corners, width, open_h = -2, 9, 0
        full = True
    elif emo == "afraid":
        brow_in, brow_out, thick = -4, -6, 2
        eye_l, eye_r, lid, gaze = 8, 7, 0, 0
        corners, width, open_h = 0, 8, 2
        full = True
    elif emo == "sad":
        brow_in, brow_out, thick = -3, 2, 2
        eye_l, eye_r, lid, gaze = 6, 5, 1, 0
        corners, width, open_h = -2, 9, 0
        full = True
    else:
        brow_in, brow_out, thick = -1, -1, 2
        eye_l, eye_r, lid, gaze = 7, 6, 0, 0
        corners, width, open_h = 0, 10, 0
        full = True

    _brow(p, person, 45, 59, ey - 6 + brow_out, ey - 6 + brow_in, thick)
    _brow(p, person, 81, 68, ey - 6 + brow_out, ey - 6 + brow_in, thick)
    if emo == "angry":
        p.line([(60, ey - 5), (67, ey - 5)], person.skin[2], 1)
        p.line([(61, ey - 4), (66, ey - 4)], person.skin[3], 1)
    if emo == "sad":
        p.line([(46, ey - 4), (58, ey - 6)], person.skin[2], 1)
        _fill(p, _poly_mask([(46, ey + 5), (58, ey + 6), (58, ey + 8), (46, ey + 8)]), person.skin[2])
        _fill(p, _poly_mask([(68, ey + 5), (80, ey + 6), (80, ey + 8), (68, ey + 8)]), person.skin[2])

    _eye(p, person, (EYE_L[0], ey), 13, eye_l, gaze, lid, far=False)
    _eye(p, person, (EYE_R[0], ey - 1), 11, eye_r, gaze, lid, far=True)

    _nose(p, person, tilt)
    _mouth(p, person, MOUTH_Y + tilt, corners, width, open_h, full)

    if emo == "warm":
        _fill(p, _poly_mask([(43, 52 + tilt), (51, 54 + tilt), (50, 59 + tilt), (43, 58 + tilt)]), person.skin[0])
        _fill(p, _poly_mask([(73, 50 + tilt), (81, 52 + tilt), (80, 57 + tilt), (73, 56 + tilt)]),
              person.accent if person.kind != "synth" else person.skin[0])
        p.pixel(48, 60 + tilt, person.skin[0])
    if emo == "afraid":
        p.rect(84, 32, 86, 37, SHIELD)
        p.pixel(85, 33, WHITE)
        p.rect(44, 50, 45, 55, SHIELD)
        p.pixel(44, 51, WHITE)
    if emo == "sad":
        p.rect(80, 46, 81, 50, SHIELD)
        p.pixel(80, 50, WHITE)
    if emo == "cold":
        p.line([(58, 61 + tilt), (68, 61 + tilt)], person.skin[2], 1)
    if emo == "angry":
        _fill(p, _poly_mask([(43, 50 + tilt), (51, 53 + tilt), (50, 57 + tilt), (43, 56 + tilt)]), person.skin[2])


def _extras(p: "Painter", person: Person, emo: str):
    if "scar" in person.extras:
        scar_color = person.skin[0] if emo != "angry" else person.skin[1]
        p.line([(45, 40), (53, 33)], scar_color, 1)
        p.line([(46, 41), (54, 34)], person.skin[2], 1)
        p.pixel(48, 36, person.skin[3])
    if "neuro_port" in person.extras:
        p.rect(82, 30, 86, 34, METAL_SHADOW)
        p.rect(83, 31, 85, 33, METAL2)
        p.pixel(84, 32, person.accent)
        p.dither_rect(88, 28, 94, 30, SPACE_DEEP, person.accent, 0.3)
    if "cyber_eye" in person.extras:
        p.line([(67, 39), (81, 39), (84, 42)], person.accent2, 1)
        p.line([(67, 48), (81, 48), (84, 45)], person.accent2, 1)
        p.pixel(83, 42, person.accent)
        p.pixel(83, 45, person.accent)
        p.line([(84, 42), (84, 45)], person.accent2, 1)
    if "earcom" in person.extras:
        p.rect(83, 40, 89, 52, person.cloth[2])
        p.rect(85, 42, 88, 50, person.accent2)
        p.pixel(86, 44, person.accent)
        p.line([(87, 53), (84, 59), (76, 62)], person.cloth[2], 1)
        p.rect(74, 61, 78, 63, person.accent2)
        p.pixel(75, 62, person.accent)
    if "circlet" in person.extras:
        p.line([(48, 25), (56, 21), (64, 20), (72, 21), (80, 25)], person.accent2, 1)
        p.rect(62, 19, 66, 23, person.accent2)
        p.rect(63, 20, 65, 22, person.accent)
        p.pixel(64, 20, WHITE)
    if "synth_seams" in person.extras:
        p.line([(50, 56), (53, 61), (52, 69)], person.accent2, 1)
        p.line([(70, 67), (72, 73)], person.accent2, 1)
        p.pixel(51, 64, person.accent)
    if "synth_glow" in person.extras:
        p.line([(44, 44), (44, 53), (47, 63), (52, 72)], person.accent, 1)
    if person.age >= 55:
        # возрастные линии: лоб, «гусиные лапки», носогубные складки (тонко, без грязи)
        p.line([(48, 32), (60, 31)], person.skin[2], 1)
        p.line([(50, 35), (62, 34)], person.skin[2], 1)
        p.pixel(68, 32, person.skin[2])
        p.line([(43, 44), (45, 46)], person.skin[2], 1)
        p.line([(82, 47), (84, 49)], person.skin[2], 1)
        p.line([(58, 58), (55, 63)], person.skin[2], 1)
        p.line([(70, 58), (72, 62)], person.skin[2], 1)
    if "scars_old" in person.extras:
        p.line([(76, 26), (79, 31)], person.skin[2], 1)
        p.line([(74, 58), (78, 62)], person.skin[2], 1)
        p.pixel(75, 59, person.skin[3])


def _rim(p: "Painter", person: Person):
    rim_pts = [(86, 36), (86, 45), (82, 54), (78, 61), (73, 68), (66, 75)]
    p.line(rim_pts, person.rim, 1)
    p.pixel(87, 40, WHITE)
    p.pixel(86, 48, person.rim)
    # внешний край дальнего плеча — 3 px, не линия через грудь
    p.line([(114, 110), (120, 122)], person.rim, 1)
    if person.kind == "admiral":
        p.pixel(87, 34, person.accent)


def draw_portrait(person: Person, emotion: str, seed: int) -> Painter:
    p = Painter(128, 128, SPACE)
    _bg(p, person)
    masks = [_shoulders(p, person, emotion)]
    masks.append(_neck(p, person))
    masks.append(_back_hair(p, person))
    masks.append(_face(p, person, emotion))
    masks.append(_ear(p, person))
    masks.append(_front_hair(p, person))
    _features(p, person, emotion)
    _extras(p, person, emotion)
    _rim(p, person)
    silhouette = _union_masks(masks)
    p.outline_mask(silhouette, SPACE)
    return p


# --------------------------------------------------------- HD-рендер портретов
# Рисуем сцену в 4× разрешении (512×512) с плавной светотенью и кривыми,
# затем уменьшаем до 128 и квантуем в палитру проекта (≤32 цвета, без дизеринга).
S = 4  # масштаб суперсэмплинга

SKIN_TONES = {
    "teira_os": (hx("#E8B06A"), hx("#C98B45"), hx("#9A5F26"), hx("#5C3410")),
    "kira7": (hx("#EAF7FC"), hx("#C6DEE8"), hx("#8FB0C0"), hx("#3A5668")),
    "admiral_kain": (hx("#F0E8D8"), hx("#D6C7AE"), hx("#AA9878"), hx("#5E5040")),
    "counselor_selen": (hx("#E8D2B0"), hx("#C9A87E"), hx("#96734E"), hx("#4E3620")),
}

PALETTE_HD = [hx(h) for h in PAL]  # 26 базовых цветов проекта


def _p(x, y):
    return int(round(x * S)), int(round(y * S))


def _poly(*pts):
    return [ _p(x, y) for (x, y) in pts ]


def _ellipse(box):
    return [int(round(v * S)) for v in box]


def _bezier(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1]
        out.append((x, y))
    return out


def _smooth_poly(pts, closed=True):
    """Скругление ломаной: вставляет квадратичные сглаживания по соседним точкам (для силуэтов)."""
    out = []
    n = len(pts)
    for i in range(n):
        p0 = pts[i - 1]
        p1 = pts[i]
        p2 = pts[(i + 1) % n] if closed else pts[min(i + 1, n - 1)]
        out.append(p1)
        if closed or i < n - 1:
            for t in (0.33, 0.67):
                x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p1[0]
                y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p1[1]
                x2 = (1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * p2[0] + t * t * p2[0]
                y2 = (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * p2[1] + t * t * p2[1]
                out.append(((x + x2) / 2, (y + y2) / 2))
    return out


def _hd_render(person: Person, emo: str, seed: int) -> Image.Image:
    from PIL import ImageFilter
    import math

    W = 128 * S
    img = Image.new("RGB", (W, W), SPACE)
    dr = ImageDraw.Draw(img)
    skin = SKIN_TONES[person.id]
    cx, ey = 63.0, 45.0
    tilt = -1 if emo == "afraid" else (1 if emo == "sad" else 0)
    ey += tilt

    # ------------------------------------------------ фон: плашка + мягкое свечение
    bg = np.zeros((W, W, 3), dtype=np.float32)
    bg[:, :] = SPACE
    yy, xx = np.mgrid[0:W, 0:W]
    gx, gy = 63.0 * S, 44.0 * S
    r = np.sqrt(((xx - gx) / (34 * S)) ** 2 + ((yy - gy) / (38 * S)) ** 2)
    glow = np.clip(1 - r, 0, 1) ** 1.6
    for k in range(3):
        bg += np.stack([glow * person.bg[1][k] / 255.0 * 0.30] * 3, axis=-1)
    # тонкий паттерн 16×16 (диагональ)
    pat = ((xx // (16 * S) + yy // (16 * S)) % 2 == 0)
    bg[pat] *= 1.06
    bg = np.clip(bg, 0, 255)
    img = Image.fromarray(bg.astype(np.uint8))
    dr = ImageDraw.Draw(img, "RGBA")
    # рамка
    dr.rectangle([0, 0, W - 1, W - 1], outline=SPACE, width=int(round(2 * S)))
    dr.rectangle([2 * S, 2 * S, W - 2 * S, W - 2 * S], outline=(*METAL_SHADOW, 255), width=int(round(1 * S)))
    for (qx, qy) in ((2, 2), (124, 2), (2, 124), (124, 124)):
        dr.rectangle([qx * S - 2, qy * S - 2, qx * S + 2, qy * S + 2], fill=(*METAL_SHADOW, 255))

    # ------------------------------------------------ маски (в 512)
    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)

    shoulders = _smooth_poly([(4, 128), (10, 112), (24, 100), (44, 92), (62, 88), (78, 88), (100, 94),
                              (116, 106), (124, 128)])
    md.polygon(_poly(*shoulders) if False else [_p(x, y) for (x, y) in shoulders], fill=255)
    head_pts = [(43, 40), (43, 30), (47, 21), (54, 15), (62, 12.5), (71, 15), (79, 21), (85, 29),
                (86, 38), (85, 47), (81, 56), (77, 64), (72, 71), (66, 76), (60, 77.5), (54, 73), (48, 65),
                (44, 56), (42, 48)]
    md.polygon([_p(x, y + tilt) for (x, y) in head_pts], fill=255)
    mask_neck = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask_neck).polygon([_p(56, 66), _p(72, 66), _p(75, 82), _p(53, 82)], fill=255)
    mask_sh = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask_sh).polygon([_p(x, y) for (x, y) in shoulders], fill=255)
    mask_head = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask_head).polygon([_p(x, y + tilt) for (x, y) in head_pts], fill=255)

    # ------------------------------------------------ волосы (задняя масса) — маски
    style = person.hair_style
    if style == "short_swept":
        back = [(40, 46), (37, 30), (42, 17), (52, 9), (64, 7), (77, 11), (86, 20), (89, 33), (88, 44),
                (84, 36), (78, 22), (64, 16), (52, 19), (44, 28), (41, 40)]
        fringe = [(45, 25), (50, 18), (58, 14), (68, 15), (77, 20), (81, 28), (77, 33), (68, 30), (58, 32),
                  (50, 30), (46, 32)]
        sburns = [((40, 34), (43, 32), (44, 50), (41, 52)), ((86, 32), (89, 34), (88, 50), (85, 52))]
    elif style == "bob":
        back = [(38, 62), (34, 34), (39, 17), (52, 8), (65, 7), (80, 12), (89, 24), (92, 44), (89, 64),
                (84, 50), (81, 24), (66, 16), (51, 19), (43, 32), (40, 50)]
        fringe = [(44, 24), (52, 18), (64, 15), (76, 18), (83, 25), (80, 31), (70, 33), (58, 32), (47, 32), (44, 29)]
        sburns = [((39, 30), (44, 28), (45, 56), (41, 58)), ((84, 28), (89, 32), (88, 58), (84, 56))]
    elif style == "crop":
        back = [(43, 34), (44, 22), (51, 14), (62, 10), (74, 13), (82, 21), (85, 31), (80, 26), (68, 18), (56, 19), (47, 25)]
        fringe = [(46, 28), (52, 22), (62, 19), (72, 22), (79, 27), (81, 32), (71, 29), (61, 31), (51, 30)]
        sburns = [((41, 28), (44, 27), (45, 44), (42, 45)), ((84, 27), (88, 30), (88, 44), (84, 45))]
    else:  # long_veil
        back = [(36, 70), (32, 38), (38, 16), (52, 7), (65, 6), (80, 11), (90, 25), (92, 52), (98, 82),
                (90, 84), (85, 58), (82, 30), (64, 18), (50, 22), (41, 38), (40, 66)]
        fringe = [(46, 27), (53, 20), (62, 17), (73, 20), (80, 27), (75, 32), (66, 29), (56, 31), (48, 32)]
        sburns = [((39, 30), (44, 26), (46, 62), (40, 64)), ((84, 26), (89, 30), (91, 66), (85, 64))]
    mask_hair = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask_hair).polygon(_smooth_poly(back) and [_p(x, y) for (x, y) in _smooth_poly(back)], fill=255)

    # ------------------------------------------------ тело: одежда с мягким градиентом
    cloth = np.array(img).astype(np.float32)
    sh_np = np.asarray(mask_sh) > 0
    # базовый цвет одежды + вертикальный градиент
    t = np.clip((yy / (128 * S)), 0, 1)
    base = np.array(person.cloth[1], dtype=np.float32)
    light = np.array(person.cloth[0], dtype=np.float32)
    dark = np.array(person.cloth[2], dtype=np.float32)
    grad = np.where((xx < W * 0.45), 0.30, 0.12)
    cloth_col = base + (light - base) * (1 - t)[..., None] * grad[..., None] - (base - dark) * t[..., None] * 0.35
    cloth[sh_np] = np.clip(cloth_col[sh_np], 0, 255)
    img = Image.fromarray(cloth.astype(np.uint8))
    dr = ImageDraw.Draw(img, "RGBA")

    # воротник/погоны/акценты — по типу персонажа
    if person.kind in ("soldier", "admiral"):
        collar = [(46, 92), (53, 80), (75, 80), (82, 92), (77, 104), (52, 104)]
        dr.polygon([_p(x, y) for (x, y) in collar], fill=(*person.cloth[2], 255))
        dr.polygon([_p(x, y) for (x, y) in [(55, 84), (64, 100), (74, 84)]], fill=(*person.accent2, 120))
        dr.line([_p(47, 91), _p(54, 81), _p(74, 81), _p(81, 91)], fill=(*person.accent, 255), width=int(round(1 * S)))
        for (a, b) in (((14, 116), (27, 108)), ((98, 108), (112, 116))):
            dr.polygon([_p(a[0], a[1]), _p(a[0] + 12, a[1] - 7), _p(a[0] + 15, a[1] + 1), _p(a[0] + 3, a[1] + 8)],
                       fill=(*person.accent2, 255))
        if "rank" in person.extras:
            for i in range(3):
                dr.rectangle(_ellipse((60 + i * 5, 88, 63 + i * 5, 91)), fill=(*person.accent, 255))
        if "ribbons" in person.extras:
            for i, c in enumerate((ENEMY, OK, SHIELD)):
                dr.rectangle(_ellipse((84 + i * 5, 90, 87 + i * 5, 93)), fill=(*c, 255))
    elif person.kind == "synth":
        collar = [(44, 96), (50, 86), (78, 86), (84, 96), (78, 106), (50, 106)]
        dr.polygon([_p(x, y) for (x, y) in collar], fill=(*person.cloth[2], 255))
        dr.line([_p(46, 96), _p(52, 88), _p(76, 88), _p(82, 96)], fill=(*person.accent2, 255), width=int(round(1 * S)))
        dr.polygon([_p(90, 104), _p(104, 108), _p(102, 114), _p(88, 110)], fill=(*person.accent2, 255))
        dr.polygon([_p(92, 106), _p(101, 109), _p(100, 112), _p(91, 109)], fill=(*person.accent, 255))
    else:
        collar = [(42, 98), (48, 80), (80, 80), (86, 98), (80, 114), (48, 114)]
        dr.polygon([_p(x, y) for (x, y) in collar], fill=(*person.cloth[0], 255))
        dr.line([_p(44, 97), _p(49, 82), _p(79, 82), _p(84, 97)], fill=(*person.accent2, 255), width=int(round(1 * S)))
        dr.line([_p(52, 102), _p(64, 113), _p(76, 102)], fill=(*person.accent2, 255), width=int(round(1 * S)))
        dr.rectangle(_ellipse((62, 98, 66, 101)), fill=(*person.accent2, 255))
    # складки ткани (мягкие)
    for (a, b) in (((34, 118), (32, 128)), ((94, 116), (97, 128)), ((48, 116), (52, 128))):
        dr.line([_p(*a), _p(*b)], fill=(*person.cloth[2], 200), width=int(round(1 * S)))

    # ------------------------------------------------ шея + тень под подбородком
    neck_col = np.array(person.skin[2], dtype=np.float32)
    neck_np = np.asarray(mask_neck) > 0
    body = np.asarray(img).astype(np.float32)
    # градиент шеи: светлее слева, тень справа и под челюстью
    nxg = np.clip((xx - 50 * S) / (30 * S), 0, 1)
    nyg = np.clip((yy - 68 * S) / (24 * S), 0, 1)
    tone = np.clip(0.55 - nxg * 0.35 - nyg * 0.25, 0, 1)
    neck_rgb = np.array(person.skin[1], dtype=np.float32) + (neck_col - np.array(person.skin[1])) * (1 - tone)[..., None]
    body[neck_np] = neck_rgb[neck_np]
    img = Image.fromarray(body.astype(np.uint8))
    dr = ImageDraw.Draw(img, "RGBA")
    # (тень под челюстью добавляется 1 px линией после квантования в 128)

    # ------------------------------------------------ волосы: заливка + градиент/блик
    hair_np = np.asarray(mask_hair) > 0
    arr = np.asarray(img).astype(np.float32)
    hbase = np.array(person.hair[1], dtype=np.float32)
    hlight = np.array(person.hair[0], dtype=np.float32)
    hdark = np.array(person.hair[2], dtype=np.float32)
    # свет сверху-слева
    hx_ = np.clip((xx - 40 * S) / (60 * S), 0, 1)
    hy_ = np.clip((yy - 6 * S) / (70 * S), 0, 1)
    hl = np.clip(0.9 - hx_ * 0.55 - hy_ * 0.65, 0, 1)
    hcol = hbase + (hlight - hbase) * hl[..., None] * 0.38 - (hbase - hdark) * np.clip(hy_ - 0.45, 0, 1)[..., None] * 0.9
    arr[hair_np] = np.clip(hcol[hair_np], 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))
    dr = ImageDraw.Draw(img, "RGBA")

    # ------------------------------------------------ лицо: скин-градиент по нормали
    fnp = np.asarray(mask_head) > 0
    arr = np.asarray(img).astype(np.float32)
    rx, ry = 24.5 * S, 25.0 * S
    ncx, ncy = 63 * S, (43 + tilt) * S
    NX = (xx - ncx) / rx
    NY = (yy - ncy) / ry
    NZ = np.sqrt(np.clip(1 - NX * NX - NY * NY, 0, 1))
    lam = -NX * 0.42 - NY * 0.50 + NZ * 0.76
    lam = lam - np.clip((yy - (62 + tilt) * S) / (14 * S), 0, 1) * 0.25   # челюсть
    lam = lam - np.clip(((yy < (30 + tilt) * S) & (xx > 45 * S)).astype(float), 0, 1) * 0.10
    # cheekbone highlight
    lam = lam + np.exp(-(((xx - 50 * S) / (9 * S)) ** 2 + ((yy - (52 + tilt) * S) / (6 * S)) ** 2)) * 0.18
    v = np.clip((lam - 0.12) / 0.78, 0, 1)
    s0, s1, s2, s3 = [np.array(c, dtype=np.float32) for c in skin]
    # гладкая смесь тонов
    vv = v[..., None]
    lo = np.where(vv < 0.33, s2 + (s1 - s2) * (vv / 0.33), s1 + (s0 - s1) * np.clip((vv - 0.33) / 0.67, 0, 1))
    lo2 = np.where(vv < 0.18, s3 + (s2 - s3) * (vv / 0.18), lo)
    arr[fnp] = np.clip(lo2[fnp], 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))
    dr = ImageDraw.Draw(img, "RGBA")

    # ------------------------------------------------ уши (мягкие)
    dr.ellipse(_ellipse((39, 39, 46, 56)), fill=(*person.skin[1], 255))
    dr.ellipse(_ellipse((41, 43, 44, 53)), fill=(*person.skin[2], 255))
    dr.line([_p(42, 44), _p(42, 51)], fill=(*person.skin[3], 255), width=int(round(1 * S)))

    # ------------------------------------------------ чёлка (поверх лица), блик
    fr = Image.new("L", (W, W), 0)
    ImageDraw.Draw(fr).polygon([_p(x, y) for (x, y) in _smooth_poly(fringe)], fill=255)
    arr = np.asarray(img).astype(np.float32)
    hf = np.asarray(fr) > 0
    fcol = hbase + (hlight - hbase) * np.clip(0.95 - ((xx - 44 * S) / (48 * S)) * 0.8, 0, 1)[..., None]
    arr[hf] = np.clip(fcol[hf], 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))
    dr = ImageDraw.Draw(img, "RGBA")
    # бакенбарды
    for quad in sburns:
        dr.polygon([_p(x, y) for (x, y) in _smooth_poly(quad)], fill=(*person.hair[1], 255))
    # седина/пси-прядь
    if person.id == "teira_os":
        for i in range(3):
            dr.line([_p(76 + i, 20), _p(78 + i, 29)], fill=(*person.hair[0], 255), width=int(round(1 * S)))
    if person.id == "counselor_selen":
        for i in range(4):
            dr.line([_p(84 + i * 0.4, 26 + i), _p(86 + i * 0.4, 48 + i * 3)], fill=(*person.accent, 255), width=int(round(1 * S)))

    # ------------------------------------------------ черты лица
    P = {"neutral": dict(bi=-1, bo=-1, bt=2, h=6, lid=1, gz=0, mw=10, mc=0, mo=0),
         "warm": dict(bi=-2, bo=-1, bt=2, h=6, lid=1, gz=0, mw=10, mc=2, mo=0),
         "cold": dict(bi=0, bo=-1, bt=2, h=5, lid=2, gz=2, mw=10, mc=0, mo=0),
         "angry": dict(bi=3, bo=-2, bt=3, h=4, lid=2, gz=0, mw=9, mc=-2, mo=0),
         "afraid": dict(bi=-4, bo=-6, bt=2, h=8, lid=0, gz=0, mw=8, mc=0, mo=3),
         "sad": dict(bi=-3, bo=2, bt=2, h=6, lid=2, gz=0, mw=9, mc=-2, mo=0)}[emo]
    eyl, eyr = 53, 72
    # брови: толстая кисть с наклоном (в 512 — плавно)
    def brow(x0, x1, y0, y1, thick):
        pts = [(x0, y0 + thick), (x0 + (x1 - x0) * 0.35, y0 - 0.4 + thick * 0.6),
               (x1, y1 + thick * 0.4), (x1, y1), (x0 + (x1 - x0) * 0.3, y0 - 0.6), (x0, y0)]
        sp = _smooth_poly(pts)
        dr.polygon([_p(x, y) for (x, y) in sp], fill=(*person.brow, 255))
    by = ey + tilt - 6
    brow(45, 59, by + P["bo"], by + P["bi"], P["bt"])
    brow(81, 68, by + P["bo"], by + P["bi"], P["bt"])

    def eye(cxx, cyy, w, h, gz, lid, far):
        # глазная щель: белок (эллипс), радужка, зрачок, блик
        dr.ellipse(_ellipse((cxx - w / 2, cyy - h / 2, cxx + w / 2, cyy + h / 2)), fill=(*TEXT, 255))
        # верхнее веко — толстая дуга
        dr.arc(_ellipse((cxx - w / 2 - 0.5, cyy - h / 2 - 1.2, cxx + w / 2 + 0.5, cyy + h / 2 + 0.8)),
               start=190, end=350, fill=(*person.skin[3], 255), width=max(2, int(1.4 * S)))
        # радужка и зрачок
        ix, iy = cxx + gz, cyy + 0.2
        ir = h * 0.42
        dr.ellipse(_ellipse((ix - ir, iy - ir, ix + ir, iy + ir)), fill=(*person.iris, 255))
        dr.ellipse(_ellipse((ix - ir * 0.45, iy - ir * 0.45, ix + ir * 0.45, iy + ir * 0.45)), fill=(*SPACE_DEEP, 255))
        dr.ellipse(_ellipse((ix + ir * 0.2, iy - ir * 0.55, ix + ir * 0.55, iy - ir * 0.2)), fill=(*WHITE, 255))
        if person.kind == "synth":
            dr.arc(_ellipse((cxx - w / 2, cyy - h / 2, cxx + w / 2, cyy + h / 2)), start=200, end=340,
                   fill=(*person.accent, 255), width=int(round(1 * S)))
        # нижнее веко
        dr.arc(_ellipse((cxx - w / 2, cyy - h / 2 - 0.6, cxx + w / 2, cyy + h / 2 + 1.4)),
               start=10, end=170, fill=(*person.skin[2], 255), width=int(round(1 * S)))
        # ресницы
        dr.line([_p(cxx - w / 2 - 0.6, cyy), _p(cxx - w / 2 + 0.6, cyy + 0.4)], fill=(*person.skin[3], 255), width=int(round(1 * S)))
        dr.line([_p(cxx + w / 2 - 0.6, cyy), _p(cxx + w / 2 + 0.6, cyy + 0.4)], fill=(*person.skin[3], 255), width=int(round(1 * S)))

    eye(eyl, ey, 10, P["h"] * 0.75, P["gz"], P["lid"], False)
    eye(eyr, ey - 1, 9, P["h"] * 0.75, P["gz"], P["lid"], True)

    # нос: мягкая тень + кончик + ноздри
    dr.line([_p(65.5, ey + 3), _p(66.5, ey + 9)], fill=(*person.skin[2], 200), width=int(round(1 * S)))
    dr.line([_p(61, ey + 10), _p(66, ey + 11)], fill=(*person.skin[0], 230), width=int(round(1.4 * S)))
    dr.line([_p(59.2, ey + 10.5), _p(67.5, ey + 10.5)], fill=(*person.skin[2], 230), width=int(round(1 * S)))
    dr.ellipse(_ellipse((59.5, ey + 9.5, 60.7, ey + 10.8)), fill=(*person.skin[3], 255))
    dr.ellipse(_ellipse((66.2, ey + 9.5, 67.4, ey + 10.8)), fill=(*person.skin[3], 255))

    # рот
    my = ey + 17
    if P["mo"] > 0:
        dr.ellipse(_ellipse((63 - P["mw"] / 2, my - 1, 63 + P["mw"] / 2, my + P["mo"])), fill=(*hx("#2A0F14"), 255))
        dr.line([_p(63 - P["mw"] / 2 + 1, my - 0.5), _p(63 + P["mw"] / 2 - 1, my - 0.5)], fill=(*WHITE, 255), width=int(round(1 * S)))
        dr.line([_p(63 - P["mw"] / 2, my - 1.2), _p(63 + P["mw"] / 2, my - 1.2)], fill=(*person.lips[0], 255), width=int(round(1.2 * S)))
    else:
        # линия губ: уголки вверх/вниз
        pts = [(63 - P["mw"] / 2, my + P["mc"]), (63 - P["mw"] / 4, my - 0.5), (63, my - 0.8),
               (63 + P["mw"] / 4, my - 0.5), (63 + P["mw"] / 2, my + P["mc"])]
        dr.line([_p(x, y) for (x, y) in pts], fill=(*person.lips[0], 255), width=int(round(1.6 * S)))
        # нижняя губа (светлая)
        dr.line([_p(63 - P["mw"] / 2 + 1, my + P["mc"] + 1.4), _p(63, my + 1.8), _p(63 + P["mw"] / 2 - 1, my + P["mc"] + 1.4)],
                fill=(*person.lips[1], 255), width=int(round(1.2 * S)))
        dr.line([_p(63 - P["mw"] / 2 + 2, my + P["mc"] + 2.6), _p(63 + P["mw"] / 2 - 2, my + P["mc"] + 2.6)],
                fill=(*person.skin[2], 160), width=int(round(1 * S)))

    # эмоциональные акценты
    if emo == "warm":
        for c in (50, 76):
            dr.ellipse(_ellipse((c - 4, ey + 8, c + 4, ey + 12)), fill=(*person.skin[0], 110))
    if emo == "afraid":
        dr.ellipse(_ellipse((84, 33, 86, 38)), fill=(*SHIELD, 220))
        dr.ellipse(_ellipse((44, 50, 45.5, 55)), fill=(*SHIELD, 200))
    if emo == "sad":
        dr.ellipse(_ellipse((80, 48, 81, 52)), fill=(*SHIELD, 200))
        dr.line([_p(46, ey + 6), _p(58, ey + 7)], fill=(*person.skin[2], 160), width=int(round(1 * S)))
    if emo == "angry":
        dr.line([_p(60, ey - 4), _p(66, ey - 4)], fill=(*person.skin[2], 220), width=int(round(1 * S)))

    # ------------------------------------------------ доп. детали
    if "scar" in person.extras:
        dr.line([_p(45, 40), _p(53, 33)], fill=(*person.skin[0], 255), width=int(round(1.2 * S)))
        dr.line([_p(46, 41), _p(54, 34)], fill=(*person.skin[2], 200), width=int(round(1 * S)))
    if "neuro_port" in person.extras:
        dr.rectangle(_ellipse((82, 30, 86, 34)), fill=(*METAL_SHADOW, 255))
        dr.rectangle(_ellipse((83, 31, 85, 33)), fill=(*METAL2, 255))
        dr.rectangle(_ellipse((83.6, 31.6, 84.6, 32.6)), fill=(*person.accent, 255))
    if "cyber_eye" in person.extras:
        dr.arc(_ellipse((eyr - 6.5, ey - 6, eyr + 6.5, ey + 6)), start=0, end=360,
               fill=(*person.accent2, 255), width=int(round(1.2 * S)))
        dr.line([_p(77, 39), _p(84, 39)], fill=(*person.accent2, 255), width=int(round(1 * S)))
    if "earcom" in person.extras:
        dr.rectangle(_ellipse((83, 40, 89, 52)), fill=(*person.cloth[2], 255))
        dr.rectangle(_ellipse((85, 42, 88, 50)), fill=(*person.accent2, 255))
        dr.line([_p(87, 53), _p(84, 59), _p(76, 62)], fill=(*person.cloth[2], 255), width=int(round(1.4 * S)))
        dr.rectangle(_ellipse((74, 61, 78, 63)), fill=(*person.accent, 255))
    if "circlet" in person.extras:
        dr.arc(_ellipse((44, 12, 84, 34)), start=200, end=340, fill=(*person.accent2, 255), width=int(round(1.2 * S)))
        dr.polygon([_p(62, 20), _p(66, 20), _p(65, 24), _p(63, 24)], fill=(*person.accent, 255))
    if "synth_seams" in person.extras:
        dr.line([_p(50, 52), _p(52, 58), _p(51, 66)], fill=(*person.accent2, 220), width=int(round(1 * S)))
        dr.line([_p(70, 60), _p(72, 68)], fill=(*person.accent2, 220), width=int(round(1 * S)))
    if "synth_glow" in person.extras:
        dr.line([_p(43.5, 44), _p(43.5, 53), _p(47, 62), _p(52, 70)], fill=(*person.accent, 180), width=int(round(1 * S)))
    if person.age >= 55:
        dr.line([_p(48, 32), _p(60, 31)], fill=(*person.skin[2], 200), width=int(round(1 * S)))
        dr.line([_p(50, 35), _p(62, 34)], fill=(*person.skin[2], 170), width=int(round(1 * S)))
        dr.line([_p(58, 58), _p(55, 64)], fill=(*person.skin[2], 170), width=int(round(1 * S)))
        dr.line([_p(70, 58), _p(72, 63)], fill=(*person.skin[2], 170), width=int(round(1 * S)))

    # ------------------------------------------------ контровой свет по правому контуру
    sil = Image.new("L", (W, W), 0)
    sd = ImageDraw.Draw(sil)
    sd.polygon([_p(x, y + tilt) for (x, y) in head_pts], fill=255)
    sd.polygon([_p(x, y) for (x, y) in _smooth_poly(back)], fill=255)
    sd.polygon([_p(x, y) for (x, y) in shoulders], fill=255)
    sil_arr = np.asarray(sil) > 0
    edge = np.zeros_like(sil_arr)
    shifted = np.roll(sil_arr, -1, axis=1)
    edge |= sil_arr & ~shifted
    rim_col = np.array(person.rim, dtype=np.float32)
    arr = np.asarray(img).astype(np.float32)
    arr[edge] = np.clip(arr[edge] * 0.25 + rim_col * 0.75, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))


    # ------------------------------------------------ даунскейл 512 → 128 и квантование в палитру
    small = img.resize((128, 128), Image.Resampling.LANCZOS)
    # палитра: PALETTE_HD + 4 тона кожи (≤32 цветов)
    palette = []
    for c in PALETTE_HD + list(skin):
        t = tuple(int(v) for v in c)
        if t not in palette:
            palette.append(t)
    if len(palette) > 32:
        palette = palette[:32]
    pal_img = Image.new("P", (1, 1))
    flat = []
    for c in palette:
        flat.extend(c)
    flat.extend([0] * (768 - len(flat)))
    pal_img.putpalette(flat)
    out = small.quantize(palette=pal_img, dither=Image.Dither.NONE)
    # --- контур силуэта 1 px и rim light в 128-пространстве (без «пунктира»)
    sil128 = Image.new("L", (128, 128), 0)
    sd128 = ImageDraw.Draw(sil128)
    sd128.polygon([(int(round(x)), int(round(y + tilt))) for (x, y) in head_pts], fill=255)
    sd128.polygon([(int(round(x)), int(round(y))) for (x, y) in _smooth_poly(back)], fill=255)
    sd128.polygon([(int(round(x)), int(round(y))) for (x, y) in shoulders], fill=255)
    sil_arr = np.asarray(sil128) > 0
    # эрозия 3x3 → граница силуэта (2 px толщиной после дилатации)
    er = sil_arr.copy()
    er[1:, :] &= sil_arr[:-1, :]
    er[:-1, :] &= sil_arr[1:, :]
    er[:, 1:] &= sil_arr[:, :-1]
    er[:, :-1] &= sil_arr[:, 1:]
    border = sil_arr & ~er
    rgb = out.convert("RGB")
    arr = np.asarray(rgb).copy()
    # 2 px контур: дилатация границы, чтобы убрать цветные «искры» у края
    bimg = Image.fromarray((border.astype(np.uint8) * 255))
    bimg = bimg.filter(ImageFilter.MaxFilter(3))
    border2 = np.asarray(bimg) > 0
    arr[border2] = np.array(SPACE, dtype=np.uint8)
    # внутренний контур волос (на 1 px внутрь): тёмный тон волос, а не «искры»
    hair128 = Image.new("L", (128, 128), 0)
    hd128 = ImageDraw.Draw(hair128)
    hd128.polygon([(int(round(x)), int(round(y))) for (x, y) in _smooth_poly(back)], fill=255)
    hd128.polygon([(int(round(x)), int(round(y))) for (x, y) in _smooth_poly(fringe)], fill=255)
    hair_arr = np.asarray(hair128) > 0
    er_h = hair_arr.copy()
    er_h[1:, :] &= hair_arr[:-1, :]
    er_h[:-1, :] &= hair_arr[1:, :]
    er_h[:, 1:] &= hair_arr[:, :-1]
    er_h[:, :-1] &= hair_arr[:, 1:]
    hair_edge = (hair_arr & ~er_h) & er  # кромка волос внутри лица/фона
    arr[hair_edge] = np.array(person.hair[2], dtype=np.uint8)
    out = Image.fromarray(arr).quantize(palette=pal_img, dither=Image.Dither.NONE)
    return out


def build_portraits() -> list[dict]:
    out = []
    for person in PEOPLE:
        for emotion in EMOTIONS:
            out_img = _hd_render(person, emotion, seed=_portrait_seed(person.id, emotion))
            rel = f"portraits/{person.id}/{emotion}.png"
            path = os.path.join(DLC, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            out_img.save(path, format="PNG", optimize=True)
            colors = len(out_img.getcolors(maxcolors=64) or [])
            out.append({
                "characterId": person.id, "characterName": person.name, "role": person.role,
                "emotion": emotion, "path": rel, "width": 128, "height": 128,
                "colors": colors, "bytes": os.path.getsize(path),
            })
    return out




def build_card(kind: str, seed: int) -> tuple[Painter, dict]:
    """kind: 'main' | 'side'. 320x180: рамка 9-slice 4 px, шапка 36, арт-окно справа 168x104, футер 30."""
    rnd = random.Random(seed)
    main = kind == "main"
    frame = GOLD if main else METAL1
    frame_dark = GOLD_DARK if main else METAL_SHADOW
    accent = WARN_LIGHT if main else SHIELD
    p = Painter(320, 180, SPACE)
    # фон: тёмная панель + звёздная дизеринг-подложка
    p.dither_rect(0, 0, 320, 180, SPACE_DEEP, SPACE_FAR, 0.35)
    # 9-slice рамка 4 px со срезанным углом 2 px (14c §6.3)
    p.rect(0, 0, 320, 4, frame_dark)
    p.rect(0, 176, 320, 180, frame_dark)
    p.rect(0, 0, 4, 180, frame_dark)
    p.rect(316, 0, 320, 180, frame_dark)
    p.line([(4, 1), (316, 1)], frame, 1)
    p.line([(4, 177), (316, 177)], frame_dark, 1)
    for (x, y) in ((1, 1), (317, 1), (1, 177), (317, 177)):
        p.pixel(x, y, frame)
    p.pixel(317, 1, frame)
    p.pixel(1, 177, frame)
    # шапка 36 px: линия-акцент + маркеры акта (без текста)
    p.rect(8, 8, 312, 36, SPACE_DEEP)
    p.line([(8, 35), (312, 35)], frame_dark, 1)
    p.rect(12, 14, 16, 30, frame)
    p.rect(13, 15, 15, 29, SPACE)
    for i in range(5):
        x = 22 + i * 12
        p.rect(x, 20, x + 8, 24, accent if i == 0 else frame_dark)
        p.pixel(x + 4, 22, SPACE_DEEP)
    # линия/акт справа в шапке: треугольники
    for i in range(3):
        x = 286 + i * 8
        p.poly([(x, 18), (x + 6, 22), (x, 26)], accent if i == 0 else frame_dark)
    # левая текстовая зона (DOM-текст поверх): дизеринг + направляющие
    p.dither_rect(8, 42, 140, 140, SPACE_DEEP, SPACE_FAR, 0.22)
    p.line([(12, 52), (132, 52)], frame_dark, 1)
    for i in range(4):
        y = 60 + i * 16
        p.line([(12, y), (12 + (110 if i < 3 else 64), y)], METAL_SHADOW, 1)
    # арт-окно справа: 168x104 (14c §6.3: арт 168x120; здесь 320x184 бюджет — 168x104)
    ax0, ay0, ax1, ay1 = 146, 42, 312, 142
    p.rect(ax0, ay0, ax1, ay1, SPACE)
    # звёзды
    for _ in range(70):
        x = rnd.randint(ax0 + 2, ax1 - 3)
        y = rnd.randint(ay0 + 2, ay1 - 3)
        p.pixel(x, y, rnd.choice([WHITE, TEXT2, TEXT, METAL1]))
    p.dither_rect(ax0, ay0, ax1, ay0 + 40, NEB1, SPACE_DEEP, 0.4)
    # планета/станция в окне
    if main:
        # станция «Свет-1»: цилиндр + солнечные панели + аварийный огонь
        cx, cy = 230, 104
        p.ellipse(cx - 30, cy - 26, cx + 30, cy + 26, NEB2)
        p.ellipse(cx - 26, cy - 22, cx + 26, cy + 22, SPACE_FAR)
        p.ellipse(cx - 20, cy - 16, cx + 20, cy + 16, METAL_SHADOW)
        p.ellipse(cx - 14, cy - 10, cx + 14, cy + 10, METAL1)
        p.rect(cx - 34, cy - 4, cx - 14, cy + 4, METAL2)
        p.rect(cx + 14, cy - 4, cx + 34, cy + 4, METAL2)
        for i in range(4):
            p.vline(cx - 32 + i * 5, cy - 3, cy + 3, METAL_SHADOW)
            p.vline(cx + 16 + i * 5, cy - 3, cy + 3, METAL_SHADOW)
        p.rect(cx - 2, cy - 12, cx + 2, cy - 4, WARN)
        p.pixel(cx, cy - 13, WARN_LIGHT)
        p.dither_rect(cx - 40, cy - 8, cx - 34, cy + 8, SPACE, WARN, 0.2)
    else:
        # курьерский караван: три силуэта грузовиков
        for i, (cx, cy, s) in enumerate(((196, 104, 1.0), (246, 92, 0.7), (286, 112, 0.55))):
            w = int(26 * s)
            h = int(12 * s)
            p.rect(cx - w, cy - h // 2, cx + w, cy + h // 2, METAL_SHADOW)
            p.rect(cx - w + 2, cy - h // 2 + 2, cx + w - 2, cy + h // 2 - 2, METAL2)
            p.rect(cx - w + 4, cy - 2, cx - w + 10, cy + 2, accent)
            p.vline(cx + w, cy - 2, cy + 2, TEXT2)
            p.rect(cx - w, cy + h // 2, cx + w, cy + h // 2 + 1, SPACE)
    # «скан»-линии поверх арт-окна (эффект экрана, не текст)
    for y in range(ay0 + 2, ay1 - 1, 4):
        p.line([(ax0 + 1, y), (ax1 - 2, y)], SPACE_DEEP, 1)
    p.rect(ax0, ay0, ax1, ay0 + 1, frame_dark)
    p.rect(ax0, ay1 - 1, ax1, ay1, frame_dark)
    p.rect(ax0, ay0, ax0 + 1, ay1, frame_dark)
    p.rect(ax1 - 1, ay0, ax1, ay1, frame_dark)
    # футер 30: награда (монета/кредит), репутация (ромб), риск (треугольник)
    p.rect(8, 146, 312, 172, SPACE_DEEP)
    p.line([(8, 146), (312, 146)], frame_dark, 1)
    # кредиты: золотая монета с прорезью
    p.ellipse(16, 152, 28, 164, GOLD_DARK)
    p.ellipse(18, 153, 26, 163, GOLD)
    p.rect(21, 156, 23, 160, GOLD_DARK)
    # репутация: ромб
    p.poly([(40, 158), (47, 151), (54, 158), (47, 165)], OK_DARK)
    p.poly([(43, 158), (47, 154), (51, 158), (47, 162)], OK)
    # риск: треугольник
    p.poly([(68, 165), (76, 151), (84, 165)], ENEMY_DARK)
    p.poly([(71, 164), (76, 155), (81, 164)], ENEMY)
    p.rect(75, 159, 77, 162, SPACE)
    p.pixel(75, 162, ENEMY)
    # полоски-держатели наград
    for i in range(3):
        p.line([(92 + i * 8, 156), (92 + i * 8, 164)], METAL_SHADOW, 1)
    p.line([(120, 158), (300, 158)], METAL_SHADOW, 1)
    p.line([(120, 162), (260, 162)], SPACE_FAR, 1)
    return p, {"kind": kind, "seed": seed}


def build_placeholder() -> dict:
    """generic cards/placeholder.png 320x180 для 6 квестов до арта: тёмный силуэт + золотой ромб."""
    p = Painter(320, 180, SPACE)
    p.dither_rect(0, 0, 320, 180, SPACE_DEEP, SPACE_FAR, 0.3)
    # рамка
    p.rect(0, 0, 320, 4, METAL_SHADOW)
    p.rect(0, 176, 320, 180, METAL_SHADOW)
    p.rect(0, 0, 4, 180, METAL_SHADOW)
    p.rect(316, 0, 320, 180, METAL_SHADOW)
    p.line([(4, 1), (316, 1)], METAL1, 1)
    # тёмный силуэт фигуры в центре (без деталей — «арт будет позже»)
    p.ellipse(146, 46, 174, 74, NEB2)
    p.poly([(124, 156), (136, 96), (154, 82), (166, 82), (184, 96), (196, 156)], NEB2)
    p.dither_poly([(124, 156), (136, 96), (154, 82), (166, 82), (184, 96), (196, 156)], NEB2, SPACE_FAR, 0.3)
    p.ellipse(150, 50, 170, 70, SPACE_FAR)
    # золотой ромб «арт ожидается» на месте фона
    p.poly([(160, 116), (172, 128), (160, 140), (148, 128)], GOLD_DARK)
    p.poly([(160, 120), (168, 128), (160, 136), (152, 128)], GOLD)
    p.pixel(159, 127, SPACE_DEEP)
    p.pixel(160, 128, SPACE_DEEP)
    rel = "cards/placeholder.png"
    path = os.path.join(DLC, rel)
    colors = p.save_png8(path, max_colors=24)
    return {"questId": None, "kind": "placeholder", "path": rel, "width": 320, "height": 180,
            "colors": colors, "bytes": os.path.getsize(path)}


def build_cards() -> list[dict]:
    out = []
    for rel, kind, seed in (
        ("cards/q_pro_01_first_light.png", "main", 101),
        ("cards/q_pro_02_quiet_dock.png", "side", 202),
    ):
        p, meta = build_card(kind, seed)
        path = os.path.join(DLC, rel)
        colors = p.save_png8(path, max_colors=24)
        out.append({"questId": "q_pro_01_first_light" if kind == "main" else "q_pro_02_quiet_dock",
                    "kind": kind, "path": rel, "width": 320, "height": 180, "colors": colors,
                    "bytes": os.path.getsize(path)})
    return out


# --------------------------------------------------------------------- ФОН
def build_background() -> dict:
    rnd = random.Random(777)
    p = Painter(640, 360, SPACE)
    # небо/космос за окном + планета
    p.dither_rect(0, 0, 640, 210, SPACE_DEEP, SPACE_FAR, 0.4)
    for _ in range(260):
        x = rnd.randint(0, 639)
        y = rnd.randint(0, 200)
        if rnd.random() < 0.55:
            p.pixel(x, y, rnd.choice([WHITE, TEXT2, TEXT, METAL1]))
    # планета (Терра-Нова) в окне
    cx, cy, r = 470, 120, 78
    p.ellipse(cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6, NEB2)
    p.dither_poly([(cx - r, cy - r), (cx + r, cy - r), (cx + r, cy + r), (cx - r, cy + r)], SHIELD_DARK, SHIELD, 0.45)
    p.ellipse(cx - r, cy - r, cx + r, cy + r, SHIELD_DARK)
    p.dither_rect(cx - r + 10, cy - r + 8, cx + r - 10, cy + r - 25, SHIELD, OK_DARK, 0.35)
    p.ellipse(cx - 40, cy - 30, cx + 40, cy + 30, SHIELD)
    p.dither_rect(cx - 48, cy - 10, cx + 50, cy + 40, SHIELD, OK_DARK, 0.3)
    for _ in range(900):
        a = rnd.random() * 6.283
        rr = rnd.random() * r
        x = int(cx + rr * np.cos(a))
        y = int(cy + rr * np.sin(a))
        if rnd.random() < 0.35:
            p.pixel(x, y, rnd.choice([OK, OK_DARK, SHIELD, WHITE]))
    # терминатор
    p.dither_poly([(cx - r, cy), (cx + r, cy), (cx + r, cy + r - 10), (cx - r, cy + r - 10)], SHIELD_DARK, SPACE_FAR, 0.55)
    # --- корпус дока: рама окна, панели, кабели, балки
    p.rect(0, 0, 640, 40, METAL_SHADOW)
    p.rect(0, 40, 640, 46, METAL2)
    p.rect(0, 46, 640, 210, SPACE)          # само окно — вернём космос
    # окно: рамка
    p.rect(28, 46, 612, 210, SPACE_DEEP)
    p.rect(34, 52, 606, 206, SPACE)
    p.dither_rect(34, 52, 606, 206, SPACE, SPACE_FAR, 0.25)  # внутренность окна (космос уже нарисован — упрощаем)
    # заново звезды/планета внутри окна
    p.dither_rect(34, 52, 606, 206, SPACE, SPACE_DEEP, 0.45)
    for _ in range(230):
        x = rnd.randint(36, 604)
        y = rnd.randint(54, 200)
        p.pixel(x, y, rnd.choice([WHITE, TEXT2, TEXT, METAL1]))
    p.ellipse(cx - r + 20, cy - r + 4, cx + r - 10, cy + r - 10, NEB2)
    p.ellipse(cx - r + 24, cy - r + 8, cx + r - 14, cy + r - 14, SPACE_FAR)
    p.dither_rect(cx - r + 30, cy - r + 12, cx + r - 20, cy + r - 34, SHIELD_DARK, SHIELD, 0.4)
    p.ellipse(cx - 30, cy - 20, cx + 26, cy + 26, SHIELD)
    p.dither_rect(cx - 34, cy - 10, cx + 30, cy + 30, SHIELD, OK_DARK, 0.3)
    p.dither_rect(cx - 10, cy + 12, cx + 40, cy + 34, SHIELD, SPACE_FAR, 0.55)
    # переплёты окна
    for x in (28, 218, 418, 606):
        p.rect(x, 46, x + 8, 210, METAL_SHADOW)
        p.vline(x + 8, 46, 210, METAL2)
    p.rect(28, 200, 612, 210, METAL_SHADOW)
    p.line([(28, 200), (611, 200)], METAL2, 1)
    p.rect(0, 40, 640, 46, METAL2)
    p.line([(0, 40), (640, 40)], METAL1, 1)
    # кабели/трубы под потолком
    p.line([(0, 30), (120, 34), (260, 24), (400, 32), (540, 22), (640, 30)], METAL_SHADOW, 2)
    p.line([(0, 12), (160, 16), (320, 8), (480, 14), (640, 10)], METAL1, 1)
    # --- пол: перспективная сетка, настил, предупреждающие полосы
    p.rect(0, 240, 640, 360, HULL_SHADE)
    p.dither_rect(0, 240, 640, 360, HULL_SHADE, SPACE_FAR, 0.35)
    for i in range(-6, 18):
        x0 = 320 + (i * 70)
        p.line([(320, 240), (x0, 360)], METAL_SHADOW, 1)
    for i, y in enumerate((250, 262, 278, 300, 330)):
        p.line([(0, y), (640, y)], METAL_SHADOW if i % 2 else SPACE_FAR, 1)
    # жёлто-чёрная предупреждающая полоса у окна
    p.rect(0, 210, 640, 220, SPACE_DEEP)
    for x in range(0, 640, 16):
        p.poly([(x, 220), (x + 8, 210), (x + 16, 210), (x + 8, 220)], WARN if (x // 16) % 2 == 0 else GOLD_DARK)
    # гантри/кран слева и справа
    p.rect(0, 220, 26, 240, METAL_SHADOW)
    p.rect(0, 220, 6, 360, METAL_SHADOW)
    p.rect(0, 300, 90, 310, METAL2)
    p.rect(80, 300, 90, 360, METAL_SHADOW)
    p.line([(20, 310), (70, 340)], METAL_SHADOW, 2)
    p.rect(64, 336, 76, 344, METAL1)
    # контейнеры/ящики
    for (x, y, w, h, c) in ((110, 300, 44, 34, METAL2), (160, 310, 30, 24, METAL_SHADOW),
                             (470, 296, 52, 40, METAL2), (530, 306, 34, 30, METAL_SHADOW)):
        p.rect(x, y, x + w, y + h, c)
        p.rect(x, y, x + w, y + 3, METAL1)
        p.line([(x + 1, y + 1), (x + w - 2, y + 1)], SPACE, 1)
        p.vline(x + w // 2, y + 3, y + h - 1, SPACE_FAR)
        p.poly([(x + 4, y + h - 6), (x + 10, y + h - 6), (x + 12, y + h - 12), (x + 6, y + h - 12)], WARN if h > 30 else SHIELD_DARK)
    # голо-панель сбоку (без текста: линии-строки)
    p.rect(560, 236, 632, 292, SPACE_DEEP)
    p.rect(562, 238, 630, 290, SPACE_FAR)
    p.dither_rect(564, 240, 628, 288, SPACE_FAR, SPACE_DEEP, 0.25)
    p.rect(568, 244, 624, 248, SHIELD_DARK)
    for i in range(6):
        y = 254 + i * 5
        p.line([(568, y), (568 + (30 if i % 3 else 48), y)], SHIELD if i % 2 == 0 else SHIELD_DARK, 1)
    p.rect(566, 236, 632, 238, METAL1)
    # передний план: перила (отдельный слой-параллакс ниже)
    p.rect(0, 344, 640, 360, METAL_SHADOW)
    for x in range(0, 640, 80):
        p.rect(x, 344, x + 4, 360, METAL2)
    p.line([(0, 346), (640, 346)], METAL1, 1)
    return p


def build_foreground() -> Painter:
    p = Painter(640, 48, SPACE)
    p.img = Image.new("RGBA", (640, 48), (0, 0, 0, 0))
    p.d = ImageDraw.Draw(p.img)
    # перила + стойки (передний слой параллакса 0.35x)
    p.d.rectangle([0, 30, 639, 47], fill=SPACE)
    p.d.rectangle([0, 30, 639, 34], fill=METAL2)
    p.d.line([(0, 30), (639, 30)], fill=METAL1)
    for x in range(40, 640, 120):
        p.d.rectangle([x, 20, x + 5, 47], fill=METAL_SHADOW)
        p.d.line([(x, 20), (x + 5, 20)], fill=METAL1)
    # трос/лампа
    p.d.line([(0, 8), (200, 14), (420, 6), (639, 12)], fill=METAL_SHADOW)
    for x in (160, 420):
        p.d.rectangle([x, 12, x + 10, 18], fill=GOLD_DARK)
        p.d.rectangle([x + 2, 14, x + 8, 16], fill=WARN_LIGHT)
    return p


def save_rgba_png8(p: Painter, path: str) -> int:
    """PNG-8 с прозрачностью (для слоя параллакса)."""
    arr = np.asarray(p.img.convert("RGBA"))
    flat = arr.reshape(-1, 4)
    uniq = [tuple(int(v) for v in c) for c in np.unique(flat, axis=0)]
    index = {c: i for i, c in enumerate(uniq)}
    idx = np.array([index[tuple(int(v) for v in px)] for px in flat], dtype=np.uint8).reshape(arr.shape[0], arr.shape[1])
    out = Image.fromarray(idx, mode="P")
    pal = []
    for c in uniq:
        pal.extend(c[:3])
    pal.extend([0] * (768 - len(pal)))
    out.putpalette(pal)
    transparency = bytes([255 if c[3] == 0 else 0 for c in uniq])
    out.info["transparency"] = transparency
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, format="PNG", optimize=True, transparency=transparency)
    return len(uniq)



# ------------------------------------------------------------------ ГОЛОС (СВЕТ)
def build_voice_wave(wave_id: str, seed: int) -> dict:
    """128x128 «радио-волна» для голоса без портрета (14c §6.2): осциллограф + динамик."""
    rnd = random.Random(seed)
    p = Painter(128, 128, SPACE)
    # плашка в стиле портретов: 16x16 паттерн + виньетка
    p.rect(0, 0, 128, 128, SPACE_DEEP)
    for gy in range(0, 128, 16):
        for gx in range(0, 128, 16):
            p.dither_rect(gx, gy, gx + 16, gy + 16, SPACE_DEEP, SPACE_FAR, 0.18)
    p.rect(0, 0, 128, 2, SPACE)
    p.rect(0, 126, 128, 128, SPACE)
    p.rect(0, 0, 2, 128, SPACE)
    p.rect(126, 0, 128, 128, SPACE)
    for (x, y) in ((2, 2), (124, 2), (2, 124), (124, 124)):
        p.pixel(x, y, METAL_SHADOW)
    # динамик: концентрические дуги (служебный цвет голоса — щит/циан)
    cx, cy = 64, 52
    for r, c in ((46, SPACE_FAR), (38, SHIELD_DARK), (30, SHIELD_DARK)):
        p.dither_poly(
            [(cx - r, cy), (cx + r, cy), (cx + r, cy + r), (cx - r, cy + r)],
            SPACE_DEEP, c, 0.25,
        )
    for i in range(3):
        r = 44 - i * 12
        p.line([(cx - r, cy), (cx + r, cy)], SHIELD_DARK if i else SHIELD, 1)
    # решётка динамика: горизонтальные штрихи
    for y in range(cy - 26, cy + 24, 4):
        p.dither_rect(cx - 30, y, cx + 30, y + 1, SPACE_DEEP, SHIELD_DARK, 0.35)
    p.rect(cx - 4, cy - 4, cx + 4, cy + 4, SHIELD_DARK)
    p.rect(cx - 2, cy - 2, cx + 2, cy + 2, SHIELD)
    p.pixel(cx, cy, WHITE)
    # осциллограф-волна (голос СВЕТ): синус с модуляцией, 2 px + пики белым
    prev = None
    for x in range(14, 114):
        t = (x - 14) / 99.0
        amp = 9 + 5 * np.sin(t * 9.0 + 1.3) + 3 * np.sin(t * 23.0)
        y = int(round(cy + amp * np.sin(t * 16.0 + rnd.random() * 0.2)))
        if prev is not None:
            p.line([(prev[0], prev[1]), (x, y)], SHIELD, 2)
        if abs(amp) > 12 and x % 7 == 0:
            p.pixel(x, y - 2, WHITE)
        prev = (x, y)
    # нижний эквалайзер: 12 столбиков (без букв/цифр)
    base_y = 108
    for i in range(12):
        h = 4 + int((np.sin(i * 0.9 + 1.7) * 0.5 + 0.5) * 12) + (6 if i % 4 == 0 else 0)
        x = 16 + i * 8
        p.rect(x, base_y - h, x + 5, base_y, SHIELD_DARK)
        p.rect(x, base_y - h, x + 5, base_y - h + 2, SHIELD)
        if i == 5:
            p.rect(x, base_y - h - 3, x + 5, base_y - h, GOLD)
    p.line([(14, base_y + 2), (114, base_y + 2)], METAL_SHADOW, 1)
    # скан-линии поверх (эффект радиопередачи)
    for y in range(4, 124, 4):
        p.dither_rect(4, y, 124, y + 1, SPACE, SPACE_DEEP, 0.12)
    rel = f"voices/{wave_id}.png"
    path = os.path.join(DLC, rel)
    colors = p.save_png8(path, max_colors=16)
    return {"id": wave_id, "path": rel, "width": 128, "height": 128, "colors": colors,
            "bytes": os.path.getsize(path)}


# ------------------------------------------------------------------ КОМИКС
def build_comic() -> dict:
    rnd = random.Random(4242)
    p = Painter(640, 240, SPACE)
    # панель: рамка + космическая сцена
    p.rect(0, 0, 640, 240, SPACE)
    p.dither_rect(6, 6, 634, 234, SPACE_DEEP, SPACE_FAR, 0.4)
    for _ in range(260):
        x = rnd.randint(8, 631)
        y = rnd.randint(8, 232)
        if rnd.random() < 0.5:
            p.pixel(x, y, rnd.choice([WHITE, TEXT2, TEXT, METAL1]))
    # туманность Хора-Разлома на фоне (зелёный служебный — комикс про ядро/Хор)
    p.dither_poly([(360, 8), (632, 8), (632, 150), (420, 170)], MIST, SPACE_DEEP, 0.5)
    p.dither_poly([(440, 20), (600, 30), (560, 120), (470, 100)], MIST, CHORUS, 0.3)
    # станция «Свет-1» справа: повреждённый цилиндр, аварийные огни
    cx, cy = 520, 110
    p.ellipse(cx - 66, cy - 40, cx + 66, cy + 40, NEB2)
    p.ellipse(cx - 60, cy - 34, cx + 60, cy + 34, METAL_SHADOW)
    p.ellipse(cx - 50, cy - 26, cx + 50, cy + 26, METAL1)
    p.ellipse(cx - 34, cy - 16, cx + 34, cy + 16, METAL2)
    p.dither_rect(cx - 34, cy - 16, cx + 34, cy + 16, METAL2, SPACE_FAR, 0.35)
    for i in range(5):
        p.vline(cx - 28 + i * 14, cy - 14, cy + 14, METAL_SHADOW)
    # солнечные панели
    p.rect(cx - 96, cy - 10, cx - 50, cy + 10, METAL2)
    p.rect(cx + 50, cy - 10, cx + 96, cy + 10, METAL2)
    for i in range(6):
        p.vline(cx - 92 + i * 7, cy - 8, cy + 8, METAL_SHADOW)
        p.vline(cx + 54 + i * 7, cy - 8, cy + 8, METAL_SHADOW)
    # пробоина/искры и аварийный маяк
    p.poly([(cx + 20, cy - 26), (cx + 34, cy - 16), (cx + 24, cy - 8)], SPACE)
    p.rect(cx - 4, cy - 22, cx + 2, cy - 14, WARN)
    p.pixel(cx - 2, cy - 24, WARN_LIGHT)
    for _ in range(26):
        x = rnd.randint(cx - 70, cx + 70)
        y = rnd.randint(cy - 40, cy + 40)
        p.pixel(x, y, rnd.choice([WARN, WARN_LIGHT, GOLD_DARK]))
    # пиратские рейдеры (силуэты): клинья с красным свечением и парой двигателей
    for (sx, sy, s, flip) in ((330, 64, 1.0, 1), (296, 96, 0.8, 1), (356, 130, 0.62, -1)):
        w = int(26 * s); h = int(9 * s)
        # корпус-клин
        p.poly([(sx - w * flip, sy), (sx, sy - h), (sx + w * flip, sy), (sx + w // 2 * flip, sy + h)], ENEMY_DARK)
        p.poly([(sx - w * 0.7 * flip, sy), (sx, sy - h + 3), (sx + w * 0.7 * flip, sy), (sx + w // 3 * flip, sy + h - 3)], ENEMY)
        # кабина
        p.rect(sx - 2, sy - 3, sx + 2, sy - 1, ENEMY_DARK)
        p.rect(sx - 1, sy - 2, sx + 1, sy - 1, WARN)
        # двигатели: два сопла + свечение
        for dx in (-w // 2, w // 2):
            p.rect(sx + dx * flip - 2, sy - 1, sx + dx * flip + 2, sy + 1, METAL_SHADOW)
            p.rect(sx + dx * flip - 1, sy, sx + dx * flip + 1, sy + 1, WARN_LIGHT)
            p.rect(sx + dx * flip - 2, sy + 2, sx + dx * flip + 2, sy + 3, ENEMY)
        p.dither_poly([(sx + w * 0.2 * flip, sy - 2), (sx + w * 0.9 * flip, sy), (sx + w * 0.2 * flip, sy + 2)], ENEMY_DARK, ENEMY, 0.4)
    # корабль игрока на переднем плане (низ-слева), двигатели
    sx, sy = 150, 190
    p.poly([(sx - 46, sy + 14), (sx - 20, sy - 10), (sx + 24, sy - 14), (sx + 46, sy + 2), (sx + 26, sy + 16), (sx - 14, sy + 20)], METAL_SHADOW)
    p.poly([(sx - 38, sy + 10), (sx - 18, sy - 6), (sx + 20, sy - 10), (sx + 38, sy + 1), (sx + 22, sy + 12), (sx - 12, sy + 16)], METAL2)
    p.poly([(sx - 6, sy - 9), (sx + 12, sy - 11), (sx + 16, sy - 5), (sx - 2, sy - 4)], SHIELD_DARK)
    p.rect(sx - 30, sy + 2, sx - 18, sy + 6, SHIELD)
    p.rect(sx + 10, sy + 8, sx + 26, sy + 12, METAL1)
    # шлейф двигателя
    p.dither_poly([(sx + 34, sy - 2), (sx + 92, sy - 8), (sx + 92, sy + 12), (sx + 34, sy + 10)], SHIELD, SPACE_DEEP, 0.35)
    p.dither_poly([(sx + 40, sy), (sx + 70, sy - 3), (sx + 70, sy + 7), (sx + 40, sy + 5)], WHITE, SHIELD, 0.4)
    # рисованные зоны под DOM-бабблы: чистые светлые панели сверху (без текста!)
    for (bx, by, bw, bh) in ((22, 16, 172, 46), (216, 14, 150, 38)):
        p.rect(bx, by, bx + bw, by + bh, SPACE)
        p.rect(bx + 2, by + 2, bx + bw - 2, by + bh - 2, TEXT)
        p.dither_rect(bx + 2, by + 2, bx + bw - 2, by + bh - 2, TEXT, WHITE, 0.35)
        p.poly([(bx + 20, by + bh), (bx + 34, by + bh), (bx + 26, by + bh + 8)], TEXT)
        p.line([(bx, by), (bx, by + bh)], METAL1, 1)
        p.line([(bx, by), (bx + bw, by)], METAL1, 1)
    # панельная рамка 3 px и «гуттер»-метки
    p.rect(0, 0, 640, 3, METAL_SHADOW)
    p.rect(0, 237, 640, 240, METAL_SHADOW)
    p.rect(0, 0, 3, 240, METAL_SHADOW)
    p.rect(637, 0, 640, 240, METAL_SHADOW)
    for (x0, y0, x1, y1) in ((3, 3, 20, 20), (620, 3, 637, 20), (3, 220, 20, 237), (620, 220, 637, 237)):
        p.line([(x0, y0), (x1, y0)], METAL1, 1)
        p.line([(x0, y0), (x0, y1)], METAL1, 1)
    return p


def build_comic_panel() -> dict:
    p = build_comic()
    rel = "comics/q_pro_01_first_light_01.png"
    path = os.path.join(DLC, rel)
    colors = p.save_png8(path, max_colors=32)
    return {"questId": "q_pro_01_first_light", "panel": 1, "path": rel, "width": 640, "height": 240,
            "colors": colors, "bytes": os.path.getsize(path)}


# ------------------------------------------------------------------ ПРЕВЬЮ
def scaled(img: Image.Image, factor: int) -> Image.Image:
    return img.resize((img.width * factor, img.height * factor), Image.NEAREST)


def _font(size: int = 14):
    for fpath in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\DejaVuSans.ttf"):
        if os.path.exists(fpath):
            try:
                from PIL import ImageFont
                return ImageFont.truetype(fpath, size)
            except Exception:
                continue
    from PIL import ImageFont
    return ImageFont.load_default()


F14 = _font(14)
F12 = _font(12)
F16 = _font(16)


def build_previews(portraits_meta, cards_meta, bg_meta, comic_meta, fore_meta):
    from PIL import ImageFont  # noqa: F401

    def load(rel):
        return Image.open(os.path.join(DLC, rel)).convert("RGB")

    def label(dr, xy, text, fill=TEXT2, f=F12):
        dr.text(xy, text, fill=fill, font=f)

    row_color = {TEIRA.id: GOLD, KIRA.id: SHIELD, KAIN.id: WARN_LIGHT, SELEN.id: PSI}

    # 1) портреты: 4 строки × 6 эмоций, ×2 (256×256), подписи
    cell = 128 * 2
    pad = 10
    title_h = 36
    rows = len(PEOPLE)
    sheet_h = title_h + pad + rows * (cell + 20 + pad) + 6
    sheet = Image.new("RGB", (6 * cell + 7 * pad, sheet_h), SPACE)
    d = ImageDraw.Draw(sheet)
    label(d, (pad, 10), "DLC XIV «Первый Свет» · портреты 128×128, 4 персонажа × 6 эмоций (канон 14b), ×2 nearest", TEXT, F16)
    for row, person in enumerate(PEOPLE):
        y0 = title_h + pad + row * (cell + 20 + pad)
        label(d, (pad, y0), f"{person.name} — {person.role} ({person.id}, {person.kind}, {person.age})",
              row_color[person.id], F14)
        for col, emo in enumerate(EMOTIONS):
            img = scaled(load(f"portraits/{person.id}/{emo}.png"), 2)
            x = pad + col * (cell + pad)
            y = y0 + 22
            sheet.paste(img, (x, y))
            label(d, (x + 2, y + cell - 14), emo, row_color[person.id], F12)
            d.rectangle([x - 1, y - 1, x + cell, y + cell], outline=METAL_SHADOW)
    sheet_path = os.path.join(SHOTS, "dlc-portraits.png")
    sheet.save(sheet_path)

    # 2) карточки 2x + placeholder
    cards = [load(m["path"]) for m in cards_meta]
    cw, ch = 320 * 2, 180 * 2
    cs = Image.new("RGB", (3 * cw + 4 * 12, ch + 2 * 12 + 40), SPACE)
    cd = ImageDraw.Draw(cs)
    label(cd, (12, 10), "DLC XIV · карточки квестов 320×180 (×2): main / side / placeholder", TEXT, F16)
    names = ["q_pro_01_first_light (main)", "q_pro_02_quiet_dock (side)", "placeholder (6 квестов до арта)"]
    for i2, img in enumerate(cards[:3]):
        x = 12 + i2 * (cw + 12)
        cs.paste(scaled(img, 2), (x, 40))
        label(cd, (x, 40 + ch + 4), names[i2], GOLD if i2 == 0 else TEXT2, F12)
    cs.save(os.path.join(SHOTS, "dlc-cards.png"))

    # 3) фон + передний слой параллакса (×2)
    bg = load(bg_meta["path"])
    bg2 = scaled(bg, 2)
    fg = Image.open(os.path.join(DLC, fore_meta["path"])).convert("RGBA")
    fgs = Image.new("RGBA", (bg.width, bg.height), (0, 0, 0, 0))
    fgs.alpha_composite(fg, (0, bg.height - fg.height))
    scene = bg2.copy()
    scene.paste(scaled(fgs.convert("RGB"), 2), (0, (bg.height - fg.height) * 2))
    scene.save(os.path.join(SHOTS, "dlc-scene.png"))

    # 3b) голос-радиоволна ×2
    voice_files = sorted(os.listdir(os.path.join(DLC, "voices"))) if os.path.isdir(os.path.join(DLC, "voices")) else []
    if voice_files:
        voice = load("voices/" + voice_files[0])
        vs = Image.new("RGB", (voice.width * 2 + 24, voice.height * 2 + 44), SPACE)
        vd = ImageDraw.Draw(vs)
        label(vd, (12, 8), "DLC XIV · голос СВЕТ — радио-волна 128×128 (без портрета, 14c §6.2), ×2", TEXT, F14)
        vs.paste(scaled(voice, 2), (12, 34))
        vs.save(os.path.join(SHOTS, "dlc-voice.png"))

    # 4) комикс ×2
    comic = scaled(load(comic_meta["path"]), 2)
    comic.save(os.path.join(SHOTS, "dlc-comic.png"))

    # 5) общий лист-превью: 4×6 портретов (1x) + карточки/фон/комикс/голос справа
    sheet2 = Image.new("RGB", (1600, 860), SPACE)
    d2 = ImageDraw.Draw(sheet2)
    label(d2, (16, 10), "DLC XIV «Первый Свет» · арт-срез (task-39): 4 персонажа × 6 эмоций 128×128, карточки 320×180, фон 640×360, комикс 640×240", TEXT, F16)
    for row, person in enumerate(PEOPLE):
        y0 = 40 + row * 150
        label(d2, (16, y0), person.name, row_color[person.id], F14)
        for col, emo in enumerate(EMOTIONS):
            img = load(f"portraits/{person.id}/{emo}.png")
            sheet2.paste(img, (16 + col * 140, y0 + 18))
            label(d2, (18 + col * 140, y0 + 148), emo, TEXT2, F12)
    right = 900
    sheet2.paste(load(cards_meta[0]["path"]), (right, 40))
    label(d2, (right, 224), "card q_pro_01_first_light (320×180)", GOLD, F12)
    sheet2.paste(load(cards_meta[1]["path"]), (right + 340, 40))
    label(d2, (right + 340, 224), "card q_pro_02_quiet_dock", SHIELD, F12)
    bg_thumb = bg.resize((480, 270), Image.NEAREST)
    sheet2.paste(bg_thumb, (right, 260))
    label(d2, (right, 534), "background station_light_1 (640×360 → thumb)", TEXT2, F12)
    comic_thumb = load(comic_meta["path"]).resize((480, 180), Image.NEAREST)
    sheet2.paste(comic_thumb, (right, 556))
    label(d2, (right, 740), "comic q_pro_01_first_light_01 (640×240)", TEXT2, F12)
    total = sum(m["bytes"] for m in portraits_meta + cards_meta) + bg_meta["bytes"] + comic_meta["bytes"] + fore_meta["bytes"]
    label(d2, (right + 500, 556), f"PNG-8: {total/1024:.1f} КБ", OK if total <= 2 * 1024 * 1024 else ENEMY, F16)
    label(d2, (right + 500, 580), f"портретов: {len(portraits_meta)} файлов", TEXT2, F12)
    label(d2, (right + 500, 598), "цветов на портрет ≤32", TEXT2, F12)
    label(d2, (right + 500, 616), "палитра PALETTE_HEX + служебные", TEXT2, F12)
    label(d2, (right + 500, 634), "текст не запечён (DOM-оверлеи)", TEXT2, F12)
    try:
        voice_img = load("voices/svet_wave.png")
        sheet2.paste(voice_img, (right + 500, 660))
        label(d2, (right + 500, 792), "voice svet_wave", TEXT2, F12)
    except FileNotFoundError:
        pass
    sheet2.save(os.path.join(SHOTS, "dlc-preview.png"))
    return sheet_path


def main() -> int:
    os.makedirs(DLC, exist_ok=True)
    portraits = build_portraits()
    cards = build_cards() + [build_placeholder()]
    bg_p = build_background()
    bg_rel = "backgrounds/station_light_1.png"
    bg_colors = bg_p.save_png8(os.path.join(DLC, bg_rel), max_colors=32)
    bg = {"id": "station_light_1", "path": bg_rel, "width": 640, "height": 360, "colors": bg_colors,
          "bytes": os.path.getsize(os.path.join(DLC, bg_rel))}
    fore_p = build_foreground()
    fore_rel = "backgrounds/station_light_1_fore.png"
    fore_colors = save_rgba_png8(fore_p, os.path.join(DLC, fore_rel))
    fore = {"id": "station_light_1_fore", "path": fore_rel, "width": 640, "height": 48,
            "colors": fore_colors, "bytes": os.path.getsize(os.path.join(DLC, fore_rel))}
    comic = build_comic_panel()
    voices = [build_voice_wave("svet_wave", 555)]

    manifest = {
        "version": 1,
        "dlc": "xiv_first_light",
        "palette": "PALETTE_HEX (docs/10_art_direction.md §3) + service #3A2B5C/#6BE08A (13d §1.5)",
        "emotions": EMOTIONS,
        "characters": [
            {"id": person.id, "nameRu": person.name, "role": person.role, "portraitSize": 128,
             "portraits": {e: f"portraits/{person.id}/{e}.png" for e in EMOTIONS}}
            for person in PEOPLE
        ],
        "cards": {m["questId"]: m["path"] for m in cards if m.get("questId")},
        "cardPlaceholder": "cards/placeholder.png",
        "backgrounds": {bg["id"]: {"path": bg["path"], "foreground": fore["path"],
                                   "width": bg["width"], "height": bg["height"]}},
        "comics": {"q_pro_01_first_light": [comic["path"]]},
        "voices": {v["id"]: v["path"] for v in voices},
        "assets": portraits + cards + [bg, fore, comic] + voices,
    }
    total = sum(a["bytes"] for a in manifest["assets"])
    manifest["totalBytes"] = total
    manifest["totalKb"] = round(total / 1024, 1)
    manifest_path = os.path.join(DLC, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    # контрольные суммы (для кэша/валидатора контента)
    hashes = {}
    for a in manifest["assets"]:
        with open(os.path.join(DLC, a["path"]), "rb") as fh:
            hashes[a["path"]] = hashlib.sha256(fh.read()).hexdigest()[:16]
    manifest["sha256_16"] = hashes
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    preview = build_previews(portraits, cards, bg, comic, fore)
    limit = 2 * 1024 * 1024
    print(f"portraits: {len(portraits)} | cards: {len(cards)} | bg: {bg['bytes']}B | fore: {fore['bytes']}B | comic: {comic['bytes']}B")
    print(f"TOTAL: {total} B = {total/1024:.1f} KB (limit 2048 KB) -> {'OK' if total <= limit else 'OVER'}")
    print(f"min colors: {min(a['colors'] for a in portraits)}..{max(a['colors'] for a in portraits)} portraits; bg {bg['colors']}; comic {comic['colors']}")
    print(f"manifest: {manifest_path}")
    print(f"previews: docs/shots/dlc-portraits.png, dlc-cards.png, dlc-scene.png, dlc-comic.png, dlc-preview.png")
    return 0 if total <= limit else 1


if __name__ == "__main__":
    sys.exit(main())
