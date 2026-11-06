import fs from "node:fs";
const p=JSON.parse(fs.readFileSync("E:/ComfyUI_windows_portable/ComfyUI/user/default/workflows/qwen_image_2_1_Q8_0_t2i.json","utf8"));
for(const n of p.nodes) console.log(n.id, n.type, JSON.stringify(n.widgets_values), n.title||"");
