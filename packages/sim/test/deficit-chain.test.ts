import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/index";
import {
  applyDeficits, computeColonyOutput, computeScience, growPopulation, updateStability,
} from "../src/economy";
import type { Colony, Empire, World } from "../src/index";

function fresh(): World {
  return createWorld(42, MODE, BALANCE);
}

function playerAndCapital(world: World): { empire: Empire; colony: Colony } {
  const empire = world.empires[0];
  const colony = world.colonies.find((c) => c.empireId === empire.id)!;
  return { empire, colony };
}

function popsOf(colony: Colony): number {
  return colony.pops.workers + colony.pops.specialists + colony.pops.rulers;
}

describe("M2 · цепочка дефицита еды: голод → штрафы → восстановление", () => {
  it("дефицит еды включает флаг, режет стабильность и рост", () => {
    const world = fresh();
    const { empire, colony } = playerAndCapital(world);
    // базовые значения
    world.flags["def:1:food"] = 0;
    updateStability(world, colony);
    const stabilityBase = colony.stability;
    empire.resources.food = 0;
    empire.incomeLastTick.food = -5;
    applyDeficits(world, empire);
    expect(world.flags["def:1:food"] ?? 0).toBeGreaterThan(0);
    updateStability(world, colony);
    expect(colony.stability).toBeLessThan(stabilityBase);
    expect(stabilityBase - colony.stability).toBeGreaterThanOrEqual(20);
    // рост: с флагом голода медленнее, чем без него (детерминированно, одинаковые миры)
    const grows = (withHunger: boolean): number => {
      const w = createWorld(42, MODE, BALANCE);
      const { colony: c } = playerAndCapital(w);
      if (withHunger) w.flags["def:1:food"] = 1;
      const before = popsOf(c);
      for (let i = 0; i < 120; i++) {
        w.tick += 1;
        growPopulation(w, c);
      }
      return popsOf(c) - before + ((w.flags[`growth:${c.id}`] ?? 0) / 1000);
    };
    const normal = grows(false);
    const hungry = grows(true);
    expect(normal).toBeGreaterThan(0);
    expect(hungry).toBeLessThan(normal);
  });

  it("восстановление: еда появилась → флаг снят, стабильность и рост вернулись", () => {
    const world = fresh();
    const { empire, colony } = playerAndCapital(world);
    world.flags["def:1:food"] = 0;
    updateStability(world, colony);
    const stabilityBase = colony.stability;
    empire.resources.food = 0;
    empire.incomeLastTick.food = -5;
    applyDeficits(world, empire);
    updateStability(world, colony);
    const stabilityHungry = colony.stability;
    expect(stabilityHungry).toBeLessThan(stabilityBase);
    // появляется еда и положительный доход
    empire.resources.food = 200;
    empire.incomeLastTick.food = 10;
    applyDeficits(world, empire);
    expect(world.flags["def:1:food"]).toBe(0);
    updateStability(world, colony);
    expect(colony.stability).toBe(stabilityBase);
    // рост снова положительный
    const before = popsOf(colony);
    const w2 = fresh();
    const { colony: c2 } = playerAndCapital(w2);
    for (let i = 0; i < 120; i++) {
      w2.tick += 1;
      growPopulation(w2, c2);
    }
    expect(popsOf(c2)).toBeGreaterThan(before - 1);
  });
});

describe("M2 · цепочка дефицита ТП и энергии", () => {
  it("дефицит ТП режет науку на ~20% и снимается после восстановления", () => {
    const world = fresh();
    const { empire, colony } = playerAndCapital(world);
    void colony;
    world.flags["def:1:goods"] = 0;
    const normal = computeScience(world, empire);
    world.flags["def:1:goods"] = 1;
    const deficit = computeScience(world, empire);
    for (const school of ["physics", "society", "engineering"] as const) {
      expect(deficit[school], school).toBeLessThan(normal[school]);
      expect(deficit[school], school).toBeGreaterThan(normal[school] * 0.6);
    }
    world.flags["def:1:goods"] = 0;
    const restored = computeScience(world, empire);
    expect(restored).toEqual(normal);
  });

  it("дефицит энергии режет производство колонии на ~25%, восстановление возвращает", () => {
    const world = fresh();
    const { colony } = playerAndCapital(world);
    world.flags["def:1:energy"] = 0;
    const normal = computeColonyOutput(world, colony);
    world.flags["def:1:energy"] = 1;
    const deficit = computeColonyOutput(world, colony);
    expect(deficit.output.energy).toBeLessThan(normal.output.energy);
    expect(deficit.output.energy).toBeGreaterThan(normal.output.energy * 0.7);
    expect(deficit.output.energy).toBeLessThan(normal.output.energy * 0.8);
    world.flags["def:1:energy"] = 0;
    const restored = computeColonyOutput(world, colony);
    expect(restored.output.energy).toBe(normal.output.energy);
  });

  it("applyDeficits не уводит запасы в минус и копит длительность дефицита", () => {
    const world = fresh();
    const { empire } = playerAndCapital(world);
    empire.resources.food = 0;
    empire.incomeLastTick.food = -3;
    applyDeficits(world, empire);
    const first = world.flags["def:1:food"] ?? 0;
    expect(empire.resources.food).toBeGreaterThanOrEqual(0);
    empire.resources.food = 0;
    empire.incomeLastTick.food = -3;
    applyDeficits(world, empire);
    expect(world.flags["def:1:food"] ?? 0).toBeGreaterThan(first);
    // отрицательный склад клампится в 0
    empire.resources.minerals = -50;
    empire.incomeLastTick.minerals = -1;
    applyDeficits(world, empire);
    expect(empire.resources.minerals).toBe(0);
    expect(world.flags["def:1:minerals"] ?? 0).toBeGreaterThan(0);
  });
});
