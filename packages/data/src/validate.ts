/**
 * Валидация контента (CI-гейт): `pnpm data:validate`.
 * Проверяет: обязательные поля, ссылочную целостность (tech/hull/module/design),
 * уникальность id, балансные инварианты.
 */
import { z } from "zod";
import {
  BUILDINGS, DESIGNS, DISTRICTS, HULLS, JOBS, MISSIONS, MODULES, RESOURCES, TECHS, WEAPONS, RESOURCE_BY_ID,
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
console.log("data validation passed");