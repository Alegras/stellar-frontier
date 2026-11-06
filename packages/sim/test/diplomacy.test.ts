import { describe, expect, it } from "vitest";
import { advancedOf, ensureFg, relationOf } from "../src/fullgame";
import {
  activeClaim, activateTreaty, addRecentAction, aiAcceptChance, attitudeFor, breakTreaty, claimSystem,
  diplomacyPhase, ethicsAffinity, NAP_TICKS, offerTreaty, opinionBreakdown, opinionOf, pendingOffersFor,
  respondTreaty, RESEARCH_PACT_SCIENCE_BONUS, TRADE_PACT_CREDITS_BONUS, treatyActive,
} from "../src/diplomacy";
import { addFleet, give, firstSystemOf, pushOpinion, testWorld } from "./diplo-helpers";

describe("дипломатия: мнение (GDD §12.1)", () => {
  it("attitudeFor: границы отношений", () => {
    expect(attitudeFor(100)).toBe("ally");
    expect(attitudeFor(75)).toBe("ally");
    expect(attitudeFor(74)).toBe("friendly");
    expect(attitudeFor(40)).toBe("friendly");
    expect(attitudeFor(39)).toBe("neutral");
    expect(attitudeFor(10)).toBe("neutral");
    expect(attitudeFor(9)).toBe("cold");
    expect(attitudeFor(-10)).toBe("cold");
    expect(attitudeFor(-11)).toBe("hostile");
    expect(attitudeFor(-40)).toBe("hostile");
    expect(attitudeFor(-41)).toBe("rival");
    expect(attitudeFor(-100)).toBe("rival");
  });

  it("стартовое мнение строится из этик/границ/силы (формула, не константа)", () => {
    const world = testWorld();
    advancedOf(world, 1).ethics = ["materialist", "collectivist"];
    advancedOf(world, 2).ethics = ["materialist", "collectivist"];
    diplomacyPhase(world);
    const op = opinionOf(world, 1, 2);
    expect(Number.isFinite(op)).toBe(true);
    expect(op).toBeGreaterThanOrEqual(-100);
    expect(op).toBeLessThanOrEqual(100);
    // общие этики → +10 за каждую
    expect(ethicsAffinity(world, 1, 2)).toBe(20);
    const labels = opinionBreakdown(world, 1, 2).map((line) => line.label);
    expect(labels.some((label) => label.includes("этик"))).toBe(true);
    // зеркало в старом Relation синхронизировано фазой
    const empire = world.empires.find((e) => e.id === 1)!;
    expect(empire.relations[2].opinion).toBe(op);
  });

  it("совпадение этик +10, конфликт −15", () => {
    const world = testWorld();
    advancedOf(world, 1).ethics = ["materialist", "collectivist"];
    // spiritualist — та же ось mind_faith (конфликт), collectivist совпал
    advancedOf(world, 2).ethics = ["spiritualist", "collectivist"];
    expect(ethicsAffinity(world, 1, 2)).toBe(-5);
    advancedOf(world, 2).ethics = ["materialist", "collectivist"];
    expect(ethicsAffinity(world, 1, 2)).toBe(20);
    // враждебная ось war_peace тоже конфликт
    advancedOf(world, 1).ethics = ["militarist"];
    advancedOf(world, 2).ethics = ["pacifist"];
    expect(ethicsAffinity(world, 1, 2)).toBe(-15);
  });

  it("договоры добавляют мнение (NAP +10, торговля +15, исследования +15, союз +30)", () => {
    const world = testWorld();
    const base = opinionOf(world, 1, 2);
    activateTreaty(world, 1, 2, "nap");
    expect(opinionOf(world, 1, 2)).toBeGreaterThanOrEqual(base + 10);
    activateTreaty(world, 1, 2, "trade");
    activateTreaty(world, 1, 2, "research");
    const withThree = opinionOf(world, 1, 2);
    expect(withThree).toBeGreaterThanOrEqual(base + 10 + 15 + 15);
    activateTreaty(world, 1, 2, "alliance");
    expect(opinionOf(world, 1, 2)).toBeGreaterThanOrEqual(withThree + 30);
  });

  it("взаимные притязания −10, clamp −100..100", () => {
    const world = testWorld();
    const before = opinionOf(world, 1, 2);
    const target = firstSystemOf(world, 2);
    give(world, 1, { influence: 100 });
    expect(claimSystem(world, 1, target).ok).toBe(true);
    expect(opinionOf(world, 1, 2)).toBeLessThanOrEqual(before - 10);
    pushOpinion(world, 1, 2, 500);
    const rel = relationOf(world, 1, 2);
    // после пересчёта мнение не превышает 100
    activationRefresh(world);
    expect(rel.opinion).toBeLessThanOrEqual(100);
    pushOpinion(world, 1, 2, -1000);
    activationRefresh(world);
    expect(rel.opinion).toBeGreaterThanOrEqual(-100);
  });

  it("недавние действия затухают на 1/такт", () => {
    const world = testWorld();
    addRecentAction(world, 1, 2, -40);
    const after = opinionOf(world, 1, 2);
    diplomacyPhase(world);
    expect(opinionOf(world, 1, 2)).toBe(after + 1);
  });
});

function activationRefresh(world: ReturnType<typeof testWorld>): void {
  diplomacyPhase(world);
}

describe("дипломатия: договоры (GDD §12.2)", () => {
  it("предложение игроку висит и истекает; принятие активирует NAP на 200 тактов", () => {
    const world = testWorld();
    const result = offerTreaty(world, 2, 1, "nap");
    expect(result.ok).toBe(true);
    const offers = pendingOffersFor(world, 1);
    expect(offers.length).toBe(1);
    expect(offers[0].treaty).toBe("nap");
    expect(advancedOf(world, 1).pendingOffers.length).toBe(1);
    const accepted = respondTreaty(world, 1, offers[0].id, true);
    expect(accepted.ok, accepted.messageRu).toBe(true);
    expect(treatyActive(world, 1, 2, "nap")).toBe(true);
    expect(relationOf(world, 1, 2).treaties.nap.expiresTick).toBe(world.tick + NAP_TICKS);
    expect(pendingOffersFor(world, 1).length).toBe(0);
  });

  it("предложение истекает и удаляется фазой", () => {
    const world = testWorld();
    give(world, 2, { influence: 50, unity: 50 });
    const result = offerTreaty(world, 2, 1, "nap");
    expect(result.ok).toBe(true);
    const offer = ensureFg(world).offers[0];
    world.tick = offer.expiresTick;
    diplomacyPhase(world);
    expect(ensureFg(world).offers.length).toBe(0);
    expect(pendingOffersFor(world, 1).length).toBe(0);
  });

  it("цена в влиянии: без влияния договор не предлагается", () => {
    const world = testWorld();
    const empire2 = world.empires.find((e) => e.id === 2)!;
    empire2.resources.influence = 0;
    const result = offerTreaty(world, 2, 1, "nap");
    expect(result.ok).toBe(false);
    // цель — игрок, поэтому предложение не создаётся
    expect(ensureFg(world).offers.length).toBe(0);
  });

  it("оборонительный союз требует единства; изгой платит +50%", () => {
    const world = testWorld();
    give(world, 2, { influence: 100, unity: 0 });
    addRecentAction(world, 2, 1, 60);
    diplomacyPhase(world);
    const noUnity = offerTreaty(world, 2, 1, "defensive");
    expect(noUnity.ok).toBe(false);
    // изгой (3+ санкций): NAP стоит 15 вместо 10
    world.flags["sanctions:count:2"] = 3;
    const empire2 = world.empires.find((e) => e.id === 2)!;
    empire2.resources.influence = 14;
    expect(offerTreaty(world, 2, 1, "nap").ok).toBe(false);
    empire2.resources.influence = 15;
    expect(offerTreaty(world, 2, 1, "nap").ok).toBe(true);
  });

  it("отклонение предложения снимает его и не активирует договор", () => {
    const world = testWorld();
    offerTreaty(world, 2, 1, "trade");
    const offer = ensureFg(world).offers[0];
    expect(respondTreaty(world, 1, offer.id, false).ok).toBe(true);
    expect(treatyActive(world, 1, 2, "trade")).toBe(false);
    expect(ensureFg(world).offers.length).toBe(0);
  });

  it("разрыв договора: штраф мнения по таблице §12.2", () => {
    const world = testWorld();
    activateTreaty(world, 1, 2, "alliance");
    const withAlliance = opinionOf(world, 1, 2);
    breakTreaty(world, 1, 2, "alliance");
    expect(treatyActive(world, 1, 2, "alliance")).toBe(false);
    expect(opinionOf(world, 1, 2)).toBeLessThanOrEqual(withAlliance - 80);
  });

  it("NAP истекает через 200 тактов", () => {
    const world = testWorld();
    activateTreaty(world, 1, 2, "nap");
    world.tick = NAP_TICKS;
    diplomacyPhase(world);
    expect(treatyActive(world, 1, 2, "nap")).toBe(false);
    expect(relationOf(world, 1, 2).treaties.nap.active).toBe(false);
  });
});

describe("дипломатия: эффективность договоров и ИИ", () => {
  it("пакты дают +5% маржи и +15% науки (GDD §12.2)", () => {
    const world = testWorld();
    activateTreaty(world, 1, 2, "trade");
    activateTreaty(world, 1, 2, "research");
    const empire = world.empires.find((e) => e.id === 1)!;
    empire.incomeLastTick.credits = 1000;
    empire.resources.credits = 5000;
    empire.scienceLastTick.physics = 100;
    empire.science.physics = 0;
    diplomacyPhase(world);
    expect(empire.resources.credits).toBe(5000 + Math.floor(1000 * TRADE_PACT_CREDITS_BONUS));
    expect(empire.science.physics).toBe(Math.floor(100 * RESEARCH_PACT_SCIENCE_BONUS));
  });

  it("шанс согласия ИИ растёт с мнением и падает с превосходством (GDD §12.2)", () => {
    const world = testWorld();
    const base = aiAcceptChance(world, 1, 2, "alliance");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThanOrEqual(0.95);
    addRecentAction(world, 1, 2, 60);
    const friendly = aiAcceptChance(world, 1, 2, "alliance");
    expect(friendly).toBeGreaterThan(base);
    // военное превосходство предлагающего снижает шанс (страх перед сильным)
    addFleet(world, 1, firstSystemOf(world, 1), 12);
    const withPower = aiAcceptChance(world, 1, 2, "alliance");
    expect(withPower).toBeLessThanOrEqual(friendly);
  });
});

describe("дипломатия: притязания (GDD §12.6)", () => {
  it("притязание стоит 25 влияния и сгорает через 120 тактов", () => {
    const world = testWorld();
    const target = firstSystemOf(world, 2);
    give(world, 1, { influence: 100 });
    const empire = world.empires.find((e) => e.id === 1)!;
    const before = empire.resources.influence;
    const result = claimSystem(world, 1, target);
    expect(result.ok, result.messageRu).toBe(true);
    expect(empire.resources.influence).toBe(before - 25);
    expect(advancedOf(world, 1).claims).toContain(target);
    expect(activeClaim(world, 1, target)).toBe(true);
    // повторное притязание запрещено
    expect(claimSystem(world, 1, target).ok).toBe(false);
    world.tick = 121;
    diplomacyPhase(world);
    expect(activeClaim(world, 1, target)).toBe(false);
    expect(advancedOf(world, 1).claims).not.toContain(target);
  });

  it("нельзя притязать на свою систему и без влияния", () => {
    const world = testWorld();
    const own = firstSystemOf(world, 1);
    expect(claimSystem(world, 1, own).ok).toBe(false);
    const empire = world.empires.find((e) => e.id === 1)!;
    empire.resources.influence = 5;
    expect(claimSystem(world, 1, firstSystemOf(world, 2)).ok).toBe(false);
  });
});

describe("дипломатия: вассалитет и дань (GDD §12.2)", () => {
  it("15% дохода вассала уходит сюзерену", () => {
    const world = testWorld();
    const vassal = world.empires.find((e) => e.id === 2)!;
    const overlord = world.empires.find((e) => e.id === 1)!;
    advancedOf(world, 1).vassals = [2];
    vassal.resources.energy = 1000;
    vassal.incomeLastTick.energy = 100;
    const before = overlord.resources.energy;
    diplomacyPhase(world);
    expect(overlord.resources.energy).toBeGreaterThan(before);
    expect(vassal.resources.energy).toBeLessThan(1000);
  });
});
