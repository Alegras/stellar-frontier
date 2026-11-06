import { afterEach, describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import {
  applyCommand, bootstrapDlcStory, campaignPhase, createWorld, deserializeWorld, dlcDialogueEnd, dlcDialogueAdvance,
  dlcDialogueChoose, dlcPhase, dlcNotifyAction, endDlcDialogue, ensureDlc, getDlcConsequences,
  ensureFg, getDlcDialogueView, getDlcModalState, getDlcState, narrativePhase, serializeWorld,
  setDlcCatalog, startDlcDialogue,
} from "../src/index";
import { makeEvent } from "./campaignFixtures";
import { CAMPAIGN_MISSION_DIALOGUES, getEndingHints, maybeStartCampaignStoryDialogue } from "../src/dlc";
import type { CampaignMission } from "../src/fullgame";
import type { DlcCatalog } from "../src/dlc";
import type { World } from "../src/index";

afterEach(() => setDlcCatalog(null));

const CATALOG: DlcCatalog = {
  quests: [
    {
      id: "q1", type: "main", line: "prologue", act: 1,
      titleKey: "quest.q1.title", summaryKey: "quest.q1.summary",
      source: { channel: "story_message", autoStartTick: 0 },
      steps: [
        { id: "s1", type: "dialogue", target: "dlg_a", titleKey: "step.s1" },
        { id: "s2", type: "report", titleKey: "step.s2" },
      ],
      rewards: { credits: 1000 }, failPolicy: "soft", nextHint: "q2",
      requiresFlags: [], modifiers: [],
    },
    {
      id: "q2", type: "side", line: "prologue", act: 1,
      titleKey: "quest.q2.title", summaryKey: "quest.q2.summary",
      source: { channel: "board", requiresQuest: "q1" },
      steps: [{ id: "b1", type: "report", titleKey: "step.b1" }],
      rewards: { credits: 100 }, failPolicy: "soft",
      modifiers: [{ flags: ["choice_a"], creditsDelta: 500, rep: { survivors: 5 }, effectLabels: ["q2.fx.choice_a"] }],
    },
  ],
  dialogues: [
    {
      id: "dlg_a", version: 1,
      nodes: [
        { id: "n1", type: "line", speaker: "kira", textKey: "dlg.a.n1", next: "n2" },
        { id: "n2", type: "choice", options: [
          { id: "o1", textKey: "dlg.a.o1", next: "n3", effects: [
            { flag: "choice_a", campaignFlag: "cf_x", relation: { kira: 5 }, branch: "syndicate",
              ending: "ending_syndicate", items: ["it_x"], effectLabelKey: "dlg.fx.one" },
          ] },
          { id: "o2", textKey: "dlg.a.o2", next: "n3", effects: [{ flag: "choice_b" }] },
        ] },
        { id: "n3", type: "effect", effects: [{ chronicleKey: "dlg.a.done" }], next: "n4" },
        { id: "n4", type: "end" },
      ],
    },
    {
      id: "dlg_effects", version: 1,
      nodes: [
        { id: "e1", type: "line", textKey: "dlg.e1", next: "e2" },
        { id: "e2", type: "choice", options: [
          { id: "hint", textKey: "dlg.hint", next: "e3", effects: [
            { endingHint: "ending_seal", unlockMission: "main_02_council", effectLabelKey: "dlg.fx.hint" },
          ] },
          { id: "hint_gated", textKey: "dlg.hint_gated", next: "e3", effects: [], requiresFlag: "ending_hint:ending_seal" },
        ] },
        { id: "e3", type: "end" },
      ],
    },
    {
      id: "dlg_campaign_act0_relic", version: 1,
      nodes: [
        { id: "l1", type: "line" as const, textKey: "act0.l1", next: "c1" },
        { id: "c1", type: "choice" as const, options: [
          { id: "accept", textKey: "act0.accept", next: "e", effects: [
            { campaignFlag: "camp_relic_study", relation: { admiral_kain: 5 }, effectLabelKey: "act0.fx.study" },
          ] },
          { id: "reject", textKey: "act0.reject", next: "e", effects: [
            { campaignFlag: "camp_relic_sealed", relation: { admiral_kain: -5 }, effectLabelKey: "act0.fx.sealed" },
          ] },
        ] },
        { id: "e", type: "end" as const },
      ],
    },
    {
      id: "dlg_campaign_act1_hegemon", version: 1,
      nodes: [
        { id: "l1", type: "line" as const, textKey: "act1.l1", next: "c1" },
        { id: "c1", type: "choice" as const, options: [
          { id: "accept", textKey: "act1.accept", next: "e", effects: [
            { campaignFlag: "camp_hegemon_vassal", unlockMission: "main_02_council", effectLabelKey: "act1.fx.vassal" },
          ] },
          { id: "reject", textKey: "act1.reject", next: "e", effects: [
            { campaignFlag: "camp_hegemon_rejected", effectLabelKey: "act1.fx.rejected" },
          ] },
        ] },
        { id: "e", type: "end" as const },
      ],
    },
    ...[
      "dlg_campaign_teira_arc", "dlg_campaign_kira_arc",
      "dlg_campaign_act2_council", "dlg_campaign_act3_truth", "dlg_campaign_act4_legacy",
      "dlg_campaign_act4_betrayal", "dlg_campaign_final_door", "dlg_campaign_epilogue",
    ].map((id) => ({
      id, version: 1,
      nodes: [
        { id: "l1", type: "line" as const, textKey: id + ".l1", next: "e" },
        { id: "e", type: "end" as const },
      ],
    })),
  ],
  characters: [{ id: "kira", nameKey: "char.kira.name", portrait: "kira", emotions: ["neutral"], race: "human", role: "mechanic", relation: { base: 0, grudgeAllowed: true } }],
  tree: { version: 1, nodes: [{ id: "q1", group: "prologue", type: "main", x: 0, y: 0 }], edges: [] },
  cards: [],
};

function makeWorld(): World {
  setDlcCatalog(CATALOG);
  return createWorld(42, MODE, BALANCE);
}

function startStory(world: World): void {
  dlcPhase(world);
}

function finishDialogue(world: World, picks: string[] = []): void {
  let guard = 0;
  while (getDlcState(world).dialogue?.active && guard < 24) {
    guard += 1;
    const view = getDlcDialogueView(world)!;
    if (view.node?.type === "choice") {
      const choiceId = picks.shift() ?? view.options[0]!.id;
      const choiceResult = dlcDialogueChoose(world, 1, view.nodeId, choiceId);
      expect(choiceResult.ok, "choose " + choiceId + " at " + view.nodeId + ": " + (choiceResult.messageRu ?? "")).toBe(true);
    } else {
      expect(dlcDialogueAdvance(world, 1).ok).toBe(true);
    }
  }
}

describe("task-37 · one-shot сцен и storyStart", () => {
  it("сцена не повторяется после завершения; storyStart один раз", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    expect(d.dialogue?.active).toBe(true);
    finishDialogue(world, ["o2"]);
    expect(d.seenScenes).toContain("dlg_a");
    expect(d.dialogue).toBeNull();
    // повторный старт завершённой сцены запрещён
    expect(startDlcDialogue(world, "dlg_a", "q1").ok).toBe(false);
    // повторная фаза не перезапускает Q1/сцену
    dlcPhase(world);
    dlcPhase(world);
    expect(d.dialogue).toBeNull();
    expect(d.seenScenes.filter((scene) => scene === "dlg_a").length).toBe(1);
  });

  it("start не подменяет активную сцену", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    const scene = d.dialogue!.sceneId;
    expect(startDlcDialogue(world, "dlg_campaign_act2_council", null).ok).toBe(false);
    expect(d.dialogue?.sceneId).toBe(scene);
  });
});

describe("task-37 · синхронный bootstrap истории", () => {
  it("bootstrapDlcStory сразу открывает Q1 и диалог, идемпотентен", () => {
    const world = makeWorld();
    const d = getDlcState(world);
    expect(d.storySent).toBe(false);
    expect(d.dialogue).toBeNull();
    const first = bootstrapDlcStory(world);
    expect(first.ok, first.messageRu).toBe(true);
    expect(d.storySent).toBe(true);
    expect(d.dialogue?.active).toBe(true);
    expect(d.activeQuestId).toBe("q1");
    const second = bootstrapDlcStory(world);
    expect(second.ok).toBe(true);
    expect(d.dialogue?.active).toBe(true);
    expect(d.seenScenes.length).toBe(0); // seen только после завершения/закрытия
  });
});

describe("task-37 · dlc_dialogue_end", () => {
  it("закрытие помечает seen, не оставляет active и не вешает шаг квеста", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    expect(d.dialogue?.active).toBe(true);
    const end = applyCommand(world, { type: "dlc_dialogue_end" });
    expect(end.ok, end.messageRu).toBe(true);
    expect(d.dialogue).toBeNull();
    expect(d.seenScenes).toContain("dlg_a");
    expect(d.flags["dialogue_closed:dlg_a"]).toBe(1);
    // шаг-диалог квеста не зависает: шаг продвинулся
    expect(d.quests.q1!.step).toBeGreaterThanOrEqual(1);
    // повторный старт невозможен
    expect(startDlcDialogue(world, "dlg_a", "q1").ok).toBe(false);
    // endDlcDialogue тоже безопасен
    endDlcDialogue(world);
    expect(d.dialogue).toBeNull();
  });
});

describe("task-37 · модалки: диалог важнее narrative, пауза", () => {
  it("пока диалог активен, новые события не создаются; после закрытия — создаются", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    const modal = getDlcModalState(world);
    expect(modal.dialogueActive).toBe(true);
    expect(modal.priority).toBe("dialogue");
    expect(modal.paused).toBe(true);
    world.tick = 10;
    narrativePhase(world, { events: [makeEvent({ id: "e1", chainId: "c1", step: 1 })] });
    expect(world.fg!.narrative.pending.length).toBe(0);
    // закрываем — событие имеет право появиться
    dlcDialogueEnd(world, 1);
    expect(d.dialogue).toBeNull();
    world.tick = 20;
    narrativePhase(world, { events: [makeEvent({ id: "e1", chainId: "c1", step: 1 })] });
    expect(world.fg!.narrative.pending.map((event) => event.id)).toContain("e1");
    expect(getDlcModalState(world).priority).toBe("event");
  });
});

describe("task-37 · последствия/эффекты диалогов", () => {
  it("consequences, campaign.flags, relation, branch, ending, items, preview", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    dlcDialogueAdvance(world, 1);
    const view = getDlcDialogueView(world)!;
    expect(view.options[0]!.consequences.length).toBeGreaterThan(0);
    const kinds = view.options[0]!.consequences.map((entry) => entry.kind);
    expect(kinds).toContain("campaignFlag");
    expect(kinds).toContain("relation");
    expect(kinds).toContain("branch");
    expect(dlcDialogueChoose(world, 1, view.nodeId, "o1").ok).toBe(true);
    const campaign = world.fg!.campaign;
    expect(campaign.flags.cf_x).toBe(1);
    expect(d.reputation.kira).toBe(5);
    expect(campaign.branch).toBe("syndicate");
    expect(campaign.endings).toContain("ending_syndicate");
    expect(d.flags["item:it_x"]).toBe(1);
    const consequence = getDlcConsequences(world).find((entry) => entry.choiceId === "o1")!;
    expect(consequence).toBeTruthy();
    expect(consequence.effects.some((effect) => effect.labelKey === "dlg.fx.one")).toBe(true);
    finishDialogue(world);
  });

  it("save/load mid-dialogue сохраняет seenScenes/consequences/seed", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    dlcDialogueAdvance(world, 1);
    const view = getDlcDialogueView(world)!;
    dlcDialogueChoose(world, 1, view.nodeId, "o1");
    const json = serializeWorld(world);
    const restored = deserializeWorld(json);
    setDlcCatalog(CATALOG);
    const dd = ensureDlc(restored);
    expect(dd.seenScenes).toEqual(d.seenScenes);
    expect(dd.consequences.length).toBe(d.consequences.length);
    expect(dd.dialogue?.seed).toBe(d.dialogue?.seed);
    expect(serializeWorld(restored)).toBe(json);
  });
});

describe("task-37 · флаги Q1 → Q2 (награды/модификаторы)", () => {
  it("choice_a даёт bonus-кредиты Q2 и запись последствий", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    finishDialogue(world, ["o1"]);
    expect(dlcNotifyAction(world, "report").ok).toBe(true);
    expect(d.quests.q1!.status).toBe("completed");
    expect(d.quests.q2!.status).toBe("available");
    expect(applyCommand(world, { type: "dlc_quest_accept", questId: "q2" }).ok).toBe(true);
    const credits = world.empires[0]!.resources.credits;
    expect(dlcNotifyAction(world, "report").ok).toBe(true);
    expect(d.quests.q2!.status).toBe("completed");
    expect(world.empires[0]!.resources.credits).toBe(credits + 100 + 500);
    expect(d.reputation.survivors).toBe(5);
    expect(getDlcConsequences(world).some((entry) => entry.questId === "q2" && entry.effects.some((effect) => effect.labelKey === "q2.fx.choice_a"))).toBe(true);
  });
});

describe("task-52 · акты 0/I: новые сцены один раз, эффекты выбора", () => {
  it("main_00_relic/main_01_hegemon триггерят свои сцены, Q1 не дублируется", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    fg.campaign.missions["main_00_relic"] = {
      id: "main_00_relic", act: 0, titleRu: "Обломок", briefingRu: "", giver: "", objectives: [],
      failCondition: null, rewards: { credits: 0 }, branchRequired: null, secret: false,
      status: "completed", acceptedTick: 0, flags: {},
    };
    fg.campaign.missions["main_01_hegemon"] = {
      id: "main_01_hegemon", act: 1, titleRu: "Гегемон", briefingRu: "", giver: "", objectives: [],
      failCondition: null, rewards: { credits: 0 }, branchRequired: null, secret: false,
      status: "completed", acceptedTick: 0, flags: {},
    };
    const d = getDlcState(world);
    d.storySent = true; // Q1 уже обработан/не нужен в этом тесте
    world.tick = 10;
    const targetEntries = CAMPAIGN_MISSION_DIALOGUES.filter((entry) => ["main_00_relic", "main_01_hegemon"].includes(entry.missionId));
    for (const entry of targetEntries) {
      const started = maybeStartCampaignStoryDialogue(world);
      expect(started).toBe(entry.scene);
      expect(getDlcState(world).dialogue?.context).toBe("campaign");
      finishDialogue(world, ["accept"]);
      expect(getDlcState(world).seenScenes).toContain(entry.scene);
    }
    // обе сцены проиграны — новых нет
    expect(maybeStartCampaignStoryDialogue(world)).toBeNull();
    const fgFinal = ensureFg(world);
    expect(fgFinal.campaign.flags.camp_relic_study).toBe(1);
    expect(fgFinal.campaign.flags.camp_hegemon_vassal).toBe(1);
    expect(fgFinal.campaign.flags["mission_unlocked:main_02_council"]).toBe(1);
    expect(getDlcState(world).reputation.admiral_kain).toBe(5);
    expect(getDlcConsequences(world).some((entry) => entry.sceneId === "dlg_campaign_act0_relic"
      && entry.effects.some((effect) => effect.labelKey === "act0.fx.study"))).toBe(true);
    expect(getDlcState(world).seenScenes).not.toContain("dlg_q1_briefing");
    expect(getDlcState(world).seenScenes.filter((scene) => scene === "dlg_campaign_act0_relic").length).toBe(1);
  });
});

describe("task-55 · арки teira/kira и bridge-журнал", () => {
  function completedMission(id: string) {
    return {
      id, act: 1, titleRu: id, briefingRu: "", giver: "", objectives: [], failCondition: null,
      rewards: { credits: 0 }, branchRequired: null, secret: false, status: "completed",
      acceptedTick: 0, flags: {},
    } as unknown as CampaignMission;
  }

  it("dlg_campaign_teira_arc/kira_arc триггерятся один раз", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    fg.campaign.missions["main_01_colony"] = completedMission("main_01_colony");
    fg.campaign.missions["main_02_first_crisis"] = completedMission("main_02_first_crisis");
    const d = getDlcState(world);
    d.storySent = true;
    d.flags["campaign_scene:main_00_relic"] = 1;
    d.flags["campaign_scene:main_01_hegemon"] = 1;
    d.seenScenes.push("dlg_campaign_act0_relic", "dlg_campaign_act1_hegemon");
    world.tick = 10;
    for (const [missionId, sceneId] of [
      ["main_01_colony", "dlg_campaign_teira_arc"],
      ["main_02_first_crisis", "dlg_campaign_kira_arc"],
    ] as const) {
      const started = maybeStartCampaignStoryDialogue(world);
      expect(started).toBe(sceneId);
      expect(getDlcState(world).dialogue?.context).toBe("campaign");
      finishDialogue(world);
      expect(getDlcState(world).flags["campaign_scene:" + missionId]).toBe(1);
      expect(getDlcState(world).seenScenes).toContain(sceneId);
    }
    expect(maybeStartCampaignStoryDialogue(world)).toBeNull();
    expect(getDlcState(world).seenScenes.filter((scene) => scene === "dlg_campaign_teira_arc").length).toBe(1);
  });

  it("bridge-записи в fg.journal при смене акта: один раз на переход, save/load", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    world.tick = 1200;
    campaignPhase(world, { missions: [] });
    expect(fg.campaign.act).toBe(2);
    const bridges = fg.journal.filter((entry) => entry.kind === "chronicle");
    expect(bridges.length).toBe(2);
    expect(bridges.some((entry) => entry.textRu.includes("Акт 0 → Акт I"))).toBe(true);
    expect(bridges.some((entry) => entry.textRu.includes("Акт I → Акт II"))).toBe(true);
    expect(fg.campaign.flags["bridge_journal:0_1"]).toBe(1);
    expect(fg.campaign.flags["bridge_journal:1_2"]).toBe(1);
    const count = fg.journal.length;
    campaignPhase(world, { missions: [] });
    expect(fg.journal.length).toBe(count);
    const json = serializeWorld(world);
    const restored = deserializeWorld(json);
    expect(restored.fg!.campaign.flags["bridge_journal:1_2"]).toBe(1);
    const restoredBridges = restored.fg!.journal.filter((entry) => entry.kind === "chronicle");
    expect(restoredBridges.length).toBe(2);
  });
});

describe("task-47 · endingHint/unlockMission и актовые сцены", () => {
  function fakeMission(id: string, status: "locked" | "completed"): CampaignMission {
    return {
      id, act: 2, titleRu: id, briefingRu: "", giver: "", objectives: [], failCondition: null,
      rewards: { credits: 0 }, branchRequired: null, secret: false, status,
      acceptedTick: 0, flags: {},
    };
  }

  it("endingHint/unlockMission: флаги, миссия открыта, consequences", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    fg.campaign.missions["main_02_council"] = fakeMission("main_02_council", "locked");
    expect(startDlcDialogue(world, "dlg_effects").ok).toBe(true);
    dlcDialogueAdvance(world, 1);
    const view = getDlcDialogueView(world)!;
    expect(view.options[0]!.consequences.map((effect) => effect.kind)).toContain("endingHint");
    expect(view.options[0]!.consequences.map((effect) => effect.kind)).toContain("unlockMission");
    expect(view.options[1]!.available).toBe(false);
    expect(dlcDialogueChoose(world, 1, view.nodeId, "hint").ok).toBe(true);
    expect(fg.campaign.flags["ending_hint:ending_seal"]).toBe(1);
    expect(fg.campaign.flags["mission_unlocked:main_02_council"]).toBe(1);
    expect(fg.campaign.missions["main_02_council"]!.status).toBe("available");
    expect(fg.campaign.missions["main_02_council"]!.flags.unlocked).toBe(1);
    expect(getEndingHints(world)).toEqual(["ending_seal"]);
    const consequence = getDlcConsequences(world).find((entry) => entry.sceneId === "dlg_effects")!;
    expect(consequence.effects.some((effect) => effect.kind === "endingHint" && effect.labelKey === "dlg.fx.hint")).toBe(true);
    expect(consequence.effects.some((effect) => effect.kind === "unlockMission" && effect.key === "main_02_council")).toBe(true);
    const world2 = makeWorld();
    ensureFg(world2).campaign.flags["ending_hint:ending_seal"] = 1;
    startDlcDialogue(world2, "dlg_effects");
    dlcDialogueAdvance(world2, 1);
    expect(getDlcDialogueView(world2)!.options[1]!.available).toBe(true);
  });

  it("каждая актовая сцена триггерится ровно один раз (mission completed)", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    for (const entry of CAMPAIGN_MISSION_DIALOGUES) {
      fg.campaign.missions[entry.missionId] = fakeMission(entry.missionId, "completed");
    }
    getDlcState(world).storySent = true; // изолируем от Q1-пролога
    world.tick = 10;
    for (const entry of CAMPAIGN_MISSION_DIALOGUES) {
      if (!getDlcState(world).dialogue?.active) dlcPhase(world);
      expect(getDlcState(world).dialogue?.sceneId).toBe(entry.scene);
      finishDialogue(world);
      expect(getDlcState(world).seenScenes).toContain(entry.scene);
    }
    // все сцены проиграны — новых нет (one-shot, без спама)
    dlcPhase(world);
    dlcPhase(world);
    expect(getDlcState(world).dialogue).toBeNull();
    expect(maybeStartCampaignStoryDialogue(world)).toBeNull();
    expect(getDlcState(world).seenScenes.filter((scene) => scene === "dlg_campaign_act2_council").length).toBe(1);
  });

  it("эпилог после концовки: one-shot, save/load", () => {
    const world = makeWorld();
    const fg = ensureFg(world);
    fg.campaign.endings.push("ending_seal");
    getDlcState(world).storySent = true;
    world.tick = 10;
    dlcPhase(world);
    expect(getDlcState(world).dialogue?.sceneId).toBe("dlg_campaign_epilogue");
    finishDialogue(world);
    expect(getDlcState(world).seenScenes).toContain("dlg_campaign_epilogue");
    dlcPhase(world);
    expect(getDlcState(world).dialogue).toBeNull();
    const json = serializeWorld(world);
    const restored = deserializeWorld(json);
    setDlcCatalog(CATALOG);
    expect(ensureDlc(restored).seenScenes).toContain("dlg_campaign_epilogue");
    expect(serializeWorld(restored)).toBe(json);
  });
});

