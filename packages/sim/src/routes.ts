/**
 * ТОРГОВЫЕ МАРШРУТЫ (M8): груз в контейнере в пути, время по числу прыжков, пошлины,
 * риск пиратов (по состоянию системы и войне), прибыль, отмена с возвратом в источник -20%.
 * Канон: 03b §6.8 (блокада), §7.8 (экономика арбитража), §9.7 (пошлины), §14.1-11/16.
 *
 * Детерминизм: риск — hash32(seed, tick, routeId); порядок обхода — по id маршрута.
 * Груз существует ровно в одном месте: списывается из казны при создании маршрута
 * и возвращается только при отмене (с -20%) или доставке (§14.1-11, «невидимый груз не дублируется»).
 */
import { RESOURCE_BY_ID } from "@sf/data";
import { clamp, empireById, logEvent } from "./economy";
import type { FullGameState, TradeRoute } from "./fullgame";
import { ensureFg, pushJournal } from "./fullgame";
import { MARKET_CFG, ROUTE_CFG } from "./market-config";
import { hash32 } from "./prng";
import {
  marketStateOf, marketStateRiskMult, regionalModifier, stationPrice, stationReputation,
} from "./market";
import type { CommandResult, ResourceId, World } from "./types";

/** Дополнительные поля маршрута (общий тип TradeRoute не расширяем — контракт общий). */
interface RouteExt extends TradeRoute {
  /** себестоимость груза в кредитах (для прибыли) */
  investedCr: number;
  sourceStationId: number;
  destStationId: number;
  /** накопленный шанс потери груза (считается при создании) */
  risk: number;
  totalTicks: number;
}

/** Локальная обёртка «зажать в диапазон»: clampRange(min, max, value). */
function clampRange(min: number, max: number, value: number): number {
  return clamp(value, min, max);
}

function deny(messageRu: string): CommandResult {
  return { ok: false, messageRu };
}

function flagOf(world: World, key: string): number {
  return world.flags[key] ?? 0;
}

function bumpPerTick(world: World, key: string, limit: number): boolean {
  const tickKey = key + ":tick";
  if (flagOf(world, tickKey) !== world.tick) {
    world.flags[tickKey] = world.tick;
    world.flags[key] = 0;
  }
  const used = flagOf(world, key);
  if (used >= limit) return false;
  world.flags[key] = used + 1;
  return true;
}

/** BFS по гиперлиниям (локальная копия, чтобы не тянуть цикл routes <-> commands). */
export function routePath(world: World, fromSystemId: number, toSystemId: number): number[] | null {
  if (fromSystemId === toSystemId) return [];
  const from = world.systems[fromSystemId];
  if (!from || !world.systems[toSystemId]) return null;
  const previous: number[] = new Array(world.systems.length).fill(-1);
  const visited: boolean[] = new Array(world.systems.length).fill(false);
  visited[fromSystemId] = true;
  const queue: number[] = [fromSystemId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const system = world.systems[current];
    if (!system) continue;
    for (const next of system.links) {
      if (visited[next]) continue;
      visited[next] = true;
      previous[next] = current;
      if (next === toSystemId) {
        const path: number[] = [];
        let cursor = next;
        while (cursor !== fromSystemId && cursor >= 0) {
          path.push(cursor);
          cursor = previous[cursor];
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Время рейса: прыжков x ticksPerJump, но не меньше 3 тактов (круг >= 6, §14.1-16). */
export function routeTravelTicks(world: World, jumps: number): number {
  const perJump = Math.max(1, world.balance.fleetSpeedTicksPerJump);
  return Math.max(MARKET_CFG.routeMinLegTicks, Math.max(1, jumps) * perJump);
}

/** Владелец торгового партнёра в системе (0 — нейтральная/ничья система). */
function systemOwner(world: World, systemId: number): number {
  const system = world.systems[systemId];
  if (!system) return 0;
  if (system.ownerId !== 0) return system.ownerId;
  return system.station ? system.station.ownerId : 0;
}

/** Пошлина на границе, 3..18% от стоимости груза (§9.7). */
export function tariffRate(world: World, empireId: number, systemId: number): number {
  const owner = systemOwner(world, systemId);
  if (owner === 0 || owner === empireId) return 0;
  const empire = empireById(world, empireId);
  const relation = empire?.relations[owner];
  if (relation && relation.treaty === "war") return ROUTE_CFG.tariffMax;
  const station = world.systems[systemId]?.station;
  const reputation = station ? stationReputation(world, empireId, station.id) : 0;
  const rate = ROUTE_CFG.tariffMin + (ROUTE_CFG.tariffMax - ROUTE_CFG.tariffMin) * ((100 - reputation) / 200);
  return clampRange(ROUTE_CFG.tariffMin, ROUTE_CFG.tariffMax, rate);
}

/** Риск рейса: база за прыжок x состояние рынка + война + пиратская база (§7.8/§8.4). */
export function routeRisk(world: World, empireId: number, fromSystemId: number, toSystemId: number): number {
  const path = routePath(world, fromSystemId, toSystemId);
  if (path === null) return 0;
  const jumps = Math.max(1, path.length);
  let risk = ROUTE_CFG.baseRiskPerJump * jumps;
  const owner = systemOwner(world, toSystemId);
  const empire = empireById(world, empireId);
  if (owner !== 0 && owner !== empireId) {
    const relation = empire?.relations[owner];
    if (relation && relation.treaty === "war") risk += ROUTE_CFG.warRisk;
  }
  const destSystem = world.systems[toSystemId];
  if (destSystem && destSystem.poi.some((poi) => poi.kind === "pirate_base")) risk += ROUTE_CFG.pirateBaseRisk;
  const fromStation = world.systems[fromSystemId]?.station;
  const toStation = destSystem?.station;
  if (fromStation) risk *= marketStateRiskMult(marketStateOf(world, fromStation.id));
  if (toStation) risk *= marketStateRiskMult(marketStateOf(world, toStation.id));
  return clampRange(0, 0.9, risk);
}

/** Активные маршруты империи (по id). */
export function activeRoutesOf(world: World, empireId: number): TradeRoute[] {
  const fg = ensureFg(world);
  return fg.routes.filter((route) => route.empireId === empireId && route.active).sort((a, b) => a.id - b.id);
}

function findRoute(world: World, routeId: number): TradeRoute | undefined {
  const fg = ensureFg(world);
  for (const route of fg.routes) if (route.id === routeId) return route;
  return undefined;
}

function asExt(route: TradeRoute): RouteExt {
  return route as RouteExt;
}

/**
 * Создать маршрут: груз уходит из казны в контейнер, время — по прыжкам, пошлина и риск
 * считаются сразу (для прогноза), прибыль — по факту продажи на станции назначения.
 */
export function createRoute(
  world: World,
  empireId: number,
  fromSystemId: number,
  toSystemId: number,
  good: ResourceId,
  qty: number,
  sellAtDest: boolean,
): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return deny("Империя не найдена");
  const from = world.systems[fromSystemId];
  const to = world.systems[toSystemId];
  if (!from || !to) return deny("Система не найдена");
  if (fromSystemId === toSystemId) return deny("Начало и конец маршрута совпадают");
  const def = RESOURCE_BY_ID[good];
  if (!def) return deny("Неизвестный товар");
  const amount = Math.floor(qty);
  if (!Number.isFinite(amount) || amount < 1) return deny("Некорректное количество");
  if (from.ownerId !== empireId && (from.station?.ownerId ?? 0) !== empireId) {
    return deny("Маршрут можно начать только в своей системе");
  }
  if (!to.knownBy.includes(empireId)) return deny("Система назначения неизвестна");
  const path = routePath(world, fromSystemId, toSystemId);
  if (path === null || path.length === 0) return deny("Нет гиперлиний до системы назначения");
  const destStation = to.station;
  if (sellAtDest) {
    if (!destStation) return deny("В системе назначения нет станции для продажи");
    if (!destStation.market[good]) return deny("Станция назначения не торгует этим товаром");
  }
  if (empire.resources[good] < amount) return deny("Недостаточно товара в казне");
  if (!bumpPerTick(world, "route:cnt:" + empireId, MARKET_CFG.routesPerTick)) {
    return deny("Лимит маршрутов: " + MARKET_CFG.routesPerTick + " в такт");
  }
  const fg = ensureFg(world);
  const duplicate = fg.routes.some(
    (route) => route.active && route.empireId === empireId
      && route.fromSystemId === fromSystemId && route.toSystemId === toSystemId && route.good === good,
  );
  if (duplicate) return deny("Такой маршрут уже существует");
  const ticks = routeTravelTicks(world, path.length);
  const sourceStation = from.station;
  const investedCr = Math.round(
    amount * (sourceStation ? stationPrice(world, sourceStation.id, good, false, empireId) : def.retail * regionalModifier(fromSystemId)),
  );
  const risk = routeRisk(world, empireId, fromSystemId, toSystemId);
  empire.resources[good] -= amount;
  const route: RouteExt = {
    id: fg.nextRouteId++,
    empireId,
    fromSystemId,
    toSystemId,
    good,
    qty: amount,
    sellAtDest,
    ticksLeft: ticks,
    active: true,
    profitLast: 0,
    investedCr,
    sourceStationId: sourceStation ? sourceStation.id : 0,
    destStationId: destStation ? destStation.id : 0,
    risk,
    totalTicks: ticks,
  };
  fg.routes.push(route);
  if (empire.isPlayer) {
    logEvent(
      world, "economy", "info",
      "Маршрут открыт: " + def.ru + " x" + amount + " -> " + to.name + " (" + ticks + " тактов, риск " +
        Math.round(risk * 100) + "%).",
      toSystemId, empireId,
    );
  }
  return { ok: true, createdId: route.id };
}

/** Отмена маршрута: груз возвращается в источник с -20% обработкой (§14.1-11). */
export function cancelRoute(world: World, empireId: number, routeId: number): CommandResult {
  const fg = ensureFg(world);
  const index = fg.routes.findIndex((route) => route.id === routeId);
  if (index < 0) return deny("Маршрут не найден");
  const route = fg.routes[index];
  if (route.empireId !== empireId) return deny("Это не ваш маршрут");
  if (!route.active) return deny("Маршрут уже завершён");
  const empire = empireById(world, empireId);
  if (!empire) return deny("Империя не найдена");
  const returned = Math.floor(route.qty * MARKET_CFG.routeCancelRefundPct);
  empire.resources[route.good] += returned;
  const lost = route.qty - returned;
  route.active = false;
  route.profitLast = 0;
  fg.routes.splice(index, 1);
  if (empire.isPlayer) {
    logEvent(
      world, "economy", "warn",
      "Маршрут отменён: возвращено " + returned + " ед., потеряно " + lost + " ед. (-20% обработки).",
      route.fromSystemId, empireId,
    );
  }
  return { ok: true };
}

// ------------------------------------------------------------------ фаза маршрутов

/** §6.9: повторная продажа в тот же порт < 10 тактов — насыщение, цена -8%. */
function saturationMult(world: World, empireId: number, stationId: number, good: ResourceId): number {
  const key = "route:last:" + empireId + ":" + stationId + ":" + good;
  const stamp = flagOf(world, key);
  // +1: значение 0 по умолчанию не должно совпадать с тактом 0
  if (stamp > 0 && world.tick + 1 - stamp < MARKET_CFG.routeSaturationTicks) return MARKET_CFG.routeSaturationMult;
  return 1;
}

function deliverSale(world: World, empireId: number, route: RouteExt, empireCreditsBefore: number): void {
  void empireCreditsBefore;
  const empire = empireById(world, empireId);
  if (!empire) return;
  const destSystem = world.systems[route.toSystemId];
  const station = destSystem?.station;
  const fg = ensureFg(world);
  if (!destSystem || !station) {
    // нет станции — груз выгружается в казну (продажа не состоялась)
    empire.resources[route.good] += route.qty;
    route.profitLast = 0;
    return;
  }
  const market = fg.markets[station.id];
  const price = stationPrice(world, station.id, route.good, false, empireId) * saturationMult(world, empireId, station.id, route.good);
  const unitPrice = Math.max(1, Math.round(price));
  const capital = market ? market.capital : 0;
  const sellable = Math.min(route.qty, Math.floor(capital / unitPrice));
  const unsold = route.qty - sellable;
  if (unsold > 0) empire.resources[route.good] += unsold;
  if (sellable <= 0) {
    route.profitLast = 0;
    if (empire.isPlayer) {
      logEvent(world, "economy", "warn", "Нет капитала на станции назначения — груз выгружен в казну.", route.toSystemId, empireId);
    }
    return;
  }
  const revenue = unitPrice * sellable;
  if (market) market.capital = Math.max(0, market.capital - revenue);
  const tariff = Math.round(revenue * tariffRate(world, empireId, route.toSystemId));
  const ownerId = systemOwner(world, route.toSystemId);
  if (tariff > 0 && ownerId !== 0 && ownerId !== empireId) {
    const owner = empireById(world, ownerId);
    if (owner) owner.resources.credits += tariff;
  }
  const net = revenue - tariff;
  empire.resources.credits += net;
  empire.stats.creditsEarned += net;
  route.profitLast = net - route.investedCr;
  world.flags["route:last:" + empireId + ":" + station.id + ":" + route.good] = world.tick + 1;
  world.tradeVolume += revenue;
  const goods = market?.goods[route.good];
  if (goods) {
    goods.qty = Math.min(Math.floor(goods.eq * 2), goods.qty + sellable);
    if (station.market[route.good]) station.market[route.good]!.stock = goods.qty;
  }
  if (empire.isPlayer) {
    const profitText = (route.profitLast >= 0 ? "+" : "") + route.profitLast + " Cr";
    logEvent(
      world, "economy", route.profitLast >= 0 ? "good" : "warn",
      "Маршрут доставлен: продано " + sellable + " ед. " + RESOURCE_BY_ID[route.good].ru + " за " + revenue +
        " Cr (пошлина " + tariff + "), прибыль " + profitText + ".",
      route.toSystemId, empireId,
    );
  }
}

/** Фаза маршрутов: отсчёт времени, риск пиратов, доставка/продажа, прибыль. */
export function routesPhase(world: World): void {
  const fg = ensureFg(world);
  if (fg.routes.length === 0) return;
  const routes = fg.routes.slice().sort((a, b) => a.id - b.id);
  for (const route of routes) {
    if (!route.active) continue;
    const ext = asExt(route);
    const empire = empireById(world, route.empireId);
    if (!empire || empire.dead) {
      route.active = false;
      continue;
    }
    route.ticksLeft -= 1;
    if (route.ticksLeft > 0) continue;
    // риск: детерминированный ролл потока маршрутов
    const roll = (hash32(world.seed, world.tick, route.id, 0x701) % 10000) / 10000;
    if (roll < ext.risk) {
      route.active = false;
      const index = fg.routes.indexOf(route);
      if (index >= 0) fg.routes.splice(index, 1);
      if (empire.isPlayer) {
        logEvent(
          world, "economy", "bad",
          "Маршрут потерян: пираты перехватили " + route.qty + " ед. " + RESOURCE_BY_ID[route.good].ru + ".",
          route.toSystemId, route.empireId,
        );
      }
      continue;
    }
    if (route.sellAtDest) deliverSale(world, route.empireId, ext, 0);
    else {
      empire.resources[route.good] += route.qty;
      route.profitLast = 0;
      if (empire.isPlayer) {
        logEvent(world, "economy", "good", "Груз доставлен в систему " + (world.systems[route.toSystemId]?.name ?? route.toSystemId) + ".", route.toSystemId, route.empireId);
      }
    }
    route.active = false;
    const index = fg.routes.indexOf(route);
    if (index >= 0) fg.routes.splice(index, 1);
  }
}

