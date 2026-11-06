import { applyBattleCommand as engineApply } from "./engine";
import { aiTakeTurn } from "./ai";
import type { BattleCommand, BattleState } from "./types";
export * from "./types";
export * from "./hex";
export * from "./field";
export * from "./catalog";
export * from "./engine";
export * from "./ai";
export * from "./conversion";
export * from "./integration";
export { engineApply as applyBattleCommand };
/** UI-обёртка: auto обрабатывается ИИ; остальные команды — движком. */
export function applyCommand(state: BattleState, cmd: BattleCommand, options?: { difficulty?: "easy" | "normal" | "hard"; profileId?: string }): { state: BattleState; events: Array<Record<string, unknown>>; ok: boolean; reason?: string } {
  if (cmd.type === "auto") return aiTakeTurn(state, options ?? {});
  return engineApply(state, cmd);
}
