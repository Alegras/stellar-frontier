/**
 * @sf/data — схемы игрового контента (единственный источник истины по числам баланса).
 * Код не хардкодит числа: всё берётся из JSON, валидируется zod (validate.ts) и тестами.
 */

export type ResourceId =
  | "energy" | "minerals" | "food" | "alloys" | "goods" | "unity" | "influence" | "credits";
export type ScienceId = "physics" | "society" | "engineering";
export type Stratum = "worker" | "specialist" | "ruler";

export interface ResourceDef {
  id: ResourceId;
  ru: string;
  en: string;
  icon: string;
  color: string;
  /** запас (склад) или поток */
  stock: boolean;
  /** оптовая цена в кредитах за единицу (имперская биржа, канон: 1 Cr = 1 энергия) */
  wholesale: number;
  /** розничная цена станционного рынка (обычно ×100) */
  retail: number;
}

export interface JobDef {
  id: string;
  ru: string;
  stratum: Stratum;
  /** слот: id района/здания, дающего рабочие места; "capital" — всегда доступен */
  slot: string;
  output: Partial<Record<ResourceId, number>>;
  input?: Partial<Record<ResourceId, number>>;
  descRu?: string;
  /** если true — слот обязательно даёт хотя бы одну такую работу */
  required?: boolean;
}

export interface BuildingDef {
  id: string;
  ru: string;
  descRu: string;
  cost: Partial<Record<ResourceId, number>>;
  buildTicks: number;
  upkeepEnergy: number;
  jobs: string[];
  housing?: number;
  stability?: number;
  science?: Partial<Record<ScienceId, number>>;
  effects?: Record<string, number>;
  requiredTech?: string | null;
  icon?: string;
  maxPerColony?: number;
}

export interface DistrictDef {
  id: string;
  ru: string;
  descRu: string;
  cost: Partial<Record<ResourceId, number>>;
  buildTicks: number;
  upkeepEnergy: number;
  housing: number;
  jobs: string[];
  icon?: string;
}

export interface TechEffect {
  kind: "modifier" | "unlock" | "flag";
  /** ключ модификатора: energy_prod, minerals_prod, fleet_cap, build_speed... */
  target: string;
  value?: number;
}

export interface TechDef {
  id: string;
  school: ScienceId;
  tier: number;
  ru: string;
  descRu: string;
  cost: number;
  effects: TechEffect[];
  weight: number;
  requires?: string[];
}

export type ShipClassId =
  | "corvette" | "frigate" | "destroyer" | "cruiser" | "battleship" | "titan" | "colossus" | "carrier"
  | "shuttle" | "science" | "trader" | "miner" | "colonizer" | "troopship" | "tanker" | "flagship";

export interface HullDef {
  id: string;
  ru: string;
  classId: ShipClassId;
  mass: number;
  maxMass: number;
  hullHp: number;
  armorBase: number;
  shieldBase: number;
  slots: { small: number; medium: number; large: number; utility: number; internal: number };
  costAlloys: number;
  baseSpeed: number;
  boostSpeed: number;
  pitchDegS: number;
  buildTicks: number;
  requiredTech: string | null;
  roles: string[];
  /** размер корпуса в метрах для 3D */
  lengthM: number;
}

export type DamageType = "kinetic" | "energy" | "explosive" | "thermal";

export interface WeaponDef {
  id: string;
  ru: string;
  slot: "small" | "medium" | "large";
  dmg: number;
  rof: number;
  accuracy: number;
  rangeM: number;
  heat: number;
  power: number;
  ammo: number | null;
  dmgType: DamageType;
  costAlloys: number;
  tech: string | null;
}

export interface ModuleDef {
  id: string;
  ru: string;
  slot: "utility" | "internal";
  mass: number;
  power: number;
  costAlloys: number;
  shieldAdd?: number;
  shieldRegen?: number;
  armorAdd?: number;
  hullAdd?: number;
  heatDissipation?: number;
  cargo?: number;
  sensor?: number;
  effects?: Record<string, number>;
  tech: string | null;
}

export interface ShipDesignDef {
  id: string;
  ru: string;
  classId: ShipClassId;
  hullId: string;
  weapons: string[];
  modules: string[];
  /** таблица FP — источник истины (GDD §9.4) */
  fleetPower: number;
  costCredits: number;
  costAlloys: number;
  buildTicks: number;
  requiredTech: string | null;
  role: string;
  descRu: string;
  /** стартовый шаблон, доступный сразу */
  starter?: boolean;
}

export type MissionKind = "delivery" | "bounty" | "scan" | "passenger" | "smuggle" | "rescue";

export interface MissionDef {
  id: string;
  kind: MissionKind;
  ru: string;
  descRu: string;
  minTicks: number;
  maxTicks: number;
  rewardCredits: number;
  rewardRep: number;
  risk: number;
  /** сколько кредитов добавить за каждый прыжок дальности */
  perJumpCredits: number;
}

export interface NameBank {
  systemPrefixes: string[];
  systemRoots: string[];
  systemSuffixes: string[];
  empireNames: string[];
  shipNames: string[];
  stationNames: string[];
  anomalyNames: string[];
}

export interface ModeConfig {
  modeId: string;
  rulesetVersion: string;
  displayRu: string;
  galaxy: {
    systems: number;
    shape: "spiral" | "elliptical" | "ring" | "random";
    aiEmpires: number;
    chokepointBias: number;
  };
  time: { speeds: number[]; tacticalPause: boolean; tickSecondsAt1x: number };
  victory: string[];
  difficulty: "novice" | "normal" | "veteran" | "admiral" | "legend";
  player: { startPlanets: number; startPops: number; startAlloys: number; startCredits: number };
}

export interface Localization {
  [key: string]: string;
}

export interface BalanceConfig {
  startResources: Partial<Record<ResourceId, number>>;
  /** стартовый доход для проекции HUD (проверяется симуляцией) */
  startIncome: Partial<Record<ResourceId, number>>;
  colonyCost: Partial<Record<ResourceId, number>>;
  outpostCost: Partial<Record<ResourceId, number>>;
  fleetUpkeepPerFpEnergy: number;
  fleetUpkeepPerFpAlloys: number;
  baseFleetCap: number;
  popsFleetCap: number;
  systemsFleetCap: number;
  popFoodUpkeep: number;
  popGoodsUpkeep: Partial<Record<Stratum, number>>;
  growthBase: number;
  stabilityBase: number;
  sciencePerResearcher: number;
  interestRatePct: number;
  marketSpreadPct: number;
  marketCommissionPct: number;
  fleetSpeedTicksPerJump: number;
  maxTicks: number;
}
