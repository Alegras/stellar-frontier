#!/usr/bin/env python3
"""
Валидатор арта DLC XIV (task-34): сверяет файлы в apps/web/public/dlc/ с
characters.json/cards.json (@sf/data) и manifest.json, проверяет бюджеты и формат.
Запуск: python tools/art-dlc/validate_dlc_art.py
Exit 0 — всё сходится; 1 — есть проблемы (печатает список).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DLC = os.path.join(ROOT, "apps", "web", "public", "dlc")
DATA = os.path.join(ROOT, "packages", "data", "src", "quests")
EMOTIONS = ["neutral", "warm", "cold", "angry", "afraid", "sad"]

errors: list[str] = []
warnings: list[str] = []


def check(cond: bool, msg: str):
    if not cond:
        errors.append(msg)


def png_info(rel: str):
    path = os.path.join(DLC, rel)
    if not os.path.isfile(path):
        errors.append(f"нет файла: {rel}")
        return None
    with Image.open(path) as im:
        mode, size = im.mode, im.size
        colors = len(im.getcolors(maxcolors=4096) or [])
    return {"path": rel, "mode": mode, "size": size, "colors": colors,
            "bytes": os.path.getsize(path)}


def main() -> int:
    data_chars = json.load(open(os.path.join(DATA, "characters.json"), encoding="utf-8"))
    data_cards = json.load(open(os.path.join(DATA, "cards.json"), encoding="utf-8"))
    manifest = json.load(open(os.path.join(DLC, "manifest.json"), encoding="utf-8"))

    # --- 1. персонажи: portrait + portraits => все 6 эмоций
    chars = data_chars["characters"] if isinstance(data_chars, dict) and "characters" in data_chars else data_chars
    check(isinstance(chars, list) and len(chars) >= 4, "characters.json: ожидается ≥4 персонажа (task-39)")
    for ch in chars:
        cid = ch.get("id", "?")
        portrait = ch.get("portrait") or ""
        # UI task-33 ждёт id-папку (portrait === cid); content-designer может временно хранить полный путь.
        if "/" in portrait:
            warnings.append(f"{cid}: portrait={portrait!r} — UI ждёт id-папку ({cid!r}); полный путь допустим, но проверь DialogueOverlay")
            folder = cid
        else:
            folder = portrait
            check(folder == cid, f"{cid}: portrait={portrait!r} != id папки {cid!r}")
        emotions = ch.get("emotions") or []
        check(emotions == EMOTIONS, f"{cid}: emotions должны быть ровно {EMOTIONS} (сейчас {emotions})")
        portraits = ch.get("portraits") or {}
        for emo in EMOTIONS:
            rel = portraits.get(emo, f"portraits/{folder}/{emo}.png")
            if portraits and portraits.get(emo) != f"portraits/{folder}/{emo}.png":
                warnings.append(f"{cid}: portraits[{emo}]={portraits.get(emo)!r} != portraits/{folder}/{emo}.png (UI строит путь по конвенции)")
            info = png_info(rel)
            if info:
                check(info["size"] == (128, 128), f"{rel}: размер {info['size']} != 128x128")
                check(info["mode"] == "P", f"{rel}: mode {info['mode']} != P (нужен PNG-8)")
                check(info["colors"] <= 32, f"{rel}: {info['colors']} цветов > 32 (палитра портрета, task-39)")
                check(info["bytes"] <= 12 * 1024, f"{rel}: {info['bytes']} B > 12 КБ (бюджет кадра, Qwen-рендер)")
            # карта portraits покрывает эмоции
            if portraits:
                check(emo in portraits, f"{cid}: в portraits нет эмоции {emo}")

    manifest_chars = {c.get("id"): c for c in manifest.get("characters", [])}
    json_ids = {c.get("id") for c in chars}
    if manifest_chars:
        check(set(manifest_chars) == json_ids,
              f"manifest.characters ({sorted(manifest_chars)}) != characters.json ({sorted(json_ids)})")
        for ch in chars:
            cid = ch.get("id")
            mc = manifest_chars.get(cid)
            if not mc:
                continue
            check(mc.get("portraitSize") == 128, f"manifest {cid}: portraitSize != 128")
            for emo in EMOTIONS:
                want = f"portraits/{cid}/{emo}.png"
                check(mc.get("portraits", {}).get(emo) == want,
                      f"manifest {cid}/{emo}: {mc.get('portraits', {}).get(emo)!r} != {want!r}")
                check(os.path.isfile(os.path.join(DLC, want)), f"нет файла {want}")
    else:
        warnings.append("manifest.characters отсутствует — сверка с characters.json пропущена")

    # --- 2. карточки: art => файл 320x180
    cards = data_cards["cards"] if isinstance(data_cards, dict) and "cards" in data_cards else data_cards
    check(isinstance(cards, list) and len(cards) >= 2, "cards.json: ожидается ≥2 карточки")
    checked_arts = set()
    for card in cards:
        art = card.get("art")
        check(bool(art), f"card {card.get('id')}: нет поля art")
        if not art or art in checked_arts:
            continue
        checked_arts.add(art)
        # UI task-33 строит url(/dlc/cards/{art}.png); допустимы обе формы, но канон — имя без папки/расширения.
        if "/" in art or art.endswith(".png"):
            warnings.append(f"card {card.get('id')}: art={art!r} — UI ждёт имя без папки/расширения (например {os.path.splitext(os.path.basename(art))[0]!r})")
            rel = art
        else:
            rel = f"cards/{art}.png"
        info = png_info(rel)
        if info:
            check(info["size"] == (320, 180), f"{art}: размер {info['size']} != 320x180")
            check(info["mode"] == "P", f"{art}: mode {info['mode']} != P (нужен PNG-8)")
            check(info["colors"] <= 24, f"{art}: {info['colors']} цветов > 24 (палитра карточки)")
            check(info["bytes"] <= 40 * 1024, f"{art}: {info['bytes']} B > 40 КБ (бюджет карточки, Qwen)")
        check(bool(card.get("accent")), f"card {card.get('id')}: нет accent (fallback UI)")

    # --- 3. фон и комикс по манифесту
    for asset in manifest.get("assets", []):
        rel = asset["path"]
        info = png_info(rel)
        if not info:
            continue
        check(info["size"] == (asset["width"], asset["height"]),
              f"{rel}: размер {info['size']} != {asset['width']}x{asset['height']}")
        check(info["mode"] in ("P", "PA") or rel.endswith("_fore.png"), f"{rel}: mode {info['mode']}, ожидается PNG-8")
        check(info["bytes"] == asset["bytes"], f"{rel}: байты в манифесте {asset['bytes']} != {info['bytes']} (перегенерируй манифест)")

    for asset in manifest.get("assets", []):
        if asset["path"].startswith("voices/"):
            info = png_info(asset["path"])
            if info:
                check(info["size"] == (128, 128), f"{asset['path']}: размер {info['size']} != 128x128")
                check(info["colors"] <= 16, f"{asset['path']}: {info['colors']} цветов > 16")
                check(info["bytes"] <= 3 * 1024, f"{asset['path']}: {info['bytes']} B > 3 КБ")
    check(bool(manifest.get("voices", {}).get("svet_wave")), "manifest.voices: нет svet_wave (14c §6.2 «голос»)")

    bg = png_info("backgrounds/station_light_1.png")
    if bg:
        check(bg["size"] == (640, 360), f"фон: {bg['size']} != 640x360")
        check(bg["colors"] <= 32, f"фон: {bg['colors']} цветов > 32")
        check(bg["bytes"] <= 150 * 1024, f"фон: {bg['bytes']} B > 150 КБ (Qwen-рендер)")
    comic = png_info("comics/q_pro_01_first_light_01.png")
    if comic:
        check(comic["size"] == (640, 240), f"комикс: {comic['size']} != 640x240")
        check(comic["colors"] <= 32, f"комикс: {comic['colors']} цветов > 32")
        check(comic["bytes"] <= 80 * 1024, f"комикс: {comic['bytes']} B > 80 КБ (Qwen-рендер)")

    # --- 4. бюджет всего арта (task-34: ≤ 2 МБ, doc 14c §6.8: ≤ 3.1 МБ)
    total = 0
    files = 0
    for root, _dirs, names in os.walk(DLC):
        for name in names:
            if name.lower().endswith(".png"):
                files += 1
                total += os.path.getsize(os.path.join(root, name))
    check(total <= 2 * 1024 * 1024, f"суммарно {total/1024:.1f} КБ > 2048 КБ (лимит task-34)")
    check(manifest.get("totalBytes") == total, f"manifest.totalBytes={manifest.get('totalBytes')} != фактических {total}")
    check(manifest.get("emotions") == EMOTIONS, "manifest.emotions != канон 14b")

    print(f"files: {files} PNG, total: {total} B = {total/1024:.1f} КБ (лимит 2048 КБ)")
    print(f"characters: {', '.join(c['id'] for c in chars)} | cards: {len(cards)} | arts: {len(checked_arts)}")
    if warnings:
        print("WARN:")
        for w in warnings:
            print("  -", w)
    if errors:
        print(f"FAIL: {len(errors)} проблем(ы):")
        for e in errors:
            print("  -", e)
        return 1
    print("OK: пути/эмоции/размеры/бюджеты сходятся с characters.json/cards.json/manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
