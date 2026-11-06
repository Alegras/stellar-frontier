/**
 * Точка входа контента. Все числа баланса — в JSON, код их только читает.
 * Валидация схем: validate.ts (zod), запускается в CI через `pnpm data:validate`.
 */
import resourcesJson from "./resources.json";
import jobsJson from "./jobs.json";
import districtsJson from "./districts.json";
import buildingsJson from "./buildings.json";
import techsJson from "./techs.json";
import hullsJson from "./hulls.json";
import weaponsJson from "./weapons.json";
import modulesJson from "./modules.json";
import designsJson from "./designs.json";
import missionsJson from "./missions.json";
import namesJson from "./names.json";
import modeJson from "./mode.json";
import balanceJson from "./balance.json";
import ruJson from "./l10n/ru.json";
import enJson from "./l10n/en.json";
import type {
  BalanceConfig, BuildingDef, DistrictDef, HullDef, JobDef, Localization, MissionDef,
  ModeConfig, ModuleDef, NameBank, ResourceDef, ResourceId, ShipDesignDef, TechDef, WeaponDef,
} from "./schema";

export * from "./schema";
export { applyContentLocale, getContentLocale, contentTranslationStats, transliterateRu, type ContentLocale } from "./content-locale";

export const RESOURCES = resourcesJson as ResourceDef[];
export const JOBS = jobsJson as JobDef[];
export const DISTRICTS = districtsJson as DistrictDef[];
export const BUILDINGS = buildingsJson as BuildingDef[];
export const TECHS = techsJson as TechDef[];
export const HULLS = hullsJson as HullDef[];
export const WEAPONS = weaponsJson as WeaponDef[];
export const MODULES = modulesJson as ModuleDef[];
export const DESIGNS = designsJson as ShipDesignDef[];
export const MISSIONS = missionsJson as MissionDef[];
export const NAMES = namesJson as NameBank;
export const MODE = modeJson as ModeConfig;
export const BALANCE = balanceJson as BalanceConfig;
export const L10N_RU = ruJson as Localization;
export const L10N_EN = enJson as Localization;

export const RESOURCE_BY_ID: Record<ResourceId, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.id, r]),
) as Record<ResourceId, ResourceDef>;
export const JOB_BY_ID: Record<string, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j]));
export const DISTRICT_BY_ID: Record<string, DistrictDef> = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));
export const BUILDING_BY_ID: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
import { TECHS_EXTRA } from "./full/index";

/** Единый пул технологий: базовые TECHS + расширение full/techs-extra.json (M6–M12). */
export const TECHS_ALL: TechDef[] = [...TECHS, ...(TECHS_EXTRA as unknown as TechDef[])];
export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS_ALL.map((t) => [t.id, t]));
export const HULL_BY_ID: Record<string, HullDef> = Object.fromEntries(HULLS.map((h) => [h.id, h]));
export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]));
export const DESIGN_BY_ID: Record<string, ShipDesignDef> = Object.fromEntries(DESIGNS.map((d) => [d.id, d]));
export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

export const RESOURCE_IDS: ResourceId[] = RESOURCES.map((r) => r.id);
export const SCIENCE_IDS = ["physics", "society", "engineering"] as const;

export function techName(id: string): string {
  return TECH_BY_ID[id]?.ru ?? id;
}

/** Локализация: l10n["system.capital"] ?? fallback */
export function t(key: string, locale: "ru" | "en" = "ru"): string {
  const dict = locale === "en" ? L10N_EN : L10N_RU;
  return dict[key] ?? key;
}
import modeCoopJson from "./modes/coop.json";
import modeMmoJson from "./modes/mmo.json";
import modeSandboxJson from "./modes/sandbox.json";
import modeTrialJson from "./modes/trial.json";
export * from "./full/index";
export * from "./ancients/index";
export * from "./quests/index";
export * from "./campaign/index";
/** Полные ModeConfig для всех режимов (SP-кампания — MODE; кооп/MMO/песочница/испытание — ниже). */
export const MODE_COOP = modeCoopJson as unknown as ModeConfig;
export const MODE_MMO = modeMmoJson as unknown as ModeConfig;
export const MODE_SANDBOX = modeSandboxJson as unknown as ModeConfig;
export const MODE_TRIAL = modeTrialJson as unknown as ModeConfig;
export const MODE_MAP: Record<string, ModeConfig> = {
  campaign: MODE,
  coop: MODE_COOP,
  mmo: MODE_MMO,
  sandbox: MODE_SANDBOX,
  trial: MODE_TRIAL,
};