import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/queries";
import type { World } from "../src/types";

/** Мир seed 42 с проинициализированным FullGameState (fg создаётся в createWorld). */
export function worldWithFg(seed = 42): World {
  return createWorld(seed, MODE, BALANCE);
}

/** Найти колонию игрока. */
export function playerColony(world: World, index = 0) {
  const player = world.empires.find((e) => e.isPlayer)!;
  return world.colonies.find((c) => c.id === player.colonies[index]);
}
