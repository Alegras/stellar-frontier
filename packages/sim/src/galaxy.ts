/**
 * ГЕНЕРАТОР ГАЛАКТИКИ (M1, GDD §4). Детерминирован по seed.
 * 200–400 систем; формы spiral/elliptical/ring/random; гиперлинии: k-ближайшие соседи +
 * MST (гарантия связности) + лимит степени ≤ 4; узкие места (степень 1–2) ≥ 12%.
 * Генерация < 300 мс на 240 систем (без внешних зависимостей, O(N²) на 240 — дёшево).
 */
import { NAMES, RESOURCES } from "@sf/data";
import type { BalanceConfig, ModeConfig } from "@sf/data";
import { nextFloat, nextInt, nextRange, seedRng } from "./prng";
import type { RngState } from "./prng";
import type {
  Planet, PlanetDeposits, PlanetType, Poi, PoiKind, StarSystem, StarType, Station, StationMarket,
} from "./types";

// ---------------------------------------------------------------- константы генерации (GDD §4.1)

const ARMS = 4;
/** Радиус галактики в условных единицах (GDD §4.1: 60–120; для 240 систем берём 46). */
const GALAXY_RADIUS = 46;
/** Минимальная дистанция между звёздами (отбраковка точек, GDD §4.2 шаг 3). */
const MIN_DIST_SQ = 9;
/** Средняя степень узла (GDD §4.1: 1.6–2.6, по умолчанию 2.1). */
const HYPERLANE_DENSITY = 2.1;
/** Лимит степени узла (GDD §4.4: хаб ≥ 6, но для читаемости карты ограничиваем 4). */
const MAX_DEGREE = 4;

const STAR_WEIGHTS: Array<[StarType, number]> = [
  ["yellow", 240], ["orange", 180], ["red", 270], ["white", 90], ["binary", 110],
  ["trinary", 40], ["neutron", 30], ["blackhole", 20], ["pulsar", 15], ["nebula", 5],
];

const PLANET_WEIGHTS: Array<[PlanetType, number]> = [
  ["continental", 60], ["ocean", 60], ["tropical", 50], ["savanna", 60], ["arid", 70],
  ["desert", 70], ["tundra", 60], ["arctic", 60], ["volcanic", 80], ["gas_giant", 140],
  ["barren", 190], ["asteroid_belt", 100],
];

/** Базовая обитаемость планет (GDD §4.5), %. */
const HABITABILITY: Record<PlanetType, number> = {
  continental: 80, ocean: 75, tropical: 70, savanna: 65, arid: 60, desert: 55,
  tundra: 60, arctic: 55, volcanic: 40, gas_giant: 0, barren: 0, asteroid_belt: 0,
};

const POI_WEIGHTS: Array<[PoiKind, number]> = [
  ["anomaly", 18], ["derelict", 12], ["pirate_base", 10], ["mining_platform", 9],
  ["research_station", 9], ["trade_hub", 7],
];

const POI_NAMES: Record<PoiKind, string> = {
  anomaly: "Аномалия",
  derelict: "Обломки корабля",
  pirate_base: "Пиратская база",
  mining_platform: "Шахтёрская платформа",
  research_station: "Научный пост",
  trade_hub: "Торговый узел",
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Империя пиратов: нейтрально-враждебная фракция для демо-боёв (не входит в 7 ИИ). */
export const PIRATE_EMPIRE_ID = 9;

interface Edge { a: number; b: number; d: number }

export interface GalaxyResult {
  systems: StarSystem[];
  rngState: RngState;
  capitalSystemId: number;
}

function weightedPick<T>(rng: RngState, table: Array<[T, number]>): T {
  let total = 0;
  for (const entry of table) total += entry[1];
  let roll = nextInt(rng, total);
  for (const entry of table) {
    roll -= entry[1];
    if (roll < 0) return entry[0];
  }
  return table[table.length - 1][0];
}

function systemName(rng: RngState, used: Record<string, boolean>, index: number): string {
  for (let attempt = 0; attempt < 24; attempt++) {
    const prefix = NAMES.systemPrefixes[nextInt(rng, NAMES.systemPrefixes.length)];
    const root = NAMES.systemRoots[nextInt(rng, NAMES.systemRoots.length)];
    const suffix = NAMES.systemSuffixes[nextInt(rng, NAMES.systemSuffixes.length)];
    const name = `${prefix} ${root} ${suffix}`;
    if (!used[name]) {
      used[name] = true;
      return name;
    }
  }
  const fallback = `Звезда-${index + 1}`;
  used[fallback] = true;
  return fallback;
}

/** Генерация звёздных точек по форме галактики. */
function generatePoints(rng: RngState, count: number, shape: ModeConfig["galaxy"]["shape"]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let attempts = 0;
  const maxAttempts = count * 80;
  while (points.length < count && attempts < maxAttempts) {
    attempts++;
    let x: number;
    let y: number;
    if (shape === "elliptical") {
      const u = nextFloat(rng);
      const r = GALAXY_RADIUS * Math.sqrt(u);
      const theta = 2 * Math.PI * nextFloat(rng);
      x = Math.round(r * Math.cos(theta));
      y = Math.round(r * 0.55 * Math.sin(theta));
    } else if (shape === "ring") {
      const r = GALAXY_RADIUS * (0.65 + 0.35 * nextFloat(rng));
      const theta = 2 * Math.PI * nextFloat(rng);
      x = Math.round(r * Math.cos(theta));
      y = Math.round(r * Math.sin(theta));
    } else if (shape === "random") {
      x = nextRange(rng, -GALAXY_RADIUS, GALAXY_RADIUS);
      y = nextRange(rng, -GALAXY_RADIUS, GALAXY_RADIUS);
    } else {
      const u = nextFloat(rng);
      const r = GALAXY_RADIUS * Math.pow(Math.sqrt(u), 0.9);
      const arm = points.length % ARMS;
      const theta = 2 * Math.PI * nextFloat(rng) + arm * ((2 * Math.PI) / ARMS) + (r / GALAXY_RADIUS) * 4.5;
      x = Math.round(r * Math.cos(theta));
      y = Math.round(r * Math.sin(theta));
    }
    let tooClose = false;
    for (const p of points) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < MIN_DIST_SQ) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) points.push({ x, y });
  }
  return points;
}

/** k-ближайшие соседи → кандидаты рёбер; MST + дополнительные рёбра до целевой плотности. */
function buildHyperlanes(rng: RngState, points: Array<{ x: number; y: number }>): number[][] {
  void rng;
  const n = points.length;
  const links: number[][] = [];
  for (let i = 0; i < n; i++) links.push([]);
  const candidate: Edge[] = [];
  const seen: Record<string, boolean> = {};
  const k = 5;
  for (let i = 0; i < n; i++) {
    const nearest: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      nearest.push({ j, d: dx * dx + dy * dy });
    }
    nearest.sort((a, b) => (a.d !== b.d ? a.d - b.d : a.j - b.j));
    for (let t = 0; t < Math.min(k, nearest.length); t++) {
      const j = nearest[t].j;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}:${b}`;
      if (seen[key]) continue;
      seen[key] = true;
      candidate.push({ a, b, d: nearest[t].d });
    }
  }
  candidate.sort((e1, e2) => (e1.d !== e2.d ? e1.d - e2.d : e1.a !== e2.a ? e1.a - e2.a : e1.b - e2.b));

  // Kruskal — MST гарантирует связность
  const parent: number[] = [];
  const rank: number[] = [];
  for (let i = 0; i < n; i++) {
    parent.push(i);
    rank.push(0);
  }
  const find = (v: number): number => {
    let root = v;
    while (parent[root] !== root) root = parent[root];
    let cur = v;
    while (parent[cur] !== cur) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra]++;
    }
    return true;
  };
  const addEdge = (a: number, b: number): void => {
    links[a].push(b);
    links[b].push(a);
  };
  let edgeCount = 0;
  for (const edge of candidate) {
    if (union(edge.a, edge.b)) {
      addEdge(edge.a, edge.b);
      edgeCount++;
      if (edgeCount === n - 1) break;
    }
  }
  // страховка связности, если граф k-соседей распался на компоненты
  let components = 0;
  for (let i = 0; i < n; i++) if (find(i) === i) components++;
  while (components > 1) {
    let best: Edge | null = null;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (find(a) === find(b)) continue;
        if (links[a].length >= MAX_DEGREE || links[b].length >= MAX_DEGREE) continue;
        const dx = points[a].x - points[b].x;
        const dy = points[a].y - points[b].y;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d || (d === best.d && (a < best.a || (a === best.a && b < best.b)))) {
          best = { a, b, d };
        }
      }
    }
    if (!best) break;
    union(best.a, best.b);
    addEdge(best.a, best.b);
    edgeCount++;
    components = 0;
    for (let i = 0; i < n; i++) if (find(i) === i) components++;
  }

  // дополнительные короткие рёбра до целевой плотности (GDD §4.2 шаг 4c)
  const targetEdges = Math.round((n * HYPERLANE_DENSITY) / 2);
  for (const edge of candidate) {
    if (edgeCount >= targetEdges) break;
    if (links[edge.a].includes(edge.b)) continue;
    if (links[edge.a].length >= MAX_DEGREE || links[edge.b].length >= MAX_DEGREE) continue;
    if (find(edge.a) === find(edge.b)) continue; // оставляем только «полезные» рёбра-циклы
    addEdge(edge.a, edge.b);
    union(edge.a, edge.b);
    edgeCount++;
  }
  // если циклов не хватило — добавляем самые короткие из оставшихся кандидатов
  for (const edge of candidate) {
    if (edgeCount >= targetEdges) break;
    if (links[edge.a].includes(edge.b)) continue;
    if (links[edge.a].length >= MAX_DEGREE || links[edge.b].length >= MAX_DEGREE) continue;
    addEdge(edge.a, edge.b);
    edgeCount++;
  }

  for (let i = 0; i < n; i++) links[i].sort((a, b) => a - b);
  return links;
}

function makePlanet(
  rng: RngState,
  planetId: number,
  systemId: number,
  systemNameValue: string,
  orbit: number,
): Planet {
  const type = weightedPick(rng, PLANET_WEIGHTS);
  const size = type === "gas_giant" ? 5 : nextRange(rng, 1, 5);
  const baseHab = HABITABILITY[type];
  const habitability = baseHab > 0 ? Math.min(100, Math.max(0, baseHab + nextRange(rng, -10, 10))) : 0;
  const deposits: PlanetDeposits = {
    minerals: nextRange(rng, 0, 4),
    energy: nextRange(rng, 0, 3),
    rare: type === "barren" || type === "arctic" || type === "volcanic" ? nextRange(rng, 0, 2) : 0,
  };
  // Игровые единицы для 3D-сцены: целые, монотонные по орбите, газовые гиганты дальше.
  const orbitRadius = 1200 + orbit * 900 + size * 300 + (type === "gas_giant" ? 4000 : 0);
  return {
    id: planetId,
    systemId,
    name: `${systemNameValue} ${ROMAN[orbit] ?? String(orbit + 1)}`,
    type,
    size,
    orbit,
    orbitRadius,
    habitability,
    deposits,
    ownerId: 0,
    colonyId: 0,
    anomaly: nextInt(rng, 100) < 12 ? NAMES.anomalyNames[nextInt(rng, NAMES.anomalyNames.length)] : "",
    scanned: false,
  };
}

/** Детерминированная луна у планеты-родителя. */
function makeMoon(rng: RngState, planetId: number, systemId: number, parent: Planet, index: number): Planet {
  const types: PlanetType[] = ["continental", "ocean", "tundra", "desert", "savanna", "arctic"];
  const type = types[nextInt(rng, types.length)] ?? "tundra";
  const size = nextRange(rng, 1, 2);
  const habitability = Math.min(100, Math.max(40, HABITABILITY[type] + nextRange(rng, -8, 8)));
  const deposits: PlanetDeposits = {
    minerals: nextRange(rng, 0, 3),
    energy: nextRange(rng, 0, 2),
    rare: type === "arctic" ? nextRange(rng, 0, 1) : 0,
  };
  return {
    id: planetId,
    systemId,
    name: parent.name + "-" + String.fromCharCode(65 + index),
    type,
    size,
    orbit: parent.orbit,
    orbitRadius: parent.orbitRadius + 260 + index * 160,
    parentPlanetId: parent.id,
    isMoon: true,
    habitability,
    deposits,
    ownerId: 0,
    colonyId: 0,
    anomaly: nextInt(rng, 100) < 6 ? NAMES.anomalyNames[nextInt(rng, NAMES.anomalyNames.length)] : "",
    scanned: false,
  };
}

function makeStationMarket(rng: RngState): StationMarket {
  const market: StationMarket = {};
  const tradeable = ["energy", "minerals", "food", "alloys", "goods"] as const;
  for (const id of tradeable) {
    const def = RESOURCES.find((r) => r.id === id);
    if (!def) continue;
    market[id] = {
      stock: nextRange(rng, 400, 3000),
      price: Math.round(def.retail * (0.92 + 0.16 * nextFloat(rng))),
    };
  }
  return market;
}

function makeStation(rng: RngState, stationId: number, systemId: number, kind: Station["kind"], nameRu: string): Station {
  const hasShipyard = kind === "shipyard";
  return {
    id: stationId,
    systemId,
    ownerId: 0,
    kind,
    nameRu,
    hp: kind === "pirate" ? 400 : 600,
    maxHp: kind === "pirate" ? 400 : 600,
    market: kind === "trade" || kind === "outpost" ? makeStationMarket(rng) : {},
    marketTick: 0,
    hasShipyard,
    hasMissions: kind === "trade" || kind === "outpost" || kind === "research",
  };
}

/** BFS-дистанции в прыжках от заданной системы (детерминированно, порядок links возрастает). */
export function computeHops(systems: StarSystem[], fromSystemId: number): number[] {
  const hops: number[] = [];
  for (let i = 0; i < systems.length; i++) hops.push(-1);
  const start = systems[fromSystemId];
  if (!start) return hops;
  hops[fromSystemId] = 0;
  const queue: number[] = [fromSystemId];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const system = systems[cur];
    if (!system) continue;
    for (const next of system.links) {
      if (hops[next] === -1) {
        hops[next] = hops[cur] + 1;
        queue.push(next);
      }
    }
  }
  return hops;
}

/** Основная функция генерации. */
export function generateGalaxy(seed: number, mode: ModeConfig, balance: BalanceConfig): GalaxyResult {
  void balance;
  const rng = seedRng(seed);
  const count = Math.max(20, mode.galaxy.systems);
  const points = generatePoints(rng, count, mode.galaxy.shape);
  const links = buildHyperlanes(rng, points);

  const systems: StarSystem[] = [];
  const usedNames: Record<string, boolean> = {};
  let planetId = 1;
  let stationId = 1;

  for (let i = 0; i < points.length; i++) {
    const star = weightedPick(rng, STAR_WEIGHTS);
    const name = systemName(rng, usedNames, i);
    const planetCount = nextRange(rng, 2, 6);
    const planets: Planet[] = [];
    for (let orbit = 0; orbit < planetCount; orbit++) {
      planets.push(makePlanet(rng, planetId++, i, name, orbit));
    }
    const poi: Poi[] = [];
    const poiCount = nextInt(rng, 100) < 42 ? 0 : nextInt(rng, 100) < 72 ? 1 : 2;
    for (let p = 0; p < poiCount; p++) {
      const kind = weightedPick(rng, POI_WEIGHTS);
      poi.push({
        id: planetId++,
        kind,
        nameRu: POI_NAMES[kind],
        systemId: i,
        scanned: false,
        rewardCredits: kind === "trade_hub" ? 0 : nextRange(rng, 2000, 12000),
        rewardScience: kind === "anomaly" ? nextRange(rng, 25, 60) : 0,
      });
    }
    let station: Station | null = null;
    for (const point of poi) {
      if (point.kind === "trade_hub") {
        station = makeStation(rng, stationId++, i, "trade", NAMES.stationNames[nextInt(rng, NAMES.stationNames.length)]);
        break;
      }
      if (point.kind === "pirate_base") {
        station = makeStation(rng, stationId++, i, "pirate", "Логово пиратов");
        break;
      }
      if (point.kind === "research_station") {
        station = makeStation(rng, stationId++, i, "research", "Научный пост");
        break;
      }
      if (point.kind === "mining_platform") {
        station = makeStation(rng, stationId++, i, "mining", "Добывающая платформа");
        break;
      }
    }
    const degree = links[i].length;
    systems.push({
      id: i,
      name,
      x: points[i].x,
      y: points[i].y,
      star,
      planets,
      links: links[i],
      ownerId: 0,
      knownBy: [],
      visibleTo: [],
      poi,
      station,
      chokepoint: degree <= 2,
      hopsFromCapital: -1,
    });
  }

  // столица игрока: система ближе к центру, но не самая центр — детерминированный выбор
  let capitalSystemId = 0;
  let bestScore = Number.MAX_SAFE_INTEGER;
  for (const system of systems) {
    const dist = Math.abs(system.x) + Math.abs(system.y);
    const score = dist + (system.planets.length > 2 ? 0 : 500);
    if (score < bestScore) {
      bestScore = score;
      capitalSystemId = system.id;
    }
  }

  // Луны генерируются отдельным RNG после всей галактики: не сдвигаем существующие id
  // планет/POI/станций и не меняем детерминизм остальной генерации.
  let nextMoonPlanetId = planetId;
  const moonRng = seedRng((seed ^ 0x6d6f6f6e) >>> 0);
  for (const system of systems) {
    for (const parent of [...system.planets]) {
      if (nextInt(moonRng, 100) >= 18) continue;
      const moonCount = nextInt(moonRng, 100) < 25 ? 2 : 1;
      for (let moonIndex = 0; moonIndex < moonCount; moonIndex++) {
        system.planets.push(makeMoon(moonRng, nextMoonPlanetId++, system.id, parent, moonIndex));
      }
    }
  }

  return { systems, rngState: rng, capitalSystemId };
}
