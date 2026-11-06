/**
 * Часть XIII · Древние, расы и Реликтовый Предел.
 * Схемы данных аддендума: расы/трейты, ветвь технологий A0–A5, линия «Наследие Ансаров»,
 * кодекс, фракции и генерация сектора «Реликтовый Предел». Числа — стартовые ориентиры.
 */
export interface RaceTraitDef {
  id: string;
  ru: string;
  descRu: string;
  /** эффекты в формате модификаторов империи (ключи modifiers.ts) */
  effects: Record<string, number>;
  /** «+» или «−» трейт */
  positive: boolean;
  /** стоимость по шкале 13a §2.2 */
  cost: number;
}

export interface RaceStartBonusDef {
  relics?: number;
  cores?: number;
  minerals?: number;
  credits?: number;
  alloys?: number;
  colonizers?: number;
  goods?: number;
}

export interface RaceDef {
  id: string;
  ru: string;
  descRu: string;
  /** короткий архетип: human_adaptant / ansari_descendant / … */
  tag: string;
  homeworldRu: string;
  traits: string[];
  xenophile: number;
  ethicsAffinity: string[];
  ethicsAnti: string[];
  signatureRu: string;
  signatureDescRu: string;
  uniqueBuilding: string | null;
  uniqueModule: string | null;
  uniqueShip: string | null;
  aiStyle: string;
  portrait: string;
  silhouette: string;
  start: RaceStartBonusDef;
  greetingRu: string;
  playable: boolean;
}

export interface AncientsTechDef {
  id: string;
  tier: number; // A0..A5 = 0..5
  ru: string;
  descRu: string;
  costRelics: number;
  costCores: number;
  requires: string[];
  /** эффекты модификаторов империи */
  effects: Record<string, number>;
  unlocks: string[];
  /** индекс миссии линии, открывающей тир (0 = не требует) */
  gateMission: number;
}

export interface AncientsObjectiveDef {
  id: string;
  type: string;
  count?: number;
  target?: string;
}

export interface AncientsRewardDef {
  relics?: number;
  cores?: number;
  tech?: string;
  flag?: string;
  codex?: string[];
  credits?: number;
  science?: number;
}

export interface AncientsQuestDef {
  id: string;
  index: number; // 1..12
  act: number;
  titleRu: string;
  briefingRu: string;
  objectives: AncientsObjectiveDef[];
  rewards: AncientsRewardDef;
  /** гейт, который открывает миссия: A0..A5 / warp / sector / ending */
  unlocks: string[];
  requiresFlags?: string[];
}

export interface CodexEntryDef {
  id: string;
  category: string;
  titleRu: string;
  textRu: string;
  /** условие разблокировки: start / quest:<id> / mission:<n> / sector / tech:<id> / faction:<id> */
  unlock: string;
}

export interface SectorFactionDef {
  id: string;
  ru: string;
  color: string;
  /** отношение к игроку по умолчанию: −100..100 */
  relation: number;
  hostile: boolean;
  descRu: string;
}

export interface SectorPoiDef {
  id: string;
  kind: string;
  ru: string;
  descRu: string;
  rewardRelics: number;
  rewardCores: number;
  /** риск/угроза 0..100 */
  threat: number;
  /** кодекс-запись, открываемая POI */
  codex: string | null;
}

export interface SectorRegionDef {
  id: string;
  ru: string;
  color: string;
  systemCount: number;
  poiKinds: string[];
  hazard: string | null;
  descRu: string;
}

export interface SectorNameBank {
  prefixes: string[];
  roots: string[];
  suffixes: string[];
}

export interface SectorHazardDef {
  id: string;
  ru: string;
  descRu: string;
  /** урон/штраф за такт в системе */
  damagePerTick: number;
  sensorPenalty: number;
}

export interface AncientsEndingDef {
  id: string;
  ru: string;
  descRu: string;
  choice: "seal" | "use" | "give";
  campaignEnding: string;
  effects: Record<string, number>;
}

export interface AncientsBundle {
  races: RaceDef[];
  traits: RaceTraitDef[];
  techs: AncientsTechDef[];
  quests: AncientsQuestDef[];
  codex: CodexEntryDef[];
  factions: SectorFactionDef[];
  pois: SectorPoiDef[];
  regions: SectorRegionDef[];
  names: SectorNameBank;
  hazards: SectorHazardDef[];
  endings: AncientsEndingDef[];
  /** Расширение Части XIII: сектор Предела (опциональные массивы — sim читает по наличию). */
  sectorMegastructures?: SectorMegastructureDef[];
  archaeologyChains?: ArchaeologyChainDef[];
  wardenTrials?: WardenTrialDef[];
  relicShips?: RelicShipDef[];
  sectorEvents?: SectorEventDef[];
}

// ===== Расширение Части XIII: объекты и события Реликтового Предела =====

/** Мегаструктура сектора (Врата / Ядро звезды / Архив). */
export interface SectorMegastructureDef {
  id: string;
  ru: string;
  descRu: string;
  /** тип сцены L1 */
  kind: "gate_ring" | "star_core" | "archive";
  /** id региона сектора */
  region: string;
  costAlloys: number;
  costRelics: number;
  costCores: number;
  buildTicks: number;
  requiredTech: string | null;
  /** номер миссии линии (0 = гейт по репутации/миссии не нужен) */
  requiredMission: number;
  effects: Record<string, number>;
  maxPerEmpire: number;
  unlocks: string[];
}

/** Археологическая цепочка сектора. */
export interface ArchaeologyChainDef {
  id: string;
  ru: string;
  descRu: string;
  steps: number;
  region: string;
  rewardRelics: number;
  rewardCores: number;
  rewardTech: string | null;
  rewardFlag: string | null;
  /** риск 0..100 */
  threat: number;
  gateMission: number;
}

/** Испытание Стражей. */
export interface WardenTrialDef {
  id: string;
  ru: string;
  descRu: string;
  /** что проверяется (текст для карточки) */
  checksRu: string;
  failTicks: number;
  rewardRelics: number;
  rewardCores: number;
  rewardStability: number;
  rewardScience: number;
  rewardCodex: string | null;
  /** FP боя при жёстком провале (0 = боя нет) */
  battleFp: number;
}

/** Уникальный реликтовый корабль. */
export interface RelicShipDef {
  id: string;
  ru: string;
  descRu: string;
  classId: string;
  hullId: string;
  fleetPower: number;
  modules: string[];
  costAlloys: number;
  costRelics: number;
  costCores: number;
  buildTicks: number;
  requiredTech: string | null;
  /** требуемая археологическая цепочка (id) или null */
  requiredChain: string | null;
  maxPerEmpire: number;
  specialRu: string;
}

export interface SectorEventChoiceDef {
  id: string;
  ru: string;
  effects: Record<string, number>;
  flag?: string;
}

/** Событие сектора с выбором и ценой. */
export interface SectorEventDef {
  id: string;
  ru: string;
  descRu: string;
  /** условие срабатывания (DSL: flag / rep / stability / noise / mission) */
  triggerRu: string;
  choices: SectorEventChoiceDef[];
}
