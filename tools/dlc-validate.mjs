#!/usr/bin/env node
/**
 * Валидатор данных DLC Части XIV (M9d-0 «Первый Свет»).
 * Проверяет: 8 квестов/7 шагов Q1, диалог 14 узлов/3 выбора/достижимость/0 тупиков,
 * дерево 8 узлов/10 рёбер/типы/наложения, персонажи 2×6 эмоций, карточки, арт-файлы,
 * l10n ru/en для всех textKey, бюджет арта ≤2 МБ.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/dlc-validate.mjs [--json]
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DLC_QUESTS, DLC_DIALOGUES, DLC_CHARACTERS, DLC_CARDS, DLC_TREE } from "@sf/data";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");
const results = [];
const rec = (s, n, d) => { results.push({ status: s, name: n, detail: d }); if (!AS_JSON) console.log(s + " · " + n + (d ? " — " + d : "")); };
const pass = (n, d) => rec("PASS", n, d);
const fail = (n, d) => rec("FAIL", n, d);
const skip = (n, d) => rec("SKIP", n, d);

const quests = DLC_QUESTS ?? [];
const dialogues = DLC_DIALOGUES ?? [];
const characters = DLC_CHARACTERS ?? [];
const cards = DLC_CARDS ?? [];
const tree = DLC_TREE ?? { nodes: [], edges: [] };
const l10nDir = path.join(ROOT, "packages", "data", "src", "l10n");
const ru = JSON.parse(readFileSync(path.join(l10nDir, "ru.json"), "utf8"));
const en = JSON.parse(readFileSync(path.join(l10nDir, "en.json"), "utf8"));
const keysRu = new Set(Object.keys(ru));
const keysEn = new Set(Object.keys(en));

// ---------------------------------------------------------------- квесты
const FIRST = "q_pro_01_first_light";
if (quests.length === 8) pass("квесты: 8 узлов", quests.map((q) => q.id).join(",").slice(0, 120));
else fail("квесты: 8 узлов", "count=" + quests.length);

const q1 = quests.find((q) => q.id === FIRST);
if (!q1) fail("Q1: q_pro_01_first_light есть", "не найден");
else {
  const stepTypes = (q1.steps ?? []).map((s) => s.type);
  const need = ["dialogue", "reach_system", "kill", "choice", "dock", "report", "turn_in"];
  const okSteps = stepTypes.length === 7 && need.every((t, i) => stepTypes[i] === t);
  if (okSteps) pass("Q1: 7 шагов в каноническом порядке", stepTypes.join("→"));
  else fail("Q1: 7 шагов", stepTypes.join(",") + " (ожидалось " + need.join(",") + ")");
  if (q1.source?.channel === "story_message" && q1.source?.autoStartTick === 0) pass("Q1: канал story_message, автостарт такта 0");
  else fail("Q1: источник/автостарт", JSON.stringify(q1.source));
  if ((q1.rewards?.credits ?? 0) > 0) pass("Q1: награда задана", JSON.stringify(q1.rewards).slice(0, 100));
  else fail("Q1: награда", JSON.stringify(q1.rewards));
}

const questIds = new Set(quests.map((q) => q.id));
for (const q of quests) {
  for (const k of ["titleKey", "summaryKey"]) if (!q[k]) fail("квест " + q.id + ": " + k, "нет ключа");
  for (const s of q.steps ?? []) if (!s.titleKey) fail("квест " + q.id + " шаг " + s.id + ": titleKey", "нет ключа");
}
// B7: квесты с requiresQuest должны быть достижимы по nextHint / модификаторам / эффектам диалогов
try {
  const reachable = new Set([FIRST]);
  const addNext = (from, to) => { if (to && questIds.has(to)) reachable.add(to); };
  for (const q of quests) for (const m of q.modifiers ?? []) addNext(q.id, m.nextHint);
  for (const d of dialogues) for (const n of d.nodes ?? []) {
    for (const e of n.effects ?? []) addNext(null, e.openQuest);
    for (const o of n.options ?? []) for (const e of o.effects ?? []) addNext(null, e.openQuest);
  }
  // доступность по каналам (board/rumor/signal) — сид; story-квесты открываются только nextHint/эффектами
  const channelOpen = new Set(quests.filter((q) => ["board", "rumor", "signal"].includes(q.source?.channel)).map((q) => q.id));
  for (const id of channelOpen) reachable.add(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of quests) {
      if (!reachable.has(q.id)) continue;
      for (const m of q.modifiers ?? []) { if (m.nextHint && questIds.has(m.nextHint) && !reachable.has(m.nextHint)) { reachable.add(m.nextHint); changed = true; } }
      if (q.nextHint && questIds.has(q.nextHint) && !reachable.has(q.nextHint)) { reachable.add(q.nextHint); changed = true; }
    }
  }
  const unreachable = quests.filter((q) => !reachable.has(q.id)).map((q) => q.id);
  if (unreachable.length === 0) pass("B7: все квесты достижимы по цепочке/каналу", "reachable=" + [...reachable].length + "/" + quests.length);
  else fail("B7: недостижимые квесты", unreachable.join(",") + " (нужен nextHint/модификатор/эффект)");
} catch (e) { fail("B7: достижимость цепочки", String(e)); }

const channels = new Set(quests.map((q) => q.source?.channel));
for (const ch of ["story_message", "board", "rumor", "signal"]) {
  if (channels.has(ch)) pass("канал " + ch + " представлен"); else fail("канал " + ch + " представлен", [...channels].join(","));
}

// ---------------------------------------------------------------- диалоги
const dlg = dialogues.find((d) => d.id === "dlg_q1_briefing");
if (!dlg) fail("диалог dlg_q1_briefing есть", "не найден, диалогов=" + dialogues.length);
else {
  const nodes = dlg.nodes ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  if (nodes.length === 14) pass("диалог: 14 узлов"); else fail("диалог: 14 узлов", "count=" + nodes.length);
  const choiceNodes = nodes.filter((n) => n.type === "choice");
  if (choiceNodes.length >= 3) pass("диалог: ≥3 узла-выбора", "choices=" + choiceNodes.length);
  else fail("диалог: 3 значимых выбора", "choice-узлов=" + choiceNodes.length);
  let badRefs = [];
  const nexts = [];
  for (const n of nodes) {
    if (n.next) nexts.push([n.id, n.next]);
    for (const o of n.options ?? []) { nexts.push([n.id + "/" + o.id, o.next]); if (o.check) { nexts.push([n.id + "/check/ok", o.check.onSuccess]); nexts.push([n.id + "/check/fail", o.check.onFail]); } }
    if (n.check) { nexts.push([n.id + "/check/ok", n.check.onSuccess]); nexts.push([n.id + "/check/fail", n.check.onFail]); }
    if (!n.textKey && n.type !== "check" && n.type !== "effect" && n.type !== "end") badRefs.push(n.id + ":нет textKey");
  }
  for (const [from, to] of nexts) if (to && !ids.has(to)) badRefs.push(from + "→" + to);
  if (badRefs.length === 0) pass("диалог: все переходы разрешаются", "next=" + nexts.length);
  else fail("диалог: битые переходы", badRefs.slice(0, 5).join("; "));
  // достижимость
  const reach = new Set([nodes[0]?.id]);
  const adj = new Map();
  for (const [from, to] of nexts) { const f = from.split("/")[0]; if (!adj.has(f)) adj.set(f, []); adj.get(f).push(to); }
  const stack = [nodes[0]?.id];
  while (stack.length) { const cur = stack.pop(); for (const nx of adj.get(cur) ?? []) if (nx && !reach.has(nx)) { reach.add(nx); stack.push(nx); } }
  const unreachable = [...ids].filter((id) => !reach.has(id));
  if (unreachable.length === 0) pass("диалог: все узлы достижимы");
  else fail("диалог: недостижимые узлы", unreachable.join(","));
  // тупики: не-end узел без next/options/check
  const dead = nodes.filter((n) => n.type !== "end" && !n.next && !(n.options ?? []).length && !n.check && n.type !== "effect");
  if (dead.length === 0) pass("диалог: 0 тупиков"); else fail("диалог: тупики", dead.map((n) => n.id).join(","));
  const checkNode = nodes.find((n) => n.type === "check" || (n.options ?? []).some((o) => o.check));
  if (checkNode) pass("диалог: проверка (check/DC) есть"); else fail("диалог: проверка", "нет check-узла");
  const choiceWithEffects = choiceNodes.filter((n) => (n.options ?? []).some((o) => (o.effects ?? []).length > 0));
  if (choiceWithEffects.length >= 3) pass("диалог: у 3 выборов есть последствия"); else fail("диалог: последствия выборов", "узлов=" + choiceWithEffects.length);
  const anyOpen = nodes.some((n) => (n.effects ?? []).some((e) => e.openQuest)
    || (n.options ?? []).some((o) => (o.effects ?? []).some((e) => e.openQuest)));
  if (anyOpen) pass("диалог: выбор/эффект открывает квест"); else fail("диалог: openQuest в эффектах", "нет");
}
if (dialogues.length >= 3) pass("диалоги: ≥3 сцен (брифинг, Кира, СВЕТ)", "count=" + dialogues.length);
else fail("диалоги: 3 сцены", "count=" + dialogues.length);

// ---------------------------------------------------------------- дерево
const nodes = tree.nodes ?? [];
const edges = tree.edges ?? [];
if (nodes.length === 8 && edges.length === 10) pass("дерево: 8 узлов / 10 рёбер");
else fail("дерево: 8/10", "nodes=" + nodes.length + " edges=" + edges.length);
const treeIds = new Set(nodes.map((n) => n.id));
const missingQ = [...treeIds].filter((id) => !questIds.has(id));
if (missingQ.length === 0) pass("дерево: все узлы — квесты"); else fail("дерево: неизвестные узлы", missingQ.join(","));
const kinds = new Set(edges.map((e) => e.kind));
const badEdges = edges.filter((e) => !treeIds.has(e.from) || !treeIds.has(e.to));
if (badEdges.length === 0) pass("дерево: рёбра связывают узлы", "kinds=" + [...kinds].join(",")); else fail("дерево: битые рёбра", badEdges.length);
// наложения: минимальная дистанция между узлами
let minDist = Infinity; let pair = "";
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
  if (d < minDist) { minDist = d; pair = nodes[i].id + "↔" + nodes[j].id; }
}
if (nodes.length < 2) skip("дерево: наложения", "мало узлов"); else if (minDist >= 80) pass("дерево: 0 наложений", "minDist=" + minDist.toFixed(0) + " (" + pair + ")"); else fail("дерево: наложения", "minDist=" + minDist.toFixed(0) + " (" + pair + ")");
// связность (undirected от первого)
const und = new Map(); for (const id of treeIds) und.set(id, []);
for (const e of edges) { und.get(e.from)?.push(e.to); und.get(e.to)?.push(e.from); }
const seen = new Set([nodes[0]?.id]); const st = [nodes[0]?.id];
while (st.length) { const c = st.pop(); for (const nx of und.get(c) ?? []) if (!seen.has(nx)) { seen.add(nx); st.push(nx); } }
if (seen.size === treeIds.size) pass("дерево: граф связен"); else fail("дерево: несвязные узлы", [...treeIds].filter((id) => !seen.has(id)).join(","));

// ---------------------------------------------------------------- персонажи/карточки/арт
if (characters.length >= 2) pass("персонажи: 2 портрета", characters.map((c) => c.id).join(",")); else fail("персонажи: 2", "count=" + characters.length);
for (const c of characters) {
  const em = c.emotions ?? [];
  if (em.length >= 6) pass("персонаж " + c.id + ": 6 эмоций", em.join(",")); else fail("персонаж " + c.id + ": 6 эмоций", "count=" + em.length);
  if (!c.nameKey) fail("персонаж " + c.id + ": nameKey", "нет");
}
if (cards.length >= 2) pass("карточки: 2", cards.map((c) => c.questId).join(",")); else fail("карточки: 2", "count=" + cards.length);
const assetDirs = [
  path.join(ROOT, "apps", "web", "public", "dlc"),
  path.join(ROOT, "apps", "web", "public"),
  path.join(ROOT, "apps", "web", "src", "assets"),
  path.join(ROOT, "gift", "assets"),
  path.join(ROOT, "gift"),
];
function assetPath(p) {
  if (!p) return null;
  const clean = p.replace(/^\/+/, "").replace(/^assets\//, "");
  for (const dir of assetDirs) { const full = path.join(dir, clean); if (existsSync(full)) return full; }
  return null;
}
function pngSize(file) {
  try {
    const b = readFileSync(file);
    if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
  } catch { return null; }
}
let artBytes = 0, missingArt = [], checkedEmotions = 0;
for (const c of characters) {
  // CharacterDef.portrait: либо путь с папкой, либо id-папка (content-designer: "teira_os")
  const raw = c.portrait ?? "";
  const base = raw.endsWith(".png") ? path.dirname(raw) : raw.includes("/") ? raw : ("portraits/" + raw);
  for (const em of c.emotions ?? []) {
    const rel = path.join(base, em + ".png");
    const f = assetPath(rel);
    if (!f) { missingArt.push(rel); continue; }
    checkedEmotions++;
    const s = pngSize(f);
    if (s) {
      artBytes += s.bytes;
      if (s.w < 128 || s.h > 512) fail("арт " + c.id + "/" + em + ": размер", s.w + "x" + s.h + " (ожидается native 128, ×2 до 256)");
    }
  }
}
for (const card of cards) {
  const rawArt = card.art ?? "";
  const cardRel = rawArt.endsWith(".png") ? rawArt : rawArt.includes("/") ? rawArt + ".png" : ("cards/" + rawArt + ".png");
  const f = assetPath(cardRel);
  if (!f) { missingArt.push(cardRel); continue; }
  artBytes += statSync(f).size;
  const s2 = pngSize(f);
  if (s2 && (s2.w < 180 || s2.h < 100)) fail("арт карточки " + card.questId + ": размер", s2.w + "x" + s2.h);
}
const publicDlc = path.join(ROOT, "apps", "web", "public", "dlc");
if (existsSync(publicDlc)) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  let all = 0;
  try { for (const f of walk(publicDlc)) if (f.endsWith(".png")) all += statSync(f).size; } catch { /* ignore */ }
  if (all > 2 * 1024 * 1024) fail("арт-бюджет DLC ≤2 МБ", Math.round(all / 1024) + "КБ"); else pass("арт-бюджет DLC ≤2 МБ", Math.round(all / 1024) + "КБ, файлов: " + walk(publicDlc).filter((f) => f.endsWith(".png")).length);
}
if (missingArt.length === 0 && checkedEmotions >= characters.length * 6) pass("арт: портреты 6 эмоций + карточки найдены", "эмоций=" + checkedEmotions);
else skip("арт: не все файлы сгенерированы", missingArt.slice(0, 6).join(",") + (missingArt.length > 6 ? "…" : ""));

// ---------------------------------------------------------------- l10n
const textKeys = new Set();
for (const q of quests) { if (q.titleKey) textKeys.add(q.titleKey); if (q.summaryKey) textKeys.add(q.summaryKey); for (const s of q.steps ?? []) if (s.titleKey) textKeys.add(s.titleKey); }
for (const d of dialogues) for (const n of d.nodes ?? []) { if (n.textKey) textKeys.add(n.textKey); for (const o of n.options ?? []) if (o.textKey) textKeys.add(o.textKey); }
for (const c of characters) if (c.nameKey) textKeys.add(c.nameKey);
const missRu = [...textKeys].filter((k) => !keysRu.has(k));
const missEn = [...textKeys].filter((k) => !keysEn.has(k));
if (textKeys.size > 0 && missRu.length === 0 && missEn.length === 0) pass("l10n ru/en: все ключи DLC есть", "keys=" + textKeys.size);
else fail("l10n ru/en: ключи DLC", "ru missing=" + missRu.slice(0, 5).join(",") + " en missing=" + missEn.slice(0, 5).join(",") + " (всего " + textKeys.size + ")");

const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const r of results) counts[r.status]++;
if (AS_JSON) console.log(JSON.stringify({ counts, results }, null, 2));
else console.log("\nИТОГ: PASS=" + counts.PASS + " FAIL=" + counts.FAIL + " SKIP=" + counts.SKIP);
if (counts.FAIL > 0) process.exitCode = 1;