/**
 * КОНСТРУКТОР КОРАБЛЕЙ (M5/M12, GDD §9.1–§9.4).
 *
 * Валидация: hull.requiredTech, доступность модулей по технологиям, слоты
 * small/medium/large (large принимает меньшие с −10% урона за размер), utility/internal,
 * масса ≤ maxMass, power_draw ≤ power_output, ≥1 реактор и двигатель, ≥1 оружие
 * при наличии боевых слотов, ≤2 одинаковых модулей (кроме utility).
 *
 * FP: проверочная формула §9.4 (0.30·DPS_eff + 0.004·EHP_eff + 0.25·utility_slots),
 * калиброванная к табличному FP класса (источник истины — таблица §9.4), чтобы
 * кастомный корвет стоил ~6 FP, фрегат ~13 FP и т.д.
 *
 * Все числа-заглушки (масса оружия, резисты для EHP, табличные цены) помечены как fallback:
 * в @sf/data у WeaponDef нет массы, а цена верфи берётся из ближайшего шаблона того же класса.
 */
import {
  DESIGNS, HULLS, HULL_BY_ID, MODULES, MODULE_BY_ID, TECH_BY_ID, WEAPONS, WEAPON_BY_ID,
} from "@sf/data";
import type { HullDef, ModuleDef, WeaponDef } from "@sf/data";
import { empireById } from "./economy";
import type { CommandResult, CustomDesign, DesignDraft, Empire, World } from "./types";

// ------------------------------------------------------------------ константы/fallback

/** Табличный FP классов (GDD §9.4). Для гражданских — свои значения. */
export const CLASS_TABLE_FP: Record<string, number> = {
  corvette: 6, frigate: 13, destroyer: 24, cruiser: 55, battleship: 130, titan: 300,
  colossus: 60, carrier: 160, flagship: 12,
  shuttle: 1, science: 2, trader: 2, miner: 2, colonizer: 2, troopship: 8, tanker: 3,
};

/** Fallback табличной цены верфи (03b §10.3), если нет шаблона того же класса. */
const CLASS_CREDITS: Record<string, number> = {
  corvette: 210000, frigate: 900000, destroyer: 2600000, cruiser: 7000000, battleship: 16000000,
  titan: 40000000, colossus: 50000000, carrier: 30000000, flagship: 240000,
  shuttle: 60000, science: 90000, trader: 120000, miner: 80000, colonizer: 150000, troopship: 300000, tanker: 120000,
};

/** Fallback масса оружия по слоту (в WeaponDef массы нет; GDD учитывает массу суммарно). */
const WEAPON_MASS: Record<"small" | "medium" | "large", number> = { small: 2, medium: 5, large: 12 };
/** Средние резисты для EHP_eff §9.4 (у компонентов нет полей резистов). */
const EHP_RESIST = { shield: 0.15, armor: 0.10, hull: 0.10 };
/** Максимум дизайнов на империю (анти-спам UI). */
export const MAX_DESIGNS_PER_EMPIRE = 20;
/** Длина названия. */
export const DESIGN_NAME_MAX = 40;

const SIZE_RANK: Record<"small" | "medium" | "large", number> = { small: 0, medium: 1, large: 2 };
const SIZES: Array<"small" | "medium" | "large"> = ["small", "medium", "large"];

function ok(messageRu?: string, createdId?: number): CommandResult {
  const result: CommandResult = { ok: true };
  if (messageRu !== undefined) result.messageRu = messageRu;
  if (createdId !== undefined) result.createdId = createdId;
  return result;
}
function deny(messageRu: string): CommandResult {
  return { ok: false, messageRu };
}
function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DesignError { code: string; messageRu: string }

export interface DesignStats {
  mass: number;
  maxMass: number;
  powerUse: number;
  powerMax: number;
  heat: number;
  fleetPower: number;
  costAlloys: number;
  costCredits: number;
  buildTicks: number;
  /** занятые слоты: оружие по размерам + модули */
  slotsUsed: { small: number; medium: number; large: number; utility: number; internal: number };
}

export interface DesignDetailed {
  ok: boolean;
  errors: DesignError[];
  warnings: DesignError[];
  stats: DesignStats;
  requiredTechs: string[];
}

// ------------------------------------------------------------------ расчёт

/**
 * Доступность технологии для конструктора: исследована ИЛИ это базовая технология T0
 * (GDD §9.1: империя начинает с базовым вооружением/корпусом; иначе на старте конструктор пуст).
 */
function techAvailable(empire: Empire | undefined, techId: string | null): boolean {
  if (techId === null) return true;
  if (!empire) return false;
  if (empire.techs.completed.includes(techId)) return true;
  const def = TECH_BY_ID[techId];
  return def !== undefined && def.tier === 0;
}

function resolveWeapons(world: World, empire: Empire | undefined, ids: string[]): { weapons: WeaponDef[]; errors: DesignError[] } {
  const weapons: WeaponDef[] = [];
  const errors: DesignError[] = [];
  for (const id of ids) {
    const weapon = WEAPON_BY_ID[id];
    if (!weapon) {
      errors.push({ code: "unknown_weapon", messageRu: "Неизвестное оружие: " + id });
      continue;
    }
    if (!techAvailable(empire, weapon.tech)) {
      errors.push({ code: "weapon_tech", messageRu: "Оружие не исследовано: " + weapon.ru });
      continue;
    }
    weapons.push(weapon);
  }
  void world;
  return { weapons, errors };
}

function resolveModules(world: World, empire: Empire | undefined, ids: string[]): { modules: ModuleDef[]; errors: DesignError[] } {
  const modules: ModuleDef[] = [];
  const errors: DesignError[] = [];
  for (const id of ids) {
    const module = MODULE_BY_ID[id];
    if (!module) {
      errors.push({ code: "unknown_module", messageRu: "Неизвестный модуль: " + id });
      continue;
    }
    if (!techAvailable(empire, module.tech)) {
      errors.push({ code: "module_tech", messageRu: "Модуль не исследован: " + module.ru });
      continue;
    }
    modules.push(module);
  }
  void world;
  return { modules, errors };
}

interface RawStats {
  dps: number;
  ehp: number;
  utilitySlots: number;
  raw: number;
  slotsUsed: { small: number; medium: number; large: number; utility: number; internal: number };
  mass: number;
  powerUse: number;
  powerMax: number;
  heat: number;
  shield: number;
  armor: number;
  hullHp: number;
  errors: DesignError[];
}

/** Размещение оружия по жёстким точкам: large→medium/small с −10% урона за размер. */
function placeWeapons(hull: HullDef, weapons: WeaponDef[]): { dps: number; used: { small: number; medium: number; large: number }; errors: DesignError[] } {
  const capacity: Record<"small" | "medium" | "large", number> = {
    small: hull.slots.small, medium: hull.slots.medium, large: hull.slots.large,
  };
  const order = [...weapons].sort((a, b) => {
    const ra = SIZE_RANK[a.slot];
    const rb = SIZE_RANK[b.slot];
    if (ra !== rb) return rb - ra;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const used = { small: 0, medium: 0, large: 0 };
  const errors: DesignError[] = [];
  let dps = 0;
  for (const weapon of order) {
    const ownRank = SIZE_RANK[weapon.slot];
    let slot: "small" | "medium" | "large" | null = null;
    let penaltySteps = 0;
    if (capacity[weapon.slot] > 0) {
      slot = weapon.slot;
    } else {
      for (let rank = ownRank + 1; rank <= 2; rank++) {
        const size = SIZES[rank];
        if (capacity[size] > 0) {
          slot = size;
          penaltySteps = rank - ownRank;
          break;
        }
      }
    }
    if (slot === null) {
      errors.push({
        code: "weapon_slots",
        messageRu: `Нет подходящего слота для оружия «${weapon.ru}» (${weapon.slot}).`,
      });
      continue;
    }
    capacity[slot] -= 1;
    used[slot] += 1;
    const penalty = 1 - 0.1 * penaltySteps;
    dps += weapon.dmg * weapon.rof * weapon.accuracy * penalty;
  }
  return { dps, used, errors };
}

function computeRaw(world: World, empire: Empire | undefined, hull: HullDef, weaponIds: string[], moduleIds: string[]): RawStats {
  const resolvedWeapons = resolveWeapons(world, empire, weaponIds);
  const resolvedModules = resolveModules(world, empire, moduleIds);
  const errors = [...resolvedWeapons.errors, ...resolvedModules.errors];
  const placement = placeWeapons(hull, resolvedWeapons.weapons);
  errors.push(...placement.errors);

  const slotsUsed = {
    small: placement.used.small, medium: placement.used.medium, large: placement.used.large,
    utility: 0, internal: 0,
  };
  let mass = hull.mass;
  let powerMax = 0;
  let powerUse = 0;
  let heat = 0;
  let shield = hull.shieldBase;
  let armor = hull.armorBase;
  let hullHp = hull.hullHp;
  for (const weapon of resolvedWeapons.weapons) {
    mass += WEAPON_MASS[weapon.slot];
    powerUse += weapon.power;
    heat += weapon.heat * weapon.rof;
  }
  const moduleIdsCount: Record<string, number> = {};
  for (const module of resolvedModules.modules) {
    moduleIdsCount[module.id] = (moduleIdsCount[module.id] ?? 0) + 1;
    if (module.slot === "utility") slotsUsed.utility += 1;
    else slotsUsed.internal += 1;
    mass += module.mass;
    // реактор даёт мощность: единственный источник power_output в данных (id по конвенции "reactor*")
    if (module.id.startsWith("reactor")) powerMax += module.power;
    else powerUse += module.power;
    if (module.shieldAdd) shield += module.shieldAdd;
    if (module.armorAdd) armor += module.armorAdd;
    if (module.hullAdd) hullHp += module.hullAdd;
    if (module.heatDissipation) heat -= module.heatDissipation;
  }
  const ehp = shield / (1 - EHP_RESIST.shield) + armor / (1 - EHP_RESIST.armor) + hullHp / (1 - EHP_RESIST.hull);
  const utilitySlots = hull.slots.utility;
  const raw = 0.30 * placement.dps + 0.004 * ehp + 0.25 * utilitySlots;
  return {
    dps: placement.dps, ehp, utilitySlots, raw, slotsUsed, mass, powerUse, powerMax,
    heat: round2(heat), shield, armor, hullHp, errors,
  };
}

/** Эталон того же класса (для калибровки FP к таблице §9.4). */
function referenceDesignFor(hull: HullDef): { fleetPower: number; costCredits: number; raw: number } | null {
  const candidates = DESIGNS.filter((design) => design.classId === hull.classId && design.id !== "player_flagship");
  const reference = candidates[0];
  if (!reference) return null;
  const refHull = HULL_BY_ID[reference.hullId];
  if (!refHull) return null;
  // Эталон считаем без проверки технологий (это шаблон из данных).
  const stored = referenceCache.get(reference.id);
  if (stored) return stored;
  const weapons = reference.weapons.map((id) => WEAPON_BY_ID[id]).filter((w): w is WeaponDef => w !== undefined);
  const modules = reference.modules.map((id) => MODULE_BY_ID[id]).filter((m): m is ModuleDef => m !== undefined);
  const capacity: Record<"small" | "medium" | "large", number> = { ...refHull.slots };
  let dps = 0;
  let mass = refHull.mass;
  let powerMax = 0;
  let powerUse = 0;
  let heat = 0;
  let shield = refHull.shieldBase;
  let armor = refHull.armorBase;
  let hullHp = refHull.hullHp;
  const ordered = [...weapons].sort((a, b) => SIZE_RANK[b.slot] - SIZE_RANK[a.slot]);
  for (const weapon of ordered) {
    let slot = null as "small" | "medium" | "large" | null;
    if (capacity[weapon.slot] > 0) slot = weapon.slot;
    else for (let rank = SIZE_RANK[weapon.slot] + 1; rank <= 2; rank++) {
      if (capacity[SIZES[rank]] > 0) { slot = SIZES[rank]; break; }
    }
    if (slot) capacity[slot] -= 1;
    dps += weapon.dmg * weapon.rof * weapon.accuracy;
    mass += WEAPON_MASS[weapon.slot];
    powerUse += weapon.power;
    heat += weapon.heat * weapon.rof;
  }
  for (const module of modules) {
    mass += module.mass;
    if (module.id.startsWith("reactor")) powerMax += module.power;
    else powerUse += module.power;
    if (module.shieldAdd) shield += module.shieldAdd;
    if (module.armorAdd) armor += module.armorAdd;
    if (module.hullAdd) hullHp += module.hullAdd;
    if (module.heatDissipation) heat -= module.heatDissipation;
  }
  const ehp = shield / (1 - EHP_RESIST.shield) + armor / (1 - EHP_RESIST.armor) + hullHp / (1 - EHP_RESIST.hull);
  const raw = 0.30 * dps + 0.004 * ehp + 0.25 * refHull.slots.utility;
  const result = { fleetPower: reference.fleetPower, costCredits: reference.costCredits, raw };
  referenceCache.set(reference.id, result);
  void mass; void powerMax; void powerUse; void heat;
  return result;
}
const referenceCache = new Map<string, { fleetPower: number; costCredits: number; raw: number }>();

/** Полная валидация черновика + расчёт статов (внутренняя, без сохранения). */
export function computeDesignStats(world: World, empireId: number, draft: DesignDraft): DesignDetailed {
  const empire = empireById(world, empireId);
  const errors: DesignError[] = [];
  const warnings: DesignError[] = [];
  const requiredTechs: string[] = [];
  const name = (draft.nameRu ?? "").trim();
  if (name.length < 1 || name.length > DESIGN_NAME_MAX) {
    errors.push({ code: "name", messageRu: `Название дизайна: 1–${DESIGN_NAME_MAX} символов.` });
  }
  const hull = HULL_BY_ID[draft.hullId];
  const emptyRaw: RawStats = {
    dps: 0, ehp: 0, utilitySlots: 0, raw: 0,
    slotsUsed: { small: 0, medium: 0, large: 0, utility: 0, internal: 0 },
    mass: 0, powerUse: 0, powerMax: 0, heat: 0, shield: 0, armor: 0, hullHp: 0, errors: [],
  };
  if (!hull) {
    errors.push({ code: "unknown_hull", messageRu: "Неизвестный корпус: " + draft.hullId });
    return {
      ok: false, errors, warnings,
      stats: { mass: 0, maxMass: 0, powerUse: 0, powerMax: 0, heat: 0, fleetPower: 0, costAlloys: 0, costCredits: 0, buildTicks: 0, slotsUsed: emptyRaw.slotsUsed },
      requiredTechs,
    };
  }
  if (!techAvailable(empire, hull.requiredTech)) {
    errors.push({ code: "hull_tech", messageRu: "Корпус не исследован (нужна технология «" + hull.requiredTech + "»)." });
    if (hull.requiredTech) requiredTechs.push(hull.requiredTech);
  }
  const weaponsIds = Array.isArray(draft.weapons) ? draft.weapons : [];
  const modulesIds = Array.isArray(draft.modules) ? draft.modules : [];
  if (weaponsIds.length > 64 || modulesIds.length > 64) {
    errors.push({ code: "limit", messageRu: "Слишком много компонентов в дизайне." });
  }
  const raw = computeRaw(world, empire, hull, weaponsIds, modulesIds);
  errors.push(...raw.errors);

  // слоты
  if (raw.slotsUsed.small > hull.slots.small) errors.push({ code: "weapon_slots", messageRu: "Переполнены малые жёсткие точки." });
  if (raw.slotsUsed.medium > hull.slots.medium) errors.push({ code: "weapon_slots", messageRu: "Переполнены средние жёсткие точки." });
  if (raw.slotsUsed.large > hull.slots.large) errors.push({ code: "weapon_slots", messageRu: "Переполнены большие жёсткие точки." });
  if (raw.slotsUsed.utility > hull.slots.utility) errors.push({ code: "module_slots", messageRu: "Переполнены утилит-слоты." });
  if (raw.slotsUsed.internal > hull.slots.internal) errors.push({ code: "module_slots", messageRu: "Переполнены внутренние слоты." });

  // масса
  if (raw.mass > hull.maxMass) {
    errors.push({ code: "mass", messageRu: `Масса ${Math.round(raw.mass)} т > ${hull.maxMass} т.` });
  } else if (raw.mass > hull.maxMass * 0.9) {
    warnings.push({ code: "near_max_mass", messageRu: "Масса близка к пределу корпуса." });
  }

  // энергия и обязательные модули
  if (raw.powerMax <= 0) {
    errors.push({ code: "no_reactor", messageRu: "Нужен реактор (источник мощности)." });
  }
  if (raw.powerUse > raw.powerMax) {
    errors.push({ code: "power", messageRu: `Не хватает мощности: ${Math.round(raw.powerUse)} / ${Math.round(raw.powerMax)}.` });
  }
  const hasEngine = modulesIds.some((id) => id.startsWith("thruster"));
  if (!hasEngine) errors.push({ code: "no_thruster", messageRu: "Нужен двигатель (thruster)." });
  const combatSlots = hull.slots.small + hull.slots.medium + hull.slots.large;
  if (combatSlots > 0 && weaponsIds.length === 0) {
    errors.push({ code: "no_weapon", messageRu: "Нужно хотя бы одно оружие (это боевой корпус)." });
  }

  // ≤2 одинаковых модулей, кроме utility
  const counts: Record<string, number> = {};
  for (const id of modulesIds) {
    const module = MODULE_BY_ID[id];
    if (!module) continue;
    counts[id] = (counts[id] ?? 0) + 1;
    if (counts[id] === 3 && module.slot !== "utility") {
      errors.push({ code: "duplicate_module", messageRu: "Не более 2 одинаковых модулей (кроме утилит): " + module.ru });
    }
  }
  if (raw.heat > 0) {
    warnings.push({ code: "heat_positive", messageRu: `Тепло положительное (${raw.heat}/с) — корабль будет перегреваться.` });
  }

  // технологии компонентов для UI
  for (const id of [...weaponsIds, ...modulesIds]) {
    const tech = WEAPON_BY_ID[id]?.tech ?? MODULE_BY_ID[id]?.tech ?? null;
    if (tech && !techAvailable(empire, tech) && !requiredTechs.includes(tech)) {
      requiredTechs.push(tech);
    }
  }

  const reference = referenceDesignFor(hull);
  const baseFp = reference?.fleetPower ?? CLASS_TABLE_FP[hull.classId] ?? 2;
  const refRaw = reference?.raw ?? 0;
  const ratio = refRaw > 0 ? raw.raw / refRaw : 1;
  const fleetPower = Math.max(1, Math.round(baseFp * clamp(ratio, 0.5, 1.6)));
  let costAlloys = hull.costAlloys;
  for (const id of weaponsIds) costAlloys += WEAPON_BY_ID[id]?.costAlloys ?? 0;
  for (const id of modulesIds) costAlloys += MODULE_BY_ID[id]?.costAlloys ?? 0;
  const costCredits = reference?.costCredits ?? CLASS_CREDITS[hull.classId] ?? 100000;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      mass: Math.round(raw.mass),
      maxMass: hull.maxMass,
      powerUse: Math.round(raw.powerUse),
      powerMax: Math.round(raw.powerMax),
      heat: raw.heat,
      fleetPower,
      costAlloys: Math.round(costAlloys),
      costCredits,
      buildTicks: hull.buildTicks,
      slotsUsed: raw.slotsUsed,
    },
    requiredTechs,
  };
}

// ------------------------------------------------------------------ хранилище дизайнов

export function findCustomDesign(world: World, designId: string): CustomDesign | undefined {
  return (world.customDesigns ?? []).find((design) => design.id === designId);
}

export function getCustomDesigns(world: World, empireId?: number): CustomDesign[] {
  const list = world.customDesigns ?? [];
  return (empireId === undefined ? [...list] : list.filter((design) => design.ownerId === empireId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function designDisplayName(world: World, designId: string): string {
  const stock = DESIGNS.find((design) => design.id === designId);
  if (stock) return stock.ru;
  const custom = findCustomDesign(world, designId);
  return custom ? custom.nameRu : designId;
}

/** Создание дизайна (внутреннее; используется командами). */
export function createDesign(world: World, empireId: number, draft: DesignDraft): CommandResult {
  const empire = empireById(world, empireId);
  if (!empire) return deny("Империя не найдена");
  const owned = getCustomDesigns(world, empireId);
  if (owned.length >= MAX_DESIGNS_PER_EMPIRE) {
    return deny(`Лимит дизайнов: ${MAX_DESIGNS_PER_EMPIRE} на империю.`);
  }
  if (owned.some((design) => design.nameRu.trim().toLowerCase() === draft.nameRu.trim().toLowerCase())) {
    return deny("Дизайн с таким названием уже есть.");
  }
  const detailed = computeDesignStats(world, empireId, draft);
  if (!detailed.ok) return deny("Дизайн невалиден: " + detailed.errors.map((e) => e.messageRu).join("; "));
  const id = `custom:${empireId}:${world.nextId++}`;
  const design: CustomDesign = {
    id,
    ownerId: empireId,
    nameRu: draft.nameRu.trim(),
    hullId: draft.hullId,
    weapons: [...draft.weapons],
    modules: [...draft.modules],
    fleetPower: detailed.stats.fleetPower,
    costAlloys: detailed.stats.costAlloys,
    costCredits: detailed.stats.costCredits,
    buildTicks: detailed.stats.buildTicks,
    createdTick: world.tick,
    updatedTick: world.tick,
  };
  world.customDesigns.push(design);
  return ok(`Дизайн «${design.nameRu}» сохранён (FP ${design.fleetPower}).`);
}

export function updateDesign(world: World, empireId: number, designId: string, patch: Partial<DesignDraft>): CommandResult {
  const design = findCustomDesign(world, designId);
  if (!design) return deny("Дизайн не найден");
  if (design.ownerId !== empireId) return deny("Это не ваш дизайн");
  const merged: DesignDraft = {
    nameRu: patch.nameRu ?? design.nameRu,
    hullId: patch.hullId ?? design.hullId,
    weapons: patch.weapons ?? [...design.weapons],
    modules: patch.modules ?? [...design.modules],
  };
  const detailed = computeDesignStats(world, empireId, merged);
  if (!detailed.ok) return deny("Дизайн невалиден: " + detailed.errors.map((e) => e.messageRu).join("; "));
  design.nameRu = merged.nameRu.trim();
  design.hullId = merged.hullId;
  design.weapons = [...merged.weapons];
  design.modules = [...merged.modules];
  design.fleetPower = detailed.stats.fleetPower;
  design.costAlloys = detailed.stats.costAlloys;
  design.costCredits = detailed.stats.costCredits;
  design.buildTicks = detailed.stats.buildTicks;
  design.updatedTick = world.tick;
  return ok(`Дизайн «${design.nameRu}» обновлён (FP ${design.fleetPower}).`);
}

export function deleteDesign(world: World, empireId: number, designId: string): CommandResult {
  const index = (world.customDesigns ?? []).findIndex((design) => design.id === designId);
  if (index < 0) return deny("Дизайн не найден");
  const design = world.customDesigns[index];
  if (design.ownerId !== empireId) return deny("Это не ваш дизайн");
  world.customDesigns.splice(index, 1);
  return ok(`Дизайн «${design.nameRu}» удалён.`);
}

/** save_design: если передан designId — обновление, иначе создание (контракт UI). */
export function saveDesign(world: World, empireId: number, draft: DesignDraft, designId?: string): CommandResult {
  return designId !== undefined
    ? updateDesign(world, empireId, designId, draft)
    : createDesign(world, empireId, draft);
}

/** Доступные для конструктора компоненты (только исследованные технологии). */
export function availableShipParts(world: World, empireId: number): {
  hulls: HullDef[]; weapons: WeaponDef[]; modules: ModuleDef[];
} {
  void world;
  const empire = empireById(world, empireId);
  const techOk = (tech: string | null): boolean => techAvailable(empire, tech);
  return {
    hulls: HULLS.filter((hull) => techOk(hull.requiredTech)),
    weapons: WEAPONS.filter((weapon) => techOk(weapon.tech)),
    modules: MODULES.filter((module) => techOk(module.tech)),
  };
}
