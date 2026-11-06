import type { BattleResult, BattleState } from "./types";
import { hash32 } from "./field";
import { classById } from "./catalog";

export interface AutoResolveReference {
  outcome: "attacker_win" | "defender_win" | "draw";
  lossA: number;
  lossB: number;
}

/** Та же модель потерь, что packages/sim autoResolve (FP ratio + детерминированная дисперсия). */
export function autoResolveReference(fpA: number, fpB: number, seed: number, tick = 0, idA = 1, idB = 2): AutoResolveReference {
  const a = fpA * 1000, b = fpB * 1000;
  const ratio = a / Math.max(1, b);
  let outcome: AutoResolveReference["outcome"];
  if (ratio > 1.08) outcome = "attacker_win";
  else if (ratio < 0.92) outcome = "defender_win";
  else outcome = "draw";
  const clampLoss = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  let att = 0, def = 0;
  if (outcome === "attacker_win") {
    att = clampLoss(550 * Math.pow(1 / ratio, 1.5));
    def = clampLoss(950 - 450 * (1 / ratio));
  } else if (outcome === "defender_win") {
    att = clampLoss(950 - 450 * ratio);
    def = clampLoss(550 * Math.pow(ratio, 1.5));
  } else {
    att = 300; def = 300;
  }
  const lo = Math.min(idA, idB), hi = Math.max(idA, idB);
  const h = hash32(seed, tick, lo, hi);
  const variance = -0.10 + 0.20 * (h / 4294967296);
  return {
    outcome,
    lossA: Math.max(0, Math.min(1000, Math.round(att * (1 + variance)))) / 1000,
    lossB: Math.max(0, Math.min(1000, Math.round(def * (1 + variance)))) / 1000,
  };
}

export function parityCheck(result: BattleResult, reference: AutoResolveReference, tolerance = 0.10): {
  deltaA: number; deltaB: number; withinTolerance: boolean; outcomeMatch: boolean;
} {
  const deltaA = Math.abs(result.losses.A.damageFraction - reference.lossA);
  const deltaB = Math.abs(result.losses.B.damageFraction - reference.lossB);
  const gridOutcome = result.outcome === "victory_a" ? "attacker_win" : result.outcome === "victory_b" ? "defender_win" : "draw";
  return { deltaA, deltaB, withinTolerance: deltaA <= tolerance && deltaB <= tolerance, outcomeMatch: gridOutcome === reference.outcome };
}

/** Конвертер сетки → BattleRecord @sf/sim (для apply_battle/лог/статистики). */
export function toBattleRecord(result: BattleResult, ids: { attackerFleetId: number; defenderFleetId: number; attackerEmpireId: number; defenderEmpireId: number; tick: number; systemId: number }) {
  return {
    id: result.battleId,
    tick: ids.tick,
    systemId: ids.systemId,
    attacker: { empireId: ids.attackerEmpireId, fleetId: ids.attackerFleetId, fp: result.losses.A.fpStart, shipsBefore: result.losses.A.fpStart },
    defender: { empireId: ids.defenderEmpireId, fleetId: ids.defenderFleetId, fp: result.losses.B.fpStart, shipsBefore: result.losses.B.fpStart },
    outcome: result.outcome === "victory_a" ? "attacker_win" : result.outcome === "victory_b" ? "defender_win" : "draw",
    attackerLossFp: result.losses.A.fpLost,
    defenderLossFp: result.losses.B.fpLost,
    attackerShipsLost: result.losses.A.shipsDestroyed,
    defenderShipsLost: result.losses.B.shipsDestroyed,
    durationSec: result.rounds * 8,
    spoilsAlloys: result.spoils.alloys,
    spoilsCredits: result.spoils.alloys * 12,
    tactical: false,
  };
}

/** Проверка целостности конверсии: FP до/после/потери и корабли. */
export function validateConversion(state: BattleState, result: BattleResult): string[] {
  const errors: string[] = [];
  for (const side of ["A", "B"] as const) {
    const loss = result.losses[side];
    if (loss.fpStart - loss.fpAfter !== loss.fpLost) errors.push("fp mismatch " + side);
    if (loss.lossFraction < 0 || loss.lossFraction > 1) errors.push("loss fraction out of range " + side);
  }
  if (result.outcome !== "draw" && result.winner === null) errors.push("winner missing");
  if (result.outcome === "draw" && result.winner !== null) errors.push("draw with winner");
  return errors;
}
void classById;


export interface CompositionStack { classId: string; count: number }
/** Дискретная модель autoResolve: бюджет FP снимает целые корабли (малые первыми). */
export function autoResolveDiscreteReference(
  fpA: number, fpB: number, compA: CompositionStack[], compB: CompositionStack[], seed: number, tick = 0,
): AutoResolveReference {
  const base = autoResolveReference(fpA, fpB, seed, tick);
  const order = ["corvette", "frigate", "destroyer", "cruiser", "carrier", "battleship", "titan", "colossus"];
  const lossDiscrete = (fpStart: number, composition: CompositionStack[], fraction: number): number => {
    const budget = fraction * fpStart;
    const ships: Array<{ classId: string; fp: number; rank: number }> = [];
    for (const stack of composition) {
      const cls = classById(stack.classId);
      if (!cls) continue;
      for (let i = 0; i < stack.count; i++) ships.push({ classId: stack.classId, fp: cls.fp, rank: order.indexOf(stack.classId) });
    }
    ships.sort((a, b) => a.rank - b.rank || a.classId.localeCompare(b.classId));
    let remaining = budget, lost = 0;
    for (const ship of ships) {
      if (remaining <= 0) break;
      lost += ship.fp;
      remaining -= ship.fp;
    }
    return fpStart > 0 ? lost / fpStart : 0;
  };
  return {
    outcome: base.outcome,
    lossA: lossDiscrete(fpA, compA, base.lossA),
    lossB: lossDiscrete(fpB, compB, base.lossB),
  };
}
