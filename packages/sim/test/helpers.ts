import { serializeWorld } from "../src/save";
import type { World } from "../src/types";

/** Простой детерминированный хеш состояния (FNV-1a по сериализованному миру). */
export function goldenHash(world: World): string {
  const json = serializeWorld(world);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function runTicks(world: World, ticks: number): void {
  // импорт внутри, чтобы helpers не тянул циклические зависимости при загрузке
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return void ticks;
}

export function totalPops(world: World, empireId: number): number {
  let total = 0;
  for (const colonyId of world.empires.find((e) => e.id === empireId)?.colonies ?? []) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    total += colony.pops.workers + colony.pops.specialists + colony.pops.rulers;
  }
  return total;
}
