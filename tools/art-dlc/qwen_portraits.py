#!/usr/bin/env python3
"""
task-41: портреты DLC через локальную Qwen-Image (ComfyUI 127.0.0.1:8188).

Пайплайн:
  1) neutral: text-to-image (CLIPLoader qwen_image + UNETLoader qwen-image-2.1-UC-fp8 + VAELoader),
     1024x1024, KSampler seed fixed, steps 25, cfg 1, euler/simple, EmptyLatentImage.
  2) остальные эмоции: Qwen-Image-Edit по референсу neutral (TextEncodeQwenImage21 + LoadImage,
     output latent из reference), denoise 0.72 — меняется только мимика, личность/свет/фон те же.
  3) пост: crop bust -> 128x128 -> PNG-8, adaptive quantize <=32 цветов (без дизеринга),
     лёгкий unsharp перед квантованием, чтобы не было «мыла».
  4) manifest.json обновляется по 24 портретам; превью docs/shots/dlc-portraits.png.

Запуск: python tools/art-dlc/qwen_portraits.py [--test] [--only teira_os]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

from PIL import Image, ImageFilter, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DLC = os.path.join(ROOT, "apps", "web", "public", "dlc")
SHOTS = os.path.join(ROOT, "docs", "shots")
RAW = os.path.join(ROOT, "tools", "art-dlc", "qwen-raw")
COMFY = "http://127.0.0.1:8188"
COMFY_DIR = r"E:\ComfyUI_windows_portable\ComfyUI"
INPUT_DIR = os.path.join(COMFY_DIR, "input")
OUTPUT_DIR = os.path.join(COMFY_DIR, "output")

EMOTIONS = ["neutral", "warm", "cold", "angry", "afraid", "sad"]
SEED_BASE = 424242


@dataclass(frozen=True)
class QChar:
    id: str
    name: str
    appearance: str
    emotion_hint: dict


CHARS = [
    QChar(
        id="teira_os",
        name="Тейра Ос",
        appearance=("44-year-old dark-skinned woman with deep brown skin, military commander, short cropped dark-brown hair with a "
                    "grey streak at the left temple, small pale scar cutting through her left eyebrow, "
                    "amber eyes, high-collared navy-blue uniform with gold epaulettes and a small rank bar, "
                    "composed and severe"),
        emotion_hint={
            "neutral": "neutral serious expression, looking straight at the viewer",
            "warm": "warm slight smile, corners of the mouth raised, eyes softened, eyebrows relaxed",
            "cold": "cold flat expression, gaze shifted to the side, eyelids slightly lowered, lips pressed thin",
            "angry": "angry expression, eyebrows drawn down toward the nose, narrowed eyes, mouth tight and down",
            "afraid": "frightened expression, eyebrows raised, eyes wide, lips slightly parted, a drop of sweat on the temple",
            "sad": "sad expression, inner eyebrows raised, heavy eyelids, mouth corners down, faint shadow under the eyes",
        },
    ),
    QChar(
        id="kira7",
        name="Кира-7",
        appearance=("synthetic female station dispatcher with very pale blue-white skin, almost porcelain, with a faint cyan holographic glow, "
                    "dark bob haircut, thin cyan headset over the ear with a small microphone boom, "
                    "teal high-collar crew uniform with a cyan insignia patch, luminous cyan eyes, calm"),
        emotion_hint={
            "neutral": "neutral expression, calm steady gaze",
            "warm": "warm grateful smile, eyes softened, head slightly tilted",
            "cold": "cold professional expression, flat lips, gaze shifted aside, one eyebrow slightly raised",
            "angry": "angry expression, eyebrows lowered, narrowed eyes, mouth pressed tight",
            "afraid": "scared expression, eyes wide, pupils small, lips parted, holographic edges flickering",
            "sad": "sad expression, eyelids lowered, mouth corners down, a cyan tear at the corner of the eye",
        },
    ),
    QChar(
        id="admiral_kain",
        name="Адмирал Кейн Ордо",
        appearance=("57-year-old fair-skinned weathered white man, fleet admiral, short silver-white cropped hair, "
                    "deep facial lines, old pale scars, cybernetic left eye with a thin gold ring, stern jaw, "
                    "black-and-navy command uniform with gold epaulettes and a small multicolour ribbon bar"),
        emotion_hint={
            "neutral": "stern neutral expression, commanding stare",
            "warm": "rare warm fatherly smile, eyes narrowed kindly, head slightly lowered",
            "cold": "cold measured expression, flat mouth, piercing gaze from under the brows",
            "angry": "angry expression, heavy brows drawn together, hard eyes, jaw tight",
            "afraid": "alarmed expression, eyes widened, brows raised, mouth slightly open",
            "sad": "sad weary expression, heavy eyelids, mouth corners down, gaze lowered",
        },
    ),
    QChar(
        id="counselor_selen",
        name="Советник Селена Вэр",
        appearance=("close-up bust portrait, head and shoulders fill the frame, large detailed face: "
                    "46-year-old Ansari-descendant woman, an elegant blend of a noble human woman and an ancient "
                    "biomechanical skeletal android, beautiful human facial structure with silver-grey metallic skin "
                    "panels and fine segmented seams along the cheekbones and neck, softly glowing pale blue eyes, "
                    "long dark violet hair with a single psi-purple strand, a silver circlet with a small blue gem on "
                    "the forehead, high-collared dark purple diplomatic robe with silver and cyan trim, calm and regal"),
        emotion_hint={
            "neutral": "neutral composed expression, warm steady gaze",
            "warm": "warm diplomatic smile, eyes softly narrowed, head slightly tilted",
            "cold": "cold reserved expression, eyes half-lidded, mouth flat, one eyebrow slightly arched",
            "angry": "angry expression, brows drawn down, eyes sharp, lips pressed into a thin line",
            "afraid": "afraid expression, brows raised, eyes wide, lips parted, circlet gem glowing brighter",
            "sad": "sad expression, inner brows raised, lowered eyelids, mouth corners down, faint tear",
        },
    ),
]

NEG = ("different person, different face, changed hairstyle, changed clothing, different background, "
       "different lighting, blurry, low quality, extra fingers, deformed, text, watermark, logo, signature")


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def base_graph() -> dict:
    return {
        "1": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_int8_convrot.safetensors",
                                                     "type": "qwen_image", "device": "cpu"}},
        "2": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen-image-2.1-UC-fp8.safetensors",
                                                     "weight_dtype": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
    }


def submit(prompt_graph: dict) -> str:
    payload = {"prompt": prompt_graph, "client_id": "sf-dlc-qwen"}
    res = post_json(COMFY + "/prompt", payload)
    if "prompt_id" not in res:
        raise RuntimeError("ComfyUI rejected prompt: " + json.dumps(res)[:800])
    return res["prompt_id"]


def wait(prompt_id: str, timeout=900) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = get_json(COMFY + "/history/" + prompt_id)
        if prompt_id in h:
            return h[prompt_id]
        time.sleep(2)
    raise TimeoutError("generation timeout: " + prompt_id)


def fetch_image(meta: dict) -> Image.Image:
    q = urllib.parse.urlencode({"filename": meta["filename"], "subfolder": meta.get("subfolder", ""),
                                "type": meta.get("type", "output")})
    with urllib.request.urlopen(COMFY + "/view?" + q, timeout=120) as resp:
        return Image.open(io.BytesIO(resp.read())).convert("RGB")


def t2i_graph(prompt: str, seed: int, w=1024, h=1024, steps=25) -> dict:
    g = base_graph()
    g.update({
        "4": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["1", 0], "prompt": prompt, "negative_prompt": NEG,
            "resolution": 1024, "images": []}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "6": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "seed": seed, "steps": steps, "cfg": 1.0,
                                                   "sampler_name": "euler", "scheduler": "simple",
                                                   "positive": ["4", 0], "negative": ["4", 1],
                                                   "latent_image": ["5", 0], "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0], "filename_prefix": "qwen_sf_t2i"}},
    })
    return g


def edit_graph(ref_name: str, prompt: str, seed: int, steps=25, denoise=1.0) -> dict:
    """Классический Qwen-Image-Edit: LoadImage -> VAEEncode (latent) + TextEncodeQwenImageEdit (identity)."""
    g = base_graph()
    g.update({
        "4": {"class_type": "LoadImage", "inputs": {"image": ref_name}},
        "5": {"class_type": "VAEEncode", "inputs": {"pixels": ["4", 0], "vae": ["3", 0]}},
        "6": {"class_type": "TextEncodeQwenImageEdit", "inputs": {
            "clip": ["1", 0], "prompt": prompt, "vae": ["3", 0], "image": ["4", 0]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 0], "text": ""}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "seed": seed, "steps": steps, "cfg": 1.0,
                                                   "sampler_name": "euler", "scheduler": "simple",
                                                   "positive": ["6", 0], "negative": ["7", 0],
                                                   "latent_image": ["5", 0], "denoise": denoise}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "qwen_sf_edit"}},
    })
    return g


def gen_t2i(prompt: str, seed: int, tag: str) -> str:
    pid = submit(t2i_graph(prompt, seed))
    hist = wait(pid)
    img_meta = hist["outputs"]["8"]["images"][0]
    return img_meta["filename"]


def gen_edit(ref_file: str, prompt: str, seed: int, tag: str, denoise=0.72) -> str:
    shutil.copyfile(os.path.join(RAW, ref_file), os.path.join(INPUT_DIR, ref_file))
    pid = submit(edit_graph(ref_file, prompt, seed, denoise=denoise))
    hist = wait(pid)
    return hist["outputs"]["10"]["images"][0]["filename"]


def style_prompt(char: QChar, emotion: str) -> str:
    return ("Pixel art character portrait, bust, three-quarter view, dark navy background, strong single rim light "
            "from the right, limited colour palette, crisp pixel shading, 1990s JRPG dialogue portrait style, "
            f"high quality, sharp: {char.appearance}. Expression: {char.emotion_hint[emotion]}.")


def edit_prompt(char: QChar, emotion: str) -> str:
    return ("Keep exactly the same person, same face, same hairstyle, same clothing, same lighting, same background, "
            "same framing; change ONLY the facial expression. "
            f"Expression: {char.emotion_hint[emotion]}. Pixel art portrait, crisp pixels, limited palette.")


CROP = (0.15, 0.02, 0.85, 0.72)  # square-ish bust around head+shoulders
CROP_BY_ID = {"counselor_selen": (0.20, 0.04, 0.80, 0.64)}  # крупнее лицо, вровень с остальными


def postprocess(src_path: str, out_path: str, char_id: str = "") -> tuple[int, int]:
    im = Image.open(src_path).convert("RGB")
    w, h = im.size
    crop_frac = CROP_BY_ID.get(char_id, CROP)
    box = (int(w * crop_frac[0]), int(h * crop_frac[1]), int(w * crop_frac[2]), int(h * crop_frac[3]))
    crop = im.crop(box)
    # квадрат по центру кропа
    side = min(crop.size)
    left = (crop.width - side) // 2
    top = (crop.height - side) // 2
    crop = crop.crop((left, top, left + side, top + side))
    small = crop.resize((128, 128), Image.Resampling.LANCZOS)
    small = small.filter(ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=2))
    q = small.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    q.save(out_path, format="PNG", optimize=True)
    return len(q.getcolors(maxcolors=256) or []), os.path.getsize(out_path)


def update_manifest() -> dict:
    path = os.path.join(DLC, "manifest.json")
    manifest = json.load(open(path, encoding="utf-8"))
    total = 0
    hashes = {}
    for a in manifest["assets"]:
        p = os.path.join(DLC, a["path"])
        if a["path"].startswith("portraits/"):
            with Image.open(p) as im:
                a["colors"] = len(im.getcolors(maxcolors=256) or [])
            a["bytes"] = os.path.getsize(p)
            a["generator"] = "qwen-image-2.1 (local ComfyUI, seed %d, edit-denoise 0.72)" % SEED_BASE
        total += a["bytes"]
        with open(p, "rb") as fh:
            hashes[a["path"]] = hashlib_sha(fh.read())
    manifest["totalBytes"] = total
    manifest["totalKb"] = round(total / 1024, 1)
    manifest["sha256_16"] = hashes
    manifest["portraitPipeline"] = {
        "generator": "qwen-image-2.1-UC-fp8 + qwen3vl_8b (ComfyUI 127.0.0.1:8188)",
        "neutral": "text-to-image, 1024x1024, 25 steps, cfg 1, euler/simple, seed %d" % SEED_BASE,
        "emotions": "qwen-image-2.1 edit from neutral reference, denoise 0.72, same seed",
        "post": "crop bust -> 128x128 LANCZOS -> unsharp -> PNG-8 32 colors (no dither)",
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest


def hashlib_sha(data: bytes) -> str:
    import hashlib
    return hashlib.sha256(data).hexdigest()[:16]


def font(size=14):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build_preview() -> None:
    cell = 256
    pad = 10
    title = 36
    sheet = Image.new("RGB", (6 * cell + 7 * pad, title + 4 * (cell + 26) + 4 * pad), (5, 7, 14))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 10), "DLC XIV · портреты: локальная Qwen-Image 2.1 (ComfyUI) · 4 персонажа × 6 эмоций · 128×128 → ×2 nearest",
           fill=(232, 238, 247), font=font(16))
    for row, ch in enumerate(CHARS):
        y0 = title + pad + row * (cell + 26 + pad)
        d.text((pad, y0), f"{ch.name} ({ch.id})", fill=(245, 197, 66), font=font(14))
        for col, emo in enumerate(EMOTIONS):
            p = os.path.join(DLC, "portraits", ch.id, emo + ".png")
            img = Image.open(p).convert("RGB").resize((cell, cell), Image.NEAREST)
            x = pad + col * (cell + pad)
            y = y0 + 20
            sheet.paste(img, (x, y))
            d.rectangle([x - 1, y - 1, x + cell, y + cell], outline=(56, 65, 79))
            d.text((x + 2, y + cell - 14), emo, fill=(232, 238, 247), font=font(12))
    sheet.save(os.path.join(SHOTS, "dlc-portraits.png"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="только teira neutral+warm, без записи в public")
    ap.add_argument("--only", default="", help="id персонажа")
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    chars = [c for c in CHARS if not args.only or c.id == args.only]
    if args.test:
        ch = chars[0]
        print("T2I neutral...", flush=True)
        t0 = time.time()
        f_neutral = gen_t2i(style_prompt(ch, "neutral"), SEED_BASE, "neutral")
        print("  ->", f_neutral, f"{time.time()-t0:.1f}s", flush=True)
        shutil.copyfile(os.path.join(OUTPUT_DIR, f_neutral), os.path.join(RAW, f"{ch.id}_neutral_raw.png"))
        print("EDIT warm...", flush=True)
        t0 = time.time()
        f_warm = gen_edit(f"{ch.id}_neutral_raw.png", edit_prompt(ch, "warm"), SEED_BASE, "warm")
        print("  ->", f_warm, f"{time.time()-t0:.1f}s", flush=True)
        shutil.copyfile(os.path.join(OUTPUT_DIR, f_warm), os.path.join(RAW, f"{ch.id}_warm_raw.png"))
        for emo in ("neutral", "warm"):
            src = os.path.join(RAW, f"{ch.id}_{emo}_raw.png")
            out = os.path.join(RAW, f"test_{ch.id}_{emo}.png")
            colors, size = postprocess(src, out)
            print("post:", out, colors, "color", size, "B", flush=True)
        return 0

    for ch in chars:
        print(f"== {ch.id}: neutral (t2i)", flush=True)
        t0 = time.time()
        f = gen_t2i(style_prompt(ch, "neutral"), SEED_BASE, "neutral")
        src = os.path.join(OUTPUT_DIR, f)
        shutil.copyfile(src, os.path.join(RAW, f"{ch.id}_neutral_raw.png"))
        for emo in EMOTIONS:
            if emo == "neutral":
                raw = src
            else:
                print(f"   t2i {emo}...", flush=True)
                t1 = time.time()
                f2 = gen_t2i(style_prompt(ch, emo), SEED_BASE, emo)
                raw = os.path.join(OUTPUT_DIR, f2)
                shutil.copyfile(raw, os.path.join(RAW, f"{ch.id}_{emo}_raw.png"))
                print(f"   {emo} {time.time()-t1:.1f}s", flush=True)
            out = os.path.join(DLC, "portraits", ch.id, emo + ".png")
            colors, size = postprocess(raw, out, ch.id)
            print(f"   saved {out} {colors}c {size}B", flush=True)
        print(f"== {ch.id} total {time.time()-t0:.1f}s", flush=True)

    update_manifest()
    build_preview()
    print("manifest + preview updated", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
