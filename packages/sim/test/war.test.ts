import { describe, expect, it } from "vitest";
import { advancedOf, ensureFg } from "../src/fullgame";
import { activateTreaty, addRecentAction, setTruce, truceUntil, warSideOf } from "../src/diplomacy";
import {
  CB_COST, declareWar, demandsForScore, exhaustionOf, OCCUPATION_TICKS, proposePeace, TRUCE_TICKS,
  warOf, warPhase, warScoreOf, warsOf,
} from "../src/war";
import { applyCommand } from "../src/commands";
import type { BattleRecord } from "../src/types";
import { addFleet, firstSystemOf, give, testWorld } from "./diplo-helpers";

function conqueringWar(world: ReturnType<typeof testWorld>) {
  give(world, 1, { influence: 200 });
  const target = firstSystemOf(world, 2);
  const result = declareWar(world, 1, 2, "conquest", [target]);
  expect(result.ok, result.messageRu).toBe(true);
  return { target, war: warOf(world, 1, 2)! };
}

function battle(attackerId: number, defenderId: number, tick: number, attackerLossFp: number, defenderLossFp: number): BattleRecord {
  return {
    id: "btl_test_" + tick + "_" + attackerId + "_" + defenderId,
    tick,
    systemId: 0,
    attacker: { empireId: attackerId, fleetId: 1, fp: 100, shipsBefore: 3 },
    defender: { empireId: defenderId, fleetId: 2, fp: 100, shipsBefore: 3 },
    outcome: "attacker_win",
    attackerLossFp,
    defenderLossFp,
    attackerShipsLost: 1,
    defenderShipsLost: 1,
    durationSec: 60,
    spoilsAlloys: 0,
    spoilsCredits: 0,
    tactical: false,
  };
}

describe("войны: объявление и CB (GDD §12.6)", () => {
  it("война с CB «завоевание»: притязание оплачивается, стороны создаются", () => {
    const world = testWorld();
    const { target, war } = conqueringWar(world);
    expect(war.attackerId).toBe(1);
    expect(war.defenderId).toBe(2);
    expect(war.sides[1]).toBeDefined();
    expect(war.sides[2]).toBeDefined();
    expect(war.sides[1].claims).toEqual([target]);
    expect(war.cb).toBe("conquest");
    expect(warSideOf(world, war.id, 1)).toBe(1);
    expect(warSideOf(world, war.id, 2)).toBe(2);
    expect(advancedOf(world, 1).warIds).toContain(war.id);
    // старое зеркало Relation — война (нужно combat/economy)
    expect(world.empires[0].relations[2].treaty).toBe("war");
    expect(world.empires[1].relations[1].treaty).toBe("war");
    // притязание закреплено
    expect(advancedOf(world, 1).claims).toContain(target);
  });

  it("исходная цена CB: завоевание 25 влияния/система, унижение 10, вассализация 40", () => {
    expect(CB_COST.conquest).toBe(0);
    expect(CB_COST.humiliation).toBe(10);
    expect(CB_COST.vassalization).toBe(40);
    expect(CB_COST.liberation).toBe(15);
    const world = testWorld();
    world.empires.find((e) => e.id === 1)!.resources.influence = 24;
    const target = firstSystemOf(world, 2);
    const result = declareWar(world, 1, 2, "conquest", [target]);
    expect(result.ok).toBe(false);
    expect(result.messageRu).toContain("25");
  });

  it("NAP запрещает войну 200 тактов", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    activateTreaty(world, 1, 2, "nap");
    const result = declareWar(world, 1, 2, "humiliation");
    expect(result.ok).toBe(false);
    expect(result.messageRu).toContain("Пакт");
  });

  it("перемирие 120 тактов запрещает войну", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    setTruce(world, 1, 2, TRUCE_TICKS);
    const result = declareWar(world, 1, 2, "humiliation");
    expect(result.ok).toBe(false);
    expect(result.messageRu).toContain("Перемирие");
  });

  it("без CB война запрещена; унижение доступно при мнении < −40", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    // усиливаем цель, чтобы авто-CB «вассализация» не сработал
    addFleet(world, 2, firstSystemOf(world, 2), 6);
    const denied = declareWar(world, 1, 2);
    expect(denied.ok).toBe(false);
    expect(denied.messageRu).toContain("casus belli");
    addRecentAction(world, 1, 2, -80);
    const humiliation = declareWar(world, 1, 2, "humiliation");
    expect(humiliation.ok, humiliation.messageRu).toBe(true);
    expect(warOf(world, 1, 2)!.cb).toBe("humiliation");
  });

  it("вассализация требует FP цели < 50% вашего", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    addFleet(world, 2, firstSystemOf(world, 2), 6);
    const result = declareWar(world, 1, 2, "vassalization");
    expect(result.ok).toBe(false);
    expect(result.messageRu).toContain("сильна");
  });

  it("оборонительный союз втягивает союзника в войну", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    activateTreaty(world, 2, 3, "defensive");
    const target = firstSystemOf(world, 2);
    expect(declareWar(world, 1, 2, "conquest", [target]).ok).toBe(true);
    const war = warOf(world, 1, 2)!;
    expect(war.sides[3]).toBeDefined();
    expect(warSideOf(world, war.id, 3)).toBe(2);
  });

  it("нельзя объявить войну самому себе, пиратам и повторно", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    expect(declareWar(world, 1, 1).ok).toBe(false);
    expect(declareWar(world, 1, 9).ok).toBe(false);
    const target = firstSystemOf(world, 2);
    expect(declareWar(world, 1, 2, "conquest", [target]).ok).toBe(true);
    expect(declareWar(world, 1, 2, "conquest", [target]).ok).toBe(false);
  });
});

describe("войны: военный счёт (GDD §12.7)", () => {
  it("0.5×FP + 0.3×оккупация + 0.2×блокады − 0.4×потери, clamp", () => {
    const world = testWorld();
    const { war } = conqueringWar(world);
    const ownStart = war.sides[1].fpStart;
    const enemyStart = war.sides[2].fpStart;
    world.tick = war.startedTick + 3;
    world.battles.push(battle(1, 2, world.tick, 10, 20));
    // оккупаций/блокад в этом сценарии нет: только уничтоженный FP и свои потери
    expect(world.systems.filter((s) => s.ownerId === 2 && s.station).length).toBe(0);
    const expected = Math.round(0.5 * (20 / enemyStart) * 100 - 0.4 * (10 / ownStart) * 100);
    const score = warScoreOf(world, war, 1);
    expect(score).toBe(expected);
    // у защитника счёт противоположен по потерям/уничтожению
    const defenderScore = warScoreOf(world, war, 2);
    expect(defenderScore).toBeLessThan(0);
    expect(defenderScore).toBeGreaterThanOrEqual(-100);
    // не считается бой до начала войны
    const world2 = testWorld();
    const war2 = conqueringWar(world2).war;
    world2.tick = war2.startedTick + 3;
    world2.battles.push(battle(1, 2, war2.startedTick - 1, 10, 20));
    expect(warScoreOf(world2, war2, 1)).toBe(0);
  });

  it("требования по счёту: 30+ 1 система, 50+ 3, 75+ 5, 100 аннексия", () => {
    expect(demandsForScore(10, 10)).toBe(0);
    expect(demandsForScore(30, 10)).toBe(1);
    expect(demandsForScore(50, 10)).toBe(3);
    expect(demandsForScore(75, 10)).toBe(5);
    expect(demandsForScore(100, 10)).toBe(10);
  });
});

describe("войны: истощение и оккупация (GDD §12.8, §12.10)", () => {
  function stabilityAverage(world: ReturnType<typeof testWorld>, empireId: number): number {
    const empire = world.empires.find((e) => e.id === empireId)!;
    let sum = 0;
    let count = 0;
    for (const colonyId of empire.colonies) {
      const colony = world.colonies.find((c) => c.id === colonyId);
      if (!colony) continue;
      sum += colony.stability;
      count += 1;
    }
    return count > 0 ? sum / count : 50;
  }

  it("формула истощения §12.8", () => {
    const world = testWorld();
    const { war } = conqueringWar(world);
    world.tick = war.startedTick + 100;
    war.sides[1].fpStart = 100;
    war.sides[1].fpLost = 10;
    const stability = stabilityAverage(world, 1);
    const expected = 0.4 * (100 / 10) + 0.3 * (10 / 100) * 100 + 0.2 * (100 - stability);
    expect(exhaustionOf(world, war, 1)).toBeCloseTo(Math.round(Math.max(0, Math.min(100, expected)) * 10) / 10, 5);
  });

  it("истощение 20+ режет производство на 5%..15%", () => {
    const world = testWorld();
    const { war } = conqueringWar(world);
    // 2000 тактов войны → истощение 80 → −15% производства
    world.tick = war.startedTick + 2000;
    const empire = world.empires.find((e) => e.id === 1)!;
    empire.incomeLastTick.energy = 100;
    empire.resources.energy = 1000;
    warPhase(world);
    expect(war.exhaustion[1]).toBeGreaterThanOrEqual(60);
    expect(empire.resources.energy).toBeLessThan(1000);
    expect(empire.resources.energy).toBeGreaterThanOrEqual(840);
  });

  it("оккупация: флот в системе противника 5 тактов", () => {
    const world = testWorld();
    const { target, war } = conqueringWar(world);
    // уводим флоты защитника, чтобы не мешали оккупации
    const playerCapital = firstSystemOf(world, 1);
    for (const fleet of world.fleets) {
      if (fleet.empireId === 2) fleet.systemId = playerCapital;
    }
    addFleet(world, 1, target, 3);
    for (let i = 0; i < OCCUPATION_TICKS; i++) warPhase(world);
    expect(war.occupied[target]).toBe(1);
    expect(war.sides[1].occupiedSystems).toContain(target);
    // возврат флота владельца снимает оккупацию
    for (const fleet of world.fleets) {
      if (fleet.empireId === 2) fleet.systemId = target;
    }
    warPhase(world);
    expect(war.occupied[target]).toBeUndefined();
  });
});

describe("войны: команды игрока (M7, commands.ts)", () => {
  it("declare_war идёт через модуль войн (CB/притязания), а не старую заглушку", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    const target = firstSystemOf(world, 2);
    // без CB — отказ (старый путь объявлял войну всегда)
    const denied = applyCommand(world, { type: "declare_war", targetEmpireId: 2 });
    expect(denied.ok).toBe(false);
    expect(warOf(world, 1, 2)).toBeUndefined();
    const result = applyCommand(world, { type: "declare_war", targetEmpireId: 2, cb: "conquest", claims: [target] });
    expect(result.ok, result.messageRu).toBe(true);
    expect(warOf(world, 1, 2)).toBeDefined();
  });

  it("make_peace идёт через мирную конференцию и ставит перемирие", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    const target = firstSystemOf(world, 2);
    applyCommand(world, { type: "declare_war", targetEmpireId: 2, cb: "conquest", claims: [target] });
    const war = warOf(world, 1, 2)!;
    war.score[1] = 0;
    war.exhaustion[2] = 40;
    const peace = applyCommand(world, { type: "make_peace", targetEmpireId: 2 });
    expect(peace.ok, peace.messageRu).toBe(true);
    expect(warOf(world, 1, 2)).toBeUndefined();
    expect(truceUntil(world, 1, 2)).toBeGreaterThan(world.tick);
  });

  it("торг: противник принимает требования на 20% меньше", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    // доводим цель до 6 систем: 3 требования = 50% (полный отказ), −20% = 2 системы (33% — согласие)
    const target2 = world.empires.find((e) => e.id === 2)!;
    target2.systems = world.systems.filter((s) => s.ownerId === 2).map((s) => s.id).sort((a, b) => a - b);
    let guard = 0;
    while (world.systems.filter((s) => s.ownerId === 2).length < 6 && guard < 20) {
      guard += 1;
      const donor = world.empires
        .filter((e) => e.id !== 1 && e.id !== 2 && !e.dead && e.systems.length > 1)
        .sort((a, b) => a.id - b.id)[0];
      if (!donor) break;
      const systemId = donor.systems[donor.systems.length - 1];
      world.systems[systemId].ownerId = 2;
      donor.systems = donor.systems.filter((id) => id !== systemId);
      target2.systems.push(systemId);
      target2.systems.sort((a, b) => a - b);
    }
    expect(world.systems.filter((s) => s.ownerId === 2).length).toBe(6);
    const target = firstSystemOf(world, 2);
    declareWar(world, 1, 2, "conquest", [target]);
    const war = warOf(world, 1, 2)!;
    war.score[1] = 50; // 3 требования
    war.exhaustion[2] = 22;
    const result = proposePeace(world, 1, 2);
    expect(result.ok, result.messageRu).toBe(true);
    expect(result.messageRu).toContain("торг");
    expect(warOf(world, 1, 2)).toBeUndefined();
    expect(world.systems.filter((s) => s.ownerId === 1).length).toBeGreaterThan(2);
  });
});

describe("войны: мирная конференция (GDD §12.9)", () => {
  it("белый мир принимается при истощении противника", () => {
    const world = testWorld();
    const { war } = conqueringWar(world);
    war.score[1] = 0;
    war.exhaustion[2] = 30;
    const result = proposePeace(world, 1, 2);
    expect(result.ok, result.messageRu).toBe(true);
    expect(warOf(world, 1, 2)).toBeUndefined();
    expect(truceUntil(world, 1, 2)).toBeGreaterThan(world.tick);
    expect(warsOf(world, 1).length).toBe(0);
    // перемирие блокирует новую войну
    expect(declareWar(world, 1, 2, "conquest", [firstSystemOf(world, 2)]).ok).toBe(false);
  });

  it("отказ: истощение цели +20; при истощении 85 требования принимаются", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    const target = firstSystemOf(world, 2);
    declareWar(world, 1, 2, "conquest", [target]);
    const war = warOf(world, 1, 2)!;
    war.score[1] = 60;
    war.exhaustion[2] = 25;
    const refused = proposePeace(world, 1, 2);
    expect(refused.ok).toBe(false);
    expect(war.exhaustion[2]).toBe(45);
    expect(warOf(world, 1, 2)).toBeDefined();
    war.exhaustion[2] = 85;
    const systemsBefore = world.systems.filter((s) => s.ownerId === 2);
    const accepted = proposePeace(world, 1, 2);
    expect(accepted.ok, accepted.messageRu).toBe(true);
    expect(warOf(world, 1, 2)).toBeUndefined();
    expect(world.systems.filter((s) => s.ownerId === 2).length).toBeLessThan(systemsBefore.length);
    // аннексированные системы перешли атакующему
    expect(world.systems.filter((s) => s.ownerId === 1).length).toBeGreaterThan(systemsBefore.length - 1);
  });

  it("мир невозможен без войны", () => {
    const world = testWorld();
    expect(proposePeace(world, 1, 2).ok).toBe(false);
  });

  it("при истощении 100 — немедленный белый мир", () => {
    const world = testWorld();
    const { war } = conqueringWar(world);
    world.tick = war.startedTick + 3000;
    warPhase(world);
    expect(warOf(world, 1, 2)).toBeUndefined();
    expect(ensureFg(world).wars.some((w) => w.id === war.id)).toBe(false);
  });
});
