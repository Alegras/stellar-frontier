/**
 * БОЙ И АВТОРЕЗОЛВ (M4/M5, GDD §10–§11.6).
 * Формула: FP сторон → ratio r → T=clamp(60,480,90+120·|ln r|), победитель при |r−1|>0.08,
 * потери проигравшего clamp(0.25,0.95,0.95−0.45·r_l), победителя clamp(0.02,0.55,0.55·r_l^1.5),
 * детерминированная дисперсия ±10% через hash32(seed,tick,ids), гибнут малые корабли,
 * трофеи 0.15 стоимости сплавов уничтоженных, опыт, военный счёт, лог.
 * Тот же отчёт применяется для живого боя через applyBattleRecord (команда apply_battle).
 */
import { BUILDING_BY_ID, DESIGN_BY_ID, RESOURCE_BY_ID } from "@sf/data";
import { onContractBounty } from "./contracts";
import { hash32 } from "./prng";
import {
  SHIP_CLASS_RANK, clamp, empireById, fleetSpeed, logEvent, removeFleet, shipSpeed,
} from "./economy";
import { getFleetPower } from "./queries";
import type { BattleRecord, BattleSide, Fleet, Ship, World } from "./types";

const PIRATE_EMPIRE_ID = 9;

function fleetById(world: World, fleetId: number): Fleet | undefined {
  for (const fleet of world.fleets) if (fleet.id === fleetId) return fleet;
  return undefined;
}

function empireAtWarWith(world: World, aId: number, bId: number): boolean {
  if (aId === bId) return false;
  if (aId === PIRATE_EMPIRE_ID || bId === PIRATE_EMPIRE_ID) return true;
  const a = empireById(world, aId);
  if (!a) return false;
  const rel = a.relations[bId];
  return rel !== undefined && rel.treaty === "war";
}

/** Враждебность флотов (пираты враждебны всем, остальные — по договору «война»). */
export function areFleetsHostile(world: World, a: Fleet, b: Fleet): boolean {
  return empireAtWarWith(world, a.empireId, b.empireId);
}

function sideOf(fleet: Fleet): BattleSide {
  return {
    empireId: fleet.empireId,
    fleetId: fleet.id,
    fp: getFleetPower(fleet),
    shipsBefore: fleet.ships.length,
  };
}

function rankOf(ship: Ship): number {
  const rank = SHIP_CLASS_RANK[ship.classId];
  return typeof rank === "number" && rank > 0 ? rank : 1;
}

/** Вес корабля для распределения потерь: малые гибнут первыми (GDD §11.6 шаг 8). */
function lossWeight(ship: Ship): number {
  const rank = rankOf(ship);
  const damage = ship.damageTaken ?? 0;
  return Math.floor((1000000 * (100 + damage)) / (rank * 100));
}

interface LossResult {
  lostFp: number;
  lostShips: number;
  destroyed: Ship[];
  scavengeAlloys: number;
}

function applyLosses(world: World, fleet: Fleet, budgetFp: number): LossResult {
  void world;
  let remaining = Math.max(0, budgetFp);
  const destroyed: Ship[] = [];
  let lostFp = 0;
  if (remaining > 0) {
    // Флагман не погибает в авторезолве: канон §10.10 «смерть не game over» (капсула/спасение).
    const order = fleet.ships.filter((ship) => !ship.isFlagship).sort((a, b) => {
      const wa = lossWeight(a);
      const wb = lossWeight(b);
      if (wa !== wb) return wb - wa;
      return a.id - b.id;
    });
    const gone: Record<number, boolean> = {};
    for (const ship of order) {
      if (remaining <= 0) break;
      destroyed.push(ship);
      gone[ship.id] = true;
      lostFp += ship.fleetPower;
      remaining -= ship.fleetPower;
    }
    fleet.ships = fleet.ships.filter((ship) => !gone[ship.id]);
  }
  let scavengeAlloys = 0;
  for (const ship of destroyed) {
    const design = DESIGN_BY_ID[ship.designId];
    if (design) scavengeAlloys += design.costAlloys;
  }
  return { lostFp, lostShips: destroyed.length, destroyed, scavengeAlloys };
}

function addSpoils(world: World, empireId: number, alloys: number, credits: number): void {
  const empire = empireById(world, empireId);
  if (!empire) return;
  if (alloys > 0) empire.resources.alloys += alloys;
  if (credits > 0) {
    empire.resources.credits += credits;
    empire.stats.creditsEarned += credits;
  }
}

function addWarScore(world: World, winnerId: number, loserId: number, destroyedFp: number, enemyFp: number): void {
  if (winnerId <= 0 || loserId <= 0 || winnerId === loserId) return;
  if (winnerId === PIRATE_EMPIRE_ID || loserId === PIRATE_EMPIRE_ID) return;
  const delta = Math.floor((6 * destroyedFp * 1000) / Math.max(1, enemyFp));
  const key = `warscore:${winnerId}:${loserId}`;
  world.flags[key] = (world.flags[key] ?? 0) + delta;
}

function awardExperience(fleet: Fleet, destroyedFp: number): void {
  const exp = Math.floor(destroyedFp / 10);
  if (exp <= 0) return;
  for (const ship of fleet.ships) ship.exp += exp;
}

function cleanupFleet(world: World, fleet: Fleet): void {
  if (fleet.ships.length === 0) removeFleet(world, fleet.id);
}

/** Если от флота остался только флагман — капсула: hull=1, возврат в столицу (GDD §10.10). */
function preserveFlagship(world: World, fleet: Fleet): void {
  const flagship = fleet.ships.find((ship) => ship.isFlagship);
  if (!flagship) return;
  if (fleet.ships.length > 1) return;
  flagship.hull = 1;
  flagship.armor = 0;
  flagship.shield = 0;
  fleet.status = "idle";
  fleet.path = [];
  fleet.pathIndex = 0;
  const empire = empireById(world, fleet.empireId);
  if (empire) fleet.systemId = empire.capitalSystemId;
  logEvent(world, "fleet", "warn", "Флагман спасён в капсуле и возвращён в столицу.", fleet.systemId, fleet.empireId);
}

function pushBattle(world: World, record: BattleRecord): void {
  if (!world.battles.some((b) => b.id === record.id)) world.battles.push(record);
  if (world.battles.length > 200) world.battles.splice(0, world.battles.length - 200);
}

function fleetLabel(world: World, empireId: number): string {
  if (empireId === PIRATE_EMPIRE_ID) return "Пираты Пустоты";
  const empire = empireById(world, empireId);
  return empire ? empire.name : "неизвестные";
}

function logBattle(world: World, record: BattleRecord, attackerName: string, defenderName: string): void {
  const outcomeRu = record.outcome === "attacker_win" ? `победа ${attackerName}`
    : record.outcome === "defender_win" ? `победа ${defenderName}` : "ничья";
  const systemName = world.systems[record.systemId]?.name ?? "неизвестная система";
  const playerId = world.playerEmpireId;
  const playerInvolved = record.attacker.empireId === playerId || record.defender.empireId === playerId;
  let lossesRu: string;
  if (playerInvolved) {
    const ours = record.attacker.empireId === playerId ? record.attackerShipsLost : record.defenderShipsLost;
    const theirs = record.attacker.empireId === playerId ? record.defenderShipsLost : record.attackerShipsLost;
    const oursFp = record.attacker.empireId === playerId ? record.attackerLossFp : record.defenderLossFp;
    const theirsFp = record.attacker.empireId === playerId ? record.defenderLossFp : record.attackerLossFp;
    lossesRu = `наши потери: ${ours} кор. (${oursFp} FP), потери врага: ${theirs} кор. (${theirsFp} FP)`;
  } else {
    lossesRu = `${attackerName}: ${record.attackerShipsLost} кор., ${defenderName}: ${record.defenderShipsLost} кор.`;
  }
  logEvent(
    world,
    "combat",
    "warn",
    `Бой в системе «${systemName}»: ${attackerName} против ${defenderName} — ${outcomeRu}. ${lossesRu}.`,
    record.systemId,
    playerInvolved ? playerId : record.attacker.empireId,
  );
}

/** Авторезолв по GDD §11.6: мутирует флоты и возвращает отчёт боя. */
export function autoResolve(world: World, attackerFleetId: number, defenderFleetId: number): BattleRecord {
  const attacker = fleetById(world, attackerFleetId);
  const defender = fleetById(world, defenderFleetId);
  const tick = world.tick;
  if (!attacker || !defender || attacker.ships.length === 0 || defender.ships.length === 0) {
    return {
      id: `btl_${world.seed}_${tick}_${Math.min(attackerFleetId, defenderFleetId)}_${Math.max(attackerFleetId, defenderFleetId)}`,
      tick,
      systemId: attacker ? attacker.systemId : defender ? defender.systemId : 0,
      attacker: attacker ? sideOf(attacker) : { empireId: 0, fleetId: attackerFleetId, fp: 0, shipsBefore: 0 },
      defender: defender ? sideOf(defender) : { empireId: 0, fleetId: defenderFleetId, fp: 0, shipsBefore: 0 },
      outcome: "draw",
      attackerLossFp: 0,
      defenderLossFp: 0,
      attackerShipsLost: 0,
      defenderShipsLost: 0,
      durationSec: 0,
      spoilsAlloys: 0,
      spoilsCredits: 0,
      tactical: false,
    };
  }

  const systemId = attacker.systemId;
  const system = world.systems[systemId];
  const attackerSide = sideOf(attacker);
  const defenderSide = sideOf(defender);

  // ШАГ 1–2: FP сторон + бонус обороны системы/станции
  let defenderBonus = 1000;
  if (system && system.station) defenderBonus += 150;
  if (system) {
    for (const colony of world.colonies) {
      if (colony.systemId !== system.id || colony.empireId !== defender.empireId) continue;
      for (const buildingId of colony.buildings) {
        const def = BUILDING_BY_ID[buildingId];
        if (def && def.effects && (def.effects.planet_defense ?? 0) > 0) defenderBonus += 100;
      }
    }
  }
  const fpA = attackerSide.fp * 1000;
  const fpB = defenderSide.fp * defenderBonus;
  if (fpA <= 0 || fpB <= 0) {
    return {
      id: `btl_${world.seed}_${tick}_${Math.min(attacker.id, defender.id)}_${Math.max(attacker.id, defender.id)}`,
      tick,
      systemId,
      attacker: attackerSide,
      defender: defenderSide,
      outcome: "draw",
      attackerLossFp: 0,
      defenderLossFp: 0,
      attackerShipsLost: 0,
      defenderShipsLost: 0,
      durationSec: 0,
      spoilsAlloys: 0,
      spoilsCredits: 0,
      tactical: false,
    };
  }

  // ШАГ 3: ratio и длительность
  const ratio = fpA / fpB;
  const durationSec = Math.round(clamp(90 + 120 * Math.abs(Math.log(ratio)), 60, 480));

  // ШАГ 5: победитель
  let outcome: BattleRecord["outcome"];
  if (ratio > 1.08) outcome = "attacker_win";
  else if (ratio < 0.92) outcome = "defender_win";
  else outcome = "draw";

  // ШАГ 6: базовые доли потерь (в тысячных)
  let attackerLossMilli = 0;
  let defenderLossMilli = 0;
  if (outcome === "attacker_win") {
    attackerLossMilli = clampMul(
      clamp(550 * Math.pow(1 / ratio, 1.5), 20, 550),
    );
    defenderLossMilli = clampMul(clamp(950 - 450 * (1 / ratio), 250, 950));
  } else if (outcome === "defender_win") {
    attackerLossMilli = clampMul(clamp(950 - 450 * ratio, 250, 950));
    defenderLossMilli = clampMul(clamp(550 * Math.pow(ratio, 1.5), 20, 550));
  } else {
    attackerLossMilli = 300;
    defenderLossMilli = 300;
  }

  // ШАГ 7: детерминированная дисперсия ±10%
  const lo = Math.min(attacker.id, defender.id);
  const hi = Math.max(attacker.id, defender.id);
  const h = hash32(world.seed, world.tick, lo, hi);
  const variance = -0.10 + 0.20 * (h / 4294967296);
  const attLossPermille = clamp(Math.round(attackerLossMilli * (1 + variance)), 0, 1000);
  const defLossPermille = clamp(Math.round(defenderLossMilli * (1 + variance)), 0, 1000);

  // ШАГ 9: отступление быстрого проигравшего — до 40% бюджета потерь спасено
  const attackerSpeed = fleetSpeed(attacker);
  const defenderSpeed = fleetSpeed(defender);
  const massLockedBy = (side: Fleet, other: Fleet): boolean => {
    for (const ship of other.ships) if (rankOf(ship) >= 4) return true;
    return false;
  };
  let attBudget = Math.round((attackerSide.fp * attLossPermille) / 1000);
  let defBudget = Math.round((defenderSide.fp * defLossPermille) / 1000);
  if (outcome === "attacker_win" && defBudget > 0 && defenderSpeed >= attackerSpeed * 1.25 && !massLockedBy(defender, attacker)) {
    defBudget = Math.round(defBudget * 0.6);
  }
  if (outcome === "defender_win" && attBudget > 0 && attackerSpeed >= defenderSpeed * 1.25 && !massLockedBy(attacker, defender)) {
    attBudget = Math.round(attBudget * 0.6);
  }

  // ШАГ 8: распределение потерь по кораблям
  const attLoss = applyLosses(world, attacker, attBudget);
  const defLoss = applyLosses(world, defender, defBudget);

  // ШАГ 10: трофеи, опыт, военный счёт, статистика
  let spoilsAlloys = 0;
  if (outcome === "attacker_win") spoilsAlloys = Math.floor(defLoss.scavengeAlloys * 0.15);
  if (outcome === "defender_win") spoilsAlloys = Math.floor(attLoss.scavengeAlloys * 0.15);
  const spoilsCredits = spoilsAlloys * Math.round(RESOURCE_BY_ID.alloys.retail);

  const winner = outcome === "attacker_win" ? attacker : outcome === "defender_win" ? defender : null;
  const loser = outcome === "attacker_win" ? defender : outcome === "defender_win" ? attacker : null;
  if (winner && loser) {
    addSpoils(world, winner.empireId, spoilsAlloys, spoilsCredits);
    const winnerEmpire = empireById(world, winner.empireId);
    if (winnerEmpire) winnerEmpire.stats.battlesWon += 1;
    const loserEmpire = empireById(world, loser.empireId);
    if (loserEmpire) loserEmpire.stats.battlesLost += 1;
    const lostByLoser = winner === attacker ? defLoss.lostFp : attLoss.lostFp;
    awardExperience(winner, lostByLoser);
    addWarScore(world, winner.empireId, loser.empireId, lostByLoser, outcome === "attacker_win" ? defenderSide.fp : attackerSide.fp);
  }
  for (const empireId of [attacker.empireId, defender.empireId]) {
    const empire = empireById(world, empireId);
    if (empire) empire.stats.shipsLost += empireId === attacker.empireId ? attLoss.lostShips : defLoss.lostShips;
  }

  preserveFlagship(world, attacker);
  preserveFlagship(world, defender);
  const record: BattleRecord = {
    id: `btl_${world.seed}_${tick}_${lo}_${hi}`,
    tick,
    systemId,
    attacker: attackerSide,
    defender: defenderSide,
    outcome,
    attackerLossFp: attLoss.lostFp,
    defenderLossFp: defLoss.lostFp,
    attackerShipsLost: attLoss.lostShips,
    defenderShipsLost: defLoss.lostShips,
    durationSec,
    spoilsAlloys,
    spoilsCredits,
    tactical: false,
  };
  pushBattle(world, record);
  logBattle(world, record, fleetLabel(world, attacker.empireId), fleetLabel(world, defender.empireId));
  cleanupFleet(world, attacker);
  cleanupFleet(world, defender);
  return record;
}

function clampMul(value: number): number {
  return clamp(Math.round(value), 0, 1000);
}

/** Применение отчёта живого боя (L2): те же потери, трофеи, опыт и лог, что у авторезолва. */
export function applyBattleRecord(world: World, report: BattleRecord): void {
  const attacker = fleetById(world, report.attacker.fleetId);
  const defender = fleetById(world, report.defender.fleetId);
  const tick = world.tick;

  const attBudget = Math.max(0, report.attackerLossFp);
  const defBudget = Math.max(0, report.defenderLossFp);
  const attLoss = attacker ? applyLosses(world, attacker, attBudget) : { lostFp: 0, lostShips: 0, destroyed: [], scavengeAlloys: 0 };
  const defLoss = defender ? applyLosses(world, defender, defBudget) : { lostFp: 0, lostShips: 0, destroyed: [], scavengeAlloys: 0 };

  let spoilsAlloys = report.spoilsAlloys;
  let spoilsCredits = report.spoilsCredits;
  if (spoilsAlloys <= 0) {
    if (report.outcome === "attacker_win") spoilsAlloys = Math.floor(defLoss.scavengeAlloys * 0.15);
    if (report.outcome === "defender_win") spoilsAlloys = Math.floor(attLoss.scavengeAlloys * 0.15);
    spoilsCredits = spoilsAlloys * Math.round(RESOURCE_BY_ID.alloys.retail);
  }
  const winnerId = report.outcome === "attacker_win" ? report.attacker.empireId
    : report.outcome === "defender_win" ? report.defender.empireId : 0;
  const loserId = winnerId === report.attacker.empireId ? report.defender.empireId
    : winnerId === report.defender.empireId ? report.attacker.empireId : 0;
  if (winnerId > 0) {
    addSpoils(world, winnerId, spoilsAlloys, spoilsCredits);
    try {
      onContractBounty(world, winnerId, report.systemId, winnerId === report.attacker.empireId ? defLoss.lostFp : attLoss.lostFp);
    } catch {
      /* noop */
    }
    const winnerEmpire = empireById(world, winnerId);
    if (winnerEmpire) winnerEmpire.stats.battlesWon += 1;
    const winnerFleet = winnerId === report.attacker.empireId ? attacker : defender;
    if (winnerFleet) awardExperience(winnerFleet, winnerId === report.attacker.empireId ? defLoss.lostFp : attLoss.lostFp);
    addWarScore(world, winnerId, loserId, winnerId === report.attacker.empireId ? defLoss.lostFp : attLoss.lostFp,
      winnerId === report.attacker.empireId ? report.defender.fp : report.attacker.fp);
  }
  if (loserId > 0) {
    const loserEmpire = empireById(world, loserId);
    if (loserEmpire) loserEmpire.stats.battlesLost += 1;
  }
  for (const empireId of [report.attacker.empireId, report.defender.empireId]) {
    const empire = empireById(world, empireId);
    if (empire) empire.stats.shipsLost += empireId === report.attacker.empireId ? attLoss.lostShips : defLoss.lostShips;
  }

  const applied: BattleRecord = {
    ...report,
    tick: report.tick >= 0 ? report.tick : tick,
    attackerLossFp: attLoss.lostFp,
    defenderLossFp: defLoss.lostFp,
    attackerShipsLost: attLoss.lostShips,
    defenderShipsLost: defLoss.lostShips,
    spoilsAlloys,
    spoilsCredits,
    tactical: true,
  };
  pushBattle(world, applied);
  logEvent(
    world,
    "combat",
    "warn",
    `Тактический бой завершён: ${fleetLabel(world, report.attacker.empireId)} против ${fleetLabel(world, report.defender.empireId)}. Потери: ${applied.attackerShipsLost}/${applied.defenderShipsLost}.`,
    report.systemId,
    report.attacker.empireId,
  );
  if (attacker) { preserveFlagship(world, attacker); cleanupFleet(world, attacker); }
  if (defender) { preserveFlagship(world, defender); cleanupFleet(world, defender); }
}

export { shipSpeed };