import { readFileSync } from "node:fs";
const ru = JSON.parse(readFileSync("packages/data/src/l10n/ru.json", "utf8"));
const en = JSON.parse(readFileSync("packages/data/src/l10n/en.json", "utf8"));
const CYR = /[\u0400-\u04FF]/;
const bad = [];
for (const [k, v] of Object.entries(ru)) {
  if (typeof v !== "string") continue;
  if (!v.trim()) bad.push({ k, issue: "empty", v });
  else if (!CYR.test(v) && /[A-Za-z]{3,}/.test(v)) bad.push({ k, issue: "latin", v: v.slice(0, 80) });
}
const missingEn = Object.keys(ru).filter((k) => !(k in en));
const missingRu = Object.keys(en).filter((k) => !(k in ru));
console.log(JSON.stringify({ ruKeys: Object.keys(ru).length, enKeys: Object.keys(en).length, bad: bad.length, sampleBad: bad.slice(0, 30), missingEn: missingEn.length, missingRu: missingRu.length }, null, 1));
