/**
 * M5: авторезольв 10×10 — интеграционные проверки отчёта, потерь, трофеев и детерминизма.
 * docs/03_hybrid_gdd.md §11.6, docs/06 M5.
 */
import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { autoResolve } from "../src/combat";
import { createFleet, createShip } from "../src/economy";
import { createWorld } from "../src/queries";
import type { BattleRecord, Fleet, World } from "../src/types";

const DESIGN = "corvette_scout";

function makeWorld(seed = 42): World {
  return createWorld(seed, MODE, BALANCE);
}

/** Нейтральная система без станции — оборона не даёт бонус и не влияет на ratio. */
function neutralSystem(world: World): number {
  const found = world.systems.find((system) => !system.station);
  return found ? found.id : world.systems[0]!.id;
}

function addFleet(world: World, empireId: number, systemId: number, count: number, label: string): Fleet {
  const ships = [];
  for (let i = 0; i < count; i++) ships.push(createShip(world.nextId++, DESIGN, label + "-" + i));
  return createFleet(world, empireId, systemId, ships, label);
}

function validateRecord(record: BattleRecord, attacker: Fleet, defender: Fleet): void {
  expect(["attacker_win", "defender_win", "draw"]).toContain(record.outcome);
  expect(record.tactical).toBe(false);
  expect(record.tick).toBeGreaterThanOrEqual(0);
  expect(record.attacker.fleetId).toBe(attacker.id);
  expect(record.defender.fleetId).toBe(defender.id);
  expect(record.attacker.shipsBefore).toBe(attacker.ships.length + record.attackerShipsLost);
  expect(record.defender.shipsBefore).toBe(defender.ships.length + record.defenderShipsLost);
  expect(record.attacker.fp).toBeGreaterThan(0);
  expect(record.defender.fp).toBeGreaterThan(0);
  // потери в пределах FP и числа кораблей
  expect(record.attackerLossFp).toBeGreaterThanOrEqual(0);
  expect(record.attackerLossFp).toBeLessThanOrEqual(record.attacker.fp);
  expect(record.defenderLossFp).toBeGreaterThanOrEqual(0);
  expect(record.defenderLossFp).toBeLessThanOrEqual(record.defender.fp);
  expect(record.attackerShipsLost).toBeGreaterThanOrEqual(0);
  expect(record.attackerShipsLost).toBeLessThanOrEqual(record.attacker.shipsBefore);
  expect(record.defenderShipsLost).toBeGreaterThanOrEqual(0);
  expect(record.defenderShipsLost).toBeLessThanOrEqual(record.defender.shipsBefore);
  expect(record.durationSec).toBeGreaterThanOrEqual(60);
  expect(record.durationSec).toBeLessThanOrEqual(480);
  for (const value of [record.spoilsAlloys, record.spoilsCredits, record.durationSec, record.attackerLossFp, record.defenderLossFp]) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

describe("M5: авторезольв 10×10 (10 боёв по 10 кораблей)", () => {
  it("10 боёв 10×10: отчёт, история, потери не больше состава, трофеи только у победителя", () => {
    const world = makeWorld(42);
    const systemId = neutralSystem(world);
    const attackerId = world.empires[0]!.id;
    const defenderId = world.empires[1]!.id;
    const attackerEmpire = world.empires[0]!;
    const defenderEmpire = world.empires[1]!;
    const seenIds = new Set<string>();
    let wins = 0;
    for (let i = 0; i < 10; i++) {
      const attacker = addFleet(world, attackerId, systemId, 10, "A" + i);
      const defender = addFleet(world, defenderId, systemId, 10, "D" + i);
      const creditsA = attackerEmpire.resources.credits;
      const creditsD = defenderEmpire.resources.credits;
      const record = autoResolve(world, attacker.id, defender.id);
      validateRecord(record, attacker, defender);
      expect(seenIds.has(record.id)).toBe(false);
      seenIds.add(record.id);
      expect(world.battles.some((battle) => battle.id === record.id)).toBe(true);
      // после боя флоты действительно потеряли корабли (или ничья без потерь)
      expect(attacker.ships.length + defender.ships.length).toBeLessThanOrEqual(20);
      if (record.outcome === "attacker_win") {
        wins += 1;
        expect(record.spoilsAlloys).toBeGreaterThan(0);
        expect(record.spoilsCredits).toBeGreaterThan(0);
        expect(attackerEmpire.resources.credits).toBe(creditsA + record.spoilsCredits);
        expect(defenderEmpire.resources.credits).toBe(creditsD);
        expect(record.defenderShipsLost).toBeGreaterThan(0);
      } else if (record.outcome === "defender_win") {
        expect(record.spoilsAlloys).toBeGreaterThan(0);
        expect(record.spoilsCredits).toBeGreaterThan(0);
        expect(defenderEmpire.resources.credits).toBe(creditsD + record.spoilsCredits);
        expect(attackerEmpire.resources.credits).toBe(creditsA);
        expect(record.attackerShipsLost).toBeGreaterThan(0);
      } else {
        expect(record.spoilsAlloys).toBe(0);
        expect(record.spoilsCredits).toBe(0);
        expect(attackerEmpire.resources.credits).toBe(creditsA);
        expect(defenderEmpire.resources.credits).toBe(creditsD);
      }
    }
    expect(seenIds.size).toBe(10);
    // равные составы 10×10 при равных бонусах обороны — ничьи (ratio = 1.0)
    expect(wins).toBe(0);
  });

  it("сильный состав выигрывает и получает трофеи (10 против 4 и наоборот)", () => {
    const world = makeWorld(7);
    const systemId = neutralSystem(world);
    const [a, d] = [world.empires[0]!, world.empires[1]!];
    const strong = addFleet(world, a.id, systemId, 10, "Strong");
    const weak = addFleet(world, d.id, systemId, 4, "Weak");
    const record = autoResolve(world, strong.id, weak.id);
    expect(record.outcome).toBe("attacker_win");
    expect(record.defenderLossFp).toBeGreaterThanOrEqual(record.attackerLossFp);
    expect(record.spoilsCredits).toBeGreaterThan(0);
    // и обратный случай — обороняющийся сильнее
    const strong2 = addFleet(world, d.id, systemId, 10, "Strong2");
    const weak2 = addFleet(world, a.id, systemId, 4, "Weak2");
    const record2 = autoResolve(world, weak2.id, strong2.id);
    expect(record2.outcome).toBe("defender_win");
    expect(record2.spoilsCredits).toBeGreaterThan(0);
  });

  it("детерминизм: одинаковые миры → байт-идентичные отчёты 10 боёв", () => {
    const run = (): string => {
      const world = makeWorld(123);
      const systemId = neutralSystem(world);
      const ids = [world.empires[0]!.id, world.empires[1]!.id];
      const records: BattleRecord[] = [];
      for (let i = 0; i < 10; i++) {
        const sizeA = 10 - (i % 3);
        const sizeB = 10 - (i % 4);
        const fleetA = addFleet(world, ids[0]!, systemId, sizeA, "A" + i);
        const fleetB = addFleet(world, ids[1]!, systemId, sizeB, "B" + i);
        records.push(autoResolve(world, fleetA.id, fleetB.id));
      }
      return JSON.stringify(records);
    };
    expect(run()).toBe(run());
  }, 60000);
});
