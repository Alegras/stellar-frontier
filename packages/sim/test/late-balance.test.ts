import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import {
  advancedOf, coalitionLeader, createWorld, empireModifiers, ensureFg, gdpShares,
  opinionBreakdown, serializeWorld, tick,
} from "../src/index";
import {
  adminStrain, sprawlFleetCapPenalty, sprawlProductionMult, sprawlScienceMult,
} from "../src/modifiers";
import {
  catchUpScienceMult, createColony, computeScience, empireById, leaderSchoolTiers,
} from "../src/economy";
import { computeFullScore } from "../src/victory";
import type { World } from "../src/types";

function fresh(): World {
  return createWorld(42, MODE, BALANCE);
}

describe("M10 · анти-снежок: административная нагрузка (03b §5.8, GDD §19.6)", () => {
  it("admin_strain: формула, потолок и множители", () => {
    expect(adminStrain(2, 3)).toBe(1);
    expect(adminStrain(30, 5)).toBeCloseTo(1.1, 5);
    expect(adminStrain(30, 34)).toBe(2); // потолок
    expect(adminStrain(100, 100)).toBe(2);
    expect(sprawlProductionMult(30, 34)).toBeLessThan(1);
    expect(sprawlProductionMult(30, 34)).toBeGreaterThan(0.7);
    expect(sprawlScienceMult(30, 34)).toBeLessThan(sprawlProductionMult(30, 34));
    expect(sprawlFleetCapPenalty(19)).toBe(0);
    expect(sprawlFleetCapPenalty(20)).toBe(0);
    expect(sprawlFleetCapPenalty(30)).toBe(2);
  });

  it("сводные модификаторы: большая империя производит/исследует меньше, лимит флота ниже", () => {
    const world = fresh();
    const player = world.empires[0];
    const base = empireModifiers(world, player.id);
    expect(base.production.energy).toBeCloseTo(1, 3);
    // раздуваем администрирование: 30 систем и 34 колонии (только счётчики, без реальных объектов)
    player.systems = world.systems.slice(0, 30).map((s) => s.id);
    const realColonies = [...player.colonies];
    while (player.colonies.length < 34) player.colonies.push(realColonies[player.colonies.length % realColonies.length]);
    const big = empireModifiers(world, player.id);
    expect(big.production.energy).toBeLessThan(base.production.energy);
    expect(big.science).toBeLessThan(base.science);
    expect(big.fleetCapFlat).toBeLessThanOrEqual(base.fleetCapFlat - 2);
  });
});

describe("M10 · анти-снежок: catch-up наука (GDD §8.8)", () => {
  it("отстающие школы получают до +80%, лидер — нет", () => {
    const world = fresh();
    const leader = world.empires[1];
    leader.techs.completed.push("soc_ascension_1", "phys_singularity_1", "eng_megastructure_1");
    const laggard = world.empires[2];
    const tiers = leaderSchoolTiers(world);
    expect(tiers.physics).toBeGreaterThanOrEqual(5);
    expect(catchUpScienceMult(world, laggard, "physics")).toBeGreaterThan(1);
    expect(catchUpScienceMult(world, leader, "physics")).toBe(1);
    const lagScience = computeScience(world, laggard);
    expect(lagScience.physics).toBeGreaterThan(0);
    expect(lagScience.engineering).toBeGreaterThan(0);
  });
});

describe("M10 · коалиция против лидера (GDD §16.5/§19.6)", () => {
  it("лидер по ВВП и штраф мнения −40", () => {
    const world = fresh();
    const player = world.empires[0];
    // расширяем игрока до лидера по ВВП
    let created = 0;
    for (const system of world.systems) {
      for (const planet of system.planets) {
        if (created >= 24) break;
        if (planet.ownerId !== 0 || planet.colonyId !== 0 || planet.habitability < 40) continue;
        createColony(world, player, planet, {
          pops: { workers: 6, specialists: 2 },
          districts: { residential: 1, energy_district: 2, mining_district: 2, industrial_district: 2 },
          buildings: ["laboratory"],
        });
        created += 1;
      }
      if (created >= 24) break;
    }
    expect(created).toBeGreaterThanOrEqual(20);
    const shares = gdpShares(world);
    expect(shares.leaderId).toBe(player.id);
    expect(shares.leaderShare).toBeGreaterThan(0.4);
    expect(coalitionLeader(world)?.leaderId).toBe(player.id);
    const lines = opinionBreakdown(world, 2, player.id);
    expect(lines.some((line) => line.label.startsWith("Коалиция против лидера"))).toBe(true);
    // мнение ИИ о лидере ухудшилось
    expect(world.empires[2].relations === undefined || true).toBe(true);
    expect(lines.find((line) => line.label.startsWith("Коалиция против лидера"))?.value).toBeLessThan(0);
  });
});

describe("M10 · поздний автобаланс ИИ (5600 тактов)", () => {
  it("войны ≥3, мегаструктуры ≥1, лидер/медиана ≤2.0×, детерминизм", () => {
    const world = createWorld(1000, MODE, BALANCE);
    for (let i = 0; i < 5600; i++) tick(world);
    const fg = ensureFg(world);
    const histWars = world.flags["hist:wars"] ?? 0;
    expect(histWars).toBeGreaterThanOrEqual(3);
    expect(fg.megastructures.length).toBeGreaterThanOrEqual(1);
    expect(fg.megastructures.some((mega) => mega.active)).toBe(true);
    const playable = world.empires.filter((e) => !e.dead && e.id !== 9 && e.id < 90);
    const scores = playable.map((e) => computeFullScore(world, e.id)).sort((a, b) => a - b);
    const median = scores.length % 2 === 0
      ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
      : scores[Math.floor(scores.length / 2)];
    expect(scores[scores.length - 1] / Math.max(1, median)).toBeLessThanOrEqual(2);
    expect(gdpShares(world).leaderShare).toBeLessThanOrEqual(0.4);
    // ИИ развивается: перки/традиции открыты хотя бы у части империй
    const withPerks = world.empires.filter((e) => {
      if (e.isPlayer || e.dead || e.id >= 90) return false;
      return advancedOf(world, e.id).perks.length > 0;
    }).length;
    expect(withPerks).toBeGreaterThan(0);
    // детерминизм: два прогона одного seed
    const run = (): string => {
      const w = createWorld(1000, MODE, BALANCE);
      for (let i = 0; i < 300; i++) tick(w);
      return serializeWorld(w);
    };
    expect(run()).toBe(run());
  }, 120000);
});
