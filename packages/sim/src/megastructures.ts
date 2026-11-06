/**
 * МЕГАСТРУКТУРЫ (M12, GDD §8.7): 7 типов, строительство, эффекты, перехват.
 *
 * Данные MEGASTRUCTURES в @sf/data могут быть пустыми — используется fallback GDD §8.7.
 * Эффекты возвращаются в виде карты модификаторов (ключи — как в traditions/perks:
 * энергия/минералы/сплавы/наука/флот/рост; значения — доли), её потребляет modifiers.ts.
 */
import { MEGASTRUCTURES, TECH_BY_ID } from "@sf/data";
import { empireModifiers } from "./modifiers";
import { techById } from "./queries";
import type { MegastructureDef } from "@sf/data";
import {
  empireById, logEvent, techModifiers, zeroMilli,
} from "./economy";
import { advancedOf, ensureFg, pushJournal } from "./fullgame";
import type { MegastructureState, MegastructureType } from "./fullgame";
import type { CommandResult, World } from "./types";

/** Требуемый тир технологий для fallback-режима (GDD §8.7). */
const FALLBACK_TIERS: Record<MegastructureType, number> = {
  sentinel_array: 3,
  gate: 3,
  star_forge: 4,
  ring_habitat: 4,
  dyson_sphere: 5,
  science_nexus: 5,
  beacon: 4,
};

const FALLBACK_MEGASTRUCTURES: MegastructureDef[] = [
  {
    id: "sentinel_array", ru: "Сеть Сентри", descRu: "+2 прыжка сенсоров, +10% науки.",
    costAlloys: 1500, buildTicks: 60, requiredTech: null, requiredPerk: null,
    effects: { sensor_range: 2, science_prod: 0.1 }, maxPerEmpire: 1,
  },
  {
    id: "gate", ru: "Врата", descRu: "Мгновенный переход между вратами, +2 к сенсорам.",
    costAlloys: 1200, buildTicks: 40, requiredTech: null, requiredPerk: null,
    effects: { sensor_range: 2, fleet_cap_pct: 0.05 }, maxPerEmpire: 3,
  },
  {
    id: "star_forge", ru: "Звёздная кузня", descRu: "+25% сплавов, +10% минералов.",
    costAlloys: 4000, buildTicks: 120, requiredTech: null, requiredPerk: null,
    effects: { alloys_prod: 0.25, minerals_prod: 0.1 }, maxPerEmpire: 1,
  },
  {
    id: "ring_habitat", ru: "Кольцевой мир", descRu: "+50 жилья, +10 рабочих мест, +15% роста.",
    costAlloys: 2500, costMinerals: 500, buildTicks: 90, requiredTech: null, requiredPerk: null,
    effects: { pop_growth: 0.15, housing: 50, jobs: 10 }, maxPerEmpire: 1,
  },
  {
    id: "dyson_sphere", ru: "Сфера Дайсона", descRu: "+300 энергии/такт.",
    costAlloys: 8000, buildTicks: 200, requiredTech: null, requiredPerk: null,
    effects: { energy_flat: 300, energy_prod: 0.15 }, maxPerEmpire: 1,
  },
  {
    id: "science_nexus", ru: "Научный Нексус", descRu: "+15% ко всем школам, +1 альтернатива технологий.",
    costAlloys: 3000, buildTicks: 100, requiredTech: null, requiredPerk: null,
    effects: { science_prod: 0.15, extra_tech_choice: 1 }, maxPerEmpire: 1,
  },
  {
    id: "beacon", ru: "Маяк", descRu: "+20% флотского лимита, +1 доктрина.",
    costAlloys: 2000, buildTicks: 80, requiredTech: null, requiredPerk: null,
    effects: { fleet_cap_pct: 0.2 }, maxPerEmpire: 1,
  },
];

export function megastructureDefinitions(): MegastructureDef[] {
  return MEGASTRUCTURES.length > 0 ? (MEGASTRUCTURES as MegastructureDef[]) : FALLBACK_MEGASTRUCTURES;
}

export function megastructureDefinition(type: MegastructureType): MegastructureDef | undefined {
  return megastructureDefinitions().find((def) => def.id === type);
}

/** Максимальный тир завершённых технологий (база + TECHS_EXTRA) — для гейтов мегаструктур. */
export function megastructureTechTier(world: World, empireId: number): number {
  const empire = empireById(world, empireId);
  if (!empire) return -1;
  const registry = techById();
  let tier = -1;
  for (const techId of empire.techs.completed) {
    const tech = registry[techId] ?? TECH_BY_ID[techId];
    if (tech && tech.tier > tier) tier = tech.tier;
  }
  return tier;
}

/** Стоимость с учётом имперских модификаторов (перки/традиции: megastructure_cost). */
export function megastructureCost(
  world: World,
  type: MegastructureType,
  empireId = world.playerEmpireId,
): { alloys: number; minerals: number } {
  const def = megastructureDefinition(type);
  if (!def) return { alloys: 0, minerals: 0 };
  const mult = empireModifiers(world, empireId).megastructureCostMult;
  return { alloys: Math.round(def.costAlloys * mult), minerals: Math.round((def.costMinerals ?? 0) * mult) };
}

function ownedOfType(world: World, empireId: number, type: MegastructureType): number {
  const fg = ensureFg(world);
  let count = 0;
  for (const mega of fg.megastructures) if (mega.ownerId === empireId && mega.type === type) count += 1;
  return count;
}

/** Начать строительство мегаструктуры в своей системе. */
export function buildMegastructure(
  world: World,
  empireId: number,
  type: MegastructureType,
  systemId: number,
): CommandResult {
  const fg = ensureFg(world);
  const empire = empireById(world, empireId);
  if (!empire) return { ok: false, messageRu: "Империя не найдена" };
  const def = megastructureDefinition(type);
  if (!def) return { ok: false, messageRu: "Неизвестный тип мегаструктуры" };
  const system = world.systems[systemId];
  if (!system) return { ok: false, messageRu: "Система не найдена" };
  if (system.ownerId !== empireId) return { ok: false, messageRu: "Мегаструктуру можно строить только в своей системе" };
  if (fg.megastructures.some((mega) => mega.systemId === systemId && mega.type === type)) {
    return { ok: false, messageRu: "В этой системе такая мегаструктура уже есть" };
  }
  if (ownedOfType(world, empireId, type) >= def.maxPerEmpire) {
    return { ok: false, messageRu: "Достигнут лимит мегаструктур этого типа" };
  }
  // требования: технология (или эквивалентный тир) + перк вознесения
  const requiredTier = FALLBACK_TIERS[type] ?? 0;
  const tierOk = megastructureTechTier(world, empireId) >= requiredTier;
  const techOk = def.requiredTech !== null && empire.techs.completed.includes(def.requiredTech);
  if (!tierOk && !techOk) {
    return { ok: false, messageRu: `Требуется технология эпохи T${requiredTier}` };
  }
  if (def.requiredPerk) {
    const adv = advancedOf(world, empireId);
    if (!adv.perks.includes(def.requiredPerk)) {
      return { ok: false, messageRu: `Требуется перк вознесения «${def.requiredPerk}»` };
    }
  }
  const cost = megastructureCost(world, type, empireId);
  const alloys = cost.alloys;
  const minerals = cost.minerals;
  if (empire.resources.alloys < alloys) return { ok: false, messageRu: "Не хватает сплавов" };
  if (empire.resources.minerals < minerals) return { ok: false, messageRu: "Не хватает минералов" };
  empire.resources.alloys -= alloys;
  empire.resources.minerals -= minerals;
  const maxHp = 500 + Math.round(def.costAlloys / 2);
  const mega: MegastructureState = {
    id: fg.nextMegastructureId++,
    type,
    systemId,
    ownerId: empireId,
    ticksLeft: def.buildTicks,
    totalTicks: def.buildTicks,
    active: false,
    hp: maxHp,
    maxHp,
  };
  fg.megastructures.push(mega);
  logEvent(world, "colony", "good", `Начато строительство мегаструктуры «${def.ru}» в системе ${system.name}.`, systemId, empireId);
  pushJournal(fg, world.tick, "megastructure", `Начата мегаструктура «${def.ru}».`);
  return { ok: true, createdId: mega.id };
}

function destroyMegastructure(world: World, mega: MegastructureState, reasonRu: string): void {
  const fg = ensureFg(world);
  const index = fg.megastructures.indexOf(mega);
  if (index >= 0) fg.megastructures.splice(index, 1);
  logEvent(world, "warn", "bad", reasonRu, mega.systemId, mega.ownerId);
  pushJournal(fg, world.tick, "megastructure", reasonRu);
}

/** Фаза такта: стройка, активация, перехват и урон от кризисов. */
export function megastructurePhase(world: World): void {
  const fg = ensureFg(world);
  const destroyed: MegastructureState[] = [];
  for (const mega of fg.megastructures) {
    const def = megastructureDefinition(mega.type);
    if (!def) continue;
    const system = world.systems[mega.systemId];
    if (!system) {
      destroyed.push(mega);
      continue;
    }
    // перехват: система сменила владельца
    if (system.ownerId !== mega.ownerId) {
      if (system.ownerId === 0) {
        destroyMegastructure(world, mega, `Мегаструктура «${def.ru}» уничтожена (система потеряна).`);
      } else {
        mega.ownerId = system.ownerId;
        mega.hp = Math.max(1, Math.round(mega.hp * 0.5));
        logEvent(world, "warn", "warn", `Мегаструктура «${def.ru}» перехвачена другой империей.`, system.id, mega.ownerId);
        pushJournal(fg, world.tick, "megastructure", `Мегаструктура «${def.ru}» перехвачена.`);
      }
      continue;
    }
    if (!mega.active) {
      if (mega.ticksLeft > 0) mega.ticksLeft -= 1;
      if (mega.ticksLeft <= 0) {
        mega.ticksLeft = 0;
        mega.active = true;
        logEvent(world, "colony", "good", `Мегаструктура «${def.ru}» достроена и активна.`, system.id, mega.ownerId);
        pushJournal(fg, world.tick, "megastructure", `Мегаструктура «${def.ru}» активна.`);
      }
      continue;
    }
    // кризис в системе повреждает мегаструктуру
    const crisis = fg.crises.find((c) => !c.defeated && c.systems.includes(system.id));
    if (crisis) {
      const damage = Math.max(5, Math.round(crisis.strengthFp / 100));
      mega.hp -= damage;
      if (mega.hp <= 0) {
        destroyMegastructure(world, mega, `Мегаструктура «${def.ru}» разрушена кризисом.`);
        destroyed.push(mega);
      }
    }
  }
  for (const mega of destroyed) {
    const index = fg.megastructures.indexOf(mega);
    if (index >= 0) fg.megastructures.splice(index, 1);
  }
}

/** Сводные модификаторы от активных мегаструктур империи (для modifiers.ts). */
export function megastructureProductionMult(world: World, empireId: number): Record<string, number> {
  const fg = ensureFg(world);
  const out: Record<string, number> = {};
  for (const mega of fg.megastructures) {
    if (mega.ownerId !== empireId || !mega.active) continue;
    const def = megastructureDefinition(mega.type);
    if (!def) continue;
    for (const [key, value] of Object.entries(def.effects)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/** Активные мегаструктуры империи (для UI). */
export function empireMegastructures(world: World, empireId: number): MegastructureState[] {
  const fg = ensureFg(world);
  return fg.megastructures.filter((mega) => mega.ownerId === empireId);
}
