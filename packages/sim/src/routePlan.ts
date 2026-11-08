/** Часть XX: планирование маршрутов флота по гиперграфу с топливом и дозаправками. */
import type { Fleet, World } from "./types";
import { fuelOf, jumpFuelCost } from "./fuel";

export type RouteMode = "fastest" | "shortest" | "economical" | "safest";
export interface RouteStep { systemId: number; fuelCost: number; danger: number; refuel: boolean; }
export interface RoutePlan {
  fleetId: number;
  targetId: number;
  mode: RouteMode;
  path: number[];
  steps: RouteStep[];
  jumps: number;
  fuelStart: number;
  fuelEnd: number;
  fuelNeeded: number;
  refuelAt: number[];
  timeTicks: number;
  danger: number;
  warnings: string[];
  feasible: boolean;
}

const MODE_W: Record<RouteMode, { t: number; f: number; d: number; l: number }> = {
  fastest: { t: 1, f: 0.05, d: 0.1, l: 0.02 },
  shortest: { t: 0.1, f: 0.05, d: 0.1, l: 1 },
  economical: { t: 0.2, f: 0.6, d: 0.1, l: 0.1 },
  safest: { t: 0.15, f: 0.1, d: 1, l: 0.05 },
};

function dist(world: World, a: number, b: number): number {
  const sa = world.systems[a], sb = world.systems[b];
  return sa && sb ? Math.hypot(sa.x - sb.x, sa.y - sb.y) : 300;
}
function dangerOf(world: World, sysId: number, playerId: number): number {
  const s = world.systems[sysId]; if (!s) return 2;
  if (s.ownerId === 9) return 3;
  if (s.ownerId !== 0 && s.ownerId !== playerId) return 1.5;
  return 0;
}
function edgeCost(world: World, fleet: Fleet, from: number, to: number, mode: RouteMode): number {
  const m = MODE_W[mode];
  const fuel = jumpFuelCost(world, fleet, from, to);
  const d = Math.max(0, Math.min(5, dangerOf(world, to, fleet.empireId)));
  const len = dist(world, from, to) / 100; // условные св. годы
  return m.t * 1 + m.f * fuel + m.d * d + m.l * len;
}

/** Dijkstra по гиперлиниям с детерминированным тай-брейком. */
export function planRoute(world: World, fleet: Fleet, targetId: number, mode: RouteMode, fuelAware = true): RoutePlan | null {
  const n = world.systems.length;
  if (!world.systems[fleet.systemId] || !world.systems[targetId]) return null;
  const distCost = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const seen = new Array<boolean>(n).fill(false);
  distCost[fleet.systemId] = 0;
  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!seen[i] && distCost[i]! < Infinity && (u < 0 || distCost[i]! < distCost[u]! || (distCost[i] === distCost[u] && i < u))) u = i;
    if (u < 0 || u === targetId) break;
    seen[u] = true;
    for (const v of world.systems[u]!.links) {
      const c = distCost[u]! + edgeCost(world, fleet, u, v, mode);
      if (c + 1e-9 < distCost[v]! || (Math.abs(c - distCost[v]!) <= 1e-6 && u < prev[v]!)) { distCost[v] = c; prev[v] = u; }
    }
  }
  if (distCost[targetId] === Infinity) return null;
  const path: number[] = [];
  for (let cur = targetId; cur !== fleet.systemId && cur >= 0; cur = prev[cur]!) { path.push(cur); if (cur === -1) return null; }
  path.reverse();
  if (path.length === 0) return null;
  let fuel = fuelOf(fleet); const max = fleet.fuelMax ?? fuel; const warnings: string[] = []; const refuelAt: number[] = []; const steps: RouteStep[] = [];
  let from = fleet.systemId; let fuelNeeded = 0; let danger = 0;
  for (const to of path) {
    const s = world.systems[to];
    const cost = jumpFuelCost(world, fleet, from, to);
    if (fuelAware && fuel < cost) {
      const cur = world.systems[from];
      if (cur?.station) { refuelAt.push(from); fuel = max; warnings.push("Дозаправка: " + cur.name); }
      else warnings.push("Не хватает топлива до " + (s?.name ?? to) + "; аварийная дозаправка или смена маршрута");
    }
    fuelNeeded += cost; fuel = Math.max(0, fuel - cost);
    steps.push({ systemId: to, fuelCost: cost, danger: dangerOf(world, to, fleet.empireId), refuel: refuelAt.includes(to) });
    danger += dangerOf(world, to, fleet.empireId); from = to;
  }
  if (fuelAware && fuel < 0) warnings.push("Маршрут требует больше топлива, чем есть");
  return { fleetId: fleet.id, targetId, mode, path, steps, jumps: path.length, fuelStart: fuelOf(fleet), fuelEnd: fuel, fuelNeeded, refuelAt, timeTicks: path.length, danger, warnings, feasible: fuel >= 0 };
}

export function routeAlternatives(world: World, fleet: Fleet, targetId: number, fuelAware = true): RoutePlan[] {
  const modes: RouteMode[] = ["fastest", "shortest", "economical", "safest"];
  const out: RoutePlan[] = [];
  for (const m of modes) { const p = planRoute(world, fleet, targetId, m, fuelAware); if (p && !out.some((x) => x.path.join(",") === p.path.join(","))) out.push(p); }
  return out.slice(0, 4);
}
