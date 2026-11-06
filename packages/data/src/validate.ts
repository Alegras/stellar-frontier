/**
 * Валидация контента (CI-гейт): `pnpm data:validate`.
 * Проверяет: обязательные поля, ссылочную целостность (tech/hull/module/design),
 * уникальность id, балансные инварианты.
 */
import { z } from "zod";
import {
  BUILDINGS, DESIGNS, DISTRICTS, HULLS, JOBS, MISSIONS, MODULES, RESOURCES, TECHS, WEAPONS, RESOURCE_BY_ID,
  BATTLE_ABILITIES, BATTLE_AI_PROFILES, BATTLE_CLASSES, BATTLE_SCENARIOS, BATTLE_TERRAIN,
  battleAbilitySchema, battleAiProfileSchema, battleClassSchema, battleScenarioSchema, battleTerrainSchema,
} from "./index";

const ids = (arr: { id: string }[]) => {
  const seen = new Set<string>();
  for (const x of arr) {
    if (seen.has(x.id)) throw new Error("duplicate id: " + x.id);
    seen.add(x.id);
  }
  return seen;
};

// zod4: record с enum-ключом экзаустивен по умолчанию; стоимость зданий/районов — частичная.
const resRef = z.partialRecord(z.enum(["energy", "minerals", "food", "alloys", "goods", "unity", "influence", "credits"]), z.number());

const buildingSchema = z.object({
  id: z.string().min(1), ru: z.string().min(1), descRu: z.string().min(1),
  cost: resRef, buildTicks: z.number().int().min(0), upkeepEnergy: z.number().min(0),
  jobs: z.array(z.string()),
});
const districtSchema = z.object({
  id: z.string(), ru: z.string(), descRu: z.string(), cost: resRef,
  buildTicks: z.number().int().min(0), upkeepEnergy: z.number().min(0), housing: z.number().min(0), jobs: z.array(z.string()),
});
const techSchema = z.object({
  id: z.string(), school: z.enum(["physics", "society", "engineering"]), tier: z.number().int().min(0).max(5),
  ru: z.string(), descRu: z.string(), cost: z.number().positive(), weight: z.number().positive(),
});
const hullSchema = z.object({
  id: z.string(), ru: z.string(), classId: z.string(), mass: z.number().positive(),
  maxMass: z.number().positive(), hullHp: z.number().positive(), costAlloys: z.number().positive(),
  buildTicks: z.number().int().min(1), baseSpeed: z.number().positive(),
});
const weaponSchema = z.object({
  id: z.string(), slot: z.enum(["small", "medium", "large"]), dmg: z.number().positive(),
  rof: z.number().positive(), accuracy: z.number().min(0).max(1), rangeM: z.number().positive(),
});
const moduleSchema = z.object({
  id: z.string(), slot: z.enum(["utility", "internal"]), mass: z.number().min(0),
  power: z.number().min(0), costAlloys: z.number().min(0),
});
const designSchema = z.object({
  id: z.string(), ru: z.string(), hullId: z.string(), classId: z.string(),
  fleetPower: z.number().positive(), costAlloys: z.number().positive(), buildTicks: z.number().int().min(1),
  weapons: z.array(z.string()), modules: z.array(z.string()),
});
const missionSchema = z.object({
  id: z.string(), kind: z.enum(["delivery", "bounty", "scan", "passenger", "smuggle", "rescue"]),
  ru: z.string(), minTicks: z.number().int(), maxTicks: z.number().int(), rewardCredits: z.number().positive(),
});

function check<T>(name: string, schema: z.ZodType<T>, arr: T[]) {
  arr.forEach((x, i) => {
    try { schema.parse(x); } catch (e) {
      throw new Error(`[${name}] item #${i} invalid: ${(e as Error).message}`);
    }
  });
  ids(arr as unknown as { id: string }[]);
  console.log(`ok ${name}: ${arr.length}`);
}

check("resources", z.object({ id: z.string(), ru: z.string(), wholesale: z.number().positive(), retail: z.number().positive() }), RESOURCES);
check("jobs", z.object({ id: z.string(), stratum: z.enum(["worker", "specialist", "ruler"]), slot: z.string(), output: z.record(z.string(), z.number()) }), JOBS);
check("districts", districtSchema, DISTRICTS);
check("buildings", buildingSchema, BUILDINGS);
check("techs", techSchema, TECHS);
check("hulls", hullSchema, HULLS);
check("weapons", weaponSchema, WEAPONS);
check("modules", moduleSchema, MODULES);
check("designs", designSchema, DESIGNS);
check("missions", missionSchema, MISSIONS);

const jobIds = ids(JOBS);
for (const b of BUILDINGS) for (const j of b.jobs) if (!jobIds.has(j)) throw new Error(`building ${b.id}: unknown job ${j}`);
for (const d of DISTRICTS) for (const j of d.jobs) if (!jobIds.has(j)) throw new Error(`district ${d.id}: unknown job ${j}`);

const techIds = ids(TECHS);
for (const t of TECHS) for (const req of t.requires ?? []) if (!techIds.has(req)) throw new Error(`tech ${t.id}: unknown requires ${req}`);

const weaponIds = ids(WEAPONS);
const moduleIds = ids(MODULES);
for (const d of DESIGNS) {
  if (!HULLS.some((h) => h.id === d.hullId)) throw new Error(`design ${d.id}: unknown hull ${d.hullId}`);
  for (const w of d.weapons) if (!weaponIds.has(w)) throw new Error(`design ${d.id}: unknown weapon ${w}`);
  for (const m of d.modules) if (!moduleIds.has(m)) throw new Error(`design ${d.id}: unknown module ${m}`);
}

for (const r of RESOURCES) if (!(r.id in RESOURCE_BY_ID)) throw new Error("resource map broken");
if (!DESIGNS.some((d) => d.classId === "frigate")) throw new Error("no starter frigate design");
// ---- Battle-контент (Сетка командования, M5b) ----
check("battle-classes", battleClassSchema, BATTLE_CLASSES);
check("battle-abilities", battleAbilitySchema, BATTLE_ABILITIES);
check("battle-terrain", battleTerrainSchema, BATTLE_TERRAIN);
check("battle-ai-profiles", battleAiProfileSchema, BATTLE_AI_PROFILES);
for (const s of BATTLE_SCENARIOS) battleScenarioSchema.parse(s);
const btlClassIds = ids(BATTLE_CLASSES);
const btlAbilityIds = ids(BATTLE_ABILITIES);
const btlTerrainIds = ids(BATTLE_TERRAIN);
ids(BATTLE_AI_PROFILES);
ids(BATTLE_SCENARIOS);
if (BATTLE_CLASSES.length !== 8) throw new Error("battle-classes: " + BATTLE_CLASSES.length + " (need 8)");
if (BATTLE_ABILITIES.length !== 16) throw new Error("battle-abilities: " + BATTLE_ABILITIES.length + " (need 16)");
if (BATTLE_ABILITIES.filter((a) => a.kind === "active").length !== 10) throw new Error("battle-abilities: active != 10");
if (BATTLE_ABILITIES.filter((a) => a.kind === "passive").length !== 6) throw new Error("battle-abilities: passive != 6");
if (BATTLE_TERRAIN.length !== 6) throw new Error("battle-terrain: " + BATTLE_TERRAIN.length + " (need 6)");
if (BATTLE_AI_PROFILES.length !== 3) throw new Error("battle-ai-profiles: " + BATTLE_AI_PROFILES.length + " (need 3)");
if (BATTLE_SCENARIOS.length !== 3) throw new Error("battle-scenarios: " + BATTLE_SCENARIOS.length + " (need 3)");
const btlPassiveIds = new Set<string>();
for (const c of BATTLE_CLASSES) {
  if (c.hpStack !== c.hpPerHull * c.maxStack) throw new Error("class " + c.id + ": hpStack");
  if (c.damageStack !== Math.round(c.dpsPerHull * c.maxStack * 3)) throw new Error("class " + c.id + ": damageStack");
  if (btlPassiveIds.has(c.passiveAbility.id)) throw new Error("class passive duplicate: " + c.passiveAbility.id);
  btlPassiveIds.add(c.passiveAbility.id);
  if (c.passiveAbilityId !== c.passiveAbility.id) throw new Error("class " + c.id + ": passiveAbilityId mismatch");
}
const codes = new Set(BATTLE_TERRAIN.map((t) => t.code));
if (codes.size !== 6) throw new Error("battle-terrain: duplicate codes");
for (const s of BATTLE_SCENARIOS) {
  const stacks = [...s.attacker.stacks, ...s.defender.stacks];
  for (const st of stacks) {
    if (!btlClassIds.has(st.classId)) throw new Error("scenario " + s.id + ": unknown class " + st.classId);
    if (st.facing < 0 || st.facing > 5) throw new Error("scenario " + s.id + ": facing " + st.facing);
  }
  for (const t of s.terrainPreset.terrainIds) if (!btlTerrainIds.has(t)) throw new Error("scenario " + s.id + ": unknown terrain " + t);
}
void btlAbilityIds;
console.log("battle content: classes 8, abilities 16 (10+6), terrain 6, ai 3, scenarios 3");
console.log("data validation passed");