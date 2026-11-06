import * as fs from "node:fs";
const script = JSON.parse(fs.readFileSync("packages/data/src/campaign/story-script.json", "utf8"));
console.log("act keys:", script.acts.map((a) => Object.keys(a).join("|")).slice(0, 6));
console.log("act0 sample:", JSON.stringify(script.acts[0]).slice(0, 1200));
let scenes = 0, forks = 0, variants = 0;
for (const a of script.acts) {
  scenes += (a.scenes ?? []).length; forks += (a.forks ?? []).length; variants += (a.variants ?? []).length;
}
console.log("nested sums scenes/forks/variants:", scenes, forks, variants);
console.log("top keys:", Object.keys(script).join(","));
