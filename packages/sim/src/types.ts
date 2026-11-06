/**
 * @sf/sim — типы состояния мира (контракт между симуляцией, UI и рендером).
 * ПРАВИЛО: в этом пакете нет DOM, Math.random, Date.now, performance.now.
 * Все ресурсы и запасы — целые числа; дробные доходы накапливаются в милли-остатках.
 */
import type {
  BalanceConfig, BuildingDef, DistrictDef, HullDef, JobDef, MissionDef, ModeConfig,
  ModuleDef, ResourceId, ScienceId, ShipClassId, ShipDesignDef, TechDef, WeaponDef,
} from "@sf/data";
import type { FullGameState } from "./fullgame";
export type { ResourceId, ScienceId, ShipClassId };

export type Resources = Record<ResourceId, number>;
export type SciencePoints = Record<ScienceId, number>;
export type Milli = Record<ResourceId, number>; // тысячные доли для накопления дохода

export const RESOURCE_ORDER: ResourceId[] = [
  "energy", "minerals", "food", "alloys", "goods", "unity", "influence", "credits",
];
export const SCIENCE_ORDER: ScienceId[] = ["physics", "society", "engineering"];

export interface Vec2 { x: number; y: number }

export type StarType =
  | "yellow" | "orange" | "red" | "blue" | "white" | "binary" | "trinary"
  | "neutron" | "pulsar" | "blackhole" | "nebula";
export type PlanetType =
  | "continental" | "ocean" | "desert" | "tundra" | "arctic" | "savanna"
  | "tropical" | "arid" | "volcanic" | "gas_giant" | "barren" | "asteroid_belt";

export interface PlanetDeposits {
  minerals: number;   // бонус к добыче, целое
  energy: number;
  rare: number;       // 0..3, редкие ресурсы
}

export interface Planet {
  id: number;
  systemId: number;
  name: string;
  type: PlanetType;
  size: number;        // 1..5
  orbit: number;       // индекс орбиты (для 3D-сцены)
  orbitRadius: number; // игровые единицы (для 3D)
  habitability: number; // 0..100 для колонизации
  deposits: PlanetDeposits;
  ownerId: number;      // 0 = никто
  colonyId: number;     // 0 = нет колонии
  anomaly: string;      // "" = нет
  scanned: boolean;
}

export type PoiKind = "anomaly" | "derelict" | "pirate_base" | "mining_platform" | "research_station" | "trade_hub";

export interface Poi {
  id: number;
  kind: PoiKind;
  nameRu: string;
  systemId: number;
  scanned: boolean;
  /** награда за исследование: данные/кредиты */
  rewardCredits: number;
  rewardScience: number;
}

export interface StationGood {
  stock: number;
  price: number; // целые кредиты за единицу (розница)
}
export type StationMarket = Partial<Record<ResourceId, StationGood>>;

export interface Station {
  id: number;
  systemId: number;
  ownerId: number;
  kind: "outpost" | "shipyard" | "mining" | "research" | "pirate" | "trade";
  nameRu: string;
  hp: number;
  maxHp: number;
  market: StationMarket;
  /** тик последнего обновления рынка */
  marketTick: number;
  hasShipyard: boolean;
  hasMissions: boolean;
}

export interface StarSystem {
  id: number;
  name: string;
  x: number; // карта, целые единицы (*10 = св. год)
  y: number;
  star: StarType;
  planets: Planet[];
  links: number[];
  ownerId: number;
  /** какие империи знают систему */
  knownBy: number[];
  /** сенсорное покрытие в текущем такте */
  visibleTo: number[];
  poi: Poi[];
  station: Station | null;
  chokepoint: boolean;
  /** гиперлинии дальность в прыжках от столицы игрока (для UI) */
  hopsFromCapital: number;
  /** Часть XIII: система галактики или сектора «Реликтовый Предел» */
  sector?: "galaxy" | "relic";
  /** Часть XIII: роль системы в линии Ансаров (sys_ansari_beacon, sys_kermur, …). */
  role?: string;
}

export interface PopCounts {
  workers: number;
  specialists: number;
  rulers: number;
  unemployed: number;
}
export interface JobAssignment {
  jobId: string;
  count: number;
}

export interface Colony {
  id: number;
  planetId: number;
  systemId: number;
  empireId: number;
  name: string;
  pops: PopCounts;
  housing: number;
  stability: number;
  crime: number;
  districts: Record<string, number>;
  buildings: string[];
  /** очередь строительства: районы/здания/корабли (корабли — на верфи системы) */
  queue: BuildItem[];
  jobs: JobAssignment[];
  /** текущее производство на такт (милли) — для тултипов */
  output: Milli;
  /** потребление на такт (милли) */
  upkeep: Milli;
  unemployedWarn: boolean;
}

export type BuildKind = "district" | "building" | "ship";
export interface BuildItem {
  kind: BuildKind;
  id: string;
  ticksLeft: number;
  totalTicks: number;
  repeat?: boolean;
}

export interface TechProgress {
  techId: string | null;
  points: number;
  frac: number;
}
export interface TechState {
  completed: string[];
  progress: Record<ScienceId, TechProgress>;
  offers: Record<ScienceId, string[]>;
}

/** Пользовательский дизайн корабля (конструктор M5/M12). Хранится в World.customDesigns. */
export interface CustomDesign {
  id: string;
  ownerId: number;
  nameRu: string;
  hullId: string;
  weapons: string[];
  modules: string[];
  /** итоговый флотпауэр (GDD §9.4, калиброван к таблице классов) */
  fleetPower: number;
  costAlloys: number;
  /** табличная цена верфи в кредитах (03b §10.3) */
  costCredits: number;
  buildTicks: number;
  createdTick: number;
  updatedTick: number;
}

/** Черновик дизайна, который приходит из UI/команд. */
export interface DesignDraft {
  nameRu: string;
  hullId: string;
  weapons: string[];
  modules: string[];
}

export interface Ship {
  id: number;
  designId: string;
  classId: ShipClassId;
  name: string;
  hull: number;
  hullMax: number;
  armor: number;
  armorMax: number;
  shield: number;
  shieldMax: number;
  fleetPower: number;
  exp: number;
  isFlagship: boolean;
  /** накопленный урон для отчётов */
  damageTaken?: number;
}

export type FleetStatus = "idle" | "moving" | "combat" | "docked" | "retreat" | "scanning";
export type Formation = "wedge" | "wall" | "sphere" | "swarm" | "echelon" | "ambush" | "caravan";

export interface Fleet {
  id: number;
  empireId: number;
  name: string;
  systemId: number;
  ships: Ship[];
  path: number[];         // полный маршрут (включая текущую систему? нет — только будущие)
  pathIndex: number;
  jumpTicksLeft: number;
  status: FleetStatus;
  formation: Formation;
  admiralName: string | null;
  /** приказ "следовать" за флотом */
  followFleetId: number | null;
}

export interface Relation {
  opinion: number; // -100..100
  treaty: "none" | "nap" | "trade" | "alliance" | "war";
  /** сколько тактов уже воюют */
  warTicks: number;
}

export interface AiState {
  focus: "expand" | "science" | "military" | "economy";
  aggression: number;   // 0..100
  nextDecisionTick: number;
  targetSystemId: number;
  colonizeCooldown: number;
}

export interface Empire {
  id: number;
  name: string;
  color: string;
  isPlayer: boolean;
  capitalSystemId: number;
  dead: boolean;
  resources: Resources;
  frac: Milli;
  science: SciencePoints;
  scienceFrac: SciencePoints;
  incomeLastTick: Resources;
  scienceLastTick: SciencePoints;
  techs: TechState;
  systems: number[];
  colonies: number[];
  fleets: number[];
  relations: Record<number, Relation>;
  ai: AiState | null;
  flagshipFleetId: number;
  stats: {
    techsResearched: number;
    coloniesFounded: number;
    shipsBuilt: number;
    shipsLost: number;
    battlesWon: number;
    battlesLost: number;
    creditsEarned: number;
  };
}

export interface Mission {
  id: number;
  defId: string;
  kind: string;
  titleRu: string;
  descRu: string;
  systemId: number;
  stationId: number;
  rewardCredits: number;
  deadlineTick: number;
  accepted: boolean;
  completed: boolean;
  failed: boolean;
  /** прогресс: сканирование/уничтожение/доставка */
  progress: number;
  targetAmount: number;
}

export interface BattleSide {
  empireId: number;
  fleetId: number;
  fp: number;
  shipsBefore: number;
}
export interface BattleRecord {
  id: string;
  tick: number;
  systemId: number;
  attacker: BattleSide;
  defender: BattleSide;
  outcome: "attacker_win" | "defender_win" | "draw";
  attackerLossFp: number;
  defenderLossFp: number;
  attackerShipsLost: number;
  defenderShipsLost: number;
  durationSec: number;
  spoilsAlloys: number;
  spoilsCredits: number;
  tactical: boolean;
}

export type EventKind =
  | "tick" | "combat" | "economy" | "research" | "colony" | "fleet" | "diplomacy"
  | "mission" | "anomaly" | "victory" | "system" | "warn" | "good";
export type EventSeverity = "info" | "good" | "warn" | "bad";

export interface GameEvent {
  id: number;
  tick: number;
  kind: EventKind;
  severity: EventSeverity;
  messageRu: string;
  systemId?: number;
  empireId?: number;
}

export interface ScoreBreakdown {
  population: number;
  systems: number;
  techs: number;
  fleetPower: number;
  economy: number;
  total: number;
}

export type VictoryKind = "domination" | "federation" | "ascension" | "economy" | "crisis" | "score";
export interface VictoryState {
  achieved: VictoryKind | null;
  tickAchieved: number;
  winnerEmpireId: number;
}

export interface World {
  schemaVersion: number;
  rulesetVersion: string;
  modeId: string;
  seed: number;
  tick: number;
  speed: number;       // 0..5 (0 = пауза)
  paused: boolean;
  systems: StarSystem[];
  empires: Empire[];
  playerEmpireId: number;
  fleets: Fleet[];
  colonies: Colony[];
  missions: Mission[];
  battles: BattleRecord[];
  log: GameEvent[];
  nextId: number;
  rngState: [number, number, number, number];
  victory: VictoryState;
  mode: ModeConfig;
  balance: BalanceConfig;
  /** суммарные продажи/покупки на бирже за такт — для анти-эксплойта */
  tradeVolume: number;
  flags: Record<string, number>;
  /** Пользовательские дизайны кораблей (конструктор, M5/M12). */
  customDesigns: CustomDesign[];
  /** Расширенное состояние полной игры (M6–M12); лениво инициализируется. */
  fg?: FullGameState;
}

export interface CommandResult {
  ok: boolean;
  messageRu?: string;
  /** если команда создала сущность (флот/колонию) */
  createdId?: number;
}

export type Command =
  | { type: "move_fleet"; fleetId: number; systemId: number }
  | { type: "stop_fleet"; fleetId: number }
  | { type: "colonize"; fleetId: number; planetId: number }
  | { type: "build_ship"; systemId: number; designId: string; count: number }
  // --- M5/M12: конструктор кораблей
  | { type: "create_design"; nameRu: string; hullId: string; weapons: string[]; modules: string[] }
  | { type: "update_design"; designId: string; nameRu?: string; hullId?: string; weapons?: string[]; modules?: string[] }
  | { type: "delete_design"; designId: string }
  | { type: "save_design"; design: DesignDraft; designId?: string }
  | { type: "build_district"; colonyId: number; districtId: string }
  | { type: "build_building"; colonyId: number; buildingId: string }
  | { type: "cancel_build"; colonyId: number; index: number }
  | { type: "research"; school: ScienceId; techId: string }
  | { type: "trade"; stationId: number; good: ResourceId; qty: number; buy: boolean }
  | { type: "scan_system"; fleetId: number; systemId: number }
  | { type: "accept_mission"; missionId: number }
  | { type: "abandon_mission"; missionId: number }
  | { type: "make_peace"; targetEmpireId: number }
  | { type: "repair_fleet"; fleetId: number }
  | { type: "set_formation"; fleetId: number; formation: Formation }
  | { type: "apply_battle"; report: BattleRecord }
  | { type: "set_speed"; speed: number }
  | { type: "flagship_jump"; systemId: number }
  | { type: "join_battle"; systemId: number; enemyFleetId: number }
  // --- M6: традиции и перки
  | { type: "tradition_unlock"; treeId: string; nodeId: string }
  | { type: "perk_unlock"; perkId: string }
  // --- M7: дипломатия, войны, федерации, совет, шпионаж
  | { type: "treaty_offer"; targetEmpireId: number; treaty: "nap" | "trade" | "research" | "defensive" | "alliance" | "federation" | "vassal" | "tribute" }
  | { type: "treaty_respond"; offerId: number; accept: boolean }
  | { type: "declare_war"; targetEmpireId: number; cb?: "conquest" | "liberation" | "humiliation" | "vassalization" | "defensive"; claims?: number[] }
  | { type: "make_peace"; targetEmpireId: number }
  | { type: "claim_system"; systemId: number }
  | { type: "federation_invite"; targetEmpireId: number }
  | { type: "federation_accept"; leaderEmpireId: number }
  | { type: "federation_leave" }
  | { type: "council_propose"; resolutionType: string; targetEmpireId?: number }
  | { type: "council_vote"; resolutionId: string; vote: boolean }
  | { type: "council_veto"; resolutionId: string }
  | { type: "espionage"; targetEmpireId: number; op: "fleet_recon" | "steal_tech" | "sabotage" | "incite" | "steal_map" | "assassinate" }
  // --- M8: рынок с ордерами, биржа, маршруты, контракты
  | { type: "market_order"; stationId: number; good: ResourceId; side: "buy" | "sell"; price: number; qty: number }
  | { type: "market_cancel"; stationId: number; orderId: number }
  | { type: "exchange_trade"; side: "buy" | "sell"; qty: number; limitRate?: number }
  | { type: "route_create"; fromSystemId: number; toSystemId: number; good: ResourceId; qty: number; sellAtDest: boolean }
  | { type: "route_cancel"; routeId: number }
  | { type: "contract_accept"; contractId: number }
  | { type: "contract_abandon"; contractId: number }
  // --- M9: кампания, события, аномалии
  | { type: "campaign_start"; missionId: string }
  | { type: "campaign_branch"; branch: "federation" | "sovereignty" | "syndicate" }
  | { type: "event_choice"; eventId: string; choiceId: string }
  | { type: "event_dismiss"; eventId: string }
  | { type: "ancients_tech"; techId: string }
  | { type: "warp_jump"; targetSystemId: number }
  | { type: "warp_recharge" }
  | { type: "sector_scan"; systemId: number }
  | { type: "sector_claim"; systemId: number }
  | { type: "ancients_final"; choice: "seal" | "use" | "give" }
  | { type: "dlc_quest_accept"; questId: string; source?: "story_message" | "board" | "rumor" | "signal" }
  | { type: "dlc_dialogue_start"; sceneId: string; questId?: string }
  | { type: "dlc_dialogue_choice"; nodeId: string; choiceId: string }
  | { type: "dlc_dialogue_advance" }
  | { type: "dlc_dialogue_end" }
  | { type: "ai_world_event_choice"; eventId: number; choiceId: string }
  | { type: "dlc_action"; action: string; target?: string }
  | { type: "dlc_buy_rumor"; rumorId: string }
  | { type: "dlc_toggle"; enabled: boolean }
  // Часть XIII: линия и Реликтовый Предел (алиасы под UI + QA-команда)
  | { type: "ancients_accept_mission"; questId?: string }
  | { type: "ancients_quest"; action: "accept" | "complete"; questId?: string }
  | { type: "ancients_sector_enter"; systemId?: number }
  | { type: "ancients_sector_exit" }
  | { type: "sector_enter"; systemId?: number }
  | { type: "sector_exit" }
  | { type: "anomaly_investigate"; anomalyId: string }
  | { type: "archaeology_step"; chainId: string }
  // --- M12: мегаструктуры
  | { type: "megastructure_build"; megastructure: "sentinel_array" | "gate" | "star_forge" | "ring_habitat" | "dyson_sphere" | "science_nexus" | "beacon"; systemId: number }
  // --- M11: мультиплеер (политика паузы)
  | { type: "pause_vote"; vote: boolean };

export interface IncomeLine {
  labelRu: string;
  valueMilli: number;
  detailRu?: string;
}
export interface IncomeBreakdown {
  resource: ResourceId;
  totalMilli: number;
  lines: IncomeLine[];
}

export interface Api {
  createWorld(seed: number, mode: ModeConfig, balance: BalanceConfig): World;
  tick(world: World): void;
  applyCommand(world: World, cmd: Command): CommandResult;
  getIncomeBreakdown(world: World, empireId: number, resource: ResourceId): IncomeBreakdown;
  getProjectedIncome(world: World, empireId: number): Resources;
  getFleetPower(fleet: Fleet): number;
  getEmpireFleetPower(world: World, empireId: number): number;
  getFleetCap(world: World, empireId: number): number;
  getScore(world: World, empireId: number): ScoreBreakdown;
  getVictory(world: World): VictoryState;
  getColonyOutput(world: World, colony: Colony): { output: Milli; upkeep: Milli; workersNeeded: number };
  getBuildCost(world: World, kind: BuildKind, id: string): Partial<Resources>;
  canAfford(world: World, empireId: number, cost: Partial<Resources>): boolean;
  getShipDesign(id: string): ShipDesignDef | undefined;
  getHull(id: string): HullDef | undefined;
  getWeapon(id: string): WeaponDef | undefined;
  getModule(id: string): ModuleDef | undefined;
  getTech(id: string): TechDef | undefined;
  getBuilding(id: string): BuildingDef | undefined;
  getDistrict(id: string): DistrictDef | undefined;
  getJob(id: string): JobDef | undefined;
  getMissionDef(id: string): MissionDef | undefined;
  serialize: (world: World) => string;
  deserialize: (json: string) => World;
  SIM_VERSION: number;
}