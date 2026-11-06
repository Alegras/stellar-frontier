import type { Axial, BattleField, TerrainId } from "./types";
import { COLS, ROWS, allHexes, axialToOffset, hexKey, inNeutral, lineHexes, offsetToAxial } from "./hex";

export const TERRAIN: Record<TerrainId, { passable: boolean; moveCost: number; losBlock: boolean; cover: number; damagePct: number; rangePenalty: number }> = {
  empty: { passable: true, moveCost: 1, losBlock: false, cover: 0, damagePct: 0, rangePenalty: 0 },
  asteroid: { passable: false, moveCost: Infinity, losBlock: true, cover: 0, damagePct: 0, rangePenalty: 0 },
  nebula: { passable: true, moveCost: 2, losBlock: true, cover: 0.10, damagePct: 0, rangePenalty: 0 },
  mines: { passable: true, moveCost: 1, losBlock: false, cover: 0, damagePct: 0.08, rangePenalty: 0 },
  gravity: { passable: true, moveCost: 2, losBlock: false, cover: 0, damagePct: 0, rangePenalty: 1 },
  wreck: { passable: true, moveCost: 1, losBlock: false, cover: 0.15, damagePct: 0, rangePenalty: 0 },
  dust: { passable: true, moveCost: 1, losBlock: false, cover: 0.05, damagePct: 0, rangePenalty: 0 },
};

export function emptyField(profile = "open"): BattleField {
  const terrain: Record<string, TerrainId> = {};
  for (const hex of allHexes()) terrain[hexKey(hex)] = "empty";
  return { cols: COLS, rows: ROWS, terrain, obstacles: [], profile };
}

/** FNV-1a 32 для детерминированной генерации/бросков. */
export function hash32(...parts: Array<number | string>): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}
export function hash01(...parts: Array<number | string>): number {
  return hash32(...parts) / 4294967296;
}

const PROFILE_WEIGHTS: Record<string, Array<[TerrainId, number]>> = {
  open: [["asteroid", 40], ["nebula", 15], ["wreck", 25], ["mines", 10], ["gravity", 10]],
  asteroid_belt: [["asteroid", 65], ["wreck", 20], ["mines", 10], ["gravity", 5]],
  nebula: [["asteroid", 20], ["nebula", 45], ["wreck", 15], ["mines", 5], ["gravity", 15]],
  megastructure: [["asteroid", 30], ["nebula", 10], ["wreck", 45], ["mines", 5], ["gravity", 10]],
  defense: [["asteroid", 35], ["nebula", 10], ["wreck", 15], ["mines", 25], ["gravity", 15]],
  black_hole: [["asteroid", 25], ["nebula", 10], ["wreck", 10], ["mines", 5], ["gravity", 50]],
};

function pickTerrain(profile: string, roll: number): TerrainId {
  const weights = PROFILE_WEIGHTS[profile] ?? PROFILE_WEIGHTS.open!;
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  const target = (roll % 10000) / 10000 * total;
  for (const [id, w] of weights) {
    acc += w;
    if (target < acc) return id;
  }
  return "asteroid";
}

/** Симметричная генерация 5–8 уникальных препятствий (пара = зеркало 180°). */
export function generateField(seed: number, profile = "open", obstacleCount?: number): BattleField {
  const field = emptyField(profile);
  const unique = obstacleCount ?? (5 + Math.floor(hash01(seed, profile, "count") * 4));
  const placed: Axial[] = [];
  let guard = 0;
  while (placed.length < unique && guard < unique * 50) {
    guard++;
    const col = 3 + Math.floor(hash01(seed, profile, "col", placed.length, guard) * 9); // 3..11
    const row = Math.floor(hash01(seed, profile, "row", placed.length, guard) * ROWS);
    const a = offsetToAxial(col, row);
    if (!inNeutral(a)) continue;
    // минимум 2 гекса между препятствиями и их зеркалами
    const mirrorCol = 14 - col;
    const mirror = offsetToAxial(mirrorCol, ROWS - 1 - row);
    const candidates = [a, mirror];
    let ok = true;
    for (const existing of placed) {
      if (candidates.some((c) => hexDist(c, existing) < 2)) { ok = false; break; }
    }
    if (!ok) continue;
    const type = pickTerrain(profile, hash32(seed, profile, "type", placed.length, guard) % 10000);
    for (const cell of candidates) {
      field.terrain[hexKey(cell)] = type;
      field.obstacles.push({ q: cell.q, r: cell.r, type, mirrorOf: cell === a ? null : hexKey(a) });
    }
    placed.push(a);
  }
  return field;
}
function hexDist(a: Axial, b: Axial): number {
  const dq = a.q - b.q, dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function fieldFromObstacles(obstacles: Array<{ q: number; r: number; type: TerrainId }>, profile = "open"): BattleField {
  const field = emptyField(profile);
  for (const ob of obstacles) {
    if (!inNeutral(ob)) continue;
    field.terrain[hexKey(ob)] = ob.type;
    field.obstacles.push({ ...ob, mirrorOf: null });
  }
  return field;
}

export function isPassable(field: BattleField, a: Axial): boolean {
  return TERRAIN[field.terrain[hexKey(a)] ?? "empty"]?.passable ?? true;
}
export function moveCostAt(field: BattleField, a: Axial): number {
  return TERRAIN[field.terrain[hexKey(a)] ?? "empty"]?.moveCost ?? 1;
}
export function hasLos(field: BattleField, a: Axial, b: Axial): boolean {
  const cells = lineHexes(a, b);
  for (let i = 1; i < cells.length - 1; i++) {
    if (TERRAIN[field.terrain[hexKey(cells[i]!)] ?? "empty"].losBlock) return false;
  }
  return true;
}
export function coverAt(field: BattleField, a: Axial): number {
  return TERRAIN[field.terrain[hexKey(a)] ?? "empty"]?.cover ?? 0;
}
export function rangePenaltyAt(field: BattleField, a: Axial): number {
  return TERRAIN[field.terrain[hexKey(a)] ?? "empty"]?.rangePenalty ?? 0;
}
export function validateField(field: BattleField): string[] {
  const errors: string[] = [];
  if (field.cols !== COLS || field.rows !== ROWS) errors.push("field must be 15x11");
  for (const ob of field.obstacles) {
    const cell = { q: ob.q, r: ob.r };
    if (!inNeutral(cell)) errors.push("obstacle outside neutral zone");
    if (!isPassable(field, cell) && field.terrain[hexKey(cell)] === undefined) errors.push("bad obstacle");
  }
  return errors;
}
void axialToOffset;
