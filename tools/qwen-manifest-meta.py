import json
p=r"N:\\AI\\stellar-frontier\\\apps\web\public\battle\manifest.json"
m=json.load(open(p,encoding="utf-8"))
m["generated"]="qwen-image-2.1-local + pillow pixel postprocess"
m["provenance"]={"model":"qwen-image-2.1-UC-fp8","workflow":"local ComfyUI/Qwen Chat","postprocess":"remove black bg, nearest tiers, 4-frame sheet","source":"docs/art/qwen-sprites","license":"local project asset"}
json.dump(m,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("manifest provenance")
