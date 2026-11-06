import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import { createWorld } from "../src/queries";
import { tick } from "../src/tick";
import {
  CONTRACT_KINDS, abandonContract, acceptContract, activeContractsOf, availableContracts,
  contractTemplates, contractsPhase, generateContract, onContractBounty, onContractDock,
  onContractJump, onContractScan,
} from "../src/contracts";
import { adjustReputation, stationAccess, stationReputation } from "../src/market";
import { ensureFg } from "../src/fullgame";
import type { Contract } from "../src/fullgame";
import type { ResourceId, World } from "../src/types";

// ------------------------------------------------------------------ хелперы

function freshWorld(seed = 42): World {
  return createWorld(seed, MODE, BALANCE);
}

function player(world: World) {
  return world.empires.find((empire) => empire.isPlayer)!;
}

function capitalStation(world: World) {
  const empire = player(world);
  return world.systems[empire.capitalSystemId].station!;
}

/** Крутит такты, пока в пуле не появится контракт под предикат. */
function findContract(world: World, predicate: (contract: Contract) => boolean, maxTicks = 200): Contract | undefined {
  for (let i = 0; i <= maxTicks; i++) {
    if (i > 0) tick(world);
    const found = availableContracts(world).find(predicate);
    if (found) return found;
  }
  return undefined;
}

/** Товар deliver-цели закодирован в id: "deliver:<good>". */
function deliverGood(contract: Contract): ResourceId {
  return contract.objectives[0].id.split(":")[1] as ResourceId;
}

function objectiveByType(contract: Contract, type: string) {
  return contract.objectives.find((objective) => objective.type === type)!;
}

// ------------------------------------------------------------------ шаблоны и генерация

describe("контракты: шаблоны 12 типов (M8)", () => {
  it("реестр покрывает все 12 видов, 6 — из @sf/data MISSIONS", () => {
    const templates = contractTemplates();
    expect(CONTRACT_KINDS.length).toBe(12);
    for (const kind of CONTRACT_KINDS) {
      expect(templates.some((template) => template.kind === kind), "нет шаблона для " + kind).toBe(true);
    }
    // delivery/bounty/scan/passenger/smuggle/rescue приходят из packages/data/src/missions.json
    expect(templates.some((template) => template.defId === "delivery")).toBe(true);
    expect(templates.some((template) => template.defId === "bounty")).toBe(true);
    expect(templates.some((template) => template.defId === "mining")).toBe(true); // fallback
    for (const template of templates) {
      expect(template.rewardCredits).toBeGreaterThan(0);
      expect(template.maxTicks).toBeGreaterThanOrEqual(template.minTicks);
      expect(template.objective).toBeTypeOf("string");
    }
  });

  it("генерация: до 3 доступных на станцию, до 40 в мире, сроки в будущем, разнообразие видов", () => {
    const world = freshWorld();
    for (let index = 0; index < 60; index++) tick(world);
    const pool = availableContracts(world);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.length).toBeLessThanOrEqual(40);
    const perStation: Record<number, number> = {};
    for (const contract of pool) {
      perStation[contract.stationId] = (perStation[contract.stationId] ?? 0) + 1;
      expect(contract.deadlineTick).toBeGreaterThan(world.tick);
      expect(contract.objectives.length).toBeGreaterThan(0);
      expect(contract.risk).toBeGreaterThanOrEqual(0);
      expect(contract.risk).toBeLessThanOrEqual(1);
      expect(contract.accepted).toBe(false);
    }
    for (const key of Object.keys(perStation)) {
      expect(perStation[Number(key)]).toBeLessThanOrEqual(3);
    }
    expect(new Set(pool.map((contract) => contract.kind)).size).toBeGreaterThanOrEqual(6);
  });
});

// ------------------------------------------------------------------ приём и отказ

describe("контракты: приём и отказ (§14.3/§14.1-6)", () => {
  it("не более 3 активных, повторный приём запрещён, награда при приёме не платится", () => {
    const world = freshWorld();
    for (let index = 0; index < 30; index++) tick(world);
    const empire = player(world);
    const credits0 = empire.resources.credits;
    const pool = availableContracts(world);
    expect(pool.length).toBeGreaterThanOrEqual(4);
    for (const contract of pool.slice(0, 3)) {
      const result = acceptContract(world, 1, contract.id);
      expect(result.ok, result.messageRu).toBe(true);
    }
    expect(acceptContract(world, 1, pool[0].id).ok).toBe(false);
    expect(acceptContract(world, 1, pool[3].id).ok).toBe(false);
    expect(activeContractsOf(world, 1).length).toBe(3);
    expect(empire.resources.credits).toBe(credits0);
  });

  it("3 отказа → блок контрактов 100 тактов и −5 репутации за отказ", () => {
    const world = freshWorld();
    for (let index = 0; index < 40; index++) tick(world);
    const byStation: Record<number, Contract[]> = {};
    for (const contract of availableContracts(world)) {
      byStation[contract.stationId] = byStation[contract.stationId] ?? [];
      byStation[contract.stationId].push(contract);
    }
    const stationId = Number(Object.keys(byStation).find((key) => byStation[Number(key)].length >= 3));
    expect(Number.isFinite(stationId)).toBe(true);
    const contracts = byStation[stationId].slice(0, 3);
    const reputation0 = stationReputation(world, 1, stationId);
    for (const contract of contracts) {
      expect(acceptContract(world, 1, contract.id).ok, "принятие").toBe(true);
      const abandoned = abandonContract(world, 1, contract.id);
      expect(abandoned.ok, abandoned.messageRu).toBe(true);
      expect(contract.failed).toBe(true);
    }
    expect(stationReputation(world, 1, stationId)).toBe(Math.max(-100, reputation0 - 15));
    expect(world.flags["contract:block:1"]).toBeGreaterThan(world.tick);
    const next = availableContracts(world)[0];
    expect(next).toBeDefined();
    const denied = acceptContract(world, 1, next.id);
    expect(denied.ok).toBe(false);
    expect(denied.messageRu).toContain("заблокированы");
  });

  it("враждебная станция: доступны только контракты контрабанды", () => {
    const world = freshWorld();
    for (let index = 0; index < 20; index++) tick(world);
    const station = capitalStation(world);
    adjustReputation(world, 1, station.id, -100, "тест");
    expect(stationAccess(world, 1, station.id).missions).toBe("smuggle_only");
    const generated: Contract[] = [];
    for (let sequence = 0; sequence < 12; sequence++) {
      const contract = generateContract(world, station, sequence);
      if (contract) generated.push(contract);
    }
    expect(generated.length).toBeGreaterThan(0);
    for (const contract of generated) expect(contract.kind).toBe("smuggle");
  });
});

// ------------------------------------------------------------------ хуки прогресса

describe("контракты: хуки прогресса и награды", () => {
  it("dock: завершение, награда один раз (идемпотентно), репутация меняется по награде", () => {
    const world = freshWorld();
    const contract = findContract(world, (item) => item.objectives[0].type === "dock");
    expect(contract, "dock-контракт не сгенерирован").toBeDefined();
    const targetSystem = objectiveByType(contract!, "dock").targetSystemId!;
    const targetStation = world.systems[targetSystem].station;
    expect(targetStation).toBeDefined();
    expect(acceptContract(world, 1, contract!.id).ok).toBe(true);
    const empire = player(world);
    const credits0 = empire.resources.credits;
    const reputation0 = stationReputation(world, 1, contract!.stationId);
    const rewardRep = contract!.rewards.reputation ?? 0;
    onContractDock(world, 1, targetStation!.id);
    expect(contract!.completed).toBe(true);
    expect(contract!.accepted).toBe(false);
    expect(empire.resources.credits).toBe(credits0 + contract!.rewards.credits);
    expect(stationReputation(world, 1, contract!.stationId))
      .toBe(Math.min(100, Math.max(-100, reputation0 + rewardRep)));
    // повторные вызовы и фаза не платят второй раз
    onContractDock(world, 1, targetStation!.id);
    contractsPhase(world);
    expect(empire.resources.credits).toBe(credits0 + contract!.rewards.credits);
  });

  it("deliver: товар списывается из казны, контракт закрывается", () => {
    const world = freshWorld();
    const contract = findContract(world, (item) => item.objectives[0].type === "deliver");
    expect(contract, "deliver-контракт не сгенерирован").toBeDefined();
    const good = deliverGood(contract!);
    const objective = objectiveByType(contract!, "deliver");
    const targetSystem = objective.targetSystemId!;
    const targetStation = world.systems[targetSystem].station;
    expect(targetStation).toBeDefined();
    const empire = player(world);
    empire.resources[good] = objective.count + 50;
    expect(acceptContract(world, 1, contract!.id).ok).toBe(true);
    const before = empire.resources[good];
    onContractDock(world, 1, targetStation!.id);
    expect(empire.resources[good]).toBe(before - objective.count);
    expect(contract!.completed).toBe(true);
  });

  it("scan и bounty: прогресс по хукам", () => {
    const world = freshWorld();
    const scanContract = findContract(world, (item) => item.objectives[0].type === "scan");
    expect(scanContract, "scan-контракт не сгенерирован").toBeDefined();
    expect(acceptContract(world, 1, scanContract!.id).ok).toBe(true);
    const scanTarget = objectiveByType(scanContract!, "scan").targetSystemId!;
    const scanCredits = player(world).resources.credits;
    onContractScan(world, 1, scanTarget);
    expect(scanContract!.completed).toBe(true);
    expect(player(world).resources.credits).toBeGreaterThanOrEqual(scanCredits);

    const bountyContract = findContract(world, (item) => item.objectives[0].type === "bounty");
    expect(bountyContract, "bounty-контракт не сгенерирован").toBeDefined();
    expect(acceptContract(world, 1, bountyContract!.id).ok).toBe(true);
    const objective = objectiveByType(bountyContract!, "bounty");
    onContractBounty(world, 1, objective.targetSystemId!, objective.count);
    expect(bountyContract!.completed).toBe(true);
  });

  it("jump: закрывается прибытием в целевую систему", () => {
    const world = freshWorld();
    const contract = findContract(world, (item) => item.objectives[0].type === "jump", 300);
    expect(contract, "jump-контракт не сгенерирован").toBeDefined();
    expect(acceptContract(world, 1, contract!.id).ok).toBe(true);
    const target = objectiveByType(contract!, "jump").targetSystemId!;
    onContractJump(world, 1, target);
    expect(contract!.completed).toBe(true);
  });
});

// ------------------------------------------------------------------ сроки и провал

describe("контракты: сроки и провал (§11.6)", () => {
  it("истечение срока: репутация −15, штраф 25 000 Cr", () => {
    const world = freshWorld();
    const contract = findContract(world, (item) => item.objectives[0].type === "scan");
    expect(contract).toBeDefined();
    expect(acceptContract(world, 1, contract!.id).ok).toBe(true);
    const empire = player(world);
    const credits0 = empire.resources.credits;
    const reputation0 = stationReputation(world, 1, contract!.stationId);
    contract!.deadlineTick = world.tick - 1;
    contractsPhase(world);
    expect(contract!.failed).toBe(true);
    expect(contract!.accepted).toBe(false);
    expect(stationReputation(world, 1, contract!.stationId)).toBe(Math.max(-100, reputation0 - 15));
    expect(empire.resources.credits).toBe(credits0 - Math.min(credits0, 25000));
  });

  it("награда не выдаётся до завершения и не выдаётся проваленным", () => {
    const world = freshWorld();
    const contract = findContract(world, (item) => item.objectives[0].type === "bounty");
    expect(contract).toBeDefined();
    const empire = player(world);
    const credits0 = empire.resources.credits;
    expect(acceptContract(world, 1, contract!.id).ok).toBe(true);
    contractsPhase(world);
    expect(contract!.completed).toBe(false);
    expect(empire.resources.credits).toBe(credits0);
  });
});

// ------------------------------------------------------------------ детерминизм

describe("контракты: детерминизм", () => {
  it("одинаковый seed → одинаковый пул контрактов и те же id", () => {
    const run = (): string => {
      const world = freshWorld(2024);
      for (let index = 0; index < 30; index++) tick(world);
      const pool = availableContracts(world).map((contract) => ({
        id: contract.id,
        kind: contract.kind,
        credits: contract.rewards.credits,
        deadline: contract.deadlineTick,
        objective: contract.objectives[0].id,
      }));
      return JSON.stringify({ pool, next: ensureFg(world).nextContractId });
    };
    expect(run()).toBe(run());
  });
});
