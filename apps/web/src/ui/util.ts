import * as sim from "@sf/sim";
import type {
  BuildKind, Colony, Empire, Fleet, Formation, IncomeBreakdown, Milli, Planet, ResourceId,
  ScienceId, StarSystem, Station, World,
} from "@sf/sim";
import type { ShipDesignDef, TechDef } from "@sf/data";
import { BALANCE, BUILDING_BY_ID, DESIGN_BY_ID, DISTRICT_BY_ID, HULL_BY_ID, MISSION_BY_ID, RESOURCE_BY_ID, TECH_BY_ID, } from "@sf/data";
import type { Game } from "../game/Game";
import { fmtInt, fmtMilli, fmtSigned } from "../game/format";

// ---------------------------------------------------------------- безопасные вызовы sim
/** Запросы @sf/sim могут быть ещё не реализованы — UI обязан деградировать, а не падать. */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function playerEmpire(game: Game): Empire | null {
  if (!game.hasWorld) return null;
  return safe(() => game.getPlayerEmpire(), null as Empire | null);
}

export function worldOf(game: Game): World | null {
  return game.hasWorld ? game.world : null;
}

// ---------------------------------------------------------------- словари RU
export const SCIENCE_ORDER: ScienceId[] = ["physics", "society", "engineering"];
export const SCIENCE_RU: Record<ScienceId, string> = {
  physics: "Физика",
  society: "Общество",
  engineering: "Инженерия",
};
export const SCIENCE_ICON: Record<ScienceId, string> = { physics: "Φ", society: "Σ", engineering: "Ω" };
export const SCIENCE_COLOR: Record<ScienceId, string> = {
  physics: "#69C6FF",
  society: "#8BE08B",
  engineering: "#FF9E6B",
};

export const STAR_RU: Record<string, string> = {
  yellow: "Жёлтая звезда",
  orange: "Оранжевый карлик",
  red: "Красный карлик",
  blue: "Голубая звезда",
  white: "Белый карлик",
  binary: "Двойная звезда",
  trinary: "Тройная звезда",
  neutron: "Нейтронная звезда",
  pulsar: "Пульсар",
  blackhole: "Чёрная дыра",
  nebula: "Туманность",
};

export const PLANET_RU: Record<string, string> = {
  continental: "Континентальная",
  ocean: "Океаническая",
  desert: "Пустынная",
  tundra: "Тундровая",
  arctic: "Арктическая",
  savanna: "Саванна",
  tropical: "Тропическая",
  arid: "Аридная",
  volcanic: "Вулканическая",
  gas_giant: "Газовый гигант",
  barren: "Безжизненная",
  asteroid_belt: "Астероидный пояс",
};

export const POI_RU: Record<string, string> = {
  anomaly: "Аномалия",
  derelict: "Остов корабля",
  pirate_base: "Пиратская база",
  mining_platform: "Шахтёрская платформа",
  research_station: "Исследовательская станция",
  trade_hub: "Торговый узел",
};

export const STATION_RU: Record<string, string> = {
  outpost: "Аутпост",
  shipyard: "Верфь",
  mining: "Шахтёрская станция",
  research: "Научная станция",
  pirate: "Пиратская станция",
  trade: "Торговая станция",
};

export const MISSION_RU: Record<string, string> = {
  delivery: "Доставка",
  bounty: "Зачистка",
  scan: "Сканирование",
  passenger: "Пассажиры",
  smuggle: "Контрабанда",
  rescue: "Спасение",
};

export const FLEET_STATUS_RU: Record<string, string> = {
  idle: "Ожидает",
  moving: "В пути",
  combat: "Бой",
  docked: "В доке",
  retreat: "Отступление",
  scanning: "Сканирует",
};

export const FORMATIONS: { id: Formation; ru: string }[] = [
  { id: "wedge", ru: "Клин" },
  { id: "wall", ru: "Стена" },
  { id: "sphere", ru: "Сфера" },
  { id: "swarm", ru: "Рой" },
  { id: "echelon", ru: "Эшелон" },
  { id: "ambush", ru: "Засада" },
  { id: "caravan", ru: "Караван" },
];

export const RES_SHORT: Record<ResourceId, string> = {
  energy: "эн.",
  minerals: "мин.",
  food: "еда",
  alloys: "спл.",
  goods: "тов.",
  unity: "ед.",
  influence: "вл.",
  credits: "кр.",
};

// ---------------------------------------------------------------- защита от NaN (в UI не должно быть «NaN»/«не число»)
/** Любое нечисловое/бесконечное значение превращается в 0. */
export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
export function rnd(v: unknown): number {
  return Math.round(num(v));
}
export function intText(v: unknown): string {
  return fmtInt(num(v));
}
export function signedText(v: unknown, digits = 0): string {
  return fmtSigned(num(v), digits);
}

// ---------------------------------------------------------------- число/склонения
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const ticksRu = (n: number) => pluralRu(n, "такт", "такта", "тактов");
export const shipsRu = (n: number) => pluralRu(n, "корабль", "корабля", "кораблей");
export const popsRu = (n: number) => pluralRu(n, "поп", "попа", "попов");
export const systemsRu = (n: number) => pluralRu(n, "система", "системы", "систем");
export const coloniesRu = (n: number) => pluralRu(n, "колония", "колонии", "колоний");
export const missionsRu = (n: number) => pluralRu(n, "контракт", "контракта", "контрактов");

export function tickDate(tick: number): string {
  const year = 2187 + Math.floor(tick / 365);
  const day = tick % 365;
  const month = Math.floor(day / 30) + 1;
  const d = (day % 30) + 1;
  return year + "." + String(month).padStart(2, "0") + "." + String(d).padStart(2, "0");
}

export function signedPct(v01: number): string {
  return (v01 >= 0 ? "+" : "−") + Math.abs(Math.round(v01 * 100)) + "%";
}

export function distText(units: number): string {
  if (!Number.isFinite(units)) return "—";
  if (Math.abs(units) >= 1_000_000) return (units / 1_000_000).toFixed(2) + " Мм";
  if (Math.abs(units) >= 1_000) return (units / 1_000).toFixed(1) + " км";
  return Math.round(units) + " м";
}

export function barTone(v01: number): "" | "sf-bar--warn" | "sf-bar--bad" | "sf-bar--ok" {
  if (v01 >= 0.75) return "sf-bar--ok";
  if (v01 >= 0.35) return "";
  if (v01 >= 0.15) return "sf-bar--warn";
  return "sf-bar--bad";
}

export function pctText(v01: unknown): string {
  return rnd(num(v01) * 100) + "%";
}
export function pctInt(v: unknown): string {
  return rnd(v) + "%";
}

// ---------------------------------------------------------------- sim-запросы
export function incomeBreakdown(world: World, empireId: number, res: ResourceId): IncomeBreakdown {
  return safe(() => sim.getIncomeBreakdown(world, empireId, res), {
    resource: res,
    totalMilli: 0,
    lines: [],
  });
}

export function projectedIncome(world: World, empireId: number): Record<ResourceId, number> {
  const emp = world.empires.find((e) => e.id === empireId);
  return safe(() => sim.getProjectedIncome(world, empireId), { ...(emp?.incomeLastTick ?? {}) } as Record<ResourceId, number>);
}

export function fleetPower(fleet: Fleet): number {
  return safe(() => sim.getFleetPower(fleet), fleet.ships.reduce((a, s) => a + s.fleetPower, 0));
}

export function empireFleetPower(world: World, empireId: number): number {
  return safe(() => sim.getEmpireFleetPower(world, empireId), world.fleets
    .filter((f) => f.empireId === empireId && f.ships.length > 0)
    .reduce((a, f) => a + fleetPower(f), 0));
}

export function fleetCap(world: World, empireId: number): number {
  const emp = world.empires.find((e) => e.id === empireId);
  const fallback = BALANCE.baseFleetCap
    + BALANCE.popsFleetCap * popTotal(world, empireId)
    + BALANCE.systemsFleetCap * (emp?.systems.length ?? 0);
  const cap = safe(() => sim.getFleetCap(world, empireId), 0);
  return cap > 0 ? cap : Math.round(fallback);
}

export function popTotal(world: World, empireId: number): number {
  return world.colonies.filter((c) => c.empireId === empireId).reduce((a, c) => a + popsOf(c), 0);
}

export function popsOf(c: Colony): number {
  return c.pops.workers + c.pops.specialists + c.pops.rulers + c.pops.unemployed;
}

export function colonyOutput(world: World, colony: Colony): { output: Milli; upkeep: Milli } {
  return safe(() => sim.getColonyOutput(world, colony), {
    output: colony.output,
    upkeep: colony.upkeep,
    workersNeeded: 0,
  });
}

export function buildCost(world: World, kind: BuildKind, id: string): Partial<Record<ResourceId, number>> {
  const fromSim = safe(() => sim.getBuildCost(world, kind, id), undefined as Partial<Record<ResourceId, number>> | undefined);
  if (fromSim && Object.keys(fromSim).length > 0) return fromSim;
  if (kind === "district") return DISTRICT_BY_ID[id]?.cost ?? {};
  if (kind === "building") return BUILDING_BY_ID[id]?.cost ?? {};
  const d = DESIGN_BY_ID[id];
  return d ? { credits: d.costCredits, alloys: d.costAlloys } : {};
}

export function canAfford(world: World, empireId: number, cost: Partial<Record<ResourceId, number>>): boolean {
  const emp = world.empires.find((e) => e.id === empireId);
  if (!emp) return false;
  const res = safe(() => sim.canAfford(world, empireId, cost), undefined as boolean | undefined);
  if (res !== undefined) return res;
  return (Object.keys(cost) as ResourceId[]).every((k) => (emp.resources[k] ?? 0) >= (cost[k] ?? 0));
}

export function costText(cost: Partial<Record<ResourceId, number>>): string {
  const keys = Object.keys(cost) as ResourceId[];
  if (keys.length === 0) return "бесплатно";
  return keys
    .filter((k) => (cost[k] ?? 0) > 0)
    .map((k) => fmtInt(cost[k] ?? 0) + " " + (RES_SHORT[k] ?? k))
    .join(" · ");
}

export function resText(res: Partial<Record<ResourceId, number>>): string {
  return costText(res);
}

// ---------------------------------------------------------------- поиск сущностей
export function findSystem(world: World, systemId: number | null | undefined): StarSystem | null {
  if (systemId == null) return null;
  return world.systems.find((s) => s.id === systemId) ?? null;
}

export function findStation(world: World, stationId: number | null | undefined): { station: Station; system: StarSystem } | null {
  if (stationId == null) return null;
  for (const sys of world.systems) {
    if (sys.station && sys.station.id === stationId) return { station: sys.station, system: sys };
  }
  return null;
}

export function findColonyByPlanet(world: World, planetId: number | null | undefined): Colony | null {
  if (planetId == null) return null;
  return world.colonies.find((c) => c.planetId === planetId) ?? null;
}

export function findPlanet(world: World, planetId: number | null | undefined): Planet | null {
  if (planetId == null) return null;
  for (const sys of world.systems) {
    const p = sys.planets.find((x) => x.id === planetId);
    if (p) return p;
  }
  return null;
}

export function playerColonies(world: World): Colony[] {
  return world.colonies.filter((c) => c.empireId === world.playerEmpireId);
}

export function playerFleets(game: Game): Fleet[] {
  return safe(() => game.getPlayerFleets(), []);
}

export function fleetsInSystem(game: Game, systemId: number): Fleet[] {
  return safe(() => game.getFleetInSystem(systemId), []);
}

export function enemyFleetsInSystem(game: Game, systemId: number): Fleet[] {
  return safe(() => game.getEnemyFleetsInSystem(systemId), []);
}

export function colonizerInSystem(game: Game, systemId: number): Fleet | null {
  return fleetsInSystem(game, systemId).find((f) => f.ships.some((s) => s.classId === "colonizer")) ?? null;
}

export function isKnown(sys: StarSystem, playerId: number): boolean {
  return sys.knownBy.includes(playerId);
}

export function designName(id: string): string {
  return DESIGN_BY_ID[id]?.ru ?? id;
}

export function techName(id: string): string {
  return TECH_BY_ID[id]?.ru ?? id;
}

export function techOf(id: string): TechDef | undefined {
  return TECH_BY_ID[id];
}

export function designOf(id: string): ShipDesignDef | undefined {
  return DESIGN_BY_ID[id];
}

export function hullName(id: string): string {
  return HULL_BY_ID[id]?.ru ?? id;
}

export function missionName(id: string): string {
  return MISSION_BY_ID[id]?.ru ?? id;
}

export function resourcesOf(emp: Empire): { id: ResourceId; value: number; income: number }[] {
  return (Object.keys(RESOURCE_BY_ID) as ResourceId[]).map((id) => ({
    id,
    value: emp.resources[id] ?? 0,
    income: emp.incomeLastTick[id] ?? 0,
  }));
}

/** «Следствие» для тултипа ресурса: профицит/дефицит и время до нуля. */
export function resourceConsequence(stock: number, income: number): string {
  stock = num(stock);
  income = num(income);
  if (income > 0) return "Профицит: +" + fmtInt(income) + " за такт, запас растёт.";
  if (income < 0) {
    const ticks = stock > 0 ? Math.floor(stock / Math.abs(income)) : 0;
    return "Дефицит: запас закончится через " + fmtInt(ticks) + " " + ticksRu(ticks) + ".";
  }
  return "Поток нулевой: запас не меняется.";
}

/** Дельта дохода в виде +N / −N (U+2212). */
export function incomeText(v: number): string {
  return v === 0 ? "0" : fmtSigned(num(v));
}

export function milliText(milli: number): string {
  return fmtMilli(num(milli));
}