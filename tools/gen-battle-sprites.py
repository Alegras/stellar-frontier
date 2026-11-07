from PIL import Image, ImageDraw
import os, json, math
ROOT = r"N:\\AI\\stellar-frontier\\\apps\web\public\battle"
SPR = os.path.join(ROOT, "sprites")
ICON = os.path.join(ROOT, "icons")
os.makedirs(SPR, exist_ok=True); os.makedirs(ICON, exist_ok=True)
TIERS=[16,24,32,48,64,96]
SIDES={"player":(79,195,247),"enemy":(255,90,90)}
# silhouette shapes normalized 0..1, top-down, nose up
SHAPES={
 "corvette":[(0.5,0.02),(0.68,0.35),(0.62,0.8),(0.5,0.98),(0.38,0.8),(0.32,0.35)],
 "frigate":[(0.5,0.02),(0.78,0.35),(0.72,0.72),(0.58,0.9),(0.42,0.9),(0.28,0.72),(0.22,0.35)],
 "destroyer":[(0.5,0.01),(0.7,0.25),(0.84,0.7),(0.62,0.86),(0.5,0.98),(0.38,0.86),(0.16,0.7),(0.3,0.25)],
 "cruiser":[(0.5,0.04),(0.8,0.2),(0.9,0.6),(0.66,0.9),(0.34,0.9),(0.1,0.6),(0.2,0.2)],
 "battleship":[(0.5,0.02),(0.74,0.12),(0.92,0.35),(0.86,0.72),(0.62,0.92),(0.38,0.92),(0.14,0.72),(0.08,0.35),(0.26,0.12)],
 "carrier":[(0.18,0.08),(0.82,0.08),(0.92,0.5),(0.82,0.92),(0.18,0.92),(0.08,0.5)],
 "titan":[(0.5,0.01),(0.84,0.14),(0.96,0.5),(0.8,0.85),(0.55,0.98),(0.45,0.98),(0.2,0.85),(0.04,0.5),(0.16,0.14)],
 "colossus":[(0.5,0.02),(0.85,0.2),(0.98,0.55),(0.75,0.92),(0.25,0.92),(0.02,0.55),(0.15,0.2)],
}
def hexrgb(c): return c
def draw_unit(cls, size, color):
    img=Image.new("RGBA",(size,size),(0,0,0,0)); d=ImageDraw.Draw(img)
    pad=max(1,size//10)
    pts=[(pad+p[0]*(size-2*pad),pad+p[1]*(size-2*pad)) for p in SHAPES[cls]]
    d.polygon(pts, fill=(*color,255), outline=(5,10,18,255))
    # dark inner panel + highlights
    inner=[(p[0]*0.78+size*0.11,p[1]*0.78+size*0.11) for p in pts]
    d.polygon(inner, fill=(12,22,38,255))
    # core stripe
    core=[(p[0]*0.5+size*0.25,p[1]*0.5+size*0.25) for p in pts]
    d.polygon(core, fill=(*color,255))
    # engines
    for x in (0.35,0.65):
        d.rectangle([int(x*size)-max(1,size//24),int(size*0.88),int(x*size)+max(1,size//24),int(size*0.98)], fill=(255,211,106,255))
    # class-specific details
    if cls=="carrier":
        d.line([(size*0.2,size*0.5),(size*0.8,size*0.5)],fill=(232,238,247,255),width=max(1,size//32))
    elif cls in ("battleship","titan","colossus"):
        for x in (0.28,0.5,0.72):
            d.line([(x*size,size*0.25),(x*size,size*0.75)],fill=(232,238,247,255),width=max(1,size//32))
    # outline again crisp
    d.line(pts+[pts[0]], fill=(232,238,247,180), width=max(1,size//32))
    return img
units={}
for side,col in SIDES.items():
    units[side]={}
    for cls in SHAPES:
        tiers={}
        for t in TIERS:
            im=draw_unit(cls,t,col)
            rel=f"sprites/{side}_{cls}_{t}.png"
            im.save(os.path.join(ROOT,rel))
            tiers[str(t)]={"path":rel,"w":t,"h":t}
        units[side][cls]={"tiers":tiers,"frameW":t,"frameH":t,"frames":1,"fps":8,"loop":False}
# icons: simple readable glyphs
icons={}
def icon(name, kind, color=(245,197,66)):
    for t in (16,24,32,48):
        img=Image.new("RGBA",(t,t),(0,0,0,0)); d=ImageDraw.Draw(img); s=t
        if kind=="attack":
            d.line([(s*.2,s*.8),(s*.8,s*.2)],fill=(*color,255),width=max(1,s//8)); d.polygon([(s*.8,s*.2),(s*.55,s*.25),(s*.75,s*.45)],fill=(*color,255))
        elif kind=="move":
            d.line([(s*.2,s*.5),(s*.75,s*.5)],fill=(79,195,247,255),width=max(1,s//8)); d.polygon([(s*.8,s*.5),(s*.55,s*.35),(s*.55,s*.65)],fill=(79,195,247,255))
        elif kind=="defend":
            d.polygon([(s*.5,s*.1),(s*.85,s*.3),(s*.75,s*.75),(s*.5,s*.9),(s*.25,s*.75),(s*.15,s*.3)],outline=(79,195,247,255),width=max(1,s//10))
        elif kind=="overwatch":
            d.ellipse([s*.15,s*.15,s*.85,s*.85],outline=(180,140,242,255),width=max(1,s//10)); d.ellipse([s*.4,s*.4,s*.6,s*.6],fill=(180,140,242,255))
        elif kind=="wait":
            d.rectangle([s*.3,s*.15,s*.4,s*.85],fill=(143,163,191,255)); d.rectangle([s*.6,s*.15,s*.7,s*.85],fill=(143,163,191,255))
        elif kind=="ability":
            d.polygon([(s*.5,s*.05),(s*.65,s*.35),(s*.95,s*.5),(s*.65,s*.65),(s*.5,s*.95),(s*.35,s*.65),(s*.05,s*.5),(s*.35,s*.35)],fill=(180,140,242,255))
        elif kind=="endturn":
            d.line([(s*.2,s*.2),(s*.2,s*.8)],fill=(245,197,66,255),width=max(1,s//8)); d.polygon([(s*.25,s*.3),(s*.8,s*.5),(s*.25,s*.7)],fill=(245,197,66,255))
        else:
            d.rectangle([s*.15,s*.15,s*.85,s*.85],outline=(*color,255),width=max(1,s//10))
        rel=f"icons/{name}_{t}.png"; img.save(os.path.join(ROOT,rel)); icons.setdefault(name,{})[str(t)]={"path":rel,"w":t,"h":t}
for name,kind in [("action_attack","attack"),("action_move","move"),("action_defend","defend"),("action_overwatch","overwatch"),("action_wait","wait"),("action_ability","ability"),("action_endturn","endturn"),("action_auto","auto")]: icon(name,kind)
for i in range(1,13): icon(f"status_{i}","defend",(107,230,117) if i%2 else (245,197,66))
for i,a in enumerate(["focus_fire","emergency_repair","ew_jam","torpedo_fan","shield_barrier","interceptors","tactical_retreat","reserve","boarding","reactor_overload","veteran","logist","shieldsmith","sniper","fortitude","tactician"]): icon("ability_"+a,"ability",(180,140,242))
manifest={"version":"2.0","generated":"deterministic-pillow","tiers":TIERS,"units":units,"icons":icons,
 "actions":{n:f"icons/{n}_32.png" for n in ["action_attack","action_move","action_defend","action_overwatch","action_wait","action_ability","action_endturn","action_auto"]},
 "statuses":{f"status_{i}":f"icons/status_{i}_24.png" for i in range(1,13)},
 "abilities":{a:f"icons/ability_{a}_24.png" for a in ["focus_fire","emergency_repair","ew_jam","torpedo_fan","shield_barrier","interceptors","tactical_retreat","reserve","boarding","reactor_overload","veteran","logist","shieldsmith","sniper","fortitude","tactician"]}}
with open(os.path.join(ROOT,"manifest.json"),"w",encoding="utf-8") as f: json.dump(manifest,f,ensure_ascii=False,indent=2)
print("units",len(units["player"])*2*len(TIERS),"icons",len(icons))
