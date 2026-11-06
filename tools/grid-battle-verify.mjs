#!/usr/bin/env node
/**
 * Headless-верификатор M5b @sf/battle-grid (UI-независимый):
 * данные, S30 deploy 7+3, S31 AI-бой, S32 результат, детерминизм/replay/save.
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/grid-battle-verify.mjs
 */
import * as data from "@sf/data";
import * as grid from "../packages/battle-grid/src/index.ts";

const results = [];
const rec = (s, n, d) => { results.push({ status: s, name: n, detail: d }); console.log(s + " · " + n + (d ? " — " + d : "")); };
const pass = (n, d) => rec("PASS", n, d);
const fail = (n, d) => rec("FAIL", n, d);

const classes = (data.BATTLE_CLASSES ?? []).map((c) => c.id);
console.log("classes", classes.length, "abilities", (data.BATTLE_ABILITIES ?? []).length, "terrain", (data.BATTLE_TERRAIN ?? []).length, "profiles", (data.BATTLE_AI_PROFILES ?? []).length, "scenarios", (data.BATTLE_SCENARIOS ?? []).length);
if ((data.BATTLE_CLASSES ?? []).length === 8 && (data.BATTLE_ABILITIES ?? []).length === 16 && (data.BATTLE_TERRAIN ?? []).length === 6 && (data.BATTLE_SCENARIOS ?? []).length === 3) pass("данные M5b: 8 классов/16 способностей/6 террейнов/3 сценария");
else fail("данные M5b", "counts не совпали");

function side(empireId, fleetId, ids) {
  return { empireId, fleetId, stacks: ids.map((classId, i) => ({ classId, count: i === 0 ? 7 : 3 })), morale: 0, luck: 0 };
}
function battle(seed) {
  const a = side(1, 11, [classes[0], classes[1]]);
  const b = side(2, 22, [classes[2], classes[3]]);
  return grid.createBattle({ seed, battleId: "qa_" + seed, attacker: a, defender: b });
}
function deploy(s) {
  let st = grid.autoDeploy(s, "A", "line");
  st = grid.autoDeploy(st, "B", "line");
  return st;
}
try {
  let st = deploy(battle(12345));
  const stacks = st.stacks ?? st.units ?? [];
  const aStacks = stacks.filter((x) => x.side === "A");
  if (st.deployment.A === true && aStacks.length >= 2) pass("S30 deploy: A расставлен, стеки", "A=" + aStacks.length + " B=" + stacks.filter((x) => x.side === "B").length);
  else fail("S30 deploy", JSON.stringify({ dep: st.deployment, stacks: stacks.length }));
  st = grid.startBattle(st);
  const phase = st.phase ?? st.state;
  if (phase === "rounds" || phase === "deployment") pass("S30→S31: startBattle", String(phase));
  else fail("startBattle", String(phase));
  st = grid.autoPlayBattle(st, {});
  const res = grid.battleResult(st);
  if (res && res.losses && res.losses.A && res.replayHash && Array.isArray(res.log)) pass("S31→S32: losses/replayHash/log", "outcome=" + res.outcome + " rounds=" + res.rounds);
  else fail("S32 result", JSON.stringify(res).slice(0, 300));
  // детерминизм: одинаковый seed и тот же AI-прогон → одинаковый replayHash/hash
  const st2 = grid.autoPlayBattle(grid.startBattle(deploy(battle(12345))), {});
  if (grid.battleResult(st2).replayHash === res.replayHash && grid.battleStateHash(st2) === grid.battleStateHash(st)) pass("детерминизм seed 12345: replayHash/hash совпадают", res.replayHash);
  else fail("детерминизм", JSON.stringify({ h1: res.replayHash, h2: grid.battleResult(st2).replayHash }));
  // save/load
  const json = grid.serializeBattle(st2);
  const loaded = grid.deserializeBattle(json);
  if (grid.battleStateHash(loaded) === grid.battleStateHash(st2)) pass("save/load: battleStateHash идентичен");
  else fail("save/load", "hash отличается");
} catch (e) { fail("M5b battle flow", String(e)); }

try {
  // sim-контракт M5b: grid_battle ON по умолчанию, legacy-отключение world.flags.grid_battle=0
  const w = { flags: {}, fleets: [] };
  const on = grid.isGridBattleEnabled(w);
  w.flags.grid_battle = 0;
  const off = grid.isGridBattleEnabled(w);
  const elig = grid.battleEligibility(w, 999, 1000);
  if (on === true && off === false && elig.eligible === false) pass("feature flag: sim default ON, legacy 0 OFF, eligibility guard", elig.reason);
  else fail("feature flag", JSON.stringify({ on, off, elig }));
} catch (e) { fail("feature flag", String(e)); }

const counts = { PASS: 0, FAIL: 0 };
for (const r of results) counts[r.status]++;
console.log("\nИТОГ: PASS=" + counts.PASS + " FAIL=" + counts.FAIL);
if (counts.FAIL > 0) process.exitCode = 1;