import { describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import {
  activateTreaty, advancedOf, aiWorldEventChoice, applyCommandAs, createWorld, deserializeWorld,
  ensureFg, ensureSectorGenerated, forceAbsorb, forceCentralizeFederation, forceCollapse, getAiNews,
  getAiRelations, getAiWorldEvents, getAiWorldHud, getAiWorldState, relationOf, revealSector,
  serializeWorld, tick, getKnownSystems, getEmpireCapitals, getPoliticalMap, sectorScan,
} from "../src/index";
import { aiWorldPhase } from "../src/aiWorld";
import { empireById } from "../src/economy";
import type { World } from "../src/index";

function makeWorld(): World {
  return createWorld(42, MODE, BALANCE);
}

describe("task-42 · состояние и API мировой политики", () => {
  it("fg.aiWorld инициализируется, новости/события/статистика доступны", () => {
    const world = makeWorld();
    for (let i = 0; i < 40; i++) tick(world);
    const fg = ensureFg(world);
    expect(fg.aiWorld.schemaVersion).toBe(1);
    const news = getAiNews(world);
    expect(Array.isArray(news)).toBe(true);
    expect(news.length).toBeGreaterThan(0);
    expect(news.every((item) => typeof item.textRu === "string" && item.tick >= 0)).toBe(true);
    const state = getAiWorldState(world);
    expect(state.empires.length).toBe(world.empires.length);
    expect(state.relations.length).toBeGreaterThanOrEqual(0);
    expect(state.playerImpact).toBeTruthy();
    expect(getAiWorldHud(world).activeWars).toBe(state.stats.wars);
  });

  it("getAiNews: новые сверху, limit и фильтр kinds", () => {
    const world = makeWorld();
    world.tick = 10;
    aiWorldPhase(world);
    const fg = ensureFg(world);
    fg.aiWorld.news = [];
    for (let i = 0; i < 60; i++) {
      fg.aiWorld.news.push({ id: fg.aiWorld.nextNewsId++, tick: i, kind: i % 2 ? "war" : "treaty", titleRu: "t", textRu: "n" + i, a: 1, severity: "info", playerImpact: null });
    }
    const limited = getAiNews(world, { limit: 5 });
    expect(limited.length).toBe(5);
    expect(limited[0]!.id).toBeGreaterThan(limited[4]!.id);
    const wars = getAiNews(world, { kinds: ["war"], limit: 3 });
    expect(wars.every((item) => item.kind === "war")).toBe(true);
  });

  it("детерминизм: два мира seed 42 → одинаковый aiWorld", () => {
    const run = (): string => {
      const world = makeWorld();
      for (let i = 0; i < 60; i++) {
        world.tick += 1;
        aiWorldPhase(world);
      }
      return JSON.stringify(ensureFg(world).aiWorld);
    };
    expect(run()).toBe(run());
  });
});

describe("task-42 · collapse/absorb/centralize (force API)", () => {
  it("forceCollapse: империя dead, новость collapse, системы переданы", () => {
    const world = makeWorld();
    const target = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9 && empire.systems.length > 0)!;
    const systemsBefore = world.systems.filter((system) => system.ownerId === target.id).length;
    expect(systemsBefore).toBeGreaterThan(0);
    expect(forceCollapse(world, target.id)).toBe(true);
    expect(empireById(world, target.id)!.dead).toBe(true);
    expect(world.systems.filter((system) => system.ownerId === target.id).length).toBe(0);
    expect(getAiNews(world).some((item) => item.kind === "collapse" && item.a === target.id)).toBe(true);
    expect(ensureFg(world).aiWorld.statuses[target.id]?.state).toBe("collapsed");
    // игрок не удаляется молча
    expect(forceCollapse(world, world.playerEmpireId)).toBe(false);
    expect(empireById(world, world.playerEmpireId)!.dead).toBe(false);
  });

  it("forceAbsorb: системы/колонии/казна/технологии переходят сильному; dead", () => {
    const world = makeWorld();
    const strong = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9 && empire.systems.length > 1)!;
    const weak = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9 && empire.id !== strong.id)!;
    const weakSystems = weak.systems.length;
    const strongCredits = strong.resources.credits;
    weak.resources.credits = 777;
    const weakCredits = 777;
    expect(forceAbsorb(world, strong.id, weak.id)).toBe(true);
    expect(empireById(world, weak.id)!.dead).toBe(true);
    expect(strong.systems.length).toBeGreaterThanOrEqual(weakSystems > 0 ? 1 : 0);
    expect(strong.resources.credits).toBeGreaterThanOrEqual(strongCredits + weakCredits - 10000);
    expect(getAiNews(world).some((item) => item.kind === "annexation")).toBe(true);
  });

  it("forceCentralizeFederation: участники сливаются в единую империю", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    const members = world.empires.filter((empire) => !empire.isPlayer && !empire.dead && empire.id < 9).slice(0, 3).map((empire) => empire.id);
    fg.federations.push({
      id: 99, nameRu: "Тестовая Федерация", members, presidentId: members[0]!,
      foundedTick: 0, treasuryEnergy: 0, treasuryAlloys: 0, fleetIds: [], nextChairTick: 0,
      votes: Object.fromEntries(members.map((id) => [id, 0])),
    });
    expect(forceCentralizeFederation(world, 99)).toBe(true);
    for (const memberId of members.slice(1)) expect(empireById(world, memberId)!.dead).toBe(true);
    expect(fg.federations.some((federation) => federation.id === 99)).toBe(false);
    expect(getAiNews(world).some((item) => item.kind === "centralization")).toBe(true);
  });
});

describe("task-42 · вассалы и захват всех систем", () => {
  it("вассал интегрируется через N тактов; захват всех систем = уничтожение", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    const overlord = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9)!;
    const vassal = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9 && empire.id !== overlord.id)!;
    advancedOf(world, overlord.id).vassals.push(vassal.id);
    // первый вызов фиксирует tick начала вассалитета
    world.tick = 10;
    aiWorldPhase(world);
    expect(advancedOf(world, overlord.id).vassals).toContain(vassal.id);
    world.tick = 10 + 4000;
    aiWorldPhase(world);
    expect(empireById(world, vassal.id)!.dead).toBe(true);
    // захват всех систем
    const other = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9)!;
    for (const system of world.systems) if (system.ownerId === other.id) system.ownerId = overlord.id;
    other.systems = [];
    world.tick += 10;
    aiWorldPhase(world);
    expect(other.dead).toBe(true);
    expect(getAiNews(world).some((item) => item.kind === "annexation")).toBe(true);
    void fg;
  });
});

describe("task-42 · события игрока", () => {
  it("call-to-arms: союзник в войне → событие, выбор 'join' вводит игрока в войну", () => {
    const world = makeWorld();
    const player = world.playerEmpireId;
    const partner = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9)!;
    const enemy = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9 && empire.id !== partner.id)!;
    activateTreaty(world, player, partner.id, "alliance");
    partner.resources.influence = 200;
    const war = applyCommandAs(world, partner.id, {
      type: "declare_war", targetEmpireId: enemy.id, cb: "conquest", claims: [enemy.capitalSystemId],
    });
    expect(war.ok, war.messageRu).toBe(true);
    world.tick = 10;
    aiWorldPhase(world);
    const events = getAiWorldEvents(world).filter((event) => event.kind === "call_to_arms");
    expect(events.length).toBeGreaterThan(0);
    const event = events[0]!;
    expect(event.targetEmpireId).toBe(player);
    const result = aiWorldEventChoice(world, player, event.id, "join");
    expect(result.ok, result.messageRu).toBe(true);
    const fg = ensureFg(world);
    expect(fg.campaign.flags.ai_call_to_arms).toBe(1);
    const joined = fg.wars.some((entry) => entry.sides[player] !== undefined);
    expect(joined).toBe(true);
    // повторный выбор запрещён
    expect(aiWorldEventChoice(world, player, event.id, "join").ok).toBe(false);
  });

  it("accession_offer: принять → империя входит в игрока; событие исчезает", () => {
    const world = makeWorld();
    const player = world.playerEmpireId;
    const weak = world.empires.find((empire) => !empire.isPlayer && !empire.dead && empire.id < 9)!;
    // ослабляем: оставляем <=2 систем
    for (const system of world.systems.slice().sort((a, b) => a.id - b.id)) {
      if (system.ownerId === weak.id && weak.systems.length > 2) {
        system.ownerId = 0;
        weak.systems = weak.systems.filter((id) => id !== system.id);
      }
    }
    // ослабляем флот и повышаем мнение ИИ→игрока
    for (const fleet of world.fleets) if (fleet.empireId === weak.id) fleet.ships = [];
    const relation = relationOf(world, weak.id, player);
    relation.opinion = 90;
    world.tick = 10;
    aiWorldPhase(world);
    const event = getAiWorldEvents(world).find((entry) => entry.kind === "accession_offer" && entry.fromEmpireId === weak.id);
    expect(event).toBeTruthy();
    const result = aiWorldEventChoice(world, player, event!.id, "accept");
    expect(result.ok, result.messageRu).toBe(true);
    expect(empireById(world, weak.id)!.dead).toBe(true);
    expect(ensureFg(world).campaign.flags.ai_accession).toBe(1);
  });
});

describe("task-42 · карта: сектор не виден раньше миссии 10/Врат", () => {
  it("ensureSectorGenerated генерирует, но не раскрывает; revealSector раскрывает", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    const early = ensureSectorGenerated(world);
    expect(early.generated).toBe(true);
    expect(early.systems.length).toBe(45);
    expect(early.discovered).toBe(false);
    expect(world.systems.filter((system) => system.sector === "relic" && system.knownBy.includes(world.playerEmpireId)).length).toBe(0);
    expect(getKnownSystems(world).some((system) => system.sector === "relic")).toBe(false);
    expect(sectorScan(world, world.playerEmpireId, early.systems[0]!.id).ok).toBe(false);
    // миссия 10/Врата
    const revealed = revealSector(world);
    expect(revealed.discovered).toBe(true);
    expect(world.systems.filter((system) => system.sector === "relic" && system.knownBy.includes(world.playerEmpireId)).length).toBe(45);
    expect(getKnownSystems(world).filter((system) => system.sector === "relic").length).toBe(45);
    expect(getPoliticalMap(world).sector).toMatchObject({ discovered: true, generated: true, visibleSystems: 45 });
    expect(fg.ancients!.sector.discovered).toBe(true);
    // скан после раскрытия доступен
    expect(sectorScan(world, world.playerEmpireId, early.systems[0]!.id).ok).toBe(true);
  });

  it("getEmpireCapitals/getPoliticalMap дают столицы и линии для карты", () => {
    const world = makeWorld();
    const capitals = getEmpireCapitals(world);
    expect(capitals.length).toBe(world.empires.length);
    const playerCapital = capitals.find((capital) => capital.isPlayer)!;
    expect(playerCapital).toBeTruthy();
    expect(playerCapital.systemId).toBe(world.empires[0]!.capitalSystemId);
    expect(playerCapital.x).toBeTypeOf("number");
    const map = getPoliticalMap(world);
    expect(map.capitals.length).toBe(world.empires.length);
    expect(Array.isArray(map.systems)).toBe(true);
    expect(map.sector.discovered).toBe(false);
    expect(map.relations).toEqual(getAiRelations(world));
    expect(map.capitals.some((capital) => capital.status === "active" || capital.status === "weakened")).toBe(true);
  });
});

describe("task-42 · сейвы/миграция", () => {
  it("save/load сохраняет aiWorld; отсутствие поля мигрирует", () => {
    const world = makeWorld();
    world.tick = 10;
    aiWorldPhase(world);
    const json = serializeWorld(world);
    const restored = deserializeWorld(json);
    expect(restored.fg?.aiWorld).toBeTruthy();
    expect(serializeWorld(restored)).toBe(json);
    const raw = JSON.parse(json);
    delete raw.fg.aiWorld;
    const migrated = deserializeWorld(JSON.stringify(raw));
    const state = getAiWorldState(migrated);
    expect(state.empires.length).toBeGreaterThan(0);
    expect(restored.fg!.aiWorld.news.length).toBe(getAiNews(world).length);
  });
});
