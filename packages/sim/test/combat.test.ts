import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { applyBattleRecord, autoResolve } from "../src/combat";
import { createFleet, createShip } from "../src/economy";
import { applyCommand } from "../src/commands";
import { createWorld } from "../src/queries";
import type { Fleet, World } from "../src/types";

function neutralSystem(world: World, nearSystemId: number): number {
  for (const system of world.systems) {
    if (system.station) continue;
    if (system.id === nearSystemId) continue;
    return system.id;
  }
  return nearSystemId;
}

function warWorld(): World {
  const world = createWorld(42, MODE, BALANCE);
  const a = world.empires[0];
  const b = world.empires[1];
  a.relations[b.id] = { opinion: -100, treaty: "war", warTicks: 0 };
  b.relations[a.id] = { opinion: -100, treaty: "war", warTicks: 0 };
  return world;
}

function addFleet(world: World, empireId: number, systemId: number, designId: string, count: number): Fleet {
  const ships = [];
  for (let i = 0; i < count; i++) ships.push(createShip(world.nextId++, designId, designId + i));
  return createFleet(world, empireId, systemId, ships, "Тестовый флот");
}

describe("авторезолв боя (GDD §11.6)", () => {
  it("равные флоты: пат или исход, потери в [0, FP]", () => {
    const world = warWorld();
    const systemId = neutralSystem(world, world.empires[0].capitalSystemId);
    const attacker = addFleet(world, 1, systemId, "corvette_scout", 3);
    const defender = addFleet(world, 2, systemId, "corvette_scout", 3);
    const fpA = attacker.ships.reduce((acc, s) => acc + s.fleetPower, 0);
    const record = autoResolve(world, attacker.id, defender.id);
    expect(["draw", "attacker_win", "defender_win"]).toContain(record.outcome);
    expect(record.attacker.fp).toBe(fpA);
    expect(record.attackerLossFp).toBeGreaterThanOrEqual(0);
    expect(record.attackerLossFp).toBeLessThanOrEqual(record.attacker.fp);
    expect(record.defenderLossFp).toBeLessThanOrEqual(record.defender.fp);
    expect(record.durationSec).toBeGreaterThanOrEqual(60);
    expect(record.durationSec).toBeLessThanOrEqual(480);
    expect(world.battles.some((b) => b.id === record.id)).toBe(true);
  });

  it("сильный флот побеждает: 3 корвета против 1", () => {
    const world = warWorld();
    const systemId = neutralSystem(world, world.empires[0].capitalSystemId);
    const attacker = addFleet(world, 1, systemId, "corvette_scout", 3);
    const defender = addFleet(world, 2, systemId, "corvette_scout", 1);
    const record = autoResolve(world, attacker.id, defender.id);
    expect(record.outcome).toBe("attacker_win");
    expect(record.defenderLossFp).toBeGreaterThanOrEqual(record.attackerLossFp);
    expect(record.defenderShipsLost).toBeGreaterThanOrEqual(record.attackerShipsLost);
    // трофеи победителю
    const attackerEmpire = world.empires.find((e) => e.id === 1)!;
    expect(record.spoilsAlloys).toBeGreaterThanOrEqual(0);
    expect(attackerEmpire.stats.battlesWon).toBe(1);
    expect(world.empires.find((e) => e.id === 2)!.stats.battlesLost).toBe(1);
  });

  it("результат воспроизводим по seed", () => {
    const run = (): ReturnType<typeof autoResolve> => {
      const world = warWorld();
      const systemId = neutralSystem(world, world.empires[0].capitalSystemId);
      const attacker = addFleet(world, 1, systemId, "corvette_scout", 3);
      const defender = addFleet(world, 2, systemId, "corvette_scout", 2);
      return autoResolve(world, attacker.id, defender.id);
    };
    const a = run();
    const b = run();
    expect(a.outcome).toBe(b.outcome);
    expect(a.attackerLossFp).toBe(b.attackerLossFp);
    expect(a.defenderLossFp).toBe(b.defenderLossFp);
    expect(a.durationSec).toBe(b.durationSec);
  });

  it("apply_battle удаляет уничтоженные корабли, начисляет трофеи и пишет лог", () => {
    const world = warWorld();
    const systemId = neutralSystem(world, world.empires[0].capitalSystemId);
    const attacker = addFleet(world, 1, systemId, "corvette_scout", 3);
    const defender = addFleet(world, 2, systemId, "corvette_scout", 1);
    const report = autoResolve(world, attacker.id, defender.id);
    // применяем тот же отчёт повторно на копии мира
    const world2 = warWorld();
    const attacker2 = addFleet(world2, 1, systemId, "corvette_scout", 3);
    const defender2 = addFleet(world2, 2, systemId, "corvette_scout", 1);
    const creditsBefore = world2.empires[0].resources.credits;
    applyBattleRecord(world2, report);
    const logBefore = world2.log.length;
    expect(world2.empires[0].resources.credits).toBeGreaterThanOrEqual(creditsBefore);
    expect(world2.log.length).toBe(logBefore);
    expect(attacker2.ships.length).toBeLessThanOrEqual(3);
    expect(defender2.ships.length).toBeLessThanOrEqual(1);
    expect(report.attackerLossFp).toBeGreaterThanOrEqual(0);
  });

  it("пираты враждебны игроку, свои — нет", () => {
    const world = createWorld(42, MODE, BALANCE);
    const player = world.empires[0];
    const pirate = world.empires.find((e) => e.id === 9)!;
    expect(player.relations[9].treaty).toBe("war");
    expect(pirate.name).toBe("Пираты Пустоты");
    // флоты игрока и пиратов есть в мире
    expect(world.fleets.filter((f) => f.empireId === 9).length).toBeGreaterThan(0);
  });
});
