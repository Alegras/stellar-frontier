/**
 * @sf/sim — публичный API. Единственная точка входа для веба, тестов и сервера.
 * Симуляция чистая: нет DOM, нет Math.random, нет Date.now. Детерминизм по seed.
 */
export * from "./types";
export { seedRng, nextU32, nextInt, nextRange, nextFloat, pick, hash32 } from "./prng";
export type { RngState } from "./prng";
export { createWorld, getFleetPower, getEmpireFleetPower, getFleetCap, getScore, getVictory,
  getColonyOutput, getBuildCost, canAfford, getIncomeBreakdown, getProjectedIncome,
  getFleetInSystem, getEnemyFleetsInSystem, generateTechOffers,
  getCustomDesigns, getDesignById, getAvailableShipParts, getDesignPreview, validateShipDesign,
  getShipDesign, getHull, getWeapon, getModule, getTech, getBuilding, getDistrict, getJob,
  getMissionDef } from "./queries";
export { tick } from "./tick";
export { applyCommand, applyCommandAs, findPath } from "./commands";
export { autoResolve, applyBattleRecord } from "./combat";
export { serializeWorld, deserializeWorld, SIM_VERSION } from "./save";
// Реэкспорт типов контента для UI/рендера (единственный источник — @sf/data).
export type {
  ShipDesignDef, HullDef, WeaponDef, ModuleDef, TechDef, BuildingDef, DistrictDef, JobDef,
  MissionDef, ModeConfig, BalanceConfig, ResourceDef, NameBank, Localization, TechEffect,
  DamageType, MissionKind,
} from "@sf/data";
// ---------------- полная игра (M6–M12)
export * from "./fullgame";
export * from "./ancients";
export * from "./dlc";
export * from "./aiWorld";
export * from "./modifiers";
export * from "./traditions";
export * from "./diplomacy";
export * from "./war";
export * from "./federation";
export * from "./council";
export * from "./espionage";
export * from "./market";
export * from "./routes";
export * from "./contracts";
export * from "./campaign";
export * from "./narrative";
export * from "./anomalies";
export * from "./crisis";
export * from "./victory";
export * from "./megastructures";
// ---------------- конструктор кораблей (M5/M12)
export * from "./designs";