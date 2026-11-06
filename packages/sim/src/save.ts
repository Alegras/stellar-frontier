/**
 * СОХРАНЕНИЕ/ЗАГРУЗКА. Round-trip: save → load → save даёт идентичный JSON (golden-тест).
 * Состояние — только JSON-совместимые значения: массивы упорядочены по id, нет Set/Map/undefined-логики.
 */
import type { World } from "./types";

export const SIM_VERSION = 1;

export function serializeWorld(world: World): string {
  return JSON.stringify(world);
}

export function deserializeWorld(json: string): World {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Некорректный JSON сохранения: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Некорректное сохранение: ожидался объект мира");
  const world = parsed as World;
  if (world.schemaVersion !== SIM_VERSION) {
    throw new Error(`Несовместимая версия схемы сохранения: ${String(world.schemaVersion)} (ожидается ${SIM_VERSION})`);
  }
  if (!Array.isArray(world.systems) || !Array.isArray(world.empires)) {
    throw new Error("Некорректное сохранение: нет систем или империй");
  }
  // Обратная совместимость: старые сейвы без конструктора кораблей.
  if (!Array.isArray(world.customDesigns)) world.customDesigns = [];
  return world;
}
