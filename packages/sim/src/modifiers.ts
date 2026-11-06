/**
 * ЕДИНЫЕ МОДИФИКАТОРЫ ИМПЕРИИ (M6/M7/M12).
 * Сводят эффекты завершённых технологий, традиций, перков, этик/правительств/цивиков,
 * федераций, санкций совета, мегаструктур и давления финала в один набор множителей,
 * который используют экономика, бой, дипломатия и победы.
 *
 * Соглашения о ключах эффектов (данные @sf/data, значения — доли, если не указано иное):
 *  - "<res>_prod" — +доля к потоку ресурса (0.10 = +10%); "all_prod" — все ресурсы;
 *  - "science"/"science_prod"/"research_speed" — +доля к науке;
 *  - "physics_prod"/"society_prod"/"engineering_prod" — школа науки (см. empireSchoolScience);
 *  - "<X>_mult" — готовый множитель (0.85 = −15%), "<X>" — доля (+0.10 = +10%);
 *  - плоские: stability, happiness, fleet_cap, sensor_range, extra_tech_choice,
 *    diplo_opinion, flagship_autoescape, fleet_cap_per_10_systems и т.п.
 * Неизвестные ключи игнорируются (контент можно расширять без падения симуляции).
 */
import { CIVICS, ETHICS, GOVERNMENTS, MEGASTRUCTURES, TECH_BY_ID } from "@sf/data";
import type { ResourceId, ScienceId, World } from "./types";
import { allPerks, findFinisher, traditionTrees } from "./traditions";
import { ancientsEffectSources, ancientsSignature } from "./ancients-fx";

export interface EmpireModifiers {
  production: Record<ResourceId, number>;
  science: number;
  fleetCapFlat: number;
  fleetCapPct: number;
  fleetUpkeepMult: number;
  shipCostMult: number;
  buildSpeedMult: number;
  popGrowthMult: number;
  stabilityBonus: number;
  happinessBonus: number;
  unityMult: number;
  influenceMult: number;
  claimCostMult: number;
  outpostCostMult: number;
  colonyCostMult: number;
  diploOpinionBonus: number;
  warScoreMult: number;
  weaponDamageMult: number;
  shieldMult: number;
  armorMult: number;
  tradeMarginBonus: number;
  sensorRangeBonus: number;
  extraTechChoice: number;
  invasionMult: number;
  megastructureCostMult: number;
  flagshipAutoescape: number;
  /** Часть XIII: «специальные» ключи рас/ветви A0–A5, не имеющие отдельного поля. */
  special: Record<string, number>;
}

/** GDD §12.3: членство в федерации (общий рынок + общий флот). */
export const FEDERATION_TRADE_MARGIN_BONUS = 5;
export const FEDERATION_OPINION_BONUS = 10;
export const FEDERATION_FLEET_CAP_PCT = 5;
/** GDD §12.4: санкции — −20% дохода цели, −10% науки; 3+ санкции — «изгой». */
export const SANCTION_INCOME_MULT = 0.8;
export const SANCTION_SCIENCE_MULT = 0.9;
export const SANCTION_PARIAH_COUNT = 3;
export const SANCTION_PARIAH_OPINION = -30;
/** GDD §7.7/§19: давление финала (6200+) — до −20% доходов. */
export const FINAL_PRESSURE_INCOME_PENALTY = 0.2;

// ------------------------------------------------------------------ административная нагрузка (анти-снежок)
// GDD §7.7 (тормоз №2), 03b §5.8: admin_strain = 1 + 0.05·max(0, colonies−5) + 0.02·max(0, systems−25).
// Поверх канонической формулы усилены показатели науки (задача M10: производство И наука),
// чтобы «широкая» империя не давала линейный снежный ком.
export const ADMIN_COLONY_FREE = 5;
export const ADMIN_SYSTEM_FREE = 25;
export const ADMIN_STRAIN_MAX = 2.0;

/** Нагрузка администрирования (≥1.0, потолок 2.0) — 03b §5.8. */
export function adminStrain(systems: number, colonies: number): number {
  const raw = 1
    + 0.05 * Math.max(0, colonies - ADMIN_COLONY_FREE)
    + 0.02 * Math.max(0, systems - ADMIN_SYSTEM_FREE);
  return Math.min(ADMIN_STRAIN_MAX, Math.max(1, raw));
}

/** Множитель производства от нагрузки: strain^-0.35 (канон −0.25, усилено для анти-снежка). */
export function sprawlProductionMult(systems: number, colonies: number): number {
  return Math.pow(adminStrain(systems, colonies), -0.35);
}

/** Множитель науки от нагрузки: strain^-0.5. */
export function sprawlScienceMult(systems: number, colonies: number): number {
  return Math.pow(adminStrain(systems, colonies), -0.5);
}

/** Множитель роста попов от нагрузки: strain^-0.25. */
export function sprawlGrowthMult(systems: number, colonies: number): number {
  return Math.pow(adminStrain(systems, colonies), -0.25);
}

/** Множитель стоимости колонизации/стройки от нагрузки: strain^0.5 (03b §5.8). */
export function sprawlConstructionCostMult(systems: number, colonies: number): number {
  return Math.sqrt(adminStrain(systems, colonies));
}

/** GDD §19.6: −1 флотского лимита за каждые 5 систем сверх 20. */
export function sprawlFleetCapPenalty(systems: number): number {
  return Math.floor(Math.max(0, systems - 20) / 5);
}

/** Fallback-эффекты мегаструктур по GDD §8.7, пока MEGASTRUCTURES пуст. */
const MEGASTRUCTURE_FALLBACK_EFFECTS: Record<string, Record<string, number>> = {
  sentinel_array: { sensor_range: 2, science_prod: 0.1 },
  gate: {},
  star_forge: { alloys_prod: 0.25 },
  ring_habitat: { pop_growth: 0.05 },
  dyson_sphere: { energy_prod: 0.3 },
  science_nexus: { science_prod: 0.15, extra_tech_choice: 1 },
  beacon: { fleet_cap_pct: 0.2 },
};

const PRODUCTION_KEYS: Record<string, ResourceId> = {
  energy: "energy", minerals: "minerals", food: "food", alloys: "alloys",
  goods: "goods", unity: "unity", influence: "influence", credits: "credits",
};

type ScalarMultField =
  | "science" | "fleetUpkeepMult" | "shipCostMult" | "buildSpeedMult" | "popGrowthMult"
  | "unityMult" | "influenceMult" | "claimCostMult" | "outpostCostMult" | "colonyCostMult"
  | "warScoreMult" | "weaponDamageMult" | "shieldMult" | "armorMult" | "invasionMult"
  | "megastructureCostMult";

const SCALAR_MULT_TARGETS: Record<string, ScalarMultField> = {
  fleet_upkeep: "fleetUpkeepMult",
  ship_cost: "shipCostMult",
  build_speed: "buildSpeedMult",
  pop_growth: "popGrowthMult",
  population_growth: "popGrowthMult",
  war_score: "warScoreMult",
  weapon_damage: "weaponDamageMult",
  damage: "weaponDamageMult",
  fleet_power: "weaponDamageMult",
  shield: "shieldMult",
  shield_max: "shieldMult",
  armor: "armorMult",
  armor_max: "armorMult",
  invasion: "invasionMult",
  megastructure_cost: "megastructureCostMult",
  claim_cost: "claimCostMult",
  outpost_cost: "outpostCostMult",
  colony_cost: "colonyCostMult",
  unity: "unityMult",
  influence: "influenceMult",
  science: "science",
};

const IGNORED_KEYS = new Set([
  "power", "fsd_range", "sublight_speed", "ascension", "psionics", "megastructures",
  "galactic_council", "trade_routes", "singular_reactor", "treaty_cost", "army_cost",
  "edict_cost", "extra_weapon_slot", "weapon_slot", "doctrine_slot", "faction_slot",
  "building_slot", "housing", "crime", "admiral_exp", "anomaly_speed", "tradition_cost",
  "perk_slot", "perk_slots", "extra_perk", "perk_cost", "perk_cost_mult", "ascension_count",
  "ascension_victory", "colonization_efficiency", "influence_flat", "energy_flat",
  "science_flat_per_school", "science_burst", "science_burst_ticks", "all_prod_burst",
  "all_prod_burst_ticks", "new_colony_pops", "no_revolt_ticks", "megastructure_unlock",
  "ring_world_unlock", "psi_unlock", "trait_slots", "robot_upkeep_pct", "megastructure_cost_pct",
]);

export function neutralModifiers(): EmpireModifiers {
  return {
    production: { energy: 1, minerals: 1, food: 1, alloys: 1, goods: 1, unity: 1, influence: 1, credits: 1 },
    science: 1, fleetCapFlat: 0, fleetCapPct: 0, fleetUpkeepMult: 1, shipCostMult: 1,
    buildSpeedMult: 1, popGrowthMult: 1, stabilityBonus: 0, happinessBonus: 0, unityMult: 1,
    influenceMult: 1, claimCostMult: 1, outpostCostMult: 1, colonyCostMult: 1,
    diploOpinionBonus: 0, warScoreMult: 1, weaponDamageMult: 1, shieldMult: 1, armorMult: 1,
    tradeMarginBonus: 0, sensorRangeBonus: 0, extraTechChoice: 0, invasionMult: 1,
    megastructureCostMult: 1, flagshipAutoescape: 0, special: {},
  };
}

function clampMult(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return value < 0.05 ? 0.05 : value > 20 ? 20 : value;
}

function clampFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Применение одного ключа эффекта к своду. Значения трактуются как доли для
 * «ресурсных»/«cost»/«growth»/«speed»/«damage» ключей и как готовые множители
 * для "*_mult". Детерминированно, без I/O.
 */
export function applyEffect(mods: EmpireModifiers, rawKey: string, value: number, systems = 0): void {
  if (!Number.isFinite(value) || value === 0) return;
  const key = rawKey.trim().toLowerCase().replace(/-/g, "_");
  if (key.length === 0) return;

  if (key.endsWith("_prod")) {
    const base = key.slice(0, -5);
    if (base === "all") {
      for (const res of Object.keys(PRODUCTION_KEYS) as ResourceId[]) mods.production[res] *= 1 + value;
      return;
    }
    if (base === "science" || base === "research") { mods.science *= 1 + value; return; }
    if (base === "district") {
      // district_prod: производство районов трактуем как общий бонус потокам (GDD §19).
      for (const res of Object.keys(PRODUCTION_KEYS) as ResourceId[]) mods.production[res] *= 1 + value;
      return;
    }
    const res = PRODUCTION_KEYS[base];
    if (res) { mods.production[res] *= 1 + value; return; }
    // physics_prod/society_prod/engineering_prod — только empireSchoolScience()
    return;
  }

  // "<X>_mult" — готовый множитель, "<X>_pct"/"<X>" — доля (+0.15 = +15%).
  const isMultKey = key.endsWith("_mult");
  const isPctKey = key.endsWith("_pct");
  const baseKey = isMultKey ? key.slice(0, -5) : isPctKey ? key.slice(0, -4) : key;
  if (baseKey === "production" || baseKey === "all_prod" || baseKey === "district") {
    for (const res of Object.keys(PRODUCTION_KEYS) as ResourceId[]) mods.production[res] *= 1 + value;
    return;
  }
  if (key === "stability_pct") {
    // +15% стабильности от базы GDD §19.1 (60) → +9 пункта.
    mods.stabilityBonus += Math.round(value * 60);
    return;
  }
  if (baseKey === "army") {
    mods.invasionMult *= 1 + value;
    return;
  }
  const field = SCALAR_MULT_TARGETS[baseKey];
  if (field) {
    mods[field] *= isMultKey ? value : 1 + value;
    return;
  }

  switch (key) {
    case "stability":
    case "stability_bonus":
      mods.stabilityBonus += value;
      return;
    case "happiness":
    case "happiness_bonus":
    case "approval":
      mods.happinessBonus += value;
      return;
    case "diplo_opinion":
    case "diplo_opinion_bonus":
      mods.diploOpinionBonus += value;
      return;
    case "diplomacy":
      // +10% дипломатии → +2 мнения (плоская аппроксимация, GDD §12.1)
      mods.diploOpinionBonus += Math.round(value * 20);
      return;
    case "legitimacy":
      // +20 легитимности → +5 стабильности (GDD §8.6)
      mods.stabilityBonus += Math.round(value * 0.25);
      return;
    case "trade":
    case "trade_margin":
      mods.tradeMarginBonus += value * 100;
      return;
    case "trade_margin_bonus":
      mods.tradeMarginBonus += value;
      return;
    case "sensor_range":
    case "sensor_range_bonus":
      mods.sensorRangeBonus += value;
      return;
    case "extra_tech_choice":
    case "tech_choice_bonus":
      mods.extraTechChoice += Math.round(value);
      return;
    case "flagship_autoescape":
      mods.flagshipAutoescape += value;
      return;
    case "fleet_cap":
      if (Math.abs(value) >= 1) mods.fleetCapFlat += value;
      else mods.fleetCapPct += value * 100;
      return;
    case "fleet_cap_flat":
      mods.fleetCapFlat += value;
      return;
    case "fleet_cap_pct":
    case "fleet_cap_percent":
    case "fleet_cap_pct_points":
      mods.fleetCapPct += value * 100;
      return;
    case "fleet_cap_per_10_systems":
      mods.fleetCapFlat += value * Math.floor(Math.max(0, systems) / 10);
      return;
    case "fleet_power_mult":
      mods.weaponDamageMult *= value;
      return;
    default:
      if (IGNORED_KEYS.has(key)) return;
      // Неизвестные ключи (расы/ветвь A0–A5) не теряем: они доступны системам/UI через special.
      mods.special[key] = (mods.special[key] ?? 0) + value;
      return;
  }
}

/**
 * Плоское +влияние/такт от формы правления (GDD §19.1). Экономика использует его как
 * УТОЧНЕНИЕ базовой константы: данные заменяют +1 базового влияния, а не дублируют его.
 */
export function empireGovernmentInfluenceFlat(world: World, empireId: number): number {
  const adv = world.fg?.empires[empireId];
  if (!adv) return 0;
  for (const government of GOVERNMENTS) {
    if (government.id !== adv.government) continue;
    return government.effects.influence_flat ?? 0;
  }
  return 0;
}

/** Плоские (не процентные) бонусы империи: +влияние/+энергия в такт и +очки каждой школе. */
export interface FlatEmpireYields {
  influence: number;
  energy: number;
  sciencePerSchool: number;
}

/** Собирает плоские бонусы из тех же источников, что и empireModifiers() (GDD §8.5–8.7). */
export function empireFlatYields(world: World, empireId: number): FlatEmpireYields {
  const out: FlatEmpireYields = { influence: 0, energy: 0, sciencePerSchool: 0 };
  for (const effects of collectEffectSources(world, empireId)) {
    for (const key of Object.keys(effects)) {
      const value = effects[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (key === "influence_flat") out.influence += value;
      else if (key === "energy_flat") out.energy += value;
      else if (key === "science_flat_per_school") out.sciencePerSchool += value;
    }
  }
  return out;
}

/** Применить набор эффектов "ключ → доля/множитель" к своду. */
export function applyEffectSet(mods: EmpireModifiers, effects: Record<string, number>, systems = 0): void {
  for (const key of Object.keys(effects)) {
    const value = effects[key];
    if (typeof value === "number") applyEffect(mods, key, value, systems);
  }
}

// ------------------------------------------------------------------ сбор источников

function techEffects(empireId: number, completed: string[]): Record<string, number>[] {
  void empireId;
  const out: Record<string, number>[] = [];
  for (const techId of completed) {
    const tech = TECH_BY_ID[techId];
    if (!tech) continue;
    const effects: Record<string, number> = {};
    for (const effect of tech.effects) {
      if (effect.kind !== "modifier" || typeof effect.value !== "number") continue;
      effects[effect.target] = (effects[effect.target] ?? 0) + effect.value;
    }
    if (Object.keys(effects).length > 0) out.push(effects);
  }
  return out;
}

function traditionEffects(world: World, empireId: number): Record<string, number>[] {
  const fg = world.fg;
  const adv = fg ? fg.empires[empireId] : undefined;
  if (!adv) return [];
  const out: Record<string, number>[] = [];
  const trees = traditionTrees();
  for (const nodeId of adv.traditions.unlocked) {
    for (const tree of trees) {
      const node = tree.nodes.find((n) => n.id === nodeId);
      if (node) { out.push(node.effects); break; }
    }
  }
  for (const finisherId of adv.traditions.finishers) {
    const finisher = findFinisher(finisherId);
    if (finisher) out.push(finisher.effects);
  }
  return out;
}

function perkEffects(world: World, empireId: number): Record<string, number>[] {
  const fg = world.fg;
  const adv = fg ? fg.empires[empireId] : undefined;
  if (!adv) return [];
  const out: Record<string, number>[] = [];
  const perks = allPerks();
  for (const perkId of adv.perks) {
    for (const perk of perks) if (perk.id === perkId) { out.push(perk.effects); break; }
  }
  return out;
}

function ethicsEffects(world: World, empireId: number): Record<string, number>[] {
  const fg = world.fg;
  const adv = fg ? fg.empires[empireId] : undefined;
  if (!adv) return [];
  const out: Record<string, number>[] = [];
  for (const ethicsId of adv.ethics) {
    for (const ethics of ETHICS) if (ethics.id === ethicsId) { out.push(ethics.effects); break; }
  }
  for (const government of GOVERNMENTS) if (government.id === adv.government) out.push(government.effects);
  for (const civicId of adv.civics) {
    for (const civic of CIVICS) if (civic.id === civicId) { out.push(civic.effects); break; }
  }
  return out;
}

function megastructureEffects(world: World, empireId: number): Record<string, number>[] {
  const fg = world.fg;
  if (!fg) return [];
  const out: Record<string, number>[] = [];
  for (const mega of fg.megastructures) {
    if (!mega.active || mega.ownerId !== empireId) continue;
    const def = MEGASTRUCTURES.find((entry) => entry.id === mega.type);
    const effects = def ? def.effects : MEGASTRUCTURE_FALLBACK_EFFECTS[mega.type];
    if (effects) out.push(effects);
  }
  return out;
}

function collectEffectSources(world: World, empireId: number): Record<string, number>[] {
  const out: Record<string, number>[] = [];
  let empire: { systems: number[]; techs: { completed: string[] } } | undefined;
  for (const candidate of world.empires) {
    if (candidate.id === empireId) { empire = candidate; break; }
  }
  if (empire) out.push(...techEffects(empireId, empire.techs.completed));
  out.push(...traditionEffects(world, empireId));
  out.push(...perkEffects(world, empireId));
  out.push(...ethicsEffects(world, empireId));
  out.push(...megastructureEffects(world, empireId));
  out.push(...ancientsEffectSources(world, empireId));
  return out;
}

/** Сводные модификаторы империи (технологии + традиции + перки + этики + федерация + санкции + мегаструктуры). */
function computeEmpireModifiers(world: World, empireId: number): EmpireModifiers {
  const mods = neutralModifiers();
  let systems = 0;
  for (const empire of world.empires) if (empire.id === empireId) { systems = empire.systems.length; break; }

  for (const effects of collectEffectSources(world, empireId)) applyEffectSet(mods, effects, systems);

  const fg = world.fg;
  if (fg) {
    // Федерация: общий рынок и общий флот (GDD §12.3).
    for (const federation of fg.federations) {
      if (!federation.members.includes(empireId)) continue;
      mods.tradeMarginBonus += FEDERATION_TRADE_MARGIN_BONUS;
      mods.diploOpinionBonus += FEDERATION_OPINION_BONUS;
      mods.fleetCapPct += FEDERATION_FLEET_CAP_PCT;
    }
    // Санкции совета (GDD §12.4): n санкций → −20% дохода и −10% науки каждая.
    const sanctions = fg.council.sanctions[empireId] ?? 0;
    if (sanctions > 0) {
      const income = Math.max(0.2, Math.pow(SANCTION_INCOME_MULT, sanctions));
      const science = Math.max(0.3, Math.pow(SANCTION_SCIENCE_MULT, sanctions));
      for (const res of Object.keys(mods.production) as ResourceId[]) mods.production[res] *= income;
      mods.science *= science;
      if (sanctions >= SANCTION_PARIAH_COUNT) mods.diploOpinionBonus += SANCTION_PARIAH_OPINION;
    }
    // Давление поздней игры (6200+): до −20% доходов.
    const pressure = fg.finalPressure > 0 ? Math.min(1, fg.finalPressure) : 0;
    if (pressure > 0) {
      const scale = 1 - FINAL_PRESSURE_INCOME_PENALTY * pressure;
      for (const res of Object.keys(mods.production) as ResourceId[]) mods.production[res] *= scale;
    }
  }

  // Административная нагрузка (03b §5.8 + GDD §19.6): штраф производства/науки/роста/лимита флота.
  {
    let colonies = 0;
    for (const empire of world.empires) if (empire.id === empireId) { colonies = empire.colonies.length; break; }
    const prod = sprawlProductionMult(systems, colonies);
    const sci = sprawlScienceMult(systems, colonies);
    for (const res of Object.keys(mods.production) as ResourceId[]) mods.production[res] *= prod;
    mods.science *= sci;
    mods.popGrowthMult *= sprawlGrowthMult(systems, colonies);
    mods.fleetCapFlat -= sprawlFleetCapPenalty(systems);
  }

  for (const res of Object.keys(mods.production) as ResourceId[]) mods.production[res] = clampMult(mods.production[res]);
  mods.science = clampMult(mods.science);
  const multFields: Array<keyof EmpireModifiers> = [
    "fleetUpkeepMult", "shipCostMult", "buildSpeedMult", "popGrowthMult", "unityMult",
    "influenceMult", "claimCostMult", "outpostCostMult", "colonyCostMult", "warScoreMult",
    "weaponDamageMult", "shieldMult", "armorMult", "invasionMult", "megastructureCostMult",
  ];
  for (const field of multFields) {
    const value = mods[field];
    if (typeof value === "number") mods[field] = clampMult(value) as never;
  }
  // Плоские поля могут быть отрицательными (штрафы этик/санкций) — только проверяем конечность.
  const flatFields: Array<keyof EmpireModifiers> = [
    "fleetCapFlat", "fleetCapPct", "stabilityBonus", "happinessBonus", "diploOpinionBonus",
    "tradeMarginBonus", "sensorRangeBonus", "extraTechChoice", "flagshipAutoescape",
  ];
  for (const field of flatFields) {
    const value = mods[field];
    if (typeof value === "number") mods[field] = clampFinite(value) as never;
  }
  return mods;
}

/**
 * Кэш сводных модификаторов: в одном такте empireModifiers() вызывается десятки раз
 * (колонии, экономика, ИИ, дипломатия). Без кэша профиль показывал до 68% времени такта
 * в modifiers.applyEffect/techEffects. Ключ учитывает всё, что влияет на эффекты.
 */
const MOD_CACHE = new WeakMap<World, Map<number, { key: string; mods: EmpireModifiers }>>();

export function empireModifiers(world: World, empireId: number): EmpireModifiers {
  const empire = world.empires.find((e) => e.id === empireId);
  const fg = world.fg;
  const adv = fg?.empires[empireId];
  const federationCount = fg ? fg.federations.filter((fed) => fed.members.includes(empireId)).length : 0;
  const megaCount = fg ? fg.megastructures.filter((m) => m.ownerId === empireId && m.active).length : 0;
  const key = [
    world.tick,
    empire?.techs.completed.length ?? 0,
    adv?.traditions.unlocked.length ?? 0,
    adv?.traditions.finishers.length ?? 0,
    adv ? Object.keys(adv.traditions.trees).length : 0,
    adv?.perks.length ?? 0,
    adv?.ethics.join(",") ?? "",
    adv?.government ?? "",
    adv?.civics.join(",") ?? "",
    fg?.council.sanctions[empireId] ?? 0,
    federationCount,
    megaCount,
    Math.round((fg?.finalPressure ?? 0) * 1000),
    empire?.systems.length ?? 0,
    empire?.colonies.length ?? 0,
    ancientsSignature(world, empireId),
  ].join("|");
  let cache = MOD_CACHE.get(world);
  if (!cache) {
    cache = new Map();
    MOD_CACHE.set(world, cache);
  }
  const hit = cache.get(empireId);
  if (hit && hit.key === key) return hit.mods;
  const mods = computeEmpireModifiers(world, empireId);
  if (cache.size > 64) cache.clear();
  cache.set(empireId, { key, mods });
  return mods;
}

/**
 * Множители школ науки по отдельности (physics_prod/society_prod/engineering_prod
 * из технологий, традиций, перков и этик). Глобальный бонус «science» — в empireModifiers().
 */
export function empireSchoolScience(world: World, empireId: number): Record<ScienceId, number> {
  const out: Record<ScienceId, number> = { physics: 1, society: 1, engineering: 1 };
  for (const effects of collectEffectSources(world, empireId)) {
    for (const key of Object.keys(effects)) {
      const value = effects[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (key === "physics_prod") out.physics *= 1 + value;
      else if (key === "society_prod") out.society *= 1 + value;
      else if (key === "engineering_prod") out.engineering *= 1 + value;
    }
  }
  for (const school of Object.keys(out) as ScienceId[]) out[school] = clampMult(out[school]);
  return out;
}
