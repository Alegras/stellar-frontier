import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/queries";
import { tick } from "../src/tick";
import {
  activeRoutesOf, cancelRoute, createRoute, routePath, routeRisk, routeTravelTicks, routesPhase, tariffRate,
} from "../src/routes";
import { marketStateOf } from "../src/market";
import type { World } from "../src/types";

function freshWorld(seed = 42): World {
  return createWorld(seed, MODE, BALANCE);
}

function player(world: World) {
  return world.empires.find((empire) => empire.isPlayer)!;
}

/** Система с торговой станцией, известная игроку и достижимая из столицы. */
function stationDestination(world: World, good: "minerals" | "food" = "minerals"): number | null {
  const empire = player(world);
  const fromId = empire.capitalSystemId;
  const candidates = world.systems
    .filter((system) => system.id !== fromId && system.station && system.station.market[good] !== undefined)
    .sort((a, b) => a.id - b.id);
  for (const system of candidates) {
    const path = routePath(world, fromId, system.id);
    if (path === null) continue;
    if (!system.knownBy.includes(empire.id)) system.knownBy.push(empire.id);
    return system.id;
  }
  return null;
}

describe("торговые маршруты (M8)", () => {
  it("создание: груз уходит в контейнер, дубль (from,to,good) запрещён, лимит 2/такт", () => {
    const world = freshWorld();
    const empire = player(world);
    empire.resources.goods = 100;
    const from = world.systems[empire.capitalSystemId];
    const links = from.links.slice().sort((a, b) => a - b);
    const first = createRoute(world, 1, from.id, links[0], "goods", 20, false);
    expect(first.ok, first.messageRu).toBe(true);
    expect(empire.resources.goods).toBe(80);
    const routes = activeRoutesOf(world, 1);
    expect(routes.length).toBe(1);
    expect(routes[0].qty).toBe(20);
    expect(routes[0].ticksLeft).toBeGreaterThanOrEqual(3);
    // дубль того же маршрута запрещён
    const duplicate = createRoute(world, 1, from.id, links[0], "goods", 10, false);
    expect(duplicate.ok).toBe(false);
    // второй маршрут в такт — можно
    const second = createRoute(world, 1, from.id, links[1] ?? links[0], "goods", 10, false);
    if (links.length > 1) expect(second.ok, second.messageRu).toBe(true);
    // третий — уже лимит 2/такт
    const thirdTarget = links[2] ?? links[1] ?? links[0];
    if (links.length > 2) {
      const third = createRoute(world, 1, from.id, thirdTarget, "goods", 10, false);
      expect(third.ok).toBe(false);
      expect(third.messageRu).toContain("Лимит");
    }
  });

  it("время рейса — по прыжкам, круг >= 6 тактов (§14.1-16)", () => {
    const world = freshWorld();
    expect(routeTravelTicks(world, 0)).toBeGreaterThanOrEqual(3);
    expect(routeTravelTicks(world, 1)).toBeGreaterThanOrEqual(3);
    expect(routeTravelTicks(world, 2)).toBeGreaterThanOrEqual(3);
    expect(routeTravelTicks(world, 5)).toBe(5);
    expect(routeTravelTicks(world, 1) * 2).toBeGreaterThanOrEqual(6);
  });

  it("доставка без продажи возвращает груз в казну, маршрут закрывается", () => {
    const world = freshWorld();
    const empire = player(world);
    empire.resources.goods = 100;
    const from = world.systems[empire.capitalSystemId];
    const created = createRoute(world, 1, from.id, from.links[0], "goods", 20, false);
    expect(created.ok, created.messageRu).toBe(true);
    const route = activeRoutesOf(world, 1)[0];
    route.ticksLeft = 1; // прибытие на следующем шаге фазы
    routesPhase(world);
    expect(empire.resources.goods).toBe(100);
    expect(activeRoutesOf(world, 1).length).toBe(0);
  });

  it("отмена возвращает в источник 80% груза (-20% обработки, §14.1-11)", () => {
    const world = freshWorld();
    const empire = player(world);
    empire.resources.goods = 100;
    const from = world.systems[empire.capitalSystemId];
    const created = createRoute(world, 1, from.id, from.links[0], "goods", 100, false);
    expect(created.ok, created.messageRu).toBe(true);
    expect(empire.resources.goods).toBe(0);
    const cancelled = cancelRoute(world, 1, created.createdId!);
    expect(cancelled.ok, cancelled.messageRu).toBe(true);
    expect(empire.resources.goods).toBe(80);
    expect(activeRoutesOf(world, 1).length).toBe(0);
    // повторная отмена невозможна — груз не дублируется
    expect(cancelRoute(world, 1, created.createdId!).ok).toBe(false);
  });

  it("потеря груза пиратами: риск детерминирован, груз не возвращается", () => {
    const world = freshWorld();
    const empire = player(world);
    empire.resources.goods = 50;
    const from = world.systems[empire.capitalSystemId];
    const created = createRoute(world, 1, from.id, from.links[0], "goods", 50, false);
    expect(created.ok, created.messageRu).toBe(true);
    const route = activeRoutesOf(world, 1)[0];
    // принудительный риск 100% (поле расширения маршрута)
    (route as unknown as { risk: number }).risk = 1;
    route.ticksLeft = 1;
    routesPhase(world);
    expect(empire.resources.goods).toBe(0);
    expect(activeRoutesOf(world, 1).length).toBe(0);
  });

  it("продажа на станции: кредиты, капитал станции, насыщение порта", () => {
    const world = freshWorld();
    const destination = stationDestination(world, "minerals");
    expect(destination).not.toBeNull();
    const empire = player(world);
    empire.resources.minerals = 200;
    const from = world.systems[empire.capitalSystemId];
    const market = world.fg!.markets[world.systems[destination!].station!.id];
    market.capital = 200000;
    const creditsBefore = empire.resources.credits;
    const first = createRoute(world, 1, from.id, destination!, "minerals", 100, true);
    expect(first.ok, first.messageRu).toBe(true);
    const route = activeRoutesOf(world, 1)[0];
    route.ticksLeft = 1;
    routesPhase(world);
    const firstRevenue = empire.resources.credits - creditsBefore;
    expect(firstRevenue).toBeGreaterThan(0);
    // насыщение: повторная продажа в тот же порт в пределах 10 тактов даёт меньше
    const second = createRoute(world, 1, from.id, destination!, "minerals", 100, true);
    expect(second.ok, second.messageRu).toBe(true);
    const route2 = activeRoutesOf(world, 1)[0];
    route2.ticksLeft = 1;
    const creditsBefore2 = empire.resources.credits;
    routesPhase(world);
    const secondRevenue = empire.resources.credits - creditsBefore2;
    expect(secondRevenue).toBeGreaterThan(0);
    expect(secondRevenue).toBeLessThan(firstRevenue);
    expect(activeRoutesOf(world, 1).length).toBe(0);
  });

  it("пошлина: 0 для нейтрала, 3..18% для чужой системы, максимум при войне (§9.7)", () => {
    const world = freshWorld();
    const neutral = world.systems.find((system) => system.ownerId === 0)!;
    expect(tariffRate(world, 1, neutral.id)).toBe(0);
    const foreign = world.systems.find((system) => system.ownerId !== 0 && system.ownerId !== 1)!;
    const rate = tariffRate(world, 1, foreign.id);
    expect(rate).toBeGreaterThanOrEqual(0.03);
    expect(rate).toBeLessThanOrEqual(0.18);
    player(world).relations[foreign.ownerId] = { opinion: -100, treaty: "war", warTicks: 1 };
    expect(tariffRate(world, 1, foreign.id)).toBe(0.18);
  });

  it("риск: база за прыжок, война и блокада повышают риск", () => {
    const world = freshWorld();
    const empire = player(world);
    const from = world.systems[empire.capitalSystemId];
    const destination = stationDestination(world, "minerals");
    expect(destination).not.toBeNull();
    // нормализуем состояние рынка назначения
    marketStateOf(world, world.systems[destination!].station!.id);
    const base = routeRisk(world, 1, from.id, destination!);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(0.9);
    const market = world.fg!.markets[world.systems[destination!].station!.id];
    market.state = "blockade";
    market.stateUntil = world.tick + 50;
    const blocked = routeRisk(world, 1, from.id, destination!);
    expect(blocked).toBeGreaterThan(base);
    // война с владельцем системы назначения
    const owner = world.systems[destination!].ownerId;
    if (owner !== 0 && owner !== 1) {
      empire.relations[owner] = { opinion: -100, treaty: "war", warTicks: 1 };
      expect(routeRisk(world, 1, from.id, destination!)).toBeGreaterThan(blocked);
    }
  });

  it("валидация: чужая система-источник, неизвестная цель, продажа без станции", () => {
    const world = freshWorld();
    const empire = player(world);
    empire.resources.goods = 100;
    const from = world.systems[empire.capitalSystemId];
    const foreign = world.systems.find((system) => system.ownerId !== 0 && system.ownerId !== 1)!;
    expect(createRoute(world, 1, foreign.id, from.id, "goods", 10, false).ok).toBe(false);
    const unknown = world.systems.find((system) => !system.knownBy.includes(1) && !system.station)!;
    if (unknown) {
      expect(createRoute(world, 1, from.id, unknown.id, "goods", 10, false).ok).toBe(false);
    }
    const withoutStation = from.links.map((id) => world.systems[id]).find((system) => !system.station);
    if (withoutStation) {
      expect(createRoute(world, 1, from.id, withoutStation.id, "goods", 10, true).ok).toBe(false);
    }
    expect(createRoute(world, 1, from.id, from.id, "goods", 10, false).ok).toBe(false);
  });

  it("детерминизм: одинаковый seed и маршрут → идентичный результат рейса", () => {
    const run = (): string => {
      const world = freshWorld(4242);
      const empire = player(world);
      empire.resources.minerals = 100;
      const from = world.systems[empire.capitalSystemId];
      const destination = stationDestination(world, "minerals");
      if (destination === null) return "no-destination";
      const created = createRoute(world, 1, from.id, destination, "minerals", 50, true);
      const route = activeRoutesOf(world, 1)[0];
      route.ticksLeft = 1;
      routesPhase(world);
      return JSON.stringify({ route, credits: empire.resources.credits, created: created.ok });
    };
    expect(run()).toBe(run());
  });
});
