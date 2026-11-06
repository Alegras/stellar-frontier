import { describe, expect, it } from "vitest";
import { BALANCE, MODE, TECHS, TECHS_EXTRA, TECH_BY_ID } from "@sf/data";
import { createWorld } from "../src/queries";
import { generateTechOffers, techMaxTier, techPool, techTierCap } from "../src/queries";
import { empireModifiers } from "../src/modifiers";
import { allPerks, unlockPerk } from "../src/traditions";
import { SCIENCE_ORDER } from "../src/types";
import type { Empire, ScienceId, World } from "../src/types";

function makeWorld(): World {
  return createWorld(42, MODE, BALANCE);
}

function empire(world: World, id = 1): Empire {
  const found = world.empires.find((e) => e.id === id);
  if (!found) throw new Error("нет империи " + id);
  return found;
}

function expectedOfferCount(world: World, empireId = 1): number {
  const extra = empireModifiers(world, empireId).extraTechChoice;
  return Math.min(5, Math.max(1, 3 + Math.max(0, Math.round(extra))));
}

describe("тех-пул: выбор 1 из 3 (GDD §8.3)", () => {
  it("предложения: 3 (или больше при extraTechChoice), только своя школа", () => {
    const world = makeWorld();
    for (const school of SCIENCE_ORDER) {
      const offers = generateTechOffers(world, empire(world), school);
      expect(offers.length).toBe(expectedOfferCount(world));
      expect(offers.length).toBeGreaterThanOrEqual(3);
      for (const id of offers) {
        const tech = TECH_BY_ID[id];
        expect(tech, id).toBeDefined();
        expect(tech!.school).toBe(school);
      }
    }
  });

  it("в предложениях нет дублей, все в пуле, пререквизиты выполнены, тир не выше потолка", () => {
    const world = makeWorld();
    const e = empire(world);
    const poolIds = new Set(techPool().map((tech) => tech.id));
    for (const school of SCIENCE_ORDER) {
      const offers = generateTechOffers(world, e, school);
      expect(new Set(offers).size).toBe(offers.length);
      const cap = techTierCap(e, school);
      for (const id of offers) {
        expect(poolIds.has(id), id).toBe(true);
        const tech = TECH_BY_ID[id];
        if (tech) {
          expect(tech.tier).toBeLessThanOrEqual(cap);
          for (const req of tech.requires ?? []) {
            expect(e.techs.completed, "пререквизит " + req + " для " + id).toContain(req);
          }
        } else {
          const fromExtra = TECHS_EXTRA.find((entry) => entry.id === id);
          expect(fromExtra, id).toBeDefined();
          expect(fromExtra!.tier).toBeLessThanOrEqual(cap);
          for (const req of fromExtra!.requires ?? []) expect(e.techs.completed).toContain(req);
        }
        expect(e.techs.completed).not.toContain(id);
      }
    }
  });

  it("потолок тира: максимум школы + 1", () => {
    const world = makeWorld();
    const e = empire(world);
    for (const school of SCIENCE_ORDER) {
      expect(techMaxTier(e, school)).toBe(0);
      expect(techTierCap(e, school)).toBe(1);
    }
    const tier3 = TECHS.find((tech) => tech.school === "physics" && tech.tier === 3);
    expect(tier3).toBeDefined();
    e.techs.completed.push(tier3!.id);
    expect(techMaxTier(e, "physics")).toBe(3);
    expect(techTierCap(e, "physics")).toBe(4);
    for (const id of generateTechOffers(world, e, "physics")) {
      const tech = TECH_BY_ID[id];
      if (tech) expect(tech.tier).toBeLessThanOrEqual(4);
    }
  });

  it("extraTechChoice расширяет тройку (перк «Технократия»)", () => {
    const world = makeWorld();
    const e = empire(world);
    e.resources.unity = 200000;
    const perk = allPerks().find((p) => (p.effects.extra_tech_choice ?? 0) > 0);
    expect(perk).toBeDefined();
    const before = generateTechOffers(world, e, "physics").length;
    const unlocked = unlockPerk(world, 1, perk!.id);
    expect(unlocked.ok, unlocked.messageRu).toBe(true);
    const after = generateTechOffers(world, e, "physics").length;
    expect(after).toBe(expectedOfferCount(world));
    expect(after).toBeGreaterThan(before);
  });

  it("детерминизм: одинаковый seed и состояние → одинаковая последовательность предложений", () => {
    const a = makeWorld();
    const b = makeWorld();
    for (const school of SCIENCE_ORDER) {
      const a1 = generateTechOffers(a, empire(a), school);
      const a2 = generateTechOffers(a, empire(a), school); // RNG мира продвигается на каждый вызов
      const b1 = generateTechOffers(b, empire(b), school);
      const b2 = generateTechOffers(b, empire(b), school);
      expect(a1).toEqual(b1);
      expect(a2).toEqual(b2);
    }
  });

  it("все технологии школы исследованы → пустой пул", () => {
    const world = makeWorld();
    const e = empire(world);
    for (const tech of techPool()) {
      if (tech.school !== "engineering") continue;
      if (!e.techs.completed.includes(tech.id)) e.techs.completed.push(tech.id);
    }
    expect(generateTechOffers(world, e, "engineering")).toEqual([]);
  });

  it("techPool включает TECHS_EXTRA без дублей", () => {
    const pool = techPool();
    const ids = pool.map((tech) => tech.id);
    expect(new Set(ids).size).toBe(ids.length);
    const uniqueExtra = TECHS_EXTRA.filter((extra) => !TECHS.some((tech) => tech.id === extra.id));
    expect(pool.length).toBeGreaterThanOrEqual(TECHS.length);
    expect(pool.length).toBe(TECHS.length + uniqueExtra.length);
    for (const extra of uniqueExtra) expect(ids).toContain(extra.id);
  });

  it("школы не смешиваются и офферы непустые на старте", () => {
    const world = makeWorld();
    const e = empire(world);
    for (const school of SCIENCE_ORDER) {
      const offers = generateTechOffers(world, e, school);
      expect(offers.length).toBeGreaterThan(0);
      for (const id of offers) {
        const tech = TECH_BY_ID[id];
        const extra = TECHS_EXTRA.find((entry) => entry.id === id);
        const schoolOf = tech?.school ?? extra?.school;
        expect(schoolOf).toBe(school as ScienceId);
      }
    }
  });
});
