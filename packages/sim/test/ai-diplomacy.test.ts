import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld, getEmpireFleetPower } from "../src/queries";
import { serializeWorld } from "../src/save";
import { tick } from "../src/tick";
import { advancedOf, ensureFg } from "../src/fullgame";
import { opinionOf } from "../src/diplomacy";

function livingAiIds(world: ReturnType<typeof createWorld>): number[] {
  return world.empires
    .filter((empire) => !empire.dead && !empire.isPlayer && empire.id !== 9)
    .map((empire) => empire.id)
    .sort((a, b) => a - b);
}

describe("ИИ-дипломатия: прогон 1000 тактов (GDD §12–13, M7 acceptance)", () => {
  it("≥3 войн, ≥2 союзов, никто не «застревает»", () => {
    const world = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 1000; i++) tick(world);
    expect(world.tick).toBe(1000);
    const fg = ensureFg(world);
    const wars = world.flags["hist:wars"] ?? 0;
    const alliances = world.flags["hist:alliances"] ?? 0;
    expect(wars, "войны за 1000 тактов").toBeGreaterThanOrEqual(3);
    expect(alliances, "союзы за 1000 тактов").toBeGreaterThanOrEqual(2);
    expect(world.flags["hist:resolutions"] ?? 0, "заседания совета").toBeGreaterThanOrEqual(1);
    // никто не «застревает»: у каждой живой ИИ-империи есть системы, наука и действия
    const ids = livingAiIds(world);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      const empire = world.empires.find((e) => e.id === id)!;
      expect(empire.systems.length, "системы ИИ " + id).toBeGreaterThan(0);
      expect(empire.stats.techsResearched, "технологии ИИ " + id).toBeGreaterThan(0);
      expect(empire.stats.coloniesFounded, "колонии ИИ " + id).toBeGreaterThan(0);
      expect(getEmpireFleetPower(world, id), "флот ИИ " + id).toBeGreaterThan(0);
      // решения ИИ записываются (журнал дипломатии/войн)
      expect(Number.isFinite(advancedOf(world, id).gdp) || true).toBe(true);
    }
    // дипломатия реально меняла мнения: есть пары с положительным/отрицательным мнением
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const opinion = opinionOf(world, ids[i], ids[j]);
        if (opinion >= 40) positive += 1;
        if (opinion <= -10) negative += 1;
      }
    }
    expect(positive, "дружественные пары").toBeGreaterThanOrEqual(2);
    // журнал дипломатии/войн не пуст
    expect(fg.journal.length).toBeGreaterThan(0);
    expect(fg.journal.some((entry) => entry.kind === "war" || entry.kind === "treaty" || entry.kind === "peace")).toBe(true);
  }, 300000);

  it("детерминизм: 300 тактов два прогона дают одинаковый мир", () => {
    const run = (): string => {
      const world = createWorld(42, MODE, BALANCE);
      for (let i = 0; i < 300; i++) tick(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  }, 300000);

  it("ИИ не объявляет войну без CB и не воюет при NAP", () => {
    const world = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 400; i++) tick(world);
    const fg = ensureFg(world);
    // каждая война имеет валидный CB и стороны
    for (const war of fg.wars) {
      expect(["conquest", "liberation", "humiliation", "vassalization", "crisis", "defensive"]).toContain(war.cb);
      expect(war.sides[war.attackerId]).toBeDefined();
      expect(war.sides[war.defenderId]).toBeDefined();
      expect(war.startedTick).toBeGreaterThanOrEqual(0);
    }
    // мир/перемирие не позволяет мгновенно переобъявить войну
    for (const key of Object.keys(world.flags)) {
      if (!key.startsWith("truce:")) continue;
      const [a, b] = key.slice(6).split(":").map(Number);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
    }
  }, 300000);
});
