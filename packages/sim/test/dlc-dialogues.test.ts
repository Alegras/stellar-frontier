import { afterEach, describe, expect, it } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import {
  applyCommand, bootstrapDlcStory, campaignPhase, createWorld, deserializeWorld, dlcDialogueEnd, dlcDialogueAdvance,
  dlcDialogueChoose, dlcPhase, dlcNotifyAction, endDlcDialogue, ensureDlc, getDlcConsequences,
  getDlcDialogueView, getDlcModalState, getDlcState, narrativePhase, serializeWorld, setDlcCatalog,
  startDlcDialogue,
} from "../src/index";
import { makeEvent } from "./campaignFixtures";
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
      id: "dlg_campaign_act2", version: 1,
      nodes: [
        { id: "c1", type: "line", textKey: "dlg.station.c1", next: "c2" },
        { id: "c2", type: "choice", options: [
          { id: "repair", textKey: "dlg.station.repair", next: "c3", effects: [{ flag: "kira_debt" }] },
          { id: "fee", textKey: "dlg.station.fee", next: "c3", effects: [{ flag: "kira_paid", credits: 800 }] },
          { id: "salvage", textKey: "dlg.station.salvage", next: "c3", effects: [{ flag: "kira_hostile" }] },
        ] },
        { id: "c3", type: "end" },
      ],
    },
    {
      id: "dlg_campaign_branch", version: 1,
      nodes: [
        { id: "b1", type: "line", textKey: "dlg.branch.b1", next: "b2" },
        { id: "b2", type: "choice", options: [
          { id: "federation", textKey: "dlg.branch.fed", next: "b3", effects: [{ campaignFlag: "branch_dialogue_fed" }] },
          { id: "sovereignty", textKey: "dlg.branch.sov", next: "b3", effects: [{ campaignFlag: "branch_dialogue_sov" }] },
          { id: "syndicate", textKey: "dlg.branch.syn", next: "b3", effects: [{ campaignFlag: "branch_dialogue_syn" }] },
        ] },
        { id: "b3", type: "end" },
      ],
    },
    {
      id: "dlg_campaign_finale", version: 1,
      nodes: [
        { id: "f1", type: "line", textKey: "dlg.finale.f1", next: "f2" },
        { id: "f2", type: "effect", effects: [{ campaignFlag: "finale_dialogue_done" }], next: "f3" },
        { id: "f3", type: "end" },
      ],
    },
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
    finishDialogue(world);
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
    expect(startDlcDialogue(world, "dlg_campaign_act2", null).ok).toBe(false);
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

describe("task-37 · сюжетные диалоги кампании", () => {
  it("акт II и III: один раз, контекст campaign, выбор влияет на концовку", () => {
    const world = makeWorld();
    const d = getDlcState(world);
    world.tick = 1200;
    campaignPhase(world, { missions: [] });
    expect(world.fg!.campaign.act).toBe(2);
    expect(d.dialogue?.context).toBe("campaign");
    expect(d.dialogue?.campaignAct).toBe(2);
    expect(d.dialogue?.sceneId).toBe("dlg_campaign_act2");
    // повторный вызов не открывает второй диалог
    campaignPhase(world, { missions: [] });
    expect(d.dialogue?.sceneId).toBe("dlg_campaign_act2");
    dlcDialogueAdvance(world, 1);
    const view = getDlcDialogueView(world)!;
    dlcDialogueChoose(world, 1, view.nodeId, "salvage");
    finishDialogue(world);
    expect(world.fg!.campaign.flags["endingHint:ending_syndicate"]).toBe(1);
    expect(d.seenScenes).toContain("dlg_campaign_act2");
    // диалог ветки — только когда ветка выбрана
    campaignPhase(world, { missions: [] });
    expect(d.dialogue).toBeNull();
    world.fg!.campaign.branch = "federation";
    campaignPhase(world, { missions: [] });
    expect(d.dialogue?.sceneId).toBe("dlg_campaign_branch");
    finishDialogue(world);
    expect(d.seenScenes).toContain("dlg_campaign_branch");
    // финал кампании (акт V)
    world.tick = 6200;
    campaignPhase(world, { missions: [] });
    expect(world.fg!.campaign.act).toBe(5);
    expect(d.dialogue?.sceneId).toBe("dlg_campaign_finale");
    finishDialogue(world);
    expect(world.fg!.campaign.flags.finale_dialogue_done).toBe(1);
    expect(d.seenScenes).toContain("dlg_campaign_finale");
    // повторно не открывается
    campaignPhase(world, { missions: [] });
    expect(d.dialogue).toBeNull();
  });
});
