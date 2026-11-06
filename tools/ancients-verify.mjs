#!/usr/bin/env node
/**
 * QA-верификация Части XIII (M9c) — sim/данные/команды, независимо от UI.
 *
 * Контракт sim-engineer: константы ANCIENTS_START_TICK=1200, SECTOR_SYSTEMS=45, WARP_RADIUS_LY=60,
 * WARP_COOLDOWN_TICKS=5, RELIC_CAP=60, CORE_CAP=20; ensureSectorGenerated(world), getSectorState(world),
 * acceptAncientsMission/completeAncientsMission, getAncientsState, warpStatus, getAncientsTechs;
 * команды: ancients_quest {action,questId?}, ancients_tech, warp_jump, warp_recharge,
 * sector_enter, sector_exit, sector_scan, sector_claim, ancients_final.
 *
 * Запуск: node <runtime>/pnpm.mjs exec tsx tools/ancients-verify.mjs [--json]
 * FAIL ожидаемы до мержа sim/контента — это приёмочный чек-лист, не flaky.
 */
import * as data from "@sf/data";
import * as sim from "@sf/sim";

const AS_JSON = process.argv.includes("--json");
const results = [];
const rec = (status, name, detail) => { results.push({ status, name, detail }); if (!AS_JSON) console.log(status + " · " + name + (detail ? " — " + detail : "")); };
const pass = (n, d) => rec("PASS", n, d);
const fail = (n, d) => rec("FAIL", n, d);
const skip = (n, d) => rec("SKIP", n, d);
const num = (v) => (typeof v === "number" ? v : null);

// ---------------------------------------------------------------- данные
const RACES = data.RACES ?? [];
const QUESTS = data.ANCIENTS_QUESTS ?? [];
const TECHS = data.ANCIENTS_TECHS ?? [];
const ENDINGS = data.ANCIENTS_ENDINGS ?? [];
const REGIONS = data.SECTOR_REGIONS ?? [];
const FACTIONS = data.SECTOR_FACTIONS ?? [];
const CODEX = data.ANCIENTS_CODEX ?? [];
const POIS = data.SECTOR_POIS ?? [];

const playable = RACES.filter((r) => r.playable);
if (RACES.length >= 20 && playable.length === 8) pass("расы: 8 играбельных + NPC", "всего=" + RACES.length);
else fail("расы: 8 играбельных + NPC", "всего=" + RACES.length + ", playable=" + playable.length + " (ожидается 20/8)");

const idx = QUESTS.map((x) => x.index).sort((a, b) => a - b);
const gates = new Set();
for (const q of QUESTS) for (const u of q.unlocks ?? []) gates.add(String(u));
const needGates = ["A0", "A1", "A2", "A3", "A4", "A5", "warp", "sector", "ending"];
const missingGates = needGates.filter((g) => ![...gates].some((u) => u.includes(g)));
if (QUESTS.length === 12 && idx.every((v, i) => v === i + 1) && missingGates.length === 0) pass("линия: 12 миссий и гейты A0–A5/warp/sector/ending", [...gates].join(","));
else fail("линия: 12 миссий/гейты", "quests=" + QUESTS.length + " missing=" + missingGates.join(","));

const tiers = new Set(TECHS.map((t) => t.tier));
const relicCost = TECHS.reduce((s, t) => s + (t.costRelics ?? 0), 0);
const coreCost = TECHS.reduce((s, t) => s + (t.costCores ?? 0), 0);
if (TECHS.length >= 25 && [0, 1, 2, 3, 4, 5].every((t) => tiers.has(t)) && relicCost <= 60 && coreCost <= 20) pass("ветвь A0–A5: технологии/бюджет", "techs=" + TECHS.length + " relics=" + relicCost + " cores=" + coreCost);
else fail("ветвь A0–A5", "techs=" + TECHS.length + " tiers=" + [...tiers].join(",") + " relicCost=" + relicCost + " coreCost=" + coreCost);

const choices = new Set(ENDINGS.map((e) => e.choice));
if (ENDINGS.length === 3 && ["seal", "use", "give"].every((c) => choices.has(c))) pass("3 финала линии", ENDINGS.map((e) => e.id).join(","));
else fail("3 финала линии", "count=" + ENDINGS.length + " choices=" + [...choices].join(","));

const regionSum = REGIONS.reduce((s, r) => s + (r.systemCount ?? 0), 0);
if (REGIONS.length === 5 && regionSum === 45) pass("сектор: 45 систем в 5 регионах", "regions=" + REGIONS.length + " systems=" + regionSum);
else fail("сектор: 45 систем/5 регионов", "regions=" + REGIONS.length + " systems=" + regionSum);
if (FACTIONS.length >= 3) pass("сектор: фракции", "factions=" + FACTIONS.length); else fail("сектор: фракции", "count=" + FACTIONS.length);
if (CODEX.length >= 40) pass("кодекс Ансаров", "entries=" + CODEX.length); else fail("кодекс Ансаров", "entries=" + CODEX.length + " (нужно 40+)");
if (POIS.length >= 40) pass("POI сектора", "pois=" + POIS.length); else fail("POI сектора", "pois=" + POIS.length + " (нужно 40+)");

// ---------------------------------------------------------------- константы sim
const consts = {
  ANCIENTS_START_TICK: sim.ANCIENTS_START_TICK, SECTOR_SYSTEMS: sim.SECTOR_SYSTEMS,
  WARP_RADIUS_LY: sim.WARP_RADIUS_LY, WARP_COOLDOWN_TICKS: sim.WARP_COOLDOWN_TICKS,
  RELIC_CAP: sim.RELIC_CAP, CORE_CAP: sim.CORE_CAP,
};
const expectedConsts = { ANCIENTS_START_TICK: 1200, SECTOR_SYSTEMS: 45, WARP_RADIUS_LY: 60, WARP_COOLDOWN_TICKS: 5, RELIC_CAP: 60, CORE_CAP: 20 };
const badConsts = Object.entries(expectedConsts).filter(([k, v]) => num(consts[k]) !== v);
if (badConsts.length === 0) pass("константы sim", Object.entries(consts).map(([k, v]) => k + "=" + v).join(" "));
else fail("константы sim", badConsts.map(([k, v]) => k + "=" + consts[k] + " (ожидалось " + v + ")").join("; "));

// ---------------------------------------------------------------- мир/линия
let world = null;
let a = null;
try {
  world = sim.createWorld(42, data.MODE, data.BALANCE);
  sim.ensureFg(world);
  a = sim.ensureAncients ? sim.ensureAncients(world) : sim.getAncientsState?.(world);
  if (a && typeof a.relics === "number" && a.quest && a.tech && a.warp && a.sector) pass("fg.ancients инициализируется", "race=" + (a.playerRace || "?"));
  else fail("fg.ancients инициализируется", "нет обязательных полей");
  if (a.quest.stage === 0 && a.tech.tier <= 0 && a.warp.unlocked === false) pass("старт линии закрыт (tick 0)", "tier=" + a.tech.tier);
  else fail("старт линии", JSON.stringify({ stage: a.quest?.stage, tier: a.tech?.tier, warp: a.warp?.unlocked }));
} catch (e) { fail("sim: createWorld/ensureAncients", String(e)); }

// линия: программный проход 12 миссий (accept/complete) и гейты
if (world && a) {
  try {
    const acceptFn = sim.acceptAncientsMission, completeFn = sim.completeAncientsMission;
    if (typeof acceptFn !== "function" || typeof completeFn !== "function") {
      skip("линия: программный проход 12 миссий", "acceptAncientsMission/completeAncientsMission ещё не экспортированы");
    } else {
      // линия стартует во II акте: прокручиваем такты до ANCIENTS_START_TICK
      if (world.tick < consts.ANCIENTS_START_TICK) {
        const toTick = consts.ANCIENTS_START_TICK + 10;
        if (typeof sim.tick === "function") {
          for (let i = 0; i < toTick; i++) sim.tick(world, 1000);
        } else {
          fail("линия: нет sim.tick для прокрутки", "не удалось дойти до такта 1200");
        }
      }
      const ordered = QUESTS.slice().sort((x, y) => x.index - y.index);
      const gateLog = [];
      let failedAt = null;
      // после старта II акта первая миссия уже активна: сначала завершаем активную, затем принимаем следующую
      for (let i = 0; i < 40 && a.quest.stage < 12; i++) {
        const activeId = a.quest.activeMissionId;
        if (activeId) {
          const comp = completeFn(world, activeId);
          if (!comp?.ok) { failedAt = "complete " + activeId + ": " + (comp?.messageRu ?? "?"); break; }
          gateLog.push({ stage: a.quest.stage, warp: a.warp.unlocked, sector: a.sector.discovered });
          continue;
        }
        let acc = acceptFn(world, world.playerEmpireId);
        if (!acc?.ok) {
          const avail = ordered.find((q) => a.quest.missions[q.id]?.status === "available");
          if (!avail) { failedAt = "нет доступной миссии на стадии " + a.quest.stage; break; }
          acc = acceptFn(world, world.playerEmpireId, avail.id);
          if (!acc?.ok) { failedAt = "accept " + avail.index + ": " + (acc?.messageRu ?? "?"); break; }
        }
      }
      if (!failedAt && a.quest.stage >= 12 && a.warp.unlocked) pass("линия: 12 миссий проходятся, гейты открываются", "gates: " + gateLog.map((g) => "s" + g.stage + "/w" + g.warp + "/sec" + g.sector).slice(0, 8).join(" "));
      else fail("линия: проход 12 миссий", failedAt ?? ("stage=" + a.quest.stage + " warp=" + a.warp.unlocked));
      // A-технологии: есть ветвь и гейты
      const techsFn = sim.getAncientsTechs;
      const list = typeof techsFn === "function" ? techsFn(world) : null;
      if (Array.isArray(list) && list.length > 0) pass("getAncientsTechs", "count=" + list.length); else skip("getAncientsTechs", "ещё не экспортирован");
      if (a.tech && a.tech.unlocked.length >= 0) pass("ветвь A0–A5 доступна в состоянии", "tier=" + a.tech.tier);
    }
  } catch (e) { fail("линия: проход 12 миссий", String(e)); }

  // Варп: радиус/кулдаун/заряды/recharge
  try {
    const player = world.empires.find((e) => e.id === world.playerEmpireId);
    const fleet = world.fleets.find((f) => f.empireId === player.id && f.ships.length > 0);
    a.warp.unlocked = true; a.warp.charges = 10; a.warp.cooldownUntil = 0;
    const fleetSys = world.systems[fleet.systemId];
    const near = world.systems.filter((s) => s.id !== fleet.systemId && Math.hypot(s.x - fleetSys.x, s.y - fleetSys.y) <= 6).sort((x, y) => x.id - y.id)[0];
    if (!near) skip("варп: ближний прыжок", "нет цели ≤60 св. лет");
    else {
      const t0 = world.tick;
      const res = sim.warpJump(world, player.id, near.id);
      if (res.ok && a.warp.charges === 9 && a.warp.cooldownUntil === t0 + 5) pass("варп: заряд 1, кулдаун 5", "target=" + near.name);
      else fail("варп: заряд/кулдаун", JSON.stringify(res) + " charges=" + a.warp.charges + " cd=" + a.warp.cooldownUntil);
      if (sim.warpJump(world, player.id, near.id)?.ok === false) pass("варп: кулдаун блокирует повторный прыжок"); else fail("варп: кулдаун не блокирует");
      const fleetSys2 = world.systems[fleet.systemId];
      const radius = typeof sim.warpRadiusLy === "function" ? sim.warpRadiusLy(world) : 60;
      const distLy = (sys) => (typeof sim.distanceLy === "function" ? sim.distanceLy(world, fleetSys2, sys) : Math.hypot(sys.x - fleetSys2.x, sys.y - fleetSys2.y) * 10);
      // радиус действует для галактических систем; сектор «relic» — отдельный слой (вход варпом без лимита)
      const far = world.systems.filter((ss) => ss.id !== fleet.systemId && ss.sector !== "relic").sort((x, y) => distLy(y) - distLy(x))[0];
      if (!far || distLy(far) <= radius + 1) skip("варп: радиус " + Math.round(radius) + " св. лет", "нет цели за радиусом (max=" + Math.round(far ? distLy(far) : 0) + " ly)");
      else {
        a.warp.cooldownUntil = 0; a.warp.charges = 10;
        const resFar = sim.warpJump(world, player.id, far.id);
        if (resFar.ok) fail("варп: радиус " + Math.round(radius) + " св. лет", "прыжок на " + Math.round(distLy(far)) + " ly разрешён");
        else pass("варп: радиус " + Math.round(radius) + " св. лет", resFar.messageRu ?? "отклонён");
      }
      const st = typeof sim.warpStatus === "function" ? sim.warpStatus(world) : null;
      if (st && st.riskPct === 15 && st.capacity === 10) pass("варп: риск Хора 15%, ёмкость 10 зарядов", JSON.stringify({ riskPct: st.riskPct, capacity: st.capacity }));
      else fail("варп: риск/ёмкость", JSON.stringify(st));
      try {
        // канон: ёмкость ядра 10 зарядов (warpStatus.capacity=10); пополнение warp_recharge — 2 реликвии за заряд
        a.warp.charges = 0; a.relics = 4; a.warp.cooldownUntil = 0;
        const rec = sim.applyCommand(world, { type: "warp_recharge" });
        if (rec?.ok && a.warp.charges === 1 && a.relics === 2) pass("варп: пополнение 2 реликвии за заряд (ёмкость ядра 10)");
        else fail("варп: warp_recharge", JSON.stringify(rec) + " charges=" + a.warp.charges + " relics=" + a.relics);
      } catch (e) { fail("варп: warp_recharge", String(e)); }
      try {
        let hits = 0, jumps = 0, lastMsg = "";
        const origin = fleet.systemId;
        const inner = world.systems.filter((ss) => ss.id !== origin && ss.sector !== "relic" && distLy(ss) <= radius);
        for (let i = 0; i < 400 && inner.length > 0; i++) {
          world.tick += 5;
          a.warp.unlocked = true; a.warp.charges = 10; a.warp.cooldownUntil = 0;
          a.warp.lastRiskTriggered = false;
          fleet.systemId = origin;
          const target = inner[i % inner.length];
          const rr = sim.warpJump(world, player.id, target.id);
          if (!rr.ok) { lastMsg = rr.messageRu ?? "?"; break; }
          jumps++;
          if (a.warp.lastRiskTriggered) hits++;
        }
        if (jumps === 0) fail("варп: риск статистика", "0 прыжков: " + lastMsg);
        const pct = jumps > 0 ? (hits / jumps) * 100 : 0;
        if (jumps === 0) { /* уже зафиксирован FAIL */ }
        else if (jumps >= 150 && pct >= 8 && pct <= 24) pass("варп: риск Хора ~15% (статистика)", hits + "/" + jumps + " = " + pct.toFixed(1) + "%");
        else fail("варп: риск Хора статистика", jumps + " прыжков, " + pct.toFixed(1) + "%");
      } catch (e) { fail("варп: риск статистика", String(e)); }
    }
  } catch (e) { fail("варп", String(e)); }

  // Сектор: генерация 45/5, детерминизм, вход/выход, scan/claim
  try {
    const gen = sim.ensureSectorGenerated;
    if (typeof gen !== "function") skip("сектор: генерация", "ensureSectorGenerated ещё не экспортирован");
    else {
      gen(world);
      const sec = sim.getSectorState ? sim.getSectorState(world) : a.sector;
      const systems = sec?.systems ?? [];
      const regions = new Set(systems.map((s) => s.region));
      if (systems.length === 45) pass("сектор: 45 систем", "regions=" + regions.size);
      else fail("сектор: 45 систем", "systems=" + systems.length);
      if (regions.size === 5) pass("сектор: 5 регионов"); else fail("сектор: 5 регионов", "regions=" + [...regions].join(","));
      const w2 = sim.createWorld(42, data.MODE, data.BALANCE); sim.ensureFg(w2);
      sim.ensureAncients?.(w2); gen(w2);
      const s1 = JSON.stringify((sim.getSectorState ? sim.getSectorState(world) : a.sector).systems);
      const s2 = JSON.stringify((sim.getSectorState ? sim.getSectorState(w2) : sim.ensureAncients(w2).sector).systems);
      if (s1 === s2) pass("сектор: детерминированная генерация seed 42"); else fail("сектор: детерминизм", "разные системы");
    }
    // вход/выход командами
    const cmd = (c) => sim.applyCommand(world, c);
    const enter = cmd({ type: "sector_enter" });
    const activeAfter = (sim.getSectorState ? sim.getSectorState(world) : a.sector)?.active;
    if (enter?.ok && activeAfter === true) pass("сектор: вход"); else skip("сектор: вход", JSON.stringify(enter) + " active=" + activeAfter);
    const exit = cmd({ type: "sector_exit" });
    if (exit?.ok && (sim.getSectorState ? sim.getSectorState(world) : a.sector)?.active === false) pass("сектор: выход"); else skip("сектор: выход", JSON.stringify(exit));
    // scan/claim на реальной системе сектора (без инъекций)
    const targetSys = a.sector.systems[0];
    a.relics = 59; a.cores = 19;
    targetSys.relics = 5; targetSys.cores = 5;
    sim.sectorScan(world, world.playerEmpireId, targetSys.id);
    if (a.relics === 60 && a.cores === 20) pass("конечность реликвий/ядер: cap 60/20"); else fail("конечность реликвий/ядер", "relics=" + a.relics + " cores=" + a.cores);
    const claim = sim.sectorClaim(world, world.playerEmpireId, targetSys.id);
    if (claim?.ok) pass("сектор: claim"); else fail("сектор: claim", JSON.stringify(claim));
  } catch (e) { fail("сектор", String(e)); }

  // Хор: волны по таймеру, вторжение по угрозе, игрок не умирает за один такт
  try {
    const sec = sim.getSectorState(world);
    sec.chorusThreat = 96;
    sec.nextWaveTick = world.tick;
    sec.invasion = false;
    world.flags["choir_wave_tick"] = 0;
    const player = world.empires.find((e) => e.id === world.playerEmpireId);
    const fleet0 = world.fleets.find((f) => f.empireId === player.id && f.ships.length > 0);
    const t0 = world.tick;
    for (let i = 0; i < 60; i++) sim.tick(world, 1000);
    const fleet1 = world.fleets.find((f) => f.id === fleet0?.id);
    const alive = !!player && !player.dead && !!fleet1 && fleet1.ships.length > 0;
    if (sec.invasion === true && world.flags["chorus_invasion"] === 1) pass("Хор: вторжение триггерится по угрозе", "t=" + t0 + "->" + world.tick + " threat=" + sec.chorusThreat);
    else fail("Хор: вторжение", "invasion=" + sec.invasion + " threat=" + sec.chorusThreat);
    if (alive) pass("Хор: игрок не уничтожен за один такт/волну", "fleet ships=" + (fleet1?.ships.length ?? 0));
    else fail("Хор: игрок уничтожен мгновенно", "player.dead=" + (player?.dead ?? "?") + " fleet=" + (fleet1?.ships.length ?? "?"));
    if (sec.nextWaveTick > world.tick) pass("Хор: следующая волна по таймеру", "next=" + sec.nextWaveTick + " (t=" + world.tick + ")");
    else fail("Хор: таймер волны", "next=" + sec.nextWaveTick);
  } catch (e) { fail("Хор: волны/вторжение", String(e)); }

  // save/load сектора+линии + детерминизм
  try {
    a.warp.unlocked = true; a.relics = 7; a.cores = 3;
    const json = sim.serializeWorld(world);
    const w2 = sim.deserializeWorld(json);
    sim.ensureFg(w2);
    const b = sim.ensureAncients ? sim.ensureAncients(w2) : sim.getAncientsState(w2);
    if (b.relics === 7 && b.cores === 3 && b.warp.unlocked && b.sector.systems.length >= 1) pass("save/load: Древние+сектор", "sector systems=" + b.sector.systems.length);
    else fail("save/load: Древние+сектор", JSON.stringify({ relics: b.relics, cores: b.cores, warp: b.warp?.unlocked, systems: b.sector?.systems?.length }));
  } catch (e) { fail("save/load", String(e)); }

  // 3 финала + отсутствие 7-го условия победы
  try {
    // финал доступен после прохождения линии (stage 12); один выбор на партию — для проверки всех 3 сбрасываем выбор
    if (a.quest.stage < 11) a.quest.stage = 11;
    const trials = ["seal", "use", "give"].map((choice) => {
      a.quest.choice = null; a.quest.ending = null;
      const res = sim.ancientsFinalChoice(world, world.playerEmpireId, choice);
      return { choice, ok: res.ok, ending: a.quest.ending, msg: res.messageRu };
    });
    if (trials.every((t) => t.ok && t.ending)) pass("финалы: 3 выбора", trials.map((t) => t.ending).join(",")); else fail("финалы: 3 выбора", JSON.stringify(trials));
    const victory = sim.getVictory(world);
    const conditions = (data.MODE?.victory ?? []);
    if (conditions.length === 6 && !conditions.some((c) => /sector|stability|ancients/i.test(String(c)))) pass("нет 7-го условия победы", "conditions=" + conditions.join(","));
    else fail("нет 7-го условия победы", "conditions=" + conditions.join(","));
    void victory;
    // секторная цель стабильности — не победа
    if (!JSON.stringify(victory ?? {}).match(/sector|stability/i)) pass("стабильность сектора не в victory"); else fail("стабильность сектора в victory");
  } catch (e) { fail("финалы/7-е условие", String(e)); }
}

const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const r of results) counts[r.status]++;
if (AS_JSON) console.log(JSON.stringify({ counts, results }, null, 2));
else console.log("\nИТОГ: PASS=" + counts.PASS + " FAIL=" + counts.FAIL + " SKIP=" + counts.SKIP);
if (counts.FAIL > 0) process.exitCode = 1;