import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { applyCommand, createWorld, deserializeWorld, serializeWorld } from "../src/index";
import { canColonizePlanet, createColony, createFleet, createShip, findPlanet } from "../src/economy";

function freshWorld() {
  return createWorld(42, MODE, BALANCE);
}

describe("task-62 · колонизируемые луны", () => {
  it("генерация детерминирована, у лун есть parentPlanetId/isMoon (для 3D)", () => {
    const a = freshWorld();
    const b = freshWorld();
    const moonsOf = (world: ReturnType<typeof freshWorld>) => world.systems
      .flatMap((system) => system.planets)
      .filter((planet) => planet.isMoon)
      .map((planet) => ({ id: planet.id, name: planet.name, parent: planet.parentPlanetId, hab: planet.habitability, radius: planet.orbitRadius, type: planet.type }));
    const moons = moonsOf(a);
    expect(moons.length).toBeGreaterThan(0);
    expect(moonsOf(b)).toEqual(moons);
    for (const moon of a.systems.flatMap((system) => system.planets).filter((planet) => planet.isMoon)) {
      expect(moon.parentPlanetId).toBeTypeOf("number");
      const parent = findPlanet(a, moon.parentPlanetId!)!;
      expect(parent).toBeTruthy();
      expect(parent.systemId).toBe(moon.systemId);
      expect(moon.orbitRadius).toBeGreaterThan(parent.orbitRadius);
    }
  });

  it("колонизация луны только после колонии/владения родителем", () => {
    const world = freshWorld();
    const player = world.empires[0]!;
    player.resources.credits = 1_000_000;
    player.resources.minerals = 1_000_000;
    player.resources.energy = 1_000_000;
    player.resources.alloys = 1_000_000;
    player.resources.goods = 1_000_000;
    player.resources.influence = 1_000;
    const moon = world.systems.flatMap((system) => system.planets)
      .find((planet) => planet.isMoon && planet.habitability >= 40 && planet.ownerId === 0 && planet.colonyId === 0)!;
    expect(moon).toBeTruthy();
    const parent = findPlanet(world, moon.parentPlanetId!)!;
    expect(parent.ownerId).toBe(0);
    const ship = createShip(world.nextId++, "colonizer_ark", "Ковчег", false, world);
    const fleet = createFleet(world, player.id, moon.systemId, [ship], "Луна-тест");
    expect(canColonizePlanet(world, player.id, moon).ok).toBe(false);
    const denied = applyCommand(world, { type: "colonize", fleetId: fleet.id, planetId: moon.id });
    expect(denied.ok).toBe(false);
    expect(denied.messageRu ?? "").toContain("родител");
    // колония на родителе открывает луну
    createColony(world, player, parent, { pops: { workers: 3, specialists: 0, rulers: 0 }, districts: {}, buildings: [] });
    expect(canColonizePlanet(world, player.id, moon).ok).toBe(true);
    const ok = applyCommand(world, { type: "colonize", fleetId: fleet.id, planetId: moon.id });
    expect(ok.ok, ok.messageRu).toBe(true);
    expect(world.colonies.some((colony) => colony.planetId === moon.id && colony.empireId === player.id)).toBe(true);
    expect(moon.ownerId).toBe(player.id);
    // владение родителем (без колонии) тоже разрешает
    const another = world.systems.flatMap((system) => system.planets)
      .find((planet) => planet.isMoon && planet.habitability >= 40 && planet.id !== moon.id
        && planet.ownerId === 0 && planet.colonyId === 0
        && findPlanet(world, planet.parentPlanetId!)?.ownerId === 0
        && findPlanet(world, planet.parentPlanetId!)?.colonyId === 0);
    if (another) {
      const parent2 = findPlanet(world, another.parentPlanetId!)!;
      parent2.ownerId = player.id;
      expect(canColonizePlanet(world, player.id, another).ok).toBe(true);
    }
  });

  it("save/load сохраняет луны и колонию", () => {
    const world = freshWorld();
    const json = serializeWorld(world);
    const restored = deserializeWorld(json);
    const moons = restored.systems.flatMap((system) => system.planets).filter((planet) => planet.isMoon);
    expect(moons.length).toBeGreaterThan(0);
    for (const moon of moons.slice(0, 5)) {
      expect(moon.parentPlanetId).toBeTypeOf("number");
      expect(findPlanet(restored, moon.parentPlanetId!)?.systemId).toBe(moon.systemId);
    }
    expect(serializeWorld(restored)).toBe(json);
  });
});
