import { describe, expect, it, afterEach } from "vitest";
import { BALANCE, MODE } from "@sf/data";
import {
  applyCommand, createWorld, deserializeWorld, dlcBuyRumor, dlcDialogueAdvance, dlcDialogueChoose,
  dlcNotifyAction, dlcPhase, dlcToggle, ensureDlc, getDlcBoard, getDlcChronicle, getDlcDialogueView,
  getDlcJournal, getDlcMarkers, getDlcRumors, getDlcSaveMeta, getDlcSignals, getDlcState, getDlcTree,
  serializeWorld, setDlcCatalog, startDlcDialogue,
} from "../src/index";
import type { DlcCatalog } from "../src/dlc";
import type { World } from "../src/index";

afterEach(() => setDlcCatalog(null));

function effects(): Record<string, unknown> { return {}; }
void effects;

const CATALOG: DlcCatalog = {
  quests: [
    {
      id: "q_pro_01_first_light", type: "main", line: "prologue", act: 1,
      titleKey: "quest.q1.title", summaryKey: "quest.q1.summary",
      source: { channel: "story_message", autoStartTick: 0 },
      steps: [
        { id: "s1_dlg", type: "dialogue", target: "dlg_q1", titleKey: "step.s1" },
        { id: "s2_dock", type: "dock", count: 1, titleKey: "step.s2" },
        { id: "s3_reach", type: "reach_system", count: 1, titleKey: "step.s3" },
        { id: "s4_kill", type: "kill", count: 1, titleKey: "step.s4" },
        { id: "s5_report", type: "report", count: 1, titleKey: "step.s5" },
        { id: "s6_turn", type: "turn_in", count: 1, titleKey: "step.s6" },
      ],
      rewards: { credits: 1000, alloys: 100, rep: { guild: 10 }, flags: ["flg_q1_done"], items: ["it_q1"] },
      failPolicy: "soft", nextHint: "q_02_board",
    },
    {
      id: "q_02_board", type: "side", line: "prologue", act: 1,
      titleKey: "quest.q2.title", summaryKey: "quest.q2.summary",
      source: { channel: "board", requiresQuest: "q_pro_01_first_light" },
      steps: [{ id: "b1", type: "report", count: 1, titleKey: "step.b1" }],
      rewards: { credits: 500 }, failPolicy: "soft",
    },
    {
      id: "q_03_rumor", type: "investigation", line: "rumors", act: 1,
      titleKey: "quest.q3.title", summaryKey: "quest.q3.summary",
      source: { channel: "rumor", rumorLieChance: 0 },
      steps: [{ id: "r1", type: "reach_system", count: 1, titleKey: "step.r1" }],
      rewards: { credits: 300, flags: ["flg_q3_done"] }, failPolicy: "soft",
    },
    {
      id: "q_04_signal", type: "event", line: "signals", act: 1,
      titleKey: "quest.q4.title", summaryKey: "quest.q4.summary",
      source: { channel: "signal" },
      steps: [{ id: "g1", type: "kill", count: 1, titleKey: "step.g1" }],
      rewards: { credits: 200 }, failPolicy: "soft",
    },
  ],
  dialogues: [
    {
      id: "dlg_q1", version: 1,
      nodes: [
        { id: "n1", type: "line", speaker: "char_admiral", emotion: "calm", textKey: "dlg.q1.n1", next: "n2" },
        { id: "n2", type: "choice", options: [
          { id: "o1", textKey: "dlg.q1.o1", next: "n3", effects: [{ flag: "flg_q1_honest", rep: { guild: 5 }, credits: 100, chronicleKey: "dlc.chronicle.q1_honest" }] },
          { id: "o2", textKey: "dlg.q1.o2", next: "n4", effects: [{ flag: "flg_q1_silent" }] },
          { id: "o3", textKey: "dlg.q1.o3", next: "n5", check: { stat: "rep:guild", dc: 40, onSuccess: "n6", onFail: "n7" }, requiresFlag: "flg_q1_honest" },
        ] },
        { id: "n3", type: "effect", effects: [{ timeSkip: 2 }], next: "n8" },
        { id: "n4", type: "line", textKey: "dlg.q1.n4", next: "n8" },
        { id: "n5", type: "check", check: { stat: "rep:guild", dc: 10, onSuccess: "n6", onFail: "n7" } },
        { id: "n6", type: "line", textKey: "dlg.q1.n6", next: "n8" },
        { id: "n7", type: "line", textKey: "dlg.q1.n7", next: "n8" },
        { id: "n8", type: "effect", effects: [{ flag: "flg_q1_dialogue_end" }], next: "n9" },
        { id: "n9", type: "end" },
      ],
    },
  ],
  characters: [{ id: "char_admiral", nameKey: "char.admiral.name", portrait: "admiral", emotions: ["calm", "angry"], race: "human", role: "admiral", relation: { base: 0, grudgeAllowed: false } }],
  tree: { version: 1, nodes: [
    { id: "q_pro_01_first_light", group: "prologue", type: "main", x: 0, y: 0 },
    { id: "q_02_board", group: "prologue", type: "side", x: 200, y: 0 },
  ], edges: [{ from: "q_pro_01_first_light", to: "q_02_board", kind: "required" }] },
  cards: [{ id: "card_q1", questId: "q_pro_01_first_light", art: "a", accent: "#fff" }],
};

function makeWorld(options?: { dlcEnabled?: boolean }): World {
  setDlcCatalog(CATALOG);
  return createWorld(42, MODE, BALANCE, options);
}

function startStory(world: World): void {
  const d = getDlcState(world);
  if (!d.storySent) dlcPhase(world);
}

function finishDialogue(world: World, picks: string[] = ["o1"]): void {
  let guard = 0;
  while (getDlcState(world).dialogue?.active && guard < 32) {
    guard += 1;
    const view = getDlcDialogueView(world)!;
    if (!view) break;
    if (view.node?.type === "choice") {
      const choiceId = picks.shift() ?? view.options.find((option) => option.available)?.id ?? view.options[0]!.id;
      expect(dlcDialogueChoose(world, 1, view.nodeId, choiceId).ok).toBe(true);
    } else {
      expect(dlcDialogueAdvance(world, 1).ok).toBe(true);
    }
  }
}

describe("DLC XIV · feature-flag, миграция, история", () => {
  it("новая игра включает DLC и стартует Q1 на первом такте фазы", () => {
    const world = makeWorld();
    const d = getDlcState(world);
    expect(d.enabled).toBe(true);
    expect(d.schemaVersion).toBe(3);
    expect(getDlcSaveMeta(world)).toMatchObject({ enabled: true, version: "1.0.0", mode: "full" });
    startStory(world);
    expect(d.storySent).toBe(true);
    expect(d.activeQuestId).toBe("q_pro_01_first_light");
    expect(d.quests["q_pro_01_first_light"]!.status).toBe("active");
    expect(d.dialogue?.active).toBe(true);
    expect(d.chronicle.length).toBeGreaterThan(0);
  });

  it("dlcEnabled=false и dlc_toggle", () => {
    const world = makeWorld({ dlcEnabled: false });
    const d = getDlcState(world);
    expect(d.enabled).toBe(false);
    dlcPhase(world);
    expect(d.storySent).toBe(false);
    expect(applyCommand(world, { type: "dlc_toggle", enabled: true }).ok).toBe(true);
    expect(d.enabled).toBe(true);
    expect(applyCommand(world, { type: "dlc_toggle", enabled: false }).ok).toBe(true);
    expect(d.enabled).toBe(false);
  });

  it("старый сейв без fg.dlc мигрирует в off с версией", () => {
    const world = makeWorld();
    const raw = JSON.parse(serializeWorld(world));
    delete raw.fg.dlc;
    const restored = deserializeWorld(JSON.stringify(raw));
    const d = ensureDlc(restored);
    expect(d.enabled).toBe(false);
    expect(d.mode).toBe("off");
    expect(d.schemaVersion).toBe(3);
    expect(d.migratedFromVersion).toBe(0);
    expect(d.flags.dlc_migration_warn).toBe(1);
  });
});

describe("DLC XIV · квестовый FSM и награды один раз", () => {
  it("7 шагов реальными действиями: dialogue→dock→reach→kill→report→turn_in", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    const player = world.empires[0];
    const creditsBefore = player.resources.credits;
    finishDialogue(world, ["o2"]);
    expect(d.quests["q_pro_01_first_light"]!.step).toBeGreaterThanOrEqual(1);
    expect(dlcNotifyAction(world, "dock", "station_1").ok).toBe(true);
    expect(dlcNotifyAction(world, "reach_system", String(player.capitalSystemId)).ok).toBe(true);
    expect(dlcNotifyAction(world, "kill", "2").ok).toBe(true);
    expect(dlcNotifyAction(world, "report").ok).toBe(true);
    expect(dlcNotifyAction(world, "turn_in").ok).toBe(true);
    const state = d.quests["q_pro_01_first_light"]!;
    expect(state.status).toBe("completed");
    expect(state.rewardsClaimed).toBe(true);
    expect(d.flags.flg_q1_done).toBe(1);
    expect(d.flags["item:it_q1"]).toBe(1);
    expect(d.reputation.guild).toBeGreaterThanOrEqual(10);
    expect(player.resources.credits).toBe(creditsBefore + 1000);
    // повторный turn_in не дублирует награды
    expect(dlcNotifyAction(world, "turn_in").ok).toBe(false);
    expect(player.resources.credits).toBe(creditsBefore + 1000);
    // nextHint открыт
    expect(d.quests["q_02_board"]!.status).toBe("available");
  });

  it("повторный accept/completed не дублирует и не перезапускает", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    expect(applyCommand(world, { type: "dlc_quest_accept", questId: "q_pro_01_first_light" }).ok).toBe(false);
    finishDialogue(world, ["o2"]);
    for (const action of ["dock", "reach_system", "kill", "report", "turn_in"]) {
      dlcNotifyAction(world, action, action === "reach_system" ? "1" : "2");
    }
    expect(d.quests["q_pro_01_first_light"]!.status).toBe("completed");
    expect(applyCommand(world, { type: "dlc_quest_accept", questId: "q_pro_01_first_light" }).ok).toBe(false);
  });
});

describe("DLC XIV · диалоги: выборы, проверки, эффекты, save mid-dialogue", () => {
  it("линия → 3 выбора; проверка детерминирована и не перебрасывается после save/load", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    const view = getDlcDialogueView(world)!;
    expect(view.node?.type).toBe("line");
    expect(dlcDialogueAdvance(world, 1).ok).toBe(true);
    const choiceView = getDlcDialogueView(world)!;
    expect(choiceView.node?.type).toBe("choice");
    expect(choiceView.options.length).toBe(3);
    // вариант o3 недоступен без флага
    expect(dlcDialogueChoose(world, 1, choiceView.nodeId, "o3").ok).toBe(false);
    const json = serializeWorld(world);
    const restored = deserializeWorld(json);
    setDlcCatalog(CATALOG);
    const before = getDlcState(restored).dialogue!;
    const pick = dlcDialogueChoose(restored, 1, choiceView.nodeId, "o2");
    expect(pick.ok, pick.messageRu).toBe(true);
    expect(getDlcState(restored).dialogue?.choices[choiceView.nodeId]).toBe("o2");
    // повторный выбор того же узла запрещён
    expect(getDlcState(restored).dialogue?.nodeId).not.toBe(choiceView.nodeId);
    expect(before.seed).toBe(getDlcState(restored).dialogue?.seed ?? before.seed);
  });

  it("эффекты применяются один раз (credits/flag/rep/timeSkip)", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    const player = world.empires[0];
    const credits = player.resources.credits;
    const tickBefore = world.tick;
    dlcDialogueAdvance(world, 1);
    const choiceView = getDlcDialogueView(world)!;
    expect(dlcDialogueChoose(world, 1, choiceView.nodeId, "o1").ok).toBe(true);
    expect(d.flags.flg_q1_honest).toBe(1);
    expect(d.reputation.guild).toBe(5);
    expect(player.resources.credits).toBe(credits + 100);
    expect(world.tick).toBe(tickBefore + 2);
    // повторный выбор невозможен
    expect(dlcDialogueChoose(world, 1, choiceView.nodeId, "o1").ok).toBe(false);
    finishDialogue(world);
    expect(d.flags.flg_q1_dialogue_end).toBe(1);
  });

  it("startDlcDialogue не подменяет активную сцену (one-shot, без повторов)", () => {
    const world = makeWorld();
    startStory(world);
    const d = getDlcState(world);
    const active = d.dialogue!.sceneId;
    expect(startDlcDialogue(world, "dlg_q1", "q_pro_01_first_light").ok).toBe(false);
    expect(d.dialogue?.sceneId).toBe(active);
  });
});

describe("DLC XIV · 4 канала и маркеры", () => {
  it("board обновляется раз в 10 тактов после гейта", () => {
    const world = makeWorld();
    startStory(world);
    finishDialogue(world, ["o2"]);
    for (const action of ["dock", "reach_system", "kill", "report", "turn_in"]) {
      dlcNotifyAction(world, action, action === "reach_system" ? "1" : "2");
    }
    world.tick += 10;
    dlcPhase(world);
    expect(getDlcBoard(world).questIds).toContain("q_02_board");
    expect(getDlcBoard(world).refreshTick).toBeGreaterThan(0);
  });

  it("слухи: покупка за 500, ложь и опровержение", () => {
    const world = makeWorld();
    const d = getDlcState(world);
    dlcPhase(world);
    const rumors = getDlcRumors(world);
    expect(rumors.length).toBeGreaterThan(0);
    const truthful = rumors.find((rumor) => !rumor.lie)!;
    world.empires[0].resources.credits = 5000;
    const buy = dlcBuyRumor(world, 1, truthful.id);
    expect(buy.ok, buy.messageRu).toBe(true);
    expect(d.quests["q_03_rumor"]!.status).toBe("available");
    expect(dlcBuyRumor(world, 1, truthful.id).ok).toBe(false);
    // ложь: вручную помечаем ложным и проверяем опровержение после завершения квеста
    d.rumors.push({ id: "rumor:q_02_board", questId: "q_02_board", lie: true, revealed: true, refuted: false, expiresTick: world.tick + 600 });
    d.quests["q_02_board"]!.status = "active";
    d.quests["q_02_board"]!.step = 1;
    d.activeQuestId = "q_02_board";
    dlcNotifyAction(world, "report");
    expect(d.flags["rumor_refuted:rumor:q_02_board"]).toBe(1);
  });

  it("сигнал открывается входом флота в систему", () => {
    const world = makeWorld();
    const d = getDlcState(world);
    dlcPhase(world);
    const signals = getDlcSignals(world);
    expect(signals.length).toBe(1);
    const signal = signals[0]!;
    const fleet = world.fleets.find((entry) => entry.empireId === 1 && entry.ships.length > 0)!;
    fleet.systemId = signal.systemId;
    dlcPhase(world);
    expect(getDlcSignals(world)[0]!.revealed).toBe(true);
    expect(d.quests[signal.questId]!.status).toBe("available");
  });

  it("аксессоры: журнал/хроника/дерево/маркеры/dialogue view", () => {
    const world = makeWorld();
    startStory(world);
    expect(getDlcJournal(world).length).toBe(4);
    expect(getDlcChronicle(world).length).toBeGreaterThan(0);
    const tree = getDlcTree(world);
    expect(tree.nodes.length).toBe(2);
    expect(tree.edges.length).toBe(1);
    expect(getDlcMarkers(world).length).toBeGreaterThan(0);
    expect(getDlcDialogueView(world)).toBeTruthy();
  });
});

describe("DLC XIV · детерминизм", () => {
  it("одинаковые действия → идентичный мир", () => {
    const run = (): string => {
      const world = makeWorld();
      startStory(world);
      finishDialogue(world, ["o1"]);
      return serializeWorld(world);
    };
    const first = run();
    const second = run();
    expect(first).toBe(second);
  });
});
