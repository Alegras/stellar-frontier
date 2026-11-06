import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/queries";
import { deserializeWorld, serializeWorld } from "../src/save";
import { tick } from "../src/tick";

describe("сохранения", () => {
  it("save → load → save побайтово идентичен", () => {
    const world = createWorld(42, MODE, BALANCE);
    const first = serializeWorld(world);
    const loaded = deserializeWorld(first);
    const second = serializeWorld(loaded);
    expect(second).toBe(first);
  });

  it("200 тактов → save/load → ещё 200 = тот же результат, что без прерывания", () => {
    const interrupted = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 200; i++) tick(interrupted);
    const json = serializeWorld(interrupted);
    const restored = deserializeWorld(json);
    for (let i = 0; i < 200; i++) tick(restored);
    const continued = serializeWorld(restored);

    const continuous = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 400; i++) tick(continuous);
    expect(serializeWorld(continuous)).toBe(continued);
  }, 120000);

  it("несовместимая версия схемы отклоняется", () => {
    const world = createWorld(42, MODE, BALANCE);
    world.schemaVersion = 99;
    expect(() => deserializeWorld(serializeWorld(world))).toThrow();
  });

  it("после 200 тактов состояние без NaN и отрицательных ресурсов", () => {
    const world = createWorld(42, MODE, BALANCE);
    for (let i = 0; i < 200; i++) tick(world);
    const json = serializeWorld(world);
    expect(json.includes("NaN")).toBe(false);
    for (const empire of world.empires) {
      for (const key of Object.keys(empire.resources)) {
        const value = empire.resources[key as keyof typeof empire.resources];
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
