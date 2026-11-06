import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld, getIncomeBreakdown, getProjectedIncome, getColonyOutput, canAfford, getBuildCost } from "../src/queries";
import { applyDeficits, computeColonyOutput, projectEmpire } from "../src/economy";
import { tick } from "../src/tick";
import { RESOURCE_ORDER } from "../src/types";
import type { ResourceId } from "../src/types";

const CANON: Partial<Record<ResourceId, number>> = BALANCE.startIncome as Partial<Record<ResourceId, number>>;

describe("экономика старта (GDD §19.1, 03b §12.2)", () => {
  it("стартовый доход близок к канону ±20%", () => {
    const world = createWorld(42, MODE, BALANCE);
    tick(world); // пересчёт стабильности/назначений
    const checked: ResourceId[] = ["energy", "minerals", "food", "alloys", "goods", "unity", "influence"];
    for (const res of checked) {
      const canon = CANON[res] ?? 0;
      expect(canon).toBeGreaterThan(0);
      const breakdown = getIncomeBreakdown(world, 1, res);
      // канон §19.1 — доход верхней панели (до апкипа зданий/флота); в breakdown итог = чистое изменение
      const laterUpkeep = breakdown.lines
        .filter((line) => line.labelRu === "Апкип зданий" || line.labelRu === "Апкип флота")
        .reduce((acc, line) => acc - line.valueMilli, 0);
      const actual = (breakdown.totalMilli + laterUpkeep) / 1000;
      expect(breakdown.lines.reduce((acc, line) => acc + line.valueMilli, 0)).toBe(breakdown.totalMilli);
      const relDiff = Math.abs(actual - canon) / canon;
      expect(relDiff, `${res}: факт ${actual}, канон ${canon}`).toBeLessThanOrEqual(0.2);
    }
  });

  it("getIncomeBreakdown раскрывает формулу: база → модификаторы → итог", () => {
    const world = createWorld(42, MODE, BALANCE);
    const breakdown = getIncomeBreakdown(world, 1, "energy");
    expect(breakdown.lines.length).toBeGreaterThanOrEqual(3);
    const labels = breakdown.lines.map((line) => line.labelRu).join(" | ");
    expect(labels).toContain("База");
    expect(labels).toContain("Апкип флота");
    expect(labels).toContain("Апкип зданий");
    const sum = breakdown.lines.reduce((acc, line) => acc + line.valueMilli, 0);
    expect(sum).toBe(breakdown.totalMilli); // строки формулы сходятся в итог
    expect(breakdown.totalMilli).toBeLessThan(0 + breakdown.totalMilli * 2);
  });

  it("дефицит энергии даёт -25% производства (GDD §7.4)", () => {
    const world = createWorld(42, MODE, BALANCE);
    const colony = world.colonies.find((c) => c.empireId === 1 && c.pops.workers > 5);
    expect(colony).toBeDefined();
    const before = computeColonyOutput(world, colony!).output.energy;
    world.flags["def:1:energy"] = 1;
    const after = computeColonyOutput(world, colony!).output.energy;
    expect(after).toBeLessThan(before);
    const ratio = after / before;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.95);
    delete world.flags["def:1:energy"];
  });

  it("дефицит не уводит склад в минус и включает флаг штрафа", () => {
    const world = createWorld(42, MODE, BALANCE);
    const empire = world.empires[0];
    empire.resources.food = 0;
    empire.incomeLastTick.food = -5;
    applyDeficits(world, empire);
    expect(empire.resources.food).toBe(0);
    expect(world.flags["def:1:food"] ?? 0).toBeGreaterThan(0);
  });

  it("склад меняется ровно на прогноз дохода (деньги не из воздуха)", () => {
    const world = createWorld(42, MODE, BALANCE);
    const empire = world.empires[0];
    const before: Record<string, number> = { ...empire.resources };
    const projected = getProjectedIncome(world, 1);
    tick(world);
    for (const res of RESOURCE_ORDER) {
      const delta = empire.resources[res] - before[res];
      expect(Number.isFinite(delta)).toBe(true);
      expect(Math.abs(delta - projected[res]), `ресурс ${res}: дельта ${delta}, прогноз ${projected[res]}`).toBeLessThanOrEqual(2);
    }
  });

  it("население растёт при положительном балансе еды", () => {
    const world = createWorld(42, MODE, BALANCE);
    const colony = world.colonies.find((c) => c.empireId === 1)!;
    const startWorkers = colony.pops.workers + colony.pops.specialists + colony.pops.rulers;
    for (let i = 0; i < 150; i++) tick(world);
    const nowWorkers = colony.pops.workers + colony.pops.specialists + colony.pops.rulers;
    expect(nowWorkers).toBeGreaterThan(startWorkers);
    expect(colony.pops.unemployed).toBeGreaterThanOrEqual(0);
    const output = getColonyOutput(world, colony);
    expect(output.workersNeeded).toBeGreaterThan(0);
  });

  it("canAfford/getBuildCost согласованы", () => {
    const world = createWorld(42, MODE, BALANCE);
    const empire = world.empires[0];
    const cost = getBuildCost(world, "district", "energy_district");
    const minerals = cost.minerals ?? 0;
    expect(minerals).toBeGreaterThan(0);
    empire.resources.minerals = 1000;
    expect(canAfford(world, 1, cost)).toBe(true);
    empire.resources.minerals = 0;
    expect(canAfford(world, 1, cost)).toBe(false);
  });
});
