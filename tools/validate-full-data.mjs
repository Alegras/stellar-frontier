#!/usr/bin/env node
/**
 * Валидация данных полной игры (M6–M12): packages/data/src/full/*.json и campaign/*.json.
 * Проверяет уникальность id, ссылочную целостность, обязательные количества,
 * миссии по актам/развилкам, цепочки событий, артефакты и паритет ru↔en в l10n.
 * Запуск: node tools/validate-full-data.mjs   (из корня репозитория)
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const D = join(ROOT, "packages", "data", "src");

const errors = [];
const warns = [];
const ok = (msg) => console.log("ok  " + msg);
const fail = (msg) => { errors.push(msg); console.log("FAIL " + msg); };
const warn = (msg) => { warns.push(msg); console.log("warn " + msg); };

function load(rel) {
  const p = join(D, rel);
  if (!existsSync(p)) { fail("нет файла " + rel); return null; }
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { fail("невалидный JSON " + rel + ": " + e.message); return null; }
}

// ---------- загрузка ----------
const F = {
  traditions: load("full/traditions.json"),
  perks: load("full/perks.json"),
  techsExtra: load("full/techs-extra.json"),
  megastructures: load("full/megastructures.json"),
  crises: load("full/crises.json"),
  resolutions: load("full/resolutions.json"),
  espionage: load("full/espionage.json"),
  modes: load("full/modes.json"),
  ethics: load("full/ethics.json"),
  governments: load("full/governments.json"),
  civics: load("full/civics.json"),
  focus: load("full/focus-goals.json"),
  acts: load("campaign/acts.json"),
  missions: load("campaign/missions.json"),
  events: load("campaign/events.json"),
  anomalies: load("campaign/anomalies.json"),
  archaeology: load("campaign/archaeology.json"),
  lore: load("campaign/lore.json"),
  endings: load("campaign/endings.json"),
  branches: load("campaign/branches.json"),
  techs: load("techs.json"),
  hulls: load("hulls.json"),
  weapons: load("weapons.json"),
  modules: load("modules.json"),
  buildings: load("buildings.json"),
  ru: load("l10n/ru.json"),
  en: load("l10n/en.json"),
};
if (errors.length) { console.log("\nBLOCKED: базовые файлы не загрузились"); process.exit(1); }

const idsOf = (arr, key = "id") => new Set(arr.map((x) => x[key]));
const hullIds = idsOf(F.hulls), weaponIds = idsOf(F.weapons), moduleIds = idsOf(F.modules),
  buildingIds = idsOf(F.buildings), techIds = new Set([...idsOf(F.techs), ...idsOf(F.techsExtra)]),
  perkIds = idsOf(F.perks), megaIds = idsOf(F.megastructures), branchIds = idsOf(F.branches),
  endingIds = idsOf(F.endings), missionIds = idsOf(F.missions), archIds = idsOf(F.archaeology, "chainId");
const contentRef = (ref) => {
  const [kind, id] = String(ref).split(":");
  if (kind === "hull") return hullIds.has(id);
  if (kind === "weapon") return weaponIds.has(id);
  if (kind === "module") return moduleIds.has(id);
  if (kind === "building") return buildingIds.has(id);
  if (kind === "megastructure") return megaIds.has(id);
  if (kind === "tech") return techIds.has(id);
  return false;
};
const dupCheck = (name, arr, key = "id") => {
  const seen = new Set();
  for (const x of arr) {
    const v = x[key];
    if (v === undefined || v === null || v === "") { fail(name + ": пустой " + key + " у элемента " + JSON.stringify(x).slice(0, 60)); continue; }
    if (seen.has(v)) fail(name + ": дубликат " + key + "=" + v);
    seen.add(v);
  }
  return seen;
};

// ---------- уникальность id ----------
dupCheck("traditions.trees", F.traditions);
const allNodes = F.traditions.flatMap((t) => t.nodes);
dupCheck("traditions.nodes", allNodes);
dupCheck("perks", F.perks);
dupCheck("techs-extra", F.techsExtra);
dupCheck("megastructures", F.megastructures);
dupCheck("crises", F.crises);
dupCheck("resolutions", F.resolutions);
dupCheck("espionage", F.espionage);
dupCheck("modes", F.modes, "modeId");
dupCheck("ethics", F.ethics);
dupCheck("governments", F.governments);
dupCheck("civics", F.civics);
dupCheck("focus-goals", F.focus);
dupCheck("acts", F.acts);
dupCheck("missions", F.missions);
dupCheck("events", F.events);
dupCheck("anomalies", F.anomalies);
dupCheck("archaeology", F.archaeology, "chainId");
dupCheck("lore", F.lore);
dupCheck("endings", F.endings);
dupCheck("branches", F.branches);
for (const t of F.techsExtra) if (idsOf(F.techs).has(t.id)) fail("techs-extra пересекается с techs: " + t.id);

// ---------- традиции ----------
if (F.traditions.length !== 7) fail("traditions: ожидалось 7 древ, есть " + F.traditions.length);
const nodeIds = idsOf(allNodes);
for (const tree of F.traditions) {
  if (tree.nodes.length !== 5) fail("traditions " + tree.id + ": узлов " + tree.nodes.length + " (нужно 5)");
  for (const [i, n] of tree.nodes.entries()) {
    if (n.treeId !== tree.id) fail("traditions " + n.id + ": treeId != " + tree.id);
    if (n.index !== i) fail("traditions " + n.id + ": index=" + n.index + " ожидался " + i);
    const wantCost = Math.round(400 * Math.pow(1.5, i));
    if (n.cost !== wantCost) fail("traditions " + n.id + ": cost=" + n.cost + " != формула " + wantCost);
    const wantReq = i === 0 ? [] : [tree.nodes[i - 1].id];
    if (JSON.stringify(n.requires) !== JSON.stringify(wantReq)) fail("traditions " + n.id + ": requires не соответствуют цепочке");
    for (const r of n.requires) if (!nodeIds.has(r)) fail("traditions " + n.id + ": unknown requires " + r);
    if (!n.effects || Object.keys(n.effects).length === 0) fail("traditions " + n.id + ": пустые effects");
  }
  if (!tree.finisher || !tree.finisher.id || !tree.finisher.effects) fail("traditions " + tree.id + ": нет финишера");
  else if (nodeIds.has(tree.finisher.id)) fail("traditions " + tree.id + ": финишер конфликтует с id узла");
}

// ---------- перки / мегаструктуры / технологии-дополнения ----------
for (const p of F.perks) {
  for (const r of p.requires ?? []) if (!perkIds.has(r)) fail("perk " + p.id + ": requires " + r + " не существует");
  for (const u of p.unlocks ?? []) if (!contentRef(u)) fail("perk " + p.id + ": unlock " + u + " не существует");
  if (!(p.cost > 0)) fail("perk " + p.id + ": cost");
}
for (const m of F.megastructures) {
  if (m.requiredTech && !techIds.has(m.requiredTech)) fail("megastructure " + m.id + ": requiredTech " + m.requiredTech);
  if (m.requiredPerk && !perkIds.has(m.requiredPerk)) fail("megastructure " + m.id + ": requiredPerk " + m.requiredPerk);
  if (!(m.costAlloys > 0) || !(m.buildTicks > 0)) fail("megastructure " + m.id + ": cost/ticks");
  if (!(m.maxPerEmpire >= 1)) fail("megastructure " + m.id + ": maxPerEmpire");
}
for (const t of F.techsExtra) {
  for (const r of t.requires ?? []) if (!techIds.has(r)) fail("techs-extra " + t.id + ": requires " + r);
  for (const u of t.unlocks ?? []) if (!contentRef(u)) fail("techs-extra " + t.id + ": unlock " + u);
  if (!(t.cost > 0)) fail("techs-extra " + t.id + ": cost");
  if (!["physics", "society", "engineering"].includes(t.school)) fail("techs-extra " + t.id + ": school");
  if (!(t.tier >= 0 && t.tier <= 5)) fail("techs-extra " + t.id + ": tier");
}
for (const c of F.crises) {
  if (c.rewards?.unlock && !contentRef(c.rewards.unlock)) fail("crisis " + c.id + ": unlock " + c.rewards.unlock);
  for (const k of ["startTick", "fleets", "fleetFp", "nodes", "durationTicks"]) if (!(c[k] > 0)) fail("crisis " + c.id + ": " + k);
}
for (const e of F.espionage) if (e.requiresTech && !techIds.has(e.requiresTech)) fail("espionage " + e.id + ": requiresTech " + e.requiresTech);
for (const m of F.modes) {
  if (!["free", "vote", "none"].includes(m.pausePolicy)) fail("mode " + m.modeId + ": pausePolicy");
  if (!["local", "server"].includes(m.saves)) fail("mode " + m.modeId + ": saves");
}
const axes = {};
for (const e of F.ethics) axes[e.axis] = (axes[e.axis] ?? 0) + 1;
if (Object.keys(axes).length !== 4) fail("ethics: осей " + Object.keys(axes).length + " (нужно 4)");
for (const [a, n] of Object.entries(axes)) if (n !== 2) fail("ethics: ось " + a + " имеет " + n + " этики");

// ---------- кампания: акты, миссии, ветки, концовки ----------
if (F.acts.length !== 6) fail("acts: ожидалось 6, есть " + F.acts.length);
const actIds = idsOf(F.acts);
for (let i = 1; i < F.acts.length; i++) if (F.acts[i].startTick < F.acts[i - 1].endTick) fail("acts: пересечение тактов у актов " + F.acts[i - 1].id + "/" + F.acts[i].id);
for (const m of F.missions) {
  if (!actIds.has(m.act)) fail("mission " + m.id + ": act " + m.act + " не существует");
  if (m.branch && !branchIds.has(m.branch)) fail("mission " + m.id + ": branch " + m.branch);
  if (m.branchRequired && !branchIds.has(m.branchRequired)) fail("mission " + m.id + ": branchRequired " + m.branchRequired);
  if (m.ending && !endingIds.has(m.ending)) fail("mission " + m.id + ": ending " + m.ending);
  for (const p of m.prerequisites ?? []) if (!missionIds.has(p)) fail("mission " + m.id + ": prerequisite " + p);
  if (!m.objectives || m.objectives.length === 0) fail("mission " + m.id + ": нет objectives");
  for (const o of m.objectives ?? []) if (!o.id || !o.type) fail("mission " + m.id + ": objective без id/type");
  if (!(m.rewards && (m.rewards.credits > 0))) fail("mission " + m.id + ": rewards.credits");
  if (m.rewards?.unlock && !contentRef(m.rewards.unlock)) fail("mission " + m.id + ": unlock " + m.rewards.unlock);
  if (!(m.weight > 0)) fail("mission " + m.id + ": weight");
}
const byAct = {};
for (const m of F.missions) byAct[m.act] = (byAct[m.act] ?? 0) + 1;
for (const a of F.acts) {
  const n = byAct[a.id] ?? 0;
  if (n < 8) fail("missions: акт " + a.id + " — " + n + " миссий (нужно ≥8)");
  const branchesOfAct = new Set(F.missions.filter((m) => m.act === a.id && m.branch).map((m) => m.branch));
  if (branchesOfAct.size < 2) fail("missions: акт " + a.id + ": развилок " + branchesOfAct.size + " (нужно ≥2)");
}
for (const b of F.branches) {
  if (!b.missions?.length) fail("branch " + b.id + ": нет миссий");
  for (const mid of b.missions ?? []) {
    if (!missionIds.has(mid)) fail("branch " + b.id + ": mission " + mid);
    else { const m = F.missions.find((x) => x.id === mid); if (m.branch !== b.id) fail("branch " + b.id + ": миссия " + mid + " имеет branch " + m.branch); }
  }
  if (!endingIds.has(b.ending)) fail("branch " + b.id + ": ending " + b.ending);
}
for (const e of F.endings) if (e.branch && !branchIds.has(e.branch)) fail("ending " + e.id + ": branch " + e.branch);

// ---------- события ----------
const chains = new Map();
for (const ev of F.events) {
  if (!chains.has(ev.chainId)) chains.set(ev.chainId, []);
  chains.get(ev.chainId).push(ev);
  for (const c of ev.choices ?? []) {
    if (c.missionId && !missionIds.has(c.missionId)) fail("event " + ev.id + ": missionId " + c.missionId);
    if (!c.labelRu) fail("event " + ev.id + ": пустая подпись выбора");
    if (!Array.isArray(c.effects)) fail("event " + ev.id + ": effects не массив");
  }
  if (!(ev.weight > 0)) fail("event " + ev.id + ": weight");
}
if (chains.size < 40) fail("events: цепочек " + chains.size + " (нужно ≥40)");
for (const [id, evs] of chains) {
  es: {
    const steps = evs.map((e) => e.step).sort((a, b) => a - b);
    if (JSON.stringify(steps) !== JSON.stringify(steps.map((_, i) => i + 1))) fail("events chain " + id + ": шаги не 1..N (" + steps.join(",") + ")");
  }
}

// ---------- аномалии / археология ----------
const ARTIFACTS_MIN = 6;
for (const a of F.anomalies) {
  if (!["anomaly", "archaeology", "derelict", "silent_star"].includes(a.kind)) fail("anomaly " + a.id + ": kind " + a.kind);
  if (a.chainId && !archIds.has(a.chainId)) fail("anomaly " + a.id + ": chainId " + a.chainId);
  if (!(a.steps > 0)) fail("anomaly " + a.id + ": steps");
}
const artifacts = F.anomalies.filter((a) => a.artifact).length;
if (artifacts < ARTIFACTS_MIN) fail("anomalies: артефактных " + artifacts + " (нужно ≥" + ARTIFACTS_MIN + ")");
for (const ar of F.archaeology) {
  if (!(ar.steps > 0)) fail("archaeology " + ar.chainId + ": steps");
  if (ar.reward?.unlock && !contentRef(ar.reward.unlock)) fail("archaeology " + ar.chainId + ": unlock " + ar.reward.unlock);
}
for (const l of F.lore) if (!l.titleRu || !l.textRu || !l.category) fail("lore " + l.id + ": пустые поля");

// ---------- обязательные количества ----------
const COUNT = {
  missions: [F.missions.length, 60, "=="],
  events: [F.events.length, 120, "=="],
  anomalies: [F.anomalies.length, 60, "=="],
  lore: [F.lore.length, 150, "=="],
  archaeology: [F.archaeology.length, 6, "=="],
  endings: [F.endings.length, 8, "=="],
  branches: [F.branches.length, 3, "=="],
  acts: [F.acts.length, 6, "=="],
  "techs-extra": [F.techsExtra.length, 40, ">="],
  megastructures: [F.megastructures.length, 7, "=="],
  crises: [F.crises.length, 5, "=="],
  resolutions: [F.resolutions.length, 8, "=="],
  espionage: [F.espionage.length, 6, "=="],
  modes: [F.modes.length, 5, "=="],
  ethics: [F.ethics.length, 8, "=="],
  governments: [F.governments.length, 5, "=="],
  civics: [F.civics.length, 12, "=="],
  "focus-goals": [F.focus.length, 10, "=="],
  perks: [F.perks.length, 12, "=="],
  "tradition-nodes": [allNodes.length, 35, "=="],
};
for (const [name, [got, want, op]] of Object.entries(COUNT)) {
  const bad = op === "==" ? got !== want : got < want;
  if (bad) fail("count " + name + "=" + got + " (ожидалось " + op + " " + want + ")");
  else ok("count " + name + "=" + got);
}

// ---------- локализация ----------
const rk = Object.keys(F.ru), ek = Object.keys(F.en);
const l10nErrors = rk.filter((k) => !(k in F.en)).concat(ek.filter((k) => !(k in F.ru)));
if (l10nErrors.length) fail("l10n: ru/en паритет нарушен (" + l10nErrors.length + " ключей: " + l10nErrors.slice(0, 5).join(", ") + ")");
else ok("l10n ru↔en паритет: " + rk.length + " ключей");
if (rk.length < 1000) fail("l10n: ключей " + rk.length + " (нужно ≥1000)");
for (const ns of ["traditions", "perks", "diplomacy", "war", "federation", "council", "espionage", "megastructure", "crisis", "routes", "campaign", "events", "anomalies", "lore", "endings", "modes", "ethics", "governments", "civics", "focus", "score", "journal"]) {
  if (!rk.some((k) => k.startsWith(ns + "."))) fail("l10n: нет неймспейса " + ns + ".*");
}

// ---------- Часть XIII: Древние, расы, Реликтовый Предел ----------
const A = {
  races: load("ancients/races.json"),
  traits: load("ancients/traits.json"),
  techs: load("ancients/techs.json"),
  quests: load("ancients/quests.json"),
  codex: load("ancients/codex.json"),
  factions: load("ancients/factions.json"),
  pois: load("ancients/pois.json"),
  regions: load("ancients/regions.json"),
  hazards: load("ancients/hazards.json"),
  endings: load("ancients/endings.json"),
  names: load("ancients/names.json"),
};
if (Object.values(A).every((x) => x && !Array.isArray(x) && typeof x === "object")) { console.log("warn ancients: names.json читается как объект — ок"); }
const ancOk = A.races && A.traits && A.techs && A.quests && A.codex && A.factions && A.pois && A.regions && A.hazards && A.endings && A.names;
if (ancOk) {
  dupCheck("ancients.races", A.races);
  dupCheck("ancients.traits", A.traits);
  dupCheck("ancients.techs", A.techs);
  dupCheck("ancients.quests", A.quests);
  dupCheck("ancients.codex", A.codex);
  dupCheck("ancients.factions", A.factions);
  dupCheck("ancients.pois", A.pois);
  dupCheck("ancients.regions", A.regions);
  dupCheck("ancients.hazards", A.hazards);
  dupCheck("ancients.endings", A.endings);
  const traitIds = idsOf(A.traits), ancTechIds = idsOf(A.techs), ancQuestIds = idsOf(A.quests),
    ancCodexIds = idsOf(A.codex), ancFactionIds = idsOf(A.factions), ancHazardIds = idsOf(A.hazards);
  const ethicIds = idsOf(F.ethics), campaignEndingIds = idsOf(F.endings);
  const questByIndex = new Map(A.quests.map((q) => [q.index, q]));
  // количества
  const playable = A.races.filter((r) => r.playable).length;
  const npc = A.races.filter((r) => !r.playable).length;
  const COUNT_A = {
    "ancients.races": [A.races.length, 20, "=="],
    "ancients.races.playable": [playable, 8, "=="],
    "ancients.races.npc": [npc, 12, "=="],
    "ancients.traits": [A.traits.length, 44, "=="],
    "ancients.techs": [A.techs.length, 30, ">="],
    "ancients.quests": [A.quests.length, 12, "=="],
    "ancients.codex": [A.codex.length, 40, ">="],
    "ancients.codex.max": [A.codex.length, 44, "<="],
    "ancients.factions": [A.factions.length, 4, "=="],
    "ancients.pois": [A.pois.length, 40, ">="],
    "ancients.regions": [A.regions.length, 5, "=="],
    "ancients.endings": [A.endings.length, 3, "=="],
  };
  for (const [name, [got, want, op]] of Object.entries(COUNT_A)) {
    const bad = op === "==" ? got !== want : op === ">=" ? got < want : got > want;
    if (bad) fail("count " + name + "=" + got + " (ожидалось " + op + " " + want + ")");
    else ok("count " + name + "=" + got);
  }
  const tierHits = new Set(A.techs.map((t) => t.tier));
  for (let tier = 0; tier <= 5; tier++) if (!tierHits.has(tier)) fail("ancients.techs: нет тира A" + tier);
  // раса → трейты/этики/старт
  for (const race of A.races) {
    for (const tr of race.traits ?? []) if (!traitIds.has(tr)) fail("race " + race.id + ": неизвестный трейт " + tr);
    for (const e of [...(race.ethicsAffinity ?? []), ...(race.ethicsAnti ?? [])]) if (!ethicIds.has(e)) fail("race " + race.id + ": неизвестная этика " + e);
    if (!(race.xenophile >= 0 && race.xenophile <= 100)) fail("race " + race.id + ": xenophile вне 0..100");
    for (const f of ["ru", "descRu", "tag", "homeworldRu", "signatureRu", "signatureDescRu", "aiStyle", "portrait", "silhouette", "greetingRu"]) if (!race[f]) fail("race " + race.id + ": пустое поле " + f);
    for (const k of Object.keys(race.start ?? {})) if (!["relics", "cores", "minerals", "credits", "alloys", "colonizers", "goods"].includes(k)) fail("race " + race.id + ": старт-поле " + k);
  }
  // трейты: бюджет и эффекты
  const traitBudget = new Map();
  for (const race of A.races.filter((r) => r.playable)) {
    const sum = (race.traits ?? []).reduce((acc, id) => acc + (A.traits.find((t) => t.id === id)?.cost ?? 0), 0);
    traitBudget.set(race.id, sum);
    if (Math.abs(sum - 3) > 0.001) fail("race " + race.id + ": бюджет трейтов " + sum + " (нужно +3.0)");
    if ((race.traits ?? []).length !== 3) fail("race " + race.id + ": трейтов " + (race.traits ?? []).length + " (нужно 3)");
  }
  const MOD_KEYS = new Set(["energy_prod","minerals_prod","food_prod","alloys_prod","goods_prod","unity_prod","influence_prod","credits_prod","science_prod","physics_prod","society_prod","engineering_prod","stability","stability_pct","happiness","diplo_opinion","trade_margin","sensor_range","extra_tech_choice","fleet_cap","fleet_cap_pct","fleet_cap_per_10_systems","fleet_upkeep","ship_cost","build_speed","pop_growth","weapon_damage","shield","armor","war_score","invasion","claim_cost","outpost_cost","colony_cost","megastructure_cost","influence_flat","energy_flat","science_flat_per_school","flagship_autoescape","relic_yield","core_bonus","core_capacity","habitabilty","habitability","habitability_ocean","habitability_cold","habitability_hot","habitability_arctic","habitability_tropic","habitability_volcanic","habitability_other","salvage_yield","repair_speed","stockpile_flat","goods_upkeep_pct","building_upkeep_pct","piracy_loss","hull_hp_pct","small_ship_fp","boarding","armies_flat","fuel_use_pct","garrison_power","war_stability","treaty_cost","nap_cost","opinion_militarist","opinion_pacifist","assimilation","xenophile_happiness","orbital_prod","planet_prod","neutron_prod","relic_tech_effect","food_from_minerals","unity_flat","no_happiness","diplo_weight","trade_routes_flat","goods_flat","start_relics","all_prod","power","reactor_power","warp_range_ly","warp_accuracy","warp_charge_pct","warp_charge_ticks","core_recharge_cost","foresight_ticks","ansari_power","chorus_damage","ascension_progress","hull_regen","armor_regen","stealth_signature","phase_cloak_ticks","sensor_stealth_detect","anomaly_speed","habitability_desert","gate_pairs","structure_limit","federation_share","system_defense","choir_attention"]);
  for (const t of A.traits) {
    if (t.positive !== t.cost > 0) fail("trait " + t.id + ": positive не соответствует cost");
    if (!t.effects || Object.keys(t.effects).length === 0 || Object.keys(t.effects).length > 3) fail("trait " + t.id + ": эффектов " + (t.effects ? Object.keys(t.effects).length : 0) + " (1..3)");
    for (const k of Object.keys(t.effects)) if (!MOD_KEYS.has(k)) warn("trait " + t.id + ": незнакомый ключ эффекта " + k);
  }
  // технологии A0–A5
  for (const tech of A.techs) {
    if (!(tech.tier >= 0 && tech.tier <= 5)) fail("anc tech " + tech.id + ": tier");
    if (tech.gateMission < 0 || tech.gateMission > 12) fail("anc tech " + tech.id + ": gateMission");
    for (const r of tech.requires ?? []) if (!ancTechIds.has(r)) fail("anc tech " + tech.id + ": requires " + r);
    const tokens = ["A0","A1","A2","A3","A4","A5","warp","sector","gates","ending","resonance_wave","ascension_legacy"];
    const prefixes = ["module","weapon","structure","megastructure","ship","flag"];
    for (const u of tech.unlocks ?? []) {
      if (tokens.includes(u)) continue;
      const parts = String(u).split(":");
      if (parts.length !== 2 || !prefixes.includes(parts[0]) || !parts[1]) fail("anc tech " + tech.id + ": unlock " + u);
    }
  }
  // миссии линии
  for (const q of A.quests) {
    if (q.index < 1 || q.index > 12) fail("anc quest " + q.id + ": index");
    if (!(q.act >= 1 && q.act <= 5)) fail("anc quest " + q.id + ": act");
    const TYPES = ["visit","scan","relics","cores","tech","warp_jump","sector_scan","sector_claim","flag","kill_fp","relation"];
    for (const o of q.objectives ?? []) {
      if (!TYPES.includes(o.type)) fail("anc quest " + q.id + ": objective type " + o.type);
      if (!o.id) fail("anc quest " + q.id + ": objective без id");
      if (["visit","tech","flag","relation"].includes(o.type) && !o.target) fail("anc quest " + q.id + ": objective " + o.id + " без target");
      if (o.type === "tech" && !ancTechIds.has(o.target)) fail("anc quest " + q.id + ": unknown tech target " + o.target);
      if (o.type === "relation" && !ancFactionIds.has(o.target)) fail("anc quest " + q.id + ": unknown faction target " + o.target);
    }
    if (q.rewards?.tech && !ancTechIds.has(q.rewards.tech)) fail("anc quest " + q.id + ": reward.tech " + q.rewards.tech);
    for (const c of q.rewards?.codex ?? []) if (!ancCodexIds.has(c)) fail("anc quest " + q.id + ": reward.codex " + c);
    const unlocks = ["A0","A1","A2","A3","A4","A5","warp","sector","gates","ending"];
    for (const u of q.unlocks ?? []) {
      if (unlocks.includes(u)) continue;
      const parts = String(u).split(":");
      if (parts.length !== 2 || !parts[1]) fail("anc quest " + q.id + ": unlock " + u);
    }
  }
  const indexes = A.quests.map((q) => q.index).sort((a, b) => a - b);
  if (JSON.stringify(indexes) !== JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12])) fail("anc quests: индексы миссий не 1..12");
  // кодекс
  for (const entry of A.codex) {
    if (!entry.category || !entry.titleRu || !entry.textRu) fail("codex " + entry.id + ": пустые поля");
    const u = String(entry.unlock ?? "");
    if (u === "start" || u === "sector") continue;
    const parts = u.split(":");
    if (parts.length !== 2) fail("codex " + entry.id + ": unlock " + u);
    else if (parts[0] === "quest" && !ancQuestIds.has(parts[1])) fail("codex " + entry.id + ": unlock quest " + parts[1]);
    else if (parts[0] === "tech" && !ancTechIds.has(parts[1])) fail("codex " + entry.id + ": unlock tech " + parts[1]);
    else if (parts[0] === "faction" && !ancFactionIds.has(parts[1])) fail("codex " + entry.id + ": unlock faction " + parts[1]);
    else if (parts[0] === "mission" && !(Number(parts[1]) >= 1 && Number(parts[1]) <= 12)) fail("codex " + entry.id + ": unlock mission " + parts[1]);
    else if (!["quest","tech","faction","mission"].includes(parts[0])) fail("codex " + entry.id + ": неизвестное условие " + u);
  }
  // фракции
  for (const f of A.factions) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(f.color || "")) fail("sector faction " + f.id + ": color");
    if (!(f.relation >= -100 && f.relation <= 100)) fail("sector faction " + f.id + ": relation");
    if (!f.ru || !f.descRu) fail("sector faction " + f.id + ": пустые поля");
  }
  // регионы и POI
  const poiKinds = new Set(A.pois.map((poi) => poi.kind));
  let systemSum = 0;
  for (const region of A.regions) {
    systemSum += region.systemCount;
    if (region.hazard && !ancHazardIds.has(region.hazard)) fail("sector region " + region.id + ": hazard " + region.hazard);
    if (!region.poiKinds || region.poiKinds.length === 0) fail("sector region " + region.id + ": нет poiKinds");
    for (const k of region.poiKinds ?? []) if (!poiKinds.has(k)) fail("sector region " + region.id + ": kind " + k + " не встречается в POI");
  }
  if (systemSum !== 45) fail("sector regions: сумма systemCount " + systemSum + " (нужно 45)");
  const referencedKinds = new Set(A.regions.flatMap((r) => r.poiKinds));
  for (const poi of A.pois) {
    if (!referencedKinds.has(poi.kind)) fail("poi " + poi.id + ": kind " + poi.kind + " не привязан ни к одному региону");
    if (poi.codex && !ancCodexIds.has(poi.codex)) fail("poi " + poi.id + ": codex " + poi.codex);
    if (!(poi.threat >= 0 && poi.threat <= 100)) fail("poi " + poi.id + ": threat вне 0..100");
    if (!(poi.rewardRelics >= 0 && poi.rewardCores >= 0)) fail("poi " + poi.id + ": reward");
    if (!poi.ru || !poi.descRu) fail("poi " + poi.id + ": пустые поля");
  }
  // опасности и концовки
  for (const h of A.hazards) if (!(h.damagePerTick >= 0 && h.sensorPenalty >= 0)) fail("hazard " + h.id + ": отрицательные значения");
  for (const e of A.endings) {
    if (!["seal","use","give"].includes(e.choice)) fail("ancients ending " + e.id + ": choice");
    if (!campaignEndingIds.has(e.campaignEnding)) fail("ancients ending " + e.id + ": campaignEnding " + e.campaignEnding);
    if (!e.ru || !e.descRu) fail("ancients ending " + e.id + ": пустые поля");
  }
  const sealUseGive = A.endings.map((e) => e.choice).sort().join(",");
  if (sealUseGive !== "give,seal,use") fail("ancients endings: не покрыты все три выбора (seal/use/give)");
  // банк имён
  for (const k of ["prefixes","roots","suffixes"]) {
    if (!Array.isArray(A.names[k]) || A.names[k].length === 0) fail("ancients names: пустой банк " + k);
  }
  // -------- расширение: мегаструктуры/цепочки/испытания/корабли/события сектора --------
  const AEXT = {
    mega: load("ancients/sector-megastructures.json"),
    chains: load("ancients/archaeology-chains.json"),
    trials: load("ancients/warden-trials.json"),
    ships: load("ancients/relic-ships.json"),
    events: load("ancients/sector-events.json"),
  };
  if (AEXT.mega && AEXT.chains && AEXT.trials && AEXT.ships && AEXT.events) {
    dupCheck("ancients.sectorMegastructures", AEXT.mega);
    dupCheck("ancients.archaeologyChains", AEXT.chains);
    dupCheck("ancients.wardenTrials", AEXT.trials);
    dupCheck("ancients.relicShips", AEXT.ships);
    dupCheck("ancients.sectorEvents", AEXT.events);
    const EXT_COUNTS = {
      "ancients.sectorMegastructures": [AEXT.mega.length, 3, "=="],
      "ancients.archaeologyChains": [AEXT.chains.length, 6, "=="],
      "ancients.wardenTrials": [AEXT.trials.length, 6, "=="],
      "ancients.relicShips": [AEXT.ships.length, 3, "=="],
      "ancients.sectorEvents": [AEXT.events.length, 20, "=="],
    };
    for (const [name, [got, want, op]] of Object.entries(EXT_COUNTS)) {
      const bad = op === "==" ? got !== want : got < want;
      if (bad) fail("count " + name + "=" + got + " (ожидалось " + op + " " + want + ")");
      else ok("count " + name + "=" + got);
    }
    const regionIds = new Set(A.regions.map((r) => r.id));
    const chainIds = new Set(AEXT.chains.map((c) => c.id));
    const techIdsForExt = new Set(A.techs.map((t) => t.id));
    const codexIdsForExt = new Set(A.codex.map((c) => c.id));
    const hullIdsExt = new Set(F.hulls.map((h) => h.id));
    const hullClassById = new Map(F.hulls.map((h) => [h.id, h.classId]));
    for (const m of AEXT.mega) {
      if (!regionIds.has(m.region)) fail("sector megastructure " + m.id + ": region " + m.region);
      if (m.requiredTech && !techIdsForExt.has(m.requiredTech)) fail("sector megastructure " + m.id + ": requiredTech " + m.requiredTech);
      if (!(m.requiredMission >= 0 && m.requiredMission <= 12)) fail("sector megastructure " + m.id + ": requiredMission");
      if (!(m.maxPerEmpire >= 1)) fail("sector megastructure " + m.id + ": maxPerEmpire");
      if (!["gate_ring", "star_core", "archive"].includes(m.kind)) fail("sector megastructure " + m.id + ": kind");
      if (!m.effects || Object.keys(m.effects).length === 0) fail("sector megastructure " + m.id + ": пустые effects");
    }
    let chainSteps = 0;
    for (const c of AEXT.chains) {
      chainSteps += c.steps;
      if (!regionIds.has(c.region)) fail("archaeology chain " + c.id + ": region " + c.region);
      if (c.rewardTech && !techIdsForExt.has(c.rewardTech)) fail("archaeology chain " + c.id + ": rewardTech " + c.rewardTech);
      if (!(c.gateMission >= 0 && c.gateMission <= 12)) fail("archaeology chain " + c.id + ": gateMission");
      if (!(c.steps > 0)) fail("archaeology chain " + c.id + ": steps");
      if (!(c.threat >= 0 && c.threat <= 100)) fail("archaeology chain " + c.id + ": threat");
    }
    if (chainSteps < 23) fail("archaeology chains: сумма шагов " + chainSteps + " (нужно ≥23)");
    else ok("count ancients.archaeologySteps=" + chainSteps);
    for (const t of AEXT.trials) {
      if (t.rewardCodex && !codexIdsForExt.has(t.rewardCodex)) fail("warden trial " + t.id + ": rewardCodex " + t.rewardCodex);
      if (!(t.battleFp >= 0 && t.failTicks >= 0)) fail("warden trial " + t.id + ": числа");
      if (!t.checksRu) fail("warden trial " + t.id + ": пустое checksRu");
    }
    for (const s of AEXT.ships) {
      if (!hullIdsExt.has(s.hullId)) fail("relic ship " + s.id + ": hullId " + s.hullId);
      else if (hullClassById.get(s.hullId) !== s.classId) fail("relic ship " + s.id + ": classId не совпадает с корпусом");
      if (s.requiredTech && !techIdsForExt.has(s.requiredTech)) fail("relic ship " + s.id + ": requiredTech " + s.requiredTech);
      if (s.requiredChain && !chainIds.has(s.requiredChain)) fail("relic ship " + s.id + ": requiredChain " + s.requiredChain);
      if (!(s.maxPerEmpire === 1)) fail("relic ship " + s.id + ": maxPerEmpire должен быть 1");
      if (!(s.fleetPower > 0)) fail("relic ship " + s.id + ": fleetPower");
    }
    for (const ev of AEXT.events) {
      if (!ev.triggerRu) fail("sector event " + ev.id + ": пустой triggerRu");
      if (!Array.isArray(ev.choices) || ev.choices.length < 2) fail("sector event " + ev.id + ": нужно ≥2 выбора");
      const ids = new Set();
      for (const ch of ev.choices ?? []) {
        if (!ch.id || !ch.ru) fail("sector event " + ev.id + ": выбор без id/ru");
        if (ids.has(ch.id)) fail("sector event " + ev.id + ": дубль выбора " + ch.id);
        ids.add(ch.id);
        if (!ch.effects || Object.keys(ch.effects).length === 0) fail("sector event " + ev.id + " choice " + ch.id + ": пустые effects");
      }
    }
    ok("ancients extra: мегаструктур " + AEXT.mega.length + ", архео-цепочек " + AEXT.chains.length + " (" + chainSteps + " шагов), испытаний " + AEXT.trials.length + ", реликтовых кораблей " + AEXT.ships.length + ", событий сектора " + AEXT.events.length);
  }

  ok("ancients: расы " + A.races.length + " (" + playable + " playable / " + npc + " NPC), трейтов " + A.traits.length + ", техов " + A.techs.length + " A0–A5, миссий " + A.quests.length + ", кодекс " + A.codex.length + ", POI " + A.pois.length + ", регионов " + A.regions.length + " (45 систем), опасностей " + A.hazards.length + ", финалов " + A.endings.length);
}

// ---------- Часть XIV: DLC «Квесты и диалоги» ----------
const QX = {
  quests: load("quests/quests.json"),
  dialogues: load("quests/dialogues.json"),
  characters: load("quests/characters.json"),
  cards: load("quests/cards.json"),
  tree: load("quests/tree.json"),
};
if (QX.quests && QX.dialogues && QX.characters && QX.cards && QX.tree && Array.isArray(QX.quests)) {
  dupCheck("quests.quests", QX.quests);
  dupCheck("quests.dialogues", QX.dialogues);
  dupCheck("quests.characters", QX.characters);
  dupCheck("quests.cards", QX.cards);
  const dqIds = idsOf(QX.dialogues), dqCharIds = idsOf(QX.characters);
  const dqQuestIds = new Set(QX.quests.map((q) => q.id));
  const QCOUNTS = {
    "quests.quests": [QX.quests.length, 8, "=="],
    "quests.dialogues": [QX.dialogues.length, 6, ">="],
    "quests.characters": [QX.characters.length, 4, ">="],
    "quests.cards": [QX.cards.length, 8, "=="],
    "quests.tree.nodes": [QX.tree.nodes.length, 8, "=="],
    "quests.tree.edges": [QX.tree.edges.length, 10, "=="],
  };
  for (const [name, [got, want, op]] of Object.entries(QCOUNTS)) {
    const bad = op === "==" ? got !== want : got < want;
    if (bad) fail("count " + name + "=" + got + " (ожидалось " + op + " " + want + ")");
    else ok("count " + name + "=" + got);
  }
  const EMO = ["neutral", "warm", "cold", "angry", "afraid", "sad"];
  const STEP_TYPES = ["dialogue", "reach_system", "kill", "choice", "dock", "report", "turn_in"];
  const CHANNELS = ["story_message", "board", "rumor", "signal"];
  const QUEST_TYPES = ["main", "side", "faction", "personal", "event", "investigation", "bounty", "delivery"];
  const l10nHas = (key) => key && key in F.ru && key in F.en;
  // quests
  for (const q of QX.quests) {
    if (!QUEST_TYPES.includes(q.type)) fail("quest " + q.id + ": type " + q.type);
    if (!(q.act >= 0 && q.act <= 5)) fail("quest " + q.id + ": act");
    for (const k of ["titleKey", "summaryKey"]) if (!l10nHas(q[k])) fail("quest " + q.id + ": нет l10n ключа " + q[k]);
    if (!CHANNELS.includes(q.source?.channel)) fail("quest " + q.id + ": channel " + (q.source && q.source.channel));
    if (q.source?.requiresQuest && !dqQuestIds.has(q.source.requiresQuest)) fail("quest " + q.id + ": requiresQuest " + q.source.requiresQuest);
    if (!Array.isArray(q.steps) || q.steps.length === 0) fail("quest " + q.id + ": нет шагов");
    const stepIds = new Set();
    for (const s of q.steps ?? []) {
      if (stepIds.has(s.id)) fail("quest " + q.id + ": дубль шага " + s.id);
      stepIds.add(s.id);
      if (!STEP_TYPES.includes(s.type)) fail("quest " + q.id + " step " + s.id + ": type " + s.type);
      if (!l10nHas(s.titleKey)) fail("quest " + q.id + " step " + s.id + ": нет l10n ключа " + s.titleKey);
      if (s.type === "dialogue" && !dqIds.has(s.target)) fail("quest " + q.id + " step " + s.id + ": диалог " + s.target);
    }
    if (q.nextHint && !dqQuestIds.has(q.nextHint)) fail("quest " + q.id + ": nextHint " + q.nextHint);
    if (!["soft", "hard", "none"].includes(q.failPolicy)) fail("quest " + q.id + ": failPolicy");
  }
  // tree: узлы = квесты, рёбра валидны, граф ацикличен
  const nodeIds = new Set();
  for (const n of QX.tree.nodes) {
    if (nodeIds.has(n.id)) fail("tree: дубль узла " + n.id);
    nodeIds.add(n.id);
    if (!dqQuestIds.has(n.id)) fail("tree: узел " + n.id + " не является квестом");
    if (!n.group || !n.type) fail("tree: узел " + n.id + " без group/type");
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) fail("tree: узел " + n.id + " без координат");
  }
  for (const q of QX.quests) if (!nodeIds.has(q.id)) fail("tree: квест " + q.id + " отсутствует в дереве");
  const EDGE_KINDS = ["required", "optional", "branch", "hidden", "opens"];
  const adj = new Map();
  for (const e of QX.tree.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) fail("tree: ребро " + e.from + "→" + e.to + " вне узлов");
    if (!EDGE_KINDS.includes(e.kind)) fail("tree: ребро " + e.from + "→" + e.to + ": kind " + e.kind);
    if (e.from === e.to) fail("tree: петля " + e.from);
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const state = new Map();
  let cycle = null;
  const dfs = (id) => {
    state.set(id, 1);
    for (const to of adj.get(id) ?? []) {
      if (state.get(to) === 1) { cycle = id + "→" + to; return true; }
      if (!state.has(to) && dfs(to)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const id of nodeIds) if (!state.has(id) && dfs(id)) break;
  if (cycle) fail("tree: цикл " + cycle);
  else ok("tree: ациклический граф, " + QX.tree.nodes.length + " узлов / " + QX.tree.edges.length + " рёбер");
  // dialogues
  const KEY_FLAGS = ["going_now", "diagnose_first", "leader_first", "escort_first", "no_shots", "honest_report", "hide_core", "teira_only"];
  const flagsSeen = new Set();
  for (const d of QX.dialogues) {
    const ids = new Set();
    for (const n of d.nodes ?? []) {
      if (ids.has(n.id)) fail("dialogue " + d.id + ": дубль узла " + n.id);
      ids.add(n.id);
    }
    const nodeIdsD = ids;
    if (!["line", "choice", "check", "effect", "end"].includes(d.nodes[0]?.type)) fail("dialogue " + d.id + ": первый узел должен быть не end");
    let choices = 0, lines = 0, ends = 0;
    for (const n of d.nodes ?? []) {
      const types = ["line", "check", "effect", "end"];
      if (n.type === "choice") {
        choices++;
        const oids = new Set();
        for (const o of n.options ?? []) {
          if (oids.has(o.id)) fail("dialogue " + d.id + " node " + n.id + ": дубль опции " + o.id);
          oids.add(o.id);
          if (!l10nHas(o.textKey)) fail("dialogue " + d.id + " node " + n.id + " option " + o.id + ": нет l10n " + o.textKey);
          if (!nodeIdsD.has(o.next)) fail("dialogue " + d.id + " node " + n.id + " option " + o.id + ": next " + o.next);
          for (const eff of o.effects ?? []) {
            if (eff.flag) flagsSeen.add(eff.flag);
            if (eff.openQuest && !dqQuestIds.has(eff.openQuest)) fail("dialogue " + d.id + ": openQuest " + eff.openQuest);
          }
        }
        if ((n.options ?? []).length < 2) fail("dialogue " + d.id + " node " + n.id + ": менее 2 опций");
      }
      if (n.type === "line") lines++;
      if (n.type === "end") ends++;
      if (n.type === "choice" && !l10nHas(n.textKey)) fail("dialogue " + d.id + " node " + n.id + ": нет l10n " + n.textKey);
      if (n.type === "check") {
        if (!n.check || !n.check.stat || !(n.check.dc > 0)) fail("dialogue " + d.id + " node " + n.id + ": check не настроен");
        if (!nodeIdsD.has(n.check?.onSuccess) || !nodeIdsD.has(n.check?.onFail)) fail("dialogue " + d.id + " node " + n.id + ": onSuccess/onFail");
      }
      if (n.type !== "end" && n.type !== "choice" && n.type !== "check" && n.next && !nodeIdsD.has(n.next)) fail("dialogue " + d.id + " node " + n.id + ": next " + n.next);
      if (n.emotion && !EMO.includes(n.emotion)) fail("dialogue " + d.id + " node " + n.id + ": эмоция " + n.emotion);
      if (n.speaker && !dqCharIds.has(n.speaker) && !["svet", "player", "command", "board", "ort", "skar", "ash", "bar"].includes(n.speaker)) fail("dialogue " + d.id + " node " + n.id + ": неизвестный speaker " + n.speaker);
      if (n.type === "effect" || n.type === "end") for (const eff of n.effects ?? []) {
        if (eff.flag) flagsSeen.add(eff.flag);
        if (eff.openQuest && !dqQuestIds.has(eff.openQuest)) fail("dialogue " + d.id + ": openQuest " + eff.openQuest);
        if (eff.chronicleKey && !l10nHas(eff.chronicleKey)) fail("dialogue " + d.id + ": chronicleKey " + eff.chronicleKey);
      }
      if (n.textKey && !l10nHas(n.textKey)) fail("dialogue " + d.id + " node " + n.id + ": нет l10n " + n.textKey);
      if (n.comic && !/^[a-z0-9_]+$/.test(n.comic)) fail("dialogue " + d.id + " node " + n.id + ": comic id " + n.comic);
    }
    if (!ends) fail("dialogue " + d.id + ": нет узла end");
    if (d.nodes.length !== new Set(d.nodes.map((n) => n.id)).size) fail("dialogue " + d.id + ": id узлов не уникальны");
    ok("dialogue " + d.id + ": " + d.nodes.length + " узлов, выборов " + choices + ", реплик " + lines + ", концовок " + ends);
  }
  const mainDlg = QX.dialogues.find((d) => d.id === "dlg_q1_briefing");
  if (mainDlg) {
    const choiceNodes = mainDlg.nodes.filter((n) => n.type === "choice");
    if (mainDlg.nodes.length < 14) fail("dlg_q1_briefing: узлов " + mainDlg.nodes.length + " (нужно ≥14)");
    if (choiceNodes.length !== 3) fail("dlg_q1_briefing: значимых выборов " + choiceNodes.length + " (нужно 3)");
    for (const f of KEY_FLAGS) if (!flagsSeen.has(f)) fail("dlg_q1_briefing: нет флага " + f);
    ok("dlg_q1_briefing: 14+ узлов, 3 выбора, все 8 ключевых флагов");
  }
  // кампанийные диалоги и расширенные эффекты
  const branchIds = new Set(F.branches.map((b) => b.id));
  const campaignEndingIds = new Set(F.endings.map((e) => e.id));
  const MAX_NODES = 12, MIN_NODES = 8;
  const CAMPAIGN_DLGS = ["dlg_campaign_act2", "dlg_campaign_branch", "dlg_campaign_finale"];
  const effectFields = new Set(["flag","rep","openQuest","timeSkip","credits","chronicleKey","campaignFlag","relation","branch","ending","effectLabelKey","items"]);
  const allEffectKeys = new Set();
  const checkEffects = (d, where, effects) => {
    for (const e of effects ?? []) {
      for (const k of Object.keys(e)) if (!effectFields.has(k)) fail("dialogue " + d + " " + where + ": неизвестное поле эффекта " + k);
      if (e.branch && !branchIds.has(e.branch)) fail("dialogue " + d + " " + where + ": branch " + e.branch);
      if (e.ending && !campaignEndingIds.has(e.ending)) fail("dialogue " + d + " " + where + ": ending " + e.ending);
      if (e.campaignFlag !== undefined && !e.campaignFlag) fail("dialogue " + d + " " + where + ": пустой campaignFlag");
      if (e.effectLabelKey) { allEffectKeys.add(e.effectLabelKey); if (!l10nHas(e.effectLabelKey)) fail("dialogue " + d + " " + where + ": нет l10n " + e.effectLabelKey); }
      for (const [cid, delta] of Object.entries(e.relation ?? {})) {
        if (!dqCharIds.has(cid)) fail("dialogue " + d + " " + where + ": relation key " + cid + " не CharacterDef.id");
        if (!Number.isFinite(delta)) fail("dialogue " + d + " " + where + ": relation delta " + cid);
      }
      if (e.flag) flagsSeen.add(e.flag);
    }
  };
  for (const d of QX.dialogues) {
    if (CAMPAIGN_DLGS.includes(d.id)) {
      if (d.nodes.length < MIN_NODES || d.nodes.length > MAX_NODES) fail("campaign dialogue " + d.id + ": узлов " + d.nodes.length + " (нужно 8..12)");
      const ch = d.nodes.filter((n) => n.type === "choice").length;
      if (ch < 2 || ch > 3) fail("campaign dialogue " + d.id + ": значимых выборов " + ch + " (нужно 2..3)");
      for (const n of d.nodes) {
        checkEffects(d.id, "node " + n.id, n.effects);
        for (const o of n.options ?? []) checkEffects(d.id, "node " + n.id + " option " + o.id, o.effects);
      }
    }
  }
  for (const id of CAMPAIGN_DLGS) if (!dqIds.has(id)) fail("нет кампанийного диалога " + id);
  const q2 = QX.quests.find((q) => q.id === "q_pro_02_quiet_dock");
  const q5 = QX.quests.find((q) => q.id === "q_pro_05_inspection");
  const q6 = QX.quests.find((q) => q.id === "q_pro_06_echo_core");
  const byIdQ3 = QX.quests.find((q) => q.id === "q_pro_03_salt_ash");
  const byIdQ4 = QX.quests.find((q) => q.id === "q_pro_04_courier");
  const modifierFlagKeys = new Set();
  for (const q of QX.quests) {
    if (q.requiresFlags && (!Array.isArray(q.requiresFlags) || q.requiresFlags.some((f) => typeof f !== "string" || !f))) fail("quest " + q.id + ": requiresFlags");
    if (q.requiresAnyFlags) {
      if (!Array.isArray(q.requiresAnyFlags) || q.requiresAnyFlags.length === 0) fail("quest " + q.id + ": requiresAnyFlags");
      for (const f of q.requiresAnyFlags) if (typeof f !== "string" || !f) fail("quest " + q.id + ": requiresAnyFlags");
    }
    for (const m of q.modifiers ?? []) {
      for (const f of m.flags ?? []) modifierFlagKeys.add(f);
      for (const f of m.anyFlags ?? []) modifierFlagKeys.add(f);
      for (const f of m.notFlags ?? []) modifierFlagKeys.add(f);
      if (m.creditsDelta !== undefined && !Number.isFinite(m.creditsDelta)) fail("quest " + q.id + " modifier: creditsDelta");
      if (m.alloysDelta !== undefined && !Number.isFinite(m.alloysDelta)) fail("quest " + q.id + " modifier: alloysDelta");
      if (m.nextHint && !dqQuestIds.has(m.nextHint)) fail("quest " + q.id + " modifier: nextHint " + m.nextHint);
      for (const k of m.effectLabels ?? []) { allEffectKeys.add(k); if (!l10nHas(k)) fail("quest " + q.id + " modifier: нет l10n " + k); }
    }
    for (const k of q.effectLabels ?? []) { allEffectKeys.add(k); if (!l10nHas(k)) fail("quest " + q.id + ": нет l10n " + k); }
  }
  for (const q of [q2, q5, q6]) {
    if (!q) fail("нет квеста для Q1-последствий");
    else if (!(q.modifiers ?? []).length) fail("quest " + q.id + ": нет modifiers (Q1-флаги должны влиять)");
  }
  if (!(q5 && q5.nextHint === "q_pro_07_first_frontier")) fail("quest q_pro_05_inspection: nextHint должен вести на Q7");
  if (!(byIdQ3 && byIdQ3.nextHint === "q_pro_04_courier")) fail("quest q_pro_03_salt_ash: nextHint должен вести на Q4");
  if (!(byIdQ4 && byIdQ4.nextHint === "q_pro_05_inspection")) fail("quest q_pro_04_courier: nextHint должен вести на Q5");
  const EXPECT_Q1_FLAGS = ["going_now", "diagnose_first", "leader_first", "escort_first", "no_shots", "honest_report", "hide_core", "teira_only"];
  for (const f of EXPECT_Q1_FLAGS) if (!modifierFlagKeys.has(f)) fail("Q1-флаг " + f + " не влияет ни на один modifier (косметика)");
  ok("campaign: диалогов " + CAMPAIGN_DLGS.length + ", Q1-флагов в modifiers " + EXPECT_Q1_FLAGS.length + ", effectLabels " + allEffectKeys.size);
  // characters
  for (const c of QX.characters) {
    if (!c.id || !c.nameKey || !l10nHas(c.nameKey)) fail("character " + c.id + ": nameKey");
    const emo = [...(c.emotions ?? [])].sort().join(",");
    if (emo !== [...EMO].sort().join(",")) fail("character " + c.id + ": emotions должны быть 6 из 14b");
    if (c.portraits) for (const e of EMO) if (!c.portraits[e]) fail("character " + c.id + ": portraits без " + e);
    if (!c.role || !c.race) fail("character " + c.id + ": role/race");
    if (typeof c.relation?.base !== "number") fail("character " + c.id + ": relation.base");
    if (c.portrait && !/^[a-z0-9_]+$/.test(c.portrait)) fail("character " + c.id + ": portrait должен быть id-папкой (a-z0-9_)");
  }
  // cards
  const cardQuests = new Set();
  for (const card of QX.cards) {
    if (!dqQuestIds.has(card.questId)) fail("card " + card.id + ": questId " + card.questId);
    if (cardQuests.has(card.questId)) fail("card " + card.id + ": дубль карточки квеста " + card.questId);
    cardQuests.add(card.questId);
    if (!/^#[0-9A-Fa-f]{6}$/.test(card.accent || "")) fail("card " + card.id + ": accent");
    if (!card.art || !/^[a-z0-9_]+$/.test(card.art)) fail("card " + card.id + ": art должен быть id (a-z0-9_, UI строит /dlc/cards/<art>.png)");
  }
  for (const q of QX.quests) if (!cardQuests.has(q.id)) fail("card: нет карточки для квеста " + q.id);
  ok("DLC XIV: квестов " + QX.quests.length + ", диалогов " + QX.dialogues.length + ", персонажей " + QX.characters.length + ", карточек " + QX.cards.length + ", дерево " + QX.tree.nodes.length + "/" + QX.tree.edges.length);
}

// ---------- итог ----------
console.log("");
if (warns.length) console.log("предупреждений: " + warns.length);
if (errors.length) {
  console.log("ПРОВАЛ: " + errors.length + " ошибок");
  process.exit(1);
}
console.log("full data validation passed");
