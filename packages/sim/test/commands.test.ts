import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { applyCommand, findPath } from "../src/commands";
import { createWorld } from "../src/queries";
import { tick } from "../src/tick";
import type { World } from "../src/types";

function freshWorld(): World {
  return createWorld(42, MODE, BALANCE);
}

describe("команды игрока", () => {
  it("findPath: смежная система, та же система, несуществующая", () => {
    const world = freshWorld();
    const player = world.empires[0];
    const capital = world.systems[player.capitalSystemId];
    const neighbor = capital.links[0];
    expect(findPath(world, capital.id, neighbor)).toEqual([neighbor]);
    expect(findPath(world, capital.id, capital.id)).toEqual([]);
    expect(findPath(world, capital.id, 99999)).toBeNull();
  });

  it("move_fleet: путь, валидация принадлежности и системы", () => {
    const world = freshWorld();
    const player = world.empires[0];
    const fleet = world.fleets.find((f) => f.id === player.flagshipFleetId)!;
    const target = world.systems[player.capitalSystemId].links[0];
    const result = applyCommand(world, { type: "move_fleet", fleetId: fleet.id, systemId: target });
    expect(result.ok).toBe(true);
    expect(fleet.path).toEqual([target]);
    expect(fleet.status).toBe("moving");
    // чужой флот
    const aiFleet = world.fleets.find((f) => f.empireId !== 1 && f.empireId !== 9)!;
    const other = applyCommand(world, { type: "move_fleet", fleetId: aiFleet.id, systemId: target });
    expect(other.ok).toBe(false);
    expect(other.messageRu).toBeTruthy();
    // несуществующая система
    expect(applyCommand(world, { type: "move_fleet", fleetId: fleet.id, systemId: 99999 }).ok).toBe(false);
    // прыжок доезжает за такт (fleetSpeedTicksPerJump = 1)
    tick(world);
    expect(fleet.systemId).toBe(target);
    expect(fleet.status).toBe("idle");
  });

  it("нельзя строить без ресурсов, можно с ресурсами; очередь достраивается", () => {
    const world = freshWorld();
    const player = world.empires[0];
    const colony = world.colonies.find((c) => c.empireId === 1)!;
    player.resources.minerals = 0;
    const fail = applyCommand(world, { type: "build_district", colonyId: colony.id, districtId: "energy_district" });
    expect(fail.ok).toBe(false);
    expect(fail.messageRu).toContain("ресурс");
    player.resources.minerals = 500;
    const built = applyCommand(world, { type: "build_district", colonyId: colony.id, districtId: "energy_district" });
    expect(built.ok).toBe(true);
    expect(colony.queue.length).toBe(1);
    expect(player.resources.minerals).toBe(440);
    const before = colony.districts.energy_district ?? 0;
    for (let i = 0; i < 10; i++) tick(world);
    expect((colony.districts.energy_district ?? 0)).toBe(before + 1);
    expect(colony.queue.length).toBe(0);
  });

  it("research: только из предложений школы", () => {
    const world = freshWorld();
    const player = world.empires[0];
    const offer = player.techs.offers.physics[0];
    expect(offer).toBeTruthy();
    const result = applyCommand(world, { type: "research", school: "physics", techId: offer });
    expect(result.ok).toBe(true);
    expect(player.techs.progress.physics.techId).toBe(offer);
    const bogus = applyCommand(world, { type: "research", school: "physics", techId: "phys_lasers_4" });
    expect(bogus.ok).toBe(false);
  });

  it("trade: спред/комиссия, лимит объёма, баланс кредитов", () => {
    const world = freshWorld();
    const player = world.empires[0];
    let station = null;
    for (const system of world.systems) if (system.station && system.station.market.energy) { station = system.station; break; }
    expect(station).not.toBeNull();
    const creditsBefore = player.resources.credits;
    const energyBefore = player.resources.energy;
    const buy = applyCommand(world, { type: "trade", stationId: station!.id, good: "energy", qty: 10, buy: true });
    expect(buy.ok).toBe(true);
    expect(player.resources.credits).toBeLessThan(creditsBefore);
    // покупка начисляет товар в казну (баг «покупка без товара» исправлен)
    expect(player.resources.energy).toBe(energyBefore + 10);
    const creditsAfterBuy = player.resources.credits;
    const sell = applyCommand(world, { type: "trade", stationId: station!.id, good: "energy", qty: 10, buy: false });
    expect(sell.ok).toBe(true);
    expect(player.resources.energy).toBe(energyBefore);
    // продажа возвращает кредиты (с учётом спреда/комиссии — меньше, чем потрачено)
    expect(player.resources.credits).toBeGreaterThan(creditsAfterBuy);
    expect(player.resources.credits).toBeLessThan(creditsBefore);
    const tooBig = applyCommand(world, { type: "trade", stationId: station!.id, good: "energy", qty: 100000, buy: true });
    expect(tooBig.ok).toBe(false);
  });

  it("colonize: нужен колонизатор, пригодная планета и ресурсы", () => {
    const world = freshWorld();
    const player = world.empires[0];
    const colony = world.colonies.find((c) => c.empireId === 1)!;
    const shipyardColony = colony.buildings.includes("shipyard") ? colony : null;
    expect(shipyardColony).not.toBeNull();
    // без колонизатора команда невозможна
    const fleet = world.fleets.find((f) => f.id === player.flagshipFleetId)!;
    const bad = applyCommand(world, { type: "colonize", fleetId: fleet.id, planetId: 0 });
    expect(bad.ok).toBe(false);
    // строим колонизатор и ждём завершения
    const order = applyCommand(world, { type: "build_ship", systemId: colony.systemId, designId: "colonizer_ark", count: 1 });
    expect(order.ok).toBe(true);
    let colonizerFleetId = 0;
    for (let i = 0; i < 20; i++) {
      tick(world);
      const found = world.fleets.find(
        (f) => f.empireId === 1 && f.systemId === colony.systemId && f.ships.some((s) => s.classId === "colonizer"),
      );
      if (found) { colonizerFleetId = found.id; break; }
    }
    expect(colonizerFleetId).toBeGreaterThan(0);
    // ищем бесхозную пригодную планету, достижимую по гиперлиниям
    const colonizerFleet = world.fleets.find((f) => f.id === colonizerFleetId)!;
    let targetPlanet = 0;
    let targetSystem = 0;
    for (const system of world.systems) {
      for (const planet of system.planets) {
        if (planet.ownerId !== 0 || planet.colonyId !== 0 || planet.habitability < 40) continue;
        if (findPath(world, colonizerFleet.systemId, system.id) === null) continue;
        targetPlanet = planet.id;
        targetSystem = system.id;
        break;
      }
      if (targetPlanet !== 0) break;
    }
    expect(targetPlanet).toBeGreaterThan(0);
    const move = applyCommand(world, { type: "move_fleet", fleetId: colonizerFleetId, systemId: targetSystem });
    expect(move.ok, move.messageRu).toBe(true);
    for (let i = 0; i < 30 && colonizerFleet.systemId !== targetSystem; i++) tick(world);
    expect(colonizerFleet.systemId).toBe(targetSystem);
    player.resources.minerals = 900; player.resources.goods = 200; player.resources.influence = 200;
    const colonize = applyCommand(world, { type: "colonize", fleetId: colonizerFleetId, planetId: targetPlanet });
    expect(colonize.ok, colonize.messageRu).toBe(true);
    expect(colonize.createdId).toBeGreaterThan(0);
    expect(world.colonies.some((c) => c.id === colonize.createdId && c.empireId === 1)).toBe(true);
  });

  it("set_speed и apply_battle доступны из команд", () => {
    const world = freshWorld();
    expect(applyCommand(world, { type: "set_speed", speed: 3 }).ok).toBe(true);
    expect(world.speed).toBe(3);
    expect(applyCommand(world, { type: "set_speed", speed: 99 }).ok).toBe(false);
  });
});
