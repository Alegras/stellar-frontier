/**
 * Часть XV: сетка командования (M5b). Данные battle-контента.
 * Схемы zod + типы; массивы читает @sf/battle-grid и UI (карточки/стеки).
 */
import { z } from "zod";

export const battleClassSchema = z.object({
  id: z.enum(["corvette", "frigate", "destroyer", "cruiser", "battleship", "titan", "carrier", "colossus"]),
  code: z.enum(["CV", "FR", "DD", "CA", "BB", "TT", "CVN", "CL"]),
  titleRu: z.string().min(2),
  roleRu: z.string().min(2),
  descRu: z.string().min(10),
  passiveAbilityId: z.string().min(2),
  passiveAbility: z.object({
    id: z.string().min(2),
    titleRu: z.string().min(2),
    descRu: z.string().min(10),
    effectRu: z.string().min(5),
  }),
  hpPerHull: z.number().int().positive(),
  maxStack: z.number().int().positive(),
  hpStack: z.number().int().positive(),
  dpsPerHull: z.number().positive(),
  damageStack: z.number().int().positive(),
  initiative: z.number().int(),
  mp: z.number().int().nonnegative(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  range: z.number().int().nonnegative(),
  fp: z.number().int().nonnegative(),
  highlights: z.array(z.string().min(3)).min(2),
});

const targetingSchema = z.object({
  type: z.enum(["self", "enemy_stack", "line", "all_allies", "reserve"]),
  length: z.number().int().positive().optional(),
  radius: z.number().int().positive().optional(),
  from: z.string().optional(),
});
const effectSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

export const battleAbilitySchema = z.object({
  id: z.string().min(2),
  titleRu: z.string().min(2),
  descRu: z.string().min(10),
  kind: z.enum(["active", "passive"]),
  source: z.enum(["admiral", "class"]),
  costOk: z.number().int().nonnegative(),
  cooldownRounds: z.number().int().nonnegative(),
  targeting: targetingSchema,
  effect: effectSchema,
  limits: z.object({ oncePerRound: z.boolean().optional(), oncePerBattle: z.boolean().optional() }),
  highlights: z.array(z.string().min(3)).min(2),
  iconId: z.string().min(2),
});

export const battleTerrainSchema = z.object({
  id: z.enum(["void", "asteroid", "nebula", "debris", "minefield", "gravity_anomaly"]),
  code: z.enum(["P", "A", "N", "D", "M", "G"]),
  titleRu: z.string().min(2),
  descRu: z.string().min(10),
  passable: z.boolean(),
  moveCost: z.number().int().nonnegative(),
  losBlock: z.boolean(),
  coverResist: z.number().min(0).max(1),
  accuracyDelta: z.number().min(-1).max(1),
  extraCost: z.number().int().nonnegative().optional(),
  effects: z.array(z.string().min(3)).min(1),
  highlights: z.array(z.string().min(3)).min(1),
});

export const battleAiProfileSchema = z.object({
  id: z.enum(["aggressor", "kiter", "defender"]),
  titleRu: z.string().min(2),
  descRu: z.string().min(10),
  weights: z.object({
    damage: z.number(), kill: z.number(), threatReduction: z.number(), cover: z.number(),
    keyCell: z.number(), reserve: z.number(), counterPenalty: z.number(), overkillPenalty: z.number(),
    flagshipBonus: z.number(),
  }),
  highlights: z.array(z.string().min(3)).min(2),
});

const battleStackSchema = z.object({
  classId: z.string().min(2),
  designId: z.string().min(2).optional(),
  count: z.number().int().positive(),
  facing: z.number().int().min(0).max(5),
  reserve: z.boolean(),
});

export const battleScenarioSchema = z.object({
  id: z.string().min(2),
  titleRu: z.string().min(2),
  descRu: z.string().min(10),
  seed: z.number().int().nonnegative(),
  objective: z.enum(["annihilation"]),
  terrainPreset: z.object({ nameRu: z.string().min(2), terrainIds: z.array(z.string()).min(1) }),
  attacker: z.object({ factionRu: z.string().min(2), stacks: z.array(battleStackSchema).min(1) }),
  defender: z.object({ factionRu: z.string().min(2), stacks: z.array(battleStackSchema).min(1) }),
  expected: z.object({ roundsPlayed: z.number().int(), winner: z.enum(["attacker", "defender"]), replayHash: z.string() }).nullable(),
});

export type BattleClassDef = z.infer<typeof battleClassSchema>;
export type BattleAbilityDef = z.infer<typeof battleAbilitySchema>;
export type BattleTerrainDef = z.infer<typeof battleTerrainSchema>;
export type BattleAiProfileDef = z.infer<typeof battleAiProfileSchema>;
export type BattleScenarioDef = z.infer<typeof battleScenarioSchema>;
