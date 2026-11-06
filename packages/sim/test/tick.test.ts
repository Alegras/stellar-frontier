import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld, getFleetCap, getProjectedIncome, getScore, getVictory } from "../src/queries";
import { serializeWorld } from "../src/save";
import { tick } from "../src/tick";
import { goldenHash } from "./helpers";

describe("такт и детерминизм", () => {
  it("1000 тактов не падают; нет NaN и отрицательных запасов", () => {
    const world = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 1000; i++) tick(world);
    expect(world.tick).toBe(1000);
    const json = serializeWorld(world);
    expect(json.includes("NaN")).toBe(false);
    expect(json.includes("Infinity")).toBe(false);
    for (const empire of world.empires) {
      for (const key of Object.keys(empire.resources)) {
        const value = empire.resources[key as keyof typeof empire.resources];
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    for (const colony of world.colonies) {
      const pops = colony.pops.workers + colony.pops.specialists + colony.pops.rulers;
      expect(pops).toBeGreaterThanOrEqual(0);
      expect(colony.pops.unemployed).toBeLessThanOrEqual(pops);
      expect(colony.pops.unemployed).toBeGreaterThanOrEqual(0);
    }
  }, 120000);

  it("детерминизм: 2 прогона seed 42 × 300 тактов = идентичный serializeWorld", () => {
    const run = (): string => {
      const world = createWorld(42, MODE, BALANCE);
      for (let i = 0; i < 300; i++) tick(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  }, 120000);

  it("golden hash 100 тактов seed 42 стабилен", () => {
    const world = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 100; i++) tick(world);
    const hash = goldenHash(world);
    // golden значение зафиксировано после стабилизации баланса/контента/ИИ (seed 42)
    // golden пересчитан после интеграции M6 (традиции/перки/модификаторы) и M8 (рынок станций:
    // цены/запас/капитал, состояния рынка, биржа CR<->энергия, маршруты, пул контрактов),
    // seed 42, 100 тактов. Пересчитать ещё раз после финальной интеграции M6–M12.
    expect(hash).toBe("1bfd9c71");
  }, 60000);

  it("createWorld(42) < 300 мс, такт на 240 систем <= 8 мс", () => {
    const startCreate = Date.now();
    const world = createWorld(42, MODE, BALANCE);
    const createMs = Date.now() - startCreate;
    expect(createMs).toBeLessThan(300);
    // прогрев
    for (let i = 0; i < 20; i++) tick(world);
    const startTicks = Date.now();
    const ticks = 100;
    for (let i = 0; i < ticks; i++) tick(world);
    const avg = (Date.now() - startTicks) / ticks;
    expect(avg, `средний такт ${avg.toFixed(2)} мс`).toBeLessThan(8);
  }, 120000);

  it("API запросов работает: лимит флота, прогноз, счёт, победа", () => {
    const world = createWorld(42, MODE, BALANCE);
    const cap = getFleetCap(world, 1);
    expect(cap).toBeGreaterThanOrEqual(20);
    expect(cap).toBeLessThan(60);
    const projected = getProjectedIncome(world, 1);
    expect(projected.energy).toBeGreaterThan(0);
    const score = getScore(world, 1);
    expect(score.total).toBeGreaterThan(0);
    expect(score.population).toBeGreaterThan(0);
    const victory = getVictory(world);
    expect(victory.achieved).toBeNull();
    expect(victory.winnerEmpireId).toBe(0);
  });
});
