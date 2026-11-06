#!/usr/bin/env python3
"""Wan2.2 I2V тест: keyframe -> короткое видео (WebM) через локальный ComfyUI."""
import json, os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qwen_portraits as q

ROOT = q.ROOT
RAW = os.path.join(ROOT, "tools", "art-dlc", "menu-raw")
COMFY_INPUT = os.path.join(q.COMFY_DIR, "input")
COMFY_OUTPUT = os.path.join(q.COMFY_DIR, "output")
shutil.copyfile(os.path.join(RAW, "keyframe_832.png"), os.path.join(COMFY_INPUT, "menu_keyframe.png"))

W, H, LEN, STEPS, CFG, SEED = 832, 480, 33, 20, 5.0, 7001

graph = {
  "1": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "cpu"}},
  "2": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_ti2v_5B_fp16.safetensors", "weight_dtype": "default"}},
  "3": {"class_type": "VAELoader", "inputs": {"vae_name": "wan2.2_vae.safetensors"}},
  "4": {"class_type": "LoadImage", "inputs": {"image": "menu_keyframe.png"}},
  "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 0], "text": "Cinematic space battle near a blue planet and a damaged space station: a hero corvette firing a bright laser beam, raider ships with red engine glow, explosions, drifting debris, starfield, purple nebula, slow drifting camera, stylized pixel-art-inspired sci-fi game art, no text"}},
  "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 0], "text": "text, watermark, logo, blurry, distorted ships, morphing artifacts, extra limbs, camera cuts, flicker"}},
  "7": {"class_type": "Wan22ImageToVideoLatent", "inputs": {"vae": ["3", 0], "width": W, "height": H, "length": LEN, "batch_size": 1, "start_image": ["4", 0]}},
  "8": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "seed": SEED, "steps": STEPS, "cfg": CFG, "sampler_name": "uni_pc", "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1.0}},
  "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
  "10": {"class_type": "SaveWEBM", "inputs": {"images": ["9", 0], "filename_prefix": "menu_battle", "codec": "vp9", "fps": 12.0, "crf": 26.0}},
}

t0 = time.time()
pid = q.submit(graph)
print("submitted", pid, flush=True)
hist = q.wait(pid, timeout=1800)
print("done in", round(time.time() - t0, 1), "s", flush=True)
print(json.dumps(hist.get("outputs", {}), ensure_ascii=False)[:1200], flush=True)
# найти файл в output
outs = []
for node in hist.get("outputs", {}).values():
    for key in ("images", "gifs", "videos"):
        for it in node.get(key, []) or []:
            outs.append(it.get("filename"))
print("files:", outs, flush=True)
if outs:
    src = os.path.join(COMFY_OUTPUT, outs[0])
    dst = os.path.join(RAW, "video_test.webm")
    shutil.copyfile(src, dst)
    print("saved", dst, os.path.getsize(dst), "B", flush=True)
