import * as fs from "node:fs";
const script = JSON.parse(fs.readFileSync("packages/data/src/campaign/story-script.json", "utf8"));
const scenes = script.acts.flatMap((a) => a.scenes ?? []);
console.log("scene keys union:", [...new Set(scenes.flatMap((s) => Object.keys(s)))].join(","));
const kinds = {};
for (const s of scenes) kinds[s.kind ?? "?"] = (kinds[s.kind ?? "?"] ?? 0) + 1;
console.log("kinds:", JSON.stringify(kinds));
let forks = 0, variants = 0;
for (const s of scenes) { forks += (s.forks ?? []).length; variants += (s.variants ?? []).length; for (const f of s.forks ?? []) variants += (f.variants ?? f.options ?? []).length; }
console.log("forks/variants:", forks, variants);
console.log("sample scene keys:", JSON.stringify(scenes[0]).slice(0, 900));
console.log("bridge sample:", JSON.stringify(scenes.find((s) => s.kind === "bridge") ?? {}).slice(0, 900));
