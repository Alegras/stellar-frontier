import { describe, expect, it } from "vitest";
import { BALANCE, MODE, RESOURCE_BY_ID } from "@sf/data";
import { applyCommand } from "../src/commands";
import { createWorld } from "../src/queries";
import { tick } from "../src/tick";
import {
  adjustReputation, cancelMarketOrder, exchangeRate, exchangeTrade, marketGoodsOf, marketSlippage,
  marketStateOf, marketTradeLimit, moneyMass, placeMarketOrder, reputationCommissionPct,
  reputationPriceMult, stationAccess, stationCapitalTarget, stationMidPrice, stationPrice, stationReputation,
} from "../src/market";
import type { ResourceId, World } from "../src/types";

// ------------------------------------------------------------------ хелперы

function freshWorld(seed = 42): World {
  return createWorld(seed, MODE, BALANCE);
}

function player(world: World) {
  return world.empires.find((empire) => empire.isPlayer)!;
}

function capitalStation(world: World) {
  const empire = player(world);
  return world.systems[empire.capitalSystemId].station!;
}

function stations(world: World) {
  return world.systems.filter((system) => system.station).map((system) => system.station!);
}

function marketOf(world: World, stationId: number) {
  return world.fg!.markets[stationId];
}

function stationById(world: World, stationId: number) {
  return stations(world).find((station) => station.id === stationId)!;
}

/** Нормализует рынок (первый вызов ленивой инициализации). */
function warmMarket(world: World, stationId: number, good: ResourceId = "minerals") {
  stationMidPrice(world, stationId, good);
}

/** Целевой капитал станции (для тестов нулевого восстановления). */
function capitalTarget(world: World, stationId: number): number {
  return stationCapitalTarget(world, stationId);
}

// ------------------------------------------------------------------ цена и коридор §7.3

describe("stationPrice: формула §7.3 и коридор ±20%", () => {
  it("коридор: дефицит — не выше потолка с премией, избыток — не ниже пола", () => {
    const world = freshWorld();
    const good = "minerals";
    const def = RESOURCE_BY_ID[good];
    for (const station of stations(world).slice(0, 5)) {
      if (!station.market[good]) continue;
      warmMarket(world, station.id);
      const market = marketOf(world, station.id);
      const sm = station.market[good]!;
      // дефицит: запас в нуле, спрос >> предложения
      market.state = "famine";
      market.stateUntil = world.tick + 50;
      market.goods[good] = { qty: 0, eq: 400, demand: 120, supply: 10 };
      sm.price = 0;
      const shortage = stationMidPrice(world, station.id, good);
      expect(shortage).toBeGreaterThan(0);
      expect(shortage).toBeLessThanOrEqual(Math.round(def.retail * 1.2 * 1.05) + 1);
      // избыток: запас переполнен
      market.state = "calm";
      market.goods[good] = { qty: 800, eq: 400, demand: 10, supply: 120 };
      sm.price = 0;
      const glut = stationMidPrice(world, station.id, good);
      expect(glut).toBeGreaterThanOrEqual(Math.round(def.retail * 0.8) - 1);
      expect(shortage).toBeGreaterThan(glut);
    }
  });

  it("региональный модификатор — в каноническом диапазоне [0.88,1.12]", () => {
    const world = freshWorld();
    for (const station of stations(world).slice(0, 8)) {
      if (!station.market.minerals) continue;
      warmMarket(world, station.id);
      const market = marketOf(world, station.id);
      market.state = "calm";
      market.stateUntil = 0;
      market.goods.minerals = { qty: 400, eq: 400, demand: 40, supply: 40 };
      station.market.minerals!.price = 0;
      const price = stationMidPrice(world, station.id, "minerals");
      const ratio = price / RESOURCE_BY_ID.minerals.retail;
      expect(ratio).toBeGreaterThanOrEqual(0.88);
      expect(ratio).toBeLessThanOrEqual(1.12);
    }
  });

  it("слиппедж §7.5: depth, impact, P_exec по центру, P_new после", () => {
    const small = marketSlippage(140, 100, 1000, true);
    expect(small.depth).toBe(200);
    expect(small.impact).toBeCloseTo(0.03, 5);
    expect(small.execPrice).toBeCloseTo(142.1, 5);
    expect(small.newPrice).toBeCloseTo(144.2, 5);
    const big = marketSlippage(140, 1000, 1000, true);
    expect(big.impact).toBeCloseTo(0.2, 5);
    expect(big.newPrice).toBeCloseTo(168, 5);
    const sell = marketSlippage(140, 200, 1000, false);
    expect(sell.impact).toBeCloseTo(0.06, 5);
    expect(sell.execPrice).toBeCloseTo(140 * 0.97, 5);
    expect(sell.newPrice).toBeCloseTo(140 * 0.94, 5);
  });
});

// ------------------------------------------------------------------ репутация §7.9

describe("репутация станций §7.9", () => {
  it("шкала цены/комиссии по 4 уровням", () => {
    expect(reputationPriceMult(-100)).toBe(1.18);
    expect(reputationPriceMult(-30)).toBe(1.18);
    expect(reputationPriceMult(0)).toBe(1.03);
    expect(reputationPriceMult(10)).toBe(1.03);
    expect(reputationPriceMult(11)).toBe(0.98);
    expect(reputationPriceMult(40)).toBe(0.98);
    expect(reputationPriceMult(41)).toBe(0.95);
    expect(reputationPriceMult(100)).toBe(0.95);
    expect(reputationCommissionPct(-100)).toBe(5);
    expect(reputationCommissionPct(0)).toBe(2);
    expect(reputationCommissionPct(20)).toBe(2);
    expect(reputationCommissionPct(80)).toBe(1.5);
  });

  it("adjustReputation ограничивает -100..100 и меняет доступ", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    expect(stationReputation(world, 1, station.id)).toBe(0);
    expect(adjustReputation(world, 1, station.id, -80, "тест")).toBe(-80);
    expect(stationReputation(world, 1, station.id)).toBe(-80);
    const access = stationAccess(world, 1, station.id);
    expect(access.missions).toBe("smuggle_only");
    expect(access.priceMult).toBe(1.18);
    expect(access.commissionPct).toBe(5);
    expect(access.rareGoods).toBe(false);
    expect(adjustReputation(world, 1, station.id, 500, "тест")).toBe(100);
    const ally = stationAccess(world, 1, station.id);
    expect(ally.missions).toBe("unique");
    expect(ally.priceMult).toBe(0.95);
    expect(ally.commissionPct).toBe(1.5);
    expect(ally.rareGoods).toBe(true);
  });

  it("stationPrice: покупка дороже середины, продажа дешевле; репутация двигает цену", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const good = "minerals";
    warmMarket(world, station.id, good);
    const market = marketOf(world, station.id);
    market.state = "calm";
    market.goods[good] = { qty: 400, eq: 400, demand: 40, supply: 40 };
    station.market[good]!.price = 0;
    const mid = stationMidPrice(world, station.id, good);
    const neutralBuy = stationPrice(world, station.id, good, true, 1);
    const neutralSell = stationPrice(world, station.id, good, false, 1);
    // нейтрал: цена x1.03, комиссия 2% + спред/2 = 4%
    expect(neutralBuy).toBe(Math.round(mid * 1.03 * 1.04));
    expect(neutralSell).toBe(Math.round(mid * 1.03 * 0.96));
    expect(neutralBuy).toBeGreaterThan(mid);
    expect(neutralSell).toBeLessThan(mid);
    adjustReputation(world, 1, station.id, 50, "тест");
    const friendBuy = stationPrice(world, station.id, good, true, 1);
    expect(friendBuy).toBe(Math.round(mid * 0.95 * 1.035));
    expect(friendBuy).toBeLessThan(neutralBuy);
    adjustReputation(world, 1, station.id, -100, "тест");
    const enemyBuy = stationPrice(world, station.id, good, true, 1);
    expect(enemyBuy).toBe(Math.round(mid * 1.18 * 1.07));
    expect(enemyBuy).toBeGreaterThan(neutralBuy);
  });
});

// ------------------------------------------------------------------ восстановление §7.4

describe("восстановление цены после шока §7.4", () => {
  it("шок +18% возвращается к равновесию за 20–40 тактов", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const good = "minerals";
    warmMarket(world, station.id, good);
    const market = marketOf(world, station.id);
    // стабилизируем весь рынок, чтобы не сработали триггеры состояний
    for (const item of marketGoodsOf(market)) {
      market.goods[item] = { qty: 400, eq: 400, demand: 40, supply: 40 };
      station.market[item]!.stock = 400;
      station.market[item]!.price = 0;
    }
    market.state = "calm";
    market.stateUntil = 0;
    market.capital = 6000; // = целевой капитал столицы (20 попов) → нулевое восстановление
    for (let i = 0; i < 3; i++) tick(world);
    const eq = stationMidPrice(world, station.id, good);
    const sm = station.market[good]!;
    sm.price = Math.round(eq * 1.18);
    const start = sm.price;
    expect(start).toBeGreaterThan(eq);
    for (let i = 0; i < 34; i++) tick(world);
    const after = stationMidPrice(world, station.id, good);
    expect(after).toBeLessThan(start);
    expect(Math.abs(after - eq) / eq).toBeLessThan(0.1);
  });
});

// ------------------------------------------------------------------ состояния §8

describe("состояния рынка §8", () => {
  it("голод по еде: переход, длительность 20..120, ранний выход и остывание", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const market = marketOf(world, station.id);
    warmMarket(world, station.id, "food");
    market.capital = 6000;
    market.goods.food = { qty: 0, eq: 400, demand: 100, supply: 10 };
    station.market.food!.stock = 0;
    for (let i = 0; i < 3; i++) tick(world);
    expect(marketStateOf(world, station.id)).toBe("famine");
    expect(market.stateUntil - world.tick).toBeGreaterThanOrEqual(19);
    expect(market.stateUntil - world.tick).toBeLessThanOrEqual(120);
    // привезли еду — голод снимается раньше срока и включается остывание
    market.goods.food = { qty: 400, eq: 400, demand: 40, supply: 44 };
    station.market.food!.stock = 400;
    tick(world);
    expect(marketStateOf(world, station.id)).toBe("calm");
    expect(world.flags["mkt:cd:" + station.id]).toBeGreaterThan(world.tick);
  });

  it("множители цены состояний: голод дороже для еды, война — для сплавов (§8.4)", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    warmMarket(world, station.id, "food");
    const market = marketOf(world, station.id);
    const sm = station.market.food!;
    market.goods.food = { qty: 400, eq: 400, demand: 40, supply: 40 };
    market.state = "calm";
    sm.price = 0;
    const calmFood = stationMidPrice(world, station.id, "food");
    market.state = "famine";
    sm.price = 0;
    const famineFood = stationMidPrice(world, station.id, "food");
    expect(famineFood).toBeGreaterThan(calmFood);
    // общий коридор держит цену <= 1.2 x P_base
    expect(famineFood).toBeLessThanOrEqual(Math.round(RESOURCE_BY_ID.food.retail * 1.2) + 1);
    market.state = "war";
    const warAlloys = stationMidPrice(world, station.id, "alloys");
    market.state = "calm";
    station.market.alloys!.price = 0;
    const calmAlloys = stationMidPrice(world, station.id, "alloys");
    expect(warAlloys).toBeGreaterThanOrEqual(calmAlloys);
  });
});

// ------------------------------------------------------------------ ордера §7.7/§14

describe("лимитные ордера рынка", () => {
  it("лот ≥5, 1 ордер/такт/товар, эскроу и комиссия отмены 0.5%", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const good = "minerals";
    warmMarket(world, station.id, good);
    const empire = player(world);
    const credits0 = empire.resources.credits;
    const tooSmall = placeMarketOrder(world, 1, station.id, good, "buy", 500, 4);
    expect(tooSmall.ok).toBe(false);
    const price = stationPrice(world, station.id, good, true, 1) * 2;
    const first = placeMarketOrder(world, 1, station.id, good, "buy", price, 10);
    expect(first.ok).toBe(true);
    expect(empire.resources.credits).toBe(credits0 - price * 10);
    const second = placeMarketOrder(world, 1, station.id, good, "buy", price, 10);
    expect(second.ok).toBe(false);
    const cancelled = cancelMarketOrder(world, 1, station.id, first.createdId!);
    expect(cancelled.ok).toBe(true);
    const fee = Math.max(1, Math.ceil(price * 10 * 0.005));
    expect(empire.resources.credits).toBe(credits0 - fee);
    expect(cancelMarketOrder(world, 1, station.id, first.createdId!).ok).toBe(false);
  });

  it("исполнение против запаса: не выкупить больше 60% (резерв 40%) и лимита 8%", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const good = "minerals";
    warmMarket(world, station.id, good);
    const market = marketOf(world, station.id);
    const goods = market.goods[good]!;
    goods.eq = 400;
    goods.qty = 200;
    station.market[good]!.stock = 200;
    market.capital = 6000;
    const limit = marketTradeLimit(world, 1, goods.qty);
    expect(limit).toBeGreaterThan(0);
    const empire = player(world);
    empire.resources.credits = 5000000;
    // цена заведомо выше рынка — ордер должен исполниться по лучшей цене
    const price = stationPrice(world, station.id, good, true, 1) * 3;
    const order = placeMarketOrder(world, 1, station.id, good, "buy", price, 500);
    expect(order.ok, order.messageRu).toBe(true);
    tick(world);
    const available = goods.qty - 0.4 * goods.eq;
    expect(goods.qty).toBeGreaterThanOrEqual(Math.floor(0.4 * goods.eq));
    const remaining = market.orders.find((item) => item.id === order.createdId);
    const filled = 500 - (remaining ? remaining.qty : 0);
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThanOrEqual(Math.min(limit, Math.ceil(available)));
    expect(empire.resources[good]).toBeGreaterThan(0);
  });

  it("продажа без капитала станции почти не исполняется (§14.1-14)", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const good = "minerals";
    warmMarket(world, station.id, good);
    const market = marketOf(world, station.id);
    market.capital = 0;
    const empire = player(world);
    empire.resources.minerals = 5000;
    const order = placeMarketOrder(world, 1, station.id, good, "sell", 1, 1000);
    expect(order.ok).toBe(true);
    tick(world);
    const remaining = market.orders.find((item) => item.id === order.createdId);
    const filled = 1000 - (remaining ? remaining.qty : 0);
    // единственный источник капитала за такт — восстановление 6% от цели (внешний сектор §7.2)
    expect(filled).toBeLessThanOrEqual(20);
    expect(remaining).toBeDefined();
  });

  it("сделка не создаёт кредиты: эскроу и исполнение — перевод, не эмиссия", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    const good = "minerals";
    warmMarket(world, station.id, good);
    const market = marketOf(world, station.id);
    const capital = capitalTarget(world, station.id);
    market.capital = capital; // нулевое восстановление за такт → локальная масса стабильна
    market.state = "calm";
    market.stateUntil = 0;
    const mass0 = moneyMass(world);
    const empire = player(world);
    const price = stationPrice(world, station.id, good, true, 1) + 1;
    const local0 = empire.resources.credits + market.capital;
    const order = placeMarketOrder(world, 1, station.id, good, "buy", price, 10);
    expect(order.ok, order.messageRu).toBe(true);
    // эскроу учтён в денежной массе: масса не меняется при постановке ордера
    expect(moneyMass(world)).toBe(mass0);
    expect(empire.resources.credits + market.capital + price * 10).toBe(local0);
    tick(world);
    // исполнение переводит кредиты из эскроу в капитал станции: локальная пара сохраняется.
    // Глобальная масса за такт меняется на восстановление капиталов станций (§7.2/§9.1 — внешний сектор).
    expect(empire.resources.credits + market.capital).toBe(local0);
  });
});

// ------------------------------------------------------------------ биржа §9.2

describe("биржа CR↔энергия §9.2", () => {
  it("курс в коридоре 0.80..1.20, история ограничена 60 точками", () => {
    const world = freshWorld();
    for (let i = 0; i < 20; i++) tick(world);
    expect(exchangeRate(world)).toBeGreaterThanOrEqual(0.8);
    expect(exchangeRate(world)).toBeLessThanOrEqual(1.2);
    expect(world.fg!.exchange.history.length).toBeGreaterThan(0);
    expect(world.fg!.exchange.history.length).toBeLessThanOrEqual(60);
    for (const rate of world.fg!.exchange.history) {
      expect(rate).toBeGreaterThanOrEqual(0.8);
      expect(rate).toBeLessThanOrEqual(1.2);
    }
  });

  it("покупка/продажа с комиссией 2% + спредом 4%: round-trip убыточен; wash-trading запрещён", () => {
    const world = freshWorld();
    for (let i = 0; i < 5; i++) tick(world);
    const empire = player(world);
    const credits0 = empire.resources.credits;
    const energy0 = empire.resources.energy;
    const buy = exchangeTrade(world, 1, "buy", 20);
    expect(buy.ok).toBe(true);
    expect(empire.resources.energy).toBe(energy0 + 20);
    const spent = credits0 - empire.resources.credits;
    expect(spent).toBeGreaterThan(0);
    const wash = exchangeTrade(world, 1, "sell", 20);
    expect(wash.ok).toBe(false);
    tick(world);
    const creditsBeforeSell = empire.resources.credits;
    const sell = exchangeTrade(world, 1, "sell", 20);
    expect(sell.ok).toBe(true);
    const gained = empire.resources.credits - creditsBeforeSell;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(spent); // комиссия+спред+слиппедж
  });

  it("лимит объёма за такт и лимит по курсу", () => {
    const world = freshWorld();
    expect(exchangeTrade(world, 1, "buy", 100000).ok).toBe(false);
    expect(exchangeTrade(world, 1, "buy", 5, 0.1).ok).toBe(false);
    expect(exchangeTrade(world, 1, "buy", 5, 5.0).ok).toBe(true);
    expect(exchangeTrade(world, 1, "sell", 1).ok).toBe(false); // wash: обратная сторона в тот же такт
  });
});

// ------------------------------------------------------------------ команды и API

describe("команды рынка через applyCommand", () => {
  it("market_order / market_cancel / exchange_trade доступны из команд", () => {
    const world = freshWorld();
    const station = capitalStation(world);
    warmMarket(world, station.id);
    const price = stationPrice(world, station.id, "minerals", true, 1) * 2;
    const order = applyCommand(world, {
      type: "market_order", stationId: station.id, good: "minerals", side: "buy", price, qty: 10,
    });
    expect(order.ok).toBe(true);
    const cancel = applyCommand(world, { type: "market_cancel", stationId: station.id, orderId: order.createdId! });
    expect(cancel.ok).toBe(true);
    expect(applyCommand(world, { type: "exchange_trade", side: "buy", qty: 10 }).ok).toBe(true);
  });

  it("детерминизм: одинаковый seed → одинаковые цены, курс и состояние рынка", () => {
    const a = freshWorld(777);
    const b = freshWorld(777);
    for (let i = 0; i < 30; i++) {
      tick(a);
      tick(b);
    }
    const stationId = capitalStation(a).id;
    for (const good of ["energy", "minerals", "food"] as const) {
      expect(stationMidPrice(a, stationId, good)).toBe(stationMidPrice(b, stationId, good));
    }
    expect(exchangeRate(a)).toBe(exchangeRate(b));
    expect(a.fg!.exchange.history).toEqual(b.fg!.exchange.history);
    expect(JSON.stringify(a.fg!.markets[stationId])).toBe(JSON.stringify(b.fg!.markets[stationId]));
  });
});
