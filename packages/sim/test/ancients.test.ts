import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import {
  ANCIENTS_START_TICK, CORE_CAP, RELIC_CAP, SECTOR_SYSTEMS, WARP_COOLDOWN_TICKS, WARP_RADIUS_LY,
  acceptAncientsMission, addCores, addRelics, advanceAncientsLine, ancientsFinalChoice, ancientsPhase,
  ancientsResearchTech, completeAncientsMission, createWorld, distanceLy, ensureAncients,
  ensureQuestSystems, ensureSectorGenerated, getAncientsState, getAncientsTechs, getRaceChoices,
  applyCommand, empireModifiers, sectorClaim, sectorScan, serializeWorld, deserializeWorld,
  setPlayerRace, tick, warpJump, warpStatus,
} from "../src/index";
import { applyEffect, neutralModifiers } from "../src/modifiers";
import type { World } from "../src/index";

function makeWorld(raceId?: string): World {
  return createWorld(42, MODE, BALANCE, raceId ? { raceId } : undefined);
}

function runLineToEnd(world: World): void {
  world.tick = ANCIENTS_START_TICK;
  ancientsPhase(world);
  for (let i = 0; i < 14; i++) {
    const result = completeAncientsMission(world);
    if (!result.ok) break;
    advanceAncientsLine(world);
  }
}

describe("Часть XIII · расы и трейты", () => {
  it("выбор расы: playable-список, стартовые бонусы, расы ИИ", () => {
    const choices = getRaceChoices();
    expect(choices.length).toBeGreaterThanOrEqual(8);
    const world = makeWorld("race_drakar");
    const a = ensureAncients(world);
    expect(a.playerRace).toBe("race_drakar");
    expect(world.empires[0].resources.alloys).toBeGreaterThanOrEqual(60 + 50);
    expect(a.races[2]).toBeTruthy();
    expect(typeof a.races[2]).toBe("string");
    // смена расы до старта
    const set = setPlayerRace(world, 1, "race_velan");
    expect(set.ok, set.messageRu).toBe(true);
    expect(ensureAncients(world).playerRace).toBe("race_velan");
    // после старта — нельзя
    world.tick = 5;
    expect(setPlayerRace(world, 1, "race_drakar").ok).toBe(false);
  });

  it("трейты влияют на empireModifiers (eco_industrial: +10% сплавов)", () => {
    const world = makeWorld("race_ultar");
    const mods = empireModifiers(world, 1);
    expect(mods.production.alloys).toBeGreaterThan(1);
    expect(mods.special).toBeTypeOf("object");
  });

  it("дефолтная раса даёт стартовые бонусы (Вэланты: +1 колонизатор, +20 ТП)", () => {
    const world = makeWorld("race_velan");
    expect(ensureAncients(world).playerRace).toBe("race_velan");
    expect(world.empires[0].resources.goods).toBe(40 + 20);
    const colonizers = world.fleets.flatMap((fleet) => fleet.ships).filter((ship) => ship.classId === "colonizer");
    expect(colonizers.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Часть XIII · линия 12 миссий и гейты", () => {
  it("старт только во II акте (tick 1200), 12 миссий, идемпотентность", () => {
    const world = makeWorld();
    const a = ensureAncients(world);
    world.tick = 900;
    ancientsPhase(world);
    expect(a.quest.activeMissionId).toBeNull();
    world.tick = ANCIENTS_START_TICK;
    ancientsPhase(world);
    expect(a.quest.activeMissionId).not.toBeNull();
    const activeId = a.quest.activeMissionId;
    ancientsPhase(world);
    ancientsPhase(world);
    expect(a.quest.activeMissionId).toBe(activeId);
    // принудительное прохождение всей линии
    runLineToEnd(world);
    expect(a.quest.stage).toBe(12);
    expect(a.flags["ansari_unlock_A0"]).toBe(1);
    expect(a.flags["ansari_unlock_A5"]).toBe(1);
    expect(a.flags["unlock:warp"]).toBe(1);
    expect(a.flags["unlock:sector"]).toBe(1);
    expect(a.warp.unlocked).toBe(true);
    expect(a.sector.discovered).toBe(true);
    // повторное завершение невозможно (идемпотентность наград)
    expect(completeAncientsMission(world).ok).toBe(false);
    const relicsBefore = a.relics;
    ancientsPhase(world);
    expect(a.relics).toBe(relicsBefore);
  });

  it("3 финала линии: seal/use/give и идемпотентность выбора", () => {
    for (const choice of ["seal", "use", "give"] as const) {
      const world = makeWorld();
      runLineToEnd(world);
      const result = ancientsFinalChoice(world, 1, choice);
      expect(result.ok, result.messageRu).toBe(true);
      const a = ensureAncients(world);
      expect(a.quest.choice).toBe(choice);
      expect(a.quest.ending).toBeTruthy();
      expect(a.flags["ending:" + a.quest.ending]).toBe(1);
      expect(ancientsFinalChoice(world, 1, "use").ok).toBe(false);
    }
  });
});

describe("Часть XIII · технологии A0–A5", () => {
  it("гейты по миссиям, стоимость, лимиты 60/20, эффекты", () => {
    const world = makeWorld();
    const a = ensureAncients(world);
    addRelics(world, a, 100);
    expect(a.relics).toBe(RELIC_CAP);
    addCores(world, a, 30);
    expect(a.cores).toBe(CORE_CAP);
    // без линии A-техи закрыты
    const before = getAncientsTechs(world);
    expect(before.every((view) => !view.available)).toBe(true);
    runLineToEnd(world);
    addRelics(world, a, 60);
    addCores(world, a, 10);
    const opened: string[] = [];
    for (let pass = 0; pass < 4; pass++) {
      for (const view of getAncientsTechs(world)) {
        const result = ancientsResearchTech(world, 1, view.def.id);
        if (result.ok) opened.push(view.def.id);
      }
    }
    expect(opened.length).toBeGreaterThanOrEqual(20);
    expect(a.tech.tier).toBeGreaterThanOrEqual(4);
    expect(a.warp.unlocked).toBe(true);
    expect(a.tech.unlocked.length).toBeGreaterThanOrEqual(20);
  });
});

describe("Часть XIII · варп", () => {
  it("радиус 60 св. лет, заряды, кулдаун 5, секторная цель", () => {
    const world = makeWorld();
    runLineToEnd(world);
    const a = ensureAncients(world);
    a.warp.charges = 10;
    world.tick = 1400;
    const fleet = world.fleets.find((entry) => entry.empireId === 1 && entry.ships.length > 0)!;
    const origin = world.systems[fleet.systemId];
    let near: typeof origin | null = null;
    let far: typeof origin | null = null;
    for (const system of world.systems) {
      if (system.sector === "relic" || system.id === origin.id) continue;
      const distance = distanceLy(world, origin, system);
      if (distance <= WARP_RADIUS_LY) near ??= system;
      else far ??= system;
    }
    expect(near).toBeTruthy();
    expect(far).toBeTruthy();
    const tooFar = warpJump(world, 1, far!.id);
    expect(tooFar.ok).toBe(false);
    expect(tooFar.messageRu).toContain("60");
    const jump = warpJump(world, 1, near!.id);
    expect(jump.ok, jump.messageRu).toBe(true);
    expect(a.warp.charges).toBe(9);
    expect(a.warp.cooldownUntil).toBe(world.tick + WARP_COOLDOWN_TICKS);
    const cooling = warpJump(world, 1, near!.id);
    expect(cooling.ok).toBe(false);
    // статус для HUD
    const status = warpStatus(world);
    expect(status.cooldownTicks).toBe(WARP_COOLDOWN_TICKS);
    expect(status.capacity).toBeGreaterThanOrEqual(10);
    // в сектор
    world.tick += WARP_COOLDOWN_TICKS + 1;
    ensureSectorGenerated(world);
    const sectorTarget = a.sector.gates[0]!;
    const sectorJump = warpJump(world, 1, sectorTarget);
    expect(sectorJump.ok, sectorJump.messageRu).toBe(true);
    // варп-вход в Предел: сектор активен, система посещена, выход сразу доступен
    expect(a.sector.active).toBe(true);
    expect(a.sector.visited).toContain(sectorTarget);
    expect(a.sector.systems.find((system) => system.id === sectorTarget)!.visited).toBe(true);
    const exit = applyCommand(world, { type: "ancients_sector_exit" });
    expect(exit.ok, exit.messageRu).toBe(true);
    expect(a.sector.active).toBe(false);
  });
});

describe("Часть XIII · сектор «Реликтовый Предел»", () => {
  it("45 систем, 5 регионов, отдельный слой, детерминизм и идемпотентность", () => {
    const world = makeWorld();
    const a = ensureAncients(world);
    a.sector.discovered = true;
    const sector = ensureSectorGenerated(world);
    expect(sector.systems.length).toBe(SECTOR_SYSTEMS);
    expect(new Set(sector.systems.map((system) => system.region)).size).toBe(5);
    expect(world.systems.length).toBeGreaterThanOrEqual(SECTOR_SYSTEMS + 240 - 1);
    for (const meta of sector.systems) {
      const system = world.systems[meta.id]!;
      expect(system.sector).toBe("relic");
      expect(system.links).toEqual([]);
    }
    const again = ensureSectorGenerated(world);
    expect(again.systems.length).toBe(SECTOR_SYSTEMS);
    // детерминизм от seed
    const fresh = makeWorld();
    ensureAncients(fresh).sector.discovered = true;
    const other = ensureSectorGenerated(fresh);
    expect(JSON.stringify(other.systems)).toBe(JSON.stringify(sector.systems));
  });

  it("скан/захват, стабильность, волны Хора и сохранение", () => {
    const world = makeWorld();
    runLineToEnd(world);
    const a = ensureAncients(world);
    ensureSectorGenerated(world);
    const target = a.sector.systems[0]!;
    const scan = sectorScan(world, 1, target.id);
    expect(scan.ok, scan.messageRu).toBe(true);
    expect(sectorScan(world, 1, target.id).ok).toBe(false);
    expect(sectorClaim(world, 1, target.id).ok).toBe(true);
    expect(a.sector.systems[0]!.controlled).toBe(true);
    const stability = a.sector.stability;
    a.sector.nextWaveTick = world.tick;
    ancientsPhase(world);
    expect(a.sector.chorusThreat).toBeGreaterThan(0);
    expect(a.sector.stability).toBeLessThanOrEqual(stability);
    // save/load сектора
    const json = serializeWorld(world);
    const loaded = deserializeWorld(json);
    expect(loaded.fg?.ancients.sector.systems.length).toBe(SECTOR_SYSTEMS);
    expect(serializeWorld(loaded)).toBe(json);
    // миграция старого сейва (schemaVersion 1, без новых полей)
    const raw = JSON.parse(json);
    raw.fg.ancients = { schemaVersion: 1, playerRace: "race_velan", quest: {}, tech: {}, warp: {}, factions: {}, codex: [] };
    const migrated = deserializeWorld(JSON.stringify(raw));
    const state = ensureAncients(migrated);
    expect(state.schemaVersion).toBe(2);
    expect(state.stats).toBeTypeOf("object");
    expect(state.sector.systems).toEqual([]);
  });
});

describe("Часть XIII · команды (UI-алиасы) и детерминизм", () => {
  it("ancients_accept_mission/ancients_quest/sector_enter/sector_exit", () => {
    const world = makeWorld();
    ensureAncients(world).sector.discovered = true;
    ensureSectorGenerated(world);
    world.tick = ANCIENTS_START_TICK;
    const accept = applyCommand(world, { type: "ancients_accept_mission", questId: "anc_m01_beacon" });
    expect(accept.ok || accept.messageRu?.includes("актив")).toBe(true);
    const complete = applyCommand(world, { type: "ancients_quest", action: "complete", questId: "anc_m01_beacon" });
    expect(complete.ok, complete.messageRu).toBe(true);
    const enter = applyCommand(world, { type: "ancients_sector_enter" });
    expect(enter.ok, enter.messageRu).toBe(true);
    const exit = applyCommand(world, { type: "ancients_sector_exit" });
    expect(exit.ok, exit.messageRu).toBe(true);
  });

  it("детерминизм: два мира seed 42 и 10 тактов после старта линии", () => {
    const run = (): string => {
      const world = makeWorld();
      world.tick = ANCIENTS_START_TICK - 5;
      for (let i = 0; i < 10; i++) tick(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  });

  it("роли систем линии назначаются детерминированно и сохраняются", () => {
    const world = makeWorld();
    ensureQuestSystems(world);
    const roles = world.systems.filter((system) => system.role).map((system) => system.role);
    expect(roles.length).toBeGreaterThanOrEqual(8);
    expect(new Set(roles).size).toBe(roles.length);
    const loaded = deserializeWorld(serializeWorld(world));
    expect(loaded.systems.filter((system) => system.role).length).toBe(roles.length);
  });
});
