/**
 * КОНФИГ M8 (рынок/маршруты/контракты/репутация) — FALLBACK-числа.
 *
 * Канон: docs/03b_economy.md §7 (рынок), §8 (состояния), §9.2 (курс), §11 (экономика пилота),
 * §13.4/§13.6 (инварианты и анти-эксплойты), §14 (анти-эксплойты).
 *
 * ПРАВИЛО ПРОЕКТА: баланс живёт в @sf/data. Пока в packages/data/src/full и campaign
 * нет массивов для M8 (их заполняет контент-команда, task-12), все числа собраны здесь
 * одной таблицей, чтобы потом переехать в JSON без правок логики.
 * TODO(content/task-12): вынести MARKET_CFG, REPUTATION_TIERS, MARKET_STATE_TABLE,
 * CONTRACT_FALLBACK_TEMPLATES, ROUTE_CFG в @sf/data (single source of truth).
 */
import type { MarketState, ContractKind } from "./fullgame";
import type { ResourceId } from "./types";

/** Ссылки на канон — для тултипов UI и для ревью баланса. */
export const M8_BALANCE_SOURCE = "03b_economy §7/§8/§9.2/§11/§14";

export const MARKET_CFG = {
  /** §7.4: восстановление цены к равновесию 4.5%/такт. */
  priceRecoveryPerTick: 0.045,
  /** §7.3: коридор цены ±20% от P_base. */
  priceCorridorMin: 0.80,
  priceCorridorMax: 1.20,
  /** §7.2: стабилизатор запаса к Q* (2%/такт) — вместо «вечного» накопления S−D. */
  stockRecoveryPerTick: 0.02,
  /** §7.2: dC_fl/dt = 0.06 × (C_target − C_fl). */
  capitalRecoveryPerTick: 0.06,
  /** §7.6: Q_available = Q − 0.40 × Q* (резерв для населения). */
  reserveFraction: 0.40,
  /** §7.6: Q_min = 0.10 × Q* — ниже цена упирается в +20% и есть премия. */
  minStockFraction: 0.10,
  /** §7.6: при Q < Q_min цена = 1.20 × P_base × 1.05 («последние единицы»). */
  deficitPremium: 1.05,
  /** §7.6: лимит покупки min(8% × Q, 20 + 2 × trade_rank) ед./такт. */
  buyLimitFraction: 0.08,
  buyLimitFlat: 20,
  buyLimitPerRank: 2,
  /** §7.6: NPC-ввоз при цене > 1.15 × база 10 тактов подряд: 15% от Q* в такт. */
  npcImportTrigger: 1.15,
  npcImportTicks: 10,
  npcImportFraction: 0.15,
  /** §7.5: depth = max(50, 0.20 × Q); impact = clamp(0, 0.20, 0.06 × qty/depth). */
  slippageDepthFraction: 0.20,
  slippageDepthMin: 50,
  slippageImpactCoeff: 0.06,
  slippageImpactMax: 0.20,
  /** §14.3: минимальный лот 5 ед., 1 ордер/такт/товар, лимитный ордер до 3 тактов. */
  orderLot: 5,
  orderLifetimeTicks: 3,
  /** §14.3: отмена ордера — комиссия 0.5% (округление в пользу рынка). */
  orderCancelFeePct: 0.005,
  /** §14.3: рейт-лимиты. */
  ordersPerTickPerGood: 1,
  marketTradesPerTick: 10,
  cancelsPerTick: 5,
  routesPerTick: 2,
  /** §14.1-11: отмена маршрута возвращает груз в источник с −20% обработкой. */
  routeCancelRefundPct: 0.80,
  /** §14.1-16: round_trip ≥ 6 тактов. */
  routeMinLegTicks: 3,
  /** §6.9: повторная продажа в тот же порт < 10 тактов — насыщение (цена −8%). */
  routeSaturationTicks: 10,
  routeSaturationMult: 0.92,
  /** §14.1-6/§14.3: 3 отмены контракта → блок 100 тактов, −5 репутации; 3 активных. */
  contractAbandonLimit: 3,
  contractBlockTicks: 100,
  contractAbandonRepPenalty: -5,
  /** §11.6: провал контракта — репутация −15, штраф 25 000 Cr. */
  contractFailRepPenalty: -15,
  contractFailFine: 25000,
  maxActiveContracts: 3,
  /** Станционный запас контрактов: сколько доступных держим на станции и в мире. */
  contractsPerStation: 3,
  contractsWorldLimit: 40,
  /** §9.2: курс CR↔энергия — коридор 0.80..1.20, возврат к 1:1 + давление спроса + шум. */
  exchangeRateMin: 0.80,
  exchangeRateMax: 1.20,
  exchangeMeanReversion: 0.004,
  exchangeDemandPressure: 0.010,
  exchangeNoise: 0.005,
  exchangeHistoryLimit: 60,
  /** §7.5/§14.3: глубина биржи и лимит объёма сделки за такт. */
  exchangeDepth: 4000,
  exchangeMaxQtyPerTick: 500,
  exchangeMaxQtyFlat: 50,
  exchangeMaxQtyPerRank: 10,
  /** §14.1-7: один кошелёк = один актор; сетка запрещает покупку и продажу в один такт. */
  exchangeOrderLifetimeTicks: 3,
  /** AI-торговцы: «видят» маржу и торгуют не чаще раза в N тактов на империю. */
  aiTradeCadence: 7,
  aiTradeStockFraction: 0.05,
  aiTradeMaxQty: 20,
  /** §8.5: минимальная длительность 20, максимальная 120, остывание 15 тактов. */
  stateCooldownTicks: 15,
  stateMinDuration: 20,
  stateMaxDuration: 120,
  /** §8.5-4: одно состояние не может быть более чем в 25% систем. */
  stateGlobalShare: 0.25,
} as const;

export type MarketConfig = typeof MARKET_CFG;

/** §7.9: репутация и доступ (цена / комиссия / редкие / миссии). */
export interface ReputationTier {
  min: number;
  max: number;
  priceMult: number;
  commissionPct: number;
  rareGoods: boolean;
  missions: "smuggle_only" | "normal" | "elite" | "unique";
}

export const REPUTATION_TIERS: ReputationTier[] = [
  { min: -100, max: -30, priceMult: 1.18, commissionPct: 5, rareGoods: false, missions: "smuggle_only" },
  { min: -29, max: 10, priceMult: 1.03, commissionPct: 2, rareGoods: false, missions: "normal" },
  { min: 11, max: 40, priceMult: 0.98, commissionPct: 2, rareGoods: true, missions: "elite" },
  { min: 41, max: 100, priceMult: 0.95, commissionPct: 1.5, rareGoods: true, missions: "unique" },
];

/** §8.4: эффекты состояний. T — множитель цены, risk — торговый риск, production — производство. */
export interface MarketStateEffect {
  priceMult: number;
  /** отдельный множитель для пищи (голод) */
  foodPriceMult?: number;
  /** отдельный множитель для сплавов (военная экономика, +40%) */
  alloysPriceMult?: number;
  /** отдельный множитель для товаров потребления (военная экономика, −20%) */
  goodsPriceMult?: number;
  riskMult: number;
  productionMult: number;
  /** длительность, тактов [min,max] (§8.2) */
  duration: [number, number];
  titleRu: string;
}

export type CanonicalMarketState = Exclude<MarketState, "plague2">;

export const MARKET_STATE_TABLE: Record<CanonicalMarketState, MarketStateEffect> = {
  calm: { priceMult: 1.00, riskMult: 1.00, productionMult: 1.00, duration: [0, 0], titleRu: "Спокойствие" },
  boom: { priceMult: 1.12, riskMult: 0.90, productionMult: 1.08, duration: [60, 120], titleRu: "Подъём" },
  bust: { priceMult: 0.92, riskMult: 1.05, productionMult: 0.95, duration: [60, 120], titleRu: "Спад" },
  famine: { priceMult: 1.12, foodPriceMult: 1.35, riskMult: 1.20, productionMult: 0.85, duration: [30, 90], titleRu: "Голод" },
  war: { priceMult: 1.10, alloysPriceMult: 1.40, goodsPriceMult: 0.80, riskMult: 1.25, productionMult: 1.00, duration: [60, 120], titleRu: "Военная экономика" },
  blockade: { priceMult: 1.30, riskMult: 1.60, productionMult: 0.80, duration: [20, 80], titleRu: "Блокада" },
  plague: { priceMult: 1.15, riskMult: 1.15, productionMult: 0.75, duration: [40, 100], titleRu: "Эпидемия" },
};

/** Шаблон контракта контрактного рынка (12 типов, 03b §11.2/§11.6). */
export interface ContractTemplate {
  defId: string;
  kind: ContractKind;
  titleRu: string;
  descRu: string;
  objective: "dock" | "scan" | "bounty" | "jump" | "deliver";
  /** единицы товара / очки FP / 1 (для scan/dock/jump) */
  count: number;
  /** товар для доставки (deliver) или награда (salvage) */
  good?: ResourceId;
  minTicks: number;
  maxTicks: number;
  rewardCredits: number;
  perJumpCredits: number;
  rewardRep: number;
  risk: number;
  /** минимальная репутация на станции для доступа */
  minRep: number;
}

/**
 * FALLBACK-шаблоны для 6 типов, которых нет в packages/data/src/missions.json
 * (delivery/bounty/scan/passenger/smuggle/rescue берутся из @sf/data MISSIONS).
 * TODO(content/task-12): перенести в @sf/data как MISSION-шаблоны.
 */
export const CONTRACT_FALLBACK_TEMPLATES: ContractTemplate[] = [
  {
    defId: "mining", kind: "mining", titleRu: "Добыча руды",
    descRu: "Добудьте минералы и сдайте их на станцию.", objective: "deliver",
    count: 60, good: "minerals", minTicks: 6, maxTicks: 14,
    rewardCredits: 30000, perJumpCredits: 2000, rewardRep: 3, risk: 0.20, minRep: -100,
  },
  {
    defId: "tourist", kind: "tourist", titleRu: "Экскурсия",
    descRu: "Провезите туриста по безопасному маршруту.", objective: "dock",
    count: 1, minTicks: 4, maxTicks: 10,
    rewardCredits: 26000, perJumpCredits: 3200, rewardRep: 3, risk: 0.12, minRep: -29,
  },
  {
    defId: "escort", kind: "escort", titleRu: "Сопровождение",
    descRu: "Сопроводите конвой до целевой системы.", objective: "jump",
    count: 1, minTicks: 5, maxTicks: 12,
    rewardCredits: 42000, perJumpCredits: 4000, rewardRep: 4, risk: 0.35, minRep: -29,
  },
  {
    defId: "salvage", kind: "salvage", titleRu: "Обломки",
    descRu: "Найдите обломки, снимите оборудование и вернитесь.", objective: "scan",
    count: 1, minTicks: 4, maxTicks: 10,
    rewardCredits: 24000, perJumpCredits: 3000, rewardRep: 3, risk: 0.30, minRep: -100,
  },
  {
    defId: "hunt", kind: "hunt", titleRu: "Охота",
    descRu: "Уничтожьте крупный пиратский отряд.", objective: "bounty",
    count: 40, minTicks: 8, maxTicks: 16,
    rewardCredits: 90000, perJumpCredits: 4500, rewardRep: 6, risk: 0.55, minRep: 11,
  },
  {
    defId: "evacuation", kind: "evacuation", titleRu: "Эвакуация",
    descRu: "Вывезите людей из опасной системы.", objective: "dock",
    count: 1, minTicks: 4, maxTicks: 12,
    rewardCredits: 55000, perJumpCredits: 5200, rewardRep: 5, risk: 0.50, minRep: -29,
  },
];

/** Товары, которые может требовать deliver-контракт (03b §11.2). */
export const CONTRACT_DELIVERY_GOODS: ResourceId[] = ["minerals", "food", "goods", "alloys"];

/** §7.8/§8.4: риск маршрута. */
export const ROUTE_CFG = {
  /** базовый риск одного прыжка (логистика+пираты 0.05..0.12 на круг) */
  baseRiskPerJump: 0.03,
  /** +риск за активную войну с владельцем коридора */
  warRisk: 0.05,
  /** +риск, если в целевой системе есть пиратская база */
  pirateBaseRisk: 0.03,
  /** §9.7: пошлина на границе 3–18% от стоимости груза. */
  tariffMin: 0.03,
  tariffMax: 0.18,
  /** §6.9: за каждые 1000 Cr продаж за 10 тактов: −0.7% цены (в среднем берём 8% за рейс). */
  saturationPenalty: 0.08,
} as const;

/** Патчи контрактов по типам, у которых objective не совпадает с MISSION-шаблоном. */
export const MISSION_KIND_TO_OBJECTIVE: Record<string, ContractTemplate["objective"]> = {
  delivery: "deliver",
  bounty: "bounty",
  scan: "scan",
  passenger: "dock",
  smuggle: "dock",
  rescue: "dock",
};
