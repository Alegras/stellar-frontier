from PIL import Image, ImageDraw
import os, json
ROOT=r"N:\\AI\\stellar-frontier\apps\web\public\battle"
sp=os.path.join(ROOT,"sprites")
man=json.load(open(os.path.join(ROOT,"manifest.json"),encoding="utf-8"))
for side in ("player","enemy"):
  for cls in man["units"][side]:
    base=Image.open(os.path.join(ROOT,man["units"][side][cls]["tiers"]["48"]["path"])).convert("RGBA")
    sheet=Image.new("RGBA",(48*4,48),(0,0,0,0))
    for f in range(4):
      frame=Image.new("RGBA",(48,48),(0,0,0,0))
      dy=[0,1,0,-1][f]
      frame.alpha_composite(base,(0,dy))
      d=ImageDraw.Draw(frame)
      # engine flicker
      if f%2==0:
        d.rectangle([16,43,31,46],fill=(255,211,106,180))
      sheet.alpha_composite(frame,(f*48,0))
    rel=f"sprites/{side}_{cls}_48_sheet.png"; sheet.save(os.path.join(ROOT,rel))
    man["units"][side][cls]["tiers"]["48"]={"path":rel,"w":48,"h":48}
    man["units"][side][cls]["frameW"]=48; man["units"][side][cls]["frameH"]=48; man["units"][side][cls]["frames"]=4; man["units"][side][cls]["fps"]=8; man["units"][side][cls]["loop"]=True
json.dump(man,open(os.path.join(ROOT,"manifest.json"),"w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("sheets 32")
