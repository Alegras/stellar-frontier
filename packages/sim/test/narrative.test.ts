/**
 * Тесты нарративных событий (M9): пул без повторов, pending, выборы, цепочки, кулдауны, условия.
 * docs/11_campaign_and_free_flight.md §4, GDD §14.7.
 */
import { describe, expect, it } from "vitest";
import {
  CHAIN_COOLDOWN_TICKS, EVENT_COOLDOWN_TICKS, EVENT_TTL_TICKS,
  chooseEvent, narrativePhase, pendingNarrativeEvents, triggerEvent,
} from "../src/narrative";
import { campaignPhase } from "../src/campaign";
import { endDlcDialogue } from "../src/dlc";
import { makeEvent, makeWorld, playerId, fgOf } from "./campaignFixtures";
import type { NarrativeEventDef } from "@sf/data";

function catalogOf(events: NarrativeEventDef[]) {
  return { events };
}

/** Прогоняет narrativePhase на такте (фаза срабатывает только на кратных EVENT_CHECK_INTERVAL). */
function phaseAt(world: ReturnType<typeof makeWorld>, events: NarrativeEventDef[], tick: number): void {
  world.tick = tick;
  narrativePhase(world, catalogOf(events));
}

describe("события: пул, pending, истечение", () => {
  it("событие срабатывает один раз и попадает в pending", () => {
    const world = makeWorld();
    const events = [makeEvent({ id: "e1", chainId: "chain_a", step: 1 })];
    narrativePhase(world, catalogOf(events));
    const fg = fgOf(world);
    expect(fg.narrative.pending.length).toBe(1);
    expect(fg.narrative.pending[0]!.id).toBe("e1");
    expect(fg.narrative.fired["e1"]).toBe(0);
    expect(fg.journal.some((entry) => entry.kind === "event")).toBe(true);
    // повторов нет
    phaseAt(world, events, 5);
    phaseAt(world, events, 10);
    expect(fg.narrative.pending.length).toBe(1);
  });

  it("необработанное событие истекает через EVENT_TTL_TICKS", () => {
    const world = makeWorld();
    const events = [makeEvent({ id: "e1", chainId: "chain_a", step: 1 })];
    narrativePhase(world, catalogOf(events));
    expect(pendingNarrativeEvents(world).length).toBe(1);
    phaseAt(world, events, EVENT_TTL_TICKS);
    expect(pendingNarrativeEvents(world).length).toBe(0);
    expect(fgOf(world).narrative.fired["e1"]).toBe(0);
  });

  it("пустой контент: фаза пассивна", () => {
    const world = makeWorld();
    for (const tick of [0, 5, 10, 20]) {
      world.tick = tick;
      narrativePhase(world, { events: [] }); // изолируем тест от реального контента
    }
    const narrative = fgOf(world).narrative;
    expect(narrative.pending).toEqual([]);
    expect(narrative.fired).toEqual({});
    expect(narrative.chainStep).toEqual({});
  });
});

describe("события: выборы", () => {
  it("выбор применяет эффекты/флаги, повторный выбор отклоняется", () => {
    const world = makeWorld();
    const events = [makeEvent({ id: "e1", chainId: "chain_a", step: 1 })];
    narrativePhase(world, catalogOf(events));
    const fg = fgOf(world);
    const empire = world.empires.find((e) => e.id === playerId(world))!;
    const creditsBefore = empire.resources.credits;

    expect(chooseEvent(world, playerId(world), "e1", "unknown_choice").ok).toBe(false);
    expect(chooseEvent(world, 999, "e1", "accept").ok).toBe(false); // не игрок
    expect(chooseEvent(world, playerId(world), "e1", "accept").ok).toBe(true);
    expect(empire.resources.credits).toBe(creditsBefore + 500);
    expect(fg.campaign.flags["accepted_e1"]).toBe(1);
    expect(fg.narrative.pending).toEqual([]);
    expect(fg.narrative.chainStep["chain_a"]).toBe(1);
    expect(fg.journal.some((entry) => entry.kind === "choice")).toBe(true);

    // идемпотентность: второй раз нельзя, ресурсы не начисляются повторно
    expect(chooseEvent(world, playerId(world), "e1", "accept").ok).toBe(false);
    expect(empire.resources.credits).toBe(creditsBefore + 500);
  });

  it("выбор открывает миссию из данных события", () => {
    const world = makeWorld();
    const events = [
      makeEvent({
        id: "e_mission",
        chainId: "chain_m",
        step: 1,
        choices: [{ id: "take", labelRu: "Взять заказ", effects: [], missionId: "m_linked" }],
      }),
    ];
    // миссия создаётся фазой кампании и становится доступной
    campaignPhase(world, {
      missions: [
        {
          id: "m_linked",
          act: 0,
          titleRu: "Связанная миссия",
          briefingRu: "Брифинг",
          giver: "test",
          branchRequired: null,
          secret: false,
          objectives: [{ id: "arrive", type: "reach_system", targetKind: "capital" }],
          rewards: {},
          weight: 1,
        },
      ],
    });
    narrativePhase(world, catalogOf(events));
    expect(chooseEvent(world, playerId(world), "e_mission", "take").ok).toBe(true);
    expect(fgOf(world).campaign.missions["m_linked"]!.status).toBe("active");
  });
});

describe("события: цепочки и кулдауны", () => {
  function chainEvents(): NarrativeEventDef[] {
    return [
      makeEvent({ id: "c1", chainId: "chain_1", step: 1 }),
      makeEvent({
        id: "c2",
        chainId: "chain_1",
        step: 2,
        choices: [{ id: "continue", labelRu: "Продолжить", effects: [{ target: "alloys", value: 50 }] }],
      }),
    ];
  }

  it("шаг 2 не срабатывает без выбора шага 1", () => {
    const world = makeWorld();
    const events = chainEvents();
    narrativePhase(world, catalogOf(events));
    expect(pendingNarrativeEvents(world)[0]!.id).toBe("c1");
    // событие c1 висит необработанным → c2 не появляется
    phaseAt(world, events, 50);
    phaseAt(world, events, 100);
    expect(pendingNarrativeEvents(world).map((event) => event.id)).toEqual(["c1"]);
  });

  it("после выбора шаг 2 приходит (с кулдауном цепочки)", () => {
    const world = makeWorld();
    const events = chainEvents();
    narrativePhase(world, catalogOf(events));
    expect(chooseEvent(world, playerId(world), "c1", "accept").ok).toBe(true);
    const fg = fgOf(world);
    expect(fg.narrative.chainStep["chain_1"]).toBe(1);
    expect(fg.narrative.cooldown["chain_1"]).toBeGreaterThan(world.tick);
    // сразу после выбора — кулдаун
    phaseAt(world, events, 5);
    expect(pendingNarrativeEvents(world).length).toBe(0);
    // через кулдаун цепочки шаг 2 приходит
    phaseAt(world, events, CHAIN_COOLDOWN_TICKS + EVENT_COOLDOWN_TICKS + 5);
    expect(pendingNarrativeEvents(world).map((event) => event.id)).toEqual(["c2"]);
    const empire = world.empires.find((e) => e.id === playerId(world))!;
    const alloysBefore = empire.resources.alloys;
    expect(chooseEvent(world, playerId(world), "c2", "continue").ok).toBe(true);
    expect(empire.resources.alloys).toBe(alloysBefore + 50);
    expect(fg.narrative.chainStep["chain_1"]).toBe(2);
  });

  it("условия minAct: событие не срабатывает в прологе", () => {
    const world = makeWorld();
    const events = [makeEvent({ id: "late_event", chainId: "chain_late", step: 1, minAct: 2 })];
    narrativePhase(world, catalogOf(events));
    expect(pendingNarrativeEvents(world).length).toBe(0);
    // переводим мир в акт II
    world.tick = 1300;
    campaignPhase(world, { missions: [] });
    expect(fgOf(world).campaign.act).toBe(2);
    // Приоритет модалок: сюжетный диалог кампании мог открыться — закрываем его перед проверкой событий.
    endDlcDialogue(world);
    world.tick = 1300;
    narrativePhase(world, catalogOf(events));
    expect(pendingNarrativeEvents(world).map((event) => event.id)).toEqual(["late_event"]);
  });

  it("чередование событий: пул без повторов, глобальный кулдаун", () => {
    const world = makeWorld();
    const events = [
      makeEvent({ id: "a1", chainId: "chain_a", step: 1, weight: 1 }),
      makeEvent({ id: "b1", chainId: "chain_b", step: 1, weight: 1 }),
    ];
    narrativePhase(world, catalogOf(events));
    const fg = fgOf(world);
    expect(fg.narrative.pending.length).toBe(1);
    const first = fg.narrative.pending[0]!.id;
    // в пределах глобального кулдауна новых событий нет
    phaseAt(world, events, EVENT_COOLDOWN_TICKS - 5);
    expect(fg.narrative.pending.length).toBe(1);
    // после кулдауна приходит второе (и только оно)
    phaseAt(world, events, EVENT_COOLDOWN_TICKS + 5);
    expect(fg.narrative.pending.length).toBe(2);
    expect(fg.narrative.pending.some((event) => event.id === first)).toBe(true);
    expect(new Set(fg.narrative.pending.map((event) => event.id)).size).toBe(2);
    // третьего нет — пул исчерпан (к 200 такту события уже истекли, но каждое сработало один раз)
    phaseAt(world, events, 200);
    expect(Object.keys(fg.narrative.fired).sort()).toEqual(["a1", "b1"]);
    expect(fg.narrative.pending.length).toBeLessThanOrEqual(2);
  });

  it("triggerEvent ставит событие в очередь без дублей", () => {
    const world = makeWorld();
    const events = [makeEvent({ id: "forced", chainId: "chain_f", step: 1 })];
    triggerEvent(world, "forced", playerId(world), catalogOf(events));
    expect(pendingNarrativeEvents(world).length).toBe(1);
    triggerEvent(world, "forced", playerId(world), catalogOf(events));
    expect(pendingNarrativeEvents(world).length).toBe(1);
    triggerEvent(world, "unknown_event", playerId(world), catalogOf(events));
    expect(pendingNarrativeEvents(world).length).toBe(1);
  });
});
