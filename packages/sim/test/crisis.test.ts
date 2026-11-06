import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { worldWithFg } from "./fg-helpers";
import {
  CRISIS_EMPIRE_BASE, activeCrises, crisisDefs, crisisEmpireId, crisisPhase, crisisScale,
  galaxyCrisisDefeated, onCrisisBattle, spawnCrisis,
} from "../src/crisis";
import { ensureFg } from "../src/fullgame";
import { serializeWorld } from "../src/save";
import type { CrisisKind } from "../src/fullgame";
import type { World } from "../src/types";

const KINDS: CrisisKind[] = ["void_reavers", "synthetic_revolt", "grey_tide", "devourers", "ancient_awakening"];

function fresh(): World {
  return worldWithFg();
}

describe("кризисы (GDD §14)", () => {
  it("fallback-определения: 5 кризисов с валидными полями", () => {
    expect(crisisDefs().length).toBeGreaterThanOrEqual(5);
    for (const kind of KINDS) {
      const def = crisisDefs().find((d) => d.kind === kind);
      expect(def, kind).toBeDefined();
      expect(def!.startTick).toBeGreaterThan(0);
      expect(def!.scalingFp).toBeGreaterThan(0);
      expect(def!.rewards.credits).toBeGreaterThan(0);
    }
  });

  it("spawnCrisis создаёт империю кризиса, системы, флоты и узлы", () => {
    for (const kind of KINDS) {
      const world = fresh();
      spawnCrisis(world, kind);
      const fg = ensureFg(world);
      const crisis = fg.crises.find((c) => c.kind === kind);
      expect(crisis, kind).toBeDefined();
      expect(crisis!.defeated).toBe(false);
      expect(crisis!.strengthFp).toBeGreaterThan(0);
      expect(crisis!.systems.length).toBeGreaterThan(0);
      const empireId = crisisEmpireId(world, crisis!);
      expect(empireId).toBeGreaterThanOrEqual(CRISIS_EMPIRE_BASE);
      expect(world.empires.some((e) => e.id === empireId)).toBe(true);
      expect(world.empires.find((e) => e.id === empireId)!.ai).toBeNull();
      // враги всем
      expect(world.empires[0].relations[empireId]?.treaty).toBe("war");
      // флоты/узлы (у Пожирателей вместо узлов — волны вторжения)
      expect(world.fleets.filter((f) => f.empireId === empireId).length).toBeGreaterThan(0);
      if (kind !== "devourers") {
        expect(crisis!.nodes.length).toBeGreaterThan(0);
        for (const nodeId of crisis!.nodes) {
          const fleet = world.fleets.find((f) => f.id === nodeId);
          expect(fleet).toBeDefined();
          expect(fleet!.ships.length).toBeGreaterThan(0);
        }
      }
      // повторный спавн того же активного кризиса игнорируется
      spawnCrisis(world, kind);
      expect(fg.crises.filter((c) => c.kind === kind).length).toBe(1);
    }
  });

  it("детерминизм: одинаковый seed/такт → идентичное состояние", () => {
    const spawn = (): string => {
      const world = fresh();
      world.tick = 500;
      spawnCrisis(world, "void_reavers");
      return serializeWorld(world);
    };
    expect(spawn()).toBe(spawn());
  });

  it("crisisPhase запускает Мародёров при триггере (12 систем)", () => {
    const world = fresh();
    world.tick = 2200;
    const player = world.empires[0];
    player.systems = world.systems.slice(0, 12).map((s) => s.id);
    crisisPhase(world);
    expect(ensureFg(world).crises.some((c) => c.kind === "void_reavers")).toBe(true);
  });

  it("crisisPhase не запускает кризис раньше времени", () => {
    const world = fresh();
    world.tick = 100;
    crisisPhase(world);
    expect(ensureFg(world).crises.length).toBe(0);
  });

  it("кризисная шкала растёт от числа империй T4+", () => {
    const world = fresh();
    expect(crisisScale(world)).toBe(0);
    world.empires[1].techs.completed.push("soc_ascension_1");
    expect(crisisScale(world)).toBeGreaterThanOrEqual(25);
  });

  it("onCrisisBattle уменьшает силу, начисляет урон/трофеи игроку", () => {
    const world = fresh();
    spawnCrisis(world, "void_reavers");
    const crisis = activeCrises(world)[0];
    const before = crisis.strengthFp;
    const creditsBefore = world.empires[0].resources.credits;
    onCrisisBattle(world, crisis.systems[0], 100, true);
    expect(crisis.strengthFp).toBe(before - 100);
    expect(world.flags[`crisis_damage:${world.playerEmpireId}`] ?? 0).toBeGreaterThanOrEqual(100);
    expect(world.empires[0].resources.credits).toBeGreaterThan(creditsBefore);
  });

  it("уничтожение узлов ведёт к Ядру и победе с наградой", () => {
    const world = fresh();
    spawnCrisis(world, "synthetic_revolt");
    const fg = ensureFg(world);
    const crisis = fg.crises[0];
    // убиваем узлы
    for (const nodeId of [...crisis.nodes]) {
      const node = world.fleets.find((f) => f.id === nodeId);
      if (node) node.ships = [];
    }
    world.tick += 1;
    crisisPhase(world);
    // synthetic_revolt: без ядра → сразу победа; для kind с ядром оно появляется
    expect(crisis.defeated).toBe(true);
    expect(world.flags["crisis_victories"] ?? 0).toBeGreaterThanOrEqual(1);
    const alloys = world.empires[0].resources.alloys;
    expect(alloys).toBeGreaterThan(0);
  });

  it("Серый Прилив: узлы → Ядро → победа", () => {
    const world = fresh();
    spawnCrisis(world, "grey_tide");
    const fg = ensureFg(world);
    const crisis = fg.crises[0];
    for (const nodeId of [...crisis.nodes]) {
      const node = world.fleets.find((f) => f.id === nodeId);
      if (node) node.ships = [];
    }
    world.tick += 1;
    crisisPhase(world);
    expect(crisis.stage).toBe(9); // Ядро открыто
    expect(crisis.nodes.length).toBe(1);
    const coreId = crisis.nodes[0];
    const core = world.fleets.find((f) => f.id === coreId);
    expect(core).toBeDefined();
    if (core) core.ships = [];
    world.tick += 1;
    crisisPhase(world);
    expect(crisis.defeated).toBe(true);
  });

  it("общее поражение при 60% галактики (флаг crisis_defeat)", () => {
    const world = fresh();
    spawnCrisis(world, "grey_tide");
    const crisis = ensureFg(world).crises[0];
    const count = Math.ceil(world.systems.length * 0.61);
    crisis.systems = world.systems.slice(0, count).map((s) => s.id);
    world.tick += 1;
    crisisPhase(world);
    expect(galaxyCrisisDefeated(world)).toBe(true);
  });

  it("длинный горизонт: все 5 кризисов срабатывают по таймлайну (гарантия GDD §14)", () => {
    const world = fresh();
    // имитируем длинный горизонт: слабая галактика без триггерных условий, но с forced-таймлайном
    for (const tickMark of [2200, 2600, 3600, 4600, 5200]) {
      world.tick = tickMark;
      for (let i = 0; i < 900; i++) {
        world.tick += 1;
        crisisPhase(world);
        const kinds = new Set(ensureFg(world).crises.map((c) => c.kind));
        if (kinds.size >= 5) break;
      }
    }
    const kinds = new Set(ensureFg(world).crises.map((c) => c.kind));
    expect(kinds.size).toBe(5);
    expect(ensureFg(world).crises.every((c) => c.systems.length > 0)).toBe(true);
  });

  it("тик с активным кризисом не падает (интеграция)", async () => {
    const { tick } = await import("../src/tick");
    const world = fresh();
    world.tick = 1999;
    spawnCrisis(world, "void_reavers");
    for (let i = 0; i < 5; i++) tick(world);
    expect(world.tick).toBe(2004);
    expect(Number.isFinite(world.empires[0].resources.energy)).toBe(true);
  });
});
