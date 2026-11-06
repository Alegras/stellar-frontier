/**
 * FULL GAME STATE (M6–M12): традиции/перки, дипломатия/войны/федерации/совет,
 * шпионаж, рынок с ордерами и биржа, торговые маршруты, контракты и репутация,
 * кампания (акты/миссии/события/концовки), аномалии/археология, кризисы,
 * мегаструктуры, условия победы, режимы (кооп/MMO).
 *
 * Всё это лежит в World.fg (опционально), чтобы вертикальный срез оставался
 * совместимым, а новые системы были изолированы от базовых типов.
 */
import type { ResourceId, ScienceId, ShipDesignDef } from "@sf/data";
import type { Empire, Fleet, Planet, Resources, SciencePoints, StarSystem, World, CommandResult } from "./types";
import { CIVICS, ETHICS, GOVERNMENTS } from "@sf/data";
import { createAncientsState, type AncientsState } from "./ancients";
import { createDlcState, type DlcState } from "./dlc";

export type TreatyKind = "nap" | "trade" | "research" | "defensive" | "alliance" | "federation" | "vassal" | "tribute";
export type CBKind = "conquest" | "liberation" | "humiliation" | "vassalization" | "crisis" | "defensive" | "none";
export type Attitude = "ally" | "friendly" | "neutral" | "cold" | "hostile" | "rival";
export type MarketState = "calm" | "boom" | "bust" | "famine" | "war" | "blockade" | "plague" | "plague2";
export type EspionageOp = "fleet_recon" | "steal_tech" | "sabotage" | "incite" | "steal_map" | "assassinate";
export type CampaignBranch = "undecided" | "federation" | "sovereignty" | "syndicate";
export type CrisisKind = "void_reavers" | "synthetic_revolt" | "grey_tide" | "devourers" | "ancient_awakening";
export type MegastructureType =
  | "sentinel_array" | "gate" | "star_forge" | "ring_habitat" | "dyson_sphere" | "science_nexus" | "beacon";

export interface EmpireAdvanced {
  /** этика/правление/цивики (влияют на дипломатию, фракции, счастье) */
  ethics: string[];
  government: string;
  civics: string[];
  /** традиции: узлы и финишеры */
  traditions: { unlocked: string[]; trees: Record<string, number>; finishers: string[]; unitySpent: number };
  /** перки вознесения */
  perks: string[];
  perkSlots: number;
  /** притязания на системы (systemId) */
  claims: number[];
  /** репутация на станциях: stationId → −100..100 */
  reputation: Record<number, number>;
  /** одобрение фракций: factionId → 0..100 */
  factions: Record<string, number>;
  /** шпионаж: кулдауны и уровни разведки по цели */
  intel: Record<number, number>;
  espionageCooldown: Record<string, number>;
  /** дипломатическое предложение, ожидающее ответа */
  pendingOffers: DiplomaticOffer[];
  /** счётчики для условий победы */
  peakFp: number;
  gdp: number;
  robots: number;
  vassals: number[];
  warIds: number[];
  /** исследованные артефакты/секретная линия */
  artifacts: number;
  /** уровень ИИ-агрессии/сложности из mode */
  aiPersonality: "expander" | "scientist" | "militarist" | "trader" | "diplomat" | "pirate";
}

export interface DiplomaticOffer {
  id: number;
  fromEmpireId: number;
  toEmpireId: number;
  treaty: TreatyKind;
  createdTick: number;
  expiresTick: number;
}

export interface TreatyState {
  active: boolean;
  sinceTick: number;
  expiresTick: number;
}

export interface EmpireRelation {
  opinion: number;
  attitude: Attitude;
  treaties: Record<TreatyKind, TreatyState>;
  /** нарушения договоров и подарки */
  recentActions: number;
  borderSystems: number;
  /** призыв к обороне */
  callToArms: boolean;
  /** мнение по компонентам (для тултипа) */
  breakdown: { label: string; value: number }[];
}

export interface WarSide {
  empireId: number;
  fpStart: number;
  fpLost: number;
  claims: number[];
  occupiedSystems: number[];
}

export interface War {
  id: number;
  attackerId: number;
  defenderId: number;
  startedTick: number;
  cb: CBKind;
  sides: Record<number, WarSide>;
  score: Record<number, number>;
  exhaustion: Record<number, number>;
  occupied: Record<number, number>;
  lastBattleTick: number;
  /** предложение мира от стороны */
  pendingPeace: { byEmpireId: number; demands: number[] } | null;
}

export interface Federation {
  id: number;
  nameRu: string;
  members: number[];
  presidentId: number;
  foundedTick: number;
  treasuryEnergy: number;
  treasuryAlloys: number;
  fleetIds: number[];
  nextChairTick: number;
  votes: Record<number, number>;
}

export interface CouncilResolution {
  id: string;
  type: string;
  targetEmpireId: number;
  votesFor: number;
  votesAgainst: number;
  vetoed: boolean;
  passedTick: number;
  durationTicks: number;
  effects: { target: string; value: number }[];
  votes: Record<number, boolean>;
}

export interface CouncilState {
  nextSessionTick: number;
  vetoCooldown: Record<number, number>;
  sanctions: Record<number, number>;
  resolutions: CouncilResolution[];
  pending: CouncilResolution | null;
  weights: Record<number, number>;
}

export interface StationGoodState {
  qty: number;
  eq: number;          // целевой запас Q*
  demand: number;
  supply: number;
}

export interface LocalMarketOrder {
  id: number;
  empireId: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  createdTick: number;
}

export interface LocalMarket {
  stationId: number;
  systemId: number;
  /** кредитный капитал станции (обязательный контрагент) */
  capital: number;
  goods: Partial<Record<ResourceId, StationGoodState>>;
  orders: LocalMarketOrder[];
  state: MarketState;
  stateUntil: number;
  lastShockTick: number;
}

export interface ExchangeOrder {
  id: number;
  empireId: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  createdTick: number;
  expiresTick: number;
}

export interface ExchangeState {
  /** курс CR ↔ энергия (1.0 = 1:1), коридор 0.8..1.2 */
  rate: number;
  history: number[];
  orders: ExchangeOrder[];
  nextOrderId: number;
  volume: number;
}

export interface TradeRoute {
  id: number;
  empireId: number;
  fromSystemId: number;
  toSystemId: number;
  good: ResourceId;
  qty: number;
  sellAtDest: boolean;
  ticksLeft: number;
  active: boolean;
  profitLast: number;
}

export type MissionStatus = "available" | "accepted" | "completed" | "failed" | "expired";
export type ContractKind =
  | "delivery" | "bounty" | "scan" | "passenger" | "smuggle" | "rescue"
  | "mining" | "tourist" | "escort" | "salvage" | "hunt" | "evacuation";

export interface ContractObjective {
  id: string;
  type: string;
  targetSystemId?: number;
  targetPlanetId?: number;
  count: number;
  progress: number;
  done: boolean;
}

export interface ContractRewards {
  credits: number;
  alloys?: number;
  science?: Partial<SciencePoints>;
  reputation?: number;
  influence?: number;
  unlock?: string;
}

export interface Contract {
  id: number;
  defId: string;
  kind: ContractKind;
  titleRu: string;
  descRu: string;
  systemId: number;
  stationId: number;
  factionId: number;
  objectives: ContractObjective[];
  rewards: ContractRewards;
  accepted: boolean;
  completed: boolean;
  failed: boolean;
  deadlineTick: number;
  acceptedTick: number;
  progress: number;
  risk: number;
}

export interface CampaignMission {
  id: string;
  act: number;
  titleRu: string;
  briefingRu: string;
  giver: string;
  objectives: ContractObjective[];
  failCondition: string | null;
  rewards: ContractRewards;
  branchRequired: CampaignBranch | null;
  secret: boolean;
  status: "locked" | "available" | "active" | "completed" | "failed" | "skipped";
  acceptedTick: number;
  flags: Record<string, number>;
}

export interface CampaignState {
  act: number;
  prologueStep: number;
  branch: CampaignBranch;
  branchProgress: Record<CampaignBranch, number>;
  missions: Record<string, CampaignMission>;
  activeMissionId: string | null;
  endings: string[];
  artifactCount: number;
  secretLine: number;
  /** сюжетные локы: ≤3 и ≤10 минут */
  locks: { id: string; untilTick: number; reasonRu: string }[];
  flags: Record<string, number>;
  tutorialStep: number;
  lastStoryTick: number;
}

export interface NarrativeEventChoice {
  id: string;
  labelRu: string;
  effects: { target: string; value: number }[];
  flag?: string;
  missionId?: string;
}

export interface NarrativeEvent {
  id: string;
  chainId: string;
  step: number;
  titleRu: string;
  textRu: string;
  choices: NarrativeEventChoice[];
  triggeredTick: number;
  expiresTick: number;
}

export interface NarrativeState {
  fired: Record<string, number>;
  pending: NarrativeEvent[];
  chainStep: Record<string, number>;
  cooldown: Record<string, number>;
}

export interface AnomalyState {
  id: string;
  systemId: number;
  planetId: number | null;
  titleRu: string;
  kind: "anomaly" | "archaeology" | "derelict" | "silent_star";
  discovered: boolean;
  investigated: boolean;
  chainId: string | null;
  step: number;
  rewardCredits: number;
  rewardScience: number;
  artifact: boolean;
}

export interface ArchaeologyState {
  chainId: string;
  titleRu: string;
  step: number;
  steps: number;
  startedTick: number;
  completed: boolean;
  anomalyId: string;
}

export interface CrisisState {
  id: string;
  kind: CrisisKind;
  startedTick: number;
  stage: number;
  strengthFp: number;
  systems: number[];
  nodes: number[];
  defeated: boolean;
  progress: number;
  wavesRepelled: number;
  lairSystemId: number;
  lastActionTick: number;
  titleRu: string;
}

export interface MegastructureState {
  id: number;
  type: MegastructureType;
  systemId: number;
  ownerId: number;
  ticksLeft: number;
  totalTicks: number;
  active: boolean;
  hp: number;
  maxHp: number;
}

export interface VictoryProgress {
  domination: number;
  federation: number;
  ascension: number;
  economy: number;
  crisis: number;
  score: number;
  /** такт, с которого условие выполнено подряд (для экономики 300 тактов) */
  economySince: number;
}

export interface FullGameState {
  schemaVersion: number;
  empires: Record<number, EmpireAdvanced>;
  relations: Record<string, EmpireRelation>;
  offers: DiplomaticOffer[];
  nextOfferId: number;
  wars: War[];
  nextWarId: number;
  federations: Federation[];
  nextFederationId: number;
  council: CouncilState;
  markets: Record<number, LocalMarket>;
  exchange: ExchangeState;
  routes: TradeRoute[];
  nextRouteId: number;
  contracts: Contract[];
  nextContractId: number;
  campaign: CampaignState;
  narrative: NarrativeState;
  anomalies: AnomalyState[];
  archaeology: ArchaeologyState[];
  crises: CrisisState[];
  megastructures: MegastructureState[];
  nextMegastructureId: number;
  victoryProgress: VictoryProgress;
  score: Record<number, number>;
  /** давление поздней игры (6200+): −20% доходов, +50% агрессии */
  finalPressure: number;
  /** дипломатические события/санкции/вето */
  lastCouncilTick: number;
  /** счётчик тиков для кулдаунов */
  revision: number;
  /** режим: coop/mmo настройки (не влияют на базовую sim-логику) */
  multiplayer: { enabled: boolean; players: number; tacticalLockTicks: number; pauseVotes: Record<number, boolean>; pauseCooldown: number; tacticalLockedBy: number; tacticalLockUntil: number };
  /** лог кампании/событий (для журнала) */
  journal: { tick: number; kind: string; textRu: string; missionId?: string }[];
  /** для анти-эксплойтов */
  tradeCooldown: Record<number, number>;
  missionAbandons: Record<number, number>;
  /** Часть XIII: расы, Древние, ветвь A0–A5, варп, Реликтовый Предел */
  ancients: AncientsState;
  /** Часть XIV: DLC «Квесты и диалоги» (вертикальный срез) */
  dlc: DlcState;
}

export function relationKey(a: number, b: number): string {
  return a < b ? a + ":" + b : b + ":" + a;
}

/** Гарантированно существующее расширенное состояние (ленивая инициализация). */
export function ensureFg(world: World): FullGameState {
  if (!world.fg) world.fg = createFullGameState(world);
  if (!world.fg.ancients) world.fg.ancients = createAncientsState(world);
  if (!world.fg.dlc) world.fg.dlc = createDlcState(world, false);
  return world.fg;
}

export function advancedOf(world: World, empireId: number): EmpireAdvanced {
  const fg = ensureFg(world);
  const defaultEthics = ETHICS.slice(0, 2).map((e) => e.id);
  const defaultGovernment = GOVERNMENTS[0]?.id ?? "directorate";
  const defaultCivics = CIVICS.slice(0, 2).map((c) => c.id);
  return fg.empires[empireId] ??= {
    ethics: defaultEthics.length >= 2 ? defaultEthics : ["materialist", "collectivist"],
    government: defaultGovernment,
    civics: defaultCivics.length >= 2 ? defaultCivics : ["engineering_corps", "trade_chamber"],
    traditions: { unlocked: [], trees: {}, finishers: [], unitySpent: 0 },
    perks: [],
    perkSlots: 8,
    claims: [],
    reputation: {},
    factions: {},
    intel: {},
    espionageCooldown: {},
    pendingOffers: [],
    peakFp: 0,
    gdp: 0,
    robots: 0,
    vassals: [],
    warIds: [],
    artifacts: 0,
    aiPersonality: "scientist",
  };
}

export function relationOf(world: World, a: number, b: number): EmpireRelation {
  const fg = ensureFg(world);
  const key = relationKey(a, b);
  return fg.relations[key] ??= {
    opinion: 0,
    attitude: "neutral",
    treaties: {
      nap: { active: false, sinceTick: 0, expiresTick: 0 },
      trade: { active: false, sinceTick: 0, expiresTick: 0 },
      research: { active: false, sinceTick: 0, expiresTick: 0 },
      defensive: { active: false, sinceTick: 0, expiresTick: 0 },
      alliance: { active: false, sinceTick: 0, expiresTick: 0 },
      federation: { active: false, sinceTick: 0, expiresTick: 0 },
      vassal: { active: false, sinceTick: 0, expiresTick: 0 },
      tribute: { active: false, sinceTick: 0, expiresTick: 0 },
    },
    recentActions: 0,
    borderSystems: 0,
    callToArms: false,
    breakdown: [],
  };
}

export function createFullGameState(world: World, options?: { raceId?: string; dlcEnabled?: boolean }): FullGameState {
  const fg: FullGameState = {
    schemaVersion: 1,
    empires: {},
    relations: {},
    offers: [],
    nextOfferId: 1,
    wars: [],
    nextWarId: 1,
    federations: [],
    nextFederationId: 1,
    council: { nextSessionTick: 300, vetoCooldown: {}, sanctions: {}, resolutions: [], pending: null, weights: {} },
    markets: {},
    exchange: { rate: 1, history: [], orders: [], nextOrderId: 1, volume: 0 },
    routes: [],
    nextRouteId: 1,
    contracts: [],
    nextContractId: 1,
    campaign: {
      act: 0,
      prologueStep: 0,
      branch: "undecided",
      branchProgress: { undecided: 0, federation: 0, sovereignty: 0, syndicate: 0 },
      missions: {},
      activeMissionId: null,
      endings: [],
      artifactCount: 0,
      secretLine: 0,
      locks: [],
      flags: {},
      tutorialStep: 0,
      lastStoryTick: 0,
    },
    narrative: { fired: {}, pending: [], chainStep: {}, cooldown: {} },
    anomalies: [],
    archaeology: [],
    crises: [],
    megastructures: [],
    nextMegastructureId: 1,
    victoryProgress: { domination: 0, federation: 0, ascension: 0, economy: 0, crisis: 0, score: 0, economySince: 0 },
    score: {},
    finalPressure: 0,
    lastCouncilTick: 0,
    revision: 0,
    multiplayer: { enabled: false, players: 1, tacticalLockTicks: 90, pauseVotes: {}, pauseCooldown: 0, tacticalLockedBy: 0, tacticalLockUntil: 0 },
    journal: [],
    tradeCooldown: {},
    missionAbandons: {},
    ancients: createAncientsState(world, options?.raceId),
    dlc: createDlcState(world, options?.dlcEnabled ?? true),
  };
  world.fg = fg;
  for (const empire of world.empires) advancedOf(world, empire.id);
  for (const system of world.systems) {
    if (system.station) {
      const market: LocalMarket = {
        stationId: system.station.id,
        systemId: system.id,
        capital: system.station.market.energy ? 12000 : 6000,
        goods: {},
        orders: [],
        state: "calm",
        stateUntil: 0,
        lastShockTick: 0,
      };
      for (const [good, value] of Object.entries(system.station.market) as [ResourceId, { stock: number; price: number }][]) {
        const eq = Math.max(200, value.stock * 2);
        market.goods[good] = { qty: value.stock, eq, demand: 40, supply: 44 };
      }
      fg.markets[system.station.id] = market;
    }
  }
  for (let a = 0; a < world.empires.length; a++) {
    for (let b = a + 1; b < world.empires.length; b++) {
      relationOf(world, world.empires[a]!.id, world.empires[b]!.id);
    }
  }
  world.fg = fg;
  return fg;
}

/** Журнал кампании: последние N записей (для UI). */
export function pushJournal(fg: FullGameState, tick: number, kind: string, textRu: string, missionId?: string): void {
  fg.journal.push({ tick, kind, textRu, missionId });
  if (fg.journal.length > 300) fg.journal.splice(0, fg.journal.length - 300);
}