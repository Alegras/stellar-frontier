import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOT = "packages/data/src";
const OUT = "packages/data/src/l10n/content-en.auto.json";
const OVERRIDES = "packages/data/src/l10n/content-en.overrides.json";
const CACHE = "tools/.translate-cache.json";
const CYR = /[\u0400-\u04FF]/;
const files = [];
(function walk(dir) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".json") && !p.includes("l10n")) files.push(p); } })(ROOT);
const sources = new Set();
function collect(v, key) {
  if (typeof v === "string") {
    if (key === "icon" || key === "color") return;
    if (CYR.test(v)) for (const line of v.split("\n")) { const t = line.trim(); if (t && CYR.test(t)) sources.add(t); }
    return;
  }
  if (Array.isArray(v)) { for (const x of v) collect(x, key); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) collect(x, k);
}
for (const f of files) collect(JSON.parse(readFileSync(f, "utf8")), "");
const cache = JSON.parse(readFileSync(CACHE, "utf8"));
const overrides = JSON.parse(readFileSync(OVERRIDES, "utf8"));
const map = {};
const missing = [];
for (const src of sources) {
  const value = overrides[src] ?? cache[src];
  if (value && value !== src) map[src] = value.replace(/ - /g, " — ").replace(/’/g, "'");
  else missing.push(src);
}
writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "ru"))), null, 1));
console.log(JSON.stringify({ sources: sources.size, mapped: Object.keys(map).length, missing: missing.length, sampleMissing: missing.slice(0, 8) }, null, 1));
