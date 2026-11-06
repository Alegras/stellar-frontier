/**
 * Тесты кампании (M9): акты, миссии, ветки, концовки, лок, идемпотентность.
 * docs/11_campaign_and_free_flight.md §2–§9.
 */
import { describe, expect, it } from "vitest";
import type { CampaignMissionDef } from "@sf/data";
import {
  ACT_TICK_BOUNDS, CAMPAIGN_END_TICK, MISSION_RETRY_TICKS, STORY_REMINDER_TICKS,
  actForTick, activeStoryLocks, availableCampaignMissions, campaignEndings, campaignPhase,
  checkEndings, chooseBranch, isCampaignLocked, onCampaignBattle, onCampaignScan,
  skipCampaignMission, startCampaignMission,
} from "../src/campaign";
import { serializeWorld } from "../src/save";
import { makeEnding, makeMission, makeWorld, playerId, fgOf } from "./campaignFixtures";
import type { World } from "../src/types";

/** Капитальная система игрока: там стоит стартовый флот. */
function capitalSystemId(world: World): number {
  const empire = world.empires.find((e) => e.isPlayer);
  return empire ? empire.capitalSystemId : 0;
}

function catalogOf(missions: CampaignMissionDef[]) {
  return { missions };
}

function arrivalMission(id: string, act = 0, over: Partial<CampaignMissionDef> = {}): CampaignMissionDef {
  return makeMission({
    id,
    act,
    objectives: [{ id: "arrive", type: "reach_system", targetKind: "capital" }],
    rewards: { credits: 1000 },
    ...over,
  });
}

describe("кампания: акты по тактам (док 11 §2)", () => {
  it("actForTick: границы пролога и 5 актов", () => {
    expect(actForTick(0)).toBe(0);
    expect(actForTick(299)).toBe(0);
    expect(actForTick(300)).toBe(1);
    expect(actForTick(1199)).toBe(1);
    expect(actForTick(1200)).toBe(2);
    expect(actForTick(2600)).toBe(3);
    expect(actForTick(4400)).toBe(4);
    expect(actForTick(6200)).toBe(5);
    expect(actForTick(CAMPAIGN_END_TICK + 5000)).toBe(5);
    // акты идут без дыр и перекрытий
    for (let i = 1; i < ACT_TICK_BOUNDS.length; i++) {
      expect(ACT_TICK_BOUNDS[i]!.startTick).toBe(ACT_TICK_BOUNDS[i - 1]!.endTick);
    }
  });

  it("campaignPhase двигает акт монотонно и пишет в журнал", () => {
    const world = makeWorld();
    const fg = fgOf(world);
    expect(fg.campaign.act).toBe(0);
    world.tick = 300;
    campaignPhase(world, catalogOf([]));
    expect(fg.campaign.act).toBe(1);
    expect(fg.journal.some((entry) => entry.kind === "story" && entry.textRu.includes("Акт I"))).toBe(true);
    // назад акт не откатывается
    world.tick = 120;
    campaignPhase(world, catalogOf([]));
    expect(fg.campaign.act).toBe(1);
  });

  it("финал: на 7200 такте ставится флаг finale", () => {
    const world = makeWorld();
    const fg = fgOf(world);
    world.tick = CAMPAIGN_END_TICK;
    campaignPhase(world, catalogOf([]));
    expect(fg.campaign.flags["finale"]).toBe(1);
    expect(fg.journal.some((entry) => entry.kind === "story" && entry.textRu.includes("Финал"))).toBe(true);
  });
});

describe("кампания: миссии (док 11 §4)", () => {
  it("доступность: акт, пререквизиты, ветка", () => {
    const world = makeWorld();
    const missions = [
      arrivalMission("m_act0"),
      arrivalMission("m_act1", 1, { prerequisites: ["m_act0"] }),
      makeMission({
        id: "m_branch",
        act: 0,
        branchRequired: "sovereignty",
        objectives: [{ id: "arrive", type: "reach_system", targetKind: "capital" }],
      }),
    ];
    campaignPhase(world, catalogOf(missions));
    const fg = fgOf(world);
    expect(fg.campaign.missions["m_act0"]!.status).toBe("available");
    expect(fg.campaign.missions["m_act1"]!.status).toBe("locked");
    expect(fg.campaign.missions["m_branch"]!.status).toBe("locked");

    // выполняем m_act0 → открывается m_act1 (после смены акта)
    expect(startCampaignMission(world, playerId(world), "m_act0").ok).toBe(true);
    campaignPhase(world, catalogOf(missions));
    expect(fg.campaign.missions["m_act0"]!.status).toBe("completed");
    world.tick = 400;
    campaignPhase(world, catalogOf(missions));
    expect(fg.campaign.missions["m_act1"]!.status).toBe("available");
    // ветка ещё не выбрана — миссия ветки остаётся закрытой
    expect(fg.campaign.missions["m_branch"]!.status).toBe("locked");
  });

  it("startCampaignMission: валидации, статусы, сюжетный лок", () => {
    const world = makeWorld();
    const missions = [arrivalMission("m1"), arrivalMission("m2")];
    campaignPhase(world, catalogOf(missions));
    const fg = fgOf(world);
    expect(startCampaignMission(world, 999, "m1").ok).toBe(false); // не игрок
    expect(startCampaignMission(world, playerId(world), "nope").ok).toBe(false); // нет миссии
    expect(startCampaignMission(world, playerId(world), "m1").ok).toBe(true);
    expect(fg.campaign.missions["m1"]!.status).toBe("active");
    expect(fg.campaign.activeMissionId).toBe("m1");
    // пролог → сюжетный лок (≤3 и ≤10 минут)
    expect(isCampaignLocked(world)).toBe(true);
    expect(activeStoryLocks(world).length).toBeLessThanOrEqual(3);
    expect(activeStoryLocks(world)[0]!.untilTick).toBeGreaterThan(world.tick);
    // повторный старт и вторая миссия одновременно — нельзя
    expect(startCampaignMission(world, playerId(world), "m1").ok).toBe(false);
    expect(startCampaignMission(world, playerId(world), "m2").ok).toBe(false);
  });

  it("награда выдаётся ровно один раз, статус completed", () => {
    const world = makeWorld();
    const missions = [arrivalMission("m1")];
    campaignPhase(world, catalogOf(missions));
    const empire = world.empires.find((e) => e.id === playerId(world))!;
    const before = empire.resources.credits;
    expect(startCampaignMission(world, playerId(world), "m1").ok).toBe(true);
    campaignPhase(world, catalogOf(missions)); // флот в столице → цель выполнена
    const fg = fgOf(world);
    expect(fg.campaign.missions["m1"]!.status).toBe("completed");
    expect(empire.resources.credits).toBe(before + 1000);
    expect(fg.campaign.missions["m1"]!.flags["rewarded"]).toBe(1);
    expect(fg.campaign.activeMissionId).toBe(null);
    expect(isCampaignLocked(world)).toBe(false);
    // повторные фазы/старты не выдают награду снова
    campaignPhase(world, catalogOf(missions));
    expect(startCampaignMission(world, playerId(world), "m1").ok).toBe(false);
    expect(empire.resources.credits).toBe(before + 1000);
  });

  it("хук сканирования двигает цели и завершает миссию", () => {
    const world = makeWorld();
    const missions = [
      makeMission({
        id: "m_scan",
        objectives: [{ id: "scan", type: "scan", targetKind: "capital", count: 2 }],
        rewards: { credits: 300, alloys: 10 },
      }),
    ];
    campaignPhase(world, catalogOf(missions));
    expect(startCampaignMission(world, playerId(world), "m_scan").ok).toBe(true);
    const fg = fgOf(world);
    const mission = fg.campaign.missions["m_scan"]!;
    onCampaignScan(world, playerId(world), capitalSystemId(world));
    expect(mission.objectives[0]!.progress).toBe(1);
    expect(mission.status).toBe("active");
    onCampaignScan(world, playerId(world), capitalSystemId(world));
    expect(mission.status).toBe("completed");
    expect(mission.objectives[0]!.done).toBe(true);
  });

  it("боевой хук учитывает только победы", () => {
    const world = makeWorld();
    const missions = [makeMission({ id: "m_combat", objectives: [{ id: "win", type: "combat", count: 1 }] })];
    campaignPhase(world, catalogOf(missions));
    expect(startCampaignMission(world, playerId(world), "m_combat").ok).toBe(true);
    const mission = fgOf(world).campaign.missions["m_combat"]!;
    onCampaignBattle(world, playerId(world), capitalSystemId(world), false);
    expect(mission.objectives[0]!.progress).toBe(0);
    onCampaignBattle(world, playerId(world), capitalSystemId(world), true);
    expect(mission.status).toBe("completed");
  });

  it("провал по дедлайну — мягкий: повтор доступен через retry-окно", () => {
    const world = makeWorld();
    const missions = [
      makeMission({
        id: "m_timed",
        objectives: [{ id: "collect", type: "collect", count: 3, timeLimitTicks: 20 }],
        rewards: { credits: 500 },
      }),
    ];
    campaignPhase(world, catalogOf(missions));
    expect(startCampaignMission(world, playerId(world), "m_timed").ok).toBe(true);
    const fg = fgOf(world);
    world.tick = 30;
    campaignPhase(world, catalogOf(missions));
    const mission = fg.campaign.missions["m_timed"]!;
    expect(mission.status).toBe("failed");
    expect(fg.campaign.activeMissionId).toBe(null);
    // кампания не закончилась: акт тот же, концовок нет
    expect(fg.campaign.endings).toEqual([]);
    // через retry-окно миссия снова доступна (мягкий провал, не game over)
    world.tick = 30 + MISSION_RETRY_TICKS + 1;
    campaignPhase(world, catalogOf(missions));
    expect(mission.status).toBe("available");
    expect(startCampaignMission(world, playerId(world), "m_timed").ok).toBe(true);
  });

  it("пропуск миссии не блокирует кампанию", () => {
    const world = makeWorld();
    const missions = [arrivalMission("m1")];
    campaignPhase(world, catalogOf(missions));
    expect(startCampaignMission(world, playerId(world), "m1").ok).toBe(true);
    expect(skipCampaignMission(world, playerId(world), "m1").ok).toBe(true);
    const fg = fgOf(world);
    expect(fg.campaign.missions["m1"]!.status).toBe("skipped");
    expect(fg.campaign.activeMissionId).toBe(null);
    expect(startCampaignMission(world, playerId(world), "m1").ok).toBe(false);
  });

  it("напоминание при игнорировании сюжета 200 тактов (не провал)", () => {
    const world = makeWorld();
    const missions = [arrivalMission("m1")];
    campaignPhase(world, catalogOf(missions));
    const fg = fgOf(world);
    world.tick = STORY_REMINDER_TICKS;
    campaignPhase(world, catalogOf(missions));
    expect(fg.campaign.flags["storyReminder"]).toBe(1);
    expect(fg.journal.some((entry) => entry.kind === "reminder")).toBe(true);
    // следующий такт — без нового напоминания
    world.tick = STORY_REMINDER_TICKS + 5;
    campaignPhase(world, catalogOf(missions));
    expect(fg.campaign.flags["storyReminder"]).toBe(1);
    // миссия осталась доступной, провала нет
    expect(fg.campaign.missions["m1"]!.status).toBe("available");
  });

  it("анонимный флот не находит миссий: availableCampaignMissions сортирует по состоянию", () => {
    const world = makeWorld();
    const missions = [arrivalMission("m1"), arrivalMission("m2", 1)];
    campaignPhase(world, catalogOf(missions));
    const available = availableCampaignMissions(world);
    expect(available.map((mission) => mission.id)).toEqual(["m1"]);
  });
});

describe("кампания: ветки (док 11 §3)", () => {
  function worldAtAct2(): World {
    const world = makeWorld();
    world.tick = 1300;
    campaignPhase(world, catalogOf([]));
    expect(fgOf(world).campaign.act).toBe(2);
    return world;
  }

  it("до II акта выбор ветки недоступен", () => {
    const world = makeWorld();
    expect(chooseBranch(world, playerId(world), "sovereignty").ok).toBe(false);
  });

  it("суверенитет: требует ≥2 систем, одна ветка на партию", () => {
    const world = worldAtAct2();
    const empire = world.empires.find((e) => e.id === playerId(world))!;
    // стартовое состояние может уже включать несколько систем — фиксируем «одну систему»
    empire.systems = [empire.capitalSystemId];
    expect(chooseBranch(world, playerId(world), "sovereignty").ok).toBe(false);
    const extra = world.systems.find((system) => system.id !== empire.capitalSystemId)!;
    empire.systems.push(extra.id);
    expect(chooseBranch(world, playerId(world), "sovereignty").ok).toBe(true);
    const fg = fgOf(world);
    expect(fg.campaign.branch).toBe("sovereignty");
    expect(fg.campaign.flags["branch:sovereignty"]).toBe(1);
    expect(fg.campaign.branchProgress.sovereignty).toBeGreaterThanOrEqual(1);
    expect(chooseBranch(world, playerId(world), "federation").ok).toBe(false); // ветка уже выбрана
  });

  it("федерация: требует мнение союзника ≥20", () => {
    const world = worldAtAct2();
    const pid = playerId(world);
    const other = world.empires.find((e) => e.id !== pid && !e.isPlayer);
    expect(other).toBeTruthy();
    expect(chooseBranch(world, pid, "federation").ok).toBe(false);
    other!.relations[pid] = { opinion: 40, treaty: "trade", warTicks: 0 };
    expect(chooseBranch(world, pid, "federation").ok).toBe(true);
    expect(fgOf(world).campaign.branch).toBe("federation");
  });

  it("синдикат: требует кредитов и открывает миссии ветки", () => {
    const world = worldAtAct2();
    const pid = playerId(world);
    const missions = [
      makeMission({
        id: "m_syn",
        act: 2,
        branchRequired: "syndicate",
        objectives: [{ id: "arrive", type: "reach_system", targetKind: "capital" }],
      }),
    ];
    campaignPhase(world, catalogOf(missions));
    expect(fgOf(world).campaign.missions["m_syn"]!.status).toBe("locked");
    expect(chooseBranch(world, pid, "syndicate").ok).toBe(true);
    campaignPhase(world, catalogOf(missions));
    expect(fgOf(world).campaign.missions["m_syn"]!.status).toBe("available");
  });
});

describe("кампания: концовки (док 11 §8)", () => {
  function addCrisis(world: World, defeated: boolean): void {
    fgOf(world).crises.push({
      id: "crisis_1",
      kind: "void_reavers",
      startedTick: 0,
      stage: 1,
      strengthFp: 100,
      systems: [],
      nodes: [],
      defeated,
      progress: defeated ? 100 : 0,
      wavesRepelled: 0,
      lairSystemId: 0,
      lastActionTick: 0,
      titleRu: "Мародёры Пустоты",
    });
  }

  it("секретная концовка «Шёпот»: 6 артефактов, без дублей", () => {
    const world = makeWorld();
    const fg = fgOf(world);
    const secret = [makeEnding({ id: "ending_whisper", condition: "artifacts_whisper==6", secret: true })];
    expect(checkEndings(world, { endings: secret })).toEqual([]);
    fg.campaign.secretLine = 6;
    expect(checkEndings(world, { endings: secret })).toContain("ending_whisper");
    expect(campaignEndings(world)).toEqual(["ending_whisper"]);
    checkEndings(world, { endings: secret });
    expect(campaignEndings(world)).toEqual(["ending_whisper"]);
    expect(fg.journal.some((entry) => entry.kind === "ending")).toBe(true);
  });

  it("«Запечатать Разлом»: кризис отражён + 5 ключей", () => {
    const world = makeWorld();
    const fg = fgOf(world);
    const seal = [makeEnding({ id: "ending_seal", condition: "artifacts>=5 AND crisis_defeated" })];
    addCrisis(world, false);
    fg.campaign.artifactCount = 5;
    expect(checkEndings(world, { endings: seal })).not.toContain("ending_seal");
    // кризис отражён → условие выполнено
    fg.crises[0]!.defeated = true;
    expect(checkEndings(world, { endings: seal })).toContain("ending_seal");
    // встроенный fallback-набор (если контент пуст) даёт свой id
    expect(checkEndings(world, { endings: [] })).toContain("ending_seal_rift");
  });

  it("«Синдикат»: branch==syndicate AND флаг экономической гегемонии", () => {
    const world = makeWorld();
    const fg = fgOf(world);
    const syndicate = [makeEnding({ id: "ending_syndicate", condition: "branch==syndicate AND economy_hegemony" })];
    fg.campaign.branch = "syndicate";
    expect(checkEndings(world, { endings: syndicate })).not.toContain("ending_syndicate");
    fg.campaign.flags["economy_hegemony"] = 1;
    expect(checkEndings(world, { endings: syndicate })).toContain("ending_syndicate");
  });

  it("концовка из данных: строка условия разбирается", () => {
    const world = makeWorld();
    const fg = fgOf(world);
    fg.campaign.branch = "sovereignty";
    fg.campaign.artifactCount = 2;
    const endings = [makeEnding({ id: "custom_end", condition: "branch=sovereignty, artifacts>=2" })];
    expect(checkEndings(world, { endings })).toEqual(["custom_end"]);
    // неизвестный токен трактуется как флаг мира/кампании, который выставляют другие системы
    const tolerant = [makeEnding({ id: "custom_end2", condition: "artifacts>=2, some_new_rule" })];
    expect(checkEndings(world, { endings: tolerant })).not.toContain("custom_end2");
    fg.campaign.flags["some_new_rule"] = 1;
    expect(checkEndings(world, { endings: tolerant })).toContain("custom_end2");
    // невыполненное условие — пусто
    const unmet = [makeEnding({ id: "custom_end3", condition: "artifacts>=5" })];
    expect(checkEndings(world, { endings: unmet })).not.toContain("custom_end3");
  });
});

describe("кампания: детерминизм и идемпотентность", () => {
  it("повторный вызов фазы на том же такте не меняет состояние", () => {
    const world = makeWorld();
    const missions = [arrivalMission("m1"), arrivalMission("m2", 1)];
    campaignPhase(world, catalogOf(missions));
    const snapshot = JSON.stringify(fgOf(world).campaign);
    campaignPhase(world, catalogOf(missions));
    expect(JSON.stringify(fgOf(world).campaign)).toBe(snapshot);
  });

  it("два мира с одним seed проходят 100 тактов одинаково", () => {
    const missions = [arrivalMission("m1")];
    const run = (): string => {
      const world = makeWorld(99);
      for (let tick = 0; tick < 100; tick++) {
        world.tick = tick;
        campaignPhase(world, catalogOf(missions));
      }
      return serializeWorld(world);
    };
    expect(run()).toBe(run());
  });
});
