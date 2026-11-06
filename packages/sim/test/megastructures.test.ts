import { describe, expect, it } from "vitest";
import { worldWithFg } from "./fg-helpers";
import { applyCommand } from "../src/commands";
import { advancedOf, ensureFg } from "../src/fullgame";
import {
  buildMegastructure, empireMegastructures, megastructureCost, megastructureDefinition,
  megastructureDefinitions, megastructurePhase, megastructureProductionMult,
} from "../src/megastructures";
import { serializeWorld } from "../src/save";
import type { MegastructureType } from "../src/fullgame";
import type { World } from "../src/types";

const ALL_TYPES: MegastructureType[] = [
  "sentinel_array", "gate", "star_forge", "ring_habitat", "dyson_sphere", "science_nexus", "beacon",
];

function giveTech(world: World, tiers: number[]): void {
  // T5-технологии игрока разблокируют тиры по techMaxTier
  const player = world.empires[0];
  for (const tier of tiers) {
    if (tier >= 5) player.techs.completed.push("soc_ascension_1");
    if (tier === 3) player.techs.completed.push("eng_shipyard_1");
    if (tier === 4) player.techs.completed.push("eng_hull_4");
  }
}

function givePerk(world: World, perkId: string): void {
  const adv = advancedOf(world, world.playerEmpireId);
  if (!adv.perks.includes(perkId)) adv.perks.push(perkId);
}

describe("мегаструктуры (GDD §8.7)", () => {
  it("fallback: 7 типов с валидными полями", () => {
    expect(megastructureDefinitions().length).toBe(7);
    for (const type of ALL_TYPES) {
      const def = megastructureDefinition(type);
      expect(def, type).toBeDefined();
      expect(def!.costAlloys).toBeGreaterThan(0);
      expect(def!.buildTicks).toBeGreaterThan(0);
      expect(def!.maxPerEmpire).toBeGreaterThan(0);
      expect(Object.keys(def!.effects).length).toBeGreaterThan(0);
    }
  });

  it("нельзя строить без технологий, чужих систем и ресурсов", () => {
    const world = worldWithFg();
    const capital = world.empires[0].capitalSystemId;
    const noTech = buildMegastructure(world, 1, "dyson_sphere", capital);
    expect(noTech.ok).toBe(false);
    expect(noTech.messageRu).toContain("T5");
    giveTech(world, [5]);
    givePerk(world, "space_engineering");
    world.empires[0].resources.alloys = 0;
    const noMoney = buildMegastructure(world, 1, "sentinel_array", capital);
    expect(noMoney.ok).toBe(false);
    expect(noMoney.messageRu).toContain("сплав");
    // откатываем и проверяем чужую систему
    world.empires[0].resources.alloys = 20000;
    const foreignSystem = world.systems.find((s) => s.ownerId !== 1)!;
    const foreign = buildMegastructure(world, 1, "sentinel_array", foreignSystem.id);
    expect(foreign.ok).toBe(false);
    expect(foreign.messageRu).toContain("своей системе");
  });

  it("успешная стройка: оплата, очередь, активация", () => {
    const world = worldWithFg();
    giveTech(world, [5]);
    givePerk(world, "space_engineering");
    const player = world.empires[0];
    player.resources.alloys = 20000;
    const capital = player.capitalSystemId;
    const result = buildMegastructure(world, 1, "dyson_sphere", capital);
    expect(result.ok, result.messageRu).toBe(true);
    expect(result.createdId).toBeGreaterThan(0);
    const fg = ensureFg(world);
    const mega = fg.megastructures[0];
    expect(mega.ownerId).toBe(1);
    expect(mega.active).toBe(false);
    expect(mega.ticksLeft).toBe(mega.totalTicks);
    expect(player.resources.alloys).toBe(20000 - megastructureCost(world, "dyson_sphere").alloys);
    // дубликат в той же системе запрещён
    expect(buildMegastructure(world, 1, "dyson_sphere", capital).ok).toBe(false);
    // достройка за 1 такт
    mega.ticksLeft = 1;
    megastructurePhase(world);
    expect(mega.active).toBe(true);
    expect(world.log.some((e) => e.messageRu.includes("достроена"))).toBe(true);
  });

  it("эффекты: megastructureProductionMult суммирует активные", () => {
    const world = worldWithFg();
    const fg = ensureFg(world);
    fg.megastructures.push(
      { id: 1, type: "dyson_sphere", systemId: 0, ownerId: 1, ticksLeft: 0, totalTicks: 1, active: true, hp: 10, maxHp: 10 },
      { id: 2, type: "star_forge", systemId: 0, ownerId: 1, ticksLeft: 0, totalTicks: 1, active: true, hp: 10, maxHp: 10 },
    );
    const mult = megastructureProductionMult(world, 1);
    expect(mult.energy_flat).toBe(300);
    expect(mult.alloys_prod).toBeCloseTo(0.25, 5);
    expect(empireMegastructures(world, 1).length).toBe(2);
    expect(megastructureProductionMult(world, 2)).toEqual({});
  });

  it("перехват: смена владельца системы передаёт мегаструктуру", () => {
    const world = worldWithFg();
    const fg = ensureFg(world);
    const frame = world.systems[0];
    frame.ownerId = 1;
    fg.megastructures.push({ id: 1, type: "beacon", systemId: frame.id, ownerId: 1, ticksLeft: 0, totalTicks: 1, active: true, hp: 100, maxHp: 100 });
    frame.ownerId = 2;
    megastructurePhase(world);
    expect(fg.megastructures[0].ownerId).toBe(2);
    expect(fg.megastructures[0].hp).toBe(50);
    expect(world.log.some((e) => e.messageRu.includes("перехвачена"))).toBe(true);
  });

  it("кризис в системе разрушает мегаструктуру", () => {
    const world = worldWithFg();
    const fg = ensureFg(world);
    const systemId = 0;
    world.systems[systemId].ownerId = 1;
    fg.megastructures.push({ id: 1, type: "gate", systemId, ownerId: 1, ticksLeft: 0, totalTicks: 1, active: true, hp: 5, maxHp: 100 });
    fg.crises.push({
      id: "c1", kind: "grey_tide", startedTick: 0, stage: 1, strengthFp: 5000, systems: [systemId],
      nodes: [], defeated: false, progress: 0.1, wavesRepelled: 0, lairSystemId: systemId,
      lastActionTick: 0, titleRu: "Тест",
    });
    megastructurePhase(world);
    expect(fg.megastructures.length).toBe(0);
    expect(world.log.some((e) => e.messageRu.includes("разрушена"))).toBe(true);
  });

  it("команда megastructure_build доступна через applyCommand", () => {
    const world = worldWithFg();
    giveTech(world, [5]);
    givePerk(world, "space_engineering");
    world.empires[0].resources.alloys = 10000;
    const capital = world.empires[0].capitalSystemId;
    const command = applyCommand(world, { type: "megastructure_build", megastructure: "sentinel_array", systemId: capital });
    expect(command.ok, command.messageRu).toBe(true);
    expect(ensureFg(world).megastructures.length).toBe(1);
  });

  it("детерминизм: одинаковое строительство → идентичное состояние", () => {
    const run = (): string => {
      const world = worldWithFg();
      giveTech(world, [5]);
      givePerk(world, "technocracy");
      world.empires[0].resources.alloys = 20000;
      buildMegastructure(world, 1, "science_nexus", world.empires[0].capitalSystemId);
      megastructurePhase(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  });
});
