/**
 * Часть XIII: Древние (Ансары), расы, ветвь «Наследие», варп и Реликтовый Предел.
 *
 * Всё состояние — в fg.ancients (сериализуется, мигрирует). Движок data-driven:
 * данные — packages/data/src/ancients/*.json; пустые массивы допустимы (тесты подставляют каталог
 * через setAncientsCatalog, прод — из @sf/data).
 *
 * Детерминизм: никакого Math.random/Date.now; генерация сектора и варп-броски — от seed мира.
 */
import {
  ANCIENT_TECH_BY_ID, ANCIENTS_CODEX, ANCIENTS_ENDINGS, ANCIENTS_QUESTS, ANCIENTS_TECHS,
  CODEX_BY_ID, RACES, RACE_BY_ID, RACE_TRAITS, RACE_TRAIT_BY_ID, SECTOR_FACTIONS,
  SECTOR_FACTION_BY_ID, SECTOR_HAZARDS, SECTOR_POIS, SECTOR_POI_BY_ID, SECTOR_REGIONS,
} from "@sf/data";
import type {
  AncientsEndingDef, AncientsQuestDef, AncientsTechDef, CodexEntryDef, RaceDef,
  SectorFactionDef, SectorHazardDef, SectorPoiDef, SectorRegionDef,
} from "@sf/data";
import { createFleet, createShip, empireById, logEvent } from "./economy";
import { hash32, nextInt, nextRange, seedRng } from "./prng";
import {
  ancientsEffectSources, ancientsSignature, ancientsSpecialValue, raceIdOf,
} from "./ancients-fx";
import type { CommandResult, Empire, Planet, Poi, StarSystem, World } from "./types";

// ------------------------------------------------------------------ константы

export const ANCIENTS_START_TICK = 1200;
export const ANCIENTS_SCHEMA_VERSION = 2;
export const SECTOR_SYSTEMS = 45;
export const SECTOR_REGIONS_COUNT = 5;
export const WARP_RADIUS_LY = 60;
export const WARP_COOLDOWN_TICKS = 5;
export const WARP_CHARGES_PER_CORE = 10;
export const WARP_RISK_PCT = 15;
export const RELIC_CAP = 60;
export const CORE_CAP = 20;
export const SECTOR_WAVE_INTERVAL = 300;
export const SECTOR_WAVE_THREAT = 6;
export const SECTOR_INVASION_THREAT = 60;
export const SECTOR_GUARDIAN_STABILITY = 80;
/** 1 единица координат карты = 10 св. лет (см. types.StarSystem.x). */
export const LY_PER_MAP_UNIT = 10;

// ------------------------------------------------------------------ каталог данных

export interface AncientsCatalog {
  races: RaceDef[];
  traits: { id: string; effects: Record<string, number> }[];
  techs: AncientsTechDef[];
  quests: AncientsQuestDef[];
  codex: CodexEntryDef[];
  factions: SectorFactionDef[];
  pois: SectorPoiDef[];
  regions: SectorRegionDef[];
  hazards: SectorHazardDef[];
  endings: AncientsEndingDef[];
  names: { prefixes: string[]; roots: string[]; suffixes: string[] };
}

let overrideCatalog: AncientsCatalog | null = null;

/** Тесты/моды/EN-runtime: подменить каталог (null — вернуть данные из @sf/data). */
export function setAncientsCatalog(catalog: AncientsCatalog | null): void {
  overrideCatalog = catalog;
}

/** Активный каталог Части XIII. */
export function ancientsCatalog(): AncientsCatalog {
  if (overrideCatalog) return overrideCatalog;
  return {
    races: RACES,
    traits: RACE_TRAITS.map((trait) => ({ id: trait.id, effects: trait.effects })),
    techs: ANCIENTS_TECHS,
    quests: ANCIENTS_QUESTS,
    codex: ANCIENTS_CODEX,
    factions: SECTOR_FACTIONS,
    pois: SECTOR_POIS,
    regions: SECTOR_REGIONS,
    hazards: SECTOR_HAZARDS,
    endings: ANCIENTS_ENDINGS,
    names: { prefixes: [], roots: [], suffixes: [] },
  };
}

// ------------------------------------------------------------------ состояние

export type AncientsQuestStatus = "locked" | "available" | "active" | "completed" | "failed";
export type AncientsFinalChoice = "seal" | "use" | "give";

export interface AncientsQuestState {
  id: string;
  status: AncientsQuestStatus;
  progress: Record<string, number>;
  acceptedTick: number;
  completedTick: number;
}

export interface AncientsTechState {
  /** A0..A5: максимальный открытый тир */
  tier: number;
  unlocked: string[];
  research: string | null;
  progress: number;
}

export interface AncientsWarpState {
  unlocked: boolean;
  /** текущие заряды (1 ядро = 10 зарядов, ёмкость 10 + core_capacity) */
  charges: number;
  /** запас ядер (не тратится зарядами) */
  cores: number;
  cooldownUntil: number;
  lastJumpTick: number;
  instability: number;
  /** сработал ли риск Хора на последнем прыжке */
  lastRiskTriggered: boolean;
}

export interface AncientsSectorSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  region: string;
  faction: string;
  poi: string[];
  hazard: string | null;
  visited: boolean;
  controlled: boolean;
  relics: number;
  cores: number;
}

export interface AncientsSectorState {
  discovered: boolean;
  generated: boolean;
  /** игрок вошёл в сектор (для UI/команд выхода) */
  active: boolean;
  enteredTick: number;
  systems: AncientsSectorSystem[];
  stability: number;
  chorusThreat: number;
  nextWaveTick: number;
  invasion: boolean;
  visited: number[];
  gates: number[];
}

export interface AncientsState {
  schemaVersion: number;
  enabled: boolean;
  playerRace: string;
  races: Record<number, string>;
  relics: number;
  cores: number;
  darkMatter: number;
  tech: AncientsTechState;
  quest: {
    stage: number;
    startedTick: number;
    missions: Record<string, AncientsQuestState>;
    activeMissionId: string | null;
    ending: string | null;
    choice: AncientsFinalChoice | null;
    language: number;
    anomaliesFound: string[];
    visitedSystems: number[];
  };
  warp: AncientsWarpState;
  sector: AncientsSectorState;
  factions: Record<string, { relation: number; met: boolean }>;
  codex: string[];
  flags: Record<string, number>;
  /** счётчики для объективов и статистики линии */
  stats: Record<string, number>;
}

function emptyQuest(id: string): AncientsQuestState {
  return { id, status: "locked", progress: {}, acceptedTick: 0, completedTick: 0 };
}

function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Детерминированное распределение рас: игрок — выбранная/первая, ИИ — по seed+id. */
function pickAiRace(world: World, empireId: number, catalog: AncientsCatalog): string {
  if (catalog.races.length === 0) return "race_velan";
  const index = hash32(world.seed, empireId) % catalog.races.length;
  return catalog.races[index]!.id;
}

export function createAncientsState(world: World, raceId?: string, catalogArg?: AncientsCatalog): AncientsState {
  const catalog = catalogArg ?? ancientsCatalog();
  const validRequested = raceId ? catalog.races.find((race) => race.id === raceId) : undefined;
  const playable = catalog.races.filter((race) => race.playable);
  const playerRace = validRequested?.id ?? playable[0]?.id ?? catalog.races[0]?.id ?? "race_velan";
  const races: Record<number, string> = {};
  for (const empire of world.empires) {
    races[empire.id] = empire.id === world.playerEmpireId ? playerRace : pickAiRace(world, empire.id, catalog);
  }
  const missions: Record<string, AncientsQuestState> = {};
  for (const quest of catalog.quests) missions[quest.id] = emptyQuest(quest.id);
  const factions: AncientsState["factions"] = {};
  for (const faction of catalog.factions) factions[faction.id] = { relation: faction.relation, met: false };
  return {
    schemaVersion: ANCIENTS_SCHEMA_VERSION,
    enabled: true,
    playerRace,
    races,
    // Стартовые бонусы р��сы применяются ровно один раз в applyRaceStartBonuses().
    relics: 0,
    cores: 0,
    darkMatter: 0,
    tech: { tier: -1, unlocked: [], research: null, progress: 0 },
    quest: {
      stage: 0, startedTick: 0, missions, activeMissionId: null, ending: null, choice: null,
      language: 0, anomaliesFound: [], visitedSystems: [],
    },
    warp: { unlocked: false, charges: 0, cores: 0, cooldownUntil: 0, lastJumpTick: 0, instability: 0, lastRiskTriggered: false },
    sector: {
      discovered: false, generated: false, active: false, enteredTick: 0, systems: [],
      stability: 50, chorusThreat: 0, nextWaveTick: 0, invasion: false, visited: [], gates: [],
    },
    factions,
    codex: [],
    flags: {},
    stats: {},
  };
}

/** Миграция/нормализация состояния (старые сейвы, новые поля, новые данные). */
export function migrateAncientsState(world: World, raw: Partial<AncientsState> | null | undefined, catalogArg?: AncientsCatalog): AncientsState {
  const catalog = catalogArg ?? ancientsCatalog();
  const base = createAncientsState(world, raw?.playerRace, catalog);
  if (!raw) return base;
  const state: AncientsState = { ...base, ...raw } as AncientsState;
  state.schemaVersion = ANCIENTS_SCHEMA_VERSION;
  state.tech = { ...base.tech, ...(raw.tech ?? {}) };
  state.quest = { ...base.quest, ...(raw.quest ?? {}) } as AncientsState["quest"];
  state.quest.missions = { ...base.quest.missions, ...(raw.quest?.missions ?? {}) };
  for (const questId of Object.keys(state.quest.missions)) {
    state.quest.missions[questId] = { ...emptyQuest(questId), ...state.quest.missions[questId] };
  }
  state.warp = { ...base.warp, ...(raw.warp ?? {}) };
  state.sector = { ...base.sector, ...(raw.sector ?? {}) } as AncientsSectorState;
  if (!Array.isArray(state.sector.systems)) state.sector.systems = [];
  if (!Array.isArray(state.sector.visited)) state.sector.visited = [];
  if (!Array.isArray(state.sector.gates)) state.sector.gates = [];
  state.factions = { ...base.factions, ...(raw.factions ?? {}) };
  if (!Array.isArray(state.codex)) state.codex = [];
  if (!state.flags || typeof state.flags !== "object") state.flags = {};
  if (!state.stats || typeof state.stats !== "object") state.stats = {};
  if (!Array.isArray(state.quest.visitedSystems)) state.quest.visitedSystems = [];
  if (!Array.isArray(state.quest.anomaliesFound)) state.quest.anomaliesFound = [];
  // Новые квесты из данных, которых не было в сейве.
  for (const quest of catalog.quests) {
    if (!state.quest.missions[quest.id]) state.quest.missions[quest.id] = emptyQuest(quest.id);
  }
  // Раса игрока могла смениться в данных.
  if (!state.playerRace || !catalog.races.some((race) => race.id === state.playerRace)) {
    state.playerRace = base.playerRace;
  }
  state.races[world.playerEmpireId] = state.playerRace;
  return state;
}

/** Гарантированно существующее состояние (ленивая инициализация/миграция). */
export function ensureAncients(world: World, catalogArg?: AncientsCatalog): AncientsState {
  const catalog = catalogArg ?? ancientsCatalog();
  if (!world.fg) return createAncientsState(world, undefined, catalog);
  if (!world.fg.ancients) {
    world.fg.ancients = createAncientsState(world, undefined, catalog);
  } else if (world.fg.ancients.schemaVersion !== ANCIENTS_SCHEMA_VERSION) {
    world.fg.ancients = migrateAncientsState(world, world.fg.ancients, catalog);
  }
  return world.fg.ancients;
}

/** Аксессор для UI (гарантирует инициализацию). */
export function getAncientsState(world: World): AncientsState {
  return ensureAncients(world);
}

// ------------------------------------------------------------------ расы

export function getRaceDef(raceId: string | null | undefined, catalogArg?: AncientsCatalog): RaceDef | null {
  const catalog = catalogArg ?? ancientsCatalog();
  return raceId ? catalog.races.find((race) => race.id === raceId) ?? null : null;
}

export function getRaceChoices(catalogArg?: AncientsCatalog): RaceDef[] {
  const catalog = catalogArg ?? ancientsCatalog();
  return catalog.races.filter((race) => race.playable);
}

export function raceFor(world: World, empireId: number): string {
  const a = ensureAncients(world);
  if (empireId === world.playerEmpireId) return a.playerRace;
  return a.races[empireId] ?? (a.races[world.playerEmpireId] ?? "race_velan");
}

export function raceDef(raceId: string | null | undefined): RaceDef | null {
  return getRaceDef(raceId);
}

/** Стартовые бонусы расы (ровно один раз). */
export function applyRaceStartBonuses(world: World, empireId: number): void {
  const a = ensureAncients(world);
  const key = "race_start_applied";
  if (a.flags[key]) return;
  a.flags[key] = 1;
  const empire = empireById(world, empireId);
  if (!empire) return;
  const race = getRaceDef(a.playerRace);
  if (!race) return;
  const start = race.start;
  if (start.relics) addRelics(world, a, start.relics);
  if (start.cores) addCores(world, a, start.cores);
  if (start.minerals) empire.resources.minerals += start.minerals;
  if (start.credits) empire.resources.credits += start.credits;
  if (start.alloys) empire.resources.alloys += start.alloys;
  if (start.goods) empire.resources.goods += start.goods;
  if (start.colonizers) {
    const flagship = world.fleets.find((fleet) => fleet.id === empire.flagshipFleetId)
      ?? world.fleets.find((fleet) => fleet.empireId === empireId && fleet.ships.length > 0);
    for (let i = 0; i < start.colonizers; i++) {
      const ship = createShip(world.nextId++, "colonizer_ark", "Колонизатор «" + race.ru + "»", false, world);
      if (flagship) flagship.ships.push(ship);
      else {
        const fleet = createFleet(world, empireId, empire.capitalSystemId, [ship], "Ковчег расы", "wall");
        void fleet;
      }
    }
  }
  const unique = [race.uniqueBuilding, race.uniqueModule, race.uniqueShip].filter((id): id is string => !!id);
  for (const id of unique) a.flags["unique:" + id] = 1;
  a.flags["race:" + race.id] = 1;
}

/** Явный выбор расы (UI newGame fallback). Разрешён только до старта партии. */
export function setPlayerRace(world: World, empireId: number, raceId: string): CommandResult {
  const catalog = ancientsCatalog();
  const race = getRaceDef(raceId, catalog);
  if (!race) return { ok: false, messageRu: "Неизвестная раса" };
  if (!race.playable) return { ok: false, messageRu: "Эта раса недоступна для выбора" };
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Раса выбирается только для игрока" };
  const a = ensureAncients(world);
  if (world.tick > 0 || a.quest.stage > 0) return { ok: false, messageRu: "Раса выбирается до старта партии" };
  a.playerRace = race.id;
  a.races[empireId] = race.id;
  applyRaceStartBonuses(world, empireId);
  return { ok: true, messageRu: "Раса выбрана: " + race.ru };
}

// ------------------------------------------------------------------ реликвии/ядра

export function addRelics(world: World, a: AncientsState, count: number): number {
  if (!Number.isFinite(count) || count === 0) return 0;
  a.stats.relicsEarned = (a.stats.relicsEarned ?? 0) + Math.max(0, count);
  const total = a.relics + Math.max(0, count);
  const overflow = Math.max(0, total - RELIC_CAP);
  a.relics = Math.min(RELIC_CAP, total);
  if (overflow > 0) {
    // 13c §2.3: 1 реликвия сверх лимита → 120 единства.
    const empire = empireById(world, world.playerEmpireId);
    if (empire) empire.resources.unity += overflow * 120;
    a.stats.relicOverflow = (a.stats.relicOverflow ?? 0) + overflow;
  }
  return Math.max(0, count) - overflow;
}

export function addCores(world: World, a: AncientsState, count: number): number {
  if (!Number.isFinite(count) || count === 0) return 0;
  a.stats.coresEarned = (a.stats.coresEarned ?? 0) + Math.max(0, count);
  const total = a.cores + Math.max(0, count);
  const overflow = Math.max(0, total - CORE_CAP);
  a.cores = Math.min(CORE_CAP, total);
  if (overflow > 0) addRelics(world, a, overflow * 5);
  return Math.max(0, count) - overflow;
}

export function addCodexEntry(world: World, a: AncientsState, ids: string[]): void {
  const catalog = ancientsCatalog();
  for (const id of ids) {
    if (!id) continue;
    if (!a.codex.includes(id)) a.codex.push(id);
  }
  a.quest.language = codexLanguageLevel(a, catalog);
}

/** Уровень расшифровки 0..5 по числу записей кодекса. */
export function codexLanguageLevel(a: AncientsState, catalogArg?: AncientsCatalog): number {
  const catalog = catalogArg ?? ancientsCatalog();
  const codexCount = a.codex.filter((id) => catalog.codex.some((entry) => entry.id === id)).length;
  if (a.flags["fragments"] && a.flags["fragments"] >= 56) return 5;
  if (a.flags["fragments"] && a.flags["fragments"] >= 40) return 4;
  if (a.flags["fragments"] && a.flags["fragments"] >= 26) return 3;
  if (a.flags["fragments"] && a.flags["fragments"] >= 14) return 2;
  if (a.flags["fragments"] && a.flags["fragments"] >= 6) return 1;
  return Math.min(1, Math.floor(codexCount / 12));
}

// ------------------------------------------------------------------ линия 12 миссий

function questList(catalogArg?: AncientsCatalog): AncientsQuestDef[] {
  return [...(catalogArg ?? ancientsCatalog()).quests].sort((a, b) => a.index - b.index);
}

export function questById(id: string, catalogArg?: AncientsCatalog): AncientsQuestDef | null {
  const catalog = catalogArg ?? ancientsCatalog();
  return catalog.quests.find((quest) => quest.id === id) ?? null;
}

export function activeQuest(world: World, catalogArg?: AncientsCatalog): AncientsQuestDef | null {
  const a = ensureAncients(world);
  return a.quest.activeMissionId ? questById(a.quest.activeMissionId, catalogArg) : null;
}

function statKeyForObjective(type: string): string | null {
  if (type === "scan") return "scans";
  if (type === "warp_jump") return "warpJumps";
  if (type === "sector_scan") return "sectorScans";
  if (type === "sector_claim") return "sectorClaims";
  if (type === "kill_fp") return "killFp";
  if (type === "relics") return "relicsEarned";
  if (type === "cores") return "coresEarned";
  return null;
}

function objectiveSatisfied(world: World, a: AncientsState, quest: AncientsQuestDef, objective: { id: string; type: string; count?: number; target?: string }): boolean {
  const need = objective.count ?? 1;
  const progress = a.quest.missions[quest.id]?.progress[objective.id] ?? 0;
  const target = objective.target ?? "";
  switch (objective.type) {
    case "flag":
      // Флаг-цель, совпадающая с флагом-наградой миссии, считается её исходом (данные 13b).
      if (quest.rewards.flag && quest.rewards.flag === target) return true;
      return (a.flags[target] ?? 0) >= Math.max(1, need) || (world.flags[target] ?? 0) >= Math.max(1, need);
    case "tech": return a.tech.unlocked.includes(target);
    case "relation": return (a.factions[target]?.relation ?? -100) >= need;
    case "visit": return progress >= need;
    default: return progress >= need;
  }
}

function updateObjectiveProgress(world: World, a: AncientsState, quest: AncientsQuestDef): void {
  const state = a.quest.missions[quest.id];
  if (!state) return;
  for (const objective of quest.objectives) {
    if (objective.type === "flag" || objective.type === "tech" || objective.type === "relation") continue;
    const counter = statKeyForObjective(objective.type);
    if (!counter) continue;
    const baseKey = "base:" + objective.id;
    if (state.progress[baseKey] === undefined) state.progress[baseKey] = a.stats[counter] ?? 0;
    state.progress[objective.id] = (a.stats[counter] ?? 0) - state.progress[baseKey];
  }
  for (const objective of quest.objectives) {
    if (objective.type !== "visit") continue;
    const baseKey = "base:" + objective.id;
    if (state.progress[baseKey] === undefined) state.progress[baseKey] = a.quest.visitedSystems.length;
    if (objective.target && objective.target !== "any") {
      const match = a.quest.visitedSystems.some((systemId) => {
        const system = world.systems[systemId];
        return system && (system.role === objective.target || system.name === objective.target || String(systemId) === objective.target);
      });
      if (match) state.progress[objective.id] = Math.max(state.progress[objective.id] ?? 0, 1);
    } else {
      state.progress[objective.id] = a.quest.visitedSystems.length - state.progress[baseKey];
    }
  }
}

function missionComplete(world: World, a: AncientsState, quest: AncientsQuestDef): boolean {
  return quest.objectives.every((objective) => objectiveSatisfied(world, a, quest, objective));
}

function unlockToken(world: World, a: AncientsState, token: string): void {
  if (token === "warp") {
    a.warp.unlocked = true;
    a.warp.charges = Math.max(a.warp.charges, WARP_CHARGES_PER_CORE);
    a.flags["unlock:warp"] = 1;
    return;
  }
  if (token === "sector") {
    a.sector.discovered = true;
    a.flags["unlock:sector"] = 1;
    ensureSectorGenerated(world);
    return;
  }
  if (token === "ending") {
    a.flags["final_available"] = 1;
    return;
  }
  if (/^A[0-5]$/.test(token)) {
    a.flags["ansari_unlock_" + token] = 1;
    return;
  }
  a.flags["unlock:" + token] = 1;
}

function applyRewards(world: World, a: AncientsState, quest: AncientsQuestDef, catalog: AncientsCatalog): void {
  const state = a.quest.missions[quest.id];
  if (!state || state.progress.rewarded) return;
  state.progress.rewarded = 1;
  const rewards = quest.rewards;
  if (rewards.relics) addRelics(world, a, rewards.relics);
  if (rewards.cores) addCores(world, a, rewards.cores);
  if (rewards.flag) a.flags[rewards.flag] = 1;
  if (rewards.codex && rewards.codex.length > 0) addCodexEntry(world, a, rewards.codex);
  if (rewards.tech) {
    const tech = catalog.techs.find((entry) => entry.id === rewards.tech);
    if (tech && !a.tech.unlocked.includes(tech.id)) {
      a.tech.unlocked.push(tech.id);
      a.tech.tier = Math.max(a.tech.tier, tech.tier);
      for (const unlock of tech.unlocks) unlockToken(world, a, unlock);
    }
  }
  if (rewards.credits) {
    const empire = empireById(world, world.playerEmpireId);
    if (empire) empire.resources.credits += rewards.credits;
  }
  if (rewards.science) {
    const empire = empireById(world, world.playerEmpireId);
    if (empire) {
      const each = Math.max(1, Math.round(rewards.science / 3));
      empire.science.physics += each;
      empire.science.society += each;
      empire.science.engineering += each;
    }
  }
  for (const unlock of quest.unlocks) unlockToken(world, a, unlock);
  a.stats.missions = (a.stats.missions ?? 0) + 1;
  state.status = "completed";
  state.completedTick = world.tick;
  a.quest.stage += 1;
  a.quest.activeMissionId = null;
  a.flags["mission:" + quest.id] = 1;
  a.stats.completedMissions = a.quest.stage;
  if (quest.index >= questList(catalog).length) a.flags["line_complete"] = 1;
}

/** Автоматическое ведение линии: доступность, автостарт, прогресс, награды (идемпотентно). */
export function advanceAncientsLine(world: World, catalogArg?: AncientsCatalog): void {
  const catalog = catalogArg ?? ancientsCatalog();
  const a = ensureAncients(world, catalog);
  if (!a.enabled || catalog.quests.length === 0) return;
  // Учёт посещённых систем игрока (для objective type=visit).
  for (const fleet of world.fleets) {
    if (fleet.empireId !== world.playerEmpireId) continue;
    if (!a.quest.visitedSystems.includes(fleet.systemId)) a.quest.visitedSystems.push(fleet.systemId);
  }

  if (world.tick < ANCIENTS_START_TICK) return;
  if (!a.quest.startedTick) a.quest.startedTick = world.tick;
  const quests = questList(catalog);

  for (const quest of quests) {
    const state = a.quest.missions[quest.id];
    if (!state || state.status === "completed") continue;
    const previous = quests.filter((entry) => entry.index < quest.index);
    const previousDone = previous.every((entry) => a.quest.missions[entry.id]?.status === "completed");
    const flagsOk = (quest.requiresFlags ?? []).every((flag) => (a.flags[flag] ?? world.flags[flag] ?? 0) > 0);
    if (state.status === "locked" && previousDone && flagsOk) state.status = "available";
    if (state.status === "available" && previousDone && flagsOk && a.quest.activeMissionId === null) {
      state.status = "active";
      state.acceptedTick = world.tick;
      state.progress = {};
      a.quest.activeMissionId = quest.id;
      a.flags["mission_started:" + quest.id] = 1;
      // Миссии с секторными объективами сами открывают сектор (иначе недостижимы).
      if (quest.objectives.some((objective) => objective.type === "sector_scan" || objective.type === "sector_claim")) {
        a.sector.discovered = true;
        ensureSectorGenerated(world, catalog);
      }
    }
    if (state.status === "active") {
      updateObjectiveProgress(world, a, quest);
      if (missionComplete(world, a, quest)) applyRewards(world, a, quest, catalog);
      break;
    }
    // статус не completed и не active — ждём следующей фазы (заблокирована условиями)
    break;
  }
  void quests;
}

/** Приём миссии вручную (UI/QA); если missionId не указан — первая доступная. */
export function acceptAncientsMission(world: World, empireId: number, missionId?: string): CommandResult {
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Линия доступна только игроку" };
  const a = ensureAncients(world);
  const catalog = ancientsCatalog();
  if (world.tick < ANCIENTS_START_TICK) return { ok: false, messageRu: "Линия начинается во II акте (такт 1200+)" };
  advanceAncientsLine(world, catalog);
  if (a.quest.activeMissionId) return { ok: false, messageRu: "Уже есть активная миссия линии" };
  const available = catalog.quests
    .slice()
    .sort((x, y) => x.index - y.index)
    .find((quest) => a.quest.missions[quest.id]?.status === "available");
  if (!available) return { ok: false, messageRu: "Нет доступных миссий линии" };
  if (missionId && available.id !== missionId) {
    const requested = catalog.quests.find((quest) => quest.id === missionId);
    if (!requested || a.quest.missions[requested.id]?.status !== "available") return { ok: false, messageRu: "Миссия недоступна" };
  }
  const quest = missionId ? catalog.quests.find((entry) => entry.id === missionId)! : available;
  const state = a.quest.missions[quest.id]!;
  state.status = "active";
  state.acceptedTick = world.tick;
  state.progress = {};
  a.quest.activeMissionId = quest.id;
  return { ok: true, messageRu: "Миссия «" + quest.titleRu + "» начата" };
}

/** Форс-завершение активной миссии (QA/тесты/отладка). Награды выдаются один раз. */
export function completeAncientsMission(world: World, missionId?: string): CommandResult {
  const a = ensureAncients(world);
  const catalog = ancientsCatalog();
  const questId = missionId ?? a.quest.activeMissionId;
  if (!questId) return { ok: false, messageRu: "Нет активной миссии" };
  const quest = catalog.quests.find((entry) => entry.id === questId);
  if (!quest) return { ok: false, messageRu: "Миссия не найдена" };
  const state = a.quest.missions[quest.id];
  if (!state) return { ok: false, messageRu: "Миссия не инициализирована" };
  if (state.status === "completed") return { ok: false, messageRu: "Миссия уже завершена" };
  state.status = "active";
  state.progress = { ...state.progress };
  for (const objective of quest.objectives) state.progress[objective.id] = objective.count ?? 1;
  applyRewards(world, a, quest, catalog);
  // Сразу открыть следующую миссию (без ожидания следующего такта).
  advanceAncientsLine(world, catalog);
  return { ok: true, messageRu: "Миссия «" + quest.titleRu + "» завершена" };
}

/** Финал линии: 3 выбора (seal/use/give). */
export function ancientsFinalChoice(world: World, empireId: number, choice: AncientsFinalChoice): CommandResult {
  const a = ensureAncients(world);
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Финал линии доступен только игроку" };
  const catalog = ancientsCatalog();
  const quests = questList(catalog);
  if (quests.length === 0) return { ok: false, messageRu: "Данные линии не загружены" };
  if (a.quest.stage < quests.length) return { ok: false, messageRu: "Сначала пройдите линию до миссии 12" };
  if (a.quest.choice) return { ok: false, messageRu: "Финал уже выбран" };
  const ending = catalog.endings.find((entry) => entry.choice === choice);
  a.quest.choice = choice;
  a.quest.ending = ending?.id ?? (choice === "seal" ? "ending_seal" : choice === "use" ? "ending_use" : "ending_give");
  a.flags["ending:" + a.quest.ending] = 1;
  if (ending) {
    for (const key of Object.keys(ending.effects)) {
      const value = ending.effects[key];
      if (typeof value === "number" && key === "unity") {
        const empire = empireById(world, world.playerEmpireId);
        if (empire) empire.resources.unity += value;
      } else if (typeof value === "number") {
        a.flags["ending_effect:" + key] = value;
      }
    }
  }
  return { ok: true, messageRu: "Финал линии выбран: " + (ending?.ru ?? choice) };
}

// ------------------------------------------------------------------ технологии A0–A5

export interface AncientsTechView {
  def: AncientsTechDef;
  unlocked: boolean;
  available: boolean;
  reasonRu: string;
  costRelics: number;
  costCores: number;
}

export function getAncientsTechs(world: World, catalogArg?: AncientsCatalog): AncientsTechView[] {
  const catalog = catalogArg ?? ancientsCatalog();
  const a = ensureAncients(world, catalog);
  return catalog.techs.map((def) => {
    const unlocked = a.tech.unlocked.includes(def.id);
    let reasonRu = "";
    if (unlocked) reasonRu = "Открыта";
    else if (a.tech.tier + 1 < def.tier) reasonRu = "Сначала откройте предыдущий тир";
    else if (def.gateMission > a.quest.stage) reasonRu = "Нужен прогресс линии (миссия " + def.gateMission + ")";
    else if (def.requires.some((req) => !a.tech.unlocked.includes(req))) reasonRu = "Не открыты предыдущие технологии";
    else if (a.relics < def.costRelics) reasonRu = "Не хватает реликвий";
    else if (a.cores < def.costCores) reasonRu = "Не хватает ядер";
    return { def, unlocked, available: !unlocked && reasonRu === "", reasonRu, costRelics: def.costRelics, costCores: def.costCores };
  });
}

export function ancientsResearchTech(world: World, empireId: number, techId: string): CommandResult {
  const catalog = ancientsCatalog();
  const a = ensureAncients(world, catalog);
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Ветвь Наследия доступна только игроку" };
  if (!world.fg) return { ok: false, messageRu: "Полная игра не инициализирована" };
  const tech = catalog.techs.find((entry) => entry.id === techId);
  if (!tech) return { ok: false, messageRu: "Неизвестная технология Наследия" };
  if (a.tech.unlocked.includes(techId)) return { ok: false, messageRu: "Технология уже открыта" };
  if (a.tech.tier + 1 < tech.tier) return { ok: false, messageRu: "Сначала откройте предыдущий тир" };
  if (tech.gateMission > a.quest.stage) return { ok: false, messageRu: "Нужен прогресс линии Ансаров" };
  for (const req of tech.requires) if (!a.tech.unlocked.includes(req)) return { ok: false, messageRu: "Не открыта предыдущая технология" };
  if (a.relics < tech.costRelics) return { ok: false, messageRu: "Не хватает реликвий" };
  if (a.cores < tech.costCores) return { ok: false, messageRu: "Не хватает ядер" };
  a.relics -= tech.costRelics;
  a.cores -= tech.costCores;
  a.stats.relicsSpent = (a.stats.relicsSpent ?? 0) + tech.costRelics;
  a.stats.coresSpent = (a.stats.coresSpent ?? 0) + tech.costCores;
  a.tech.unlocked.push(tech.id);
  a.tech.tier = Math.max(a.tech.tier, tech.tier);
  for (const unlock of tech.unlocks) unlockToken(world, a, unlock);
  if (a.tech.unlocked.length > 0) a.flags["tech_opened"] = 1;
  return { ok: true, messageRu: tech.ru + " открыта" };
}

// ------------------------------------------------------------------ варп

export interface WarpStatus {
  unlocked: boolean;
  charges: number;
  cores: number;
  capacity: number;
  cooldownTicks: number;
  riskPct: number;
  sectorReady: boolean;
  instability: number;
  chorusAttention: number;
  lastRiskTriggered: boolean;
  choirWaveTick: number;
}

export function warpCapacity(world: World): number {
  const capacity = ancientsSpecialValue(world, world.playerEmpireId, "core_capacity");
  return WARP_CHARGES_PER_CORE + Math.max(0, Math.round(capacity));
}

export function warpRadiusLy(world: World): number {
  return WARP_RADIUS_LY + Math.max(0, ancientsSpecialValue(world, world.playerEmpireId, "warp_range_ly"));
}

export function warpStatus(world: World): WarpStatus {
  const a = ensureAncients(world);
  return {
    unlocked: a.warp.unlocked,
    charges: a.warp.charges,
    cores: a.cores,
    capacity: warpCapacity(world),
    cooldownTicks: Math.max(0, a.warp.cooldownUntil - world.tick),
    riskPct: WARP_RISK_PCT,
    sectorReady: a.sector.discovered,
    instability: a.warp.instability,
    chorusAttention: a.flags["choir_attention"] ?? 0,
    lastRiskTriggered: a.warp.lastRiskTriggered,
    choirWaveTick: world.flags["choir_wave_tick"] ?? 0,
  };
}

export function distanceLy(world: World, a: StarSystem, b: StarSystem): number {
  void world;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) * LY_PER_MAP_UNIT;
}

function playerWarpFleet(world: World) {
  const player = empireById(world, world.playerEmpireId);
  if (!player) return null;
  const flagship = world.fleets.find((fleet) => fleet.id === player.flagshipFleetId && fleet.ships.length > 0);
  if (flagship) return flagship;
  return world.fleets.find((fleet) => fleet.empireId === player.id && fleet.ships.length > 0) ?? null;
}

function roll(world: World, salt: string): number {
  return hash32(world.seed, world.tick, hashText(salt));
}

export function warpJump(world: World, empireId: number, targetSystemId: number): CommandResult {
  const a = ensureAncients(world);
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Варп доступен только игроку" };
  if (!a.warp.unlocked) return { ok: false, messageRu: "Варп-двигатель не открыт (миссия 9 / A3)" };
  if (world.tick < a.warp.cooldownUntil) return { ok: false, messageRu: "Варп остывает" };
  if (a.warp.charges <= 0) return { ok: false, messageRu: "Нет зарядов ядра (пополните у врат или через warp_recharge)" };
  const target = world.systems[targetSystemId];
  if (!target) return { ok: false, messageRu: "Система не найдена" };
  const fleet = playerWarpFleet(world);
  if (!fleet) return { ok: false, messageRu: "Нужен флот игрока" };
  const origin = world.systems[fleet.systemId];
  if (!origin) return { ok: false, messageRu: "Флот потерялся" };
  const inSectorTarget = target.sector === "relic";
  if (inSectorTarget) {
    if (!a.sector.discovered) return { ok: false, messageRu: "Сектор «Реликтовый Предел» ещё не открыт" };
    const sector = ensureSectorGenerated(world);
    const meta = sector.systems.find((system) => system.id === target.id);
    if (!meta) return { ok: false, messageRu: "Система не принадлежит сектору" };
    // Варп-вход в Предел: игрок считается вошедшим (нужно для sector_exit и меток карты).
    a.sector.active = true;
    a.sector.enteredTick = world.tick;
    if (!a.sector.visited.includes(target.id)) a.sector.visited.push(target.id);
    if (!meta.visited) meta.visited = true;
  } else {
    const distance = distanceLy(world, origin, target);
    if (distance > warpRadiusLy(world)) return { ok: false, messageRu: "Цель дальше " + Math.round(warpRadiusLy(world)) + " св. лет" };
  }
  const accuracy = 70 + ancientsSpecialValue(world, world.playerEmpireId, "warp_accuracy") * 100;
  const accuracyRoll = roll(world, "acc:" + a.warp.lastJumpTick + ":" + a.stats.warpJumps) % 100;
  let destination = target;
  let outcome = "exact";
  if (accuracyRoll >= accuracy + 20) {
    outcome = "mishap";
  } else if (accuracyRoll >= accuracy) {
    outcome = "near";
  }
  if (outcome === "near") {
    // «Рядом»: ближайшая система в радиусе, детерминированно.
    let best: StarSystem | null = null;
    let bestDistance = Number.MAX_VALUE;
    for (const system of world.systems) {
      if (system.id === target.id || system.sector === "relic") continue;
      const distance = distanceLy(world, target, system);
      if (distance < bestDistance && distance <= warpRadiusLy(world)) {
        bestDistance = distance;
        best = system;
      }
    }
    destination = best ?? target;
  } else if (outcome === "mishap") {
    const candidates = world.systems.filter((system) => system.sector !== "relic" && system.id !== target.id);
    const pick = candidates[roll(world, "mishap:" + targetSystemId) % Math.max(1, candidates.length)];
    destination = pick ?? target;
    for (const ship of fleet.ships) {
      const damage = Math.max(1, Math.round(ship.hullMax * 0.08));
      ship.hull = Math.max(0, ship.hull - damage);
    }
    world.flags["warp_storm_until"] = world.tick + 2;
  }
  a.warp.charges -= 1;
  a.warp.lastJumpTick = world.tick;
  a.warp.cooldownUntil = world.tick + WARP_COOLDOWN_TICKS;
  a.warp.instability = Math.min(100, a.warp.instability + 4);
  a.stats.warpJumps = (a.stats.warpJumps ?? 0) + 1;
  fleet.systemId = destination.id;
  fleet.path = [];
  fleet.pathIndex = 0;
  fleet.jumpTicksLeft = 0;
  fleet.status = "idle";
  if (!destination.knownBy.includes(empireId)) destination.knownBy.push(empireId);
  if (!destination.visibleTo.includes(empireId)) destination.visibleTo.push(empireId);
  a.warp.lastRiskTriggered = false;
  const riskRoll = roll(world, "risk:" + a.warp.lastJumpTick) % 100;
  if (riskRoll < WARP_RISK_PCT) {
    a.warp.lastRiskTriggered = true;
    a.flags["choir_attention"] = Math.min(100, (a.flags["choir_attention"] ?? 0) + 5);
    world.flags["choir_wave_tick"] = world.tick + 20 + (riskRoll % 21);
    logEvent(world, "anomaly", "warn", "Варп-прыжок услышан Хором.", destination.id, empireId);
  }
  if (a.warp.lastJumpTick > 0) a.flags["last_warp"] = a.warp.lastJumpTick;
  return { ok: true, messageRu: outcome === "mishap" ? "Варп-мискок: вы вышли не туда" : "Варп-прыжок выполнен" };
}

export function warpRecharge(world: World, empireId: number): CommandResult {
  const a = ensureAncients(world);
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Только игрок" };
  if (!a.warp.unlocked) return { ok: false, messageRu: "Варп не открыт" };
  if (a.warp.charges >= warpCapacity(world)) return { ok: false, messageRu: "Ядро заряжено полностью" };
  const cost = 2;
  if (a.relics < cost) return { ok: false, messageRu: "Нужно 2 реликвии" };
  a.relics -= cost;
  a.stats.relicsSpent = (a.stats.relicsSpent ?? 0) + cost;
  a.warp.charges += 1;
  return { ok: true, messageRu: "Заряд ядра пополнен за 2 реликвии" };
}

// ------------------------------------------------------------------ сектор «Реликтовый Предел»

function sectorFallbackRegions(): SectorRegionDef[] {
  const ids = ["ruins", "quiet_wastes", "choir_rift", "ansari_gardens", "gates"];
  const names = ["Руины", "Тихие Пустоши", "Хор-Разлом", "Сады Ансаров", "Врата"];
  return ids.map((id, index) => ({
    id, ru: names[index]!, color: "#8B7BB8", systemCount: index === 4 ? 5 : 10,
    poiKinds: ["anomaly"], hazard: null, descRu: "",
  }));
}

function sectorFallbackPoi(): SectorPoiDef {
  return { id: "poi_relic", kind: "anomaly", ru: "Реликтовая площадка", descRu: "", rewardRelics: 1, rewardCores: 0, threat: 10, codex: null };
}

function pickStar(rng: ReturnType<typeof seedRng>, index: number): StarSystem["star"] {
  const stars: StarSystem["star"][] = ["yellow", "orange", "red", "blue", "white", "binary", "neutron", "pulsar", "blackhole", "nebula"];
  void index;
  return stars[nextInt(rng, stars.length)] ?? "yellow";
}

function makeSectorPlanet(world: World, systemId: number, name: string, orbit: number, rng: ReturnType<typeof seedRng>): Planet {
  const types: Planet["type"][] = ["barren", "volcanic", "arctic", "desert", "asteroid_belt", "gas_giant"];
  const type = types[nextInt(rng, types.length)] ?? "barren";
  const size = type === "gas_giant" ? 5 : nextRange(rng, 1, 5);
  return {
    id: world.nextId++,
    systemId,
    name: name + " " + (orbit + 1),
    type,
    size,
    orbit,
    orbitRadius: 1200 + orbit * 900 + size * 300,
    habitability: type === "gas_giant" || type === "asteroid_belt" ? 0 : nextRange(rng, 0, 45),
    deposits: { minerals: nextRange(rng, 0, 4), energy: nextRange(rng, 0, 3), rare: nextRange(rng, 0, 2) },
    ownerId: 0,
    colonyId: 0,
    anomaly: "",
    scanned: false,
  };
}

function regionFactionId(catalog: AncientsCatalog, regionIndex: number, region: SectorRegionDef): string {
  const order = ["ansari_remnants", "wardens", "choir", "ansari_remnants", "fallen"];
  const fromData = catalog.factions[regionIndex % Math.max(1, catalog.factions.length)]?.id;
  if (fromData && catalog.factions.length > 0) return fromData;
  void region;
  return order[regionIndex % order.length] ?? "ansari_remnants";
}

/** Детерминированная генерация 45 систем/5 подрегионов; идемпотентно. */
export function ensureSectorGenerated(world: World, catalogArg?: AncientsCatalog): AncientsSectorState {
  const catalog = catalogArg ?? ancientsCatalog();
  const a = ensureAncients(world, catalog);
  if (a.sector.generated) return a.sector;
  a.sector.generated = true;
  a.sector.discovered = true;
  const regions = catalog.regions.length > 0 ? catalog.regions : sectorFallbackRegions();
  const random = seedRng((world.seed ^ 0x5ec7a11) >>> 0);
  const perRegion: number[] = regions.map((region) => Math.max(0, Math.round(region.systemCount || 0)));
  let total = perRegion.reduce((sum, value) => sum + value, 0);
  if (total !== SECTOR_SYSTEMS) {
    // Нормализуем к 45 системам: базово по 9 на регион, остаток — первым.
    perRegion.length = regions.length;
    for (let i = 0; i < perRegion.length; i++) perRegion[i] = Math.floor(SECTOR_SYSTEMS / regions.length);
    for (let i = 0; i < SECTOR_SYSTEMS % regions.length; i++) perRegion[i] = (perRegion[i] ?? 0) + 1;
    total = perRegion.reduce((sum, value) => sum + value, 0);
  }
  void total;
  const names = catalog.names ?? { prefixes: [], roots: [], suffixes: [] };
  const sectorSystems: AncientsSectorSystem[] = [];
  const baseX = 320;
  const baseY = -180;
  let regionIndex = 0;
  for (const region of regions) {
    const count = perRegion[regionIndex] ?? 0;
    const centerX = baseX + (regionIndex % 3) * 120;
    const centerY = baseY + Math.floor(regionIndex / 3) * 120;
    for (let i = 0; i < count; i++) {
      const id = world.systems.length;
      const prefixText = names.prefixes.length > 0 ? names.prefixes[nextInt(random, names.prefixes.length)]! : "Предел";
      const root = names.roots.length > 0 ? names.roots[nextInt(random, names.roots.length)]! : "Ансар";
      const suffix = names.suffixes.length > 0 ? names.suffixes[nextInt(random, names.suffixes.length)]! : String(id + 1);
      const name = prefixText + " " + root + " " + suffix;
      const x = centerX + nextRange(random, -18, 18);
      const y = centerY + nextRange(random, -18, 18);
      const faction = regionFactionId(catalog, regionIndex, region);
      // POI: 0..3 на систему, виды — из poiKinds региона.
      const poiDefs: SectorPoiDef[] = [];
      const poiKinds = region.poiKinds && region.poiKinds.length > 0 ? region.poiKinds : ["anomaly"];
      const poiCount = nextRange(random, 0, 3);
      for (let p = 0; p < poiCount; p++) {
        const kind = poiKinds[nextInt(random, poiKinds.length)]!;
        const candidates = catalog.pois.filter((poi) => poi.kind === kind);
        const def = candidates.length > 0 ? candidates[nextInt(random, candidates.length)]! : sectorFallbackPoi();
        poiDefs.push(def);
      }
      const hazard = region.hazard && catalog.hazards.some((entry) => entry.id === region.hazard) ? region.hazard : null;
      const system: StarSystem = {
        id,
        name,
        x,
        y,
        star: pickStar(random, id),
        planets: [],
        links: [],
        ownerId: 0,
        knownBy: [world.playerEmpireId],
        visibleTo: [],
        poi: [],
        station: null,
        chokepoint: false,
        hopsFromCapital: -1,
        sector: "relic",
      };
      const planetCount = nextRange(random, 1, 3);
      for (let orbit = 0; orbit < planetCount; orbit++) system.planets.push(makeSectorPlanet(world, id, name, orbit, random));
      const poiIds: string[] = [];
      let relics = 0;
      let cores = 0;
      for (const def of poiDefs) {
        poiIds.push(def.id);
        relics += Math.max(0, def.rewardRelics ?? 0);
        cores += Math.max(0, def.rewardCores ?? 0);
        system.poi.push({
          id: world.nextId++,
          kind: "anomaly",
          nameRu: def.ru,
          systemId: id,
          scanned: false,
          rewardCredits: 0,
          rewardScience: 0,
        });
      }
      world.systems.push(system);
      sectorSystems.push({
        id, name, x, y, region: region.id, faction, poi: poiIds, hazard,
        visited: false, controlled: false, relics, cores,
      });
    }
    regionIndex += 1;
  }
  a.sector.systems = sectorSystems;
  a.sector.gates = sectorSystems
    .filter((system) => system.region === regions[regions.length - 1]?.id)
    .slice(0, 2)
    .map((system) => system.id);
  if (a.sector.gates.length === 0) a.sector.gates = sectorSystems.slice(0, 2).map((system) => system.id);
  a.sector.stability = 50;
  a.sector.chorusThreat = 0;
  a.sector.nextWaveTick = world.tick + SECTOR_WAVE_INTERVAL;
  a.sector.invasion = false;
  a.sector.visited = [];
  a.sector.active = false;
  for (const system of sectorSystems) {
    const entry = a.factions[system.faction];
    if (entry) entry.met = true;
  }
  return a.sector;
}

export function getSectorState(world: World): AncientsSectorState {
  return ensureAncients(world).sector;
}

function sectorSystemOf(world: World, systemId: number): AncientsSectorSystem | null {
  const a = ensureAncients(world);
  return a.sector.systems.find((system) => system.id === systemId) ?? null;
}

function systemPoiDefs(world: World, systemId: number, catalog: AncientsCatalog): SectorPoiDef[] {
  const system = world.systems[systemId];
  if (!system) return [];
  const defs: SectorPoiDef[] = [];
  for (const systemMeta of ensureAncients(world).sector.systems) {
    if (systemMeta.id !== systemId) continue;
    for (const poiId of systemMeta.poi) {
      const def = catalog.pois.find((entry) => entry.id === poiId);
      if (def) defs.push(def);
    }
  }
  return defs;
}

export function sectorScan(world: World, empireId: number, systemId: number): CommandResult {
  const catalog = ancientsCatalog();
  const a = ensureAncients(world, catalog);
  const meta = sectorSystemOf(world, systemId);
  if (!meta) return { ok: false, messageRu: "Система сектора не найдена" };
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Сектор доступен только игроку" };
  if (meta.visited) return { ok: false, messageRu: "Система уже просканирована" };
  meta.visited = true;
  if (!a.sector.visited.includes(systemId)) a.sector.visited.push(systemId);
  const relicYield = ancientsSpecialValue(world, world.playerEmpireId, "relic_yield");
  let relics = 0;
  let cores = 0;
  const codex: string[] = [];
  for (const def of systemPoiDefs(world, systemId, catalog)) {
    relics += Math.max(0, Math.round((def.rewardRelics ?? 0) * (1 + relicYield)));
    cores += Math.max(0, def.rewardCores ?? 0);
    if (def.codex) codex.push(def.codex);
  }
  relics += meta.relics;
  cores += meta.cores;
  meta.relics = 0;
  meta.cores = 0;
  if (relics > 0) addRelics(world, a, relics);
  if (cores > 0) addCores(world, a, cores);
  if (codex.length > 0) addCodexEntry(world, a, codex);
  a.stats.sectorScans = (a.stats.sectorScans ?? 0) + 1;
  a.sector.stability = Math.min(100, a.sector.stability + 1);
  const faction = a.factions[meta.faction];
  if (faction) faction.met = true;
  return { ok: true, messageRu: "Сектор просканирован: +" + relics + " реликвий, +" + cores + " ядер" };
}

export function sectorClaim(world: World, empireId: number, systemId: number): CommandResult {
  const a = ensureAncients(world);
  const meta = sectorSystemOf(world, systemId);
  if (!meta) return { ok: false, messageRu: "Система сектора не найдена" };
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Сектор доступен только игроку" };
  if (!meta.visited) return { ok: false, messageRu: "Сначала просканируйте систему" };
  if (meta.controlled) return { ok: false, messageRu: "Система уже под контролем" };
  meta.controlled = true;
  a.stats.sectorClaims = (a.stats.sectorClaims ?? 0) + 1;
  a.sector.stability = Math.min(100, a.sector.stability + 2);
  if (a.sector.stability >= SECTOR_GUARDIAN_STABILITY) a.flags["guardian_ending_ready"] = 1;
  return { ok: true, messageRu: "Система Предела взята под контроль" };
}

export function sectorEnter(world: World, empireId: number, systemId?: number): CommandResult {
  const a = ensureAncients(world);
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Сектор доступен только игроку" };
  if (!a.sector.discovered) return { ok: false, messageRu: "Сектор «Реликтовый Предел» ещё не открыт" };
  const sector = ensureSectorGenerated(world);
  const target = systemId !== undefined ? sectorSystemOf(world, systemId) : sector.systems.find((system) => sector.gates.includes(system.id)) ?? sector.systems[0];
  if (!target) return { ok: false, messageRu: "Сектор пуст" };
  const fleet = playerWarpFleet(world);
  if (!fleet) return { ok: false, messageRu: "Нужен флот игрока" };
  fleet.systemId = target.id;
  fleet.path = [];
  fleet.pathIndex = 0;
  fleet.status = "idle";
  sector.active = true;
  a.sector.enteredTick = world.tick;
  return { ok: true, messageRu: "Флот вошёл в Реликтовый Предел" };
}

export function sectorExit(world: World, empireId: number): CommandResult {
  const a = ensureAncients(world);
  if (empireId !== world.playerEmpireId) return { ok: false, messageRu: "Сектор доступен только игроку" };
  const player = empireById(world, empireId);
  if (!player) return { ok: false, messageRu: "Империя не найдена" };
  if (!a.sector.active) return { ok: false, messageRu: "Вы не в секторе" };
  const freeGate = a.sector.stability >= 25;
  if (!freeGate && a.warp.charges <= 0) return { ok: false, messageRu: "Врата закрыты (стабильность < 25), нужен заряд варпа" };
  if (!freeGate) {
    a.warp.charges -= 1;
    a.warp.cooldownUntil = world.tick + WARP_COOLDOWN_TICKS;
  }
  for (const fleet of world.fleets) {
    if (fleet.empireId !== empireId) continue;
    if (world.systems[fleet.systemId]?.sector !== "relic") continue;
    fleet.systemId = player.capitalSystemId;
    fleet.path = [];
    fleet.pathIndex = 0;
    fleet.status = "idle";
  }
  a.sector.active = false;
  return { ok: true, messageRu: freeGate ? "Выход через Врата" : "Аварийный варп-выход" };
}

/** Мягкая смерть в секторе: уводит флоты игрока в столицу, при отсутствии — создаёт якорь. */
export function sectorDeathReturn(world: World): boolean {
  const a = ensureAncients(world);
  const player = empireById(world, world.playerEmpireId);
  if (!player) return false;
  let moved = false;
  for (const fleet of world.fleets) {
    if (fleet.empireId !== player.id) continue;
    if (world.systems[fleet.systemId]?.sector !== "relic") continue;
    fleet.systemId = player.capitalSystemId;
    fleet.path = [];
    fleet.pathIndex = 0;
    fleet.status = "idle";
    moved = true;
  }
  const remaining = world.fleets.filter((fleet) => fleet.empireId === player.id && fleet.ships.length > 0).length;
  if (remaining === 0) {
    const ship = createShip(world.nextId++, "corvette_scout", "Возвращение", false, world);
    createFleet(world, player.id, player.capitalSystemId, [ship], "Возвращение", "wall");
    moved = true;
  }
  if (a.sector.active) a.sector.active = false;
  return moved;
}

// ------------------------------------------------------------------ роли систем линии

export const QUEST_SYSTEM_ROLES = [
  "sys_ansari_beacon", "sys_tuning_knot", "sys_muted_1", "sys_kermur", "sys_broken_knot",
  "sys_shell", "sys_fallen_hall", "sys_val_an", "sys_rift_test", "sys_ir_1", "sys_lad_stone",
];

/** Детерминированно закрепляет роли систем линии за галактическими системами (идемпотентно). */
export function ensureQuestSystems(world: World): void {
  const a = ensureAncients(world);
  if (a.flags["quest_systems_assigned"]) return;
  a.flags["quest_systems_assigned"] = 1;
  const player = empireById(world, world.playerEmpireId);
  const capital = player?.capitalSystemId ?? 0;
  const candidates = world.systems
    .filter((system) => system.sector !== "relic")
    .filter((system) => system.id !== capital)
    .sort((left, right) => {
      const dl = Math.abs((left.hopsFromCapital < 0 ? 999 : left.hopsFromCapital) - 4);
      const dr = Math.abs((right.hopsFromCapital < 0 ? 999 : right.hopsFromCapital) - 4);
      return dl - dr || left.id - right.id;
    });
  if (candidates.length === 0) return;
  for (let i = 0; i < QUEST_SYSTEM_ROLES.length; i++) {
    const role = QUEST_SYSTEM_ROLES[i]!;
    const index = hash32(world.seed, hashText(role)) % Math.max(1, candidates.length);
    const system = candidates[index];
    if (system && !system.role) system.role = role;
  }
}

/** Учёт статистики линии (сканы/убийства/посещения ролей). */
export function recordAncientsStat(world: World, key: string, amount = 1): void {
  const a = ensureAncients(world);
  a.stats[key] = (a.stats[key] ?? 0) + amount;
}

function trackQuestProgress(world: World, a: AncientsState): void {
  // Посещение ролевых систем игроком = скан (миссии 13b).
  for (const fleet of world.fleets) {
    if (fleet.empireId !== world.playerEmpireId) continue;
    const system = world.systems[fleet.systemId];
    if (!system || system.sector === "relic" || !system.role) continue;
    const key = "seen_role:" + system.role;
    if (!a.flags[key]) {
      a.flags[key] = 1;
      recordAncientsStat(world, "visits", 1);
      recordAncientsStat(world, "scans", 1);
    }
  }
  // Потери FP врагов в битвах с игроком.
  const seen = a.flags["battles_seen"] ?? 0;
  if (world.battles.length > seen) {
    for (let i = seen; i < world.battles.length; i++) {
      const battle = world.battles[i]!;
      if (!battle) continue;
      if (battle.attacker.empireId === world.playerEmpireId) recordAncientsStat(world, "killFp", battle.defenderLossFp);
      if (battle.defender.empireId === world.playerEmpireId) recordAncientsStat(world, "killFp", battle.attackerLossFp);
    }
    a.flags["battles_seen"] = world.battles.length;
  }
}

// ------------------------------------------------------------------ фаза такта

function chorusAttentionEffects(world: World, a: AncientsState): void {
  // Внимание Хора медленно спадает, если игрок не прыгает варпом.
  const attention = a.flags["choir_attention"] ?? 0;
  if (attention > 0 && world.tick % 50 === 0 && world.tick - (a.warp.lastJumpTick || 0) > 50) {
    a.flags["choir_attention"] = Math.max(0, attention - 1);
  }
  const waveTick = world.flags["choir_wave_tick"] ?? 0;
  if (waveTick > 0 && world.tick >= waveTick) {
    world.flags["choir_wave_tick"] = 0;
    a.warp.lastRiskTriggered = false;
    a.flags["choir_attention"] = Math.min(100, (a.flags["choir_attention"] ?? 0) + 10);
    if (a.sector.generated) {
      a.sector.chorusThreat = Math.min(100, a.sector.chorusThreat + 10);
      a.sector.stability = Math.max(0, a.sector.stability - 3);
    }
    logEvent(world, "anomaly", "warn", "Хор пришёл на зов варпа.", undefined, world.playerEmpireId);
  }
}

function sectorPhase(world: World, a: AncientsState): void {
  if (!a.sector.generated) return;
  const sector = a.sector;
  if (sector.chorusThreat >= SECTOR_INVASION_THREAT && !sector.invasion) {
    sector.invasion = true;
    world.flags["chorus_invasion"] = 1;
  }
  if (world.tick >= sector.nextWaveTick) {
    sector.nextWaveTick = world.tick + SECTOR_WAVE_INTERVAL;
    sector.chorusThreat = Math.min(100, sector.chorusThreat + SECTOR_WAVE_THREAT);
    sector.stability = Math.max(0, sector.stability - 2);
    if (sector.invasion) sector.stability = Math.max(0, sector.stability - 3);
    logEvent(world, "anomaly", "warn", "Волна Хора в Пределе (угроза " + sector.chorusThreat + ").", undefined, world.playerEmpireId);
  }
  if (world.tick % 100 === 0 && !sector.invasion) {
    const controlled = sector.systems.filter((system) => system.controlled).length;
    if (controlled > 0) sector.stability = Math.min(100, sector.stability + Math.min(3, controlled));
    if (sector.stability >= SECTOR_GUARDIAN_STABILITY) a.flags["guardian_ending_ready"] = 1;
  }
  // Автопополнение заряда у Врат: 1 заряд за 5 тактов.
  if (a.warp.unlocked && world.tick % 5 === 0 && sector.active) {
    const player = empireById(world, world.playerEmpireId);
    const fleet = playerWarpFleet(world);
    if (fleet && sector.gates.includes(fleet.systemId) && a.warp.charges < warpCapacity(world)) {
      a.warp.charges += 1;
    }
  }
}

/** Тик Части XIII: линия, внимание Хора, сектор (идемпотентно, дёшево до 1200). */
export function ancientsPhase(world: World): void {
  const a = ensureAncients(world);
  if (!a.enabled) return;
  ensureQuestSystems(world);
  trackQuestProgress(world, a);
  advanceAncientsLine(world);
  chorusAttentionEffects(world, a);
  sectorPhase(world, a);
}

// ------------------------------------------------------------------ прочее для UI/кода

export function ancientsTechById(id: string) {
  return ANCIENT_TECH_BY_ID[id] ?? null;
}

export function codexEntries(world: World): { def: CodexEntryDef; unlocked: boolean }[] {
  const a = ensureAncients(world);
  const catalog = ancientsCatalog();
  return catalog.codex.map((def) => ({ def, unlocked: a.codex.includes(def.id) || def.unlock === "start" }));
}

export function factionStanding(world: World, factionId: string): { relation: number; met: boolean } {
  const a = ensureAncients(world);
  const faction = SECTOR_FACTION_BY_ID[factionId];
  void faction;
  return a.factions[factionId] ?? { relation: 0, met: false };
}

/** Резолвит расу империи для modifiers (без импорта economy). */
export function empireRaceId(world: World, empireId: number): string | null {
  return raceIdOf(world, empireId);
}

export function ancientsEffectSourceList(world: World, empireId: number): Record<string, number>[] {
  return ancientsEffectSources(world, empireId);
}

export function ancientsCacheSignature(world: World, empireId: number): string {
  return ancientsSignature(world, empireId);
}
