
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
@dataclass(frozen=True)
class Person:
    id: str
    name: str
    skin: tuple[int, int, int]
    skin_shade: tuple[int, int, int]
    skin_light: tuple[int, int, int]
    hair: tuple[int, int, int]
    hair_light: tuple[int, int, int]
    cloth: tuple[int, int, int]
    cloth_shade: tuple[int, int, int]
    accent: tuple[int, int, int]
    accent_dark: tuple[int, int, int]
    iris: tuple[int, int, int]
    bg_a: tuple[int, int, int]
    bg_b: tuple[int, int, int]
    kind: str  # "mentor" | "dispatcher"


TEIRA = Person(
    id="teira_os",
    name="Тейра Ос",
    skin=hx("#FFCF6B"),
    skin_shade=hx("#F08A24"),
    skin_light=hx("#FFCF6B"),
    hair=hx("#B7C2D0"),
    hair_light=hx("#E8EEF7"),
    cloth=hx("#1B2A4A"),
    cloth_shade=hx("#101A2E"),
    accent=hx("#F5C542"),
    accent_dark=hx("#B8862A"),
    iris=hx("#B8862A"),
    bg_a=hx("#0A1020"),
    bg_b=hx("#142038"),
    kind="mentor",
)
KIRA = Person(
    id="kira7",
    name="Кира-7",
    skin=hx("#B7C2D0"),
    skin_shade=hx("#8C99A8"),
    skin_light=hx("#E8EEF7"),
    hair=hx("#38414F"),
    hair_light=hx("#5C6878"),
    cloth=hx("#233A5C"),
    cloth_shade=hx("#142038"),
    accent=hx("#4FC3F7"),
    accent_dark=hx("#2A7CA8"),
    iris=hx("#4FC3F7"),
    bg_a=hx("#101A2E"),
    bg_b=hx("#2E4A70"),
    kind="dispatcher",
)

EMOTIONS = ["neutral", "warm", "cold", "angry", "afraid", "sad"]


def draw_portrait(person: Person, emotion: str, seed: int) -> Painter:
    rnd = random.Random(seed)
    p = Painter(128, 128, SPACE)
    # --- фон: плашка 16x16 паттерн (тонкая штриховка, не спорит с лицом) + виньетка
    p.rect(0, 0, 128, 128, person.bg_a)
    for gy in range(0, 128, 16):
        for gx in range(0, 128, 16):
            p.dither_rect(gx, gy, gx + 16, gy + 16, person.bg_a, person.bg_b, 0.16)
    p.dither_rect(0, 0, 128, 8, person.bg_a, person.bg_b, 0.45)
    p.dither_rect(0, 120, 128, 128, person.bg_a, person.bg_b, 0.45)
    p.rect(0, 0, 2, 128, SPACE)
    p.rect(126, 0, 128, 128, SPACE)
    p.rect(0, 0, 128, 2, SPACE)
    p.rect(0, 126, 128, 128, SPACE)
    for (x, y) in ((2, 2), (124, 2), (2, 124), (124, 124)):
        p.pixel(x, y, METAL_SHADOW)

    # --- силуэт: плечи/торс (погрудный портрет, лицо в верхней трети)
    sil = Image.new("L", (128, 128), 0)
    sd = ImageDraw.Draw(sil)
    shoulders = [(10, 128), (18, 110), (34, 98), (52, 92), (76, 92), (94, 98), (110, 110), (118, 128)]
    sd.polygon(shoulders, fill=255)
    p.poly(shoulders, person.cloth)
    # дальняя сторона торса в тени
    p.dither_poly([(10, 128), (18, 110), (34, 98), (44, 94), (44, 128)], person.cloth_shade, person.cloth, 0.45)
    # воротник (V) и подкладка
    p.poly([(52, 92), (62, 106), (66, 106), (76, 92), (70, 89), (58, 89)], person.cloth_shade)
    p.line([(53, 93), (62, 104), (74, 93)], person.accent_dark, 1)
    # акценты фракции на плечах
    if person.kind == "mentor":
        p.rect(20, 112, 34, 115, person.accent_dark)
        p.rect(22, 113, 32, 114, person.accent)
        p.rect(94, 112, 108, 115, person.accent_dark)
        p.rect(96, 113, 106, 114, person.accent)
        # планка ранга на груди (без букв)
        p.rect(78, 104, 92, 111, person.cloth_shade)
        p.rect(79, 105, 91, 110, person.accent_dark)
        for i in range(3):
            p.rect(80 + i * 4, 106, 82 + i * 4, 109, person.accent)
    else:
        # диспетчер: бирюзовая нашивка + тёмный жилет
        p.rect(30, 106, 46, 116, person.cloth_shade)
        p.rect(32, 108, 44, 114, person.accent_dark)
        p.rect(34, 110, 42, 111, person.accent)
        p.rect(98, 104, 110, 116, person.cloth_shade)
        p.line([(99, 105), (109, 105)], person.accent_dark, 1)
        p.rect(100, 110, 108, 111, person.accent)
    p.line([(26, 120), (26, 127)], person.cloth_shade, 1)
    p.line([(102, 118), (102, 127)], person.cloth_shade, 1)
    p.dither_rect(36, 116, 50, 127, person.cloth, person.cloth_shade, 0.35)

    # --- шея
    p.rect(56, 74, 72, 94, person.skin_shade)
    p.rect(58, 74, 66, 90, person.skin)
    p.rect(66, 80, 72, 92, person.skin_shade)
    p.rect(58, 90, 66, 94, person.skin_shade)

    # --- волосы сзади (до лица)
    if person.kind == "mentor":
        p.poly([(36, 46), (34, 22), (46, 9), (64, 5), (82, 10), (92, 24), (90, 46), (84, 34), (78, 17), (56, 11), (44, 19), (38, 34)], person.hair)
        p.poly([(74, 12), (88, 22), (90, 36), (84, 30), (78, 18)], person.hair_light)
        p.rect(36, 40, 41, 56, person.hair)   # бакенбарда
    else:
        p.poly([(34, 54), (31, 24), (44, 7), (64, 3), (84, 9), (94, 26), (92, 54), (86, 40), (82, 19), (64, 13), (46, 20), (40, 40)], person.hair)
        p.poly([(60, 14), (78, 20), (88, 34), (82, 28), (70, 20)], person.hair_light)

    # --- лицо: яйцевидная форма с подбородком (3/4, поворот вправо-вверх)
    face = Image.new("L", (128, 128), 0)
    fd = ImageDraw.Draw(face)
    fd.ellipse([40, 14, 88, 66], fill=255)
    fd.polygon([(42, 40), (86, 40), (84, 62), (78, 76), (64, 80), (52, 72), (43, 56)], fill=255)
    p.dither_mask(face, person.skin, person.skin, 0.0)  # ровный тон
    # тень дальней половины лица и под скулой (дизеринг)
    p.dither_poly([(78, 16), (88, 24), (86, 60), (80, 74), (74, 70), (74, 34)], person.skin_shade, person.skin, 0.3)
    p.rect(56, 74, 70, 82, person.skin_shade)  # тень под подбородком
    p.rect(70, 76, 78, 80, person.skin_shade)
    # нос: переносица + кончик + ноздря
    p.vline(60, 42, 52, person.skin_shade)
    p.rect(58, 52, 63, 54, person.skin_shade)
    p.pixel(59, 57, SPACE_DEEP)
    p.pixel(58, 45, person.skin_shade)
    # ухо (одно, дальнее)
    p.ellipse(84, 38, 92, 56, person.skin_shade)
    p.ellipse(86, 41, 90, 53, person.skin)
    p.pixel(87, 46, person.skin_shade)
    # брови/глаза/рот по эмоции
    draw_face_emotion(p, person, emotion, eye_y=40, mouth_y=67)

    # --- детали: чёлка, гарнитура/шрам
    if person.kind == "mentor":
        p.poly([(44, 22), (56, 14), (70, 15), (64, 26), (50, 28)], person.hair)
        p.line([(46, 22), (58, 17)], person.hair_light, 1)
        p.rect(50, 30, 55, 33, person.skin_shade)   # шрам на виске
        p.pixel(51, 31, person.skin_light)
        p.pixel(53, 32, person.skin_light)
    else:
        # гарнитура диспетчера: наушник на дальнем ухе + микрофон-дужка
        p.rect(84, 40, 92, 52, person.cloth_shade)
        p.rect(86, 42, 90, 50, person.accent_dark)
        p.rect(87, 44, 89, 48, person.accent)
        p.line([(88, 54), (86, 60), (80, 62)], person.cloth_shade, 1)
        p.rect(78, 61, 82, 63, person.accent_dark)
        p.pixel(79, 62, person.accent)
        # шов синтетика на скуле
        p.line([(48, 50), (52, 55), (50, 62)], person.skin_shade, 1)

    # --- контур силуэта: голова+шея+торс, 1 px тёмный
    sd.polygon([(40, 16), (88, 16), (88, 64), (80, 82), (64, 86), (48, 78), (40, 60)], fill=255)
    sd.rectangle([54, 72, 74, 96], fill=255)
    p.outline_mask(sil, SPACE)
    return p


def draw_face_emotion(p: Painter, person: Person, emotion: str, eye_y: int, mouth_y: int):
    skin, shade, light = person.skin, person.skin_shade, person.skin_light
    dark = SPACE_DEEP
    sclera = WHITE
    brow = METAL_SHADOW if person.kind == "mentor" else person.hair

    def eye(cx: int, cy: int, w: int, h: int, iris_shift: int = 0, closed: int = 0):
        # тёмная обводка века, белок, радужка, зрачок, блик
        p.rect(cx - 1, cy - 1, cx + w + 1, cy + h + 1, dark)
        p.rect(cx, cy, cx + w, cy + h, sclera)
        if closed:
            p.rect(cx, cy, cx + w, cy + closed, shade)
            return
        ix = cx + (w - 3) // 2 + iris_shift
        iy = cy + max(0, (h - 3) // 2)
        p.rect(ix, iy, ix + 3, iy + 3, person.iris)
        p.rect(ix + 1, iy + 1, ix + 2, iy + 3, dark)
        if h >= 5:
            p.pixel(ix + 2, iy, light)
        p.rect(cx, cy, cx + w, cy + 1, shade)  # верхнее веко

    def brows(inner_dy, outer_dy, thick=2):
        # ближняя бровь (outer→inner к носу), дальняя (inner→outer)
        p.line([(44, eye_y + outer_dy), (58, eye_y + inner_dy)], brow, thick)
        p.line([(70, eye_y + inner_dy), (84, eye_y + outer_dy)], brow, thick)

    if emotion == "neutral":
        brows(-8, -8)
        eye(44, eye_y, 12, 5)
        eye(70, eye_y, 12, 5)
        p.line([(56, mouth_y), (70, mouth_y)], shade, 2)
        p.pixel(62, mouth_y + 1, dark)
        p.line([(57, mouth_y + 4), (69, mouth_y + 4)], shade, 1)
    elif emotion == "warm":
        brows(-11, -10)
        eye(44, eye_y, 12, 5)
        eye(70, eye_y, 12, 5)
        # улыбка: уголки вверх (+2..3 px), видна линия губ
        p.line([(53, mouth_y + 3), (57, mouth_y - 1), (67, mouth_y - 1), (73, mouth_y + 3)], shade, 2)
        p.line([(57, mouth_y + 3), (67, mouth_y + 3)], shade, 1)
        # румянец + приподнятые щёки
        p.dither_rect(43, 56, 51, 61, shade, person.accent, 0.22)
        p.dither_rect(73, 54, 81, 59, shade, person.accent, 0.22)
        p.pixel(50, 52, light)
        p.pixel(76, 50, light)
    elif emotion == "cold":
        brows(-6, -7)
        eye(44, eye_y, 12, 4, iris_shift=2)   # взгляд в сторону
        eye(70, eye_y, 12, 4, iris_shift=2)
        p.rect(44, eye_y + 3, 56, eye_y + 4, shade)
        p.rect(70, eye_y + 3, 82, eye_y + 4, shade)
        p.line([(55, mouth_y + 1), (71, mouth_y + 1)], shade, 2)
        p.line([(58, mouth_y + 3), (68, mouth_y + 3)], shade, 1)
    elif emotion == "angry":
        # брови сведены к переносице (внутренние концы ниже), складка между бровями
        p.line([(44, eye_y - 10), (58, eye_y - 5)], brow, 2)
        p.line([(70, eye_y - 5), (84, eye_y - 10)], brow, 2)
        p.line([(60, eye_y - 4), (68, eye_y - 4)], brow, 1)
        p.rect(60, eye_y - 3, 62, eye_y + 1, shade)
        p.rect(66, eye_y - 3, 68, eye_y + 1, shade)
        eye(44, eye_y, 12, 4)
        eye(70, eye_y, 12, 4)
        p.rect(44, eye_y, 56, eye_y + 1, shade)
        p.rect(70, eye_y, 82, eye_y + 1, shade)
        p.line([(55, mouth_y + 2), (62, mouth_y), (70, mouth_y + 2)], shade, 2)
        p.rect(60, mouth_y + 1, 65, mouth_y + 2, dark)
        p.dither_rect(42, 52, 52, 58, shade, ENEMY, 0.18)
        p.dither_rect(72, 50, 82, 56, shade, ENEMY, 0.18)
    elif emotion == "afraid":
        # брови высоко и «домиком» (внутренние вверх), глаза широко, открытый рот, пот
        p.line([(44, eye_y - 9), (58, eye_y - 13)], brow, 2)
        p.line([(70, eye_y - 13), (84, eye_y - 9)], brow, 2)
        eye(44, eye_y, 12, 7)
        eye(70, eye_y, 12, 7)
        p.rect(52, eye_y + 3, 54, eye_y + 5, dark)   # маленькие зрачки
        p.rect(78, eye_y + 3, 80, eye_y + 5, dark)
        p.rect(56, mouth_y - 1, 70, mouth_y + 4, dark)
        p.rect(58, mouth_y, 68, mouth_y + 1, WHITE)
        p.rect(60, mouth_y + 3, 66, mouth_y + 3, ENEMY_DARK)
        # капли пота (2 px + белый блик)
        p.rect(86, 34, 88, 39, SHIELD)
        p.rect(87, 35, 88, 37, WHITE)
        p.rect(46, 56, 47, 60, SHIELD)
        p.pixel(46, 55, WHITE)
    elif emotion == "sad":
        # внутренние концы бровей вверх (грусть), веки опущены, уголки рта вниз
        p.line([(44, eye_y - 6), (58, eye_y - 10)], brow, 2)
        p.line([(70, eye_y - 10), (84, eye_y - 6)], brow, 2)
        eye(44, eye_y, 12, 5, closed=2)
        eye(70, eye_y, 12, 5, closed=2)
        p.rect(44, eye_y + 1, 56, eye_y + 2, shade)
        p.rect(70, eye_y + 1, 82, eye_y + 2, shade)
        p.dither_rect(45, 50, 55, 54, shade, SPACE_FAR, 0.35)
        p.dither_rect(71, 49, 81, 53, shade, SPACE_FAR, 0.35)
        p.line([(54, mouth_y + 2), (58, mouth_y), (66, mouth_y), (72, mouth_y + 2)], shade, 2)
        p.line([(58, mouth_y + 5), (68, mouth_y + 5)], shade, 1)
        # слеза
        p.rect(84, 46, 85, 49, SHIELD)
        p.pixel(84, 49, WHITE)


def build_portraits() -> list[dict]:
    out = []
    for person in (TEIRA, KIRA):
        for idx, emotion in enumerate(EMOTIONS):
            p = draw_portrait(person, emotion, seed=hash((person.id, emotion)) & 0xFFFF)
            rel = f"portraits/{person.id}/{emotion}.png"
            path = os.path.join(DLC, rel)
            colors = p.save_png8(path, max_colors=16)
            out.append({"characterId": person.id, "characterName": person.name, "emotion": emotion,
                        "path": rel, "width": 128, "height": 128, "colors": colors,
                        "bytes": os.path.getsize(path)})
    return out


# ------------------------------------------------------------------- КАРТОЧКИ
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
    from PIL import ImageFont  # noqa: F401  (используется в _font)

    def load(rel):
        return Image.open(os.path.join(DLC, rel)).convert("RGB")

    def label(dr, xy, text, fill=TEXT2, f=F12):
        dr.text(xy, text, fill=fill, font=f)

    # 1) портреты: 2 строки по 6 эмоций, x2 (256x256), подписи
    cell = 128 * 2
    pad = 10
    title_h = 34
    sheet = Image.new("RGB", (6 * cell + 7 * pad, 2 * (cell + 20) + 3 * pad + title_h + 8), SPACE)
    d = ImageDraw.Draw(sheet)
    label(d, (pad, 8), "DLC XIV «Первый Свет» · портреты 128×128, 6 эмоций (канон 14b), апскейл ×2 nearest", TEXT, F16)
    for row, person in enumerate((TEIRA, KIRA)):
        y0 = title_h + pad + row * (cell + 20 + pad)
        label(d, (pad, y0), f"{person.name}  ({person.id}, {person.kind})", GOLD if row == 0 else SHIELD, F14)
        for col, emo in enumerate(EMOTIONS):
            img = scaled(load(f"portraits/{person.id}/{emo}.png"), 2)
            x = pad + col * (cell + pad)
            y = y0 + 22
            sheet.paste(img, (x, y))
            label(d, (x + 2, y + cell - 14), emo, GOLD if row == 0 else SHIELD, F12)
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

    # 5) общий лист-превью (как выглядит в UI: портрет 1x, карточка 1x, фон 1x, комикс 1x)
    sheet2 = Image.new("RGB", (1600, 900), SPACE)
    d2 = ImageDraw.Draw(sheet2)
    label(d2, (16, 10), "DLC XIV «Первый Свет» · арт-срез (task-34): портреты 128×128 ×12, карточки 320×180 ×2+placeholder, фон 640×360, комикс 640×240", TEXT, F16)
    for row, person in enumerate((TEIRA, KIRA)):
        y0 = 36 + row * 150
        label(d2, (16, y0), person.name, GOLD if row == 0 else SHIELD, F14)
        for col, emo in enumerate(EMOTIONS):
            img = load(f"portraits/{person.id}/{emo}.png")
            sheet2.paste(img, (16 + col * 140, y0 + 18))
            label(d2, (18 + col * 140, y0 + 148), emo, TEXT2, F12)
    sheet2.paste(load(cards_meta[0]["path"]), (900, 36))
    label(d2, (900, 220), "card q_pro_01_first_light (320×180)", GOLD, F12)
    sheet2.paste(load(cards_meta[1]["path"]), (1230, 36))
    label(d2, (1230, 220), "card q_pro_02_quiet_dock", SHIELD, F12)
    sheet2.paste(bg, (16, 330))
    label(d2, (16, 694), "background station_light_1 (640×360) + параллакс-слой", TEXT2, F12)
    sheet2.paste(load(comic_meta["path"]), (680, 330))
    label(d2, (680, 574), "comic q_pro_01_first_light_01 (640×240)", TEXT2, F12)
    total = sum(m["bytes"] for m in portraits_meta + cards_meta) + bg_meta["bytes"] + comic_meta["bytes"] + fore_meta["bytes"]
    label(d2, (680, 600), f"PNG-8 суммарно: {total/1024:.1f} КБ (лимит 2048 КБ)", OK if total <= 2 * 1024 * 1024 else ENEMY, F14)
    label(d2, (680, 620), "Палитра: PALETTE_HEX (24) + 2 служебных цвета Части XIII (#3A2B5C, #6BE08A)", TEXT2, F12)
    label(d2, (680, 638), "Текст в арт не запечён: карточки/комикс оставляют зоны под DOM-бабблы", TEXT2, F12)
    label(d2, (680, 656), "Портреты: 12 файлов × 128×128, 12–16 цветов, 1 px контур силуэта, Bayer 4×4", TEXT2, F12)
    try:
        voice_img = load("voices/svet_wave.png")
        sheet2.paste(voice_img, (1400, 330))
        label(d2, (1400, 462), "voice", TEXT2, F12)
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
            {"id": TEIRA.id, "nameRu": TEIRA.name, "portraitSize": 128,
             "portraits": {e: f"portraits/{TEIRA.id}/{e}.png" for e in EMOTIONS}},
            {"id": KIRA.id, "nameRu": KIRA.name, "portraitSize": 128,
             "portraits": {e: f"portraits/{KIRA.id}/{e}.png" for e in EMOTIONS}},
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
