import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = "packages/data/src";
const OUT = "packages/data/src/l10n/content-en.auto.json";
const OVERRIDES = "packages/data/src/l10n/content-en.overrides.json";
const CACHE = "tools/.translate-cache.json";
const ENDPOINT = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t&q=";
const CYR = /[\u0400-\u04FF]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".json") && !p.includes("l10n")) out.push(p);
  }
  return out;
}
import { statSync } from "node:fs";

let files;
try { files = walk(ROOT); } catch (e) { console.error("walk failed", e); process.exit(1); }
const sources = new Set();
function collect(value, key) {
  if (typeof value === "string") {
    if (key === "icon" || key === "color") return;
    if (CYR.test(value)) {
      for (const line of value.split("\n")) {
        const t = line.trim();
        if (t && CYR.test(t)) sources.add(t);
      }
    }
    return;
  }
  if (Array.isArray(value)) { for (const v of value) collect(v, key); return; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collect(v, k);
  }
}
for (const f of files) collect(JSON.parse(readFileSync(f, "utf8")), "");

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
const todo = [...sources].filter((s) => !cache[s] && !overrides[s]);
console.log("files", files.length, "unique lines", sources.size, "cached", sources.size - todo.length, "to translate", todo.length);

let done = 0, failed = 0;
async function translate(text) {
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(ENDPOINT + encodeURIComponent(text), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const parts = Array.isArray(data?.[0]) ? data[0].map((x) => (Array.isArray(x) ? x[0] : "")).filter(Boolean) : [];
      const out = parts.join("").trim();
      if (!out) throw new Error("empty translation");
      return out;
    } catch (e) {
      if (attempt === 6) throw e;
      const wait = String(e.message).includes("429") ? 30000 * (attempt + 1) : 1500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const queue = [...todo];
const CONCURRENCY = 1;
async function worker() {
  while (queue.length) {
    const src = queue.shift();
    if (!src) return;
    try {
      cache[src] = await translate(src);
      await new Promise((r) => setTimeout(r, 1200));
      done++;
    } catch (e) {
      failed++;
      console.error("FAIL translate:", src.slice(0, 60), String(e.message).slice(0, 120));
    }
    if ((done + failed) % 10 === 0) {
      console.log("progress", done + failed, "/", todo.length, "failed", failed);
      writeFileSync(CACHE, JSON.stringify(cache, null, 0));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
writeFileSync(CACHE, JSON.stringify(cache, null, 0));

// финальная карта: автоперевод + ручные переопределения (приоритет overrides)
const map = {};
for (const src of sources) {
  const value = overrides[src] ?? cache[src];
  if (value && value !== src) map[src] = value.replace(/ - /g, " — ").replace(/’/g, "'");
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "ru"))), null, 1));
const missing = [...sources].filter((s) => !map[s]);
console.log(JSON.stringify({ sources: sources.size, translated: Object.keys(map).length, missing: missing.length, failed, sampleMissing: missing.slice(0, 10), sample: Object.entries(map).slice(0, 3) }, null, 1));