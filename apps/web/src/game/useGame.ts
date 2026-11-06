import { useSyncExternalStore } from "react";
import type { Game } from "./Game";
import type { GameState } from "./types";

/** Подписка React на состояние игры. */
export function useGameState(game: Game): GameState {
  return useSyncExternalStore(
    (cb) => game.subscribe(cb),
    () => game.getState(),
  );
}
