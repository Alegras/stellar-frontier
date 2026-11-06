/**
 * Тесты аномалий и археологии (M9): раскладка по seed, обнаружение, первокрытие,
 * артефакты «Шёпота», археологические цепочки, лор. docs/11 §5, GDD §14.8–14.9.
 */
import { describe, expect, it } from "vitest";
import type { AnomalyDef, ArchaeologyDef, LoreDef } from "@sf/data";
import {
  ANOMALY_TARGET_COUNT, anomalyPhase, anomaliesInSystem, archaeologyState, archaeologyStep,
  investigateAnomaly, investigatableAnomalies,
} from "../src/anomalies";
import { SECRET_ARTIFACTS } from "../src/campaign";
import { createFleet, createShip } from "../src/economy";
import { makeAnomaly, makeArchaeology, makeLore, makeWorld, playerId, fgOf } from "./campaignFixtures";
import type { World } from "../src/types";

function catalogOf(anomalies: AnomalyDef[], archaeology: ArchaeologyDef[] = [], lore: LoreDef[] = []) {
  return { anomalies, archaeology, lore };
}

function phaseAt(world: World, catalog: ReturnType<typeof catalogOf>, tick: number): void {
  world.tick = tick;
  anomalyPhase(world, catalog);
}

function makeKnown(world: World, systemId: number): void {
  const system = world.systems.find((item) => item.id === systemId);
  if (!system) throw new Error("нет системы " + systemId);
  const pid = playerId(world);
  if (!system.knownBy.includes(pid)) system.knownBy.push(pid);
}

function addPlayerFleet(world: World, systemId: number): void {
  createFleet(
    world,
    playerId(world),
    systemId,
    [createShip(world.nextId++, "corvette_scout", "Скаут-" + systemId)],
    "Скаут-флот",
  );
}

const BASIC_DEFS = [
  makeAnomaly({ id: "an_a" }),
  makeAnomaly({ id: "an_b", kind: "derelict", rewardCredits: 800, rewardScience: 60 }),
  makeAnomaly({ id: "an_c", kind: "silent_star", rewardCredits: 1200, rewardScience: 140 }),
];

describe("аномалии: раскладка по seed", () => {
  it("60 аномалий, детерминизм по seed, повторный вызов не дублирует", () => {
    const worldA = makeWorld(7);
    const worldB = makeWorld(7);
    phaseAt(worldA, catalogOf(BASIC_DEFS), 0);
    phaseAt(worldB, catalogOf(BASIC_DEFS), 0);
    const anomaliesA = fgOf(worldA).anomalies;
    const anomaliesB = fgOf(worldB).anomalies;
    expect(anomaliesA.length).toBe(Math.min(ANOMALY_TARGET_COUNT, worldA.systems.length));
    expect(JSON.stringify(anomaliesA)).toBe(JSON.stringify(anomaliesB));
    // ровно одна аномалия на систему
    expect(new Set(anomaliesA.map((anomaly) => anomaly.systemId)).size).toBe(anomaliesA.length);
    // повторная фаза раскладку не меняет
    phaseAt(worldA, catalogOf(BASIC_DEFS), 4);
    expect(fgOf(worldA).anomalies.length).toBe(anomaliesA.length);
    // другой seed — другая раскладка
    const worldC = makeWorld(8);
    phaseAt(worldC, catalogOf(BASIC_DEFS), 0);
    expect(JSON.stringify(fgOf(worldC).anomalies)).not.toBe(JSON.stringify(anomaliesA));
  });

  it("пустые данные: фаза пассивна, команды отклоняются", () => {
    const world = makeWorld();
    anomalyPhase(world, { anomalies: [], archaeology: [], lore: [] });
    expect(fgOf(world).anomalies).toEqual([]);
    expect(investigateAnomaly(world, playerId(world), "any").ok).toBe(false);
    expect(archaeologyStep(world, playerId(world), "any").ok).toBe(false);
    expect(archaeologyState(world, "any")).toBe(null);
  });
});

describe("аномалии: обнаружение и исследование", () => {
  it("обнаруживаются только в известных системах", () => {
    const world = makeWorld(11);
    const catalog = catalogOf(BASIC_DEFS);
    phaseAt(world, catalog, 0);
    const fg = fgOf(world);
    const pid = playerId(world);
    // раскладка покрывает 60 из 240 систем → делаем систему одной аномалии известной
    const target = fg.anomalies[0]!;
    makeKnown(world, target.systemId);
    phaseAt(world, catalog, 4);
    expect(target.discovered).toBe(true);
    const discovered = fg.anomalies.filter((anomaly) => anomaly.discovered);
    expect(discovered.length).toBeGreaterThanOrEqual(1);
    for (const anomaly of discovered) {
      const system = world.systems.find((item) => item.id === anomaly.systemId)!;
      expect(system.knownBy.includes(pid)).toBe(true);
    }
    expect(investigatableAnomalies(world).length).toBe(discovered.length);
    expect(anomaliesInSystem(world, discovered[0]!.systemId).length).toBe(1);
  });

  it("исследование: награды, первокрытие, идемпотентность", () => {
    const world = makeWorld(11);
    const catalog = catalogOf(BASIC_DEFS);
    phaseAt(world, catalog, 0);
    const fg = fgOf(world);
    const pid = playerId(world);
    const empire = world.empires.find((e) => e.id === pid)!;

    const first = fg.anomalies[0]!;
    makeKnown(world, first.systemId);
    phaseAt(world, catalog, 4);
    expect(first.discovered).toBe(true);
    addPlayerFleet(world, first.systemId);
    const creditsBefore = empire.resources.credits;
    const physicsBefore = empire.science.physics;
    expect(investigateAnomaly(world, pid, first.id, catalog).ok).toBe(true);
    expect(first.investigated).toBe(true);
    // первокрытие: +50% кредитов (базовая награда ≥ 800)
    const expectedFirst = first.rewardCredits + Math.round((first.rewardCredits * 50) / 100);
    expect(empire.resources.credits).toBe(creditsBefore + expectedFirst);
    expect(empire.science.physics).toBe(physicsBefore + Math.floor((first.rewardScience * 60) / 100));
    expect(fg.campaign.flags["firstDiscovery." + first.id]).toBe(1);
    expect(fg.journal.some((entry) => entry.kind === "anomaly" && entry.textRu.includes("первокрытие"))).toBe(true);
    // повторно нельзя
    expect(investigateAnomaly(world, pid, first.id, catalog).ok).toBe(false);
    expect(empire.resources.credits).toBe(creditsBefore + expectedFirst);

    // вторая аномалия — уже без бонуса первокрытия
    const second = fg.anomalies.find((anomaly) => anomaly.id !== first.id && !anomaly.investigated)!;
    makeKnown(world, second.systemId);
    phaseAt(world, catalog, 8);
    addPlayerFleet(world, second.systemId);
    const beforeSecond = empire.resources.credits;
    expect(investigateAnomaly(world, pid, second.id, catalog).ok).toBe(true);
    expect(empire.resources.credits).toBe(beforeSecond + second.rewardCredits);
  });

  it("без корабля в системе аномалии — отказ", () => {
    const world = makeWorld(11);
    const catalog = catalogOf(BASIC_DEFS);
    phaseAt(world, catalog, 0);
    const anomaly = fgOf(world).anomalies[0]!;
    makeKnown(world, anomaly.systemId);
    phaseAt(world, catalog, 4);
    expect(anomaly.discovered).toBe(true);
    const result = investigateAnomaly(world, playerId(world), anomaly.id, catalog);
    expect(result.ok).toBe(false);
    expect(result.messageRu).toContain("корабль");
  });

  it("артефакт поднимает счётчики кампании и «Шёпот»", () => {
    const world = makeWorld(11);
    const defs = [makeAnomaly({ id: "an_artifact", artifact: true })];
    const catalog = catalogOf(defs);
    phaseAt(world, catalog, 0);
    const fg = fgOf(world);
    const anomaly = fg.anomalies[0]!;
    makeKnown(world, anomaly.systemId);
    phaseAt(world, catalog, 4);
    addPlayerFleet(world, anomaly.systemId);
    expect(investigateAnomaly(world, playerId(world), anomaly.id, catalog).ok).toBe(true);
    expect(fg.campaign.artifactCount).toBe(1);
    expect(fg.campaign.secretLine).toBe(1);
    expect(fg.campaign.secretLine).toBeLessThanOrEqual(SECRET_ARTIFACTS);
    expect(fg.journal.some((entry) => entry.kind === "artifact")).toBe(true);
  });
});

describe("аномалии: археология", () => {
  it("шаги цепочки, награда один раз, артефакт «Шёпота»", () => {
    const world = makeWorld(13);
    const archaeology = [makeArchaeology({ chainId: "arch_1", steps: 3, artifact: true })];
    const anomalies = [makeAnomaly({ id: "an_arch", chainId: "arch_1" })];
    const catalog = catalogOf(anomalies, archaeology);
    phaseAt(world, catalog, 0);
    const fg = fgOf(world);
    const pid = playerId(world);
    const empire = world.empires.find((e) => e.id === pid)!;
    const anomaly = fg.anomalies[0]!;
    makeKnown(world, anomaly.systemId);
    phaseAt(world, catalog, 4);
    addPlayerFleet(world, anomaly.systemId);
    expect(investigateAnomaly(world, pid, anomaly.id, catalog).ok).toBe(true);
    // исследование аномалии автоматически стартует цепочку
    expect(archaeologyState(world, "arch_1")).toBeTruthy();
    expect(fg.archaeology[0]!.step).toBe(0);

    const creditsBefore = empire.resources.credits;
    expect(archaeologyStep(world, pid, "arch_1", catalog).ok).toBe(true);
    expect(fg.archaeology[0]!.step).toBe(1);
    expect(archaeologyStep(world, pid, "arch_1", catalog).ok).toBe(true);
    expect(fg.archaeology[0]!.completed).toBe(false);
    expect(archaeologyStep(world, pid, "arch_1", catalog).ok).toBe(true);
    expect(fg.archaeology[0]!.completed).toBe(true);
    expect(empire.resources.credits).toBe(creditsBefore + 2000);
    expect(fg.campaign.artifactCount).toBe(1);
    expect(fg.campaign.secretLine).toBe(1);
    // награда не дублируется
    expect(archaeologyStep(world, pid, "arch_1", catalog).ok).toBe(false);
    expect(empire.resources.credits).toBe(creditsBefore + 2000);
  });

  it("цепочку нельзя начать без обнаруженной аномалии", () => {
    const world = makeWorld(13);
    const catalog = catalogOf([makeAnomaly({ id: "an_x", chainId: "arch_2" })], [makeArchaeology({ chainId: "arch_2" })]);
    phaseAt(world, catalog, 0);
    const fg = fgOf(world);
    for (const anomaly of fg.anomalies) anomaly.discovered = false;
    expect(archaeologyStep(world, playerId(world), "arch_2", catalog).ok).toBe(false);
    expect(fg.archaeology).toEqual([]);
  });
});

describe("аномалии: лор", () => {
  it("лор-запись выдаётся ровно один раз", () => {
    const world = makeWorld(17);
    const lore = [makeLore({ id: "lore_a", unlockCondition: "anomaly" })];
    const catalog = catalogOf(BASIC_DEFS, [], lore);
    phaseAt(world, catalog, 0);
    const fg = fgOf(world);
    const loreEntries = fg.journal.filter((entry) => entry.kind === "lore");
    expect(loreEntries.length).toBe(1);
    expect(fg.campaign.flags["lore.lore_a"]).toBe(1);
    // исследование не дублирует запись
    const anomaly = fg.anomalies[0]!;
    makeKnown(world, anomaly.systemId);
    phaseAt(world, catalog, 4);
    addPlayerFleet(world, anomaly.systemId);
    investigateAnomaly(world, playerId(world), anomaly.id, catalog);
    expect(fg.journal.filter((entry) => entry.kind === "lore").length).toBe(1);
  });
});
