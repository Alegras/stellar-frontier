import { describe, expect, it } from "vitest";
import { advancedOf, ensureFg } from "../src/fullgame";
import { diplomacyPhase, treatyActive } from "../src/diplomacy";
import {
  acceptFederation, CHAIR_PERIOD, CONTRIBUTION_PERIOD, CONTRIBUTION_RATE, federationFleetPower,
  federationOf, federationPhase, FEDERATION_COST, FEDERATION_MAX_MEMBERS, inviteFederation,
  leaveFederation, pendingFederationInvites,
} from "../src/federation";
import { addFleet, firstSystemOf, give, pushOpinion, testWorld } from "./diplo-helpers";

function readyFounder(world: ReturnType<typeof testWorld>, founderId = 2, targetId = 1): void {
  give(world, founderId, { influence: 300, unity: 800 });
  pushOpinion(world, founderId, targetId, 60);
  pushOpinion(world, targetId, founderId, 60);
  diplomacyPhase(world);
}

describe("федерация: создание и состав (GDD §12.3)", () => {
  it("лидер создаёт федерацию (100 влияния + 500 единства) и приглашает", () => {
    const world = testWorld();
    readyFounder(world, 2, 1);
    const founder = world.empires.find((e) => e.id === 2)!;
    const beforeInfluence = founder.resources.influence;
    const beforeUnity = founder.resources.unity;
    const result = inviteFederation(world, 2, 1);
    expect(result.ok, result.messageRu).toBe(true);
    expect(founder.resources.influence).toBe(beforeInfluence - FEDERATION_COST.influence);
    expect(founder.resources.unity).toBe(beforeUnity - FEDERATION_COST.unity);
    const federation = federationOf(world, 2)!;
    expect(federation).toBeDefined();
    expect(federation.presidentId).toBe(2);
    expect(federation.members).toEqual([2]);
    expect(pendingFederationInvites(world, 1)).toContain(2);
  });

  it("вступление: договор федерации активен у всех участников", () => {
    const world = testWorld();
    readyFounder(world, 2, 1);
    expect(inviteFederation(world, 2, 1).ok).toBe(true);
    give(world, 1, { influence: 200, unity: 600 });
    const accepted = acceptFederation(world, 1, 2);
    expect(accepted.ok, accepted.messageRu).toBe(true);
    const federation = federationOf(world, 1)!;
    expect(federation.members).toEqual([1, 2]);
    expect(treatyActive(world, 1, 2, "federation")).toBe(true);
    expect(pendingFederationInvites(world, 1).length).toBe(0);
  });

  it("2–5 участников: больше пяти не принять", () => {
    const world = testWorld();
    const federation = {
      id: 1,
      nameRu: "Тестовая федерация",
      members: [1, 2, 3, 4, 5],
      presidentId: 1,
      foundedTick: 0,
      treasuryEnergy: 0,
      treasuryAlloys: 0,
      fleetIds: [],
      nextChairTick: CHAIR_PERIOD,
      votes: {},
    };
    ensureFg(world).federations.push(federation);
    ensureFg(world).nextFederationId = 2;
    give(world, 6, { influence: 300, unity: 800 });
    pushOpinion(world, 1, 6, 80);
    diplomacyPhase(world);
    expect(FEDERATION_MAX_MEMBERS).toBe(5);
    expect(inviteFederation(world, 1, 6).ok).toBe(false);
    expect(federation.members.length).toBe(5);
  });

  it("нельзя вступить без приглашения или уже состоя в федерации", () => {
    const world = testWorld();
    give(world, 1, { influence: 200, unity: 600 });
    expect(acceptFederation(world, 1, 2).ok).toBe(false);
    readyFounder(world, 2, 1);
    expect(inviteFederation(world, 2, 1).ok).toBe(true);
    expect(acceptFederation(world, 1, 2).ok).toBe(true);
    expect(acceptFederation(world, 1, 2).ok).toBe(false);
  });
});

describe("федерация: фаза (GDD §12.3)", () => {
  function makeFederation(world: ReturnType<typeof testWorld>, members: number[]): number {
    const fg = ensureFg(world);
    const id = fg.nextFederationId++;
    fg.federations.push({
      id,
      nameRu: "Федерация «Тест»",
      members: members.slice(),
      presidentId: members[0],
      foundedTick: world.tick,
      treasuryEnergy: 0,
      treasuryAlloys: 0,
      fleetIds: [],
      nextChairTick: world.tick + CHAIR_PERIOD,
      votes: {},
    });
    return id;
  }

  it("председатель меняется каждые 300 тактов (сильнейший по FP)", () => {
    const world = testWorld();
    makeFederation(world, [1, 2]);
    addFleet(world, 2, firstSystemOf(world, 2), 5);
    world.tick = CHAIR_PERIOD;
    federationPhase(world);
    const federation = federationOf(world, 1)!;
    expect(federation.presidentId).toBe(2);
    expect(federation.nextChairTick).toBe(world.tick + CHAIR_PERIOD);
  });

  it("взносы 5% энергии и сплавов каждые 100 тактов", () => {
    const world = testWorld();
    const id = makeFederation(world, [1, 2]);
    const other = world.empires.find((e) => e.id === 1)!;
    other.resources.energy = 0;
    other.resources.alloys = 0;
    const member = world.empires.find((e) => e.id === 2)!;
    member.resources.energy = 1000;
    member.resources.alloys = 400;
    world.tick = CONTRIBUTION_PERIOD;
    federationPhase(world);
    const federation = federationOf(world, 1)!;
    expect(federation.treasuryEnergy).toBe(Math.floor((1000 * CONTRIBUTION_RATE) / 100));
    expect(federation.treasuryAlloys).toBe(Math.floor((400 * CONTRIBUTION_RATE) / 100));
    expect(member.resources.energy).toBeLessThan(1000);
    void id;
  });

  it("общий флот: 20% флотов участников, лимит 300 FP", () => {
    const world = testWorld();
    makeFederation(world, [1, 2]);
    const federation = federationOf(world, 1)!;
    const expected = Math.min(300, Math.floor((fpOf(world, 1) + fpOf(world, 2)) * 0.2));
    expect(federationFleetPower(world, federation)).toBe(expected);
  });

  it("распад: меньше 2 участников", () => {
    const world = testWorld();
    makeFederation(world, [1, 2]);
    expect(leaveFederation(world, 2).ok).toBe(true);
    federationPhase(world);
    expect(ensureFg(world).federations.length).toBe(0);
  });

  it("выход из федерации из 3 участников: договор снимается", () => {
    const world = testWorld();
    makeFederation(world, [1, 2, 3]);
    const result = leaveFederation(world, 3);
    expect(result.ok).toBe(true);
    expect(federationOf(world, 3)).toBeUndefined();
    expect(federationOf(world, 1)!.members).toEqual([1, 2]);
    expect(treatyActive(world, 1, 3, "federation")).toBe(false);
  });

  it("выход при мнении ниже −50", () => {
    const world = testWorld();
    makeFederation(world, [1, 2]);
    pushOpinion(world, 2, 1, -200);
    diplomacyPhase(world);
    federationPhase(world);
    expect(ensureFg(world).federations.length).toBe(0);
  });
});

function fpOf(world: ReturnType<typeof testWorld>, empireId: number): number {
  let fp = 0;
  for (const fleet of world.fleets) {
    if (fleet.empireId !== empireId) continue;
    for (const ship of fleet.ships) fp += ship.fleetPower;
  }
  return fp;
}

describe("федерация: бухгалтерия", () => {
  it("взнос списывается только у живых участников", () => {
    const world = testWorld();
    const fg = ensureFg(world);
    fg.federations.push({
      id: 7, nameRu: "Федерация «Смерть»", members: [1, 2], presidentId: 1, foundedTick: 0,
      treasuryEnergy: 0, treasuryAlloys: 0, fleetIds: [], nextChairTick: 0, votes: {},
    });
    const dead = world.empires.find((e) => e.id === 2)!;
    dead.dead = true;
    world.tick = CONTRIBUTION_PERIOD;
    federationPhase(world);
    expect(fg.federations.length).toBe(0);
    void advancedOf;
  });
});
