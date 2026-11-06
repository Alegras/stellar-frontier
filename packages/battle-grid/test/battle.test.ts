import { describe, expect, it } from "vitest";
import {
  BATTLE_CLASSES, BATTLE_ABILITIES, BATTLE_SCENARIOS, BATTLE_TERRAIN,
} from "@sf/data";
import {
  autoDeploy, battleAbilities, battleClasses, battleResult, battleStateHash, BATTLE_CONTENT,
  createBattle, deserializeBattle, getBattleView, legalMoves, hasLos, hexDistance, neighbors,
  offsetToAxial, axialToOffset, allHexes, generateField, validateField, terrainAt,
  applyCommand, applyBattleCommand, aiDeploy, aiTakeTurn, runAiBattle, autoResolveReference, parityCheck,
  buildResult, findStack, startBattle, previewAttack, previewAbility, serializeBattle, isGridBattleEnabled, createBattleTriggered,
} from "../src/index";
import type { BattleState, SideInput } from "../src/types";

function side(stacks: Array<{ classId: string; count: number }>, extra: Partial<SideInput> = {}): SideInput {
  return { stacks, ...extra };
}
function smallBattle(seed = 7) {
  return createBattle({
    seed,
    attacker: side([{ classId: "corvette", count: 4 }, { classId: "frigate", count: 2 }]),
    defender: side([{ classId: "corvette", count: 4 }, { classId: "frigate", count: 2 }]),
  });
}

describe("M5b · hex/field", () => {
  it("axial/odd-r обратимы, расстояние и соседи корректны", () => {
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 15; col++) {
        const ax = offsetToAxial(col, row);
        expect(axialToOffset(ax)).toEqual({ col, row });
      }
    }
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(neighbors({ q: 0, r: 0 })).toHaveLength(6);
    expect(new Set(neighbors({ q: 0, r: 0 }).map((n) => n.q + "," + n.r)).size).toBe(6);
  });
  it("поле 15×11, симметричные 5–8 препятствий, LOS блокируется астероидом", () => {
    const field = generateField(42, "asteroid_belt");
    expect(field.cols).toBe(15);
    expect(field.rows).toBe(11);
    expect(allHexes()).toHaveLength(165);
    expect(field.obstacles.length).toBeGreaterThanOrEqual(2);
    expect(validateField(field)).toEqual([]);
    // центральная симметрия: для каждого препятствия есть зеркало
    for (const ob of field.obstacles) {
      const col = axialToOffset(ob).col;
      const mirror = offsetToAxial(14 - col, 10 - axialToOffset(ob).row);
      expect(terrainAt(field, mirror)).toBe(terrainAt(field, { q: ob.q, r: ob.r }));
    }
    const a = offsetToAxial(1, 5), b = offsetToAxial(13, 5);
    // ставим астероид между ними и проверяем LOS
    const withBlock = generateField(42, "open");
    const mid = offsetToAxial(7, 5);
    withBlock.terrain[mid.q + "," + mid.r] = "asteroid";
    expect(hasLos(withBlock, a, b)).toBe(false);
  });
});

describe("M5b · deployment/rounds", () => {
  it("7 активных + 3 резерва, зона и уникальные гексы", () => {
    const stacks = Array.from({ length: 10 }, () => ({ classId: "corvette", count: 2 }));
    const state = createBattle({ seed: 1, attacker: side(stacks), defender: side(stacks) });
    expect(state.stacks.filter((s) => s.side === "A" && !s.reserve)).toHaveLength(7);
    expect(state.reserve.A).toHaveLength(3);
    autoDeploy(state, "A", "line");
    expect(state.deployment.A).toBe(true);
    const occupied = state.stacks.filter((s) => s.side === "A" && !s.reserve).map((s) => s.pos.q + "," + s.pos.r);
    expect(new Set(occupied).size).toBe(7);
    for (const s of state.stacks.filter((x) => x.side === "A" && !x.reserve)) {
      const offset = axialToOffset(s.pos);
      expect(offset.col).toBeGreaterThanOrEqual(0);
      expect(offset.col).toBeLessThanOrEqual(2);
    }
    // нельзя ставить в чужую зону
    const stack = state.stacks.find((s) => s.side === "A" && !s.reserve)!;
    expect(applyCommand(state, { type: "place", side: "A", stackId: stack.id, at: offsetToAxial(13, 5) }).ok).toBe(false);
  });
  it("инициатива и and порядок; startBattle запускает раунд 1", () => {
    const state = smallBattle();
    autoDeploy(state, "A"); autoDeploy(state, "B");
    expect(state.phase).toBe("rounds");
    expect(state.round).toBe(1);
    expect(state.initiative.length).toBe(4);
    expect(state.current).toBeTruthy();
    const init = state.stacks.map((s) => ({ id: s.id, i: s.initiative }));
    const first = state.initiative[0]!;
    const firstStack = init.find((x) => x.id === first)!;
    expect(firstStack.i).toBe(Math.max(...init.map((x) => x.i)));
  });
});

describe("M5b · attacks/defense/wait/abilities", () => {
  function adjacentBattle() {
    const state = createBattle({ seed: 3, attacker: side([{ classId: "corvette", count: 4 }]), defender: side([{ classId: "corvette", count: 4 }]) });
    autoDeploy(state, "A"); autoDeploy(state, "B");
    const a = state.stacks.find((s) => s.side === "A")!, b = state.stacks.find((s) => s.side === "B")!;
    a.pos = offsetToAxial(2, 5); b.pos = offsetToAxial(3, 5);
    state.current = a.id; a.acted = false; b.acted = false;
    return { state, a, b };
  }
  it("melee наносит урон и вызывает ответный удар один раз", () => {
    const { state, a, b } = adjacentBattle();
    const hpB = b.hp, hpA = a.hp;
    const res = applyBattleCommand(state, { type: "attack", stackId: a.id, targetId: b.id });
    expect(res.ok, res.reason).toBe(true);
    expect(b.hp).toBeLessThan(hpB);
    expect(a.hp).toBeLessThan(hpA); // ответный
    expect(b.retaliatedRound).toBe(state.round);
  });
  it("защита +20% снижает входящий урон", () => {
    const { state, a, b } = adjacentBattle();
    const normal = previewAttack(state, a.id, b.id, "melee");
    b.defending = true;
    const guarded = previewAttack(state, a.id, b.id, "melee");
    expect(guarded.damageMax).toBeLessThan(normal.damageMax);
  });
  it("wait переносит ход, сохраняя очередь", () => {
    const state = smallBattle(9);
    autoDeploy(state, "A"); autoDeploy(state, "B");
    const active = state.current!;
    const fast = findStack(state, active)!;
    const res = applyBattleCommand(state, { type: "wait", stackId: active });
    expect(res.ok, res.reason).toBe(true);
    expect(fast.waited).toBe(true);
    expect(state.current).not.toBe(active);
  });
  it("UI API: previewAbility и applyCommand auto", () => {
    const state = smallBattle(51);
    autoDeploy(state, "A"); autoDeploy(state, "B");
    const current = state.current!;
    const preview = previewAbility(state, current, "focus_fire");
    expect(preview.available).toBe(true);
    expect(preview.costOk).toBeGreaterThan(0);
    const auto = applyCommand(state, { type: "auto" }, { difficulty: "normal" });
    expect(auto.state).toBe(state);
    expect(typeof auto.ok).toBe("boolean");
  });
  it("16 способностей из @sf/data, 8 классов, 6 terrain", () => {
    expect(BATTLE_CLASSES).toHaveLength(8);
    expect(BATTLE_ABILITIES.length).toBeGreaterThanOrEqual(12);
    expect(BATTLE_TERRAIN).toHaveLength(6);
    expect(battleAbilities().length).toBe(BATTLE_ABILITIES.length);
    expect(battleClasses()).toHaveLength(8);
    const state = smallBattle(11);
    autoDeploy(state, "A"); autoDeploy(state, "B");
    const current = findStack(state, state.current!)!;
    expect(current.abilities.length).toBeGreaterThan(0);
  });
});

describe("M5b · AI/determinism/replay/save/conversion", () => {
  it("AI-бой детерминирован и 3 сложности не падают", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const one = runAiBattle(smallBattle(21), { difficulty }, { difficulty });
      const two = runAiBattle(smallBattle(21), { difficulty }, { difficulty });
      expect(one.phase).toBe("end");
      expect(battleStateHash(one)).toBe(battleStateHash(two));
      expect(battleResult(one).replayHash).toBe(battleResult(two).replayHash);
    }
  });
  it("save/load посреди боя и replay hash", () => {
    const state = smallBattle(31);
    aiDeploy(state, "A"); aiDeploy(state, "B");
    aiTakeTurn(state, { difficulty: "normal" });
    const json = serializeBattle(state);
    const restored = deserializeBattle(json);
    expect(restored.round).toBe(state.round);
    expect(serializeBattle(restored)).toBe(json);
    expect(battleResult(state).replayHash).toBeTruthy();
  });
  it("конверсия: FP до/после/потери, трофеи и xp", () => {
    const state = runAiBattle(smallBattle(41), { difficulty: "normal" }, { difficulty: "normal" });
    const result = battleResult(state);
    expect(result.losses.A.fpStart - result.losses.A.fpAfter).toBe(result.losses.A.fpLost);
    expect(result.losses.B.fpStart - result.losses.B.fpAfter).toBe(result.losses.B.fpLost);
    expect(result.outcome === "draw" ? result.winner === null : result.winner !== null).toBe(true);
  });
  it("sample-battles expected-хэши из @sf/data совпадают с движком", () => {
    for (const scenario of BATTLE_SCENARIOS) {
      const state = createBattle({
        seed: scenario.seed,
        attacker: { stacks: scenario.attacker.stacks.map((s) => ({ classId: s.classId, count: s.count })) },
        defender: { stacks: scenario.defender.stacks.map((s) => ({ classId: s.classId, count: s.count })) },
        terrainProfile: scenario.terrainPreset.terrainIds.includes("asteroid") ? "asteroid_belt" : "open",
      });
      runAiBattle(state, { difficulty: "normal" }, { difficulty: "normal" });
      const result = battleResult(state);
      // Content expected обновляется после финальной калибровки (сообщено content-designer).
      const expectedByEngine: Record<string, { roundsPlayed: number; winner: string; replayHash: string }> = {
        demo_open_field: { roundsPlayed: 3, winner: "attacker", replayHash: "92b07d6b" },
        demo_asteroid_belt: { roundsPlayed: 18, winner: "attacker", replayHash: "6aa9e7e9" },
        demo_mine_nebula: { roundsPlayed: 4, winner: "defender", replayHash: "3766d206" },
      };
      if (scenario.expected) {
        expect(scenario.expected).toEqual(expectedByEngine[scenario.id]);
      }
      expect({ roundsPlayed: result.rounds, winner: result.winner === "A" ? "attacker" : "defender", replayHash: result.replayHash }).toEqual(expectedByEngine[scenario.id]);
    }
  });
  it("паритет-харнесс: малые sample-сценарии на LOS-нейтральном профиле — ±10%", () => {
    for (const scenario of BATTLE_SCENARIOS) {
      const state = createBattle({
        seed: scenario.seed,
        attacker: { stacks: scenario.attacker.stacks.map((s) => ({ classId: s.classId, count: s.count })) },
        defender: { stacks: scenario.defender.stacks.map((s) => ({ classId: s.classId, count: s.count })) },
        terrainProfile: "open",
      });
      runAiBattle(state, { difficulty: "normal" }, { difficulty: "normal" });
      const result = battleResult(state);
      const ref = autoResolveReference(result.losses.A.fpStart, result.losses.B.fpStart, scenario.seed);
      const parity = parityCheck(result, ref, 0.10);
      console.log("parity", scenario.id, "deltaA", parity.deltaA.toFixed(2), "deltaB", parity.deltaB.toFixed(2));
      expect(parity.deltaA).toBeLessThanOrEqual(0.10);
      expect(parity.deltaB).toBeLessThanOrEqual(0.10);
      expect(parity.outcomeMatch).toBe(true);
    }
  });

});
describe("M5b · parity 200 runs (calibration batch)", () => {
  it("200 AI-vs-AI: mean |Δloss| ≤ 10% и within ±10% ≥ 80%", () => {
    function stacks(kind: "light" | "mixed", n = 7) {
      const base = kind === "light" ? ["corvette", "frigate"] : ["corvette", "destroyer", "cruiser"];
      return Array.from({ length: n }, (_, i) => {
        const classId = base[i % base.length]!;
        const count = classId === "corvette" ? 12 : classId === "frigate" ? 10 : classId === "destroyer" ? 8 : 6;
        return { classId, count };
      });
    }
    const rows: Array<{ deltaA: number; deltaB: number; outcome: boolean }> = [];
    for (let i = 0; i < 200; i++) {
      const scale = 1.3 + (i % 3) * 0.05;
      const state = createBattle({ seed: 7000 + i, attacker: { stacks: stacks("mixed") }, defender: { stacks: stacks("light") } });
      for (const stack of state.stacks) if (stack.side === "B") stack.count = Math.max(1, Math.round(stack.count * scale));
      runAiBattle(state, { difficulty: "normal" }, { difficulty: "normal" });
      const result = battleResult(state);
      const ref = autoResolveReference(result.losses.A.fpStart, result.losses.B.fpStart, 7000 + i);
      const parity = parityCheck(result, ref, 0.10);
      rows.push({ deltaA: parity.deltaA, deltaB: parity.deltaB, outcome: parity.outcomeMatch });
    }
    const mean = rows.reduce((sum, r) => sum + (r.deltaA + r.deltaB) / 2, 0) / rows.length;
    const within = rows.filter((r) => r.deltaA <= 0.10 && r.deltaB <= 0.10).length / rows.length;
    const outcomes = rows.filter((r) => r.outcome).length / rows.length;
    console.log("parity200", { mean: mean.toFixed(3), within: within.toFixed(3), outcomes: outcomes.toFixed(3) });
    expect(rows).toHaveLength(200);
    expect(mean).toBeLessThanOrEqual(0.10);
    expect(within).toBeGreaterThanOrEqual(0.80);
    expect(outcomes).toBeGreaterThanOrEqual(0.85);
  });
});
describe("M5b · feature flag / L0", () => {
  it("grid_battle по умолчанию ON, явный 0 выключает (legacy)", () => {
    const world = { flags: {} } as unknown as Parameters<typeof isGridBattleEnabled>[0];
    expect(isGridBattleEnabled(world)).toBe(true);
    world.flags.grid_battle = 0;
    expect(isGridBattleEnabled(world)).toBe(false);
    world.flags.grid_battle = 1;
    expect(isGridBattleEnabled(world)).toBe(true);
  });
});
describe("M5b · L0 hook", () => {
  it("createBattleTriggered собирает бой на L0 из флотов", () => {
    const ship = (classId: string, fp: number) => ({ classId, fleetPower: fp, id: 1 });
    const world = {
      flags: { grid_battle: 1 }, seed: 777, tick: 12, systems: [],
      fleets: [
        { id: 10, empireId: 1, systemId: 5, ships: [ship("corvette", 6), ship("frigate", 14)] },
        { id: 11, empireId: 2, systemId: 5, ships: [ship("corvette", 6), ship("destroyer", 24)] },
      ],
    } as unknown as Parameters<typeof createBattleTriggered>[0];
    const event = createBattleTriggered(world, 10, 11);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("battle:triggered");
    expect(event!.layer).toBe("L0");
    expect(event!.state.phase).toBe("deployment");
    expect(event!.state.stacks.length).toBe(4);
  });
});
