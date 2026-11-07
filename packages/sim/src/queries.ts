/**
 * ЗАПРОСЫ ДЛЯ UI (только чтение, без мутаций) + createWorld.
 * Тултипы обязаны раскрывать формулу: getIncomeBreakdown возвращает строки
 * «база → модификаторы → итог» (GDD §13, 03b §15.3).
 */
import {
  BUILDING_BY_ID, DESIGN_BY_ID, DISTRICT_BY_ID, HULL_BY_ID, JOB_BY_ID, MISSIONS, MODULE_BY_ID,
  RESOURCES, RESOURCE_BY_ID, TECHS, TECHS_EXTRA, TECH_BY_ID, WEAPON_BY_ID,
} from "@sf/data";
import type {
  BalanceConfig, BuildingDef, DistrictDef, HullDef, JobDef, MissionDef, ModeConfig, ModuleDef,
  ShipDesignDef, TechDef, WeaponDef,
} from "@sf/data";
import { computeHops, generateGalaxy } from "./galaxy";
import { nextInt, nextRange } from "./prng";
import type { RngState } from "./prng";
import {
  clamp, colonyHousing, computeColonyOutput, computeScience, createColony, createFleet, createShip,
  empireById, findPlanet, hasTech, milliOf, mulMilli, popsTotal, projectEmpire, techModifiers,
  techUnlocked, updateStability, zeroMilli, zeroResources, zeroScience,
} from "./economy";
import type { ColonyInit } from "./economy";
import { RESOURCE_ORDER, SCIENCE_ORDER } from "./types";
import { createFullGameState } from "./fullgame";
import { applyRaceStartBonuses } from "./ancients";
import {
  availableShipParts, computeDesignStats, findCustomDesign, getCustomDesigns as listCustomDesigns,
} from "./designs";
import type { DesignDraft } from "./types";
import { empireFlatYields, empireGovernmentInfluenceFlat, empireModifiers } from "./modifiers";
import type {
  BuildKind, Colony, Empire, Fleet, GameEvent, GameEvent as _GameEvent, IncomeBreakdown, IncomeLine,
  Milli, Planet, Resources, ResourceId, ScoreBreakdown, ScienceId, SciencePoints, Ship, StarSystem,
  Station, StationMarket, VictoryState, World,
} from "./types";

export { SCIENCE_ORDER };

// ---------------------------------------------------------------- контент @sf/data

export function getShipDesign(id: string): ShipDesignDef | undefined {
  return DESIGN_BY_ID[id];
}
export function getHull(id: string): HullDef | undefined {
  return HULL_BY_ID[id];
}
export function getWeapon(id: string): WeaponDef | undefined {
  return WEAPON_BY_ID[id];
}
export function getModule(id: string): ModuleDef | undefined {
  return MODULE_BY_ID[id];
}
export function getTech(id: string): TechDef | undefined {
  return TECH_BY_ID[id];
}
export function getBuilding(id: string): BuildingDef | undefined {
  return BUILDING_BY_ID[id];
}
export function getDistrict(id: string): DistrictDef | undefined {
  return DISTRICT_BY_ID[id];
}
export function getJob(id: string): JobDef | undefined {
  return JOB_BY_ID[id];
}
export function getMissionDef(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

// ---------------------------------------------------------------- флот и лимиты

export function getFleetPower(fleet: Fleet): number {
  let fp = 0;
  for (const ship of fleet.ships) fp += ship.fleetPower;
  return fp;
}

export function getEmpireFleetPower(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  let fp = 0;
  for (const fleetId of empire.fleets) {
    const fleet = world.fleets.find((f) => f.id === fleetId);
    if (fleet) fp += getFleetPower(fleet);
  }
  return fp;
}

/** GDD §9.5 + balance.json: baseFleetCap + popsFleetCap·pops + systemsFleetCap·systems + верфи/эффекты зданий + flat от технологий. */
export function getFleetCap(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return 0;
  let pops = 0;
  let shipyardSmall = 0;
  let shipyardLarge = 0;
  let buildingFlat = 0;
  let stationShipyards = 0;
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    pops += popsTotal(colony.pops);
    for (const buildingId of colony.buildings) {
      const def = BUILDING_BY_ID[buildingId];
      if (!def || !def.effects) continue;
      buildingFlat += def.effects.fleet_cap ?? 0;
      shipyardSmall += def.effects.shipyard_small ?? 0;
      shipyardLarge += def.effects.shipyard_large ?? 0;
    }
  }
  for (const systemId of empire.systems) {
    const system = world.systems[systemId];
    if (system && system.station && system.station.hasShipyard && system.station.ownerId === empire.id) stationShipyards += 1;
  }
  // Сводные модификаторы империи (технологии/традиции/перки/федерация/мегаструктуры).
  const mods = empireModifiers(world, empireId);
  const percent = 1000 + Math.round(mods.fleetCapPct * 10);
  const raw = world.balance.baseFleetCap
    + world.balance.popsFleetCap * pops
    + world.balance.systemsFleetCap * empire.systems.length
    + 2 * shipyardSmall
    + 8 * shipyardLarge
    + 2 * stationShipyards
    + buildingFlat
    + mods.fleetCapFlat;
  return Math.max(0, Math.floor((Math.floor(raw) * percent) / 1000));
}

// ---------------------------------------------------------------- счёт и победа

export function getScore(world: World, empireId: number): ScoreBreakdown {
  const empire = empireById(world, empireId);
  if (!empire) {
    return { population: 0, systems: 0, techs: 0, fleetPower: 0, economy: 0, total: 0 };
  }
  let pops = 0;
  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (colony) pops += popsTotal(colony.pops);
  }
  const systems = empire.systems.length;
  const techs = empire.stats.techsResearched;
  const fg = world.fg;
  const adv = fg ? fg.empires[empireId] : undefined;
  // M6/M12: прогресс традиций/перков и активные мегаструктуры входят в «прогресс» счёта.
  const traditionPoints = adv ? adv.traditions.unlocked.length * 2 + adv.traditions.finishers.length * 6 : 0;
  const perkPoints = adv ? adv.perks.length * 8 : 0;
  const megastructurePoints = fg
    ? fg.megastructures.filter((mega) => mega.active && mega.ownerId === empireId).length * 12
    : 0;
  const fp = getEmpireFleetPower(world, empireId);
  const projection = projectEmpire(world, empire);
  let gdpMilli = 0;
  for (const res of RESOURCE_ORDER) {
    if (projection.income[res] <= 0) continue;
    const def = RESOURCE_BY_ID[res];
    gdpMilli += mulMilli(projection.income[res], milliOf(def.wholesale));
  }
  const gdp = Math.floor(gdpMilli / 1000);
  const population = Math.floor(pops * 0.4);
  const systemsScore = systems * 8;
  const techsScore = Math.floor(techs * 3 * 0.8) + traditionPoints + perkPoints + megastructurePoints;
  const fleetScore = Math.floor(fp * 0.15 * 0.7);
  const economy = Math.floor(gdp * 0.5 * 0.6);
  return {
    population,
    systems: systemsScore,
    techs: techsScore,
    fleetPower: fleetScore,
    economy,
    total: population + systemsScore + techsScore + fleetScore + economy,
  };
}

function gdpCredits(world: World, empire: Empire): number {
  const projection = projectEmpire(world, empire);
  let gdpMilli = 0;
  for (const res of RESOURCE_ORDER) {
    if (projection.income[res] <= 0) continue;
    gdpMilli += mulMilli(projection.income[res], milliOf(RESOURCE_BY_ID[res].wholesale));
  }
  return Math.floor(gdpMilli / 1000);
}

/** Условия победы (GDD §16.1): доминирование, экономическая гегемония, счёт на финальном такте. */
export function getVictory(world: World): VictoryState {
  // Полная игра: победу считает victoryPhase()/victory.ts, legacy-логика среза не должна
  // завершать партию раньше таймлайна (иначе кризисы 4600/5200 и 6 условий не успевают).
  if (world.fg) return world.victory;

  if (world.victory.achieved) return world.victory;
  const alive = world.empires.filter((e) => !e.dead && e.id !== 9);
  const totalSystems = world.systems.length;
  // доминирование: > 50% систем галактики (мягкий порог, GDD §16.1 — 45%)
  for (const empire of alive) {
    let owned = 0;
    for (const system of world.systems) if (system.ownerId === empire.id) owned++;
    if (owned > totalSystems * 0.5) {
      return { achieved: "domination", tickAchieved: world.tick, winnerEmpireId: empire.id };
    }
  }
  // экономическая гегемония: ≥40% галактического ВВП 300 тактов подряд
  let totalGdp = 0;
  const gdps: number[] = [];
  for (const empire of world.empires) {
    if (empire.dead) {
      gdps.push(0);
      continue;
    }
    const gdp = gdpCredits(world, empire);
    gdps.push(gdp);
    totalGdp += gdp;
  }
  if (totalGdp > 0) {
    for (let i = 0; i < world.empires.length; i++) {
      const empire = world.empires[i];
      if (empire.dead) continue;
      const share = gdps[i] / totalGdp;
      const key = `econ_share_ticks:${empire.id}`;
      const ticks = world.flags[key] ?? 0;
      if (share >= 0.4 && ticks >= 300) {
        return { achieved: "economy", tickAchieved: world.tick, winnerEmpireId: empire.id };
      }
    }
  }
  // счёт на финальном такте
  if (world.tick >= world.balance.maxTicks) {
    let bestId = 0;
    let bestScore = -1;
    for (const empire of alive) {
      const score = getScore(world, empire.id).total;
      if (score > bestScore) {
        bestScore = score;
        bestId = empire.id;
      }
    }
    return { achieved: "score", tickAchieved: world.tick, winnerEmpireId: bestId };
  }
  return { achieved: null, tickAchieved: 0, winnerEmpireId: 0 };
}

// ---------------------------------------------------------------- экономика для UI

export function getColonyOutput(world: World, colony: Colony): { output: Milli; upkeep: Milli; workersNeeded: number } {
  return computeColonyOutput(world, colony);
}

export function getBuildCost(world: World, kind: BuildKind, id: string): Partial<Resources> {
  if (kind === "district") {
    const def = DISTRICT_BY_ID[id];
    return def ? { ...def.cost } : {};
  }
  if (kind === "building") {
    const def = BUILDING_BY_ID[id];
    return def ? { ...def.cost } : {};
  }
  const design = DESIGN_BY_ID[id];
  if (design) return { alloys: design.costAlloys };
  const custom = findCustomDesign(world, id);
  if (custom) return { alloys: custom.costAlloys };
  return {};
}

// ---------------------------------------------------------------- конструктор кораблей (M5/M12)

/** Пользовательские дизайны: все или только указанной империи (для UI верфи). */
export function getCustomDesigns(world: World, empireId?: number) {
  return listCustomDesigns(world, empireId);
}

/** Готовый шаблон @sf/data или пользовательский дизайн по id. */
export function getDesignById(world: World, designId: string) {
  return DESIGN_BY_ID[designId] ?? findCustomDesign(world, designId);
}

/** Доступные технологии империи компоненты конструктора (UI фильтрует по слотам). */
export function getAvailableShipParts(world: World, empireId: number) {
  return availableShipParts(world, empireId);
}

/** Детальная валидация черновика для UI конструктора (коды ошибок — для логики). */
export function validateShipDesign(world: World, empireId: number, draft: DesignDraft) {
  const detailed = computeDesignStats(world, empireId, draft);
  return {
    ok: detailed.ok,
    errors: detailed.errors,
    warnings: detailed.warnings,
    stats: detailed.stats,
    requiredTechs: detailed.requiredTechs,
  };
}

/** Предпросмотр дизайна для UI (человекочитаемые ошибки + статы как в макете). */
export function getDesignPreview(world: World, empireId: number, draft: DesignDraft) {
  const detailed = computeDesignStats(world, empireId, draft);
  return {
    ok: detailed.ok,
    errorsRu: detailed.errors.map((error) => error.messageRu),
    warningsRu: detailed.warnings.map((warning) => warning.messageRu),
    stats: {
      fleetPower: detailed.stats.fleetPower,
      costAlloys: detailed.stats.costAlloys,
      costCredits: detailed.stats.costCredits,
      buildTicks: detailed.stats.buildTicks,
      mass: detailed.stats.mass,
      powerDraw: detailed.stats.powerUse,
      powerOutput: detailed.stats.powerMax,
      heatNet: detailed.stats.heat,
      slotsUsed: { ...detailed.stats.slotsUsed, total: detailed.stats.slotsUsed.small + detailed.stats.slotsUsed.medium + detailed.stats.slotsUsed.large + detailed.stats.slotsUsed.utility + detailed.stats.slotsUsed.internal },
      requiredTechs: detailed.requiredTechs,
    },
  };
}

export function canAfford(world: World, empireId: number, cost: Partial<Resources>): boolean {
  const empire = empireById(world, empireId);
  if (!empire) return false;
  for (const key of Object.keys(cost)) {
    const res = key as ResourceId;
    const need = cost[res];
    if (typeof need !== "number" || need <= 0) continue;
    if (empire.resources[res] < need) return false;
  }
  return true;
}

export function getProjectedIncome(world: World, empireId: number): Resources {
  const empire = empireById(world, empireId);
  if (!empire) return zeroResources();
  const projection = projectEmpire(world, empire);
  const out = zeroResources();
  for (const res of RESOURCE_ORDER) {
    const total = empire.frac[res] + projection.net[res];
    out[res] = Math.floor(total / 1000);
  }
  return out;
}

/** Разбор дохода по формуле «база → модификаторы → итог» (GDD §7.3, 03b §15.3). */
export function getIncomeBreakdown(world: World, empireId: number, resource: ResourceId): IncomeBreakdown {
  const empire = empireById(world, empireId);
  if (!empire) return { resource, totalMilli: 0, lines: [] };
  // Сводные модификаторы (технологии + традиции + перки + санкции + давление финала).
  const imperial = empireModifiers(world, empireId);
  let resMult = imperial.production[resource];
  if (resource === "unity") resMult *= imperial.unityMult;
  else if (resource === "influence") resMult *= imperial.influenceMult;
  const prodMod = Math.round(Math.max(0, resMult) * 1000);
  // Для тултипа отделяем вклад только технологий от остальных источников.
  const techProdMod = 1000 + (techModifiers(empire)[`${resource}_prod`] ?? 0);
  const energyDeficit = (world.flags[`def:${empire.id}:energy`] ?? 0) > 0;
  const deficitScale = energyDeficit ? 750 : 1000;

  let base = 0;
  let deposit = 0;
  let afterTech = 0;
  let afterMods = 0;
  let afterStability = 0;
  let jobInputs = 0;
  let districtUpkeep = 0;
  let popUpkeep = 0;

  for (const colonyId of empire.colonies) {
    const colony = world.colonies.find((c) => c.id === colonyId);
    if (!colony) continue;
    const stabilityMod = clamp(600 + 6 * colony.stability, 600, 1200);
    for (const assignment of colony.jobs) {
      const job = JOB_BY_ID[assignment.jobId];
      if (!job) continue;
      const outputBase = job.output[resource];
      if (typeof outputBase === "number" && outputBase > 0) {
        const baseMilli = milliOf(outputBase) * assignment.count;
        const appliedTotal = mulMilli(baseMilli, prodMod) - baseMilli;
        const techApplied = mulMilli(baseMilli, techProdMod) - baseMilli;
        const stabApplied = mulMilli(baseMilli + appliedTotal, stabilityMod) - (baseMilli + appliedTotal);
        base += baseMilli;
        afterTech += techApplied;
        afterMods += appliedTotal - techApplied;
        afterStability += stabApplied;
      }
      const inputBase = job.input?.[resource];
      if (typeof inputBase === "number" && inputBase > 0 && resource !== "goods") {
        jobInputs += milliOf(inputBase) * assignment.count;
      }
    }
    if (resource === "energy") {
      for (const districtId of Object.keys(colony.districts)) {
        const def = DISTRICT_BY_ID[districtId];
        if (def) districtUpkeep += milliOf(def.upkeepEnergy) * (colony.districts[districtId] ?? 0);
      }
    }
    if (resource === "food") popUpkeep += popsTotal(colony.pops) * milliOf(world.balance.popFoodUpkeep);
    if (resource === "goods") {
      popUpkeep += colony.pops.workers * milliOf(world.balance.popGoodsUpkeep.worker ?? 0);
      popUpkeep += colony.pops.specialists * milliOf(world.balance.popGoodsUpkeep.specialist ?? 0);
      popUpkeep += colony.pops.rulers * milliOf(world.balance.popGoodsUpkeep.ruler ?? 0);
    }
  }

  const production = base + deposit + afterTech + afterMods + afterStability;
  const finalProduction = Math.floor((production * deficitScale) / 1000);
  const deficitPenalty = finalProduction - production;

  // Апкип зданий и флота списывается в фазе 6 такта — включаем в формулу, чтобы итог
  // совпадал с фактическим приростом запаса (HUD/тултипы, acceptance M2).
  const projection = projectEmpire(world, empire);
  const buildingUpkeep = resource === "energy" ? projection.buildingEnergy : 0;
  const fleetUpkeep = resource === "energy" ? projection.fleetEnergy
    : resource === "alloys" ? projection.fleetAlloys : 0;

  const lines: IncomeLine[] = [];
  lines.push({ labelRu: "База производства (профессии)", valueMilli: base });
  const governmentInfluence = empireGovernmentInfluenceFlat(world, empireId);
  const influenceBaseMilli = mulMilli(
    Math.max(0, 1000 - Math.round(governmentInfluence * 1000)),
    Math.round(Math.max(0, imperial.production.influence * imperial.influenceMult) * 1000),
  );
  if (resource === "influence") {
    lines.push({ labelRu: "База империи (форма правления)", valueMilli: influenceBaseMilli, detailRu: "+1 влияние/такт от формы правления (GDD §19.1)" });
  }
  if (deposit !== 0) lines.push({ labelRu: "Бонус депозитов планеты", valueMilli: deposit, detailRu: "0.25 за единицу депозита к добывающей профессии" });
  if (afterTech !== 0) lines.push({ labelRu: "Бонусы технологий", valueMilli: afterTech });
  if (afterMods !== 0) lines.push({ labelRu: "Традиции, перки и империя", valueMilli: afterMods });
  // Плоские бонусы империи: +энергия/+влияние в такт (традиции/перки/мегаструктуры).
  const flatYields = empireFlatYields(world, empireId);
  let flatResourceMilli = 0;
  if (resource === "energy") flatResourceMilli += milliOf(flatYields.energy);
  if (resource === "influence") flatResourceMilli += milliOf(flatYields.influence);
  if (flatResourceMilli !== 0) lines.push({ labelRu: "Плоские бонусы империи", valueMilli: flatResourceMilli });
  if (afterStability !== 0) lines.push({ labelRu: "Модификатор стабильности", valueMilli: afterStability, detailRu: "0.60 + 0.006 × стабильность, зажим 0.60…1.20" });
  if (deficitPenalty !== 0) lines.push({ labelRu: "Штраф дефицита энергии", valueMilli: deficitPenalty, detailRu: "−25% производства при дефиците энергии" });
  if (jobInputs !== 0) lines.push({ labelRu: "Содержание должностей", valueMilli: -jobInputs });
  if (districtUpkeep !== 0) lines.push({ labelRu: "Апкип районов", valueMilli: -districtUpkeep });
  if (popUpkeep !== 0) lines.push({ labelRu: "Апкип населения", valueMilli: -popUpkeep });
  if (buildingUpkeep !== 0) lines.push({ labelRu: "Апкип зданий", valueMilli: -buildingUpkeep, detailRu: "энергия на содержание зданий (фаза 6)" });
  if (fleetUpkeep !== 0) lines.push({ labelRu: "Апкип флота", valueMilli: -fleetUpkeep, detailRu: "FP × (0.25 E + 0.10 A) × анти-снежок (фаза 6)" });
  const flatBase = resource === "influence" ? influenceBaseMilli : 0;
  const net = finalProduction - jobInputs - districtUpkeep - popUpkeep - buildingUpkeep - fleetUpkeep
    + flatBase + flatResourceMilli;
  return { resource, totalMilli: net, lines };
}

// ---------------------------------------------------------------- подсказки для флота

export function getFleetInSystem(world: World, systemId: number, empireId: number): Fleet[] {
  return world.fleets
    .filter((f) => f.systemId === systemId && f.empireId === empireId && f.ships.length > 0)
    .sort((a, b) => a.id - b.id);
}

export function getEnemyFleetsInSystem(world: World, systemId: number, empireId: number): Fleet[] {
  return world.fleets
    .filter((f) => f.systemId === systemId && f.empireId !== empireId && f.ships.length > 0)
    .sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------- createWorld

const EMPIRE_COLORS = [
  "#4FC3F7", "#F06292", "#AED581", "#FFD54F", "#BA68C8", "#4DB6AC", "#FF8A65", "#90A4AE", "#E57373",
];

function cloneResources(res: Partial<Record<ResourceId, number>>): Resources {
  const out = zeroResources();
  for (const key of Object.keys(res)) {
    const id = key as ResourceId;
    const value = res[id];
    if (typeof value === "number") out[id] = value;
  }
  return out;
}

function pushEvent(
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

function makeEmpire(world: World, id: number, name: string, color: string, isPlayer: boolean, capitalSystemId: number): Empire {
  const empire: Empire = {
    id,
    name,
    color,
    isPlayer,
    capitalSystemId,
    dead: false,
    resources: cloneResources(world.balance.startResources),
    frac: zeroMilli(),
    science: zeroScience(),
    scienceFrac: zeroScience(),
    incomeLastTick: zeroResources(),
    scienceLastTick: zeroScience(),
    techs: {
      completed: [],
      progress: {
        physics: { techId: null, points: 0, frac: 0 },
        society: { techId: null, points: 0, frac: 0 },
        engineering: { techId: null, points: 0, frac: 0 },
      },
      offers: { physics: [], society: [], engineering: [] },
    },
    systems: [],
    colonies: [],
    fleets: [],
    relations: {},
    ai: isPlayer ? null : {
      focus: "expand",
      aggression: 20 + id * 8,
      nextDecisionTick: 4 + id * 3,
      targetSystemId: 0,
      colonizeCooldown: 0,
    },
    flagshipFleetId: 0,
    stats: {
      techsResearched: 0,
      coloniesFounded: 0,
      shipsBuilt: 0,
      shipsLost: 0,
      battlesWon: 0,
      battlesLost: 0,
      creditsEarned: 0,
    },
  };
  world.empires.push(empire);
  return empire;
}

/** Гарантирует в системе планету с обитаемостью не ниже minHab (мутирует первую неподходящую). */
function ensureHabitable(system: StarSystem, minHab: number, rng: RngState): Planet {
  for (const planet of system.planets) {
    if (!planet.isMoon && planet.habitability >= minHab && planet.ownerId === 0) return planet;
  }
  for (const planet of system.planets) {
    if (planet.isMoon) continue;
    if (planet.ownerId !== 0) continue;
    if (planet.type === "gas_giant" || planet.habitability > 0) continue;
    planet.type = "continental";
    planet.habitability = nextRange(rng as never, Math.max(minHab, 65), 88);
    planet.deposits = { minerals: Math.max(3, planet.deposits.minerals), energy: planet.deposits.energy, rare: planet.deposits.rare };
    planet.scanned = true;
    return planet;
  }
  const planet = system.planets[0];
  planet.type = "continental";
  planet.habitability = Math.max(minHab, 70);
  planet.scanned = true;
  return planet;
}

function stationMarketFromRetail(rng: RngState, scale: number): StationMarket {
  const market: StationMarket = {};
  const goods: ResourceId[] = ["energy", "minerals", "food", "alloys", "goods"];
  for (const id of goods) {
    const def = RESOURCE_BY_ID[id];
    if (!def) continue;
    market[id] = {
      stock: nextRange(rng as never, 200, 800),
      price: Math.round(def.retail * scale * (0.95 + 0.1 * (nextInt(rng as never, 1000) / 1000))),
    };
  }
  return market;
}

let techPoolCache: TechDef[] | null = null;
let techByIdCache: Record<string, TechDef> | null = null;

/** Полный пул технологий: базовые @sf/data + TECHS_EXTRA полной игры (без дублей). */
export function techPool(): TechDef[] {
  if (techPoolCache) return techPoolCache;
  const pool: TechDef[] = [...TECHS];
  const seen = new Set(pool.map((tech) => tech.id));
  for (const tech of TECHS_EXTRA) {
    if (seen.has(tech.id)) continue;
    pool.push(tech as unknown as TechDef);
    seen.add(tech.id);
  }
  techPoolCache = pool;
  return pool;
}

/** Полный реестр технологий (TECHS + TECHS_EXTRA); единая точка для исследований. */
export function techById(): Record<string, TechDef> {
  if (!techByIdCache) {
    const out: Record<string, TechDef> = {};
    for (const tech of techPool()) out[tech.id] = tech;
    techByIdCache = out;
  }
  return techByIdCache;
}

/** Текущий максимум тира школы по завершённым технологиям (GDD §8.3). */
export function techMaxTier(empire: Empire, school: ScienceId): number {
  const registry = techById();
  let maxTier = 0;
  for (const techId of empire.techs.completed) {
    const tech = registry[techId] ?? TECH_BY_ID[techId];
    if (!tech || tech.school !== school) continue;
    if (tech.tier > maxTier) maxTier = tech.tier;
  }
  return maxTier;
}

/** Потолок пула: не более чем на 1 тир выше текущего максимума школы (GDD §8.3). */
export function techTierCap(empire: Empire, school: ScienceId): number {
  return techMaxTier(empire, school) + 1;
}

/**
 * Взвешенный пул «1 из 3» (GDD §8.3): доступные по пререквизитам технологии школы,
 * не выше потолка тира; выбор без повторов, ≥1 технология своей школы (пул уже отфильтрован).
 * extraTechChoice (традиция «Открытие», перк «Технократия») расширяет тройку до 5.
 */
export function generateTechOffers(world: World, empire: Empire, school: ScienceId): string[] {
  const byId = techById();
  const cap = techTierCap(empire, school);
  const pool = techPool()
    .filter((tech) => {
      if (tech.school !== school) return false;
      if (tech.tier > cap) return false;
      if (empire.techs.completed.includes(tech.id)) return false;
      if (tech.branch) return false;
      if (tech.requires) {
        for (const req of tech.requires) if (!empire.techs.completed.includes(req)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((tech) => tech.id);

  const extra = Math.max(0, Math.round(empireModifiers(world, empire.id).extraTechChoice));
  const want = Math.min(5, Math.max(1, 3 + extra));
  const offers: string[] = [];
  while (offers.length < want && pool.length > 0) {
    let total = 0;
    for (const id of pool) total += Math.max(1, Math.round(byId[id]?.weight ?? 1));
    let roll = nextInt(world.rngState, Math.max(1, total));
    let chosen = pool[0];
    for (const id of pool) {
      roll -= Math.max(1, Math.round(byId[id]?.weight ?? 1));
      if (roll < 0) {
        chosen = id;
        break;
      }
    }
    offers.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }
  return offers;
}

function setupPlayerColony(world: World, empire: Empire, planet: Planet, kind: "capital" | "colony"): Colony {
  let init: ColonyInit;
  if (kind === "capital") {
    init = {
      pops: { workers: 12, specialists: 6, rulers: 2 },
      districts: {
        residential: 1,
        energy_district: 2,
        mining_district: 2,
        agriculture_district: 2,
        industrial_district: 2,
      },
      // Данные @sf/data: 1 лаборатория даёт 2 исследователя; фабрика ТП/центр единства
      // добавили бы лишние специальности (баланс старта §19.1 сходится без них).
      buildings: ["capital", "laboratory", "temple", "barracks", "shipyard"],
    };
  } else {
    init = { pops: { workers: 2, specialists: 0, rulers: 0 }, districts: {}, buildings: [] };
  }
  const colony = createColony(world, empire, planet, init);
  if (kind === "capital") {
    planet.type = "continental";
    planet.size = 5;
    planet.habitability = 85;
    planet.deposits = { minerals: 4, energy: 4, rare: 1 };
    planet.scanned = true;

  }
  updateStability(world, colony);
  return colony;
}

function setupAiColony(world: World, empire: Empire, planet: Planet, capital: boolean): Colony {
  const init: ColonyInit = capital
    ? {
      pops: { workers: 6, specialists: 3, rulers: 1 },
      districts: { residential: 1, energy_district: 1, mining_district: 1, agriculture_district: 1, industrial_district: 1 },
      buildings: ["capital", "laboratory", "shipyard", "goods_factory"],
    }
    : { pops: { workers: 2, specialists: 0, rulers: 0 }, districts: {}, buildings: [] };
  const colony = createColony(world, empire, planet, init);
  updateStability(world, colony);
  return colony;
}

function setupFleet(world: World, empire: Empire, systemId: number, designIds: string[], name: string): Fleet {
  const ships: Ship[] = [];
  const shipNameBase = ["Стриж", "Клинок", "Заря", "Взгляд", "Вьюк", "Молот", "Копьё", "Щит"];
  for (let i = 0; i < designIds.length; i++) {
    const designId = designIds[i];
    const design = DESIGN_BY_ID[designId];
    if (!design) continue;
    const isFlagship = designId === "player_flagship";
    const shipName = isFlagship ? "Первый Свет" : `${shipNameBase[i % shipNameBase.length]}-${i + 1}`;
    ships.push(createShip(world.nextId++, designId, shipName, isFlagship));
  }
  if (ships.length === 0) throw new Error(`Не удалось создать флот: ${designIds.join(",")}`);
  const fleet = createFleet(world, empire.id, systemId, ships, name, "echelon");
  empire.stats.shipsBuilt += ships.length;
  return fleet;
}

function createCapitalStation(world: World, system: StarSystem, empire: Empire): Station {
  const market = stationMarketFromRetail(world.rngState, 1);
  const station: Station = {
    id: world.nextId++,
    systemId: system.id,
    ownerId: empire.id,
    kind: "trade",
    nameRu: world.empires.length > 0 ? `${system.name}: Торговая станция` : "Торговая станция",
    hp: 900,
    maxHp: 900,
    market,
    marketTick: 0,
    hasShipyard: true,
    hasMissions: true,
  };
  system.station = station;
  return station;
}

/** Инициализирует миссии станций: 3–5 контрактов на станцию (не более 40 в мире). */
function generateStationMissions(world: World, hops: number[], limit = 40): void {
  let count = 0;
  for (const system of world.systems) {
    if (count >= limit) break;
    const station = system.station;
    if (!station || !station.hasMissions) continue;
    const systemHops = hops[system.id];
    if (systemHops < 0 || systemHops > 10) continue;
    const contractCount = nextRange(world.rngState, 3, 5);
    for (let i = 0; i < contractCount && count < limit; i++) {
      const def = MISSIONS[nextInt(world.rngState, MISSIONS.length)];
      const targetCandidates: number[] = [];
      for (const candidate of world.systems) {
        const h = hops[candidate.id];
        if (h >= 2 && h <= 8) targetCandidates.push(candidate.id);
      }
      const targetSystem = targetCandidates.length > 0
        ? targetCandidates[nextInt(world.rngState, targetCandidates.length)]
        : system.id;
      const jumps = Math.max(1, hops[targetSystem] ?? 1);
      world.missions.push({
        id: world.nextId++,
        defId: def.id,
        kind: def.kind,
        titleRu: def.ru,
        descRu: def.descRu,
        systemId: targetSystem,
        stationId: station.id,
        rewardCredits: def.rewardCredits + def.perJumpCredits * jumps,
        deadlineTick: world.tick + nextRange(world.rngState, def.minTicks, def.maxTicks) + 40,
        accepted: false,
        completed: false,
        failed: false,
        progress: 0,
        targetAmount: def.kind === "bounty" ? 3 : 1,
      });
      count++;
    }
  }
}

/** Создание мира: галактика, 8 империй (игрок + 7 ИИ), пиратская фракция, флоты, миссии. */
export function createWorld(
  seed: number,
  mode: ModeConfig,
  balance: BalanceConfig,
  options?: { raceId?: string; dlcEnabled?: boolean },
): World {
  const gen = generateGalaxy(seed, mode, balance);
  const systems = gen.systems;
  const world: World = {
    schemaVersion: 1,
    rulesetVersion: mode.rulesetVersion,
    modeId: mode.modeId,
    seed,
    tick: 0,
    speed: 1,
    paused: true,
    systems,
    empires: [],
    playerEmpireId: 1,
    fleets: [],
    colonies: [],
    missions: [],
    battles: [],
    log: [],
    nextId: 100000,
    rngState: gen.rngState,
    victory: { achieved: null, tickAchieved: 0, winnerEmpireId: 0 },
    mode,
    balance,
    tradeVolume: 0,
    customDesigns: [],
    flags: {},
  };
  const rng = world.rngState;
  const playerCapitalId = gen.capitalSystemId;
  const hops = computeHops(systems, playerCapitalId);
  for (const system of systems) system.hopsFromCapital = hops[system.id];

  // ---------------------------------------------------------------- игрок
  const player = makeEmpire(world, 1, "Директория Новых Рубежей", EMPIRE_COLORS[0], true, playerCapitalId);
  const capitalSystem = systems[playerCapitalId];
  const capitalPlanet = ensureHabitable(capitalSystem, 60, rng);
  setupPlayerColony(world, player, capitalPlanet, "capital");
  player.stats.coloniesFounded += 1;

  // 2 гарантированных соседних колонии (GDD §3.5)
  const extraColonies: Planet[] = [];
  for (let hop = 1; hop <= 3 && extraColonies.length < 2; hop++) {
    for (const system of systems) {
      if (extraColonies.length >= 2) break;
      if (hops[system.id] !== hop) continue;
      for (const planet of system.planets) {
        if (extraColonies.length >= 2) break;
        if (planet.isMoon) continue;
        if (planet.ownerId !== 0 || planet.colonyId !== 0) continue;
        if (planet.habitability < 40) continue;
        extraColonies.push(planet);
      }
    }
  }
  for (const planet of systems[playerCapitalId].planets) {
    if (extraColonies.length >= 2) break;
    if (planet.isMoon || planet.ownerId !== 0) continue;
    if (planet.habitability >= 40) extraColonies.push(planet);
  }
  for (const planet of extraColonies) {
    setupPlayerColony(world, player, planet, "colony");
    player.stats.coloniesFounded += 1;
  }
  const playerCapitalStation = createCapitalStation(world, systems[playerCapitalId], player);
  pushEvent(world, "system", "info", `Кампания начата. Seed ${seed}: ${systems.length} систем, 7 ИИ-империй.`, playerCapitalId, player.id);
  pushEvent(world, "colony", "good", `Столица «${capitalPlanet.name}» основана. Колоний: ${player.colonies.length}.`, playerCapitalId, player.id);
  pushEvent(world, "system", "good", `Станция «${playerCapitalStation.nameRu}» открыта: рынок, верфь и контракты.`, playerCapitalId, player.id);

  // ---------------------------------------------------------------- ИИ-империи 2..8
  const capitals: number[] = [playerCapitalId];
  for (let id = 2; id <= 8; id++) {
    let bestSystemId = -1;
    let bestScore = -1;
    for (const system of systems) {
      if (capitals.includes(system.id)) continue;
      let minDist = Number.MAX_SAFE_INTEGER;
      for (const existing of capitals) {
        const a = systems[existing];
        const dx = a.x - system.x;
        const dy = a.y - system.y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) minDist = dist;
      }
      const score = minDist + Math.min(hops[system.id], 6) * 100;
      if (score > bestScore || (score === bestScore && system.id < bestSystemId)) {
        bestScore = score;
        bestSystemId = system.id;
      }
    }
    if (bestSystemId < 0) bestSystemId = systems.length - 1;
    capitals.push(bestSystemId);
    const name = ["Доминион Вейла", "Империя Тарн", "Синдикат Керн", "Республика Орион",
      "Консорциум Нова", "Легион Драко", "Союз Астрея"][id - 2] ?? `Империя ${id}`;
    const ai = makeEmpire(world, id, name, EMPIRE_COLORS[(id - 1) % EMPIRE_COLORS.length], false, bestSystemId);
    const aiCapitalSystem = systems[bestSystemId];
    const aiPlanet = ensureHabitable(aiCapitalSystem, 50, rng);
    setupAiColony(world, ai, aiPlanet, true);
    ai.stats.coloniesFounded += 1;
    // вторая колония по возможности
    let second: Planet | null = null;
    for (const system of systems) {
      if (second) break;
      const h = hops[system.id];
      if (h < 1 || h > 3) continue;
      for (const planet of system.planets) {
        if (planet.isMoon || planet.habitability < 40 || planet.ownerId !== 0 || planet.colonyId !== 0) continue;
        second = planet;
        break;
      }
    }
    if (second) {
      setupAiColony(world, ai, second, false);
      ai.stats.coloniesFounded += 1;
    }
    setupFleet(world, ai, bestSystemId, ["corvette_scout", "corvette_scout", "science_vessel", "colonizer_ark"], "Флот обороны");
    for (const school of SCIENCE_ORDER) ai.techs.offers[school] = generateTechOffers(world, ai, school);
    // известность столичных систем
    const aiHops = computeHops(systems, bestSystemId);
    for (const system of systems) {
      if (aiHops[system.id] >= 0 && aiHops[system.id] <= 1) {
        if (!system.knownBy.includes(ai.id)) system.knownBy.push(ai.id);
      }
    }
  }

  // ---------------------------------------------------------------- пираты (фракция демо-боёв)
  const pirateCandidates = systems.filter((s) => hops[s.id] >= 1 && hops[s.id] <= 2).sort((a, b) => (hops[a.id] - hops[b.id]) || (a.id - b.id));
  const pirateCapital = pirateCandidates[0] ?? systems[playerCapitalId];
  const pirates = makeEmpire(world, 9, "Пираты Пустоты", "#E57373", false, pirateCapital.id);
  pirates.ai = { focus: "military", aggression: 100, nextDecisionTick: 3, targetSystemId: 0, colonizeCooldown: 0 };
  pirates.stats.shipsBuilt = 0;
  const pirateSystems = pirateCandidates.slice(0, 2);
  const pirateLocations = pirateSystems.length > 0 ? pirateSystems : [pirateCapital];
  for (const system of pirateLocations) {
    setupFleet(world, pirates, system.id, ["corvette_strike", "corvette_strike"], "Пиратский рейдер");
  }

  // ---------------------------------------------------------------- дипломатия
  for (const a of world.empires) {
    for (const b of world.empires) {
      if (a.id === b.id) continue;
      if (a.id === 9 || b.id === 9) {
        a.relations[b.id] = { opinion: -100, treaty: "war", warTicks: 0 };
      } else {
        a.relations[b.id] = { opinion: nextRange(rng, -20, 25), treaty: "none", warTicks: 0 };
      }
    }
  }

  // ---------------------------------------------------------------- флот игрока
  const flagshipFleet = setupFleet(world, player, playerCapitalId, ["player_flagship", "corvette_scout", "corvette_scout"], "Флагманский флот «Заря»");
  setupFleet(world, player, playerCapitalId, ["science_vessel", "trader_hauler"], "Разведфлот «Взгляд»");
  player.flagshipFleetId = flagshipFleet.id;
  for (const school of SCIENCE_ORDER) player.techs.offers[school] = generateTechOffers(world, player, school);

  // ---------------------------------------------------------------- туман войны, сенсоры
  for (const system of systems) {
    const h = hops[system.id];
    if (h >= 0 && h <= 1) {
      if (!system.knownBy.includes(player.id)) system.knownBy.push(player.id);
      if (!system.visibleTo.includes(player.id)) system.visibleTo.push(player.id);
    } else if (h === 2) {
      if (!system.knownBy.includes(player.id)) system.knownBy.push(player.id);
    }
    if (h >= 0 && h <= 1) {
      for (const planet of system.planets) planet.scanned = true;
      for (const poi of system.poi) poi.scanned = true;
    }
  }
  void flagshipFleet;
  pushEvent(world, "fleet", "info", `Флагман «Первый Свет» в столичной системе. Разведфлот отправлен на сенсорный обзор.`, playerCapitalId, player.id);
  if (pirateLocations.length > 0) {
    pushEvent(world, "warn", "warn", `Пиратские рейдеры замечены в системах: ${pirateLocations.map((s) => s.name).join(", ")}.`, pirateLocations[0].id, player.id);
  }

  // ---------------------------------------------------------------- миссии станций
  generateStationMissions(world, hops, 40);
  pushEvent(world, "mission", "info", `Доступно контрактов: ${world.missions.length}. Принимайте в терминале станции.`);

  // финальная расстановка: стабильность/назначения/выходы
  for (const colony of world.colonies) updateStability(world, colony);
  // полная игра: традиции/дипломатия/рынки/кампания/кризисы/победы (M6–M12)
  createFullGameState(world, options);
  // Часть XIII: стартовые бонусы расы применяем при явном выборе (newGame(seed, mode, raceId))
  // или через setPlayerRace. createWorld(seed, mode, balance) остаётся легаси-путём без бонусов.
  if (options?.raceId) applyRaceStartBonuses(world, world.playerEmpireId);
  // M6: офферы технологий учитывают традиции/перки/цивики (extraTechChoice, школы).
  for (const empire of world.empires) {
    for (const school of SCIENCE_ORDER) empire.techs.offers[school] = generateTechOffers(world, empire, school);
  }
  return world;
}