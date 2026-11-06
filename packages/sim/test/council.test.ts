import { describe, expect, it } from "vitest";
import { ensureFg } from "../src/fullgame";
import { diplomacyPhase } from "../src/diplomacy";
import {
  activeResolutions, aiCouncilVote, COUNCIL_SESSION_PERIOD, councilActive, councilFleetCapMult,
  councilIncomeMult, councilPhase, councilWeights, FALLBACK_RESOLUTIONS, isOutcast, proposeResolution,
  resolutionEffectValue, resolutionSpec, sanctionCount, topWeightEmpire, VETO_COOLDOWN, vetoResolution,
  voteResolution,
} from "../src/council";
import { declareWar, warOf, warPhase, warScoreOf } from "../src/war";
import type { CouncilResolution } from "../src/fullgame";
import { firstSystemOf, give, pushOpinion, testWorld } from "./diplo-helpers";

function pendingResolution(world: ReturnType<typeof testWorld>): CouncilResolution | null {
  return ensureFg(world).council.pending;
}

function pushResolution(world: ReturnType<typeof testWorld>, type: string, targetEmpireId = 0): CouncilResolution {
  const resolution: CouncilResolution = {
    id: "res_test_" + type,
    type,
    targetEmpireId,
    votesFor: 0,
    votesAgainst: 0,
    vetoed: false,
    passedTick: world.tick,
    durationTicks: 300,
    effects: [],
    votes: {},
  };
  ensureFg(world).council.resolutions.push(resolution);
  return resolution;
}

describe("совет: веса голосов (GDD §12.4)", () => {
  it("вес = 0.5 + доля населения + бонус федерации", () => {
    const world = testWorld();
    const weights = councilWeights(world);
    const ids = world.empires.filter((e) => !e.dead && e.id !== 9).map((e) => e.id);
    expect(Object.keys(weights).length).toBe(ids.length);
    for (const id of ids) expect(weights[id]).toBeGreaterThanOrEqual(0.5);
    const sum = ids.reduce((acc, id) => acc + weights[id], 0);
    expect(sum).toBeGreaterThan(ids.length * 0.5);
    // федерация добавляет бонус председателю
    ensureFg(world).federations.push({
      id: 1, nameRu: "Федерация «Тест»", members: [1, 2], presidentId: 1, foundedTick: 0,
      treasuryEnergy: 0, treasuryAlloys: 0, fleetIds: [], nextChairTick: 300, votes: {},
    });
    const withFederation = councilWeights(world);
    expect(withFederation[1]).toBeGreaterThan(weights[1]);
    expect(topWeightEmpire(world)).toBeGreaterThan(0);
  });
});

describe("совет: резолюции (GDD §12.4)", () => {
  it("8 резолюций канона доступны (данные или fallback)", () => {
    const types = ["ban_aggression", "free_trade", "common_market", "sanctions", "fleet_limit",
      "science_exchange", "forced_peace", "declare_crisis"];
    expect(FALLBACK_RESOLUTIONS.length).toBe(8);
    for (const type of types) {
      const spec = resolutionSpec(type);
      expect(spec, type).toBeDefined();
      expect(spec!.influenceCost).toBeGreaterThan(0);
      expect(spec!.ru.length).toBeGreaterThan(0);
    }
    // псевдоним из данных (aggression_ban) маппится на канон
    expect(resolutionSpec("aggression_ban")!.type).toBe("ban_aggression");
  });

  it("предложение резолюции: стоимость влияния, одно голосование одновременно", () => {
    const world = testWorld();
    const empire = world.empires.find((e) => e.id === 1)!;
    give(world, 1, { influence: 100 });
    const before = empire.resources.influence;
    const cost = resolutionSpec("science_exchange")!.influenceCost;
    const result = proposeResolution(world, 1, "science_exchange");
    expect(result.ok, result.messageRu).toBe(true);
    expect(empire.resources.influence).toBe(before - cost);
    expect(pendingResolution(world)).not.toBeNull();
    expect(pendingResolution(world)!.type).toBe("science_exchange");
    expect(proposeResolution(world, 1, "free_trade").ok).toBe(false);
    expect(proposeResolution(world, 1, "unknown_resolution").ok).toBe(false);
  });

  it("санкции требуют цель", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    expect(proposeResolution(world, 1, "sanctions").ok).toBe(false);
    expect(proposeResolution(world, 1, "sanctions", 1).ok).toBe(false);
    expect(proposeResolution(world, 1, "sanctions", 2).ok).toBe(true);
    expect(pendingResolution(world)!.targetEmpireId).toBe(2);
  });

  it("голосование взвешенное; голос нельзя отменить дважды не мешая", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    proposeResolution(world, 1, "free_trade");
    const pending = pendingResolution(world)!;
    expect(voteResolution(world, 2, pending.id, true).ok).toBe(true);
    expect(voteResolution(world, 3, pending.id, false).ok).toBe(true);
    expect(pendingResolution(world)!.votes[2]).toBe(true);
    expect(pendingResolution(world)!.votes[3]).toBe(false);
    expect(voteResolution(world, 4, "wrong_id", true).ok).toBe(false);
  });

  it("сессия каждые 300 тактов: резолюция принимается большинством", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    proposeResolution(world, 1, "science_exchange");
    const empire = world.empires.find((e) => e.id === 1)!;
    empire.scienceLastTick.physics = 100;
    empire.science.physics = 0;
    world.tick = COUNCIL_SESSION_PERIOD - 1;
    ensureFg(world).council.nextSessionTick = world.tick + 1;
    world.tick += 1;
    councilPhase(world);
    expect(pendingResolution(world)).toBeNull();
    expect(councilActive(world, "science_exchange")).toBe(true);
    expect(activeResolutions(world).length).toBeGreaterThanOrEqual(1);
    // научный обмен: +10% науки
    expect(empire.science.physics).toBeGreaterThanOrEqual(10);
    expect(ensureFg(world).council.nextSessionTick).toBeGreaterThan(world.tick);
  });
});

describe("совет: вето и санкции (GDD §12.4)", () => {
  function boostPlayerPops(world: ReturnType<typeof testWorld>): void {
    const player = world.empires.find((e) => e.id === 1)!;
    for (const colonyId of player.colonies) {
      const colony = world.colonies.find((c) => c.id === colonyId);
      if (colony) colony.pops.workers += 200;
    }
    for (const empire of world.empires) {
      if (empire.ai) empire.ai.aggression = 10;
    }
  }

  it("вето империи с наибольшим весом: блокирует, −15 мнения всем, кулдаун 300", () => {
    const world = testWorld();
    boostPlayerPops(world);
    councilPhase(world);
    expect(topWeightEmpire(world)).toBe(1);
    give(world, 1, { influence: 200 });
    expect(proposeResolution(world, 1, "fleet_limit").ok).toBe(true);
    const pending = pendingResolution(world)!;
    expect(voteResolution(world, 1, pending.id, false).ok).toBe(true);
    const before = new Map<number, number>();
    for (const empire of world.empires) if (!empire.dead && empire.id !== 9) before.set(empire.id, empireOpinion(world, empire.id, 1));
    ensureFg(world).council.nextSessionTick = world.tick + 1;
    world.tick += 1;
    councilPhase(world);
    expect(pendingResolution(world)).toBeNull();
    expect(ensureFg(world).council.resolutions.some((r) => r.vetoed)).toBe(true);
    expect(ensureFg(world).council.vetoCooldown[1]).toBe(world.tick + VETO_COOLDOWN);
    for (const empire of world.empires) {
      if (empire.dead || empire.id === 9 || empire.id === 1) continue;
      if (before.has(empire.id)) expect(empireOpinion(world, empire.id, 1)).toBeLessThan(before.get(empire.id)!);
    }
  });

  it("прямой vetoResolution: только для топ-веса и с кулдауном", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    proposeResolution(world, 1, "fleet_limit");
    expect(vetoResolution(world, 2).ok).toBe(false);
    boostPlayerPops(world);
    councilPhase(world);
    expect(vetoResolution(world, 1).ok).toBe(true);
    expect(ensureFg(world).council.pending).toBeNull();
  });

  it("санкции: проходят, цель теряет 20% дохода, 3 санкции — изгой", () => {
    const world = testWorld();
    give(world, 1, { influence: 100 });
    for (const empire of world.empires) {
      if (empire.dead || empire.id === 9 || empire.id === 2) continue;
      pushOpinion(world, empire.id, 2, -100);
    }
    diplomacyPhase(world);
    expect(proposeResolution(world, 1, "sanctions", 2).ok).toBe(true);
    const pending = pendingResolution(world)!;
    voteResolution(world, 1, pending.id, true);
    ensureFg(world).council.nextSessionTick = world.tick + 1;
    world.tick += 1;
    councilPhase(world);
    const fg = ensureFg(world);
    expect(fg.council.sanctions[2]).toBeGreaterThan(world.tick);
    expect(sanctionCount(world, 2)).toBe(1);
    expect(councilIncomeMult(world, 2)).toBeLessThan(1);
    // 20% дохода списывается
    const target = world.empires.find((e) => e.id === 2)!;
    target.resources.energy = 1000;
    target.incomeLastTick.energy = 100;
    councilPhase(world);
    expect(target.resources.energy).toBeLessThan(1000);
    expect(target.resources.energy).toBeGreaterThan(950);
    // 3 санкции — изгой
    world.flags["sanctions:count:2"] = 3;
    expect(isOutcast(world, 2)).toBe(true);
  });

  it("ограничение флота читается из данных (0.6)", () => {
    const world = testWorld();
    expect(councilFleetCapMult(world, 1)).toBe(1);
    pushResolution(world, "fleet_limit").effects.push({ target: "fleet_cap_pct", value: -0.4 });
    const effect = resolutionEffectValue(world, "fleet_limit", "fleet_cap_pct");
    expect(effect).toBeDefined();
    expect(councilFleetCapMult(world, 1)).toBeCloseTo(1 + effect!, 5);
  });

  it("ИИ голосует по интересам", () => {
    const world = testWorld();
    const example = (type: string, target = 0): CouncilResolution => ({
      id: "x", type, targetEmpireId: target, votesFor: 0, votesAgainst: 0, vetoed: false,
      passedTick: 0, durationTicks: 300, effects: [], votes: {},
    });
    expect(aiCouncilVote(world, 3, example("science_exchange"))).toBe(true);
    expect(aiCouncilVote(world, 3, example("sanctions", 3))).toBe(false);
    pushOpinion(world, 3, 2, -100);
    diplomacyPhase(world);
    expect(aiCouncilVote(world, 3, example("sanctions", 2))).toBe(true);
  });
});

describe("совет: эффекты на войну", () => {
  it("запрет агрессии режет военный счёт агрессора вдвое", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    const target = firstSystemOf(world, 2);
    expect(declareWar(world, 1, 2, "conquest", [target]).ok).toBe(true);
    const war = warOf(world, 1, 2)!;
    world.tick = war.startedTick + 5;
    world.battles.push({
      id: "btl_x", tick: world.tick, systemId: 0,
      attacker: { empireId: 1, fleetId: 1, fp: 100, shipsBefore: 3 },
      defender: { empireId: 2, fleetId: 2, fp: 100, shipsBefore: 3 },
      outcome: "attacker_win", attackerLossFp: 0, defenderLossFp: 30,
      attackerShipsLost: 0, defenderShipsLost: 1, durationSec: 60,
      spoilsAlloys: 0, spoilsCredits: 0, tactical: false,
    });
    const before = warScoreOf(world, war, 1);
    expect(before).toBeGreaterThan(0);
    pushResolution(world, "aggression_ban");
    const after = warScoreOf(world, war, 1);
    expect(after).toBeLessThanOrEqual(Math.round(before / 2));
  });

  it("принудительный мир завершает войны через 50 тактов", () => {
    const world = testWorld();
    give(world, 1, { influence: 200 });
    const target = firstSystemOf(world, 2);
    expect(declareWar(world, 1, 2, "conquest", [target]).ok).toBe(true);
    pushResolution(world, "forced_peace").effects.push({ target: "forced_peace_ticks", value: 50 });
    world.tick += 50;
    warPhase(world);
    expect(warOf(world, 1, 2)).toBeUndefined();
  });
});

function empireOpinion(world: ReturnType<typeof testWorld>, a: number, b: number): number {
  const key = a < b ? a + ":" + b : b + ":" + a;
  return ensureFg(world).relations[key]?.opinion ?? 0;
}

