#!/usr/bin/env node
/**
 * Legacy-маркеры удалённых кампанийных сцен + положительные маркеры Gemini-версий.
 * Проверяет source-data, dist и собранные бандлы (gift/site).
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/legacy-check.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const REMOVED = [
  "dlg.camp.act2c.", "dlg.camp.act3t.", "dlg.camp.act4l.", "dlg.camp.act4b.", "dlg.camp.fin.",
  "dlg.camp.act2.", "dlg.camp.branch.", "dlg.camp.finale.",
  "Кризис прошёл. Теперь надо решить",
  "Архив Строителей расшифрован на 61%",
  "Наследие Строителей на столе",
  "Я нашла подпись. Ваша советница подписывала приказы",
  "Разлом стабилен 97%",
  "Война закончилась. Начинается то, что от неё осталось",
  "Совет на мостике. Кейн смотрит на карту",
  "Три двери. За каждой — свой способ закончить войну",
  "Финал. Кейн стоит у иллюминатора",
];
const POSITIVE = [
  "dlg_campaign_act0_relic", "dlg_campaign_act1_hegemon",
  "dlg_campaign_ancient_archive", "dlg_campaign_ancient_contact", "dlg.camp.anc_a.", "dlg.camp.anc_c.",
  "dlg_campaign_act2_council", "dlg_campaign_act3_truth", "dlg_campaign_act4_legacy",
  "dlg_campaign_act4_betrayal", "dlg_campaign_final_door", "dlg_campaign_epilogue",
  "dlg.camp.act0_r.", "dlg.camp.act1_h.", "dlg.camp.act2_c.out.centralize",
  "dlg.camp.act2_c.n01", "dlg.camp.act3_t.n01", "dlg.camp.fin_d.n01",
  "Сорок два борта потеряно на рубеже", "Данные с глубин Разлома расшифрованы", "Флагман вошёл в область абсолютного резонанса",
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== ".git") walk(full, out); }
    else if (/\.(js|mjs|html|json|css|txt|md)$/i.test(entry.name) && fs.statSync(full).size < 12_000_000) out.push(full);
  }
  return out;
}

const targets = [
  ...walk(path.join(ROOT, "packages/data/src")),
  ...walk(path.join(ROOT, "apps/web/dist")),
  path.join(ROOT, "gift/StellarFrontier.html"),
  ...walk(path.join(ROOT, "site")),
].filter((f) => fs.existsSync(f));

let removedHits = 0;
let positiveHits = 0;
for (const file of targets) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  for (const token of REMOVED) {
    if (text.includes(token)) { console.log("FAIL · legacy в " + rel + ": " + token); removedHits++; }
  }
  for (const token of POSITIVE) if (text.includes(token)) positiveHits++;
}
if (removedHits === 0) console.log("PASS · legacy-маркеры отсутствуют в source/dist/gift/site");
else console.log("FAIL · legacy-маркеры найдены: " + removedHits);
if (positiveHits > 0) console.log("PASS · новые Gemini-маркеры/сцены присутствуют (совпадений: " + positiveHits + ")");
else console.log("FAIL · новые Gemini-маркеры не найдены (пересобери бандлы)");
console.log("ИТОГ: targets=" + targets.length + " legacyHits=" + removedHits + " positiveHits=" + positiveHits);
if (removedHits > 0) process.exitCode = 1;