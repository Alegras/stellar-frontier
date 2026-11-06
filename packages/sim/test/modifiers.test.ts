import { describe, expect, it } from "vitest";
import { BALANCE, CIVICS, ETHICS, GOVERNMENTS, MODE, TECHS } from "@sf/data";
import type { ResourceId } from "@sf/data";
import { createWorld, getScore } from "../src/queries";
import { advancedOf } from "../src/fullgame";
import { colonyCostFor, outpostCostFor, projectEmpire, updateStability } from "../src/economy";
import {
  empireModifiers, empireSchoolScience, neutralModifiers,
} from "../src/modifiers";
import { allPerks, traditionTrees, unlockPerk, unlockTradition } from "../src/traditions";
import type { World } from "../src/types";

function makeWorld(): World {
  return createWorld(42, MODE, BALANCE);
}

function empire(world: World, id = 1) {
  const found = world.empires.find((e) => e.id === id);
  if (!found) throw new Error("нет империи " + id);
  return found;
}

const RESOURCES: ResourceId[] = ["energy", "minerals", "food", "alloys", "goods", "unity", "influence", "credits"];

describe("empireModifiers: свод эффектов (M6)", () => {
  it("свежая империя: все поля заполнены и конечны", () => {
    const world = makeWorld();
    const mods = empireModifiers(world, 1);
    for (const field of Object.keys(neutralModifiers()) as Array<keyof ReturnType<typeof neutralModifiers>>) {
      if (field === "production" || field === "special") continue;
      expect(Number.isFinite(mods[field] as number), String(field)).toBe(true);
    }
    for (const res of RESOURCES) {
      expect(mods.production[res], res).toBeGreaterThan(0);
      expect(Number.isFinite(mods.production[res])).toBe(true);
    }
  });

  it("без этик/правительств/цивиков в данных свод равен нейтральному", () => {
    const world = makeWorld();
    if (ETHICS.length > 0 || GOVERNMENTS.length > 0 || CIVICS.length > 0) return;
    expect(empireModifiers(world, 1)).toEqual(neutralModifiers());
  });

  it("завершённые технологии учитываются (energy_prod +5%)", () => {
    const world = makeWorld();
    empire(world).techs.completed.push("phys_reactor_1"); // energy_prod = 0.05
    const mods = empireModifiers(world, 1);
    expect(mods.production.energy).toBeCloseTo(1.05, 6);
    const before = projectEmpire(world, empire(world)).income.energy;
    empire(world).techs.completed.push("soc_ascension_1"); // +10% ко всем потокам
    const after = projectEmpire(world, empire(world)).income.energy;
    expect(after).toBeGreaterThan(before);
  });

  it("школьные бонусы науки (physics/society/engineering_prod)", () => {
    const world = makeWorld();
    empire(world).techs.completed.push("soc_education_2");
    const schools = empireSchoolScience(world, 1);
    expect(schools.physics).toBeCloseTo(1.1, 6);
    expect(schools.society).toBeCloseTo(1.1, 6);
    expect(schools.engineering).toBeCloseTo(1.1, 6);
  });

  it("санкции совета: −20% дохода и −10% науки за каждую", () => {
    const world = makeWorld();
    const fg = world.fg!;
    const before = empireModifiers(world, 1);
    fg.council.sanctions[1] = 2;
    const after = empireModifiers(world, 1);
    // Санкции стакаются поверх остальных источников (этики/цивики).
    expect(after.production.energy).toBeCloseTo(before.production.energy * Math.pow(0.8, 2), 6);
    expect(after.science).toBeCloseTo(before.science * Math.pow(0.9, 2), 6);
  });

  it("давление финала: −20% доходов при finalPressure = 1", () => {
    const world = makeWorld();
    const before = empireModifiers(world, 1);
    world.fg!.finalPressure = 1;
    const mods = empireModifiers(world, 1);
    for (const res of RESOURCES) {
      expect(mods.production[res], res).toBeCloseTo(before.production[res] * 0.8, 6);
    }
  });

  it("членство в федерации даёт торговлю, мнение и лимит флота", () => {
    const world = makeWorld();
    world.fg!.federations.push({
      id: 1, nameRu: "Тестовая федерация", members: [1, 2], presidentId: 1, foundedTick: 0,
      treasuryEnergy: 0, treasuryAlloys: 0, fleetIds: [], nextChairTick: 0, votes: {},
    });
    const mods = empireModifiers(world, 1);
    expect(mods.tradeMarginBonus).toBeGreaterThan(0);
    expect(mods.diploOpinionBonus).toBeGreaterThan(0);
    expect(mods.fleetCapPct).toBeGreaterThan(0);
  });

  it("активная мегаструктура учитывается, чужая/неактивная — нет", () => {
    const world = makeWorld();
    const fg = world.fg!;
    const before = empireModifiers(world, 1);
    fg.megastructures.push({
      id: 1, type: "sentinel_array", systemId: 1, ownerId: 1, ticksLeft: 0, totalTicks: 0,
      active: true, hp: 1, maxHp: 1,
    });
    const after = empireModifiers(world, 1);
    expect(after.science).toBeGreaterThan(before.science);
    expect(after.sensorRangeBonus).toBeGreaterThan(before.sensorRangeBonus);
    // неактивная и чужая — без эффекта
    fg.megastructures.push({
      id: 2, type: "science_nexus", systemId: 0, ownerId: 2, ticksLeft: 0, totalTicks: 0,
      active: false, hp: 1, maxHp: 1,
    });
    const after2 = empireModifiers(world, 1);
    expect(after2.science).toBeCloseTo(after.science, 9);
  });

  it("узлы традиций и финишер попадают в свод", () => {
    const world = makeWorld();
    empire(world).resources.unity = 200000;
    const before = empireModifiers(world, 1);
    const tree = traditionTrees()[0];
    for (const node of tree.nodes) expect(unlockTradition(world, 1, tree.id, node.id).ok).toBe(true);
    const after = empireModifiers(world, 1);
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    expect(advancedOf(world, 1).traditions.finishers).toContain(tree.finisher.id);
  });

  it("перки попадают в свод (extraTechChoice / производства)", () => {
    const world = makeWorld();
    empire(world).resources.unity = 200000;
    const perk = allPerks().find((p) => (p.effects.extra_tech_choice ?? 0) > 0);
    expect(perk).toBeDefined();
    const before = empireModifiers(world, 1).extraTechChoice;
    expect(unlockPerk(world, 1, perk!.id).ok).toBe(true);
    expect(empireModifiers(world, 1).extraTechChoice).toBeGreaterThan(before);
  });

  it("бонус стабильности влияет на колонию", () => {
    const world = makeWorld();
    empire(world).resources.unity = 200000;
    const tree = traditionTrees().find(
      (t) => t.nodes.some((n) => (n.effects.stability ?? 0) > 0 || (n.effects.happiness ?? 0) > 0),
    );
    if (!tree) return;
    const node = tree.nodes.find((n) => (n.effects.stability ?? 0) > 0 || (n.effects.happiness ?? 0) > 0)!;
    if (node.index > 0) for (const prev of tree.nodes.slice(0, node.index)) unlockTradition(world, 1, tree.id, prev.id);
    const colony = world.colonies.find((c) => c.empireId === 1)!;
    updateStability(world, colony);
    const before = colony.stability;
    const modsBefore = empireModifiers(world, 1);
    const flatBefore = modsBefore.stabilityBonus + modsBefore.happinessBonus;
    expect(unlockTradition(world, 1, tree.id, node.id).ok).toBe(true);
    updateStability(world, colony);
    expect(colony.stability).toBeGreaterThanOrEqual(before);
    const modsAfter = empireModifiers(world, 1);
    expect(modsAfter.stabilityBonus + modsAfter.happinessBonus).toBeGreaterThan(flatBefore);
  });

  it("стоимость колонии и аутпоста масштабируется модификаторами", () => {
    const world = makeWorld();
    // Стартовые этики/цивики могут уже давать скидки — сравниваем относительно них.
    const colonyBefore = colonyCostFor(world, 1);
    const outpostBefore = outpostCostFor(world, 1);
    for (const key of Object.keys(colonyBefore) as ResourceId[]) {
      expect(colonyBefore[key]).toBeLessThanOrEqual(BALANCE.colonyCost[key] ?? 0);
    }
    for (const key of Object.keys(outpostBefore) as ResourceId[]) {
      expect(outpostBefore[key]).toBeLessThanOrEqual(BALANCE.outpostCost[key] ?? 0);
    }
    empire(world).techs.completed.push("soc_expansion_1"); // colony_cost −10%, outpost_cost −20%
    const colony = colonyCostFor(world, 1);
    const outpost = outpostCostFor(world, 1);
    expect(colony.minerals).toBeLessThan(BALANCE.colonyCost.minerals!);
    expect(outpost.minerals).toBeLessThan(BALANCE.outpostCost.minerals!);
    expect(outpost.influence).toBeLessThan(BALANCE.outpostCost.influence!);
  });

  it("плоские бонусы (+влияние/энергия в такт) попадают в доход", () => {
    const world = makeWorld();
    empire(world).resources.unity = 500000;
    let target: { treeId: string; index: number; key: "influence_flat" | "energy_flat" } | undefined;
    for (const tree of traditionTrees()) {
      for (const node of tree.nodes) {
        if ((node.effects.influence_flat ?? 0) > 0) { target = { treeId: tree.id, index: node.index, key: "influence_flat" }; break; }
        if ((node.effects.energy_flat ?? 0) > 0) { target = { treeId: tree.id, index: node.index, key: "energy_flat" }; break; }
      }
      if (target) break;
    }
    if (!target) return;
    const tree = traditionTrees().find((t) => t.id === target!.treeId)!;
    for (const node of tree.nodes.slice(0, target.index)) expect(unlockTradition(world, 1, tree.id, node.id).ok).toBe(true);
    const before = projectEmpire(world, empire(world)).income;
    expect(unlockTradition(world, 1, tree.id, tree.nodes[target.index].id).ok).toBe(true);
    const after = projectEmpire(world, empire(world)).income;
    const res = target.key === "influence_flat" ? "influence" : "energy";
    expect(after[res]).toBeGreaterThan(before[res]);
  });

  it("счёт империи учитывает традиции, перки и мегаструктуры", () => {
    const world = makeWorld();
    empire(world).resources.unity = 500000;
    const before = getScore(world, 1).total;
    const tree = traditionTrees()[0];
    expect(unlockTradition(world, 1, tree.id, tree.nodes[0].id).ok).toBe(true);
    const afterTradition = getScore(world, 1).total;
    expect(afterTradition).toBeGreaterThan(before);
    world.fg!.megastructures.push({
      id: 1, type: "beacon", systemId: 1, ownerId: 1, ticksLeft: 0, totalTicks: 0,
      active: true, hp: 1, maxHp: 1,
    });
    expect(getScore(world, 1).total).toBeGreaterThan(afterTradition);
  });

  it("детерминизм свода: одинаковые миры → одинаковые модификаторы", () => {
    const a = makeWorld();
    const b = makeWorld();
    a.empires[0].techs.completed.push("eng_logistics_1");
    b.empires[0].techs.completed.push("eng_logistics_1");
    expect(empireModifiers(a, 1)).toEqual(empireModifiers(b, 1));
    expect(empireModifiers(a, 1).fleetCapFlat).toBe(5);
  });
});

describe("empireModifiers: лимит флота и наука", () => {
  it("флотский лимит растёт от технологий и традиций", () => {
    const world = makeWorld();
    const before = empireModifiers(world, 1).fleetCapFlat;
    empire(world).techs.completed.push("eng_logistics_1"); // fleet_cap +5
    expect(empireModifiers(world, 1).fleetCapFlat).toBe(before + 5);
  });

  it("наука империи растёт от школьных бонусов и глобального множителя", () => {
    const world = makeWorld();
    const base = empireSchoolScience(world, 1);
    empire(world).techs.completed.push("soc_education_2");
    const boosted = empireSchoolScience(world, 1);
    expect(boosted.physics).toBeGreaterThan(base.physics);
    expect(boosted.society).toBeGreaterThan(base.society);
    expect(boosted.engineering).toBeGreaterThan(base.engineering);
    expect(TECHS.length).toBeGreaterThan(0);
  });
});
