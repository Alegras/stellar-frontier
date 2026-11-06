/** Часть XV · Сетка командования (M5b): battle-контент. */
import classesJson from "./classes.json";
import abilitiesJson from "./abilities.json";
import terrainJson from "./terrain.json";
import aiProfilesJson from "./ai-profiles.json";
import scenariosJson from "./sample-battles.json";
import type {
  BattleAbilityDef, BattleAiProfileDef, BattleClassDef, BattleScenarioDef, BattleTerrainDef,
} from "./schema";

export * from "./schema";
export const BATTLE_CLASSES = classesJson as unknown as BattleClassDef[];
export const BATTLE_ABILITIES = abilitiesJson as unknown as BattleAbilityDef[];
export const BATTLE_TERRAIN = terrainJson as unknown as BattleTerrainDef[];
export const BATTLE_AI_PROFILES = aiProfilesJson as unknown as BattleAiProfileDef[];
export const BATTLE_SCENARIOS = (scenariosJson as unknown as { version: number; scenarios: BattleScenarioDef[] }).scenarios;

export const BATTLE_CLASS_BY_ID: Record<string, BattleClassDef> = Object.fromEntries(BATTLE_CLASSES.map((c) => [c.id, c]));
export const BATTLE_ABILITY_BY_ID: Record<string, BattleAbilityDef> = Object.fromEntries(BATTLE_ABILITIES.map((a) => [a.id, a]));
export const BATTLE_TERRAIN_BY_ID: Record<string, BattleTerrainDef> = Object.fromEntries(BATTLE_TERRAIN.map((t) => [t.id, t]));
export const BATTLE_AI_PROFILE_BY_ID: Record<string, BattleAiProfileDef> = Object.fromEntries(BATTLE_AI_PROFILES.map((a) => [a.id, a]));
export const BATTLE_SCENARIO_BY_ID: Record<string, BattleScenarioDef> = Object.fromEntries(BATTLE_SCENARIOS.map((s) => [s.id, s]));
