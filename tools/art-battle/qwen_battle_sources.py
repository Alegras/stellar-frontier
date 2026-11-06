#!/usr/bin/env python3
"""Qwen-исходники для M5b (task-63): тайлы, иконки юнитов, эффекты, фоны. Только локальная Qwen-Image 2.1."""
import json, os, sys, time
import urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "art-dlc"))
import qwen_portraits as q

ROOT = q.ROOT
RAW = os.path.join(ROOT, "tools", "art-battle", "qwen-raw")
os.makedirs(RAW, exist_ok=True)
STEPS = 18
SEED_BASE = 9100

NEG = ("text, letters, watermark, logo, ui, frame, border, multiple objects, collage, sprite sheet, "
       "blurry, low quality, photo, 3d render, noisy")

TILE_DESC = {
    "empty": "an empty deep-space hexagon tile with a few tiny white stars on a very dark navy background",
    "asteroid": "a hexagon space tile with grey rocky asteroids and floating stones on a very dark navy background",
    "nebula": "a hexagon space tile with soft purple and blue nebula clouds on a very dark navy background",
    "mines": "a hexagon space tile with small glowing orange space mines and warning lights on a very dark navy background",
    "gravity": "a hexagon space tile with a glowing purple gravity anomaly ring and swirl on a very dark navy background",
    "wreck": "a hexagon space tile with metallic ship wreckage, torn hull plates and debris on a very dark navy background",
}
CLASS_DESC = {
    "corvette": "a small fast dart-shaped corvette spaceship",
    "frigate": "a frigate spaceship with two side fins and twin engines",
    "destroyer": "a long narrow destroyer spaceship with a spine cannon",
    "cruiser": "a bulky cruiser spaceship with several turrets",
    "battleship": "a heavy battleship spaceship with thick armor and big gun turrets",
    "carrier": "a flat-decked carrier spaceship with a hangar flight deck",
    "titan": "a massive ornate titan dreadnought spaceship with layered fins",
    "colossus": "a colossal ring-shaped super-heavy spaceship with a glowing core",
}
FACTION_DESC = {
    "player": "blue and cyan hull markings, cool blue engine glow",
    "enemy": "red and orange hull markings, warm red engine glow",
}
EFFECT_DESC = {
    "laser_shot": "a bright cyan laser bolt projectile flying horizontally with a glowing trail",
    "kinetic_shot": "an orange kinetic shell tracer with sparks and a smoke trail flying horizontally",
    "shield_hit": "a cyan hexagonal energy shield impact flash with bright sparks",
    "death_explosion": "a fiery orange explosion with debris, sparks and a shockwave ring",
}

def style(desc: str, extra="") -> str:
    return (f"Pixel art game asset, single centered object, {desc}, on plain pure black background, "
            f"crisp pixel shading, limited colour palette, high contrast, no text. {extra}")

def wait_idle(timeout=1800) -> None:
    """Не стартуем, если в ComfyUI уже что-то рендерится (ручные генерации пользователя важнее)."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5) as resp:
                q = json.loads(resp.read().decode("utf-8"))
            busy = len(q.get("queue_running", [])) + len(q.get("queue_pending", []))
            if busy == 0:
                return
            print(f"  очередь ComfyUI занята ({busy}); ждём...", flush=True)
        except Exception as e:
            print("  queue check failed:", e, flush=True)
        time.sleep(10)
    raise TimeoutError("ComfyUI занят дольше 30 минут")


def gen(prompt: str, w: int, h: int, seed: int, name: str) -> dict:
    path = os.path.join(RAW, name + ".png")
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        print(f"  {name} уже есть, пропускаю (resume)", flush=True)
        return {"name": name, "path": os.path.relpath(path, ROOT), "prompt": prompt, "seed": seed,
                "model": "qwen-image-2.1-UC-fp8", "steps": STEPS, "w": w, "h": h}
    wait_idle()
    t0 = time.time()
    pid = q.submit(q.t2i_graph(prompt, seed, w, h, steps=STEPS))
    hist = q.wait(pid, timeout=1800)
    meta = hist["outputs"]["8"]["images"][0]
    img = q.fetch_image(meta)
    img.save(path)
    print(f"  {name} {w}x{h} {time.time()-t0:.1f}s -> {path}", flush=True)
    return {"name": name, "path": os.path.relpath(path, ROOT), "prompt": prompt, "seed": seed,
            "model": "qwen-image-2.1-UC-fp8", "steps": STEPS, "w": w, "h": h}

def save_sources(src: dict) -> None:
    with open(os.path.join(RAW, "sources.json"), "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, indent=2)


def main() -> int:
    src = {"generator": "qwen-image-2.1 (local ComfyUI)", "steps": STEPS, "assets": []}
    def add(meta: dict) -> None:
        src["assets"].append(meta)
        save_sources(src)
    # 6 тайлов
    for i, (kind, desc) in enumerate(TILE_DESC.items()):
        add(gen(style(desc) + " Square composition, object fills the frame.",
                1024, 1024, SEED_BASE + i, "tile_" + kind))
    # 8 классов × 2 фракции
    idx = 0
    for faction in ("player", "enemy"):
        for cls, desc in CLASS_DESC.items():
            idx += 1
            p = style(f"{desc}, top-down three-quarter view spaceship", FACTION_DESC[faction])
            add(gen(p, 1024, 1024, SEED_BASE + 100 + idx, f"unit_{faction}_{cls}"))
    # 4 эффекта
    for i, (name, desc) in enumerate(EFFECT_DESC.items()):
        add(gen(style(desc) + " Horizontal composition, centered.", 1024, 512, SEED_BASE + 300 + i, "fx_" + name))
    # 2 фона
    add(gen(
        "Wide cinematic space battle background: distant blue planet, purple nebula, debris field, damaged "
        "station silhouette on the right, dark navy palette, stylized pixel-art-inspired game illustration, "
        "empty darker center for UI, no ships in foreground, no text.",
        1600, 900, SEED_BASE + 400, "bg_backdrop"))
    add(gen(
        "Top-down isometric space battlefield background, dark navy with faint nebula, scattered debris and "
        "asteroid patches, subtle grid-like light, stylized pixel-art-inspired game art, no text, no UI.",
        1280, 720, SEED_BASE + 401, "bg_battlefield2d"))
    with open(os.path.join(RAW, "sources.json"), "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, indent=2)
    print("sources:", len(src["assets"]), flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
