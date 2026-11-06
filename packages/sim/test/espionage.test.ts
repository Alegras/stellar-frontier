import { describe, expect, it } from "vitest";
import { TECHS } from "@sf/data";
import { hash32 } from "../src/prng";
import { advancedOf, ensureFg, relationKey } from "../src/fullgame";
import {
  applyIntelVisibility, availableOps, ESPIONAGE_COOLDOWN, ESPIONAGE_OP_ORDER, espionageChance,
  espionageCbUntil, espionagePhase, intelLevel, opInfluenceCost, runEspionage, SABOTAGE_TICKS,
} from "../src/espionage";
import type { EspionageOp } from "../src/fullgame";
import { addFleet, firstSystemOf, give, pushOpinion, testWorld } from "./diplo-helpers";

/** Детерминированный тик, на котором исход операции задан (без манипуляций с рандомом). */
function findRollTick(world: ReturnType<typeof testWorld>, empireId: number, targetId: number, op: EspionageOp, wantSuccess: boolean): number {
  const chance = espionageChance(world, empireId, targetId, op);
  const opIndex = ESPIONAGE_OP_ORDER.indexOf(op);
  for (let tick = 1; tick < 5000; tick++) {
    const roll = (hash32(world.seed, tick, empireId * 131 + targetId, opIndex) % 1000) / 1000;
    if ((roll < chance) === wantSuccess) return tick;
  }
  throw new Error("не нашли тик для " + op);
}

function giveTech(world: ReturnType<typeof testWorld>, empireId: number, techId: string): void {
  const empire = world.empires.find((e) => e.id === empireId)!;
  if (!empire.techs.completed.includes(techId)) empire.techs.completed.push(techId);
}

describe("шпионаж: шансы (GDD §12.5)", () => {
  it("P = base + 0.1×intel − 0.2×counter, clamp 0.05..0.95", () => {
    const world = testWorld();
    const base = espionageChance(world, 1, 2, "fleet_recon");
    expect(base).toBeCloseTo(0.75, 2);
    advancedOf(world, 1).intel[2] = 1;
    expect(espionageChance(world, 1, 2, "fleet_recon")).toBeCloseTo(base + 0.1, 2);
    advancedOf(world, 2).intel[1] = 1;
    expect(espionageChance(world, 1, 2, "fleet_recon")).toBeCloseTo(base + 0.1 - 0.2, 2);
    advancedOf(world, 1).intel[2] = 10;
    advancedOf(world, 2).intel[1] = 10;
    expect(espionageChance(world, 1, 2, "fleet_recon")).toBe(0.05);
    advancedOf(world, 1).intel[2] = 5;
    advancedOf(world, 2).intel[1] = 0;
    expect(espionageChance(world, 1, 2, "fleet_recon")).toBe(0.95);
  });

  it("6 операций доступны, стоимость из данных/канона", () => {
    expect(ESPIONAGE_OP_ORDER.length).toBe(6);
    expect(opInfluenceCost("fleet_recon")).toBe(5);
    expect(opInfluenceCost("steal_tech")).toBe(15);
    expect(opInfluenceCost("sabotage")).toBe(10);
    expect(opInfluenceCost("incite")).toBe(20);
    expect(opInfluenceCost("steal_map")).toBe(8);
    expect(opInfluenceCost("assassinate")).toBe(25);
    const world = testWorld();
    expect(availableOps(world, 1).length).toBeGreaterThan(0);
  });
});

describe("шпионаж: операции", () => {
  it("разведка флота: успех даёт уровень разведки и видимость флотов", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    const successTick = findRollTick(world, 1, 2, "fleet_recon", true);
    world.tick = successTick;
    const before = world.empires.find((e) => e.id === 1)!.resources.influence;
    const result = runEspionage(world, 1, 2, "fleet_recon");
    expect(result.ok, result.messageRu).toBe(true);
    expect(result.messageRu).toContain("Успех");
    expect(world.empires.find((e) => e.id === 1)!.resources.influence).toBe(before - 5);
    expect(intelLevel(world, 1, 2)).toBe(1);
    expect(world.flags["intel:1:2"]).toBeGreaterThan(world.tick);
    // видимость чужих флотов появляется в visibleTo
    applyIntelVisibility(world);
    const targetFleet = world.fleets.find((f) => f.empireId === 2);
    if (targetFleet) {
      expect(world.systems[targetFleet.systemId].visibleTo).toContain(1);
    }
  });

  it("провал: −мнение цели, CB у жертвы (GDD §12.5)", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    const failTick = findRollTick(world, 1, 2, "assassinate", false);
    world.tick = failTick;
    const result = runEspionage(world, 1, 2, "assassinate");
    expect(result.ok).toBe(true);
    expect(result.messageRu).toContain("Провал");
    const rel = ensureFg(world).relations[relationKey(1, 2)];
    expect(rel.recentActions).toBeLessThanOrEqual(-40);
    expect(espionageCbUntil(world, 2, 1)).toBeGreaterThan(world.tick);
    // жертва получила CB — AI может объявить войну через declareWar(2,1,"humiliation")
    expect(world.flags["cb:2:1"]).toBeDefined();
  });

  it("кулдаун: 1 операция за 50 тактов", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    world.tick = findRollTick(world, 1, 2, "fleet_recon", true);
    expect(runEspionage(world, 1, 2, "fleet_recon").ok).toBe(true);
    const second = runEspionage(world, 1, 3, "fleet_recon");
    expect(second.ok).toBe(false);
    expect(second.messageRu).toContain("через");
    world.tick += ESPIONAGE_COOLDOWN;
    expect(runEspionage(world, 1, 3, "fleet_recon").ok).toBe(true);
  });

  it("кража технологии требует теху из данных и берёт T≤3", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    // без requiresTech — отказ
    world.tick = 5;
    const denied = runEspionage(world, 1, 2, "steal_tech");
    expect(denied.ok).toBe(false);
    giveTech(world, 1, "soc_education_2");
    const ownedByPlayer = new Set(world.empires.find((e) => e.id === 1)!.techs.completed);
    const stealable = TECHS.find((tech) => tech.tier <= 3 && tech.id !== "soc_education_2" && !ownedByPlayer.has(tech.id));
    expect(stealable).toBeDefined();
    giveTech(world, 2, stealable!.id);
    const successTick = findRollTick(world, 1, 2, "steal_tech", true);
    world.tick = successTick;
    const before = world.empires.find((e) => e.id === 1)!.techs.completed.length;
    const result = runEspionage(world, 1, 2, "steal_tech");
    expect(result.messageRu).toContain("Успех");
    const after = world.empires.find((e) => e.id === 1)!;
    expect(after.techs.completed.length).toBe(before + 1);
    expect(after.techs.completed).toContain(stealable!.id);
    expect(stealable!.tier).toBeLessThanOrEqual(3);
  });

  it("диверсия: −20% производства 20 тактов, фаза списывает доход", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    world.tick = findRollTick(world, 1, 2, "sabotage", true);
    expect(runEspionage(world, 1, 2, "sabotage").ok).toBe(true);
    expect(world.flags["sab:2"]).toBeGreaterThan(world.tick);
    const target = world.empires.find((e) => e.id === 2)!;
    target.incomeLastTick.energy = 100;
    target.resources.energy = 1000;
    espionagePhase(world);
    expect(target.resources.energy).toBeLessThan(1000);
    expect(target.resources.energy).toBeGreaterThanOrEqual(950);
    // по истечении флага штраф снимается
    world.flags["sab:2"] = world.tick - 1;
    espionagePhase(world);
    expect(world.flags["sab:2"]).toBeUndefined();
  });

  it("кража карты раскрывает до 5 систем", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    world.tick = findRollTick(world, 1, 2, "steal_map", true);
    const knownBefore = world.systems.filter((s) => s.knownBy.includes(1)).length;
    const result = runEspionage(world, 1, 2, "steal_map");
    expect(result.messageRu).toContain("Успех");
    const knownAfter = world.systems.filter((s) => s.knownBy.includes(1)).length;
    expect(knownAfter).toBeGreaterThanOrEqual(knownBefore);
    expect(knownAfter - knownBefore).toBeLessThanOrEqual(5);
  });

  it("убийство адмирала: адмирал гибнет", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    const hostileFleet = world.fleets.find((f) => f.empireId === 2)!;
    hostileFleet.admiralName = "Адмирал Тест";
    world.tick = findRollTick(world, 1, 2, "assassinate", true);
    const result = runEspionage(world, 1, 2, "assassinate");
    expect(result.messageRu).toContain("Успех");
    expect(hostileFleet.admiralName).toBeNull();
  });

  it("нельзя шпионить против себя, пиратов и без влияния", () => {
    const world = testWorld();
    expect(runEspionage(world, 1, 1, "fleet_recon").ok).toBe(false);
    expect(runEspionage(world, 1, 9, "fleet_recon").ok).toBe(false);
    world.empires.find((e) => e.id === 1)!.resources.influence = 0;
    world.tick = 3;
    expect(runEspionage(world, 1, 2, "fleet_recon").ok).toBe(false);
  });

  it("детерминизм: одинаковый тик/seed → одинаковый исход", () => {
    const run = (): string => {
      const world = testWorld();
      give(world, 1, { influence: 100 });
      world.tick = findRollTick(world, 1, 2, "sabotage", true);
      const result = runEspionage(world, 1, 2, "sabotage");
      return JSON.stringify([result.ok, result.messageRu, world.flags["sab:2"], intelLevel(world, 1, 2)]);
    };
    expect(run()).toBe(run());
  });

  it("подстрекательство бьёт по стабильности и преступности", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    const target = world.empires.find((e) => e.id === 2)!;
    const colonyId = target.colonies[0];
    const colony = world.colonies.find((c) => c.id === colonyId)!;
    colony.stability = 80;
    colony.crime = 10;
    world.tick = findRollTick(world, 1, 2, "incite", true);
    expect(runEspionage(world, 1, 2, "incite").messageRu).toContain("Успех");
    expect(colony.stability).toBe(65);
    expect(colony.crime).toBe(20);
    void firstSystemOf;
    void addFleet;
    void pushOpinion;
    void SABOTAGE_TICKS;
  });
});
