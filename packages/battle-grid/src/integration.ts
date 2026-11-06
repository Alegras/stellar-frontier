import type { BattleState, SideInput } from "./types";
import type { Fleet, World } from "@sf/sim";
import { createBattle } from "./engine";
import { applyBattleRecord } from "@sf/sim";
import { toBattleRecord } from "./conversion";
import { aiDeploy, runAiBattle } from "./ai";
import { fieldFromObstacles } from "./field";
import { offsetToAxial } from "./hex";

export type GridBattleEligibility = { eligible: boolean; reason?: string };

/** Сетка только на L0 и только при флаге grid_battle (по умолчанию on). */
export function isGridBattleEnabled(world: World): boolean {
  return (world.flags["grid_battle"] ?? 1) !== 0;
}
export function battleEligibility(world: World, attackerFleetId: number, defenderFleetId: number): GridBattleEligibility {
  if (!isGridBattleEnabled(world)) return { eligible: false, reason: "GRID_BATTLE_DISABLED" };
  const a = world.fleets.find((f) => f.id === attackerFleetId);
  const b = world.fleets.find((f) => f.id === defenderFleetId);
  if (!a || !b) return { eligible: false, reason: "FLEET_NOT_FOUND" };
  if (a.systemId !== b.systemId) return { eligible: false, reason: "DIFFERENT_SYSTEMS" };
  const fp = (f: Fleet) => f.ships.reduce((sum, s) => sum + (s.fleetPower ?? 0), 0);
  if (fp(a) < 20 || fp(b) < 20) return { eligible: false, reason: "FP_BELOW_THRESHOLD" };
  const stacks = (f: Fleet) => new Set(f.ships.map((s) => s.classId)).size;
  if (stacks(a) < 2 || stacks(b) < 2) return { eligible: false, reason: "NOT_ENOUGH_STACKS" };
  return { eligible: true };
}
function sideInputFromFleet(fleet: Fleet): SideInput {
  const byClass = new Map<string, number>();
  for (const ship of fleet.ships) {
    const classId = ship.classId === "battleship" || ship.classId === "titan" || ship.classId === "carrier" || ship.classId === "colossus"
      ? ship.classId : ship.classId === "cruiser" ? "cruiser" : ship.classId === "destroyer" ? "destroyer" : ship.classId === "frigate" ? "frigate" : "corvette";
    byClass.set(classId, (byClass.get(classId) ?? 0) + 1);
  }
  const stacks = [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([classId, count]) => ({ classId, count }));
  return { empireId: fleet.empireId, fleetId: fleet.id, stacks, morale: 0, luck: 0 };
}
export function createBattleFromWorld(world: World, attackerFleetId: number, defenderFleetId: number, options: { seed?: number; terrainProfile?: string } = {}): BattleState {
  const eligibility = battleEligibility(world, attackerFleetId, defenderFleetId);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  const attacker = world.fleets.find((f) => f.id === attackerFleetId)!;
  const defender = world.fleets.find((f) => f.id === defenderFleetId)!;
  const seed = options.seed ?? (world.seed ^ (world.tick * 2654435761) ^ attackerFleetId ^ (defenderFleetId << 8)) >>> 0;
  return createBattle({
    seed,
    battleId: "btl_" + String(seed) + "_" + String(world.tick),
    attacker: sideInputFromFleet(attacker),
    defender: sideInputFromFleet(defender),
    terrainProfile: options.terrainProfile ?? "open",
  });
}
export interface BattleTriggeredEvent {
  type: "battle:triggered";
  battleId: string;
  seed: number;
  layer: "L0";
  attackerFleetId: number;
  defenderFleetId: number;
  worldTick: number;
  state: BattleState;
}
/** Хук для UI: событие столкновения на L0. Сетка НЕ трогает 6DOF/системные бои. */
export function createBattleTriggered(world: World, attackerFleetId: number, defenderFleetId: number): BattleTriggeredEvent | null {
  if (!battleEligibility(world, attackerFleetId, defenderFleetId).eligible) return null;
  const state = createBattleFromWorld(world, attackerFleetId, defenderFleetId);
  return { type: "battle:triggered", battleId: state.battleId, seed: state.seed, layer: "L0", attackerFleetId, defenderFleetId, worldTick: world.tick, state };
}
export function autoPlayBattle(state: BattleState, options: { difficultyA?: "easy" | "normal" | "hard"; difficultyB?: "easy" | "normal" | "hard" } = {}): BattleState {
  return runAiBattle(state, { difficulty: options.difficultyA ?? "normal", profileId: "aggressor" }, { difficulty: options.difficultyB ?? "normal", profileId: "defender" });
}
