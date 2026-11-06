/**
 * РЫНОК (M8): локальные рынки станций (капитал, запас Q/Q*, спрос D/предложение S),
 * формула цены 03b §7.3 с коридором +-20%, состояния рынка §8, слиппедж §7.5,
 * лимитные ордера §7.7/§14, биржа CR<->энергия с курсом §9.2, репутация станций §7.9.
 *
 * Детерминизм: никаких Math.random/Date.now. «Поток рынка» — hash32(seed, tick, ...) из prng.ts,
 * чтобы не расходовать общий world.rngState (иначе поехали бы решения ИИ/галактики).
 * Порядок обхода — по stationId/goodId/orderId.
 */
import { RESOURCE_BY_ID } from "@sf/data";
import { clamp, empireById, logEvent, popsTotal } from "./economy";
import type {
  ExchangeOrder, FullGameState, LocalMarket, LocalMarketOrder, MarketState,
} from "./fullgame";
import { advancedOf, ensureFg, pushJournal } from "./fullgame";
import { MARKET_CFG, MARKET_STATE_TABLE, REPUTATION_TIERS } from "./market-config";
import type { CanonicalMarketState, ReputationTier } from "./market-config";
import { hash32 } from "./prng";
import { RESOURCE_ORDER } from "./types";
import type { CommandResult, Empire, ResourceId, StarSystem, Station, World } from "./types";

// ------------------------------------------------------------------ внутренние утилиты

const CFG = MARKET_CFG;

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

function findStation(world: World, stationId: number): Station | undefined {
  for (const system of world.systems) {
    if (system.station && system.station.id === stationId) return system.station;
  }
  return undefined;
}

/** Каноничное состояние (в общем типе есть устаревший синоним plague2). */
export function canonicalMarketState(state: MarketState): CanonicalMarketState {
  return state === "plague2" ? "plague" : state;
}

function stateCode(state: MarketState): number {
  const order: MarketState[] = ["calm", "boom", "bust", "famine", "war", "blockade", "plague", "plague2"];
  const index = order.indexOf(state);
  return index < 0 ? 0 : index;
}

// ------------------------------------------------------------------ репутация станций (§7.9)

/** Репутация империи на станции, -100..100. */
export function stationReputation(world: World, empireId: number, stationId: number): number {
  const advanced = advancedOf(world, empireId);
  return clampRange(-100, 100, advanced.reputation[stationId] ?? 0);
}

/** Множитель цены от репутации (§7.9: +18% / +3% / -2% / -5%). */
export function reputationPriceMult(reputation: number): number {
  for (const tier of REPUTATION_TIERS) {
    if (reputation <= tier.max) return tier.priceMult;
  }
  return REPUTATION_TIERS[REPUTATION_TIERS.length - 1].priceMult;
}

function reputationTier(reputation: number): ReputationTier {
  for (const tier of REPUTATION_TIERS) {
    if (reputation <= tier.max) return tier;
  }
  return REPUTATION_TIERS[REPUTATION_TIERS.length - 1];
}

/** Комиссия станции в процентах от сделки (5% / 2% / 2% / 1.5%, §7.9). */
export function reputationCommissionPct(reputation: number): number {
  return reputationTier(reputation).commissionPct;
}

export interface StationAccess {
  reputation: number;
  priceMult: number;
  commissionPct: number;
  rareGoods: boolean;
  missions: "smuggle_only" | "normal" | "elite" | "unique";
}

/** Доступ к станции: цена/комиссия/редкие товары/класс миссий (§7.9). */
export function stationAccess(world: World, empireId: number, stationId: number): StationAccess {
  const reputation = stationReputation(world, empireId, stationId);
  const tier = reputationTier(reputation);
  return {
    reputation,
    priceMult: tier.priceMult,
    commissionPct: tier.commissionPct,
    rareGoods: tier.rareGoods,
    missions: tier.missions,
  };
}

/** Изменить репутацию на станции; возвращает новое значение. */
export function adjustReputation(world: World, empireId: number, stationId: number, delta: number, reason: string): number {
  const advanced = advancedOf(world, empireId);
  const current = clampRange(-100, 100, advanced.reputation[stationId] ?? 0);
  const step = Math.trunc(delta);
  if (step === 0) return current;
  const next = clampRange(-100, 100, current + step);
  const applied = next - current;
  if (applied === 0) return current;
  advanced.reputation[stationId] = next;
  const empire = empireById(world, empireId);
  if (empire?.isPlayer) {
    const fg = ensureFg(world);
    pushJournal(
      fg,
      world.tick,
      "reputation",
      reason + ": репутация на станции " + stationId + " " + (applied > 0 ? "+" : "") + applied + " (итог " + next + ").",
    );
  }
  return next;
}

// ------------------------------------------------------------------ состояние рынка (§8)

/** Множитель цены состояния (§8.4) для конкретного товара. */
export function marketStatePriceMult(state: MarketState, good: ResourceId): number {
  const effect = MARKET_STATE_TABLE[canonicalMarketState(state)];
  if (good === "food" && effect.foodPriceMult !== undefined) return effect.foodPriceMult;
  if (good === "alloys" && effect.alloysPriceMult !== undefined) return effect.alloysPriceMult;
  if (good === "goods" && effect.goodsPriceMult !== undefined) return effect.goodsPriceMult;
  return effect.priceMult;
}

/** Множитель производства состояния (§8.4) — для economy.ts/UI. */
export function marketStateProductionMult(state: MarketState): number {
  return MARKET_STATE_TABLE[canonicalMarketState(state)].productionMult;
}

/** Множитель торгового риска состояния (§8.4) — для routes.ts. */
export function marketStateRiskMult(state: MarketState): number {
  return MARKET_STATE_TABLE[canonicalMarketState(state)].riskMult;
}

/** Название состояния для UI. */
export function marketStateTitleRu(state: MarketState): string {
  return MARKET_STATE_TABLE[canonicalMarketState(state)].titleRu;
}

// ------------------------------------------------------------------ рынок станции

function createMarket(station: Station, system: StarSystem): LocalMarket {
  return {
    stationId: station.id,
    systemId: system.id,
    capital: station.market.energy ? 12000 : 6000,
    goods: {},
    orders: [],
    state: "calm",
    stateUntil: 0,
    lastShockTick: 0,
  };
}

/** Ленивый доступ к расширенному рынку станции (в т.ч. станций, построенных после старта). */
export function localMarket(world: World, stationId: number): LocalMarket | undefined {
  const fg = ensureFg(world);
  const existing = fg.markets[stationId];
  if (existing) return existing;
  const station = findStation(world, stationId);
  if (!station) return undefined;
  const system = world.systems[station.systemId];
  if (!system) return undefined;
  const market = createMarket(station, system);
  fg.markets[stationId] = market;
  return market;
}

/** Товары рынка в каноническом порядке. */
export function marketGoodsOf(market: LocalMarket): ResourceId[] {
  return RESOURCE_ORDER.filter((good) => market.goods[good] !== undefined);
}

interface MarketCtx {
  market: LocalMarket;
  station: Station;
  system: StarSystem;
}

function marketCtx(world: World, stationId: number): MarketCtx | undefined {
  const station = findStation(world, stationId);
  if (!station) return undefined;
  const system = world.systems[station.systemId];
  if (!system) return undefined;
  const market = localMarket(world, stationId);
  if (!market) return undefined;
  return { market, station, system };
}

/**
 * Нормализация рынка под канон: Q* = D x 8 (в диапазоне целей базовой фазы рынка среза),
 * D/S с детерминированной дисперсией (часть рынков в дефиците, часть в избытке),
 * стартовый запас приводится в [0.6Q*, 1.6Q*], иначе вся галактика начинала бы в bust.
 */
function ensureNormalized(world: World, ctx: MarketCtx): void {
  const key = "mkt:norm:" + ctx.market.stationId;
  if (flagOf(world, key) === 1) return;
  const systemId = ctx.system.id;
  const target = 400 + (systemId % 4) * 200;
  for (const good of RESOURCE_ORDER) {
    const sm = ctx.station.market[good];
    const def = RESOURCE_BY_ID[good];
    if (!sm || !def) continue;
    const goodCode = RESOURCE_ORDER.indexOf(good) + 1;
    const delta = (hash32(world.seed, ctx.market.stationId, goodCode) % 9) - 4;
    const base = Math.max(8, Math.round(target / 8));
    const demand = Math.max(4, base + delta);
    const supply = Math.max(1, base - delta);
    const previous = ctx.market.goods[good];
    const rawQty = previous ? previous.qty : sm.stock;
    const qty = clampRange(Math.round(target * 0.6), Math.round(target * 1.6), Math.max(0, Math.round(rawQty)));
    ctx.market.goods[good] = { qty, eq: target, demand, supply };
    if (!(sm.price > 0)) sm.price = def.retail;
    sm.stock = qty;
  }
  world.flags[key] = 1;
}

// ------------------------------------------------------------------ цена (§7.2/§7.3/§7.6)

/** Региональный модификатор R в [0.88,1.12]; совпадает с базовой фазой рынка среза. */
export function regionalModifier(systemId: number): number {
  return 0.90 + 0.005 * (systemId % 5);
}

/** Равновесная цена: P_base x R x Sc x T (без репутации), коридор +-20%, премия дефицита. */
function equilibriumPrice(world: World, ctx: MarketCtx, good: ResourceId): number {
  void world;
  const def = RESOURCE_BY_ID[good];
  if (!def) return 1;
  const goods = ctx.market.goods[good];
  const base = def.retail;
  if (!goods) return Math.max(1, base * regionalModifier(ctx.system.id));
  const qty = Math.max(0, goods.qty);
  const eq = Math.max(1, goods.eq);
  const demand = Math.max(1, goods.demand);
  const supply = Math.max(1, goods.supply);
  // §7.3: Sc = 1 + 0.35 x (D - S)/max(1,S) + 0.20 x (Q* - Q)/Q* (дефицит/избыток из qty/eq)
  const sc = clampRange(0.75, 1.25, 1 + (0.35 * (demand - supply)) / supply + (0.20 * (eq - qty)) / eq);
  const mult = clampRange(
    CFG.priceCorridorMin,
    CFG.priceCorridorMax,
    regionalModifier(ctx.system.id) * sc * marketStatePriceMult(ctx.market.state, good),
  );
  let price = base * mult;
  // §7.6: при Q < Q_min «последние единицы» дороже коридора на премию
  if (qty < CFG.minStockFraction * eq) {
    price = Math.max(price, base * CFG.priceCorridorMax * CFG.deficitPremium);
  }
  return Math.max(1, price);
}

/** Середина рынка (без спреда/комиссии/репутации), >= 1. */
export function stationMidPrice(world: World, stationId: number, good: ResourceId): number {
  const ctx = marketCtx(world, stationId);
  if (!ctx) return 0;
  ensureNormalized(world, ctx);
  const sm = ctx.station.market[good];
  if (!sm) return 0;
  const stored = sm.price > 0 ? sm.price : equilibriumPrice(world, ctx, good);
  return Math.max(1, Math.round(stored));
}

/** Торговый ранг империи (§7.6): колонии + наука, 0..10. */
export function tradeRank(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  const rank = Math.floor(empire.colonies.length / 2) + Math.floor(empire.stats.techsResearched / 15);
  return clampRange(0, 10, rank);
}

/**
 * Цена сделки для империи: середина x репутация x (1 + комиссия + спред/2) для покупки,
 * x (1 - комиссия - спред/2) для продажи. Спред из World.balance (§7.1: 4%).
 */
export function stationPrice(world: World, stationId: number, good: ResourceId, buy: boolean, empireId?: number): number {
  const mid = stationMidPrice(world, stationId, good);
  if (mid <= 0) return 0;
  let reputation = 0;
  if (empireId !== undefined && empireById(world, empireId)) {
    reputation = stationReputation(world, empireId, stationId);
  }
  const priceMult = reputationPriceMult(reputation);
  const feePct = reputationCommissionPct(reputation) + world.balance.marketSpreadPct / 2;
  const factor = buy ? 1 + feePct / 100 : 1 - feePct / 100;
  return Math.max(1, Math.round(mid * priceMult * factor));
}

/** Слиппедж сделки (§7.5): depth = max(50, 0.2Q); impact = clampRange(0, 0.2, 0.06 x qty/depth). */
export function marketSlippage(
  price: number,
  qty: number,
  stock: number,
  buy = true,
): { depth: number; impact: number; execPrice: number; newPrice: number } {
  const depth = Math.max(CFG.slippageDepthMin, Math.floor(Math.max(0, stock) * CFG.slippageDepthFraction));
  const impact = clampRange(0, CFG.slippageImpactMax, (CFG.slippageImpactCoeff * Math.max(0, qty)) / depth);
  const sign = buy ? 1 : -1;
  return {
    depth,
    impact,
    execPrice: price * (1 + (sign * impact) / 2),
    newPrice: price * (1 + sign * impact),
  };
}

/** Предел объёма рыночной сделки за такт: min(8% x Q, 20 + 2 x trade_rank) (§7.6). */
export function marketTradeLimit(world: World, empireId: number, stock: number): number {
  const rank = tradeRank(world, empireId);
  const fraction = Math.floor(Math.max(0, stock) * CFG.buyLimitFraction);
  const flat = CFG.buyLimitFlat + CFG.buyLimitPerRank * rank;
  return Math.max(0, Math.min(fraction, flat));
}

/**
 * Денежная масса внутренней экономики: кошельки + капиталы станций + эскроу ордеров
 * (§9.1/§13.4-2, для property-инвариантов «сделка не создаёт кредит»).
 */
export function moneyMass(world: World): number {
  let total = 0;
  for (const empire of world.empires) total += empire.resources.credits;
  const fg = ensureFg(world);
  const ids = Object.keys(fg.markets).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const market = fg.markets[id];
    total += market.capital;
    for (const order of market.orders) {
      if (order.side === "buy") total += order.price * order.qty;
    }
  }
  for (const order of fg.exchange.orders) {
    if (order.side === "buy") total += Math.ceil((order.price * order.qty) / 10000);
  }
  return total;
}

/** Текущее состояние рынка станции (calm, если рынка нет). */
export function marketStateOf(world: World, stationId: number): MarketState {
  const market = localMarket(world, stationId);
  return market ? market.state : "calm";
}

// ------------------------------------------------------------------ ордера рынка (§7.7/§14)

interface MarketOrderExt extends LocalMarketOrder {
  good: ResourceId;
}

function orderGoodOf(order: LocalMarketOrder): ResourceId | undefined {
  return (order as MarketOrderExt).good;
}

/** Пер-тактовый счётчик с лимитом (рейт-лимиты §14.3). */
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

function cancelFee(price: number, qty: number): number {
  return Math.max(1, Math.ceil(price * qty * CFG.orderCancelFeePct));
}

/** Возврат эскроу ордера; fee=true — комиссия отмены 0.5% в пользу рынка. */
function refundOrder(empire: Empire, order: LocalMarketOrder, good: ResourceId, fee: boolean): void {
  const charge = fee ? cancelFee(order.price, order.qty) : 0;
  if (order.side === "buy") {
    empire.resources.credits += Math.max(0, order.price * order.qty - charge);
  } else {
    empire.resources[good] += order.qty;
    if (charge > 0) empire.resources.credits = Math.max(0, empire.resources.credits - charge);
  }
}

/** Лимитный ордер: лот >= 5, 1 ордер/такт/товар, эскроу денег/товара (§14.1-13). */
export function placeMarketOrder(
  world: World,
  empireId: number,
  stationId: number,
  good: ResourceId,
  side: "buy" | "sell",
  price: number,
  qty: number,
): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return deny("Империя не найдена");
  const ctx = marketCtx(world, stationId);
  if (!ctx) return deny("Станция не найдена");
  if (!RESOURCE_BY_ID[good]) return deny("Неизвестный товар");
  if (!ctx.station.market[good]) return deny("Этот товар здесь не торгуется");
  const amount = Math.floor(qty);
  const limitPrice = Math.floor(price);
  if (!Number.isFinite(amount) || amount < CFG.orderLot) return deny("Минимальный лот — " + CFG.orderLot + " ед.");
  if (!Number.isFinite(limitPrice) || limitPrice < 1) return deny("Некорректная цена");
  const lastKey = "mkt:ord:last:" + empireId + ":" + stationId + ":" + good;
  // +1: значение 0 по умолчанию не должно совпадать с тактом 0
  if (flagOf(world, lastKey) === world.tick + 1) return deny("Один ордер на товар за такт");
  if (!bumpPerTick(world, "mkt:trd:" + empireId, CFG.marketTradesPerTick)) {
    return deny("Слишком много рыночных операций за такт");
  }
  if (side === "buy") {
    const escrow = limitPrice * amount;
    if (empire.resources.credits < escrow) return deny("Не хватает кредитов для эскроу ордера");
    empire.resources.credits -= escrow;
  } else {
    if (empire.resources[good] < amount) return deny("Недостаточно товара для ордера");
    empire.resources[good] -= amount;
  }
  ensureFg(world);
  const order: MarketOrderExt = {
    id: world.nextId++,
    empireId,
    side,
    price: limitPrice,
    qty: amount,
    createdTick: world.tick,
    good,
  };
  ctx.market.orders.push(order);
  world.flags[lastKey] = world.tick + 1;
  if (empire.isPlayer) {
    logEvent(
      world,
      "economy",
      "info",
      (side === "buy" ? "Ордер на покупку " : "Ордер на продажу ") + amount + " ед. " +
        RESOURCE_BY_ID[good].ru + " по " + limitPrice + " Cr.",
      ctx.system.id,
      empireId,
    );
  }
  return { ok: true, createdId: order.id };
}

/** Отмена лимитного ордера: комиссия 0.5% рынку, 5 отмен/такт (§14.3). */
export function cancelMarketOrder(world: World, empireId: number, stationId: number, orderId: number): CommandResult {
  const ctx = marketCtx(world, stationId);
  if (!ctx) return deny("Станция не найдена");
  const index = ctx.market.orders.findIndex((order) => order.id === orderId);
  if (index < 0) return deny("Ордер не найден");
  const order = ctx.market.orders[index];
  if (order.empireId !== empireId) return deny("Это не ваш ордер");
  if (!bumpPerTick(world, "mkt:cnl:" + empireId, CFG.cancelsPerTick)) return deny("Слишком много отмен за такт");
  const good = orderGoodOf(order);
  const empire = empireById(world, empireId);
  if (empire && good) refundOrder(empire, order, good, true);
  ctx.market.orders.splice(index, 1);
  if (empire?.isPlayer) logEvent(world, "economy", "info", "Ордер отменён.", ctx.system.id, empireId);
  return { ok: true };
}

// ------------------------------------------------------------------ биржа §9.2/§7.7

/** Текущий курс CR<->энергия (0.80..1.20, §9.2). */
export function exchangeRate(world: World): number {
  const fg = ensureFg(world);
  return clampRange(CFG.exchangeRateMin, CFG.exchangeRateMax, fg.exchange.rate);
}

/** Лимит объёма сделки на бирже за такт. */
export function exchangeMaxQty(world: World, empireId: number): number {
  const rank = tradeRank(world, empireId);
  return Math.min(CFG.exchangeMaxQtyPerTick, CFG.exchangeMaxQtyFlat + CFG.exchangeMaxQtyPerRank * rank);
}

function exchangePerTickRemaining(world: World, empireId: number, maxQty: number): number {
  const key = "exch:q:" + empireId;
  const tickKey = "exch:qt:" + empireId;
  if (flagOf(world, tickKey) !== world.tick) {
    world.flags[tickKey] = world.tick;
    world.flags[key] = 0;
  }
  return Math.max(0, maxQty - flagOf(world, key));
}

/** Рыночная сделка на бирже: CR <-> энергия по курсу, комиссия 2% + спред 4%, слиппедж. */
export function exchangeTrade(
  world: World,
  empireId: number,
  side: "buy" | "sell",
  qty: number,
  limitRate?: number,
): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return deny("Империя не найдена");
  const amount = Math.floor(qty);
  if (!Number.isFinite(amount) || amount < 1) return deny("Некорректный объём");
  const maxQty = exchangeMaxQty(world, empireId);
  const remaining = exchangePerTickRemaining(world, empireId, maxQty);
  if (amount > remaining) return deny("Лимит биржи за такт: осталось " + remaining + " ед.");
  const sideCode = side === "buy" ? 1 : 2;
  const sideKey = "exch:s:" + empireId;
  const sideTickKey = "exch:st:" + empireId;
  const previousSide = flagOf(world, sideKey);
  if (previousSide !== 0 && previousSide !== sideCode && flagOf(world, sideTickKey) === world.tick) {
    return deny("Wash-trading запрещён: один кошелёк — один актор (§14.1-7)");
  }
  const rate = exchangeRate(world);
  const impact = clampRange(0, CFG.slippageImpactMax, (CFG.slippageImpactCoeff * amount) / CFG.exchangeDepth);
  const feePct = world.balance.marketCommissionPct + world.balance.marketSpreadPct;
  const fg = ensureFg(world);
  if (side === "buy") {
    const unit = rate * (1 + impact / 2) * (1 + feePct / 100);
    if (limitRate !== undefined && unit > limitRate) return deny("Курс хуже лимита");
    const total = Math.max(1, Math.round(unit * amount));
    if (empire.resources.credits < total) return deny("Не хватает кредитов");
    empire.resources.credits -= total;
    empire.resources.energy += amount;
    world.tradeVolume += total;
    if (empire.isPlayer) {
      logEvent(world, "economy", "info", "Куплено " + amount + " энергии на бирже за " + total + " Cr.", undefined, empireId);
    }
  } else {
    if (empire.resources.energy < amount) return deny("Недостаточно энергии");
    const unit = rate * (1 - impact / 2) * (1 - feePct / 100);
    if (limitRate !== undefined && unit < limitRate) return deny("Курс хуже лимита");
    const total = Math.max(0, Math.round(unit * amount));
    empire.resources.energy -= amount;
    empire.resources.credits += total;
    empire.stats.creditsEarned += total;
    world.tradeVolume += total;
    if (empire.isPlayer) {
      logEvent(world, "economy", "info", "Продано " + amount + " энергии на бирже за " + total + " Cr.", undefined, empireId);
    }
  }
  world.flags[sideKey] = sideCode;
  world.flags[sideTickKey] = world.tick;
  world.flags["exch:q:" + empireId] = (world.flags["exch:q:" + empireId] ?? 0) + amount;
  fg.exchange.volume += amount;
  return { ok: true };
}

/**
 * Лимитный ордер на биржу. price — курс в базисных пунктах (10000 = 1.0 Cr за единицу),
 * qty — объём энергии. Ордер живёт 3 такта, эскроу обязателен (§14.1-7/§14.3).
 */
export function placeExchangeOrder(
  world: World,
  empireId: number,
  side: "buy" | "sell",
  price: number,
  qty: number,
): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return deny("Империя не найдена");
  const rateBp = Math.round(price);
  const amount = Math.floor(qty);
  if (!Number.isFinite(amount) || amount < 1) return deny("Некорректный объём");
  if (!Number.isFinite(rateBp) || rateBp < CFG.exchangeRateMin * 10000 || rateBp > CFG.exchangeRateMax * 10000) {
    return deny("Курс ордера вне коридора 0.80..1.20");
  }
  const maxQty = exchangeMaxQty(world, empireId);
  if (amount > maxQty) return deny("Лимит объёма биржи: " + maxQty + " ед.");
  if (side === "buy") {
    const escrow = Math.ceil((rateBp * amount) / 10000);
    if (empire.resources.credits < escrow) return deny("Не хватает кредитов для эскроу");
    empire.resources.credits -= escrow;
  } else {
    if (empire.resources.energy < amount) return deny("Недостаточно энергии");
    empire.resources.energy -= amount;
  }
  const fg = ensureFg(world);
  const order: ExchangeOrder = {
    id: fg.exchange.nextOrderId++,
    empireId,
    side,
    price: rateBp,
    qty: amount,
    createdTick: world.tick,
    expiresTick: world.tick + CFG.exchangeOrderLifetimeTicks,
  };
  fg.exchange.orders.push(order);
  return { ok: true, createdId: order.id };
}

/** Отмена лимитного биржевого ордера с возвратом эскроу. */
export function cancelExchangeOrder(world: World, empireId: number, orderId: number): CommandResult {
  const fg = ensureFg(world);
  const index = fg.exchange.orders.findIndex((order) => order.id === orderId);
  if (index < 0) return deny("Ордер не найден");
  const order = fg.exchange.orders[index];
  if (order.empireId !== empireId) return deny("Это не ваш ордер");
  const empire = empireById(world, empireId);
  if (empire) refundExchangeOrder(empire, order);
  fg.exchange.orders.splice(index, 1);
  return { ok: true };
}

function refundExchangeOrder(empire: Empire, order: ExchangeOrder): void {
  if (order.side === "buy") {
    empire.resources.credits += Math.ceil((order.price * order.qty) / 10000);
  } else {
    empire.resources.energy += order.qty;
  }
}

/** Встречные ордера биржи: сделки только между разными кошельками (wash-trading запрещён). */
function executeExchangeOrders(world: World, fg: FullGameState): void {
  if (fg.exchange.orders.length === 0) return;
  const alive: ExchangeOrder[] = [];
  for (const order of fg.exchange.orders.slice().sort((a, b) => a.id - b.id)) {
    if (world.tick > order.expiresTick && order.qty > 0) {
      const empire = empireById(world, order.empireId);
      if (empire) refundExchangeOrder(empire, order);
      continue;
    }
    alive.push(order);
  }
  const commissionPct = world.balance.marketCommissionPct;
  for (let guard = 0; guard < 64; guard++) {
    const buys = alive
      .filter((o) => o.side === "buy" && o.qty > 0 && world.tick <= o.expiresTick)
      .sort((a, b) => b.price - a.price || a.id - b.id);
    const sells = alive
      .filter((o) => o.side === "sell" && o.qty > 0 && world.tick <= o.expiresTick)
      .sort((a, b) => a.price - b.price || a.id - b.id);
    const buy = buys[0];
    if (!buy) break;
    // один кошелёк = один актор: встречная сделка только с чужим ордером (§14.1-7)
    const sell = sells.find((order) => order.empireId !== buy.empireId);
    if (!sell) break;
    if (buy.price < sell.price) break;
    const buyer = empireById(world, buy.empireId);
    const seller = empireById(world, sell.empireId);
    if (!buyer || !seller) {
      alive.splice(alive.indexOf(buy), 1);
      alive.splice(alive.indexOf(sell), 1);
      continue;
    }
    const qty = Math.min(buy.qty, sell.qty);
    const execBp = Math.round((buy.price + sell.price) / 2);
    const value = Math.round((execBp * qty) / 10000);
    const fee = Math.max(1, Math.round((value * commissionPct) / 100));
    const reserved = Math.ceil((buy.price * qty) / 10000);
    buyer.resources.credits += Math.max(0, reserved - value - fee);
    buyer.resources.energy += qty;
    seller.resources.credits += Math.max(0, value - fee);
    buy.qty -= qty;
    sell.qty -= qty;
    fg.exchange.volume += qty;
    world.tradeVolume += value;
    if (buy.qty <= 0) alive.splice(alive.indexOf(buy), 1);
    if (sell.qty <= 0) alive.splice(alive.indexOf(sell), 1);
  }
  fg.exchange.orders = alive;
}

/** Обновление курса по формуле §9.2 (возврат к 1:1 + давление спроса + шум потока рынка). */
function updateExchangeRate(world: World, fg: FullGameState): void {
  const stationIds = Object.keys(fg.markets).map(Number).sort((a, b) => a - b);
  let demand = 0;
  let supply = 0;
  for (const stationId of stationIds) {
    const energy = fg.markets[stationId].goods.energy;
    if (!energy) continue;
    demand += energy.demand;
    supply += energy.supply;
  }
  const pressure = (CFG.exchangeDemandPressure * (demand - supply)) / Math.max(1, supply);
  const noiseBits = hash32(world.seed, world.tick, 0x5eed) % 2001;
  const noise = (noiseBits / 1000 - 1) * CFG.exchangeNoise;
  const previous = fg.exchange.rate;
  const next = clampRange(
    CFG.exchangeRateMin,
    CFG.exchangeRateMax,
    previous + CFG.exchangeMeanReversion * (1 - previous) + pressure + noise,
  );
  fg.exchange.rate = Math.round(next * 10000) / 10000;
  fg.exchange.history.push(fg.exchange.rate);
  if (fg.exchange.history.length > CFG.exchangeHistoryLimit) {
    fg.exchange.history.splice(0, fg.exchange.history.length - CFG.exchangeHistoryLimit);
  }
}

// ------------------------------------------------------------------ состояния рынка: триггеры §8.3

function systemPops(world: World, systemId: number): number {
  let total = 0;
  for (const colony of world.colonies) {
    if (colony.systemId === systemId) total += popsTotal(colony.pops);
  }
  return total;
}

function isAtWar(world: World, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === 9 || b === 9) return true;
  const empire = empireById(world, a);
  if (!empire) return false;
  const relation = empire.relations[b];
  return relation !== undefined && relation.treaty === "war";
}

function longWarActive(world: World, empireId: number): boolean {
  if (empireId === 0) return false;
  const empire = empireById(world, empireId);
  if (!empire) return false;
  for (const key of Object.keys(empire.relations)) {
    const otherId = Number(key);
    if (otherId === 9) continue; // пиратская война не делает экономику военной
    const relation = empire.relations[otherId];
    if (relation.treaty === "war" && relation.warTicks > 20) return true;
  }
  return false;
}

function blockadeRatio(world: World, ctx: MarketCtx): number {
  const station = ctx.station;
  const owner = station.ownerId !== 0 ? station.ownerId : ctx.system.ownerId;
  let defense = Math.max(0, Math.round(station.hp / 50));
  let hostile = 0;
  for (const fleet of world.fleets) {
    if (fleet.systemId !== ctx.system.id || fleet.ships.length === 0) continue;
    let fp = 0;
    for (const ship of fleet.ships) fp += ship.fleetPower;
    if (owner !== 0 && fleet.empireId === owner) {
      defense += fp;
      continue;
    }
    const enemy = owner === 0 ? fleet.empireId === 9 : isAtWar(world, fleet.empireId, owner);
    if (enemy) hostile += fp;
  }
  return hostile / Math.max(1, defense);
}

function hasPlague(world: World, ctx: MarketCtx): boolean {
  if (flagOf(world, "plague:" + ctx.system.id) === 1) return true;
  for (const colony of world.colonies) {
    if (colony.systemId !== ctx.system.id) continue;
    if (colony.stability < 25) return true;
  }
  return false;
}

/** Триггер состояния (§8.3). Приоритет: блокада -> голод -> война -> мор -> подъём/спад. */
function detectStateTrigger(world: World, ctx: MarketCtx): CanonicalMarketState | null {
  const market = ctx.market;
  if (blockadeRatio(world, ctx) > 0.5) return "blockade";
  const food = market.goods.food;
  if (food) {
    const lowKey = "mkt:lowfood:" + market.stationId;
    if (food.qty < food.eq * 0.15) {
      world.flags[lowKey] = flagOf(world, lowKey) + 1;
    } else {
      world.flags[lowKey] = 0;
    }
    if (flagOf(world, lowKey) >= 2 || food.demand / Math.max(1, food.supply) > 1.3) return "famine";
  }
  const owner = ctx.station.ownerId !== 0 ? ctx.station.ownerId : ctx.system.ownerId;
  if (longWarActive(world, owner)) return "war";
  if (hasPlague(world, ctx)) return "plague";
  let totalQty = 0;
  let totalEq = 0;
  for (const good of marketGoodsOf(market)) {
    const goods = market.goods[good];
    if (!goods) continue;
    totalQty += goods.qty;
    totalEq += goods.eq;
  }
  if (totalEq > 0) {
    if (totalQty < totalEq * 0.85) return "boom";
    if (totalQty > totalEq * 1.4) return "bust";
  }
  return null;
}

function earlyExitState(world: World, ctx: MarketCtx, state: CanonicalMarketState): boolean {
  if (state === "famine") {
    const food = ctx.market.goods.food;
    if (!food) return true;
    return food.qty >= food.eq * 0.5 && food.demand / Math.max(1, food.supply) < 1.0;
  }
  if (state === "blockade") return blockadeRatio(world, ctx) <= 0.5;
  if (state === "war") {
    const owner = ctx.station.ownerId !== 0 ? ctx.station.ownerId : ctx.system.ownerId;
    return !longWarActive(world, owner);
  }
  if (state === "plague") return !hasPlague(world, ctx);
  return false;
}

/** §8.5-4: состояние не может быть более чем в 25% систем. */
function stateBudgetAvailable(world: World, market: LocalMarket): boolean {
  const fg = ensureFg(world);
  const stationIds = Object.keys(fg.markets).map(Number).sort((a, b) => a - b);
  if (stationIds.length === 0) return false;
  let busy = 0;
  for (const stationId of stationIds) {
    const other = fg.markets[stationId];
    if (other.stationId === market.stationId) continue;
    if (canonicalMarketState(other.state) !== "calm" && world.tick < other.stateUntil) busy += 1;
  }
  const limit = Math.max(1, Math.ceil(stationIds.length * CFG.stateGlobalShare));
  return busy < limit;
}

function updateMarketState(world: World, ctx: MarketCtx): void {
  const market = ctx.market;
  const tick = world.tick;
  const current = canonicalMarketState(market.state);
  const cooldownKey = "mkt:cd:" + market.stationId;
  const lastKey = "mkt:last:" + market.stationId;
  if (current !== "calm") {
    if (earlyExitState(world, ctx, current) || tick >= market.stateUntil) {
      market.state = "calm";
      market.stateUntil = 0;
      market.lastShockTick = tick;
      world.flags[cooldownKey] = tick + CFG.stateCooldownTicks;
      world.flags[lastKey] = stateCode(current);
      if (ctx.system.ownerId === world.playerEmpireId) {
        logEvent(
          world, "economy", "good",
          "Рынок системы " + ctx.system.name + ": состояние «" + marketStateTitleRu(current) + "» завершилось.",
          ctx.system.id, world.playerEmpireId,
        );
      }
    }
    return;
  }
  if (tick < flagOf(world, cooldownKey)) return;
  const trigger = detectStateTrigger(world, ctx);
  if (!trigger) return;
  const duration = MARKET_STATE_TABLE[trigger].duration;
  const span = Math.max(0, duration[1] - duration[0]);
  const extra = span > 0 ? hash32(world.seed, tick, market.stationId, stateCode(trigger)) % (span + 1) : 0;
  const length = clampRange(CFG.stateMinDuration, CFG.stateMaxDuration, duration[0] + extra);
  market.state = trigger;
  market.stateUntil = tick + length;
  market.lastShockTick = tick;
  world.flags[lastKey] = stateCode(trigger);
  if (ctx.system.ownerId === world.playerEmpireId) {
    logEvent(
      world, "economy", "warn",
      "Рынок системы " + ctx.system.name + ": состояние «" + marketStateTitleRu(trigger) + "».",
      ctx.system.id, world.playerEmpireId,
    );
  }
}

// ------------------------------------------------------------------ исполнение рыночных ордеров

/** Исполнение лимитных ордеров по товару; возвращает цену после сделок (слиппедж §7.5). */
function executeMarketOrders(world: World, ctx: MarketCtx, good: ResourceId, initialMid: number): number {
  const market = ctx.market;
  const station = ctx.station;
  const goods = market.goods[good];
  const sm = station.market[good];
  if (!goods || !sm) return initialMid;
  const orders = market.orders.filter((order) => orderGoodOf(order) === good).sort((a, b) => a.id - b.id);
  let mid = initialMid;
  const keep: LocalMarketOrder[] = [];
  for (const order of orders) {
    const empire = empireById(world, order.empireId);
    if (!empire || empire.dead) {
      if (empire) refundOrder(empire, order, good, false);
      continue;
    }
    if (world.tick > order.createdTick + CFG.orderLifetimeTicks) {
      refundOrder(empire, order, good, false);
      continue;
    }
    const reputation = stationReputation(world, order.empireId, market.stationId);
    const feePct = reputationCommissionPct(reputation) + world.balance.marketSpreadPct / 2;
    const priceMult = reputationPriceMult(reputation);
    if (order.side === "buy") {
      const ask = Math.max(1, Math.round(mid * priceMult * (1 + feePct / 100)));
      if (ask > order.price) {
        keep.push(order);
        continue;
      }
      const available = Math.max(0, Math.floor(goods.qty - CFG.reserveFraction * goods.eq));
      let fill = Math.min(order.qty, available, marketTradeLimit(world, order.empireId, goods.qty));
      if (fill <= 0) {
        keep.push(order);
        continue;
      }
      let slip = marketSlippage(ask, fill, goods.qty, true);
      let exec = Math.max(1, Math.round(slip.execPrice));
      if (exec > order.price) {
        fill = Math.min(fill, Math.floor((order.price * fill) / exec));
        if (fill <= 0) {
          keep.push(order);
          continue;
        }
        slip = marketSlippage(ask, fill, goods.qty, true);
        exec = Math.max(1, Math.round(slip.execPrice));
        if (exec > order.price) {
          keep.push(order);
          continue;
        }
      }
      const cost = exec * fill;
      empire.resources.credits += (order.price - exec) * fill;
      market.capital += cost;
      goods.qty -= fill;
      sm.stock = goods.qty;
      empire.resources[good] += fill;
      order.qty -= fill;
      mid = Math.max(1, slip.newPrice);
    } else {
      const bid = Math.max(1, Math.round(mid * priceMult * (1 - feePct / 100)));
      if (bid < order.price) {
        keep.push(order);
        continue;
      }
      const room = Math.max(0, Math.floor(goods.eq * 2 - goods.qty));
      let fill = Math.min(order.qty, room, marketTradeLimit(world, order.empireId, goods.qty));
      if (fill <= 0) {
        keep.push(order);
        continue;
      }
      let slip = marketSlippage(bid, fill, goods.qty, false);
      let exec = Math.max(1, Math.round(slip.execPrice));
      if (exec < order.price) {
        const maxFill = Math.floor(((bid - order.price) * 2 * slip.depth) / Math.max(1, CFG.slippageImpactCoeff * bid));
        fill = Math.min(fill, Math.max(0, maxFill));
        if (fill <= 0) {
          keep.push(order);
          continue;
        }
        slip = marketSlippage(bid, fill, goods.qty, false);
        exec = Math.max(1, Math.round(slip.execPrice));
        if (exec < order.price) {
          keep.push(order);
          continue;
        }
      }
      const affordable = Math.floor(market.capital / Math.max(1, exec));
      fill = Math.min(fill, Math.max(0, affordable));
      if (fill <= 0) {
        keep.push(order);
        continue;
      }
      const realCost = exec * fill;
      market.capital = Math.max(0, market.capital - realCost);
      goods.qty += fill;
      sm.stock = goods.qty;
      empire.resources.credits += realCost;
      order.qty -= fill;
      mid = Math.max(1, slip.newPrice);
    }
    if (order.qty > 0) keep.push(order);
  }
  market.orders = market.orders.filter((order) => orderGoodOf(order) !== good).concat(keep);
  return mid;
}

// ------------------------------------------------------------------ AI-торговцы

/** AI-империи торгуют против отклонения цены от базы (деньги/товары двигаются, не создаются). */
function aiMercantile(world: World, fg: FullGameState): void {
  const stationIds = Object.keys(fg.markets).map(Number).sort((a, b) => a - b);
  if (stationIds.length === 0) return;
  for (const empire of world.empires) {
    if (empire.dead || empire.isPlayer || empire.id === 9) continue;
    if ((world.tick + empire.id) % CFG.aiTradeCadence !== 0) continue;
    const known = stationIds.filter((stationId) => {
      const system = world.systems[fg.markets[stationId].systemId];
      return system !== undefined && system.knownBy.includes(empire.id);
    });
    if (known.length === 0) continue;
    const stationId = known[hash32(world.seed, world.tick, empire.id, 0xa1) % known.length];
    const market = fg.markets[stationId];
    const station = findStation(world, stationId);
    const system = world.systems[market.systemId];
    if (!station || !system) continue;
    const goods = marketGoodsOf(market);
    if (goods.length === 0) continue;
    const good = goods[hash32(world.seed, world.tick, empire.id, 0xb2) % goods.length];
    const state = market.goods[good];
    const sm = station.market[good];
    if (!state || !sm || !(sm.price > 0)) continue;
    const fair = RESOURCE_BY_ID[good].retail * regionalModifier(system.id);
    const qty = Math.max(1, Math.min(CFG.aiTradeMaxQty, Math.floor(state.qty * CFG.aiTradeStockFraction)));
    if (sm.price < fair * 0.92 && empire.resources.credits >= qty * sm.price) {
      const available = Math.max(0, Math.floor(state.qty - CFG.reserveFraction * state.eq));
      const amount = Math.min(qty, available);
      if (amount <= 0) continue;
      const cost = amount * sm.price;
      empire.resources.credits -= cost;
      market.capital += cost;
      empire.resources[good] += amount;
      state.qty -= amount;
      sm.stock = state.qty;
    } else if (sm.price > fair * 1.12 && empire.resources[good] >= qty) {
      const room = Math.max(0, Math.floor(state.eq * 2 - state.qty));
      const amount = Math.min(qty, room);
      const proceeds = amount * sm.price;
      if (amount <= 0 || market.capital < proceeds) continue;
      empire.resources[good] -= amount;
      empire.resources.credits += proceeds;
      market.capital -= proceeds;
      state.qty += amount;
      sm.stock = state.qty;
    }
  }
}

// ------------------------------------------------------------------ фаза рынка

/** §7.6: NPC-ввоз, если цена > 1.15 базы 10 тактов подряд: 15% Q* за такт. */
function npcImport(world: World, ctx: MarketCtx, good: ResourceId): void {
  const goods = ctx.market.goods[good];
  const sm = ctx.station.market[good];
  if (!goods || !sm) return;
  const base = RESOURCE_BY_ID[good].retail * regionalModifier(ctx.system.id);
  const key = "mkt:hi:" + ctx.market.stationId + ":" + good;
  const price = sm.price > 0 ? sm.price : Math.round(equilibriumPrice(world, ctx, good));
  if (price > base * CFG.npcImportTrigger) {
    const streak = flagOf(world, key) + 1;
    world.flags[key] = streak;
    if (streak >= CFG.npcImportTicks) {
      const add = Math.max(1, Math.ceil(goods.eq * CFG.npcImportFraction));
      goods.qty = Math.min(Math.floor(goods.eq * 2), goods.qty + add);
      sm.stock = goods.qty;
    }
  } else {
    world.flags[key] = 0;
  }
}

/**
 * Целевой капитал станции (§7.2): базовый уровень + масштаб по населению системы,
 * 6%/такт восстановления. Базовый уровень 6000 близок к стартовому капиталу станций среза,
 * чтобы инициализация рынка не сжигала денежную массу; хаб-станции получают +2000.
 */
export function stationCapitalTarget(world: World, stationId: number): number {
  const station = findStation(world, stationId);
  if (!station) return 0;
  const pops = systemPops(world, station.systemId);
  const hubLevel = station.kind === "trade" ? 1 : 0;
  const stationPops = pops + 20 * hubLevel; // персонал станции — минимум 20 «попов»
  return Math.round(6000 * (1 + Math.pow(Math.max(1, stationPops) / 20, 0.75)) + 2000 * hubLevel);
}

function updateMarket(world: World, ctx: MarketCtx): void {
  updateMarketState(world, ctx);
  const market = ctx.market;
  const station = ctx.station;
  const targetCapital = stationCapitalTarget(world, market.stationId);
  market.capital += Math.round((targetCapital - market.capital) * CFG.capitalRecoveryPerTick);
  if (market.capital < 0) market.capital = 0;
  for (const good of marketGoodsOf(market)) {
    const def = RESOURCE_BY_ID[good];
    const sm = station.market[good];
    const goods = market.goods[good];
    if (!def || !sm || !goods) continue;
    // физический запас — station.market[good].stock (в него пишут и базовая торговля, и ордера)
    if (Number.isFinite(sm.stock)) goods.qty = clampRange(0, Math.floor(goods.eq * 2), Math.round(sm.stock));
    // дрейф запаса к Q* (производство/потребление системы), а не вечное накопление S-D
    goods.qty += Math.round((goods.eq - goods.qty) * CFG.stockRecoveryPerTick);
    goods.qty = clampRange(0, Math.floor(goods.eq * 2), goods.qty);
    npcImport(world, ctx, good);
    let mid = sm.price > 0 ? sm.price : Math.round(equilibriumPrice(world, ctx, good));
    mid = executeMarketOrders(world, ctx, good, mid);
    // §7.4: восстановление цены к равновесию 4.5%/такт, затем коридор +-20% (+ премия дефицита)
    const target = equilibriumPrice(world, ctx, good);
    let next = mid + (target - mid) * CFG.priceRecoveryPerTick;
    const qmin = CFG.minStockFraction * goods.eq;
    const low = def.retail * CFG.priceCorridorMin;
    const high = goods.qty < qmin
      ? def.retail * CFG.priceCorridorMax * CFG.deficitPremium
      : def.retail * CFG.priceCorridorMax;
    next = clampRange(low, high, next);
    sm.price = Math.max(1, Math.round(next));
    sm.stock = goods.qty;
  }
}

/** Фаза расширенного рынка: капитал, состояния, цены, ордера, биржа, AI-торговцы. */
export function marketExtPhase(world: World): void {
  const fg = ensureFg(world);
  // ленивая инициализация рынков для станций, появившихся после createFullGameState
  for (const system of world.systems) {
    if (!system.station) continue;
    if (!fg.markets[system.station.id]) {
      fg.markets[system.station.id] = createMarket(system.station, system);
    }
  }
  updateExchangeRate(world, fg);
  executeExchangeOrders(world, fg);
  aiMercantile(world, fg);
  const stationIds = Object.keys(fg.markets).map(Number).sort((a, b) => a - b);
  for (const stationId of stationIds) {
    const ctx = marketCtx(world, stationId);
    if (!ctx) continue;
    ensureNormalized(world, ctx);
    updateMarket(world, ctx);
  }
}





