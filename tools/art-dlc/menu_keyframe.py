import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qwen_portraits as q
from PIL import Image
os.makedirs(os.path.join(q.ROOT, "apps", "web", "public", "menu"), exist_ok=True)
os.makedirs(os.path.join(q.ROOT, "tools", "art-dlc", "menu-raw"), exist_ok=True)

PROMPT = ("Cinematic wide shot of a space battle near a huge blue planet and a damaged space station: a small "
          "hero corvette firing bright laser bolts, three angular raider ships with red engine glow, explosions "
          "and drifting debris, starfield and purple nebula, dark navy palette with cyan and orange accents, "
          "stylized pixel-art-inspired game illustration, crisp detail, dramatic rim light, no text")
NEG = "text, letters, watermark, logo, ui, frame, low quality, blurry, deformed ships, duplicate"
pid = q.submit(q.t2i_graph(PROMPT + ", " + NEG, 6001, 1280, 704, steps=25))
t0 = time.time()
hist = q.wait(pid, timeout=900)
meta = hist["outputs"]["8"]["images"][0]
img = q.fetch_image(meta)
raw = os.path.join(q.ROOT, "tools", "art-dlc", "menu-raw", "keyframe_raw.png")
img.save(raw)
print("keyframe saved", raw, img.size, round(time.time()-t0,1), "s", flush=True)
# уменьшенный keyframe для видео 832x480 (crop cover)
target = img.resize((832, 480), Image.Resampling.LANCZOS)
target.save(os.path.join(q.ROOT, "tools", "art-dlc", "menu-raw", "keyframe_832.png"))
print("keyframe_832 saved", flush=True)
