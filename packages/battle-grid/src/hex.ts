import type { Axial, BattleField, TerrainId } from "./types";

export const COLS = 15;
export const ROWS = 11;
export const NEUTRAL_COLS: readonly [number, number] = [3, 11];
export const ZONE_A_COLS: readonly [number, number] = [0, 2];
export const ZONE_B_COLS: readonly [number, number] = [12, 14];

export const AXIAL_DIRS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function axialToOffset(a: Axial): { col: number; row: number } {
  return { col: a.q + ((a.r - (a.r & 1)) >> 1), row: a.r };
}
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}
export function inBounds(a: Axial): boolean {
  const { col, row } = axialToOffset(a);
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}
export function hexKey(a: Axial): string { return a.q + "," + a.r; }
export function parseKey(key: string): Axial {
  const [q, r] = key.split(",").map(Number);
  return { q: q ?? 0, r: r ?? 0 };
}
export function neighbors(a: Axial): Axial[] {
  return AXIAL_DIRS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}
export function cubeRound(x: number, y: number, z: number): Axial {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}
/** Все гексы на линии (включая концы), детерминированный rounded-cube алгоритм. */
export function lineHexes(a: Axial, b: Axial): Axial[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const ax = a.q, az = a.r, ay = -ax - az;
  const bx = b.q, bz = b.r, by = -bx - bz;
  const out: Axial[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(cubeRound(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
  }
  return out;
}
export function terrainAt(field: BattleField, a: Axial): TerrainId {
  return field.terrain[hexKey(a)] ?? "empty";
}
export function inZone(a: Axial, side: "A" | "B"): boolean {
  const { col } = axialToOffset(a);
  return side === "A"
    ? col >= ZONE_A_COLS[0] && col <= ZONE_A_COLS[1]
    : col >= ZONE_B_COLS[0] && col <= ZONE_B_COLS[1];
}
export function inNeutral(a: Axial): boolean {
  const { col } = axialToOffset(a);
  return col >= NEUTRAL_COLS[0] && col <= NEUTRAL_COLS[1];
}
export function allHexes(): Axial[] {
  const out: Axial[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) out.push(offsetToAxial(col, row));
  }
  return out;
}
export function cmpHex(a: Axial, b: Axial): number {
  if (a.q !== b.q) return a.q - b.q;
  return a.r - b.r;
}
