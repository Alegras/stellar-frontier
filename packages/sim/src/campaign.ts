/**
 * КАМПАНИЯ (M9): пролог + 5 актов, 60 сюжетных миссий, 3 ветки, 5 концовок + секретная.
 * docs/11_campaign_and_free_flight.md §2–§9, GDD §14.7–14.9.
 *
 * Правила:
 *  - детерминизм: никакого Math.random/Date.now; выбор — по tick/seed, веса — целочисленные;
 *  - контент — из @sf/data (CAMPAIGN_ACTS/CAMPAIGN_MISSIONS/BRANCHES/ENDINGS), пустые данные
 *    допустимы: фазы тогда ничего не создают (тесты подставляют каталог параметром);
 *  - идемпотентность: повторный вызов фазы на том же такте не меняет состояние,
 *    награды выдаются ровно один раз (флаг rewarded);
 *  - мягкий провал: миссия становится failed и через retry-окно снова available (не game over).
 */
import {
  CAMPAIGN_ACTS, CAMPAIGN_BRIDGES, CAMPAIGN_MISSIONS, BRANCHES, ENDINGS, RESOURCE_IDS, SCIENCE_IDS,
} from "@sf/data";
import type { StoryBridgeDef } from "@sf/data";
import type {
  BranchDef, CampaignActDef, CampaignMissionDef, EndingDef, MissionObjectiveDef,
} from "@sf/data";
import type { CampaignBranch, CampaignMission, CampaignState, ContractObjective } from "./fullgame";
import { advancedOf, ensureFg, pushJournal, relationOf } from "./fullgame";
import { createFleet, createShip, empireById, logEvent } from "./economy";
import { getEmpireFleetPower } from "./queries";
import { activateTreaty, breakTreaty, refreshOpinion, setWarSide, warSideOf } from "./diplomacy";
import type { Empire, World } from "./types";

// ------------------------------------------------------------------ константы (GDD/док 11 §2)

export interface ActBound {
  act: number;
  startTick: number;
  endTick: number;
  nameRu: string;
}

/** Границы актов по тактам (1 такт = 1 с при 1×). Источник истины — docs/11 §2. */
export const ACT_TICK_BOUNDS: readonly ActBound[] = [
  { act: 0, startTick: 0, endTick: 300, nameRu: "Пролог «Пробуждение»" },
  { act: 1, startTick: 300, endTick: 1200, nameRu: "Акт I «Фронтир»" },
  { act: 2, startTick: 1200, endTick: 2600, nameRu: "Акт II «Хрупкий мир»" },
  { act: 3, startTick: 2600, endTick: 4400, nameRu: "Акт III «Разлом»" },
  { act: 4, startTick: 4400, endTick: 6200, nameRu: "Акт IV «Цена силы»" },
  { act: 5, startTick: 6200, endTick: 7200, nameRu: "Акт V «Финал»" },
];

/** Конец кампании по тактам (док 11 §2: 7200). */
export const CAMPAIGN_END_TICK = 7200;

/** Игнорирование сюжета дольше этого числа тактов → напоминание (док 11 §2). */
export const STORY_REMINDER_TICKS = 200;

/** Сюжетный лок: ≤10 минут при 1 такт = 1 с (док 11 §2: локов не больше 3). */
export const STORY_LOCK_TICKS = 300;
export const MAX_STORY_LOCKS = 3;

/** Дедлайн миссии по умолчанию, если в целях нет timeLimitTicks. */
export const DEFAULT_MISSION_DEADLINE = 600;

/** Окно «мягкого провала»: через сколько тактов проваленную миссию можно повторить. */
export const MISSION_RETRY_TICKS = 120;

/** Ветку выбирают со II акта (док 11 §3: «ветка фракции — Акт II–IV»). */
export const BRANCH_MIN_ACT = 2;

/** Минимум артефактов «Шёпота» для секретной концовки (док 11 §8). */
export const SECRET_ARTIFACTS = 6;

/** Требования веток: небольшой порог, чтобы выбор был осознанным (числа — стартовые ориентиры). */
export const BRANCH_REQUIREMENTS = {
  federation: { minOpinion: 20 },
  sovereignty: { minSystems: 2 },
  syndicate: { minCredits: 5000 },
} as const;

// ------------------------------------------------------------------ каталог контента

export interface CampaignCatalog {
  acts: readonly CampaignActDef[];
  missions: readonly CampaignMissionDef[];
  branches: readonly BranchDef[];
  endings: readonly EndingDef[];
}

/** Каталог по умолчанию — из @sf/data. Пустые массивы допустимы. */
export function defaultCampaignCatalog(): CampaignCatalog {
  return {
    acts: CAMPAIGN_ACTS,
    missions: CAMPAIGN_MISSIONS,
    branches: BRANCHES,
    endings: ENDINGS,
  };
}

function resolveCatalog(override?: Partial<CampaignCatalog>): CampaignCatalog {
  const base = defaultCampaignCatalog();
  return {
    acts: override?.acts ?? base.acts,
    missions: override?.missions ?? base.missions,
    branches: override?.branches ?? base.branches,
    endings: override?.endings ?? base.endings,
  };
}

function catalogMission(catalog: CampaignCatalog, missionId: string): CampaignMissionDef | undefined {
  for (const def of catalog.missions) if (def.id === missionId) return def;
  return undefined;
}

// ------------------------------------------------------------------ акты/время

/** Границы актов: данные, если они есть, иначе константы док-а. */
export function actBounds(catalog?: Partial<CampaignCatalog>): readonly ActBound[] {
  const acts = resolveCatalog(catalog).acts;
  if (acts.length === 0) return ACT_TICK_BOUNDS;
  const sorted = [...acts].sort((a, b) => a.startTick - b.startTick);
  return sorted.map((def, index) => {
    const fallback = ACT_TICK_BOUNDS.find((b) => b.act === def.id) ?? ACT_TICK_BOUNDS[Math.min(index, ACT_TICK_BOUNDS.length - 1)]!;
    return {
      act: def.id,
      startTick: def.startTick,
      endTick: def.endTick > def.startTick ? def.endTick : fallback.endTick,
      nameRu: def.ru || fallback.nameRu,
    };
  });
}

/** Номер акта для такта (0 = пролог). Монотонно неубывающая функция такта. */
export function actForTick(tick: number, catalog?: Partial<CampaignCatalog>): number {
  const bounds = actBounds(catalog);
  let act = bounds[0]?.act ?? 0;
  for (const bound of bounds) {
    if (tick >= bound.startTick) act = bound.act;
  }
  return act;
}

export function actName(act: number, catalog?: Partial<CampaignCatalog>): string {
  const bounds = actBounds(catalog);
  return bounds.find((b) => b.act === act)?.nameRu ?? ACT_TICK_BOUNDS[0]!.nameRu;
}

// ------------------------------------------------------------------ утилиты состояния

function playerEmpire(world: World): Empire | undefined {
  return empireById(world, world.playerEmpireId);
}

function isScienceSchool(value: string): boolean {
  return (SCIENCE_IDS as readonly string[]).includes(value);
}

function isResourceId(value: string): boolean {
  return (RESOURCE_IDS as readonly string[]).includes(value);
}

function hasFlag(campaign: CampaignState, key: string): boolean {
  return (campaign.flags[key] ?? 0) > 0;
}

function setFlag(campaign: CampaignState, key: string, value = 1): void {
  campaign.flags[key] = value;
}

/**
 * Применяет атомарный «эффект» контента к миру: ресурс, наука, флаг кампании.
 * Формат target: ResourceId | "science.<school>" | "flag:<name>" | "rep.<faction>" | иное → флаг.
 */
export function applyCampaignEffect(world: World, empireId: number, target: string, value: number): void {
  const fg = ensureFg(world);
  const empire = empireById(world, empireId);
  if (!empire || !Number.isFinite(value) || value === 0) {
    if (target.startsWith("flag:") && Number.isFinite(value)) fg.campaign.flags[target.slice(5)] = value;
    return;
  }
  if (target.startsWith("science.")) {
    const school = target.slice("science.".length);
    if (isScienceSchool(school)) empire.science[school as keyof Empire["science"]] += value;
    return;
  }
  if (target.startsWith("flag:")) {
    fg.campaign.flags[target.slice("flag:".length)] = value;
    return;
  }
  if (target.startsWith("rep.")) {
    fg.campaign.flags[target] = (fg.campaign.flags[target] ?? 0) + value;
    return;
  }
  if (target.startsWith("opinion:")) {
    const otherId = Number(target.slice("opinion:".length));
    if (Number.isFinite(otherId) && otherId !== empireId) {
      const relation = relationOf(world, empireId, otherId);
      relation.opinion = Math.max(-100, Math.min(100, relation.opinion + value));
      refreshOpinion(world, Math.min(empireId, otherId), Math.max(empireId, otherId));
    }
    return;
  }
  if (target.startsWith("join_war:")) {
    const parts = target.split(":");
    const warId = Number(parts[1]);
    const side = Number(parts[2] ?? 2) === 1 ? 1 : 2;
    const war = fg.wars.find((entry) => entry.id === warId);
    const empire = empireById(world, empireId);
    if (war && empire) {
      if (warSideOf(world, war.id, empireId) === 0) {
        war.sides[empireId] = {
          empireId,
          fpStart: getEmpireFleetPower(world, empireId),
          fpLost: 0,
          claims: [],
          occupiedSystems: [],
        };
        war.score[empireId] = 0;
        war.exhaustion[empireId] = 0;
        war.occupied[empireId] = 0;
        setWarSide(world, war.id, empireId, side);
      }
      fg.campaign.flags.ai_call_to_arms = 1;
    }
    return;
  }
  if (target.startsWith("treaty:")) {
    const [, kind, targetIdRaw] = target.split(":");
    const targetId = Number(targetIdRaw);
    if (Number.isFinite(targetId) && kind) {
      activateTreaty(world, empireId, targetId, kind as never);
      fg.campaign.flags["treaty:" + kind + ":" + targetId] = 1;
    }
    return;
  }
  if (target.startsWith("break_treaty:")) {
    const [, kind, targetIdRaw] = target.split(":");
    const targetId = Number(targetIdRaw);
    if (Number.isFinite(targetId) && kind) breakTreaty(world, empireId, targetId, kind as never, "решение игрока");
    return;
  }
  if (target.startsWith("leave_federation")) {
    for (const federation of fg.federations) {
      if (!federation.members.includes(empireId)) continue;
      federation.members = federation.members.filter((id) => id !== empireId);
      delete federation.votes[empireId];
      if (federation.presidentId === empireId) federation.presidentId = federation.members.slice().sort((a, b) => a - b)[0] ?? 0;
    }
    fg.federations = fg.federations.filter((federation) => federation.members.length >= 2);
    return;
  }
  if (target === "stability") {
    for (const colony of world.colonies.filter((c) => c.empireId === empireId)) {
      colony.stability = Math.max(0, Math.min(100, colony.stability + value));
    }
    return;
  }
  if (target.startsWith("battle:")) {
    const parts = target.split(":");
    const count = Math.max(1, Math.min(8, Number(parts[2] ?? 3)));
    const playerFleet = world.fleets.find((f) => f.empireId === empireId && f.ships.length > 0);
    const systemId = playerFleet?.systemId ?? empireById(world, empireId)?.capitalSystemId ?? 0;
    const ships = Array.from({ length: count }, (_, i) => createShip(world.nextId++, i % 2 ? "corvette_strike" : "frigate_escort", "Пират " + (i + 1), false, world));
    createFleet(world, 9, systemId, ships, "Пиратская эскадра", "wedge");
    fg.campaign.flags["event_battle"] = world.tick;
    return;
  }
  if (isResourceId(target)) {
    const key = target as keyof Empire["resources"];
    empire.resources[key] = Math.max(0, empire.resources[key] + value);
    if (target === "credits" && value > 0) empire.stats.creditsEarned += value;
    return;
  }
  fg.campaign.flags[target] = (fg.campaign.flags[target] ?? 0) + value;
}

/** Система-цель по targetKind из данных миссий (детерминированно: ближайшая к столице подходящая). */
function resolveObjectiveTargetSystem(world: World, empire: Empire | undefined, def: MissionObjectiveDef): number | null {
  if (def.targetSystemId !== undefined && def.targetSystemId !== null) {
    const system = world.systems.find((s) => s.id === def.targetSystemId);
    return system ? system.id : null;
  }
  if (!empire) return null;
  const kind = def.targetKind ?? "";
  const capital = world.systems.find((s) => s.id === empire.capitalSystemId);
  const distanceToCapital = (systemId: number): number => {
    const system = world.systems.find((s) => s.id === systemId);
    if (!system) return Number.MAX_SAFE_INTEGER;
    const dx = system.x - (capital?.x ?? 0);
    const dy = system.y - (capital?.y ?? 0);
    return dx * dx + dy * dy;
  };
  const nearest = (predicate: (system: (typeof world.systems)[number]) => boolean): number | null => {
    let bestId: number | null = null;
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const system of world.systems) {
      if (!predicate(system)) continue;
      const dist = distanceToCapital(system.id);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = system.id;
      }
    }
    return bestId;
  };

  const playerId = world.playerEmpireId;
  const own = (systemOwnerId: number): boolean => systemOwnerId === playerId;
  const foreign = (systemOwnerId: number): boolean => systemOwnerId !== playerId && systemOwnerId !== 0;
  const stationOfKind = (check: (stationKind: string, hasShipyard: boolean) => boolean) =>
    (system: (typeof world.systems)[number]): boolean => Boolean(system.station && check(system.station.kind, system.station.hasShipyard));
  const hasPlanetType = (type: string) => (system: (typeof world.systems)[number]): boolean =>
    system.planets.some((planet) => planet.type === type);
  const hasPoi = (pois: readonly string[]) => (system: (typeof world.systems)[number]): boolean =>
    system.poi.some((poi) => pois.includes(poi.kind));
  const border = (system: (typeof world.systems)[number]): boolean =>
    own(system.ownerId) && system.links.some((link) => {
      const neighbour = world.systems.find((s) => s.id === link);
      return Boolean(neighbour && foreign(neighbour.ownerId));
    });
  const enemyBorder = (system: (typeof world.systems)[number]): boolean =>
    foreign(system.ownerId) && system.links.some((link) => {
      const neighbour = world.systems.find((s) => s.id === link);
      return Boolean(neighbour && own(neighbour.ownerId));
    });

  switch (kind) {
    case "capital":
      return empire.capitalSystemId;
    case "owned":
    case "player_system":
      return empire.systems[0] ?? empire.capitalSystemId;
    case "border":
    case "frontier":
      return nearest(border) ?? empire.capitalSystemId;
    case "enemy":
    case "enemy_capital":
    case "enemy_border":
    case "invasion":
    case "contested":
    case "threatened":
    case "captured":
    case "tide":
    case "tide_core":
    case "rift":
    case "final_battle":
    case "victory":
      return nearest(enemyBorder) ?? nearest((system) => foreign(system.ownerId));
    case "habitable":
      return nearest((system) => system.planets.some((planet) => planet.habitability >= 40));
    case "asteroid":
      return nearest(hasPlanetType("asteroid_belt"));
    case "silent":
      return nearest((system) => system.star === "neutron" || system.star === "blackhole" || system.star === "pulsar");
    case "archive":
    case "ruin":
    case "derelict":
    case "anomaly":
      return nearest(hasPoi(["anomaly", "derelict", "pirate_base"])) ?? nearest((system) => system.poi.length > 0);
    case "station":
    case "trade":
    case "trade_hub":
    case "customs":
      return nearest(stationOfKind(() => true));
    case "black_market":
      return nearest(stationOfKind((stationKind) => stationKind === "pirate")) ?? nearest(stationOfKind(() => true));
    case "shipyard":
      return nearest(stationOfKind((stationKind, hasShipyard) => hasShipyard || stationKind === "shipyard"));
    case "research":
      return nearest(stationOfKind((stationKind) => stationKind === "research"));
    case "council":
      return nearest((system) => system.ownerId !== 0 && system.ownerId !== playerId) ?? empire.capitalSystemId;
    case "convoy":
    case "fleet":
      return nearest(enemyBorder) ?? empire.capitalSystemId;
    case "neutral_capital": {
      const neutralEmpires = world.empires.filter((item) => !item.isPlayer && !item.dead);
      const target = neutralEmpires[0];
      return target ? target.capitalSystemId : null;
    }
    default:
      return null;
  }
}

function buildObjectives(world: World, empire: Empire | undefined, def: CampaignMissionDef): ContractObjective[] {
  return def.objectives.map((objective, index) => ({
    id: objective.id || "obj_" + index,
    type: objective.type,
    targetSystemId: resolveObjectiveTargetSystem(world, empire, objective) ?? undefined,
    count: Math.max(1, Math.floor(objective.count ?? 1)),
    progress: 0,
    done: false,
  }));
}

function createMission(world: World, def: CampaignMissionDef): CampaignMission {
  const empire = playerEmpire(world);
  const branchRequired = (def.branchRequired ?? def.branch ?? null) as CampaignBranch | null;
  return {
    id: def.id,
    act: def.act,
    titleRu: def.titleRu,
    briefingRu: def.briefingRu,
    giver: def.giver,
    objectives: buildObjectives(world, empire, def),
    failCondition: null,
    rewards: {
      credits: def.rewards.credits ?? 0,
      alloys: def.rewards.alloys,
      influence: def.rewards.influence,
      science: def.rewards.science,
      reputation: def.rewards.reputation,
      unlock: def.rewards.unlock,
    },
    branchRequired: branchRequired && branchRequired !== "undecided" ? branchRequired : null,
    secret: Boolean(def.secret),
    status: "locked",
    acceptedTick: 0,
    // дедлайн фиксируем при создании из данных: startCampaignMission не зависит от каталога
    flags: { deadlineTicks: missionDeadlineTicks(def) },
  };
}

function missionDeadlineTicks(def: CampaignMissionDef | undefined): number {
  let limit = 0;
  for (const objective of def?.objectives ?? []) {
    const value = objective.timeLimitTicks ?? 0;
    if (value > limit) limit = value;
  }
  return limit > 0 ? limit : DEFAULT_MISSION_DEADLINE;
}

function isPrerequisiteMet(campaign: CampaignState, prerequisite: string): boolean {
  return hasFlag(campaign, "mission." + prerequisite) || hasFlag(campaign, prerequisite);
}

/** Все ли требования миссии выполнены (акт, ветка, пререквизиты). */
export function missionRequirementsMet(
  world: World,
  mission: CampaignMission,
  def: CampaignMissionDef | undefined,
): boolean {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  if (mission.act > campaign.act) return false;
  if (mission.branchRequired && campaign.branch !== mission.branchRequired) return false;
  for (const prerequisite of def?.prerequisites ?? []) {
    if (!isPrerequisiteMet(campaign, prerequisite)) return false;
  }
  return true;
}

function addStoryLock(campaign: CampaignState, missionId: string, tick: number, reasonRu: string): void {
  const id = "story:" + missionId;
  campaign.locks = campaign.locks.filter((lock) => lock.untilTick > tick);
  if (campaign.locks.some((lock) => lock.id === id)) return;
  while (campaign.locks.length >= MAX_STORY_LOCKS) campaign.locks.shift();
  campaign.locks.push({ id, untilTick: tick + STORY_LOCK_TICKS, reasonRu });
}

function removeStoryLock(campaign: CampaignState, missionId: string): void {
  const id = "story:" + missionId;
  campaign.locks = campaign.locks.filter((lock) => lock.id !== id);
}

/** Активные сюжетные локы (для UI: сюжет замораживает часть свободного полёта). */
export function activeStoryLocks(world: World): CampaignState["locks"] {
  const fg = ensureFg(world);
  return fg.campaign.locks.filter((lock) => lock.untilTick > world.tick);
}

export function isCampaignLocked(world: World): boolean {
  return activeStoryLocks(world).length > 0;
}

// ------------------------------------------------------------------ награды

function applyMissionRewards(world: World, mission: CampaignMission): void {
  // награда ровно один раз, даже если миссию завершили повторно
  if (mission.flags["rewarded"] === 1) return;
  mission.flags["rewarded"] = 1;
  const empireId = world.playerEmpireId;
  const rewards = mission.rewards;
  applyCampaignEffect(world, empireId, "credits", rewards.credits ?? 0);
  applyCampaignEffect(world, empireId, "alloys", rewards.alloys ?? 0);
  applyCampaignEffect(world, empireId, "influence", rewards.influence ?? 0);
  for (const [school, value] of Object.entries(rewards.science ?? {})) {
    if (value) applyCampaignEffect(world, empireId, "science." + school, value);
  }
  if (rewards.reputation) {
    // репутация гвера: накапливаем в флагах кампании (станции/фракции связывает контент)
    applyCampaignEffect(world, empireId, "rep." + mission.giver, rewards.reputation);
  }
  if (rewards.unlock) setFlag(ensureFg(world).campaign, "unlock." + rewards.unlock);
}

// ------------------------------------------------------------------ завершение/провал

function completeMission(world: World, mission: CampaignMission, def: CampaignMissionDef | undefined): void {
  if (mission.status === "completed" || mission.status === "failed" || mission.status === "skipped") return;
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  for (const objective of mission.objectives) {
    objective.done = true;
    if (objective.progress < objective.count) objective.progress = objective.count;
  }
  mission.status = "completed";
  if (campaign.activeMissionId === mission.id) campaign.activeMissionId = null;
  removeStoryLock(campaign, mission.id);
  setFlag(campaign, "mission." + mission.id);
  applyMissionRewards(world, mission);
  if (def?.rewards.flag) setFlag(campaign, def.rewards.flag);
  if (def?.ending) setFlag(campaign, "endingHint." + def.ending);
  if (mission.act === 0) campaign.prologueStep = Math.min(3, campaign.prologueStep + 1);
  if (mission.branchRequired) {
    campaign.branchProgress[mission.branchRequired] = (campaign.branchProgress[mission.branchRequired] ?? 0) + 1;
  }
  if (mission.secret) campaign.secretLine = Math.max(campaign.secretLine, 1);
  campaign.lastStoryTick = world.tick;
  pushJournal(fg, world.tick, "mission", "Сюжетная миссия выполнена: " + mission.titleRu, mission.id);
  logEvent(world, "mission", "good", "Сюжетная миссия выполнена: " + mission.titleRu + ".", undefined, world.playerEmpireId);
}

function failMission(world: World, mission: CampaignMission, reasonRu: string): void {
  if (mission.status !== "active") return;
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  mission.status = "failed";
  mission.flags["failedAt"] = world.tick;
  mission.flags["retryAt"] = world.tick + MISSION_RETRY_TICKS;
  if (campaign.activeMissionId === mission.id) campaign.activeMissionId = null;
  removeStoryLock(campaign, mission.id);
  setFlag(campaign, "missionFailed." + mission.id);
  campaign.lastStoryTick = world.tick;
  pushJournal(fg, world.tick, "mission", "Миссия провалена (мягкий провал): " + mission.titleRu + " — " + reasonRu, mission.id);
  logEvent(world, "mission", "warn", "Сюжетная миссия провалена: " + mission.titleRu + ". Кампания продолжается.", undefined, world.playerEmpireId);
}

// ------------------------------------------------------------------ фаза кампании

/** Синхронизирует каталог с состоянием: создаёт недостающие миссии. */
function syncMissions(world: World, catalog: CampaignCatalog): void {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  if (catalog.missions.length === 0) return;
  for (const def of catalog.missions) {
    if (!campaign.missions[def.id]) {
      campaign.missions[def.id] = createMission(world, def);
    }
  }
}

function updateMissionStatus(world: World, mission: CampaignMission, def: CampaignMissionDef | undefined): void {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  if (mission.status === "locked") {
    const unlockedByEffect = mission.flags["unlocked"] === 1
      || (campaign.flags["mission_unlocked:" + mission.id] ?? 0) > 0;
    if (unlockedByEffect || missionRequirementsMet(world, mission, def)) {
      mission.status = "available";
      pushJournal(fg, world.tick, "mission", "Доступна сюжетная миссия: " + mission.titleRu, mission.id);
      logEvent(world, "mission", "info", "Доступна сюжетная миссия: " + mission.titleRu + ".", undefined, world.playerEmpireId);
      campaign.lastStoryTick = world.tick;
    }
    return;
  }
  if (mission.status === "failed") {
    const retryAt = mission.flags["retryAt"] ?? 0;
    if (world.tick >= retryAt) {
      mission.status = "available";
      pushJournal(fg, world.tick, "mission", "Можно повторить миссию: " + mission.titleRu, mission.id);
    }
  }
}

/** Прогресс пассивных целей (без внешних хуков): прибытие, скан, бой, артефакты, колонии, флаги. */
function updatePassiveObjectives(world: World, mission: CampaignMission): void {
  const fg = ensureFg(world);
  const playerId = world.playerEmpireId;
  const empire = playerEmpire(world);
  for (const objective of mission.objectives) {
    if (objective.done) continue;
    const targetId = objective.targetSystemId;
    const presenceIn = (systemId: number): boolean =>
      world.fleets.some((fleet) => fleet.empireId === playerId && fleet.systemId === systemId && fleet.ships.length > 0);
    const anyPlayerFleet = (): boolean => world.fleets.some((fleet) => fleet.empireId === playerId && fleet.ships.length > 0);
    switch (objective.type) {
      // --- прибытие/взаимодействие в системе: разовое выполнение
      case "reach_system":
      case "dock":
      case "talk":
      case "escape": {
        if (targetId === undefined) {
          if (anyPlayerFleet()) objective.progress = objective.count;
        } else if (presenceIn(targetId)) {
          objective.progress = objective.count;
        }
        break;
      }
      // --- нахождение в системе N тактов (эскорт/выживание): +1 за такт
      case "escort":
      case "survive_ticks": {
        if (targetId === undefined || presenceIn(targetId)) objective.progress = Math.min(objective.count, objective.progress + 1);
        break;
      }
      case "scan": {
        if (targetId === undefined) {
          const scanned = world.systems.filter((system) => system.knownBy.includes(playerId)).length;
          objective.progress = Math.min(objective.count, scanned);
        } else {
          const system = world.systems.find((s) => s.id === targetId);
          if (system && system.knownBy.includes(playerId)) objective.progress = objective.count;
        }
        break;
      }
      // --- бой: только победы игрока (по журналу боёв, начиная с прошлой проверки)
      case "combat":
      case "destroy_fleet":
      case "defend_system": {
        const lastTick = mission.flags["combatSeenTick"] ?? 0;
        let wins = 0;
        for (const battle of world.battles) {
          if (battle.tick <= lastTick) continue;
          if (battle.tick > world.tick) break;
          if (targetId !== undefined && battle.systemId !== targetId) continue;
          if (battle.attacker.empireId !== playerId && battle.defender.empireId !== playerId) continue;
          const won = (battle.attacker.empireId === playerId && battle.outcome === "attacker_win")
            || (battle.defender.empireId === playerId && battle.outcome === "defender_win");
          if (won) wins += 1;
        }
        if (wins > 0) {
          objective.progress = Math.min(objective.count, objective.progress + wins);
          mission.flags["combatSeenTick"] = world.tick;
        }
        break;
      }
      // --- артефакты/колонии/ветка
      case "collect":
      case "collect_artifact":
        objective.progress = Math.min(objective.count, fg.campaign.artifactCount);
        break;
      case "construct":
        objective.progress = Math.min(objective.count, empire?.colonies.length ?? 0);
        break;
      case "choose":
        if (fg.campaign.branch !== "undecided") objective.progress = objective.count;
        break;
      default:
        break;
    }
    // универсальный канал прогресса для экзотических целей:
    // другие системы (кризисы/совет/ИИ) или скрипты выставляют флаг obj.<missionId>.<objectiveId>
    if (!objective.done) {
      const flagProgress = fg.campaign.flags["obj." + mission.id + "." + objective.id] ?? 0;
      if (flagProgress > objective.progress) objective.progress = Math.min(objective.count, flagProgress);
    }
    if (objective.progress >= objective.count) {
      objective.progress = objective.count;
      objective.done = true;
    }
  }
}
function activeMissionOf(world: World): { mission: CampaignMission; def: CampaignMissionDef | undefined } | null {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  const id = campaign.activeMissionId;
  if (!id) return null;
  const mission = campaign.missions[id];
  if (!mission || mission.status !== "active") return null;
  return { mission, def: catalogMission(defaultCampaignCatalog(), id) };
}

/** Дедлайн активной миссии: истёк → мягкий провал. */
function checkMissionDeadline(world: World, mission: CampaignMission): boolean {
  const deadline = mission.flags["deadline"] ?? 0;
  if (deadline > 0 && world.tick > deadline) {
    failMission(world, mission, "истекло время");
    return true;
  }
  return false;
}

/** Главная фаза такта: акты, доступность, прогресс, напоминания, концовки. */
export function campaignPhase(world: World, override?: Partial<CampaignCatalog>): void {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  const catalog = resolveCatalog(override);

  // 1. Акт по такту (монотонно)
  const act = actForTick(world.tick, catalog);
  if (act > campaign.act) {
    const fromAct = campaign.act;
    campaign.act = act;
    campaign.lastStoryTick = world.tick;
    pushJournal(fg, world.tick, "story", "Начался " + actName(act, catalog) + ".");
    logEvent(world, "system", "good", "Начался " + actName(act, catalog) + ".", undefined, world.playerEmpireId);
    appendActBridgeJournal(world, fromAct, act);
  }

  // 2. Локи: чистим истёкшие
  if (campaign.locks.length > 0) campaign.locks = campaign.locks.filter((lock) => lock.untilTick > world.tick);

  // 3. Каталог → состояние
  syncMissions(world, catalog);
  if (catalog.missions.length === 0) {
    // Пустой контент: миссий нет, но ветки/концовки/финал работают.
    checkEndings(world, catalog);
    finishFinale(world, campaign);
    return;
  }

  // 4. Статусы доступности
  for (const mission of Object.values(campaign.missions)) {
    updateMissionStatus(world, mission, catalogMission(catalog, mission.id));
  }

  // 5. Активная миссия: пассивные цели, хуки, дедлайн, завершение
  const active = activeMissionOf(world);
  if (active) {
    const { mission, def } = active;
    updatePassiveObjectives(world, mission);
    if (!checkMissionDeadline(world, mission)) {
      const allDone = mission.objectives.length > 0 && mission.objectives.every((objective) => objective.done);
      if (allDone) completeMission(world, mission, def);
    }
  }

  // 6. Напоминание при игнорировании сюжета (не провал, док 11 §2)
  const availableMissions = Object.values(campaign.missions).filter((mission) => mission.status === "available");
  if (availableMissions.length > 0 && !campaign.activeMissionId && world.tick - campaign.lastStoryTick >= STORY_REMINDER_TICKS) {
    campaign.lastStoryTick = world.tick;
    campaign.flags["storyReminder"] = (campaign.flags["storyReminder"] ?? 0) + 1;
    const reminder = availableMissions[0]!;
    pushJournal(fg, world.tick, "reminder", "Напоминание: вас ждёт миссия «" + reminder.titleRu + "».", reminder.id);
    logEvent(world, "mission", "info", "Сюжетная миссия ждёт: " + reminder.titleRu + ".", undefined, world.playerEmpireId);
  }

  // 7. Концовки и финал
  checkEndings(world, catalog);
  finishFinale(world, campaign);
}

function finishFinale(world: World, campaign: CampaignState): void {
  if (world.tick < CAMPAIGN_END_TICK) return;
  if (campaign.flags["finale"] === 1) return;
  setFlag(campaign, "finale");
  const fg = ensureFg(world);
  pushJournal(fg, world.tick, "story", "Финал: 7200 тактов прошло. Кампания завершена.");
  logEvent(world, "victory", "info", "Финал кампании: время вышло.", undefined, world.playerEmpireId);
}

// ------------------------------------------------------------------ миссии (команды)

/** Проверка владельца: кампания — только у империи игрока. */
function checkCampaignOwner(world: World, empireId: number): string | null {
  if (empireId !== world.playerEmpireId) return "Кампания доступна только империи игрока";
  return null;
}

export function availableCampaignMissions(world: World): CampaignMission[] {
  const fg = ensureFg(world);
  return Object.values(fg.campaign.missions).filter((mission) => mission.status === "available");
}

export function activeCampaignMission(world: World): CampaignMission | null {
  const fg = ensureFg(world);
  const id = fg.campaign.activeMissionId;
  return id ? fg.campaign.missions[id] ?? null : null;
}

export function campaignMission(world: World, missionId: string): CampaignMission | null {
  return ensureFg(world).campaign.missions[missionId] ?? null;
}

/** Старт сюжетной миссии: статус active, сюжетный лок, инициализация целей/дедлайна. */
export function startCampaignMission(
  world: World,
  empireId: number,
  missionId: string,
  override?: Partial<CampaignCatalog>,
): { ok: boolean; messageRu?: string } {
  const ownerError = checkCampaignOwner(world, empireId);
  if (ownerError) return { ok: false, messageRu: ownerError };
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  const catalog = resolveCatalog(override);
  const mission = campaign.missions[missionId];
  if (!mission) {
    const def = catalogMission(catalog, missionId);
    if (!def) return { ok: false, messageRu: "Миссия не найдена" };
    campaign.missions[missionId] = createMission(world, def);
    return { ok: false, messageRu: "Миссия ещё не доступна" };
  }
  if (mission.status === "completed") return { ok: false, messageRu: "Миссия уже выполнена" };
  if (mission.status === "skipped") return { ok: false, messageRu: "Миссия пропущена" };
  if (mission.status === "active") return { ok: false, messageRu: "Миссия уже выполняется" };
  const def = catalogMission(catalog, missionId);
  if (!missionRequirementsMet(world, mission, def)) {
    return { ok: false, messageRu: "Требования миссии не выполнены" };
  }
  if (campaign.activeMissionId) return { ok: false, messageRu: "Сначала завершите текущую сюжетную миссию" };
  if (mission.status !== "available") return { ok: false, messageRu: "Миссия пока недоступна" };

  mission.status = "active";
  mission.acceptedTick = world.tick;
  mission.flags["deadline"] = world.tick + (mission.flags["deadlineTicks"] ?? missionDeadlineTicks(def));
  campaign.activeMissionId = mission.id;
  campaign.lastStoryTick = world.tick;
  const isStoryLockAct = mission.act === 0 || mission.act === 3 || mission.act === 5;
  if (isStoryLockAct) addStoryLock(campaign, mission.id, world.tick, "Сюжет: " + mission.titleRu);
  pushJournal(fg, world.tick, "mission", "Миссия начата: " + mission.titleRu, mission.id);
  logEvent(world, "mission", "info", "Сюжетная миссия начата: " + mission.titleRu + ".", undefined, empireId);
  return { ok: true };
}

/** Пропуск миссии (необязательная/провальная ветка): статус skipped, кампания продолжается. */
export function skipCampaignMission(world: World, empireId: number, missionId: string): { ok: boolean; messageRu?: string } {
  const ownerError = checkCampaignOwner(world, empireId);
  if (ownerError) return { ok: false, messageRu: ownerError };
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  const mission = campaign.missions[missionId];
  if (!mission) return { ok: false, messageRu: "Миссия не найдена" };
  if (mission.status === "completed") return { ok: false, messageRu: "Миссия уже выполнена" };
  if (campaign.activeMissionId === mission.id) campaign.activeMissionId = null;
  removeStoryLock(campaign, mission.id);
  mission.status = "skipped";
  pushJournal(fg, world.tick, "mission", "Миссия пропущена: " + mission.titleRu, mission.id);
  logEvent(world, "mission", "warn", "Миссия пропущена: " + mission.titleRu + ".", undefined, empireId);
  return { ok: true };
}

// ------------------------------------------------------------------ ветки

export interface BranchRequirement {
  ok: boolean;
  reasonRu?: string;
}

/** Проверяемое требование ветки (акт + фракционная предпосылка). */
export function branchRequirement(world: World, branch: CampaignBranch): BranchRequirement {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  if (campaign.branch !== "undecided") return { ok: false, reasonRu: "Ветка уже выбрана" };
  if (campaign.act < BRANCH_MIN_ACT) {
    return { ok: false, reasonRu: "Выбор ветки доступен со II акта (" + actName(BRANCH_MIN_ACT) + ")" };
  }
  const empire = playerEmpire(world);
  if (!empire) return { ok: false, reasonRu: "Империя не найдена" };
  if (branch === "federation") {
    const bestOpinion = Math.max(0, ...world.empires.filter((e) => e.id !== empire.id && !e.isPlayer).map((e) => e.relations[empire.id]?.opinion ?? 0));
    if (bestOpinion < BRANCH_REQUIREMENTS.federation.minOpinion) {
      return { ok: false, reasonRu: "Нужно мнение союзника ≥ " + BRANCH_REQUIREMENTS.federation.minOpinion + " (сейчас " + bestOpinion + ")" };
    }
  } else if (branch === "sovereignty") {
    if (empire.systems.length < BRANCH_REQUIREMENTS.sovereignty.minSystems) {
      return { ok: false, reasonRu: "Суверенитету нужно ≥ " + BRANCH_REQUIREMENTS.sovereignty.minSystems + " систем" };
    }
  } else if (branch === "syndicate") {
    if (empire.resources.credits < BRANCH_REQUIREMENTS.syndicate.minCredits) {
      return { ok: false, reasonRu: "Синдикату нужно ≥ " + BRANCH_REQUIREMENTS.syndicate.minCredits + " Cr" };
    }
  } else {
    return { ok: false, reasonRu: "Неизвестная ветка" };
  }
  return { ok: true };
}

/** Выбор ветки: одна на партию. Флаги/эффекты/миссии ветки из BRANCHES. */
export function chooseBranch(
  world: World,
  empireId: number,
  branch: CampaignBranch,
  override?: Partial<CampaignCatalog>,
): { ok: boolean; messageRu?: string } {
  const ownerError = checkCampaignOwner(world, empireId);
  if (ownerError) return { ok: false, messageRu: ownerError };
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  if (branch !== "federation" && branch !== "sovereignty" && branch !== "syndicate") {
    return { ok: false, messageRu: "Неизвестная ветка" };
  }
  const requirement = branchRequirement(world, branch);
  if (!requirement.ok) return { ok: false, messageRu: requirement.reasonRu };
  const catalog = resolveCatalog(override);
  const def = catalog.branches.find((item) => item.id === branch);
  campaign.branch = branch;
  campaign.branchProgress[branch] = Math.max(1, campaign.branchProgress[branch] ?? 0);
  setFlag(campaign, "branch:" + branch);
  if (def) {
    for (const [target, value] of Object.entries(def.effects ?? {})) applyCampaignEffect(world, empireId, target, value);
    if (def.ending) setFlag(campaign, "branchEnding." + def.ending);
    // миссии ветки становятся доступными (дальше их откроет акт/пререквизиты)
    for (const missionId of def.missions ?? []) {
      const mission = campaign.missions[missionId];
      if (mission && mission.status === "locked" && mission.act <= campaign.act) {
        const missionDef = catalogMission(catalog, missionId);
        if (missionRequirementsMet(world, mission, missionDef)) mission.status = "available";
      }
    }
  }
  campaign.lastStoryTick = world.tick;
  pushJournal(fg, world.tick, "branch", "Выбрана ветка: " + (def?.ru ?? branch) + ".");
  logEvent(world, "diplomacy", "good", "Кампания: выбрана ветка «" + (def?.ru ?? branch) + "».", undefined, empireId);
  return { ok: true };
}

// ------------------------------------------------------------------ концовки

interface BuiltinEnding {
  id: string;
  condition: (world: World) => boolean;
}

function crisesDefeated(world: World): boolean {
  const fg = ensureFg(world);
  return fg.crises.length > 0 && fg.crises.every((crisis) => crisis.defeated);
}

function controlledSystemShare(world: World): number {
  const fg = ensureFg(world);
  if (world.systems.length === 0) return 0;
  const empire = playerEmpire(world);
  if (!empire) return 0;
  const owned = empire.systems.length + fg.megastructures.filter((m) => m.ownerId === empire.id && m.active).length;
  return owned / world.systems.length;
}

/** Встроенный набор концовок (используется, если ENDINGS в данных пуст). */
const BUILTIN_ENDINGS: readonly BuiltinEnding[] = [
  {
    id: "ending_seal_rift",
    condition: (world) => {
      const fg = ensureFg(world);
      return crisesDefeated(world) && fg.campaign.artifactCount >= 5;
    },
  },
  {
    id: "ending_control_rift",
    condition: (world) => {
      const fg = ensureFg(world);
      return fg.campaign.branch === "sovereignty" && (crisesDefeated(world) || fg.campaign.artifactCount >= 5);
    },
  },
  {
    id: "ending_free_rift",
    condition: (world) => {
      const fg = ensureFg(world);
      return fg.campaign.branch === "federation"
        && (fg.federations.length > 0 || controlledSystemShare(world) >= 0.25);
    },
  },
  {
    id: "ending_syndicate",
    condition: (world) => {
      const fg = ensureFg(world);
      const empire = playerEmpire(world);
      return fg.campaign.branch === "syndicate" && (empire?.resources.credits ?? 0) >= 100000;
    },
  },
  {
    id: "ending_whisper",
    // секретная: 6 артефактов «Шёпота» (кампания.secretLine) или 6+ артефактов
    condition: (world) => {
      const fg = ensureFg(world);
      return fg.campaign.secretLine >= SECRET_ARTIFACTS || fg.campaign.artifactCount >= SECRET_ARTIFACTS;
    },
  },
];

/** Числовые источники для сравнений в условиях концовок. */
function endingNumbers(world: World): Record<string, number> {
  const fg = ensureFg(world);
  const empire = playerEmpire(world);
  return {
    artifacts: fg.campaign.artifactCount,
    artifact_count: fg.campaign.artifactCount,
    artifacts_whisper: fg.campaign.secretLine,
    secret: fg.campaign.secretLine,
    secret_line: fg.campaign.secretLine,
    crisis: fg.crises.filter((crisis) => crisis.defeated).length,
    crises_defeated: fg.crises.filter((crisis) => crisis.defeated).length,
    federation: fg.federations.length,
    federations: fg.federations.length,
    tick: world.tick,
    systems: empire?.systems.length ?? 0,
    colonies: empire?.colonies.length ?? 0,
    fleets: empire?.fleets.length ?? 0,
    megastructure: fg.megastructures.filter((item) => item.active).length,
    megastructures: fg.megastructures.filter((item) => item.active).length,
    credits: empire?.resources.credits ?? 0,
    score: fg.score[world.playerEmpireId] ?? 0,
    act: fg.campaign.act,
    perks: advancedOf(world, world.playerEmpireId).perks.length,
  };
}

/** Флаг кампании или мира: условия вида final_battle_won выставляют другие системы M7/M10. */
function endingFlag(world: World, name: string): boolean {
  const fg = ensureFg(world);
  return (fg.campaign.flags[name] ?? 0) > 0 || (world.flags[name] ?? 0) > 0;
}

/**
 * Разбор строки условия концовки из данных (AND через ",", ";", "&&" или слово "and"):
 *  artifacts>=N | artifacts_whisper==6 | colonies==0 | fleets>0 | tick>=N | systems>=N |
 *  credits>=N | score>=N | crisis>=N | federation>=N | megastructure>=N | act>=N;
 *  branch==<id> | megastructure==<type> | perk==<id>; crisis_defeated;
 *  flag:<name> | mission:<id> | прочий токен — флаг кампании/мира (false, если не выставлен).
 */
function endingConditionMet(world: World, condition: string): boolean {
  const fg = ensureFg(world);
  const tokens = condition
    .toLowerCase()
    .split(/[,;]|&&|\s+and\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  const numbers = endingNumbers(world);
  for (const token of tokens) {
    const comparison = /^([a-z_]+)\s*(>=|<=|==|>|<|=)\s*(-?\d+)$/.exec(token);
    if (comparison) {
      const value = numbers[comparison[1]!];
      if (value === undefined) return false;
      const op = comparison[2]!;
      const raw = Number.parseInt(comparison[3]!, 10);
      const ok = op === ">=" ? value >= raw
        : op === "<=" ? value <= raw
          : op === ">" ? value > raw
            : op === "<" ? value < raw
              : value === raw;
      if (!ok) return false;
      continue;
    }
    const equality = /^([a-z_]+)\s*={1,2}\s*([a-z0-9_:.-]+)$/.exec(token);
    if (equality) {
      const key = equality[1]!;
      const expected = equality[2]!;
      if (key === "branch") {
        if (fg.campaign.branch !== expected) return false;
      } else if (key === "megastructure" || key === "megastructures") {
        if (!fg.megastructures.some((item) => item.active && item.type === expected)) return false;
      } else if (key === "perk" || key === "perks") {
        const perks = advancedOf(world, world.playerEmpireId).perks;
        if (!perks.includes(expected) && !endingFlag(world, "perk." + expected)) return false;
      } else if (key === "flag") {
        if (!endingFlag(world, expected)) return false;
      } else if (!endingFlag(world, key + ":" + expected)) {
        // неизвестное равенство трактуем как флаг «key:expected»
        return false;
      }
      continue;
    }
    if (token === "crisis_defeated" || token === "all_crises_defeated") {
      if (!crisesDefeated(world)) return false;
      continue;
    }
    if (token === "federation") {
      if (fg.federations.length === 0) return false;
      continue;
    }
    if (token === "megastructure") {
      if (fg.megastructures.length === 0) return false;
      continue;
    }
    if (token.startsWith("flag:")) {
      if (!endingFlag(world, token.slice(5))) return false;
      continue;
    }
    if (token.startsWith("mission:")) {
      if (!hasFlag(fg.campaign, "mission." + token.slice(8))) return false;
      continue;
    }
    // прочие условия — флаги, которые выставляют другие системы (кризисы/совет/война/ironman)
    if (!endingFlag(world, token)) return false;
  }
  return true;
}

/**
 * Проверка концовок (5 + секретная). Возвращает список id, чьи условия выполнены.
 * Новые концовки добавляются в состояние ровно один раз (идемпотентно), с записью в журнал.
 */
export function checkEndings(world: World, override?: Partial<CampaignCatalog>): string[] {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  const catalog = resolveCatalog(override);
  const found: string[] = [];
  if (catalog.endings.length > 0) {
    for (const def of catalog.endings) {
      if (endingConditionMet(world, def.condition)) found.push(def.id);
    }
  } else {
    for (const ending of BUILTIN_ENDINGS) {
      if (ending.condition(world)) found.push(ending.id);
    }
  }
  // Мягкие подсказки (endingHint) влияют на порядок/тон эпилога, но не фиксируют финал.
  const hints = Object.keys(campaign.flags)
    .filter((key) => key.startsWith("ending_hint:"))
    .map((key) => key.slice("ending_hint:".length));
  found.sort((a, b) => {
    const hintA = hints.includes(a) ? 0 : 1;
    const hintB = hints.includes(b) ? 0 : 1;
    if (hintA !== hintB) return hintA - hintB;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const added: string[] = [];
  for (const id of found) {
    if (campaign.endings.includes(id)) continue;
    if (hints.includes(id)) campaign.flags["endingPreferred"] = 1;
    campaign.endings.push(id);
    added.push(id);
    pushJournal(fg, world.tick, "ending", "Достигнута концовка: " + endingName(id, catalog) + ".");
    logEvent(world, "victory", "good", "Достигнута концовка: " + endingName(id, catalog) + ".", undefined, world.playerEmpireId);
  }
  if (added.length > 0) campaign.lastStoryTick = world.tick;
  return found;
}

function bridgeFor(fromAct: number, toAct: number): StoryBridgeDef | undefined {
  const preferred = "bridge_" + fromAct + "_" + toAct;
  return CAMPAIGN_BRIDGES.find((bridge) => bridge.id === preferred)
    ?? CAMPAIGN_BRIDGES.find((bridge) => bridge.fromAct === fromAct && bridge.toAct === toAct);
}

/** Журнал «мостиков» на смене акта: один раз на переход, данные — CAMPAIGN_BRIDGES. */
function appendActBridgeJournal(world: World, fromAct: number, toAct: number): void {
  const fg = ensureFg(world);
  const campaign = fg.campaign;
  for (let previous = fromAct; previous < toAct; previous++) {
    const next = previous + 1;
    const key = "bridge_journal:" + previous + "_" + next;
    if ((campaign.flags[key] ?? 0) > 0) continue;
    const bridge = bridgeFor(previous, next);
    if (!bridge) continue;
    campaign.flags[key] = 1;
    const text = bridge.titleRu + "\n\n" + bridge.bodyRu;
    pushJournal(fg, world.tick, "chronicle", text, bridge.id);
  }
}

function endingName(endingId: string, catalog: CampaignCatalog): string {
  return catalog.endings.find((def) => def.id === endingId)?.ru ?? endingId;
}

export function campaignEndings(world: World): string[] {
  return [...ensureFg(world).campaign.endings];
}

// ------------------------------------------------------------------ хуки событий

/** Найти активную миссию и продвинуть совпадающие цели. */
function progressActiveObjectives(
  world: World,
  empireId: number,
  types: readonly string[],
  systemId: number | null,
  amount: number,
): void {
  if (empireId !== world.playerEmpireId) return;
  const active = activeMissionOf(world);
  if (!active) return;
  const { mission } = active;
  let changed = false;
  for (const objective of mission.objectives) {
    if (objective.done) continue;
    if (!types.includes(objective.type)) continue;
    if (objective.targetSystemId !== undefined && systemId !== null && objective.targetSystemId !== systemId) continue;
    objective.progress = Math.min(objective.count, objective.progress + amount);
    if (objective.progress >= objective.count) objective.done = true;
    changed = true;
  }
  if (!changed) return;
  if (mission.objectives.length > 0 && mission.objectives.every((objective) => objective.done)) {
    completeMission(world, mission, catalogMission(defaultCampaignCatalog(), mission.id));
  }
}

export function onCampaignScan(world: World, empireId: number, systemId: number): void {
  progressActiveObjectives(world, empireId, ["scan"], systemId, 1);
}

export function onCampaignBattle(world: World, empireId: number, systemId: number, won: boolean): void {
  if (!won) return;
  progressActiveObjectives(world, empireId, ["combat"], systemId, 1);
}

export function onCampaignDock(world: World, empireId: number, stationId: number): void {
  const system = world.systems.find((s) => s.station && s.station.id === stationId);
  progressActiveObjectives(world, empireId, ["dock"], system ? system.id : null, 1);
}

export function onCampaignJump(world: World, empireId: number, systemId: number): void {
  progressActiveObjectives(world, empireId, ["reach_system", "escort"], systemId, 1);
}
