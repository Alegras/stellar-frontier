/**
 * ШПИОНАЖ (M7): 6 операций, шансы по формуле §12.5, провал (−мнение, CB),
 * кулдаун 1 операция / 50 тактов, уровни разведки по цели.
 */
import { ESPIONAGE_OPS, TECH_BY_ID } from "@sf/data";
import { clamp, empireById, logEvent } from "./economy";
import { hash32 } from "./prng";
import { addRecentAction, refreshOpinion } from "./diplomacy";
import { advancedOf, ensureFg, pushJournal } from "./fullgame";
import type { EspionageOp } from "./fullgame";
import type { CommandResult, World } from "./types";

const PIRATE_EMPIRE_ID = 9;

/** Лимит: 1 операция за 50 тактов (GDD §12.5). */
export const ESPIONAGE_COOLDOWN = 50;
/** Разведка флота действует 20 тактов (GDD §12.5). */
export const INTEL_VISIBILITY_TICKS = 20;
/** Диверсия: −20% производства 20 тактов (GDD §12.5). */
export const SABOTAGE_TICKS = 20;
export const SABOTAGE_PENALTY_PERMILLE = 200;
/** Максимальный уровень разведки по цели. */
export const MAX_INTEL = 3;

export const ESPIONAGE_OP_ORDER: EspionageOp[] = [
  "fleet_recon", "steal_tech", "sabotage", "incite", "steal_map", "assassinate",
];

interface OpSpec {
  id: EspionageOp;
  ru: string;
  influence: number;
  base: number;
  /** штраф мнения при провале (GDD §12.5) */
  failOpinion: number;
  /** провал даёт CB против шпиона */
  grantsCb: boolean;
}

/** Данные GDD §12.5 (в @sf/data пока нет espionage.json — приоритет у данных). */
const FALLBACK_OPS: Record<EspionageOp, OpSpec> = {
  fleet_recon: { id: "fleet_recon", ru: "Разведка флота", influence: 5, base: 0.75, failOpinion: 10, grantsCb: false },
  steal_tech: { id: "steal_tech", ru: "Кража технологии", influence: 15, base: 0.35, failOpinion: 25, grantsCb: true },
  sabotage: { id: "sabotage", ru: "Диверсия", influence: 10, base: 0.4, failOpinion: 30, grantsCb: false },
  incite: { id: "incite", ru: "Подстрекательство", influence: 20, base: 0.3, failOpinion: 40, grantsCb: false },
  steal_map: { id: "steal_map", ru: "Кража карты", influence: 8, base: 0.7, failOpinion: 10, grantsCb: false },
  assassinate: { id: "assassinate", ru: "Убийство адмирала", influence: 25, base: 0.2, failOpinion: 40, grantsCb: true },
};

function opSpec(op: EspionageOp): OpSpec {
  const data = ESPIONAGE_OPS.find((def) => def.id === op);
  const fallback = FALLBACK_OPS[op];
  if (!data) return fallback;
  return {
    id: op,
    ru: data.ru ?? fallback.ru,
    influence: data.influenceCost ?? fallback.influence,
    base: data.baseChance ?? fallback.base,
    failOpinion: fallback.failOpinion,
    grantsCb: fallback.grantsCb,
  };
}

/** Шанс успеха: P = clamp(0.05, 0.95, base + 0.1×intel − 0.2×counter_intel) (GDD §12.5). */
export function espionageChance(world: World, empireId: number, targetId: number, op: EspionageOp): number {
  const spec = opSpec(op);
  const intel = advancedOf(world, empireId).intel[targetId] ?? 0;
  const counterIntel = advancedOf(world, targetId).intel[empireId] ?? 0;
  const chance = spec.base + 0.1 * intel - 0.2 * counterIntel;
  return clamp(Math.round(chance * 100) / 100, 0.05, 0.95);
}

function intelKey(empireId: number, targetId: number): string {
  return "intel:" + empireId + ":" + targetId;
}

function sabotageKey(targetId: number): string {
  return "sab:" + targetId;
}

function lastOpKey(empireId: number): string {
  return "esp:" + empireId + ":last";
}

function cbKey(victimId: number, spyId: number): string {
  return "cb:" + victimId + ":" + spyId;
}

function pickStealableTech(world: World, empireId: number, targetId: number): string | null {
  const target = empireById(world, targetId);
  const empire = empireById(world, empireId);
  if (!target || !empire) return null;
  const candidates = target.techs.completed
    .filter((techId) => !empire.techs.completed.includes(techId))
    .filter((techId) => {
      const def = TECH_BY_ID[techId];
      return def !== undefined && def.tier <= 3;
    })
    .sort((a, b) => a.localeCompare(b));
  return candidates[0] ?? null;
}

function applySuccess(world: World, empireId: number, targetId: number, op: EspionageOp): string {
  const fg = ensureFg(world);
  const advanced = advancedOf(world, empireId);
  advanced.intel[targetId] = Math.min(MAX_INTEL, (advanced.intel[targetId] ?? 0) + 1);
  switch (op) {
    case "fleet_recon": {
      world.flags[intelKey(empireId, targetId)] = world.tick + INTEL_VISIBILITY_TICKS;
      for (const fleet of world.fleets) {
        if (fleet.empireId !== targetId) continue;
        const system = world.systems[fleet.systemId];
        if (!system) continue;
        if (!system.knownBy.includes(empireId)) system.knownBy.push(empireId);
        system.knownBy.sort((a, b) => a - b);
      }
      return "флоты цели раскрыты на " + INTEL_VISIBILITY_TICKS + " тактов";
    }
    case "steal_tech": {
      const techId = pickStealableTech(world, empireId, targetId);
      const empire = empireById(world, empireId);
      if (!techId || !empire) return "технологий для кражи не нашлось";
      empire.techs.completed.push(techId);
      empire.techs.completed.sort((a, b) => a.localeCompare(b));
      empire.stats.techsResearched += 1;
      return "украдена технология " + (TECH_BY_ID[techId]?.ru ?? techId);
    }
    case "sabotage": {
      world.flags[sabotageKey(targetId)] = world.tick + SABOTAGE_TICKS;
      return "диверсия: производство цели −20% на " + SABOTAGE_TICKS + " тактов";
    }
    case "incite": {
      const target = empireById(world, targetId);
      if (target) {
        for (const colonyId of target.colonies) {
          const colony = world.colonies.find((c) => c.id === colonyId);
          if (!colony) continue;
          colony.stability = clamp(colony.stability - 15, 0, 100);
          colony.crime = clamp(colony.crime + 10, 0, 100);
        }
      }
      return "подстрекательство: −15 стабильности, +10 преступности";
    }
    case "steal_map": {
      const target = empireById(world, targetId);
      if (!target) return "карта не украдена";
      const revealed: number[] = [];
      const ownSystems = target.systems.slice().sort((a, b) => a - b);
      for (const systemId of ownSystems) {
        const system = world.systems[systemId];
        if (!system) continue;
        const candidates = [systemId, ...system.links.slice().sort((a, b) => a - b)];
        for (const candidate of candidates) {
          const targetSystem = world.systems[candidate];
          if (!targetSystem || targetSystem.knownBy.includes(empireId)) continue;
          targetSystem.knownBy.push(empireId);
          targetSystem.knownBy.sort((a, b) => a - b);
          revealed.push(candidate);
          if (revealed.length >= 5) break;
        }
        if (revealed.length >= 5) break;
      }
      return "раскрыто систем: " + revealed.length;
    }
    case "assassinate": {
      const fleets = world.fleets.filter((fleet) => fleet.empireId === targetId && fleet.ships.length > 0).sort((a, b) => a.id - b.id);
      let killed = 0;
      for (const fleet of fleets) {
        if (fleet.admiralName !== null) {
          fleet.admiralName = null;
          killed += 1;
        }
      }
      // если адмиралов не было — удар по командованию: сильнейший флот теряет управление
      if (killed === 0 && fleets.length > 0) {
        let strongest = fleets[0];
        let bestFp = -1;
        for (const fleet of fleets) {
          let fp = 0;
          for (const ship of fleet.ships) fp += ship.fleetPower;
          if (fp > bestFp) {
            bestFp = fp;
            strongest = fleet;
          }
        }
        strongest.path = [];
        strongest.pathIndex = 0;
        strongest.status = "idle";
        for (const ship of strongest.ships) ship.exp = Math.max(0, ship.exp - 5);
      }
      void fg;
      return "командование цели обезглавлено";
    }
    default:
      return "операция завершена";
  }
}

function applyFailure(world: World, empireId: number, targetId: number, op: EspionageOp): string {
  const spec = opSpec(op);
  addRecentAction(world, targetId, empireId, -spec.failOpinion);
  refreshOpinion(world, Math.min(empireId, targetId), Math.max(empireId, targetId));
  if (spec.grantsCb) {
    world.flags[cbKey(targetId, empireId)] = world.tick + 120;
    // убийство адмирала при провале — прямой повод к войне (GDD §12.5 «война»)
  }
  const target = empireById(world, targetId);
  return "провал: мнение " + (target?.name ?? targetId) + " " + -spec.failOpinion
    + (spec.grantsCb ? ", получен повод к войне (CB)" : "");
}

export function runEspionage(world: World, empireId: number, targetId: number, op: EspionageOp): CommandResult {
  const empire = empireById(world, empireId);
  const target = empireById(world, targetId);
  if (!empire || !target || empireId === targetId) return { ok: false, messageRu: "Некорректная цель" };
  if (empire.dead || target.dead) return { ok: false, messageRu: "Империя недоступна" };
  if (empireId === PIRATE_EMPIRE_ID) return { ok: false, messageRu: "Пираты не ведут шпионаж" };
  if (targetId === PIRATE_EMPIRE_ID) return { ok: false, messageRu: "Пиратские логова не шпионят" };
  const spec = opSpec(op);
  const dataOp = ESPIONAGE_OPS.find((def) => def.id === op);
  if (dataOp?.requiresTech && !empire.techs.completed.includes(dataOp.requiresTech)) {
    return { ok: false, messageRu: "Нужна технология «" + dataOp.requiresTech + "» для операции «" + spec.ru + "»" };
  }
  const last = world.flags[lastOpKey(empireId)];
  if (typeof last === "number" && world.tick - last < ESPIONAGE_COOLDOWN) {
    return { ok: false, messageRu: "Следующая операция доступна через " + (ESPIONAGE_COOLDOWN - (world.tick - last)) + " тактов" };
  }
  if (empire.resources.influence < spec.influence) {
    return { ok: false, messageRu: "Нужно " + spec.influence + " влияния для операции «" + spec.ru + "»" };
  }
  empire.resources.influence -= spec.influence;
  world.flags[lastOpKey(empireId)] = world.tick;
  advancedOf(world, empireId).espionageCooldown[op] = world.tick + ESPIONAGE_COOLDOWN;
  const chance = espionageChance(world, empireId, targetId, op);
  const opIndex = ESPIONAGE_OP_ORDER.indexOf(op);
  const roll = (hash32(world.seed, world.tick, empireId * 131 + targetId, opIndex) % 1000) / 1000;
  const success = roll < chance;
  const detailRu = success ? applySuccess(world, empireId, targetId, op) : applyFailure(world, empireId, targetId, op);
  const playerInvolved = empire.isPlayer || target.isPlayer;
  logEvent(
    world, "diplomacy", success ? "good" : "warn",
    "Шпионаж («" + spec.ru + "», " + empire.name + " → " + target.name + "): " + detailRu + ".",
    undefined, playerInvolved ? (empire.isPlayer ? empireId : targetId) : undefined,
  );
  if (empire.isPlayer || target.isPlayer) {
    pushJournal(ensureFg(world), world.tick, "espionage", "Шпионаж: " + spec.ru + " (" + (success ? "успех" : "провал") + ")");
  }
  return {
    ok: true,
    messageRu: (success ? "Успех: " : "Провал: ") + detailRu + " (шанс " + Math.round(chance * 100) + "%)",
  };
}

/** Видимость флотов по данным разведки (вызывается после фазы флотов — warPhase). */
export function applyIntelVisibility(world: World): void {
  const fg = ensureFg(world);
  for (const key of Object.keys(world.flags)) {
    if (!key.startsWith("intel:")) continue;
    const until = world.flags[key];
    if (typeof until !== "number" || until <= world.tick) {
      delete world.flags[key];
      continue;
    }
    const parts = key.split(":");
    const empireId = Number(parts[1]);
    const targetId = Number(parts[2]);
    if (!Number.isFinite(empireId) || !Number.isFinite(targetId)) continue;
    for (const fleet of world.fleets) {
      if (fleet.empireId !== targetId || fleet.ships.length === 0) continue;
      const system = world.systems[fleet.systemId];
      if (!system) continue;
      if (!system.visibleTo.includes(empireId)) system.visibleTo.push(empireId);
      if (!system.knownBy.includes(empireId)) system.knownBy.push(empireId);
    }
  }
  void fg;
}

/** Диверсия и кулдауны: экономический эффект −20% производства цели. */
export function espionagePhase(world: World): void {
  const fg = ensureFg(world);
  for (const key of Object.keys(world.flags)) {
    if (!key.startsWith("sab:")) continue;
    const targetId = Number(key.slice(4));
    const until = world.flags[key];
    if (typeof until !== "number" || until <= world.tick) {
      delete world.flags[key];
      continue;
    }
    const empire = empireById(world, targetId);
    if (!empire) continue;
    for (const res of ["energy", "minerals", "food", "alloys", "goods"] as const) {
      const income = empire.incomeLastTick[res];
      if (income <= 0) continue;
      const cut = Math.floor((income * SABOTAGE_PENALTY_PERMILLE) / 1000);
      if (cut <= 0) continue;
      empire.resources[res] = Math.max(0, empire.resources[res] - cut);
    }
  }
  // чистка просроченных кулдаунов
  for (const empire of world.empires) {
    const advanced = advancedOf(world, empire.id);
    for (const key of Object.keys(advanced.espionageCooldown)) {
      if ((advanced.espionageCooldown[key] ?? 0) <= world.tick) delete advanced.espionageCooldown[key];
    }
  }
  void fg;
}

/** Хук для economy: множитель производства при активной диверсии (−20%). */
export function sabotageProductionMult(world: World, empireId: number): number {
  const until = world.flags[sabotageKey(empireId)];
  return typeof until === "number" && until > world.tick ? 1 - SABOTAGE_PENALTY_PERMILLE / 1000 : 1;
}

/** Есть ли у империи-жертвы CB против шпиона (после провала операции). */
export function espionageCbUntil(world: World, victimId: number, spyId: number): number {
  return world.flags[cbKey(victimId, spyId)] ?? 0;
}

/** Доступные операции для UI (по влиянию). */
export function availableOps(world: World, empireId: number): EspionageOp[] {
  const empire = empireById(world, empireId);
  if (!empire) return [];
  return ESPIONAGE_OP_ORDER.filter((op) => empire.resources.influence >= opSpec(op).influence);
}

/** Уровень разведки империи по цели. */
export function intelLevel(world: World, empireId: number, targetId: number): number {
  return advancedOf(world, empireId).intel[targetId] ?? 0;
}

/** Название операции (данные/fallback). */
export function opNameRu(op: EspionageOp): string {
  return opSpec(op).ru;
}

/** Стоимость операции в влиянии. */
export function opInfluenceCost(op: EspionageOp): number {
  return opSpec(op).influence;
}
