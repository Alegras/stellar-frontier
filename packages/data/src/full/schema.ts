/**
 * Схемы данных полной игры (M6–M12): традиции, перки, технологии-дополнения,
 * мегаструктуры, кризисы, резолюции совета, шпионаж, режимы.
 * Числа — только здесь, код читает через @sf/data.
 */
import type { ResourceId, ScienceId, TechEffect } from "../schema";

export interface TraditionNodeDef {
  id: string;
  treeId: string;
  index: number;
  ru: string;
  descRu: string;
  cost: number;
  requires: string[];
  /** ключ модификатора → значение (например {"energy_prod":0.1}) */
  effects: Record<string, number>;
}

export interface TraditionTreeDef {
  id: string;
  ru: string;
  descRu: string;
  color: string;
  nodes: TraditionNodeDef[];
  finisher: { id: string; ru: string; descRu: string; effects: Record<string, number> };
}

export interface PerkDef {
  id: string;
  ru: string;
  descRu: string;
  cost: number;
  requires: string[];
  effects: Record<string, number>;
  unlocks?: string[];
}

export interface MegastructureDef {
  id: string;
  ru: string;
  descRu: string;
  costAlloys: number;
  costMinerals?: number;
  buildTicks: number;
  requiredTech: string | null;
  requiredPerk: string | null;
  effects: Record<string, number>;
  maxPerEmpire: number;
}

export interface CrisisDef {
  id: string;
  kind: string;
  ru: string;
  descRu: string;
  startTick: number;
  scalingFp: number;
  fleets: number;
  fleetFp: number;
  nodes: number;
  durationTicks: number;
  rewards: { alloys: number; credits: number; science: number; unlock?: string };
}

export interface CouncilResolutionDef {
  id: string;
  type: string;
  ru: string;
  descRu: string;
  influenceCost: number;
  vetoable: boolean;
  effects: { target: string; value: number }[];
  durationTicks: number;
}

export interface EspionageOpDef {
  id: string;
  ru: string;
  descRu: string;
  influenceCost: number;
  baseChance: number;
  requiresTech?: string;
  effects: { target: string; value: number }[];
}

export interface ModeDefFull {
  modeId: string;
  displayRu: string;
  descRu: string;
  playersMax: number;
  humans: number;
  tickSeconds: number;
  pausePolicy: "free" | "vote" | "none";
  tacticalLockTicks: number;
  aiEmpires: number;
  galaxySystems: number;
  victory: string[];
  saves: "local" | "server";
  ranking: boolean;
}

export interface EthicsDef {
  id: string;
  ru: string;
  descRu: string;
  axis: string;
  effects: Record<string, number>;
}

export interface GovernmentDef {
  id: string;
  ru: string;
  descRu: string;
  effects: Record<string, number>;
}

export interface CivicDef {
  id: string;
  ru: string;
  descRu: string;
  effects: Record<string, number>;
}

export interface FocusGoalDef {
  id: string;
  ru: string;
  descRu: string;
  requires: string;
  reward: string;
}

export interface TechExtraDef {
  id: string;
  school: ScienceId;
  tier: number;
  ru: string;
  descRu: string;
  cost: number;
  effects: TechEffect[];
  weight: number;
  requires?: string[];
  unlocks?: string[];
}
