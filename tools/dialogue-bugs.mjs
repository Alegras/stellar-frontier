#!/usr/bin/env node
/**
 * QA-репро багов ДЛЯ ДИАЛОГОВ (task-40): повтор сцены после завершения, закрытие, активный диалог,
 * последствия выборов Q1 (Q2/Q5/Q6/награды/репутация), кампанийные диалоги, арт 4×6.
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/dialogue-bugs.mjs [--json]
 * FAIL до мержа task-36/37/38/39 фиксируют целевое поведение (приёмка после фикса).
 */
import * as data from "@sf/data";
import * as sim from "@sf/sim";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AS_JSON = process.argv.includes("--json");
const results = [];
const rec = (s, n, d) => { results.push({ status: s, name: n, detail: d }); if (!AS_JSON) console.log(s + " · " + n + (d ? " — " + d : "")); };
const pass = (n, d) => rec("PASS", n, d);
const fail = (n, d) => rec("FAIL", n, d);
const info = (n, d) => rec("INFO", n, d);
const skip = (n, d) => rec("SKIP", n, d);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cmd = (w, c) => sim.applyCommand(w, c);
const world = (seed = 42) => { const w = sim.createWorld(seed, data.MODE, data.BALANCE); sim.ensureFg(w); return w; };
const dlc = (w) => sim.getDlcState(w);

function playDialogue(w, preferred = []) {
  let guard = 0;
  while (guard++ < 60) {
    const v = sim.getDlcDialogueView(w);
    if (!v || v.active === false) break;
    if (v.options?.length) {
      const opt = preferred.find((id) => v.options.some((o) => o.id === id)) ?? v.options[0].id;
      cmd(w, { type: "dlc_dialogue_choice", nodeId: v.nodeId, choiceId: opt });
    } else cmd(w, { type: "dlc_dialogue_advance" });
  }
}

function completeQ1(w) {
  sim.tick(w, 1000);
  playDialogue(w);
  const actions = ["reach_system:sys_debris_belt_home", "kill:pirate_corvette", "kill:pirate_corvette", "choice:q1_c2_target", "dock:station_light_1", "report:kira7", "turn_in:kira7"];
  for (const a of actions) { const [action, target] = a.split(":"); cmd(w, { type: "dlc_action", action, target }); }
  return dlc(w).quests["q_pro_01_first_light"];
}

// ---------------------------------------------------------------- данные/арт
const chars = data.DLC_CHARACTERS ?? [];
info("диалоги: шт", String((data.DLC_DIALOGUES ?? []).length) + " (" + (data.DLC_DIALOGUES ?? []).map((d) => d.id).join(",") + ")");
if (chars.length >= 4) pass("персонажи: 4 для арта", chars.map((c) => c.id).join(","));
else fail("персонажи: 4 (сейчас " + chars.length + ")", chars.map((c) => c.id).join(","));
const portraitsRoot = path.join(ROOT, "apps", "web", "public", "dlc", "portraits");
let artTotal = 0, artMissing = [];
for (const c of chars) {
  const dir = path.join(portraitsRoot, c.id);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")) : [];
  artTotal += files.length;
  for (const em of ["neutral", "warm", "cold", "angry", "afraid", "sad"]) if (!files.includes(em + ".png")) artMissing.push(c.id + "/" + em);
}
if (chars.length >= 4 && artTotal >= 24 && artMissing.length === 0) pass("арт: 4×6 эмоций", artTotal + " PNG");
else fail("арт: 4×6 эмоций", artTotal + " PNG, missing=" + artMissing.slice(0, 6).join(","));

// ---------------------------------------------------------------- повтор после завершения
try {
  const w = world();
  const q1 = completeQ1(w);
  const before = dlc(w).dialogue;
  const res = cmd(w, { type: "dlc_dialogue_start", sceneId: "dlg_q1_briefing", questId: "q_pro_01_first_light" });
  const after = dlc(w).dialogue;
  if (q1.status === "completed" && res?.ok === false && !after?.active) pass("повтор dlg_q1_briefing после завершения отклонён", res.messageRu ?? "");
  else fail("повтор dlg_q1_briefing после завершения", JSON.stringify({ q1: q1.status, start: res, active: after?.active }));
} catch (e) { fail("повтор после завершения", String(e)); }

// ---------------------------------------------------------------- повтор поверх активного
try {
  const w = world();
  sim.tick(w, 1000);
  const first = dlc(w).dialogue;
  const res = cmd(w, { type: "dlc_dialogue_start", sceneId: "dlg_q1_briefing", questId: "q_pro_01_first_light" });
  const second = dlc(w).dialogue;
  const sameNode = first?.nodeId === second?.nodeId && first?.sceneId === second?.sceneId;
  const interrupts = dlc(w).flags["dialogue_interrupted"] ?? 0;
  if (res?.ok === false) pass("повторный старт поверх активного отклонён", res.messageRu ?? "");
  else fail("повторный старт поверх активного", "ok=" + res?.ok + " same=" + sameNode + " interrupts=" + interrupts);
} catch (e) { fail("повтор поверх активного", String(e)); }

// ---------------------------------------------------------------- закрытие (sim API) и active
try {
  const w = world();
  sim.tick(w, 1000);
  const activeBefore = dlc(w).dialogue?.active === true;
  sim.endDlcDialogue(w);
  const activeAfter = dlc(w).dialogue?.active === true;
  if (activeBefore && !activeAfter) pass("endDlcDialogue очищает active (sim гейт для UI X)");
  else fail("endDlcDialogue", "before=" + activeBefore + " after=" + activeAfter);
} catch (e) { fail("endDlcDialogue", String(e)); }

// ---------------------------------------------------------------- последствия выборов
const scenarios = [
  { c1: "going_now", c2: "leader_first", c3: "honest_report" },
  { c1: "diagnose_first", c2: "escort_first", c3: "hide_core" },
  { c1: "diagnose_first", c2: "no_shots", c3: "teira_only" },
];
const runs = [];
try {
  for (let i = 0; i < scenarios.length; i++) {
    const w = world(42 + i);
    sim.tick(w, 1000);
    playDialogue(w, [scenarios[i].c1, scenarios[i].c2, scenarios[i].c3]);
    const d = dlc(w);
    runs.push({
      c1: scenarios[i].c1, c2: scenarios[i].c2, c3: scenarios[i].c3,
      flags: Object.keys(d.flags).filter((f) => !/^(story_message|dlc_|hint|dialogue_done)/.test(f)).sort(),
      rep: d.reputation,
      q2: d.quests["q_pro_02_quiet_dock"]?.status,
      q2Next: d.quests["q_pro_02_quiet_dock"] ? "ok" : "none",
    });
  }
  info("выборы Q1: вариации", JSON.stringify(runs).slice(0, 500));
  const flagDiff = new Set(runs.flatMap((r) => r.flags)).size;
  if (flagDiff >= 5) pass("выборы меняют флаги (≥5 уникальных)", [...new Set(runs.flatMap((r) => r.flags))].join(","));
  else fail("выборы меняют флаги", String(flagDiff));
  const repDiff = new Set(runs.map((r) => JSON.stringify(r.rep))).size;
  if (repDiff >= 2) pass("выборы меняют репутацию", JSON.stringify(runs.map((r) => r.rep)));
  else fail("выборы меняют репутацию", JSON.stringify(runs.map((r) => r.rep)));
  if (runs.every((r) => r.q2 && r.q2 !== "locked")) pass("выборы открывают Q2 во всех ветках", runs.map((r) => r.q2).join(","));
  else fail("Q2 после выборов", JSON.stringify(runs.map((r) => r.q2)));
  // B7: Q1-флаги реально читаются в Q2/Q5/Q6 (гейты/модификаторы наград)
  const q1Flags = ["going_now", "diagnose_first", "leader_first", "escort_first", "no_shots", "honest_report", "hide_core", "teira_only"];
  const modsOf = (id) => (data.DLC_QUESTS ?? []).find((q) => q.id === id)?.modifiers ?? [];
  const modFlags = (list) => list.flatMap((m) => [...(m.flags ?? []), ...(m.anyFlags ?? []), ...(m.notFlags ?? [])]);
  const covered = new Set(modFlags([...modsOf("q_pro_02_quiet_dock"), ...modsOf("q_pro_05_inspection"), ...modsOf("q_pro_06_echo_core")]));
  const missing = q1Flags.filter((f) => !covered.has(f));
  const q5 = (data.DLC_QUESTS ?? []).find((q) => q.id === "q_pro_05_inspection");
  const q5Gate = (q5?.requiresAnyFlags ?? []).filter((f) => q1Flags.includes(f));
  // Q5: requiresAnyFlags намеренно снят (hide_core-ветка); влияние Q1 остаётся через modifiers
  if (missing.length === 0) pass("B7: Q1-флаги читаются в Q2/Q5/Q6 (modifiers)", "covered=" + [...covered].join(",") + " q5Gate=" + (q5Gate.length ? q5Gate.join(",") : "none"));
  else fail("B7: Q1-флаги в Q2/Q5/Q6", "missing=" + missing.join(",") + " q5Gate=" + q5Gate.join(","));
} catch (e) { fail("последствия выборов", String(e)); }

// ---------------------------------------------------------------- кампанийные диалоги
try {
  const dlgIds = (data.DLC_DIALOGUES ?? []).map((d) => d.id);
  const campaignRefs = (data.MISSIONS ?? []).filter((m) => m.dialogue || m.dlgId).length;
  const branchRefs = (data.BRANCHES ?? []).filter((b) => b.dialogue || b.dlgId).length;
  // B6: кампанийные сцены + эффекты branch/ending/campaignFlag
  const campScenes = (data.DLC_DIALOGUES ?? []).filter((d) => d.id.startsWith("dlg_campaign"));
  const effects = [];
  for (const d of campScenes) {
    for (const n of d.nodes ?? []) {
      for (const e of n.effects ?? []) effects.push(e);
      for (const opt of n.options ?? []) for (const e of opt.effects ?? []) effects.push(e);
    }
  }
  const branches = [...new Set(effects.map((e) => e.branch).filter(Boolean))];
  const endings = [...new Set(effects.map((e) => e.ending).filter(Boolean))];
  const campFlags = [...new Set(effects.map((e) => e.campaignFlag).filter(Boolean))];
  info("кампания: диалоги/ветки", JSON.stringify({ dlcDialogues: dlgIds, campScenes: campScenes.map((d) => d.id), branches, endings, campFlags: campFlags.slice(0, 8) }));
  if (campScenes.length >= 3 && branches.length >= 2 && endings.length >= 2 && campFlags.length >= 3) pass("B6: кампанийные диалоги с branch/ending/flags", "scenes=" + campScenes.length + " branches=" + branches.join(",") + " endings=" + endings.join(","));
  else fail("B6: кампанийные диалоги", "scenes=" + campScenes.length + " branches=" + branches.join(",") + " endings=" + endings.join(","));
} catch (e) { fail("кампанийные диалоги", String(e)); }

// ---------------------------------------------------------------- B6 runtime: кампанийные диалоги меняют flags/branch/ending
try {
  const playCampaignScene = (w, scene) => {
    const before = sim.getDlcState(w).seenScenes.length;
    const started = sim.maybeStartCampaignDialogue(w);
    const st = sim.getDlcState(w).dialogue;
    const isScene = st?.sceneId === scene && st?.context === "campaign";
    playDialogue(w);
    return { started: started?.ok, isScene, before, seen: sim.getDlcState(w).seenScenes.includes(scene), consequences: sim.getDlcConsequences(w).length, campaignFlags: Object.keys(w.fg.campaign?.flags ?? {}).filter((f) => f.includes("dlc") || f.includes("camp") || f.includes("branch") || f.includes("ending")) };
  };
  const w = world(71);
  w.fg.campaign.act = 2;
  const act2 = playCampaignScene(w, "dlg_campaign_act2");
  const repeat = sim.maybeStartCampaignDialogue(w);
  if (act2.started && act2.isScene && act2.seen && act2.consequences > 0 && act2.campaignFlags.length > 0 && repeat === null) pass("B6 runtime: act2 диалог → consequences/flags, one-shot", JSON.stringify({ consequences: act2.consequences, campFlags: act2.campaignFlags.slice(0, 6) }));
  else fail("B6 runtime act2", JSON.stringify({ act2, repeat }));
  // ветка: требует решённой branch; ставим branch и запускаем branch-сцену
  w.fg.campaign.branch = "federation";
  const branch = playCampaignScene(w, "dlg_campaign_branch");
  const branchFlags = Object.keys(w.fg.campaign?.flags ?? {}).filter((f) => f.includes("branch") || f.includes("camp_branch"));
  if (branch.started && branch.isScene && branch.seen && branchFlags.length > 0) pass("B6 runtime: branch-диалог → branch flags", branchFlags.slice(0, 6).join(","));
  else fail("B6 runtime branch", JSON.stringify({ branch, branchFlags }));
  // финал: акт 5
  w.fg.campaign.act = 5;
  const fin = playCampaignScene(w, "dlg_campaign_finale");
  const endings = [...new Set([...(w.fg.campaign?.endings ?? []), ...Object.keys(w.fg.campaign?.flags ?? {}).filter((f) => f.includes("ending")).map((f) => f)])];
  if (fin.started && fin.isScene && fin.seen && endings.length > 0) pass("B6 runtime: finale-диалог → ending hint", endings.slice(0, 5).join(","));
  else fail("B6 runtime finale", JSON.stringify({ fin, endings }));
  // варианты меняют campaign flags (две ветки act2)
  const w2 = world(71); w2.fg.campaign.act = 2;
  sim.maybeStartCampaignDialogue(w2);
  playDialogue(w2, ["diplo_first", "trust_counselor"]);
  const flags2 = Object.keys(w2.fg.campaign?.flags ?? {});
  if (flags2.includes("camp_diplo_first") && flags2.includes("camp_trust_counselor")) pass("B6: выборы act2 меняют campaign flags", flags2.filter((f) => f.includes("camp_")).join(","));
  else fail("B6: выборы act2 campaign flags", flags2.filter((f) => f.includes("camp_")).join(","));
} catch (e) { fail("B6 runtime", String(e)); }

const counts = { PASS: 0, FAIL: 0, INFO: 0, SKIP: 0 };
for (const r of results) counts[r.status]++;
if (AS_JSON) console.log(JSON.stringify({ counts, results }, null, 2));
else console.log("\nИТОГ: PASS=" + counts.PASS + " FAIL=" + counts.FAIL + " INFO=" + counts.INFO + " SKIP=" + counts.SKIP);
if (counts.FAIL > 0) process.exitCode = 1;