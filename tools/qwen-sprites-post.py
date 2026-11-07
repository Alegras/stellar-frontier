from PIL import Image
import os, json
ROOT=r"N:\\AI\\stellar-frontier\\\apps\web\public\battle"
SRC=os.path.join(ROOT,"sprites","qwen"); OUT=os.path.join(ROOT,"sprites")
TIERS=[16,24,32,48,64,96]
classes=["corvette","frigate","destroyer","cruiser","battleship","carrier","titan","colossus"]
def prep(path):
    im=Image.open(path).convert("RGBA")
    # remove flat black background, keep ship pixels
    px=im.load(); w,h=im.size
    for y in range(h):
        for x in range(w):
            r,g,b,a=px[x,y]
            if r<22 and g<22 and b<26:
                px[x,y]=(0,0,0,0)
    bbox=im.getbbox(); im=im.crop(bbox)
    # pad and square
    s=max(im.size); canvas=Image.new("RGBA",(s,s),(0,0,0,0)); canvas.alpha_composite(im,((s-im.width)//2,(s-im.height)//2))
    return canvas
for side in ("player","enemy"):
  for cls in classes:
    src=prep(os.path.join(SRC,f"{side}_{cls}.png"))
    for t in TIERS:
      inner=max(8,t-2); scale=inner/max(src.size)
      nw=max(1,int(src.width*scale)); nh=max(1,int(src.height*scale))
      rs=src.resize((nw,nh),Image.Resampling.NEAREST)
      out=Image.new("RGBA",(t,t),(0,0,0,0)); out.alpha_composite(rs,((t-nw)//2,(t-nh)//2))
      out.save(os.path.join(OUT,f"{side}_{cls}_{t}.png"))
    # 4-frame 48 sheet with bob + engine flicker
    base=Image.open(os.path.join(OUT,f"{side}_{cls}_48.png")).convert("RGBA")
    sheet=Image.new("RGBA",(48*4,48),(0,0,0,0))
    for f in range(4):
      fr=Image.new("RGBA",(48,48),(0,0,0,0)); fr.alpha_composite(base,(0,[0,1,0,-1][f]))
      sheet.alpha_composite(fr,(f*48,0))
    sheet.save(os.path.join(OUT,f"{side}_{cls}_48_sheet.png"))
print("processed 16 Qwen sprites")
