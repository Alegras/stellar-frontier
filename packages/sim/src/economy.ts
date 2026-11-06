/**
 * ЭКОНОМИКА (M2, GDD §6–7, 03b_economy). Все числа — из @sf/data, кроме констант формул
 * (помечены комментарием со ссылкой на канон).
 *
 * Правила детерминизма: экономика целочисленная (милли-единицы ×1000), порядок итераций —
 * по возрастанию id. Дробные остатки доходов копятся в Empire.frac (тысячные).
 */
import {
  BUILDING_BY_ID, DESIGN_BY_ID, DISTRICT_BY_ID, HULL_BY_ID, JOBS, JOB_BY_ID, TECH_BY_ID,
} from "@sf/data";
import type { BuildingDef, DistrictDef } from "@sf/data";
import {
  empireFlatYields, empireGovernmentInfluenceFlat, empireModifiers, empireSchoolScience, neutralModifiers,
  sprawlConstructionCostMult,
} from "./modifiers";
import type { EmpireModifiers } from "./modifiers";
import { RESOURCE_ORDER, SCIENCE_ORDER } from "./types";
import type {
  Colony, Empire, Fleet, Formation, GameEvent, JobAssignment, Milli, Planet, PopCounts, Resources,
  ResourceId, ScienceId, Ship, ShipClassId, World,
} from "./types";

// ------------------------------------------------------------------ константы формул (GDD)

/** GDD §7.4: дефицит энергии —25% производства зданий/районов. */
export const DEFICIT_PROD_PERMILLE = 750;
/** GDD §19.1: влияние «от формы правления» +1/такт (второй пункт даёт наместник). */
export const INFLUENCE_BASE_MILLI = 1000;
/** GDD §6.2: исследователь даёт sciencePerResearcher очков; веса школ 40/40/20 (старт 2/2/1). */
const SCIENCE_WEIGHTS: Record<ScienceId, number> = { physics: 400, society: 200, engineering: 400 };

/** Ранг класса корабля: меньший ранг = меньше корабль (гибнет первым, GDD §11.6 шаг 8). */
export const SHIP_CLASS_RANK: Record<ShipClassId, number> = {
  corvette: 1, frigate: 2, destroyer: 3, cruiser: 4, battleship: 5, titan: 6, colossus: 7,
  carrier: 8, shuttle: 1, science: 1, trader: 1, miner: 1, colonizer: 1, troopship: 2, tanker: 1,
  flagship: 2,
};

// ------------------------------------------------------------------ кэши такта (перф M2)
// Детерминизм не страдает: кэши живут в пределах такта и инвалидируются при изменениях
// состава флотов/колоний; ключ включает world.tick.

const PLANET_INDEX_CACHE = new WeakMap<World, Map<number, Planet>>();
const COLONY_SLOTS_CACHE = new WeakMap<World, Map<number, {
  sig: string;
  slots: Record<string, number>;
  districts: Record<string, number>;
}>>();
const PROJECTION_CACHE = new WeakMap<World, Map<number, { tick: number; mods: EmpireModifiers; projection: EmpireProjection }>>();

function colonySig(world: World, colony: Colony): string {
  return world.tick + "|" + colony.buildings.join(",") + "|"
    + Object.keys(colony.districts).sort().map((id) => id + "=" + (colony.districts[id] ?? 0)).join(",");
}

/** Сброс кэша проекции империи (после стройки/изменения флотов). */
export function invalidateProjection(world: World, empireId: number): void {
  const cache = PROJECTION_CACHE.get(world);
  if (cache) cache.delete(empireId);
}

// ------------------------------------------------------------------ утилиты

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

export function zeroResources(): Resources {
  return {
    energy: 0, minerals: 0, food: 0, alloys: 0, goods: 0, unity: 0, influence: 0, credits: 0,
  };
}

export function zeroMilli(): Milli {
  return {
    energy: 0, minerals: 0, food: 0, alloys: 0, goods: 0, unity: 0, influence: 0, credits: 0,
  };
}

export function zeroScience(): Record<ScienceId, number> {
  return { physics: 0, society: 0, engineering: 0 };
}

export function copyMilli(src: Milli): Milli {
  const out = zeroMilli();
  for (const res of RESOURCE_ORDER) out[res] = src[res];
  return out;
}

/** Единая точка журналирования событий (русский текст для UI-уведомлений). */
export function logEvent(
  world: World,
  kind: GameEvent["kind"],
  severity: GameEvent["severity"],
  messageRu: string,
  systemId?: number,
  empireId?: number,
): void {
  const event: GameEvent = { id: world.nextId++, tick: world.tick, kind, severity, messageRu };
  if (systemId !== undefined) event.systemId = systemId;
  if (empireId !== undefined) event.empireId = empireId;
  world.log.push(event);
  if (world.log.length > 500) world.log.splice(0, world.log.length - 500);
}

export function empireById(world: World, id: number): Empire | undefined {
  for (const e of world.empires) if (e.id === id) return e;
  return undefined;
}

export function findPlanet(world: World, planetId: number): Planet | null {
  let index = PLANET_INDEX_CACHE.get(world);
  if (!index) {
    index = new Map<number, Planet>();
    for (const system of world.systems) {
      for (const planet of system.planets) index.set(planet.id, planet);
    }
    PLANET_INDEX_CACHE.set(world, index);
  }
  return index.get(planetId) ?? null;
}

export function planetOfColony(world: World, colony: Colony): Planet | null {
  return findPlanet(world, colony.planetId);
}

/**
 * Можно ли колонизировать планету: свободна, пригодна (>=40), а для луны —
 * у империи уже есть колония на родителе или родитель ей принадлежит.
 */
export function canColonizePlanet(world: World, empireId: number, planet: Planet): { ok: boolean; reasonRu?: string } {
  if (planet.ownerId !== 0 || planet.colonyId !== 0) return { ok: false, reasonRu: "Планета уже занята" };
  if (planet.habitability < 40) return { ok: false, reasonRu: "Планета непригодна для колонизации" };
  if (planet.isMoon) {
    const parent = planet.parentPlanetId !== undefined ? findPlanet(world, planet.parentPlanetId) : null;
    if (!parent) return { ok: false, reasonRu: "У луны нет родительской планеты" };
    const parentColony = world.colonies.some((colony) => colony.planetId === parent.id && colony.empireId === empireId);
    if (parent.ownerId !== empireId && !parentColony) {
      return { ok: false, reasonRu: "Сначала нужна колония или владение родительской планетой" };
    }
  }
  return { ok: true };
}

export function popsTotal(pops: PopCounts): number {
  return pops.workers + pops.specialists + pops.rulers;
}

export function milliOf(value: number): number {
  return Math.round(value * 1000);
}

/** Умножение милли-значения на коэффициент в тысячных с детерминированным округлением. */
export function mulMilli(value: number, permille: number): number {
  return Math.round((value * permille) / 1000);
}

/** Сумма очков науки по школам для империи (GDD §8: исследователи + здания + столица). */
export function sumScience(empire: Empire): number {
  return empire.science.physics + empire.science.society + empire.science.engineering;
}

// ------------------------------------------------------------------ технологии

/** Модификаторы завершённых технологий в тысячных (например energy_prod: 100 = +10%). */
export function techModifiers(empire: Empire): Record<string, number> {
  const mods: Record<string, number> = {};
  for (const techId of empire.techs.completed) {
    const tech = TECH_BY_ID[techId];
    if (!tech) continue;
    for (const effect of tech.effects) {
      if (effect.kind === "modifier" && typeof effect.value === "number") {
        mods[effect.target] = (mods[effect.target] ?? 0) + Math.round(effect.value * 1000);
      }
    }
  }
  return mods;
}

export function hasTech(empire: Empire, techId: string): boolean {
  return empire.techs.completed.includes(techId);
}

/** Разблокирован ли контент (building:/hull:/weapon:/module:) технологиями империи. */
export function techUnlocked(empire: Empire, target: string): boolean {
  for (const techId of empire.techs.completed) {
    const tech = TECH_BY_ID[techId];
    if (!tech) continue;
    for (const effect of tech.effects) {
      if (effect.kind === "unlock" && effect.target === target) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ корабли и флоты

export function createShip(
  id: number,
  designId: string,
  name: string,
  isFlagship = false,
  world?: World,
): Ship {
  // Готовый шаблон из @sf/data или пользовательский дизайн (конструктор M5/M12).
  const design = DESIGN_BY_ID[designId];
  let hullId: string;
  let classId: Ship["classId"];
  let fleetPower: number;
  if (design) {
    hullId = design.hullId;
    classId = design.classId;
    fleetPower = design.fleetPower;
  } else {
    const custom = world ? (world.customDesigns ?? []).find((entry) => entry.id === designId) : undefined;
    if (!custom) throw new Error(`Неизвестный проект корабля: ${designId}`);
    hullId = custom.hullId;
    fleetPower = custom.fleetPower;
    const customHull = HULL_BY_ID[hullId];
    if (!customHull) throw new Error(`Неизвестный корпус: ${hullId}`);
    classId = customHull.classId;
  }
  const hull = HULL_BY_ID[hullId];
  if (!hull) throw new Error(`Неизвестный корпус: ${hullId}`);
  return {
    id,
    designId,
    classId,
    name,
    hull: hull.hullHp,
    hullMax: hull.hullHp,
    armor: hull.armorBase,
    armorMax: hull.armorBase,
    shield: hull.shieldBase,
    shieldMax: hull.shieldBase,
    fleetPower,
    exp: 0,
    isFlagship,
    damageTaken: 0,
  };
}

/** Fallback скорости по классу (для пользовательских дизайнов без шаблона в @sf/data). */
const CLASS_SPEED: Partial<Record<ShipClassId, number>> = {
  corvette: 480, frigate: 420, destroyer: 380, cruiser: 320, battleship: 260, titan: 200,
  colossus: 180, carrier: 240, shuttle: 380, science: 420, trader: 340, miner: 300,
  colonizer: 260, troopship: 300, tanker: 290, flagship: 480,
};

export function shipSpeed(ship: Ship, world?: World): number {
  const design = DESIGN_BY_ID[ship.designId];
  let hull = design ? HULL_BY_ID[design.hullId] : undefined;
  if (!hull && world) {
    const custom = (world.customDesigns ?? []).find((entry) => entry.id === ship.designId);
    if (custom) hull = HULL_BY_ID[custom.hullId];
  }
  if (hull) return hull.baseSpeed;
  return CLASS_SPEED[ship.classId] ?? 300;
}

export function fleetSpeed(fleet: Fleet): number {
  if (fleet.ships.length === 0) return 0;
  let sum = 0;
  for (const ship of fleet.ships) sum += shipSpeed(ship);
  return Math.floor(sum / fleet.ships.length);
}

export function createFleet(
  world: World,
  empireId: number,
  systemId: number,
  ships: Ship[],
  name: string,
  formation: Formation = "echelon",
): Fleet {
  const empire = empireById(world, empireId);
  const fleet: Fleet = {
    id: world.nextId++,
    empireId,
    name,
    systemId,
    ships,
    path: [],
    pathIndex: 0,
    jumpTicksLeft: 0,
    status: "idle",
    formation,
    admiralName: null,
    followFleetId: null,
  };
  world.fleets.push(fleet);
  if (empire) empire.fleets.push(fleet.id);
  invalidateProjection(world, empireId);
  for (const ship of ships) {
    if (ship.isFlagship && empire) empire.flagshipFleetId = fleet.id;
  }
  return fleet;
}

export function removeFleet(world: World, fleetId: number): void {
  const idx = world.fleets.findIndex((f) => f.id === fleetId);
  if (idx < 0) return;
  const fleet = world.fleets[idx];
  world.fleets.splice(idx, 1);
  invalidateProjection(world, fleet.empireId);
  const empire = empireById(world, fleet.empireId);
  if (empire) {
    const fi = empire.fleets.indexOf(fleetId);
    if (fi >= 0) empire.fleets.splice(fi, 1);
    if (empire.flagshipFleetId === fleetId) empire.flagshipFleetId = 0;
  }
}

// ------------------------------------------------------------------ колонии

export interface ColonyInit {
  pops: { workers: number; specialists?: number; rulers?: number; unemployed?: number };
  districts?: Record<string, number>;
  buildings?: string[];
}

/** GDD §5.1: лимит районов на планете = planet_size + 4 (стартовая столица имеет 8 — минимум 8). */
export function districtCapacity(world: World, colony: Colony): number {
  const planet = planetOfColony(world, colony);
  const size = planet ? planet.size : 4;
  return Math.max(8, size + 4);
}

/** Фактически учитываемые районы с учётом лимита (сверхлимитные не дают жилья/работы/апкипа). */
export function effectiveDistricts(world: World, colony: Colony): Record<string, number> {
  const cache = COLONY_SLOTS_CACHE.get(world);
  const sig = colonySig(world, colony);
  const hit = cache?.get(colony.id);
  if (hit && hit.sig === sig) return hit.districts;
  const cap = districtCapacity(world, colony);
  const out: Record<string, number> = {};
  const ids = Object.keys(colony.districts).sort();
  let used = 0;
  for (const id of ids) {
    const count = colony.districts[id] ?? 0;
    if (count <= 0) continue;
    const allowed = Math.min(count, cap - used);
    if (allowed > 0) out[id] = allowed;
    used += allowed;
    if (used >= cap) break;
  }
  let entry = cache?.get(colony.id);
  if (!entry) {
    if (!cache) COLONY_SLOTS_CACHE.set(world, new Map());
    entry = { sig, slots: {}, districts: out };
    COLONY_SLOTS_CACHE.get(world)!.set(colony.id, entry);
  } else {
    entry.sig = sig;
    entry.districts = out;
    entry.slots = {};
  }
  return out;
}

/** Жильё: база планеты + районы + здания (GDD §5.4, §6.3). */
export function colonyHousing(world: World, colony: Colony): number {
  const planet = planetOfColony(world, colony);
  let housing = planet ? 5 + planet.size * 5 : 5;
  const districts = effectiveDistricts(world, colony);
  for (const districtId of Object.keys(districts)) {
    const count = districts[districtId] ?? 0;
    const def = DISTRICT_BY_ID[districtId];
    if (def) housing += def.housing * count;
  }
  for (const buildingId of colony.buildings) {
    const def = BUILDING_BY_ID[buildingId];
    if (def && def.housing) housing += def.housing;
  }
  return housing;
}

export function createColony(world: World, empire: Empire, planet: Planet, init: ColonyInit): Colony {
  const colony: Colony = {
    id: world.nextId++,
    planetId: planet.id,
    systemId: planet.systemId,
    empireId: empire.id,
    name: planet.name,
    pops: {
      workers: init.pops.workers,
      specialists: init.pops.specialists ?? 0,
      rulers: init.pops.rulers ?? 0,
      unemployed: init.pops.unemployed ?? 0,
    },
    housing: 0,
    stability: world.balance.stabilityBase,
    crime: 0,
    districts: { ...(init.districts ?? {}) },
    buildings: [...(init.buildings ?? [])],
    queue: [],
    jobs: [],
    output: zeroMilli(),
    upkeep: zeroMilli(),
    unemployedWarn: false,
  };
  world.colonies.push(colony);
  empire.colonies.push(colony.id);
  planet.ownerId = empire.id;
  planet.colonyId = colony.id;
  const system = world.systems[colony.systemId];
  if (system) {
    system.ownerId = empire.id;
    if (!system.knownBy.includes(empire.id)) system.knownBy.push(empire.id);
    if (!system.visibleTo.includes(empire.id)) system.visibleTo.push(empire.id);
    if (!empire.systems.includes(system.id)) {
      empire.systems.push(system.id);
      empire.systems.sort((a, b) => a - b);
    }
  }
  recomputeColony(world, colony);
  return colony;
}

/** Слоты рабочих мест колонии по районам и зданиям (без учёта попов). */
export function colonyJobSlots(world: World, colony: Colony): Record<string, number> {
  const cache = COLONY_SLOTS_CACHE.get(world);
  const sig = colonySig(world, colony);
  const hit = cache?.get(colony.id);
  if (hit && hit.sig === sig && Object.keys(hit.slots).length > 0) return hit.slots;
  const slots: Record<string, number> = {};
  const districts = effectiveDistricts(world, colony);
  for (const districtId of Object.keys(districts)) {
    const count = districts[districtId] ?? 0;
    if (count <= 0) continue;
    const def = DISTRICT_BY_ID[districtId];
    if (!def) continue;
    for (const jobId of def.jobs) slots[jobId] = (slots[jobId] ?? 0) + count;
  }
  for (const buildingId of colony.buildings) {
    const def = BUILDING_BY_ID[buildingId];
    if (!def) continue;
    for (const jobId of def.jobs) slots[jobId] = (slots[jobId] ?? 0) + 1;
  }
  let entry = cache?.get(colony.id);
  if (!entry) {
    if (!cache) COLONY_SLOTS_CACHE.set(world, new Map());
    entry = { sig, slots, districts: effectiveDistricts(world, colony) };
    COLONY_SLOTS_CACHE.get(world)!.set(colony.id, entry);
  } else {
    entry.sig = sig;
    entry.slots = slots;
  }
  return slots;
}

export function jobsSlotsTotal(world: World, colony: Colony): number {
  const slots = colonyJobSlots(world, colony);
  let total = 0;
  for (const jobId of Object.keys(slots)) total += slots[jobId] ?? 0;
  return total;
}

/** Назначение попов на работы: правители → специалисты → рабочие (GDD §6.6), порядок — JOBS. */
export function assignJobs(world: World, colony: Colony): void {
  void world;
  const slots = colonyJobSlots(world, colony);
  const remaining: Record<"worker" | "specialist" | "ruler", number> = {
    worker: colony.pops.workers,
    specialist: colony.pops.specialists,
    ruler: colony.pops.rulers,
  };
  const jobs: JobAssignment[] = [];
  const strata: Array<"ruler" | "specialist" | "worker"> = ["ruler", "specialist", "worker"];
  for (const stratum of strata) {
    for (const job of JOBS) {
      if (job.stratum !== stratum) continue;
      const slotsCount = slots[job.id] ?? 0;
      if (slotsCount <= 0) continue;
      const take = Math.min(remaining[stratum], slotsCount);
      if (take > 0) {
        jobs.push({ jobId: job.id, count: take });
        remaining[stratum] -= take;
      }
    }
  }
  colony.jobs = jobs;
  let assigned = 0;
  for (const job of jobs) assigned += job.count;
  colony.pops.unemployed = Math.max(0, popsTotal(colony.pops) - assigned);
  colony.unemployedWarn = colony.pops.unemployed > 0;
}

/**
 * Выход колонии («строка верхней панели», GDD §7.3/03b §12.2):
 * производство рабочих мест × стабильность − должностные затраты − апкип районов − содержание попов.
 * Апкип зданий и флота считается отдельно (фаза 6 такта).
 */
export function computeColonyOutput(world: World, colony: Colony): { output: Milli; upkeep: Milli; workersNeeded: number } {
  const mods = empireById(world, colony.empireId)
    ? empireModifiers(world, colony.empireId)
    : neutralModifiers();
  const stabilityMod = clamp(600 + 6 * colony.stability, 600, 1200);
  const energyDeficit = (world.flags[`def:${colony.empireId}:energy`] ?? 0) > 0;
  const deficitScale = energyDeficit ? DEFICIT_PROD_PERMILLE : 1000;
  const output = zeroMilli();
  const upkeep = zeroMilli();

  for (const assignment of colony.jobs) {
    const job = JOB_BY_ID[assignment.jobId];
    if (!job) continue;
    for (const resKey of Object.keys(job.output)) {
      const res = resKey as ResourceId;
      const base = job.output[res];
      if (typeof base !== "number" || base <= 0) continue; // отрицательный выход (ТП) моделируется содержанием страт
      const baseMilli = milliOf(base);
      // Сводные модификаторы (технологии/традиции/перки/санкции/давление финала):
      // единство и влияние дополнительно масштабируются своими множителями.
      let resMult = mods.production[res];
      if (res === "unity") resMult *= mods.unityMult;
      else if (res === "influence") resMult *= mods.influenceMult;
      const prodMod = Math.round(Math.max(0, resMult) * 1000);
      let value = baseMilli * assignment.count;
      value = mulMilli(value, prodMod);
      value = mulMilli(value, stabilityMod);
      value = mulMilli(value, deficitScale);
      output[res] += value;
    }
    if (job.input) {
      for (const resKey of Object.keys(job.input)) {
        const res = resKey as ResourceId;
        if (res === "goods") continue; // содержание ТП учтено через страты (как в GDD §3.5)
        const base = job.input[res];
        if (typeof base !== "number" || base <= 0) continue;
        upkeep[res] += milliOf(base) * assignment.count;
      }
    }
  }

  // апкип районов (GDD §5.4): только фактически учитываемые районы в пределах лимита §5.1
  const effective = effectiveDistricts(world, colony);
  for (const districtId of Object.keys(effective)) {
    const count = effective[districtId] ?? 0;
    const def: DistrictDef | undefined = DISTRICT_BY_ID[districtId];
    if (def && count > 0) upkeep.energy += milliOf(def.upkeepEnergy) * count;
  }

  // содержание попов: пища и ТП по стратам (balance.json)
  upkeep.food += popsTotal(colony.pops) * milliOf(world.balance.popFoodUpkeep);
  upkeep.goods += colony.pops.workers * milliOf(world.balance.popGoodsUpkeep.worker ?? 0);
  upkeep.goods += colony.pops.specialists * milliOf(world.balance.popGoodsUpkeep.specialist ?? 0);
  upkeep.goods += colony.pops.rulers * milliOf(world.balance.popGoodsUpkeep.ruler ?? 0);

  return { output, upkeep, workersNeeded: jobsSlotsTotal(world, colony) };
}

export function recomputeColony(world: World, colony: Colony): void {
  assignJobs(world, colony);
  colony.housing = colonyHousing(world, colony);
  const calc = computeColonyOutput(world, colony);
  colony.output = calc.output;
  colony.upkeep = calc.upkeep;
  invalidateProjection(world, colony.empireId);
}

/** Стоимость колонии: имперские модификаторы + административная нагрузка (03b §5.8). */
export function colonyCostFor(world: World, empireId: number): Partial<Record<ResourceId, number>> {
  const empire = empireById(world, empireId);
  const sprawl = empire ? sprawlConstructionCostMult(empire.systems.length, empire.colonies.length) : 1;
  return scaledCost(world.balance.colonyCost, empireModifiers(world, empireId).colonyCostMult * sprawl);
}

/** Стоимость аутпоста с имперскими модификаторами (GDD §8.5: −20% аутпост). */
export function outpostCostFor(world: World, empireId: number): Partial<Record<ResourceId, number>> {
  return scaledCost(world.balance.outpostCost, empireModifiers(world, empireId).outpostCostMult);
}

function scaledCost(
  cost: Partial<Record<ResourceId, number>>,
  mult: number,
): Partial<Record<ResourceId, number>> {
  const scale = Number.isFinite(mult) ? Math.max(0.1, mult) : 1;
  const out: Partial<Record<ResourceId, number>> = {};
  for (const key of Object.keys(cost)) {
    const res = key as ResourceId;
    const value = cost[res];
    if (typeof value !== "number" || value <= 0) continue;
    out[res] = Math.max(1, Math.round(value * scale));
  }
  return out;
}

// ------------------------------------------------------------------ проекции империи

/** Апкип флота: нелинейный множитель GDD §7.7, целочисленная аппроксимация 1+0.15·log2(1+FP/100). */
export function upkeepMultMilli(fp: number): number {
  let d = 100;
  let k = 0;
  const x = 100 + Math.max(0, fp);
  while (x >= d * 2 && k < 16) {
    d *= 2;
    k++;
  }
  const frac = Math.floor(((x - d) * 1000) / d); // 0..999
  return 1000 + Math.round((150 * (k * 1000 + frac)) / 1000);
}

export interface EmpireProjection {
  /** доход верхней панели (production − должностные затраты − апкип районов − содержание попов) */
  income: Milli;
  /** апкип зданий, энергия (фаза 6) */
  buildingEnergy: number;
  /** апкип флота, энергия (фаза 6) */
  fleetEnergy: number;
  /** апкип флота, сплавы (фаза 6) */
  fleetAlloys: number;
  fleetPower: number;
  /** итоговое изменение склада за такт (до клампа в 0): income − апкип зданий − апкип флота */
  net: Milli;
}

export function projectEmpire(world: World, empire: Empire): EmpireProjection {
  // Кэш на такт: projectEmpire вызывается в фазах дохода, апкипа и победы несколько раз.
  // Сравниваем ещё и идентичность объекта модификаторов: если технологии/традиции/перки/санкции
  // изменились в этом же такте, empireModifiers() вернёт новый объект и кэш будет пересчитан.
  const imperialMods = empireModifiers(world, empire.id);
  let cache = PROJECTION_CACHE.get(world);
  const cached = cache?.get(empire.id);
  if (cached && cached.tick === world.tick && cached.mods === imperialMods) return cached.projection;
  if (!cache) {
    cache = new Map();
    PROJECTION_CACHE.set(world, cache);
  }
  const income = zeroMilli();
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    const calc = computeColonyOutput(world, colony);
    for (const res of RESOURCE_ORDER) income[res] += calc.output[res] - calc.upkeep[res];
  }
  // База влияния «от формы правления» тоже масштабируется имперскими множителями.
  // Данные правительства (influence_flat) заменяют базовую константу, а не суммируются с ней.
  const influencePermille = Math.round(
    Math.max(0, imperialMods.production.influence * imperialMods.influenceMult) * 1000,
  );
  const governmentInfluence = empireGovernmentInfluenceFlat(world, empire.id);
  const influenceBaseMilli = Math.max(0, INFLUENCE_BASE_MILLI - Math.round(governmentInfluence * 1000));
  income.influence += mulMilli(influenceBaseMilli, influencePermille);
  // Плоские бонусы (этики/традиции/перки/мегаструктуры): +N влияния/энергии в такт.
  const flatYields = empireFlatYields(world, empire.id);
  income.influence += milliOf(flatYields.influence);
  income.energy += milliOf(flatYields.energy);

  let buildingEnergy = 0;
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    for (const buildingId of colony.buildings) {
      const def: BuildingDef | undefined = BUILDING_BY_ID[buildingId];
      if (def) buildingEnergy += milliOf(def.upkeepEnergy);
    }
  }

  let fp = 0;
  for (const fleetId of empire.fleets) {
    const fleet = world.fleets.find((f) => f.id === fleetId);
    if (!fleet) continue;
    for (const ship of fleet.ships) fp += ship.fleetPower;
  }
  const mult = upkeepMultMilli(fp);
  // Апкип флота с модификаторами доктрин/традиций/перков (GDD §9.1 п.7).
  const upkeepMod = Math.round(Math.max(0, imperialMods.fleetUpkeepMult) * 1000);
  const fleetEnergy = mulMilli(mulMilli(fp * 250, mult), upkeepMod);
  const fleetAlloys = mulMilli(mulMilli(fp * 100, mult), upkeepMod);

  const net = copyMilli(income);
  net.energy -= buildingEnergy;
  net.energy -= fleetEnergy;
  net.alloys -= fleetAlloys;
  const projection: EmpireProjection = { income, buildingEnergy, fleetEnergy, fleetAlloys, fleetPower: fp, net };
  cache.set(empire.id, { tick: world.tick, mods: imperialMods, projection });
  return projection;
}

/** Наложение милли-дельты на склад империи с накоплением остатка. */
export function addMilli(empire: Empire, res: ResourceId, deltaMilli: number): void {
  const total = empire.frac[res] + deltaMilli;
  const whole = Math.floor(total / 1000);
  empire.frac[res] = total - whole * 1000;
  empire.resources[res] += whole;
}

/** Фаза 3 такта: доход верхней панели в казну; incomeLastTick — для UI. */
export function accrue(world: World, empire: Empire): void {
  const projection = projectEmpire(world, empire);
  for (const res of RESOURCE_ORDER) {
    addMilli(empire, res, projection.income[res]);
    empire.incomeLastTick[res] = Math.floor(projection.income[res] / 1000);
  }
}

/** Фаза 6 такта: апкип зданий и флота. */
export function accrueUpkeep(world: World, empire: Empire): void {
  const projection = projectEmpire(world, empire);
  if (projection.buildingEnergy > 0) addMilli(empire, "energy", -projection.buildingEnergy);
  if (projection.fleetEnergy > 0) addMilli(empire, "energy", -projection.fleetEnergy);
  if (projection.fleetAlloys > 0) addMilli(empire, "alloys", -projection.fleetAlloys);
}

/**
 * Фаза 7: дефициты. Склад не уходит в минус (правило «мягкой смерти», GDD §7.4):
 * вместо отрицательного запаса включается флаг штрафа на следующие такты.
 */
export function applyDeficits(world: World, empire: Empire): void {
  for (const res of RESOURCE_ORDER) {
    const key = `def:${empire.id}:${res}`;
    if (empire.resources[res] < 0) {
      // апкип/дефицит увели склад в минус — «мягкая смерть»: запас 0 + штраф (GDD §7.4)
      empire.resources[res] = 0;
      empire.frac[res] = 0;
      world.flags[key] = (world.flags[key] ?? 0) + 1;
    } else if (empire.resources[res] === 0 && empire.incomeLastTick[res] < 0) {
      world.flags[key] = (world.flags[key] ?? 0) + 1;
    } else if (empire.resources[res] > 0) {
      world.flags[key] = 0;
    }
  }
}

// ------------------------------------------------------------------ население и стабильность

/** Свободные рабочие места по стратам: рост попов заполняет их в порядке правители→специалисты→рабочие (GDD §6.6). */
function growthStratum(world: World, colony: Colony): "ruler" | "specialist" | "worker" {
  const slots = colonyJobSlots(world, colony);
  const filled: Record<"ruler" | "specialist" | "worker", number> = { ruler: 0, specialist: 0, worker: 0 };
  for (const assignment of colony.jobs) {
    const job = JOB_BY_ID[assignment.jobId];
    if (!job) continue;
    filled[job.stratum] += assignment.count;
  }
  const free: Record<"ruler" | "specialist" | "worker", number> = { ruler: 0, specialist: 0, worker: 0 };
  for (const job of JOBS) {
    const slot = slots[job.id] ?? 0;
    if (slot > 0) free[job.stratum] += slot;
  }
  if (filled.ruler < free.ruler) return "ruler";
  if (filled.specialist < free.specialist) return "specialist";
  return "worker";
}

/** Фаза 1: рост попов (GDD §6.3). Дробный рост копится в world.flags["growth:<colonyId>"] (милли). */
export function growPopulation(world: World, colony: Colony): void {
  const empire = empireById(world, colony.empireId);
  if (!empire) return;
  const pops = popsTotal(colony.pops);
  const capacity = colony.housing;
  if (capacity <= 0) return;
  // Калибровка GDD §6.3: 20→40 попов за 600–700 тактов для «нормальной» колонии;
  // рост пропорционален численности (малые колонии не разгоняются экспоненциально).
  const popScale = clamp(Math.floor((pops * 1000) / 20), 0, 1000);
  const foodIncome = empire.incomeLastTick.food;
  const foodNeed = Math.max(1, Math.round(pops * world.balance.popFoodUpkeep));
  const foodRatio = clamp(Math.floor((foodIncome * 1000) / foodNeed), 0, 1000);
  const freeHousing = Math.max(0, capacity - pops);
  const housingSurplus = clamp(Math.floor((freeHousing * 1000) / Math.max(1, pops)), 0, 1000);
  const overcrowding = Math.max(0, Math.floor(((pops - capacity) * 1000) / Math.max(1, capacity)));
  const ratio = clamp(Math.floor((pops * 1000) / capacity), 0, 2000);
  // (1 − (pops/capacity)^1.5): аппроксимация целочисленной параболой
  const logistic = clamp(1000 - Math.floor((ratio * ratio) / 1000), 0, 1000);
  const mods = empireModifiers(world, colony.empireId);
  const growthMod = Math.round(Math.max(0, mods.popGrowthMult) * 1000);
  const foodDeficit = (world.flags[`def:${empire.id}:food`] ?? 0) > 0;

  let growth = Math.floor(world.balance.growthBase * 1000);
  growth = mulMilli(growth, popScale);
  growth = mulMilli(growth, 1000 + Math.floor((400 * foodRatio) / 1000));
  growth = mulMilli(growth, 1000 + Math.floor((200 * housingSurplus) / 1000));
  growth = mulMilli(growth, clamp(1000 - Math.floor((100 * overcrowding) / 1000), 0, 1000));
  growth = mulMilli(growth, logistic);
  growth = mulMilli(growth, growthMod);
  growth = mulMilli(growth, 700); // калибровка темпа: ~0.03 поп/такт на колонию при норме
  if (foodDeficit) growth = mulMilli(growth, 600); // GDD §6.3: голод −40% роста

  const key = `growth:${colony.id}`;
  let acc = (world.flags[key] ?? 0) + growth;
  while (acc >= 1000) {
    acc -= 1000;
    if (popsTotal(colony.pops) + 1 > capacity) break;
    const stratum = growthStratum(world, colony);
    if (stratum === "ruler") colony.pops.rulers += 1;
    else if (stratum === "specialist") colony.pops.specialists += 1;
    else colony.pops.workers += 1;
  }
  world.flags[key] = Math.max(0, acc);
}

/** Фаза 8: стабильность, счастье и преступность (GDD §6.4, §6.7). */
export function updateStability(world: World, colony: Colony): void {
  const empire = empireById(world, colony.empireId);
  if (!empire) return;
  const pops = popsTotal(colony.pops);
  let stability = world.balance.stabilityBase;
  // Традиции/перки/этики: плоские бонусы стабильности и счастья (GDD §8.5).
  const mods = empireModifiers(world, colony.empireId);
  stability += mods.stabilityBonus + mods.happinessBonus;
  for (const buildingId of colony.buildings) {
    const def = BUILDING_BY_ID[buildingId];
    if (def && def.stability) stability += def.stability;
  }
  stability -= colony.pops.unemployed * 2;
  stability -= Math.max(0, Math.floor(((pops - colony.housing) * 1000) / Math.max(1, colony.housing)) / 100) * 5;
  if ((world.flags[`def:${empire.id}:food`] ?? 0) > 0) stability -= 25;
  if ((world.flags[`def:${empire.id}:goods`] ?? 0) > 0) stability -= 15;
  if (empireAtWar(empire)) stability -= 10;
  colony.stability = clamp(stability, 0, 100);
  const density = Math.floor((pops * 20) / Math.max(1, colony.housing));
  colony.crime = clamp(Math.floor(50 - 0.7 * colony.stability + 0.3 * density), 0, 100);
}

/** Война с реальными империями (пиратская фракция не считается «войной» для стабильности). */
export function empireAtWar(empire: Empire): boolean {
  for (const key of Object.keys(empire.relations)) {
    const otherId = Number(key);
    const rel = empire.relations[otherId];
    if (otherId === 9) continue; // пираты: демо-угроза, не постоянная война
    if (rel && rel.treaty === "war") return true;
  }
  return false;
}

// ------------------------------------------------------------------ наука

// Catch-up (GDD §8.8): отстающая школа получает бонус к очкам науки (прокси скидки стоимости).
// Прокси к скидке стоимости: tick.ts не наш файл, поэтому ускоряем именно очки (до +80%).
interface SchoolTierSnapshot { tick: number; signature: string; leader: Record<ScienceId, number> }
const SCHOOL_TIER_CACHE = new WeakMap<World, SchoolTierSnapshot>();

function schoolTierOf(empire: Empire, school: ScienceId): number {
  let tier = -1;
  for (const techId of empire.techs.completed) {
    const tech = TECH_BY_ID[techId];
    if (tech && tech.school === school && tech.tier > tier) tier = tech.tier;
  }
  return tier;
}

/** Максимальный тир по каждой школе среди живых империй (кэш на такт, GDD §8.8). */
export function leaderSchoolTiers(world: World): Record<ScienceId, number> {
  const signature = world.tick + ":" + world.empires.map((e) => e.techs.completed.length).join(",");
  const cached = SCHOOL_TIER_CACHE.get(world);
  if (cached && cached.signature === signature) return cached.leader;
  const leader: Record<ScienceId, number> = { physics: 0, society: 0, engineering: 0 };
  for (const empire of world.empires) {
    if (empire.dead || empire.id >= 90) continue;
    for (const school of SCIENCE_ORDER) {
      const tier = schoolTierOf(empire, school);
      if (tier > leader[school]) leader[school] = tier;
    }
  }
  SCHOOL_TIER_CACHE.set(world, { tick: world.tick, signature, leader });
  return leader;
}

/** Множитель catch-up для школы: ≥1.0; при отставании ≥20% от лидера — до +80% (GDD §8.8). */
export function catchUpScienceMult(world: World, empire: Empire, school: ScienceId): number {
  const leader = leaderSchoolTiers(world)[school];
  if (leader <= 0) return 1;
  const own = schoolTierOf(empire, school);
  if (own >= leader) return 1;
  const deficitRatio = (leader - own) / leader; // 0..1
  if (deficitRatio < 0.2) return 1;
  return 1 + Math.min(0.8, 0.8 * deficitRatio);
}

/** Очки науки по школам за такт (милли): исследователи 40/40/20, здания — прямо, столица — общество. */
export function computeScience(world: World, empire: Empire): Record<ScienceId, number> {
  const mods = empireModifiers(world, empire.id);
  const schoolMods = empireSchoolScience(world, empire.id);
  const flatYields = empireFlatYields(world, empire.id);
  let researcherMilli = 0;
  const direct = zeroScience();
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    for (const assignment of colony.jobs) {
      const job = JOB_BY_ID[assignment.jobId];
      if (job && job.id === "researcher") {
        researcherMilli += milliOf(world.balance.sciencePerResearcher) * assignment.count;
      }
    }
    for (const buildingId of colony.buildings) {
      const def = BUILDING_BY_ID[buildingId];
      if (!def) continue;
      if (def.science) {
        for (const school of SCIENCE_ORDER) {
          const value = def.science[school];
          if (typeof value === "number") direct[school] += milliOf(value);
        }
      }
    }
  }
  const goodsDeficit = (world.flags[`def:${empire.id}:goods`] ?? 0) > 0;
  const scienceScale = goodsDeficit ? 800 : 1000; // GDD §7.4: дефицит ТП −20% науки
  const out: Record<ScienceId, number> = { physics: 0, society: 0, engineering: 0 };
  for (const school of SCIENCE_ORDER) {
    let value = mulMilli(researcherMilli, SCIENCE_WEIGHTS[school]);
    value += direct[school];
    // Школьные бонусы (physics/society/engineering_prod) → глобальный science → дефицит.
    value = mulMilli(value, Math.round(Math.max(0, schoolMods[school]) * 1000));
    value = mulMilli(value, Math.round(Math.max(0, mods.science) * 1000));
    // Catch-up GDD §8.8: отстающие школы ускоряются (анти-снежок по науке).
    value = mulMilli(value, Math.round(catchUpScienceMult(world, empire, school) * 1000));
    value = mulMilli(value, scienceScale);
    // Плоские «+N очков каждой школе» (традиции/цивики, GDD §8.5): без процентных множителей.
    value += milliOf(flatYields.sciencePerSchool);
    out[school] = value;
  }
  return out;
}

export { SCIENCE_ORDER };
