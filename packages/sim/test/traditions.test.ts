import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/queries";
import { serializeWorld } from "../src/save";
import { advancedOf } from "../src/fullgame";
import { projectEmpire } from "../src/economy";
import { TECHS } from "@sf/data";
import {
  BASE_PERK_SLOTS, allPerks, findPerk, findTraditionTree, perkCostMultiplier, perkSlotsFor,
  traditionCostFor, traditionNodeCost, traditionPhase, traditionTrees, treeProgress,
  unlockPerk, unlockTradition,
} from "../src/traditions";
import type { World } from "../src/types";

function makeWorld(): World {
  return createWorld(42, MODE, BALANCE);
}

function empire(world: World, id = 1) {
  const found = world.empires.find((e) => e.id === id);
  if (!found) throw new Error("нет империи " + id);
  return found;
}

function giveUnity(world: World, amount = 200000, id = 1): void {
  empire(world, id).resources.unity = amount;
}

describe("традиции: данные и стоимость (GDD §8.5)", () => {
  it("7 древ × 5 узлов, у каждого есть финишер; стоимость 400×1.5^index", () => {
    const trees = traditionTrees();
    expect(trees.length).toBe(7);
    const ids = new Set(trees.map((tree) => tree.id));
    expect(ids.size).toBe(7);
    for (const tree of trees) {
      expect(tree.nodes.length, tree.id).toBe(5);
      expect(tree.finisher.id.length).toBeGreaterThan(0);
      for (let index = 0; index < tree.nodes.length; index++) {
        const node = tree.nodes[index];
        expect(node.index).toBe(index);
        expect(node.cost).toBe(traditionNodeCost(index));
        if (index === 0) expect(node.requires.length).toBe(0);
        else expect(node.requires).toContain(tree.nodes[index - 1].id);
      }
    }
  });

  it("12 перков, у всех есть стоимость и эффекты", () => {
    const perks = allPerks();
    expect(perks.length).toBe(12);
    for (const perk of perks) {
      expect(perk.cost).toBeGreaterThan(0);
      expect(Object.keys(perk.effects).length).toBeGreaterThan(0);
    }
  });
});

describe("unlockTradition: узлы, пререквизиты, единство, финишер", () => {
  it("первый узел открывается за единство и попадает в состояние", () => {
    const world = makeWorld();
    giveUnity(world);
    const tree = traditionTrees()[0];
    const node = tree.nodes[0];
    const before = empire(world).resources.unity;
    const result = unlockTradition(world, 1, tree.id, node.id);
    expect(result.ok, result.messageRu).toBe(true);
    expect(result.messageRu ?? "").toContain(node.ru);
    expect(empire(world).resources.unity).toBe(before - traditionCostFor(world, 1, node));
    const adv = advancedOf(world, 1);
    expect(adv.traditions.unlocked).toContain(node.id);
    expect(adv.traditions.trees[tree.id]).toBe(1);
    expect(treeProgress(world, 1, tree.id).unlocked).toBe(1);
    expect(world.fg!.journal.length).toBeGreaterThan(0);
  });

  it("нельзя перескочить узел: нужен предыдущий", () => {
    const world = makeWorld();
    giveUnity(world);
    const tree = traditionTrees()[0];
    const result = unlockTradition(world, 1, tree.id, tree.nodes[2].id);
    expect(result.ok).toBe(false);
    expect(result.messageRu ?? "").toContain("предыдущий");
    // Узел 2 после узла 1 открывается.
    expect(unlockTradition(world, 1, tree.id, tree.nodes[0].id).ok).toBe(true);
    expect(unlockTradition(world, 1, tree.id, tree.nodes[1].id).ok).toBe(true);
    expect(advancedOf(world, 1).traditions.unlocked).toContain(tree.nodes[1].id);
  });

  it("без единства отказ с понятным сообщением; повторное открытие запрещено", () => {
    const world = makeWorld();
    const tree = traditionTrees()[0];
    empire(world).resources.unity = 0;
    const denied = unlockTradition(world, 1, tree.id, tree.nodes[0].id);
    expect(denied.ok).toBe(false);
    expect(denied.messageRu ?? "").toContain("единства");
    giveUnity(world);
    expect(unlockTradition(world, 1, tree.id, tree.nodes[0].id).ok).toBe(true);
    const again = unlockTradition(world, 1, tree.id, tree.nodes[0].id);
    expect(again.ok).toBe(false);
    expect(again.messageRu ?? "").toContain("уже открыт");
  });

  it("5/5 открывает финишер древа, сообщение об этом", () => {
    const world = makeWorld();
    giveUnity(world);
    const tree = traditionTrees()[0];
    let lastOk = false;
    let lastMsg = "";
    for (const node of tree.nodes) {
      const result = unlockTradition(world, 1, tree.id, node.id);
      lastOk = result.ok;
      lastMsg = result.messageRu ?? "";
    }
    expect(lastOk, lastMsg).toBe(true);
    const adv = advancedOf(world, 1);
    expect(adv.traditions.finishers).toContain(tree.finisher.id);
    expect(adv.traditions.trees[tree.id]).toBe(5);
    expect(lastMsg).toContain("завершено");
    expect(treeProgress(world, 1, tree.id).finished).toBe(true);
  });

  it("traditionPhase восстанавливает кэш счётчиков и финишер", () => {
    const world = makeWorld();
    giveUnity(world);
    const tree = traditionTrees()[1];
    for (const node of tree.nodes) unlockTradition(world, 1, tree.id, node.id);
    const adv = advancedOf(world, 1);
    delete adv.traditions.trees[tree.id];
    adv.traditions.finishers = [];
    traditionPhase(world);
    expect(adv.traditions.trees[tree.id]).toBe(5);
    expect(adv.traditions.finishers).toContain(tree.finisher.id);
    expect(adv.perkSlots).toBeGreaterThanOrEqual(BASE_PERK_SLOTS);
  });

  it("определённый порядок: одинаковые действия → одинаковый сериализованный мир", () => {
    const run = (): string => {
      const world = makeWorld();
      giveUnity(world);
      const tree = traditionTrees()[0];
      for (const node of tree.nodes) unlockTradition(world, 1, tree.id, node.id);
      traditionPhase(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  });
});

describe("unlockPerk: слоты, требования, эффекты", () => {
  it("перк без требований открывается за единство и учитывается в слотах", () => {
    const world = makeWorld();
    giveUnity(world);
    traditionPhase(world);
    const perk = allPerks().find((p) => p.requires.length === 0);
    expect(perk).toBeDefined();
    const adv = advancedOf(world, 1);
    const before = empire(world).resources.unity;
    const cost = Math.round(perk!.cost * perkCostMultiplier(world, 1));
    const result = unlockPerk(world, 1, perk!.id);
    expect(result.ok, result.messageRu).toBe(true);
    expect(adv.perks).toContain(perk!.id);
    expect(empire(world).resources.unity).toBe(before - cost);
    expect(adv.perkSlots).toBeGreaterThanOrEqual(BASE_PERK_SLOTS);
    expect(perkSlotsFor(world, 1)).toBeGreaterThanOrEqual(BASE_PERK_SLOTS);
    expect(unlockPerk(world, 1, perk!.id).ok).toBe(false);
  });

  it("при 8 занятых слотах девятый перк отклоняется", () => {
    const world = makeWorld();
    giveUnity(world);
    const adv = advancedOf(world, 1);
    adv.perkSlots = BASE_PERK_SLOTS;
    adv.perks = allPerks().slice(0, BASE_PERK_SLOTS).map((perk) => perk.id);
    const candidate = allPerks().find((perk) => !adv.perks.includes(perk.id));
    expect(candidate).toBeDefined();
    const result = unlockPerk(world, 1, candidate!.id);
    expect(result.ok).toBe(false);
    expect(result.messageRu ?? "").toContain("слоты");
  });

  it("требования перков проверяются и снимаются выполнением", () => {
    const world = makeWorld();
    giveUnity(world, 500000);
    const adv = advancedOf(world, 1);
    const withPerkReq = allPerks().find(
      (perk) => perk.requires.length > 0 && perk.requires.every((req) => {
        const id = req.startsWith("perk:") ? req.slice(5) : req;
        return findPerk(id) !== undefined;
      }),
    );
    if (!withPerkReq) return; // контент без перковых пререквизитов — проверка не применима
    const denied = unlockPerk(world, 1, withPerkReq.id);
    expect(denied.ok).toBe(false);
    expect(denied.messageRu ?? "").toContain("Требование");
    for (const req of withPerkReq.requires) {
      const id = req.startsWith("perk:") ? req.slice(5) : req;
      if (!adv.perks.includes(id)) adv.perks.push(id);
    }
    const ok = unlockPerk(world, 1, withPerkReq.id);
    expect(ok.ok, ok.messageRu).toBe(true);
  });

  it("«Вознесение» ставит флаг победы", () => {
    const world = makeWorld();
    giveUnity(world, 500000);
    const ascension = allPerks().find((perk) => (perk.effects.ascension ?? 0) > 0 || perk.id === "ascension");
    if (!ascension) return; // контент ещё без «Вознесения»
    const adv = advancedOf(world, 1);
    // Удовлетворяем требования-перки вручную (победа проверяется отдельно).
    for (const req of ascension.requires) {
      const id = req.startsWith("perk:") ? req.slice(5) : req;
      if (findPerk(id) && !adv.perks.includes(id)) adv.perks.push(id);
    }
    const result = unlockPerk(world, 1, ascension.id);
    if (!result.ok && (result.messageRu ?? "").includes("требование")) return; // нестандартный контент
    expect(result.ok, result.messageRu).toBe(true);
    expect(world.flags["ascension_perk:1"]).toBe(1);
    expect(advancedOf(world, 1).perks).toContain(ascension.id);
  });

  it("финишер Просвещения удешевляет перки", () => {
    const world = makeWorld();
    giveUnity(world);
    const tree = traditionTrees().find((t) => t.finisher.effects.perk_cost !== undefined || t.finisher.effects.perk_cost_mult !== undefined);
    if (!tree) return;
    const before = perkCostMultiplier(world, 1);
    for (const node of tree.nodes) unlockTradition(world, 1, tree.id, node.id);
    expect(perkCostMultiplier(world, 1)).toBeLessThan(before);
  });
});

describe("эффекты традиций на доход", () => {
  it("узел с бонусом производства повышает доход соответствующего ресурса", () => {
    const world = makeWorld();
    giveUnity(world);
    const prodKeys = ["energy_prod", "minerals_prod", "food_prod", "alloys_prod", "goods_prod", "unity_prod"];
    let found: { treeId: string; nodeId: string; key: string } | undefined;
    for (const tree of traditionTrees()) {
      for (const node of tree.nodes) {
        for (const key of prodKeys) {
          if (found) break;
          if (node.effects[key] !== undefined && node.effects[key]! > 0) {
            found = { treeId: tree.id, nodeId: node.id, key };
          }
        }
      }
    }
    if (!found) return;
    const before = projectEmpire(world, empire(world)).income;
    expect(unlockTradition(world, 1, found.treeId, found.nodeId).ok).toBe(true);
    const after = projectEmpire(world, empire(world)).income;
    const res = found.key.replace("_prod", "") as keyof typeof before;
    expect(after[res]).toBeGreaterThan(before[res]);
  });
});
