import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/queries";
import { createFleet, createShip } from "../src/economy";
import { advancedOf, ensureFg } from "../src/fullgame";
import type { Fleet, ResourceId, World } from "../src/types";

/** Тестовый мир (детерминированный seed). */
export function testWorld(seed = 42): World {
  return createWorld(seed, MODE, BALANCE);
}

/** Выдать ресурсы империи (для проверки стоимостей). */
export function give(world: World, empireId: number, resources: Partial<Record<ResourceId, number>>): void {
  const empire = world.empires.find((e) => e.id === empireId);
  if (!empire) throw new Error("нет империи " + empireId);
  for (const key of Object.keys(resources)) {
    const res = key as ResourceId;
    const value = resources[res] ?? 0;
    empire.resources[res] += value;
  }
}

/** Владелец системы (первая по id). */
export function firstSystemOf(world: World, empireId: number): number {
  const system = world.systems.find((s) => s.ownerId === empireId);
  if (!system) throw new Error("у империи " + empireId + " нет систем");
  return system.id;
}

/** Система, которой владеет другая империя, граничащая с системами empireId (для притязаний). */
export function neighborSystemOf(world: World, empireId: number, targetEmpireId: number): number {
  for (const system of world.systems) {
    if (system.ownerId !== targetEmpireId) continue;
    return system.id;
  }
  throw new Error("у империи " + targetEmpireId + " нет систем");
}

/** Добавить флот с кораблями (без цены). */
export function addFleet(world: World, empireId: number, systemId: number, count = 1, designId = "corvette_scout"): Fleet {
  const ships = [];
  for (let i = 0; i < count; i++) ships.push(createShip(world.nextId++, designId, designId + "-" + i));
  return createFleet(world, empireId, systemId, ships, "Тестовый флот " + empireId);
}

/** Сдвинуть мнение пары на delta (через недавние действия). */
export function pushOpinion(world: World, a: number, b: number, delta: number): void {
  const rel = ensureFg(world).relations[a < b ? a + ":" + b : b + ":" + a];
  if (!rel) throw new Error("нет отношения");
  rel.recentActions += delta;
}

/** Уровень разведки (для тестов шпионажа). */
export function intelOf(world: World, a: number, b: number): number {
  return advancedOf(world, a).intel[b] ?? 0;
}
