/**
 * Часть XIII: чистые источники эффектов рас и ветви Наследия для modifiers.ts.
 * Не импортирует economy/fullgame — чтобы не создавать циклов.
 */
import {
  ANCIENT_TECH_BY_ID, ANCIENTS_TECHS, RACE_BY_ID, RACE_TRAIT_BY_ID,
} from "@sf/data";
import type { RaceDef } from "@sf/data";
import type { World } from "./types";

/** Эффекты ветви A0–A5 капятся суммарно 0.35 (13c §3.5). */
export const ANSARI_BONUS_CAP = 0.35;

export interface AncientsCatalogFx {
  races?: RaceDef[];
  traits?: { id: string; effects: Record<string, number> }[];
  techs?: { id: string; effects: Record<string, number> }[];
}

export function raceDefFx(raceId: string | null | undefined): RaceDef | null {
  return raceId ? RACE_BY_ID[raceId] ?? null : null;
}

/** Раса империи (игрок — playerRace, ИИ — из распределения). */
export function raceIdOf(world: World, empireId: number): string | null {
  const a = world.fg?.ancients;
  if (!a) return null;
  if (empireId === world.playerEmpireId) return a.playerRace ?? null;
  return a.races[empireId] ?? null;
}

/** Эффекты трейтов расы (в формате applyEffect). */
export function raceEffectSources(world: World, empireId: number): Record<string, number>[] {
  const raceId = raceIdOf(world, empireId);
  const race = raceId ? RACE_BY_ID[raceId] : null;
  if (!race) return [];
  const out: Record<string, number>[] = [];
  for (const traitId of race.traits) {
    const trait = RACE_TRAIT_BY_ID[traitId];
    if (trait && trait.effects) out.push(trait.effects);
  }
  return out;
}

/** Эффекты открытых технологий Наследия (только игрок), с капом 0.35. */
export function ancientsTechEffectSources(world: World, empireId: number): Record<string, number>[] {
  const a = world.fg?.ancients;
  if (!a || empireId !== world.playerEmpireId) return [];
  const out: Record<string, number>[] = [];
  let positive = 0;
  for (const techId of a.tech.unlocked) {
    const tech = ANCIENT_TECH_BY_ID[techId];
    if (!tech || !tech.effects) continue;
    out.push(tech.effects);
    for (const key of Object.keys(tech.effects)) {
      const value = tech.effects[key];
      if (typeof value === "number" && value > 0) positive += value;
    }
  }
  if (positive <= ANSARI_BONUS_CAP || out.length === 0) return out;
  const scale = ANSARI_BONUS_CAP / positive;
  return out.map((effects) => {
    const scaled: Record<string, number> = {};
    for (const key of Object.keys(effects)) {
      const value = effects[key];
      scaled[key] = typeof value === "number" && value > 0 ? value * scale : value;
    }
    return scaled;
  });
}

/** Версия ветви для кэша модификаторов. */
export function ancientsSignature(world: World, empireId: number): string {
  const a = world.fg?.ancients;
  if (!a) return "";
  const race = empireId === world.playerEmpireId ? a.playerRace : a.races[empireId];
  return [race ?? "", a.tech.unlocked.length, a.tech.tier, a.flags["resonance_wave"] ?? 0].join(":");
}

/** Все источники эффектов Части XIII. */
export function ancientsEffectSources(world: World, empireId: number): Record<string, number>[] {
  return [...raceEffectSources(world, empireId), ...ancientsTechEffectSources(world, empireId)];
}

/** Сумма конкретного (обычно «специального») ключа по расе и ветви (без cycle с modifiers). */
export function ancientsSpecialValue(world: World, empireId: number, key: string): number {
  let sum = 0;
  for (const effects of ancientsEffectSources(world, empireId)) {
    const value = effects[key];
    if (typeof value === "number" && Number.isFinite(value)) sum += value;
  }
  return sum;
}

export function allAncientsTechsFx() {
  return ANCIENTS_TECHS;
}
