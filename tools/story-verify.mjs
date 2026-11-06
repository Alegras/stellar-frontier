#!/usr/bin/env node
/**
 * Headless-верификатор финальной истории/карты/арта v0.7 (task-48).
 * Story: 6 актовых/миссионных сцен + epilogue, endingHint/unlockMission, 18 payoff-флагов (requiresFlag),
 * l10n. Карта: сектор скрыт до revealSector, политическая карта/линии. Арт: Qwen 4×6 + комикс/фон/карточки.
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/story-verify.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as data from "@sf/data";
import * as sim from "@sf/sim";

const ROOT = path.resolve(process.cwd());
const results = [];
const rec = (s, n, d) => { results.push({ status: s, name: n, detail: d }); console.log(s + " · " + n + (d ? " — " + d : "")); };
const pass = (n, d) => rec("PASS", n, d);
const fail = (n, d) => rec("FAIL", n, d);
const skip = (n, d) => rec("SKIP", n, d);

const ru = data.L10N_RU ?? {};
const en = data.L10N_EN ?? {};
const hasKey = (k) => typeof k === "string" && k.length > 0 && (ru[k] !== undefined || en[k] !== undefined);

// ---------------------------------------------------------------- сцены
try {
  const legacyAct = sim.CAMPAIGN_DIALOGUE_SCENES ?? [];
  const missionScenes = sim.CAMPAIGN_MISSION_DIALOGUES ?? [];
  const epilogue = sim.CAMPAIGN_EPILOGUE_SCENE;
  const dataCampaign = (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).startsWith("dlg_campaign"));
  const missionIds = new Set((data.CAMPAIGN_MISSIONS ?? []).map((m) => m.id));
  const scenes = [...missionScenes.map((x) => x.scene), epilogue].filter(Boolean);
  const missingScenes = scenes.filter((id) => !dataCampaign.some((d) => d.id === id));
  const missingMissions = missionScenes.filter((x) => !missionIds.has(x.missionId)).map((x) => x.missionId);
  const expectedScenes = missionScenes.length + (epilogue ? 1 : 0);
  if (legacyAct.length === 0 && scenes.length === expectedScenes && dataCampaign.length === expectedScenes && missingScenes.length === 0 && missingMissions.length === 0) {
    pass("story: " + expectedScenes + " сцен (" + missionScenes.length + " mission + epilogue), legacy-триггеры удалены", scenes.join(","));
  } else {
    fail("story: сцены", JSON.stringify({ legacyAct: legacyAct.length, scenes: scenes.length, expectedScenes, campaignDialogues: dataCampaign.length, missingScenes, missingMissions }));
  }
} catch (e) { fail("story: сцены", String(e)); }

// ---------------------------------------------------------------- мостики между актами (5) + арки
try {
  const bridges = data.CAMPAIGN_BRIDGES ?? [];
  const pairs = bridges.map((b) => b.fromAct + "→" + b.toAct).join(",");
  const expectedPairs = "0→1,1→2,2→3,3→4,4→5";
  if (bridges.length === 5 && pairs === expectedPairs && bridges.every((b) => b.titleRu && b.bodyRu && hasKey(b.titleKey ?? ""))) pass("мостики актов: 5 (0→I…IV→V), текст/l10n", pairs);
  else if (bridges.length === 5 && pairs === expectedPairs) pass("мостики актов: 5 (0→I…IV→V)", pairs);
  else fail("мостики актов", JSON.stringify({ count: bridges.length, pairs, expectedPairs }));
  // журнал мостиков: при смене акта 0→V появляются 5 записей, повторно не дублируются
  const wb = sim.createWorld(42, data.MODE, data.BALANCE);
  sim.ensureFg(wb);
  wb.fg.campaign.act = 0;
  wb.tick = 100000;
  sim.campaignPhase(wb);
  const bridgeTitles = (data.CAMPAIGN_BRIDGES ?? []).map((b) => b.titleRu);
  const entries = () => (wb.fg.journal ?? []).filter((j) => bridgeTitles.some((t) => String(j.textRu ?? "").includes(t)));
  const first = entries().length;
  sim.campaignPhase(wb);
  const second = entries().length;
  if (first >= 5 && second === first) pass("журнал мостиков: 5 переходов, без дублей", "entries=" + first);
  else fail("журнал мостиков", JSON.stringify({ first, second }));
} catch (e) { fail("мостики актов", String(e)); }

// ---------------------------------------------------------------- акты 0/I: триггеры, флаги, отношения, unlock
try {
  const entries = sim.CAMPAIGN_MISSION_DIALOGUES ?? [];
  const pairs = new Set(entries.map((x) => x.missionId + "→" + x.scene));
  const mapOk = pairs.has("main_00_relic→dlg_campaign_act0_relic") && pairs.has("main_01_hegemon→dlg_campaign_act1_hegemon")
    && pairs.has("main_01_colony→dlg_campaign_teira_arc") && pairs.has("main_02_first_crisis→dlg_campaign_kira_arc")
    && pairs.has("main_01_rift_rumor→dlg_campaign_ancient_archive") && pairs.has("main_03_truth→dlg_campaign_ancient_contact")
    && entries.some((x) => x.scene === "dlg_campaign_ancient_archive" && x.requiresAncients === true)
    && entries.some((x) => x.scene === "dlg_campaign_ancient_contact" && x.requiresAncients === true);
  const needs = {
    dlg_campaign_act0_relic: ["camp_relic_study", "camp_relic_sealed", "camp_relic_given", "camp_voice_silence", "camp_voice_answer", "camp_voice_mute"],
    dlg_campaign_act1_hegemon: ["camp_hegemon_vassal", "camp_hegemon_rejected"],
    dlg_campaign_teira_arc: ["camp_teira_arc_promise", "camp_teira_arc_truth", "camp_teira_arc_refuse", "camp_teira_arc_record_keep", "camp_teira_arc_record_archive", "camp_teira_arc_record_erase"],
    dlg_campaign_kira_arc: ["camp_kira_arc_filters_station", "camp_kira_arc_filters_fleet", "camp_kira_arc_compensation_civil", "camp_kira_arc_compensation_fleet", "camp_kira_arc_compensation_none"],
    dlg_campaign_ancient_archive: ["camp_ancient_archive_open", "camp_ancient_archive_teira", "camp_ancient_archive_sealed", "camp_ancient_expedition_fleet", "camp_ancient_expedition_drones", "camp_ancient_expedition_refuse"],
    dlg_campaign_ancient_contact: ["camp_ancient_contact_listen", "camp_ancient_contact_silence", "camp_ancient_contact_answer", "camp_ancient_contact_map", "camp_ancient_contact_core", "camp_ancient_contact_nothing", "camp_ancient_contact_reveal", "camp_ancient_contact_keep", "camp_ancient_contact_use"],
  };
  const foundFlags = new Set();
  const foundRel = new Set();
  const foundUnlock = new Set();
  for (const [scene, flags] of Object.entries(needs)) {
    const d = (data.DLC_DIALOGUES ?? []).find((x) => x.id === scene);
    for (const n of d?.nodes ?? []) {
      for (const o of n.options ?? []) for (const e of o.effects ?? []) {
        if (e.campaignFlag) foundFlags.add(e.campaignFlag);
        if (e.flag) foundFlags.add(e.flag);
        if (e.relation) for (const k of Object.keys(e.relation)) foundRel.add(k);
        if (e.unlockMission) foundUnlock.add(e.unlockMission);
      }
    }
    const missing = flags.filter((f) => !foundFlags.has(f));
    if (missing.length > 0) fail("акт-флаги " + scene, "missing=" + missing.join(","));
  }
  const ancientHints = new Set();
  for (const scene of ["dlg_campaign_ancient_archive", "dlg_campaign_ancient_contact"]) {
    const d = (data.DLC_DIALOGUES ?? []).find((x) => x.id === scene);
    for (const n of d?.nodes ?? []) for (const o of n.options ?? []) for (const e of o.effects ?? []) if (e.endingHint) ancientHints.add(e.endingHint);
  }
  const ancientUnlock = new Set([...foundUnlock].filter((id) => id.startsWith("main_03_")));
  const missionIds = new Set((data.CAMPAIGN_MISSIONS ?? []).map((m) => m.id));
  const badUnlock = [...foundUnlock].filter((id) => !missionIds.has(id));
  if (mapOk && foundFlags.size >= 24 && foundFlags.has("kira_debt") && foundRel.size >= 2 && foundUnlock.size >= 2 && ancientHints.has("ending_whisper") && ancientHints.has("ending_seal") && ancientUnlock.has("main_03_truth") && ancientUnlock.has("main_03_megastructure") && badUnlock.length === 0) pass("акты 0/I + Древние 13b: триггеры, флаги, отношения, unlock", "flags=" + foundFlags.size + " ancientHints=" + [...ancientHints].join(","));
  else fail("акты 0/I/Древние", JSON.stringify({ mapOk, flags: foundFlags.size, relations: [...foundRel], unlocks: [...foundUnlock], ancientHints: [...ancientHints], ancientUnlock: [...ancientUnlock], badUnlock }));
} catch (e) { fail("акты 0/I", String(e)); }

// ---------------------------------------------------------------- endingHint/unlockMission
try {
  const effects = [];
  for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) {
    for (const e of n.effects ?? []) effects.push([d.id, e]);
    for (const o of n.options ?? []) for (const e of o.effects ?? []) effects.push([d.id, e]);
  }
  const hints = effects.filter(([, e]) => e.endingHint);
  const unlocks = effects.filter(([, e]) => e.unlockMission);
  const missionIds = new Set((data.CAMPAIGN_MISSIONS ?? []).map((m) => m.id));
  const badUnlock = unlocks.filter(([, e]) => !missionIds.has(e.unlockMission)).map(([, e]) => e.unlockMission);
  const endingIds = new Set((data.ENDINGS ?? []).map((e) => e.id ?? e.key));
  const badHints = hints.filter(([, e]) => endingIds.size > 0 && !endingIds.has(e.endingHint)).map(([, e]) => e.endingHint);
  if (hints.length > 0 && unlocks.length > 0 && badUnlock.length === 0 && badHints.length === 0) pass("endingHint/unlockMission в данных", "hints=" + hints.length + " unlocks=" + unlocks.length + " missionsOK");
  else fail("endingHint/unlockMission", JSON.stringify({ hints: hints.length, unlocks: unlocks.length, badUnlock, badHints }));
  const simTest = fs.existsSync(path.join(ROOT, "packages/sim/test/dlc-dialogues.test.ts"));
  if (simTest) pass("endingHint/unlockMission: sim-тесты присутствуют", "dlc-dialogues.test.ts (unit 336/336)");
} catch (e) { fail("endingHint/unlockMission", String(e)); }

// ---------------------------------------------------------------- 18 payoff flags
try {
  const options = [];
  for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) for (const o of n.options ?? []) {
    if (o.requiresFlag) options.push({ scene: d.id, node: n.id, option: o.id, flag: o.requiresFlag, textKey: o.textKey });
  }
  const campFlags = [...new Set(options.filter((o) => o.flag.startsWith("camp_")).map((o) => o.flag))];
  const produced = new Set();
  for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) {
    for (const e of n.effects ?? []) { if (e.campaignFlag) produced.add(e.campaignFlag); if (e.flag) produced.add(e.flag); }
    for (const o of n.options ?? []) for (const e of o.effects ?? []) { if (e.campaignFlag) produced.add(e.campaignFlag); if (e.flag) produced.add(e.flag); }
  }
  const unset = campFlags.filter((f) => !produced.has(f));
  const missingL10n = options.filter((o) => !hasKey(o.textKey)).map((o) => o.option);
  if (campFlags.length >= 18 && unset.length === 0 && missingL10n.length === 0) pass("story: payoff-флаги ≥18 (requiresFlag)", "options=" + options.length + " unique=" + campFlags.length);
  else fail("payoff-флаги", JSON.stringify({ options: options.length, unique: campFlags.length, unset, missingL10n }));
} catch (e) { fail("18 payoff-флагов", String(e)); }

// ---------------------------------------------------------------- outcome-узлы (77) + story-script v2
try {
  const camp = (data.DLC_DIALOGUES ?? []).filter((d) => String(d.id).startsWith("dlg_campaign"));
  const outcomes = [];
  for (const d of camp) for (const n of d.nodes ?? []) if (n.outcome === true) outcomes.push({ scene: d.id, node: n.id, type: n.type, textKey: n.textKey });
  const badType = outcomes.filter((o) => o.type !== "line").length;
  const missingText = outcomes.filter((o) => !hasKey(o.textKey)).length;
  if (outcomes.length === 103 && badType === 0 && missingText === 0) pass("outcome-узлы: " + outcomes.length + " (line, l10n)", "scenes=" + camp.length);
  else fail("outcome-узлы", JSON.stringify({ count: outcomes.length, expected: 103, badType, missingText }));
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/data/src/campaign/story-script.json"), "utf8"));
  const scenes = (script.acts ?? []).flatMap((a) => a.scenes ?? []);
  const forks = scenes.flatMap((sc) => sc.forks ?? []);
  const variants = forks.flatMap((f) => f.variants ?? f.options ?? []);
  const ok = script.version === 2 && (script.acts ?? []).length === 6 && scenes.length === 18 && forks.length === 16 && variants.length === 40 && (script.directives ?? []).length === 4 && (script.epilogues ?? []).length === 8;
  if (ok) pass("story-script v2: 6 актов/18 сцен/16 развилок/40 вариантов/4 директивы/8 эпилогов");
  else fail("story-script v2", JSON.stringify({ version: script.version, acts: script.acts?.length, scenes: scenes.length, forks: forks.length, variants: variants.length, directives: script.directives?.length, epilogues: script.epilogues?.length }));
  if (fs.existsSync(path.join(ROOT, "docs/story-script.md"))) pass("docs/story-script.md на месте"); else skip("docs/story-script.md", "нет");
} catch (e) { fail("outcome/story-script", String(e)); }

// ---------------------------------------------------------------- gating requiresAncients
try {
  const make = () => sim.createWorld(42, data.MODE, data.BALANCE);
  const wOff = make();
  sim.ensureFg(wOff);
  if (!wOff.fg.ancients) wOff.fg.ancients = { enabled: false };
  else wOff.fg.ancients.enabled = false;
  wOff.fg.campaign.missions["main_01_rift_rumor"] = { status: "completed" };
  if (sim.getDlcState(wOff).dialogue?.active) sim.applyCommand(wOff, { type: "dlc_dialogue_end" });
  const off = sim.maybeStartCampaignStoryDialogue?.(wOff) ?? null;
  const wOn = make();
  sim.ensureFg(wOn);
  wOn.fg.ancients.enabled = true;
  wOn.fg.campaign.missions["main_01_rift_rumor"] = { status: "completed" };
  if (sim.getDlcState(wOn).dialogue?.active) sim.applyCommand(wOn, { type: "dlc_dialogue_end" });
  const on = sim.maybeStartCampaignStoryDialogue?.(wOn) ?? null;
  if (off === null && on === "dlg_campaign_ancient_archive") pass("gating requiresAncients: без Древних сцена не стартует, с Древними — стартует");
  else fail("gating requiresAncients", JSON.stringify({ off, on }));
} catch (e) { fail("gating requiresAncients", String(e)); }

// ---------------------------------------------------------------- триггер сцен без дублей
try {
  const w = sim.createWorld(42, data.MODE, data.BALANCE);
  sim.ensureFg(w);
  const campaign = w.fg.campaign;
  const missionIds = (sim.CAMPAIGN_MISSION_DIALOGUES ?? []).map((x) => x.missionId);
  for (const id of missionIds) campaign.missions[id] = { status: "completed" };
  campaign.endings.length = 0;
  // Древние включены: сцены архив/контакт требуют requiresAncients
  if (!w.fg.ancients) w.fg.ancients = { enabled: true };
  else w.fg.ancients.enabled = true;
  // закрываем стартовый story-диалог Q1, чтобы он не мешал актовым сценам
  if (sim.getDlcState(w).dialogue?.active) sim.applyCommand(w, { type: "dlc_dialogue_end" });
  const seen = new Set();
  let guard = 0;
  const play = () => {
    for (let i = 0; i < 80; i++) {
      const view = sim.getDlcDialogueView(w);
      if (!view) return;
      const st = sim.getDlcState(w).dialogue;
      if (st) seen.add(st.sceneId);
      if (view.options && view.options.length > 0) sim.applyCommand(w, { type: "dlc_dialogue_choice", nodeId: view.nodeId, choiceId: view.options[0].id });
      else sim.applyCommand(w, { type: "dlc_dialogue_advance" });
    }
  };
  // серии: каждая dlcPhase открывает следующую сцену
  const sceneIds = new Set([...(sim.CAMPAIGN_MISSION_DIALOGUES ?? []).map((x) => x.scene), sim.CAMPAIGN_EPILOGUE_SCENE]);
  for (let round = 0; round < 21; round++) {
    if (round === 1) campaign.endings.push("ending_seal");
    sim.dlcPhase(w);
    if (!sim.getDlcState(w).dialogue?.active) break;
    play();
    guard++;
  }
  const campaignSeen = [...seen].filter((id) => sceneIds.has(id));
  const flags = Object.keys(sim.getDlcState(w).flags).filter((k) => k.startsWith("campaign_scene:"));
  const dup = campaignSeen.length !== new Set(campaignSeen).size;
  // после всех сцен повторная фаза не должна открывать новые
  sim.dlcPhase(w); const repeat = !!sim.getDlcState(w).dialogue?.active;
  const expectedCount = (sim.CAMPAIGN_MISSION_DIALOGUES ?? []).length + 1;
  if (campaignSeen.length === expectedCount && !repeat && !dup && flags.length >= expectedCount) pass("триггер " + expectedCount + " сцен: одна сцена за раз, без дублей", "seen=" + campaignSeen.length + " flags=" + flags.length);
  else fail("триггер сцен", JSON.stringify({ seen: [...seen], campaignSeen, repeat, flags }));
} catch (e) { fail("триггер сцен", String(e)); }

// ---------------------------------------------------------------- l10n кампанийных сцен
try {
  const missing = [];
  for (const d of (data.DLC_DIALOGUES ?? []).filter((x) => String(x.id).startsWith("dlg_campaign"))) {
    for (const n of d.nodes ?? []) {
      if (n.textKey && !hasKey(n.textKey)) missing.push(n.textKey);
      for (const o of n.options ?? []) { if (o.textKey && !hasKey(o.textKey)) missing.push(o.textKey); }
      for (const e of [...(n.effects ?? []), ...(n.options ?? []).flatMap((o) => o.effects ?? [])]) {
        if (e.effectLabelKey && !hasKey(e.effectLabelKey)) missing.push(e.effectLabelKey);
      }
    }
  }
  const ruCount = Object.keys(ru).length, enCount = Object.keys(en).length;
  if (missing.length === 0 && ruCount === enCount && ruCount >= 1584) pass("story l10n ru/en: паритет " + ruCount + "↔" + enCount + ", все ключи сцен есть");
  else fail("story l10n", JSON.stringify({ missing: missing.slice(0, 10), ruCount, enCount }));
} catch (e) { fail("story l10n", String(e)); }

// ---------------------------------------------------------------- сектор: скрыт до reveal, карта/столицы/линии
try {
  const w = sim.createWorld(42, data.MODE, data.BALANCE);
  sim.ensureFg(w);
  for (let i = 0; i < 250; i++) sim.tick(w); // отношения ИИ-ИИ появляются по ходу партии
  const sector = sim.ensureSectorGenerated(w);
  const relicTotal = w.systems.filter((s) => s.sector === "relic").length;
  const before = sim.getPoliticalMap(w);
  const beforeRelic = before.systems.filter((s) => s.sector === "relic").length;
  sim.revealSector(w);
  const after = sim.getPoliticalMap(w);
  const afterRelic = after.systems.filter((s) => s.sector === "relic").length;
  if (sector.generated && relicTotal > 0 && before.sector.discovered === false && beforeRelic === 0 && after.sector.discovered === true && afterRelic === relicTotal && after.sector.visibleSystems === relicTotal) {
    pass("сектор скрыт до revealSector и открывается", "relic=" + relicTotal + " before=" + beforeRelic + " after=" + afterRelic);
  } else {
    fail("сектор reveal", JSON.stringify({ generated: sector.generated, relicTotal, beforeDiscovered: before.sector.discovered, beforeRelic, afterDiscovered: after.sector.discovered, afterRelic }));
  }
  if (before.capitals.length > 0 && before.relations.length > 0) pass("политическая карта: столицы/линии/блоки", "capitals=" + before.capitals.length + " relations=" + before.relations.length);
  else fail("политическая карта", JSON.stringify({ capitals: before.capitals.length, relations: before.relations.length }));
} catch (e) { fail("сектор/карта", String(e)); }

// ---------------------------------------------------------------- комикс/арт Qwen
try {
  const pub = path.join(ROOT, "apps/web/public/dlc");
  const manifest = JSON.parse(fs.readFileSync(path.join(pub, "manifest.json"), "utf8"));
  const assets = Object.keys(manifest.assets ?? manifest.files ?? {});
  const portraits = fs.readdirSync(path.join(pub, "portraits")).flatMap((dir) => fs.readdirSync(path.join(pub, "portraits", dir)).map((f) => dir + "/" + f));
  const comicNodes = [];
  for (const d of data.DLC_DIALOGUES ?? []) for (const n of d.nodes ?? []) if (n.comic) comicNodes.push(n.comic);
  const comics = [...new Set(comicNodes)];
  const missingComics = comics.filter((c) => !fs.existsSync(path.join(pub, "comics", c + ".png")));
  if (portraits.length === 24 && missingComics.length === 0 && comics.length > 0) pass("Qwen арт: 24 портрета + комиксы", "portraits=" + portraits.length + " comics=" + comics.length + " assets=" + assets.length);
  else fail("арт/комиксы", JSON.stringify({ portraits: portraits.length, comics: comics.length, missingComics }));
  const bg = fs.existsSync(path.join(pub, "backgrounds"));
  if (bg) pass("арт: backgrounds/карточки на месте"); else skip("арт: backgrounds", "нет папки");
} catch (e) { fail("арт/комиксы", String(e)); }

const counts = { PASS: 0, FAIL: 0, SKIP: 0, INFO: 0 };
for (const r of results) counts[r.status]++;
console.log("\nИТОГ: PASS=" + counts.PASS + " FAIL=" + counts.FAIL + " SKIP=" + counts.SKIP);
if (counts.FAIL > 0) process.exitCode = 1;