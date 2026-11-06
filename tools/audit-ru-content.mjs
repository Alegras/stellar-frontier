import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOT = "packages/data/src";
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".json") && !p.includes("l10n")) files.push(p);
  }
}
walk(ROOT);
const CYR = /[\u0400-\u04FF]/;
const RU_FIELD = /(^ru$|^descRu$|^titleRu$|^textRu$|^briefingRu$|^labelRu$|^summaryRu$|^displayRu$|^nameRu$)/;
const ALLOWED = new Set(["FP","FSD","Mk","Mk1","CR","L1","L2","L3","GDD","ID","AI","UI","MMO","SP","FPS","DPS","POI","HP","XP","II","III","IV","V","VI","VII","VIII","IX","X","США"]);
const issues = [];
const latinOnly = [];
const mixed = [];
function scan(value, path, key) {
  if (typeof value === "string") {
    if (RU_FIELD.test(key)) {
      if (!value.trim()) issues.push({ path, key, issue: "empty" });
      else if (!CYR.test(value)) latinOnly.push({ path, key, value: value.slice(0, 120) });
      else {
        const words = value.match(/[A-Za-z]{4,}/g) ?? [];
        const bad = words.filter((w) => !ALLOWED.has(w) && !/^[A-Z]{2,5}$/.test(w));
        if (bad.length) mixed.push({ path, key, words: [...new Set(bad)].slice(0, 8), value: value.slice(0, 120) });
      }
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => scan(v, path + "[" + i + "]", key)); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) scan(v, path + "." + k, k);
}
for (const f of files) scan(JSON.parse(readFileSync(f, "utf8")), f.replace(ROOT + "/", ""), "");
console.log(JSON.stringify({ files: files.length, empty: issues.length, latinOnly: latinOnly.length, mixed: mixed.length, sampleLatin: latinOnly.slice(0, 10), sampleMixed: mixed.slice(0, 15) }, null, 1));
