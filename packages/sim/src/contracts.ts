/**
 * КОНТРАКТЫ (M8): 12 типов на станциях, цели/сроки/риск/награды/репутация,
 * приём/отказ (3 отказа -> блок 100 тактов, -5 репутации), прогресс по хукам мира,
 * награда только по завершении и идемпотентно.
 * Канон: 03b §11.2 (доходы пилота), §11.6 (провал), §14.1-6 (эксплойт миссий), §14.3 (3 активных).
 *
 * Данные: 6 типов берутся из packages/data/src/missions.json (MISSIONS),
 * 6 остальных — из fallback-таблицы market-config.ts до заполнения контента (task-12).
 */
import { MISSIONS } from "@sf/data";
import { clamp, empireById, logEvent } from "./economy";
import type { Contract, ContractKind, ContractObjective, ContractRewards } from "./fullgame";
import { ensureFg, pushJournal } from "./fullgame";
import {
  CONTRACT_DELIVERY_GOODS, CONTRACT_FALLBACK_TEMPLATES, MARKET_CFG, MISSION_KIND_TO_OBJECTIVE,
} from "./market-config";
import type { ContractTemplate } from "./market-config";
import { computeHops } from "./galaxy";
import { adjustReputation, stationAccess } from "./market";
import { hash32 } from "./prng";
import type { CommandResult, ResourceId, ScienceId, Station, World } from "./types";

/** Все 12 типов контрактов (03b §11.2). */
export const CONTRACT_KINDS: ContractKind[] = [
  "delivery", "bounty", "scan", "passenger", "smuggle", "rescue",
  "mining", "tourist", "escort", "salvage", "hunt", "evacuation",
];

/** Дополнительные поля контракта (общий тип не расширяем — контракт общий с UI). */
interface ContractExt extends Contract {
  acceptedBy?: number;
}

function asExt(contract: Contract): ContractExt {
  return contract as ContractExt;
}

function acceptedByOf(contract: Contract): number {
  return asExt(contract).acceptedBy ?? 0;
}

/** Количество цели для конкретных опорных миссий из data (иначе — по типу). */
const COUNT_BY_DEF: Record<string, number> = {
  delivery_bulk: 100,
  delivery_express: 20,
  bounty_fleet: 60,
  bounty_capital: 50,
};

function templatesFromData(): ContractTemplate[] {
  const templates: ContractTemplate[] = [];
  for (const mission of MISSIONS) {
    const kind = mission.kind as ContractKind;
    const objective = MISSION_KIND_TO_OBJECTIVE[mission.kind] ?? "dock";
    const base = objective === "deliver" ? 20 : objective === "bounty" ? 20 : 1;
    templates.push({
      defId: mission.id,
      kind,
      titleRu: mission.ru,
      descRu: mission.descRu,
      objective,
      count: COUNT_BY_DEF[mission.id] ?? base,
      good: objective === "deliver" ? CONTRACT_DELIVERY_GOODS[0] : undefined,
      minTicks: mission.minTicks,
      maxTicks: mission.maxTicks,
      rewardCredits: mission.rewardCredits,
      perJumpCredits: mission.perJumpCredits,
      rewardRep: mission.rewardRep,
      risk: mission.risk,
      minRep: kind === "smuggle" ? -100 : -29,
    });
  }
  return templates;
}

/** Реестр шаблонов: @sf/data MISSIONS (6 типов) + fallback (6 типов). */
export function contractTemplates(): ContractTemplate[] {
  return templatesFromData().concat(CONTRACT_FALLBACK_TEMPLATES.map((template) => ({ ...template })));
}

const TEMPLATES: ContractTemplate[] = contractTemplates();

// ------------------------------------------------------------------ вспомогательные

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

function randRange(world: World, min: number, max: number, salt: number): number {
  const span = Math.max(0, max - min);
  return min + (span > 0 ? hash32(world.seed, world.tick, salt) % (span + 1) : 0);
}

function randIndex(world: World, length: number, salt: number): number {
  if (length <= 0) return 0;
  return hash32(world.seed, world.tick, salt) % length;
}

function findStation(world: World, stationId: number): Station | undefined {
  for (const system of world.systems) {
    if (system.station && system.station.id === stationId) return system.station;
  }
  return undefined;
}

function systemOfStation(world: World, stationId: number): number {
  const station = findStation(world, stationId);
  if (!station) return 0;
  return world.systems.find((system) => system.station && system.station.id === stationId)?.id ?? station.systemId;
}

/** Товар deliver-цели кодируется в id цели: "deliver:minerals". */
function objectiveGood(objective: ContractObjective): ResourceId | undefined {
  if (objective.type !== "deliver") return undefined;
  const parts = objective.id.split(":");
  const good = parts.length > 1 ? parts[1] : "";
  return (CONTRACT_DELIVERY_GOODS as string[]).includes(good) || CONTRACT_DELIVERY_GOODS.length === 0
    ? (good as ResourceId)
    : CONTRACT_DELIVERY_GOODS[0];
}

function fleetInSystem(world: World, empireId: number, systemId: number): boolean {
  for (const fleet of world.fleets) {
    if (fleet.empireId === empireId && fleet.systemId === systemId && fleet.ships.length > 0) return true;
  }
  return false;
}

function progressOf(contract: Contract): void {
  let sum = 0;
  for (const objective of contract.objectives) {
    const count = Math.max(1, objective.count);
    sum += Math.min(objective.progress, objective.count) / count;
  }
  contract.progress = contract.objectives.length > 0
    ? Math.round((sum / contract.objectives.length) * 100)
    : 0;
}

function allObjectivesDone(contract: Contract): boolean {
  if (contract.objectives.length === 0) return false;
  return contract.objectives.every((objective) => objective.done);
}

/** Попытка доставки товара по deliver-цели (списывает товар из казны). */
function attemptDelivery(world: World, empireId: number, contract: Contract, objective: ContractObjective): void {
  const good = objectiveGood(objective);
  if (!good) return;
  const empire = empireById(world, empireId);
  if (!empire) return;
  void world;
  const need = objective.count - objective.progress;
  if (need <= 0) return;
  const take = Math.min(need, empire.resources[good]);
  if (take <= 0) return;
  empire.resources[good] -= take;
  objective.progress += take;
  if (objective.progress >= objective.count) objective.done = true;
  progressOf(contract);
}

// ------------------------------------------------------------------ генерация контрактов

/** Доступные (не принятые) контракты, при необходимости — по станции. */
export function availableContracts(world: World, stationId?: number): Contract[] {
  const fg = ensureFg(world);
  return fg.contracts
    .filter((contract) => !contract.accepted && !contract.completed && !contract.failed
      && (stationId === undefined || contract.stationId === stationId))
    .sort((a, b) => a.id - b.id);
}

/** Принятые контракты империи. */
export function activeContractsOf(world: World, empireId: number): Contract[] {
  const fg = ensureFg(world);
  return fg.contracts
    .filter((contract) => contract.accepted && !contract.completed && !contract.failed
      && acceptedByOf(contract) === empireId)
    .sort((a, b) => a.id - b.id);
}

export function contractById(world: World, contractId: number): Contract | undefined {
  return ensureFg(world).contracts.find((contract) => contract.id === contractId);
}

/** Сгенерировать контракт на станции; null — не удалось подобрать шаблон. */
export function generateContract(world: World, station: Station, sequence: number): Contract | null {
  const fg = ensureFg(world);
  const system = world.systems[station.systemId];
  if (!system) return null;
  const playerId = world.playerEmpireId;
  const access = stationAccess(world, playerId, station.id);
  // тип выбираем циклом по 12 видам (+такт), чтобы пул станции покрывал разные контракты
  const kind = CONTRACT_KINDS[(station.id * 7 + sequence + world.tick) % CONTRACT_KINDS.length];
  let candidates = TEMPLATES.filter((template) => template.kind === kind);
  if (access.missions === "smuggle_only") {
    candidates = candidates.filter((template) => template.kind === "smuggle");
    if (candidates.length === 0) candidates = TEMPLATES.filter((template) => template.kind === "smuggle");
  } else {
    candidates = candidates.filter((template) => template.minRep <= access.reputation);
  }
  if (candidates.length === 0) {
    candidates = TEMPLATES.filter((template) => template.minRep <= access.reputation);
  }
  if (candidates.length === 0) return null;
  const template = candidates[randIndex(world, candidates.length, station.id * 31 + sequence)];
  const hops = computeHops(world.systems, station.systemId);
  const needStation = template.objective === "dock" || template.objective === "deliver";
  const pool: number[] = [];
  for (const candidate of world.systems) {
    const distance = hops[candidate.id];
    if (distance < 2 || distance > 8) continue;
    if (needStation && !candidate.station) continue;
    pool.push(candidate.id);
  }
  pool.sort((a, b) => a - b);
  const targetSystemId = pool.length > 0
    ? pool[hash32(world.seed, world.tick, station.id, 0xc1) % pool.length]
    : station.systemId;
  const jumps = Math.max(1, hops[targetSystemId] ?? 1);
  const targetStation = world.systems[targetSystemId]?.station;
  let count = template.count;
  if (template.objective === "deliver") count = template.count + (hash32(world.seed, world.tick, station.id, 0xd2) % 3) * 10;
  if (template.objective === "bounty") count = template.count + (hash32(world.seed, world.tick, station.id, 0xd3) % 3) * 10;
  let good: ResourceId | undefined;
  if (template.objective === "deliver") {
    good = template.good;
    if (targetStation && targetStation.market) {
      const sellable = CONTRACT_DELIVERY_GOODS.filter((candidate) => targetStation.market[candidate] !== undefined);
      if (sellable.length > 0) good = sellable[hash32(world.seed, world.tick, station.id, 0xd4) % sellable.length];
    }
    if (!good) good = CONTRACT_DELIVERY_GOODS[0];
  }
  const objectiveId = template.objective + (good ? ":" + good : "");
  const count_ = Math.max(1, count);
  const objectives: ContractObjective[] = [{
    id: objectiveId,
    type: template.objective,
    targetSystemId,
    count: count_,
    progress: 0,
    done: false,
  }];
  const rewards: ContractRewards = {
    credits: template.rewardCredits + template.perJumpCredits * jumps,
    reputation: template.rewardRep,
  };
  if (template.kind === "mining" || template.kind === "salvage") {
    rewards.alloys = 30 + (hash32(world.seed, world.tick, station.id, 0xe1) % 3) * 20;
  }
  if (template.kind === "scan" || template.kind === "salvage") {
    rewards.science = { physics: 10, society: 10, engineering: 10 };
    const school: ScienceId[] = ["physics", "society", "engineering"];
    const extra = school[hash32(world.seed, world.tick, station.id, 0xe2) % 3];
    rewards.science[extra] = (rewards.science[extra] ?? 0) + 10;
  }
  if (template.kind === "tourist" || template.kind === "passenger") {
    rewards.influence = 1;
  }
  const deadlineTick = world.tick + randRange(world, template.minTicks, template.maxTicks, station.id * 17 + sequence) + 40;
  const contract: ContractExt = {
    id: fg.nextContractId++,
    defId: template.defId,
    kind: template.kind,
    titleRu: template.titleRu,
    descRu: template.descRu,
    systemId: station.systemId,
    stationId: station.id,
    factionId: station.ownerId,
    objectives,
    rewards,
    accepted: false,
    completed: false,
    failed: false,
    deadlineTick,
    acceptedTick: 0,
    progress: 0,
    risk: clampRange(0, 1, template.risk + jumps * 0.01),
  };
  return contract;
}

// ------------------------------------------------------------------ выдача награды/провал

function completeContract(world: World, contract: Contract): void {
  if (contract.completed || !contract.accepted) return;
  const empireId = acceptedByOf(contract);
  const empire = empireById(world, empireId);
  contract.completed = true;
  contract.accepted = false;
  if (!empire) return;
  const rewards = contract.rewards;
  const credits = Math.max(0, Math.round(rewards.credits));
  empire.resources.credits += credits;
  empire.stats.creditsEarned += credits;
  if (rewards.alloys) empire.resources.alloys += Math.max(0, Math.round(rewards.alloys));
  if (rewards.influence) empire.resources.influence += Math.max(0, Math.round(rewards.influence));
  if (rewards.science) {
    const schools: ScienceId[] = ["physics", "society", "engineering"];
    for (const school of schools) {
      const value = rewards.science[school];
      if (typeof value === "number" && value > 0) empire.science[school] += value;
    }
  }
  const reputation = Math.round(rewards.reputation ?? 0);
  if (reputation !== 0) adjustReputation(world, empireId, contract.stationId, reputation, "Контракт выполнен");
  logEvent(
    world, "mission", "good",
    "Контракт выполнен: " + contract.titleRu + " (+" + credits + " Cr).",
    contract.systemId, empire.isPlayer ? empireId : undefined,
  );
  if (empire.isPlayer) {
    const fg = ensureFg(world);
    pushJournal(fg, world.tick, "contract", "Контракт выполнен: " + contract.titleRu + " (+" + credits + " Cr).");
  }
}

function failAcceptedContract(world: World, contract: Contract, reasonRu: string): void {
  if (contract.failed || contract.completed) return;
  contract.failed = true;
  contract.accepted = false;
  const empireId = acceptedByOf(contract);
  const empire = empireById(world, empireId);
  if (!empire) return;
  // §11.6: провал контракта — репутация -15, штраф 25 000 Cr (кошелёк не уходит в минус)
  const fine = Math.min(empire.resources.credits, MARKET_CFG.contractFailFine);
  empire.resources.credits -= fine;
  adjustReputation(world, empireId, contract.stationId, MARKET_CFG.contractFailRepPenalty, "Контракт провален");
  logEvent(
    world, "mission", "bad",
    reasonRu + ": " + contract.titleRu + " (штраф " + fine + " Cr, репутация " + MARKET_CFG.contractFailRepPenalty + ").",
    contract.systemId, empire.isPlayer ? empireId : undefined,
  );
  if (empire.isPlayer) {
    const fg = ensureFg(world);
    pushJournal(fg, world.tick, "contract", reasonRu + ": " + contract.titleRu + ".");
  }
}

// ------------------------------------------------------------------ хуки мира (вызываются из симуляции/боя/скана/дока)

function acceptedFor(world: World, empireId: number): Contract[] {
  const fg = ensureFg(world);
  return fg.contracts.filter(
    (contract) => contract.accepted && !contract.completed && !contract.failed && acceptedByOf(contract) === empireId,
  );
}

/** Скан системы: закрывает scan-цели. */
export function onContractScan(world: World, empireId: number, systemId: number): void {
  for (const contract of acceptedFor(world, empireId)) {
    for (const objective of contract.objectives) {
      if (objective.done || objective.type !== "scan") continue;
      if (objective.targetSystemId !== systemId) continue;
      objective.progress = objective.count;
      objective.done = true;
    }
    progressOf(contract);
    if (allObjectivesDone(contract)) completeContract(world, contract);
  }
}

/** Уничтожение пиратского флота: fp — потерянная противником боевая мощь. */
export function onContractBounty(world: World, empireId: number, systemId: number, fp: number): void {
  const damage = Math.max(0, Math.round(fp));
  if (damage <= 0) return;
  for (const contract of acceptedFor(world, empireId)) {
    for (const objective of contract.objectives) {
      if (objective.done || objective.type !== "bounty") continue;
      if (objective.targetSystemId !== systemId) continue;
      objective.progress = Math.min(objective.count, objective.progress + damage);
      if (objective.progress >= objective.count) objective.done = true;
    }
    progressOf(contract);
    if (allObjectivesDone(contract)) completeContract(world, contract);
  }
}

/** Стыковка на станции: закрывает dock-цели и принимает груз deliver-целей. */
export function onContractDock(world: World, empireId: number, stationId: number): void {
  const systemId = systemOfStation(world, stationId);
  for (const contract of acceptedFor(world, empireId)) {
    for (const objective of contract.objectives) {
      if (objective.done) continue;
      const target = objective.targetSystemId ?? contract.systemId;
      if (target !== systemId) continue;
      if (objective.type === "dock") {
        objective.progress = objective.count;
        objective.done = true;
      } else if (objective.type === "deliver") {
        attemptDelivery(world, empireId, contract, objective);
      }
    }
    progressOf(contract);
    if (allObjectivesDone(contract)) completeContract(world, contract);
  }
}

/** Прыжок/прибытие флота в систему: закрывает jump-цели (сопровождение, эвакуация). */
export function onContractJump(world: World, empireId: number, systemId: number): void {
  for (const contract of acceptedFor(world, empireId)) {
    for (const objective of contract.objectives) {
      if (objective.done || objective.type !== "jump") continue;
      if (objective.targetSystemId !== systemId) continue;
      objective.progress = objective.count;
      objective.done = true;
    }
    progressOf(contract);
    if (allObjectivesDone(contract)) completeContract(world, contract);
  }
}

// ------------------------------------------------------------------ команды

/** Взять контракт: не более 3 активных, проверка блока и доступа станции (§14.3). */
export function acceptContract(world: World, empireId: number, contractId: number): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return deny("Империя не найдена");
  const contract = contractById(world, contractId);
  if (!contract) return deny("Контракт не найден");
  if (contract.completed) return deny("Контракт уже выполнен");
  if (contract.failed) return deny("Контракт провален");
  if (contract.accepted) return deny("Контракт уже принят");
  if (world.tick > contract.deadlineTick) return deny("Срок контракта истёк");
  const blockUntil = flagOf(world, "contract:block:" + empireId);
  if (world.tick < blockUntil) return deny("Контракты заблокированы до такта " + blockUntil + " (3 отказа)");
  const active = activeContractsOf(world, empireId);
  if (active.length >= MARKET_CFG.maxActiveContracts) {
    return deny("Не более " + MARKET_CFG.maxActiveContracts + " активных контрактов");
  }
  const access = stationAccess(world, empireId, contract.stationId);
  if (access.missions === "smuggle_only" && contract.kind !== "smuggle") {
    return deny("Станция враждебна: доступны только контрабандистские контракты");
  }
  const ext = asExt(contract);
  ext.acceptedBy = empireId;
  contract.accepted = true;
  contract.acceptedTick = world.tick;
  if (empire.isPlayer) {
    logEvent(world, "mission", "good", "Контракт принят: " + contract.titleRu + ".", contract.systemId, empireId);
    const fg = ensureFg(world);
    pushJournal(fg, world.tick, "contract", "Контракт принят: " + contract.titleRu + ".");
  }
  return { ok: true, createdId: contract.id };
}

/** Отказаться от контракта: -5 репутации, 3 отказа -> блок на 100 тактов (§14.1-6). */
export function abandonContract(world: World, empireId: number, contractId: number): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire || empire.dead) return deny("Империя не найдена");
  const contract = contractById(world, contractId);
  if (!contract) return deny("Контракт не найден");
  if (!contract.accepted) return deny("Контракт не принят");
  if (acceptedByOf(contract) !== empireId) return deny("Это не ваш контракт");
  if (contract.completed || contract.failed) return deny("Контракт уже закрыт");
  contract.accepted = false;
  contract.failed = true;
  const fg = ensureFg(world);
  const abandons = (fg.missionAbandons[empireId] ?? 0) + 1;
  fg.missionAbandons[empireId] = abandons;
  adjustReputation(world, empireId, contract.stationId, MARKET_CFG.contractAbandonRepPenalty, "Отказ от контракта");
  let blocked = false;
  if (abandons >= MARKET_CFG.contractAbandonLimit) {
    fg.missionAbandons[empireId] = 0;
    world.flags["contract:block:" + empireId] = world.tick + MARKET_CFG.contractBlockTicks;
    blocked = true;
  }
  if (empire.isPlayer) {
    logEvent(
      world, "mission", "warn",
      "Контракт отменён: " + contract.titleRu + " (-5 репутации" + (blocked ? ", блок контрактов 100 тактов" : "") + ").",
      contract.systemId, empireId,
    );
  }
  return { ok: true };
}

// ------------------------------------------------------------------ фаза контрактов

function pruneContracts(world: World, fg: ReturnType<typeof ensureFg>): void {
  fg.contracts = fg.contracts.filter((contract) => {
    if (!contract.completed && !contract.failed) return true;
    return world.tick <= contract.deadlineTick + 50;
  });
}

/** Пополнение рынка контрактов: до 3 на станцию, до 40 в мире, только известные станции. */
function topUpContracts(world: World, fg: ReturnType<typeof ensureFg>): void {
  const isAvailable = (contract: Contract): boolean => !contract.accepted && !contract.completed && !contract.failed;
  let total = fg.contracts.filter(isAvailable).length;
  if (total >= MARKET_CFG.contractsWorldLimit) return;
  const playerId = world.playerEmpireId;
  const stations: Station[] = [];
  for (const system of world.systems) {
    const station = system.station;
    if (!station || !station.hasMissions) continue;
    if (!system.knownBy.includes(playerId)) continue;
    stations.push(station);
  }
  stations.sort((a, b) => a.id - b.id);
  let sequence = 0;
  for (const station of stations) {
    if (total >= MARKET_CFG.contractsWorldLimit) break;
    let stationCount = fg.contracts.filter(
      (contract) => contract.stationId === station.id && isAvailable(contract),
    ).length;
    while (stationCount < MARKET_CFG.contractsPerStation && total < MARKET_CFG.contractsWorldLimit) {
      // слот контракта входит в sequence → у станции разные типы, а не 3 копии
      const contract = generateContract(world, station, sequence * 4 + stationCount);
      if (!contract) break;
      fg.contracts.push(contract);
      stationCount += 1;
      total += 1;
    }
    sequence += 1;
  }
}

/** Фаза контрактов: сроки, прогресс, награды (идемпотентно), пополнение рынка. */
export function contractsPhase(world: World): void {
  const fg = ensureFg(world);
  const contracts = fg.contracts.slice().sort((a, b) => a.id - b.id);
  for (const contract of contracts) {
    if (contract.completed || contract.failed) continue;
    if (!contract.accepted) {
      if (world.tick > contract.deadlineTick) contract.failed = true;
      continue;
    }
    const empireId = acceptedByOf(contract);
    if (world.tick > contract.deadlineTick) {
      failAcceptedContract(world, contract, "Срок контракта истёк");
      continue;
    }
    const empire = empireById(world, empireId);
    if (!empire || empire.dead) {
      contract.accepted = false;
      contract.failed = true;
      continue;
    }
    for (const objective of contract.objectives) {
      if (objective.done) continue;
      const target = objective.targetSystemId ?? contract.systemId;
      if (objective.type === "dock" || objective.type === "jump") {
        if (fleetInSystem(world, empireId, target)) objective.done = true;
      } else if (objective.type === "deliver") {
        if (fleetInSystem(world, empireId, target)) attemptDelivery(world, empireId, contract, objective);
      }
    }
    progressOf(contract);
    if (allObjectivesDone(contract)) completeContract(world, contract);
  }
  pruneContracts(world, fg);
  if (world.tick % 10 === 0) topUpContracts(world, fg);
}

