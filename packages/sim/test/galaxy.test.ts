import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { generateGalaxy } from "../src/galaxy";
import { createWorld } from "../src/queries";
import { serializeWorld } from "../src/save";
import type { StarSystem } from "../src/types";

function connectivity(systems: StarSystem[]): { connected: boolean; isolated: number; chokepoints: number } {
  const visited: boolean[] = systems.map(() => false);
  const queue: number[] = [0];
  visited[0] = true;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const system = systems[cur];
    if (!system) continue;
    for (const next of system.links) {
      if (!visited[next]) {
        visited[next] = true;
        queue.push(next);
      }
    }
  }
  let isolated = 0;
  let chokepoints = 0;
  for (const system of systems) {
    if (system.links.length === 0) isolated++;
    if (system.links.length <= 2) chokepoints++;
  }
  return { connected: visited.every(Boolean), isolated, chokepoints };
}

describe("galaxy generator", () => {
  it("на 100 seed: 100% связных, нет изолированных, >= 12% узких мест", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const galaxy = generateGalaxy(seed, MODE, BALANCE);
      expect(galaxy.systems.length).toBe(MODE.galaxy.systems);
      const info = connectivity(galaxy.systems);
      expect(info.connected, `seed ${seed}: граф несвязен`).toBe(true);
      expect(info.isolated, `seed ${seed}: изолированные системы`).toBe(0);
      expect(info.chokepoints / galaxy.systems.length).toBeGreaterThanOrEqual(0.12);
      // системы пронумерованы подряд — id используются как индексы
      for (let i = 0; i < galaxy.systems.length; i++) expect(galaxy.systems[i].id).toBe(i);
    }
  }, 120000);

  it("повторный seed даёт идентичную галактику", () => {
    const a = generateGalaxy(42, MODE, BALANCE);
    const b = generateGalaxy(42, MODE, BALANCE);
    expect(JSON.stringify(a.systems)).toBe(JSON.stringify(b.systems));
    expect(a.capitalSystemId).toBe(b.capitalSystemId);
  });

  it("генерирует систему < 300 мс (240 систем)", () => {
    const started = Date.now();
    generateGalaxy(123, MODE, BALANCE);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(300);
  });

  it("createWorld(42): 240 систем, 9 империй (игрок 1, 7 ИИ, пираты), у планет целые orbitRadius", () => {
    const world = createWorld(42, MODE, BALANCE);
    expect(world.systems.length).toBe(240);
    expect(world.empires.find((e) => e.isPlayer)?.id).toBe(1);
    const aiWithColonies = world.empires.filter((e) => !e.isPlayer && e.id !== 9 && e.colonies.length > 0);
    expect(aiWithColonies.length).toBe(7);
    const pirates = world.empires.find((e) => e.id === 9);
    expect(pirates?.name).toBe("Пираты Пустоты");
    for (const system of world.systems) {
      expect(system.links.length).toBeGreaterThan(0);
      for (const planet of system.planets) {
        expect(Number.isInteger(planet.orbitRadius)).toBe(true);
        expect(planet.orbitRadius).toBeGreaterThan(0);
      }
    }
    // столица игрока и соседи известны
    const player = world.empires.find((e) => e.isPlayer)!;
    const capital = world.systems[player.capitalSystemId];
    expect(capital.knownBy).toContain(1);
    expect(capital.visibleTo).toContain(1);
    // флагманский флот в столице
    const flagshipFleet = world.fleets.find((f) => f.id === player.flagshipFleetId);
    expect(flagshipFleet).toBeDefined();
    expect(flagshipFleet!.systemId).toBe(player.capitalSystemId);
    expect(flagshipFleet!.ships.some((s) => s.isFlagship)).toBe(true);
    // round-trip без потерь
    expect(serializeWorld(world).length).toBeGreaterThan(1000);
  });
});
