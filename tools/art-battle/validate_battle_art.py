#!/usr/bin/env python3
"""Валидатор арта M5b (task-63): manifest ↔ файлы, палитра, strips, прозрачность, бюджеты, Qwen-метаданные."""
from __future__ import annotations
import json, os, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUB = os.path.join(ROOT, "apps", "web", "public", "battle")
MAN = os.path.join(PUB, "manifest.json")
LIMIT = 5 * 1024 * 1024
EXPECT_TILES = {"empty": 1, "asteroid": 4, "nebula": 4, "mines": 6, "gravity": 4, "wreck": 1}
EXPECT_EFFECTS = {"laser_shot": 6, "kinetic_shot": 6, "shield_hit": 6, "death_explosion": 6}
CLASSES = ["corvette", "frigate", "destroyer", "cruiser", "battleship", "carrier", "titan", "colossus"]

problems: list[str] = []
notes: list[str] = []

def fail(msg: str) -> None:
    problems.append(msg)

def check_asset(group: str, key: str, a: dict, tile_colors_max: int | None = None) -> None:
    p = os.path.join(PUB, a.get("path", ""))
    if not os.path.exists(p):
        fail(f"{group}/{key}: нет файла {a.get('path')}")
        return
    with Image.open(p) as im:
        im.load()
        fw, fh, n = a.get("frameW", 0), a.get("frameH", 0), a.get("frames", 0)
        if im.size != (fw * n, fh):
            fail(f"{group}/{key}: размер {im.size} != strips {(fw*n, fh)}")
        if im.mode in ("RGBA", "PA"):
            rgba = im.convert("RGBA")
            colors = len({p[:3] for p in rgba.getdata() if p[3] > 0})
        else:
            colors = len({p[:3] for p in im.convert("RGB").getdata()})
        if colors > 32:
            fail(f"{group}/{key}: {colors} цветов > 32")
        if tile_colors_max and colors > tile_colors_max:
            fail(f"{group}/{key}: {colors} цветов > {tile_colors_max} (правило тайла)")
        if group in ("tiles", "units", "effects"):
            if im.mode not in ("RGBA", "PA") and "transparency" not in im.info:
                fail(f"{group}/{key}: нет альфа-канала")
            else:
                alpha = im.convert("RGBA").getchannel("A")
                if alpha.getextrema()[0] != 0:
                    fail(f"{group}/{key}: альфа без прозрачных пикселей")
    src = a.get("source") or {}
    for field in ("prompt", "seed", "model"):
        if not src.get(field) and not a.get("frameSource"):
            fail(f"{group}/{key}: в manifest нет Qwen-поля source.{field}")
    if not a.get("bytes"):
        fail(f"{group}/{key}: bytes=0")
    anchor = a.get("anchor")
    if not anchor or len(anchor) != 2:
        fail(f"{group}/{key}: нет anchor")

def main() -> int:
    if not os.path.exists(MAN):
        print("FAIL: нет manifest.json")
        return 1
    m = json.load(open(MAN, encoding="utf-8"))
    pal = m.get("palette") or []
    if len(pal) > 32:
        fail(f"палитра {len(pal)} > 32")
    for t in ("empty", "asteroid", "nebula", "mines", "gravity", "wreck"):
        a = m.get("tiles", {}).get(t)
        if not a:
            if f"tiles/{t}.png" not in m.get("pending", []):
                fail(f"tiles/{t}: нет ни ассета, ни pending")
            continue
        if EXPECT_TILES[t] and a.get("frames") != EXPECT_TILES[t]:
            fail(f"tiles/{t}: frames={a.get('frames')} != {EXPECT_TILES[t]}")
        check_asset("tiles", t, a, tile_colors_max=3)
        # прозрачные углы гекса
        im = Image.open(os.path.join(PUB, a["path"])).convert("RGBA")
        for (x, y) in ((0, 0), (31, 0), (0, 35), (31, 35)):
            if im.getpixel((x, y))[3] != 0:
                fail(f"tiles/{t}: угол гекса ({x},{y}) не прозрачный")
    for fac in ("player", "enemy"):
        for cls in CLASSES:
            a = m.get("units", {}).get(fac, {}).get(cls)
            if not a:
                if f"units/{fac}/{cls}.png" not in m.get("pending", []):
                    fail(f"units/{fac}/{cls}: нет ни ассета, ни pending")
                continue
            if a.get("frames") != 6:
                fail(f"units/{fac}/{cls}: frames={a.get('frames')} != 6")
            order = a.get("frameOrder") or []
            if order != ["idle_0", "idle_1", "move_0", "move_1", "attack_0", "attack_1"]:
                fail(f"units/{fac}/{cls}: frameOrder не совпадает с контрактом")
            check_asset("units", f"{fac}/{cls}", a)
    for name, n in EXPECT_EFFECTS.items():
        a = m.get("effects", {}).get(name)
        if not a:
            if f"effects/{name}.png" not in m.get("pending", []):
                fail(f"effects/{name}: нет ни ассета, ни pending")
            continue
        if a.get("frames") != n:
            fail(f"effects/{name}: frames={a.get('frames')} != {n}")
        check_asset("effects", name, a)
    for name, (w, h) in (("backdrop", (1920, 1080)), ("battlefield2d", (640, 360))):
        a = m.get("backgrounds", {}).get(name)
        if not a:
            if name in m.get("pending", []) or True:
                continue
            continue
        p = os.path.join(PUB, a["path"])
        if not os.path.exists(p):
            fail(f"bg/{name}: нет файла")
            continue
        with Image.open(p) as im:
            if im.size != (w, h):
                fail(f"bg/{name}: размер {im.size} != {(w, h)}")
            if len(im.getcolors(maxcolors=512) or []) > 32:
                fail(f"bg/{name}: > 32 цветов")
        if not (a.get("source") or {}).get("prompt"):
            fail(f"bg/{name}: нет Qwen source")
    total = m.get("totalBytes", 0)
    if total > LIMIT:
        fail(f"totalBytes {total} > 5 МБ")
    if not m.get("ready"):
        notes.append(f"пас не финальный: {len(m.get('pending') or [])} ассетов ещё ждут Qwen")
    print(f"manifest: tiles={len(m.get('tiles', {}))}, player={len(m.get('units', {}).get('player', {}))}, "
          f"enemy={len(m.get('units', {}).get('enemy', {}))}, effects={len(m.get('effects', {}))}, "
          f"bg={len(m.get('backgrounds', {}))}, pending={len(m.get('pending') or [])}, total={total} B")
    for n in notes:
        print("INFO:", n)
    if problems:
        print(f"FAIL: {len(problems)} проблем")
        for p in problems:
            print("  -", p)
        return 1
    print("OK: структура/палитра/прозрачность/бюджеты/метаданные сходятся")
    return 0

if __name__ == "__main__":
    sys.exit(main())
