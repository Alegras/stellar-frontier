import { describe, expect, it } from "vitest";
import { worldWithFg } from "./fg-helpers";
import {
  TIMELINE, VICTORY_CHECKS_FROM, computeFullScore, scoreTitle, victoryPhase, victoryProgress,
} from "../src/victory";
import { advancedOf, ensureFg } from "../src/fullgame";
import { serializeWorld } from "../src/save";
import type { World } from "../src/types";

function ownSystemsByPlayer(world: World, count: number): void {
  for (let i = 0; i < count && i < world.systems.length; i++) world.systems[i].ownerId = world.playerEmpireId;
}

function killAllAi(world: World): void {
  for (const empire of world.empires) {
    if (empire.isPlayer || empire.id === 9 || empire.id >= 90) continue;
    empire.dead = true;
  }
}

describe("победа, счёт и таймлайн (GDD §16)", () => {
  it("6 полей прогресса, значения 0..1; до 4000 победы нет", () => {
    const world = worldWithFg();
    const progress = victoryProgress(world, world.playerEmpireId);
    for (const key of ["domination", "federation", "ascension", "economy", "crisis"] as const) {
      expect(progress[key], key).toBeGreaterThanOrEqual(0);
      expect(progress[key], key).toBeLessThanOrEqual(1);
    }
    expect(progress.economySince).toBeGreaterThanOrEqual(0);
    expect(world.tick).toBeLessThan(VICTORY_CHECKS_FROM);
  });

  it("доминирование: 45%+ систем и такт >= 4000", () => {
    const world = worldWithFg();
    ownSystemsByPlayer(world, Math.ceil(world.systems.length * 0.46));
    world.tick = 100;
    victoryPhase(world);
    expect(world.victory.achieved).toBeNull();
    world.tick = VICTORY_CHECKS_FROM;
    victoryPhase(world);
    expect(world.victory.achieved).toBe("domination");
    expect(world.victory.winnerEmpireId).toBe(world.playerEmpireId);
  });

  it("экономическая гегемония: 40% ВВП 300 тактов подряд", () => {
    const world = worldWithFg();
    killAllAi(world);
    world.flags[`econ_since:${world.playerEmpireId}`] = 299;
    world.tick = 4300;
    victoryPhase(world);
    expect(world.victory.achieved).toBe("economy");
    expect(world.flags[`econ_since:${world.playerEmpireId}`]).toBe(300);
  });

  it("экономика не побеждает без выдержки 300 тактов", () => {
    const world = worldWithFg();
    killAllAi(world);
    world.tick = 4300;
    victoryPhase(world);
    expect(world.victory.achieved).toBeNull();
  });

  it("вознесение: T5-технология + T5-мегаструктура + перки", () => {
    const world = worldWithFg();
    const playerId = world.playerEmpireId;
    const player = world.empires[0];
    player.techs.completed.push("soc_ascension_1");
    const fg = ensureFg(world);
    fg.megastructures.push({
      id: fg.nextMegastructureId++, type: "dyson_sphere", systemId: player.capitalSystemId,
      ownerId: playerId, ticksLeft: 0, totalTicks: 200, active: true, hp: 1000, maxHp: 1000,
    });
    const adv = advancedOf(world, playerId);
    adv.perks = ["p1", "p2", "p3"];
    world.tick = 4400;
    victoryPhase(world);
    expect(world.victory.achieved).toBe("ascension");
  });

  it("федерация: 3+ участника и 60% населения", () => {
    const world = worldWithFg();
    const fg = ensureFg(world);
    const members = [1, 2, 3, 4, 5, 6, 7, 8];
    fg.federations.push({
      id: 1, nameRu: "Федерация Веретена", members, presidentId: 1, foundedTick: 0,
      treasuryEnergy: 0, treasuryAlloys: 0, fleetIds: [], nextChairTick: 0, votes: {},
    });
    world.tick = 4400;
    victoryPhase(world);
    expect(world.victory.achieved).toBe("federation");
  });

  it("выживание в кризисе: оба поздних кризиса побеждены после 6200", () => {
    const world = worldWithFg();
    world.flags["crisis_defeated:grey_tide"] = 1;
    world.flags["crisis_defeated:devourers"] = 1;
    world.tick = 6300;
    victoryPhase(world);
    expect(world.victory.achieved).toBe("crisis");
  });

  it("финальный счёт на такте 7200", () => {
    const world = worldWithFg();
    killAllAi(world);
    ownSystemsByPlayer(world, 20);
    world.tick = TIMELINE.end;
    victoryPhase(world);
    expect(world.victory.achieved).toBe("score");
    expect(world.victory.winnerEmpireId).toBe(world.playerEmpireId);
    expect(ensureFg(world).score[world.playerEmpireId]).toBeGreaterThan(0);
  });

  it("финальное давление на 6200 и окно победы на 7000", () => {
    const world = worldWithFg();
    world.tick = TIMELINE.finalPressure;
    victoryPhase(world);
    expect(ensureFg(world).finalPressure).toBe(1);
    expect(world.flags["final_pressure"]).toBe(1);
    const log = world.log.map((e) => e.messageRu).join(" ");
    expect(log).toContain("Финальное давление");
    world.tick = TIMELINE.victoryWindow;
    victoryPhase(world);
    expect(world.flags["victory_window"]).toBe(1);
  });

  it("счёт по GDD §16.2 и звания", () => {
    const world = worldWithFg();
    const score = computeFullScore(world, world.playerEmpireId);
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(Number.isFinite(score) ? score : 0);
    expect(scoreTitle(30000)).toBe("Легенда Веретена");
    expect(scoreTitle(20000)).toBe("Владыка Дорог");
    expect(scoreTitle(13000)).toBe("Адмирал Фронтира");
    expect(scoreTitle(8000)).toBe("Капитан");
    expect(scoreTitle(100)).toBe("Выживший");
  });

  it("мягкое поражение и «последний шанс»", () => {
    const world = worldWithFg();
    const player = world.empires[0];
    world.tick = 6100;
    player.colonies = [];
    player.fleets = [];
    victoryPhase(world);
    expect(world.flags[`defeat:${player.id}`]).toBe(6100); // мягкое поражение зафиксировано
    expect(player.colonies.length).toBe(0);
  });

  it("«последний шанс» выдаёт флот 50 FP и 500 Cr", () => {
    const world = worldWithFg();
    const player = world.empires[0];
    world.tick = 6100;
    player.colonies = [player.colonies[0]];
    player.fleets = [];
    player.resources.credits = 0;
    victoryPhase(world);
    expect(world.flags["last_chance_used"]).toBe(1);
    expect(player.resources.credits).toBe(500);
    const fleet = world.fleets.find((f) => f.empireId === player.id && f.name.includes("последнего шанса"));
    expect(fleet).toBeDefined();
    const fp = fleet!.ships.reduce((acc, ship) => acc + ship.fleetPower, 0);
    expect(fp).toBeGreaterThanOrEqual(48);
  });

  it("детерминизм victoryPhase (same seed → same state)", () => {
    const run = (): string => {
      const world = worldWithFg();
      world.tick = 4300;
      victoryPhase(world);
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  });
});
